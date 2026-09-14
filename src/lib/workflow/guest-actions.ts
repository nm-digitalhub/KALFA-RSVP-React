import 'server-only';

import { stageGuestListFromInbox } from '@/lib/data/whatsapp-import';
import { sendTemplateToContact } from './template-send';
import {
  FAN_OUT_HARD_CAP,
  GUEST_FILTER_STATUSES,
  type GuestFilterStatus,
} from './catalogue/types';
import { createRunIfNew } from './store';

// GuestActionsPort over the functions that already exist.
//
// Every operation here is a call into an existing module, never a new query. The
// RSVP write in particular goes through `submitRsvp` — the same atomic
// `submit_rsvp` RPC the public form and the inbound webhook use — so token
// validity, event status and revocation are enforced by the one gate rather than
// re-implemented for automation. A workflow can do nothing to a guest that a
// person could not already do through a supported path.
import { getGuestsForContact, recordRsvpFromWhatsapp } from '@/lib/data/interactions';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { submitRsvp } from '@/lib/data/rsvp';
import { createAdminClient } from '@/lib/supabase/admin';
import { dispatchVoicePurposeCall } from '@/lib/data/voice-purpose-dispatch';
import { sendWhatsAppText } from '@/lib/whatsapp/client';

import type { GuestActionsPort } from './engine/ports';
import { dispatchWorkflowRsvpAiCallback } from './voice-agent-actions';

/**
 * How long an OPEN callback request suppresses a new one for the same phone.
 *
 * Two hours, matching the intent of the console-calls guard: long enough that a
 * guest exchanging several messages produces one callback, short enough that a
 * request from this morning does not swallow a genuinely new one this evening.
 */
const CALLBACK_DEDUPE_WINDOW_MS = 2 * 60 * 60 * 1000;

