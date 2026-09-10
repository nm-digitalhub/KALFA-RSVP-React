import 'server-only';

// The bridge from an inbound WhatsApp message to workflow runs.
//
// A workflow is an ADDITIONAL consumer of the same inbound event, never a
// replacement: `processWebhookEvent` is untouched, and everything that works
// today — billing, opt-out, the RSVP quick-reply path — behaves exactly as
// before whether or not any workflow exists.
//
// It lives here rather than inside webhook-processing.ts on purpose. That module
// owns the economic logic and is heavily tested; threading a pg-boss handle
// through it to reach an enqueue would put automation concerns inside the
// billing path. This module does its own (read-only) resolve instead, and the
// worker calls it after the existing processing has succeeded.
import { formatIsraelDate } from '@/lib/date';
import { resolveByContextId, resolveInboundContact } from '@/lib/data/interactions';
import { createAdminClient } from '@/lib/supabase/admin';
import { deriveGuestFirstName } from '@/lib/whatsapp/template-spec';
import type { WebhookInboxRow } from '@/lib/data/webhooks';
import { classifyMessagePayload } from '@/lib/whatsapp/inbound';
import type { InboundMessagePayload } from '@/lib/whatsapp/inbound';

import { listArmedWorkflows, createRunIfNew } from './store';
import { type TriggerContext, planRuns } from './trigger';

/**
 * Create a run row for every armed workflow this message starts, and return the
 * ids that were newly created.
 *
 * Nothing is enqueued here — the caller (the worker, which holds `boss`) does
 * that. An id in the returned list is a run that did not exist a moment ago, so
 * a redelivery of the same inbox row returns an empty list and enqueues nothing:
 * `workflow_runs_dedupe_key_uidx` is what decides, not a check-then-insert.
 *
 * Best-effort by design at the CALL SITE, not here: this throws on a real
 * failure so the caller can log it, and the caller must not let it fail the
 * webhook row it belongs to. A broken automation must never break intake.
 */
export async function createRunsForInboundMessage(
  row: WebhookInboxRow,
): Promise<string[]> {
  if (row.event_kind !== 'message') return [];

  const payload = (row.payload ?? {}) as InboundMessagePayload & { from?: string };

  // The same classification the drain uses. A non-billable payload (a system
  // message, an unsupported type) is not a guest speaking to us and must not
  // start an automation either.
  //
  // `processMessage` opens with one more gate this does NOT repeat:
  // `if (await stageWhatsAppImport(row)) return;`. Calling it again would be a
  // bug, not a fix — it has side effects (it replies to the owner), so a second
  // call would send a second message. It is also unnecessary: it consumes only
  // `type === 'document' | 'contacts'`, and BILLABLE_MESSAGE_TYPES is
  // {text, button, interactive, reaction}. The two sets are disjoint, so the
  // `billable` check below already excludes every message the import path
  // claims. If a document type is ever made billable, this gate must be
  // revisited — that is the coupling worth knowing about.
  const { billable, replyId } = classifyMessagePayload(payload);
  if (!billable) return [];

  const contextId = row.context_message_id;
  const resolved =
    (contextId ? await resolveByContextId(contextId) : null) ??
    (payload.from ? await resolveInboundContact(payload.from) : null);
  if (!resolved) return [];

  const armed = await listArmedWorkflows();
  if (armed.length === 0) return [];

  // Resolved ONCE per message, before any workflow is matched: three armed
  // workflows firing on the same message share this lookup.
  const context = await resolveTriggerContext(resolved.eventId, resolved.contactId);

  const planned = planRuns(
    {
      eventId: resolved.eventId,
      contactId: resolved.contactId,
      ...context,
      // The inbox ROW id, not the provider message id: the row is what the
      // drain is at-least-once over, and it is what a reprocess re-reads.
      inboxRowId: row.id,
      messageText: readTextBody(payload),
      buttonPayload: replyId ?? '',
    },
    armed,
  );

  const created: string[] = [];
  for (const plan of planned) {
    const runId = await createRunIfNew(plan);
    // `undefined` means the run already existed — a redelivery. The first
    // creator enqueued it; enqueueing again would be harmless (the job id is
    // deterministic) but returning it would misreport what happened.
    if (runId) created.push(runId);
  }

  return created;
}

function readTextBody(payload: { text?: { body?: string } }): string {
  const body = payload.text?.body;
  return typeof body === 'string' ? body : '';
}

/**
 * The context a `{{trigger.…}}` reference can name, beyond the message itself.
 *
 * FAIL-SOFT BY CONSTRUCTION. A failed lookup cannot stop a run from being
 * created: a greeting that loses a name is a smaller failure than an automation
 * that does not fire.
 *
 * Every unknown field comes back UNDEFINED rather than `''`, and that is not a
 * detail. `resolveTemplate` fires `?` and `| default:'…'` only for a strictly
 * undefined value — an empty string is a real value and resolves — so returning
 * `''` here silently defeated the fallback an owner had written. See the note on
 * `WorkflowTriggerPayload`.
 *
 * `guestName` is empty when the phone backs more than one guest. Same refusal
 * `action.update_guest_status` makes: with several guests behind one contact,
 * "whose name" has no answer, and greeting the wrong person by name is worse
 * than not greeting at all.
 */
export async function resolveTriggerContext(
  eventId: string,
  contactId: string,
): Promise<TriggerContext> {
  const empty = {};
  try {
    const admin = createAdminClient();

    const [guests, event] = await Promise.all([
      admin.from('guests').select('full_name').eq('event_id', eventId).eq('contact_id', contactId),
      admin.from('events').select('name, event_date').eq('id', eventId).maybeSingle(),
    ]);

    const rows = guests.data ?? [];
    // Exactly one, or no name at all.
    // Exactly one guest, or no answer at all — `undefined`, so a template's
    // `| default:'אורח יקר'` is what fills the gap.
    const guestName =
      rows.length === 1 ? (deriveGuestFirstName(rows[0]?.full_name) ?? undefined) : undefined;

    return {
      guestName,
      eventName: event.data?.name ?? undefined,
      // Through the project's own formatter: `events.event_date` is timestamptz
      // and slicing it is forbidden (see src/lib/date.ts).
      eventDate: event.data?.event_date ? formatIsraelDate(event.data.event_date) : undefined,
    };
  } catch {
    return empty;
  }
}
