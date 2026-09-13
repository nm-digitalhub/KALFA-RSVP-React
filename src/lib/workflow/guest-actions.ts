import 'server-only';

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