export function createGuestActions(): GuestActionsPort {
  return {
    /**
     * An approved template to this run's guest.
     *
     * A thin delegation to `sendTemplateToContact`, which reuses the campaign
     * path's own send — so MM Lite routing for MARKETING keys, the opt-out and
     * consent gate, and the outbound log all apply here without a second copy.
     */
    async sendWhatsAppTemplate({ eventId, contactId, messageKey }) {
      return sendTemplateToContact({ eventId, contactId, messageKey });
    },

    /**
     * Start a run of another workflow for each matching guest.
     *
     * ⚠️ THE CEILINGS ARE ENFORCED HERE, not by the caller. The handler's
     * `maxGuests` comes from a jsonb row, and the row is exactly what a mistake
     * would have edited — so the query asks for at most `min(maxGuests,
     * FAN_OUT_HARD_CAP) + 1` rows. The `+ 1` is what lets `capped` be honest:
     * without it, "exactly the cap" and "more than the cap" look identical.
     *
     * SELF-FAN-OUT IS REFUSED, not capped. A workflow starting itself per guest
     * — each child fanning out again — is an exponential, and a ceiling on each
     * generation does not stop it.
     *
     * CREATES ROWS; DOES NOT ENQUEUE. A step handler has no queue handle by
     * design, so the children land as `pending` and `workflow-pending-sweep`
     * picks them up within the minute. That indirection also fixes an older
     * class of bug: a run whose enqueue failed after its row was written used to
     * sit `pending` for ever with nothing coming for it.
     */
    async startRunsForGuests({
      parentRunId,
      nodeId,
      eventId,
      targetWorkflowId,
      statuses,
      requirePhone,
      maxGuests,
      depth,
    }) {
      const admin = createAdminClient();

      const { data: target } = await admin
        .from('workflows')
        .select('id, is_active, event_id, definition')
        .eq('id', targetWorkflowId)
        .maybeSingle();
      if (!target) return { ok: false as const, reason: 'target_workflow_not_found' };

      // An armed workflow is one that fires on its OWN trigger. Being started by
      // a fan-out is a different thing, and requiring it to be armed would mean
      // a per-guest workflow had to be live on its own trigger too — which for a
      // WhatsApp trigger would make it fire on every inbound message as well.
      // So arming is not required; existing is.

      const ceiling = Math.min(Math.floor(maxGuests), FAN_OUT_HARD_CAP);
      if (ceiling <= 0) return { ok: false as const, reason: 'invalid_cap' };

      let query = admin
        .from('guests')
        .select('contact_id, phone')
        .eq('event_id', eventId)
        .not('contact_id', 'is', null)
        // One more than the ceiling, so "capped" is a fact rather than a guess.
        .limit(ceiling + 1);

      // NARROWED against the catalogue's own list rather than cast. `statuses`
      // arrives from a jsonb row, and `guests.status` is a Postgres enum: a
      // value outside it is a 22P02 at query time, which would fail the whole
      // fan-out over one bad string. Unknown values are dropped; if that leaves
      // nothing, the filter is not applied at all — the same "unset is widest"
      // rule the other filters follow.
      const known = (statuses ?? []).filter((v): v is GuestFilterStatus =>
        (GUEST_FILTER_STATUSES as readonly string[]).includes(v),
      );
      if (known.length > 0) query = query.in('status', known);
      if (requirePhone) query = query.not('phone', 'is', null);

      const { data: rows, error } = await query;
      if (error) return { ok: false as const, reason: 'guest_query_failed' };

      // DE-DUPLICATED BY CONTACT. A phone may back several guests (a household),
      // and starting three runs for one person would message them three times.
      const contactIds = [
        ...new Set((rows ?? []).map((r) => r.contact_id).filter((id): id is string => !!id)),
      ];
      const capped = contactIds.length > ceiling;
      const selected = contactIds.slice(0, ceiling);

      let started = 0;
      for (const contactId of selected) {
        // Keyed on the PARENT run and node: a replay of the fan-out step — which
        // the step lease can cause — creates no second run for the same guest.
        const runId = await createRunIfNew({
          workflowId: targetWorkflowId,
          eventId,
          triggerSource: 'fanout',
          // ⚠️ THE CHILD'S definition, not the parent's — each child run executes
          // the target workflow. Read once from the row already fetched above, so
          // a fan-out to the cap is still ONE query here and not one per guest.
          definitionSnapshot: target.definition,
          dedupeKey: `fanout:${parentRunId}:${nodeId}:${contactId}`,
          triggerPayload: {
            eventId,
            contactId,
            message_text: '',
            button_payload: '',
            // ⚠️ THE ONLY RECORD OF THE CHAIN. `workflow_runs` has no parent
            // link — measured — so without this the next fan-out cannot know it
            // is the fourth generation rather than the first.
            fanoutDepth: depth,
          },
        });
        if (runId) started += 1;
      }

      return { ok: true as const, matched: contactIds.length, started, capped };
    },

    /**
     * Stage the guest list this run started from.
     *
     * A thin delegation to `stageGuestListFromInbox`, which is the SAME code the
     * hard-coded import path's staging half uses — including its
     * `source_message_id` idempotency, which is what keeps the two from
     * double-staging while both still run.
     *
     * THE ROWS COME BACK — owner ruling, see the port. The run log is where
     * "what arrived" is recorded, because the staging queue is wiped the moment
     * the owner decides.
     */
    async importGuestList({ inboxRowId, eventId }) {
      const result = await stageGuestListFromInbox({ inboxRowId, eventId });
      return result.ok
        ? {
            ok: true as const,
            created: result.created,
            rows: result.rows,
            rowCount: result.rowCount,
            errorCount: result.errorCount,
            fileName: result.fileName,
            reviewUrl: result.reviewUrl,
          }
        : { ok: false as const, reason: result.reason, message: result.message };
    },

    /**
     * Dial this run's guest with a configured voice agent.
     *
     * Thin on purpose: every gate — the purpose being enabled and wired, the
     * account live-calls switch, DNC, opt-out, Shabbat, the dialling window,
     * concurrency, balance and the replay guard — lives in
     * `dispatchVoicePurposeCall`, which is the one place they can be read in
     * order. A second copy here would be a second set of rules to keep correct.
     */
    async startVoicePurposeCall({ runId, nodeId, eventId, contactId, purposeKey }) {
      const outcome = await dispatchVoicePurposeCall({
        purposeKey,
        eventId,
        contactId,
        runId,
        nodeId,
      });
      // 'dialed' and 'already_dispatched' are both successes: the second means a
      // replay found the call this step had already placed.
      const ok = outcome.kind === 'dialed' || outcome.kind === 'already_dispatched';
      return {
        ok,
        status: outcome.kind,
        ...('reason' in outcome && outcome.reason ? { reason: outcome.reason } : {}),
        ...('attemptId' in outcome && outcome.attemptId ? { attemptId: outcome.attemptId } : {}),
      };
    },

    async startRsvpAiCallback(input) {
      return dispatchWorkflowRsvpAiCallback(input);
    },

    async getGuestsForContact(eventId, contactId) {
      // `full_name` is dropped here deliberately: the port's shape is the whole
      // set of guest data a step handler can reach, and a handler has no reason
      // to hold a name.
      const guests = await getGuestsForContact(eventId, contactId);
      return guests.map((g) => ({ id: g.id, rsvp_token: g.rsvp_token }));
    },

    async setGuestField({ eventId, contactId, field, value }) {
      // ONE guest, or none. A phone may back several (guests.contact_id is not
      // unique) and "whose meal preference?" has no answer — the same refusal
      // the inbound webhook and update_guest_status already make.
      const guests = await getGuestsForContact(eventId, contactId);
      if (guests.length === 0) return { ok: false, reason: 'no_guest_for_contact' };
      if (guests.length > 1) return { ok: false, reason: 'multiple_guests_for_contact' };

      const guestId = guests[0]!.id;
      const admin = createAdminClient();

      // SPELLED OUT, not a computed key. `{ [field]: value }` widens to an index
      // signature that the generated Update type refuses — and rightly: it would
      // also let any future addition to GUEST_FIELDS write a column nobody
      // reviewed. Three arms, each one a column name tsc checks.
      //
      // Empty clears the field rather than storing ''. The three columns are all
      // nullable, and "no meal preference" is NULL everywhere else in this
      // codebase — a workflow must not invent a second spelling of absent.
      const next = value === '' ? null : value;
      const patch =
        field === 'meal_pref'
          ? { meal_pref: next }
          : field === 'rsvp_note'
            ? { rsvp_note: next }
            : { note: next };

      const { error } = await admin
        .from('guests')
        .update(patch)
        .eq('id', guestId)
        .eq('event_id', eventId);

      if (error) return { ok: false, reason: 'update_failed' };
      return { ok: true, guestId };
    },

    async createCallbackRequest({ eventId, contactId, topic, note }) {
      const guests = await getGuestsForContact(eventId, contactId);
      if (guests.length === 0) return { ok: false, created: false, reason: 'no_guest_for_contact' };

      const admin = createAdminClient();
      const { data: guest } = await admin
        .from('guests')
        .select('full_name, phone')
        .eq('id', guests[0]!.id)
        .maybeSingle();

      const phone = guest?.phone?.trim();
      // Nothing to call back. An ordinary answer, not a failure: a guest row
      // without a phone is a legitimate state (an email-only invite).
      if (!phone) return { ok: false, created: false, reason: 'no_phone' };

      // ⚠️ THE DEDUPE IS THE POINT. A second row is a second phone call to a
      // real person, and the step lease can replay a completed node. The same
      // guard console-calls.ts applies to missed inbound calls: an OPEN request
      // for this phone inside the window already covers them.
      const { data: open } = await admin
        .from('callback_requests')
        .select('id')
        .eq('phone', phone)
        .in('status', ['new', 'in_progress'])
        .gte('created_at', new Date(Date.now() - CALLBACK_DEDUPE_WINDOW_MS).toISOString())
        .limit(1)
        .maybeSingle();
      if (open) return { ok: true, created: false };

      const { error } = await admin.from('callback_requests').insert({
        full_name: guest?.full_name?.trim() || 'אורח',
        phone,
        topic,
        // NULL = "no stated time" — the scheduler resolves ASAP against the
        // clock when it runs. Same convention as inquiries.ts and console-calls.
        requested_at: null,
        requested_rank: 'earliest',
        note,
      });
      if (error) return { ok: false, created: false, reason: 'insert_failed' };
      return { ok: true, created: true };
    },

    async sendWhatsAppReply(contactId, body) {
      // Three reasons a send does not happen, each named rather than thrown:
      // the handler reports them as a completed-but-skipped step so the owner
      // reads WHY in the run log instead of seeing a bare failure.
      const config = await getWhatsAppConfig();
      if (!config) return { ok: false, reason: 'whatsapp_not_configured' };

      const { data } = await createAdminClient()
        .from('contacts')
        .select('normalized_phone')
        .eq('id', contactId)
        .maybeSingle();
      const phone = data?.normalized_phone;
      if (!phone) return { ok: false, reason: 'no_phone_for_contact' };

      const outcome = await sendWhatsAppText(config, { to: phone, body });
      // `sendWhatsAppText` classifies rather than throws, so the delivery
      // verdict arrives as a value. 'accepted' is Meta taking the message —
      // not delivery, and never read receipt.
      return outcome.kind === 'accepted'
        ? { ok: true }
        : { ok: false, reason: outcome.kind };
    },

    async submitRsvp(token, input) {
      const outcome = await submitRsvp(token, {
        status: input.status,
        adults: input.adults,
        kids: input.kids,
      });
      // `unchanged: true` is still `ok` — the RPC is idempotent, and setting the
      // same status twice really is success. That property is what makes this
      // action safe to replay after a lease reclaim (see STEP_LEASE_MS).
      return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
    },

    recordRsvpFromWhatsapp,
  };
}
