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
import { resolveByContextId, resolveInboundContact } from '@/lib/data/interactions';
import type { WebhookInboxRow } from '@/lib/data/webhooks';
import { classifyMessagePayload } from '@/lib/whatsapp/inbound';
import type { InboundMessagePayload } from '@/lib/whatsapp/inbound';

import { listArmedWorkflows, createRunIfNew } from './store';
import { planRuns } from './trigger';

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

  const planned = planRuns(
    {
      eventId: resolved.eventId,
      contactId: resolved.contactId,
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
