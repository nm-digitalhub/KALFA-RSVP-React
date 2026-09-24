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
import { resolveOwnerActiveEvents } from '@/lib/data/whatsapp-import';
import { normalizePhone } from '@/lib/phone';
import { createAdminClient } from '@/lib/supabase/admin';
import { deriveGuestFirstName } from '@/lib/whatsapp/template-spec';
import type { WebhookInboxRow } from '@/lib/data/webhooks';
import { classifyMessagePayload } from '@/lib/whatsapp/inbound';
import type { InboundMessagePayload } from '@/lib/whatsapp/inbound';

import { listArmedWorkflows, createRunIfNew } from './store';
import { editorDiagramSchema } from './adapter/editor-schema';
import { OWNER_WHATSAPP_MESSAGE_KINDS } from './catalogue/types';
import * as whatsappInboundDefinition from './nodes/trigger-whatsapp-inbound/definition';
import { type TriggerContext, matchesKind, planRuns } from './trigger';

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

  // ⚠️ THE BILLING CLASSIFIER IS NO LONGER THE AUTOMATION GATE.
  //
  // This used to open `if (!billable) return []`, reusing BILLABLE_MESSAGE_TYPES
  // to decide what an owner may automate. The two agree for a guest replying and
  // disagree completely for the case that matters: an owner sending a guest list
  // is not a billable reach, so a CSV or a batch of contact cards could never
  // start a run — which is why importing guests had to live as a separate
  // hard-coded mechanism instead of as a flow an owner draws.
  //
  // `replyId` is still taken from the classifier (it is the quick-reply id, not
  // a billing fact). Billing itself is untouched: `processWebhookEvent` runs
  // beside this and still counts exactly what it counted.
  //
  // WHICH kinds start a run is now each TRIGGER's own answer (`matchesKind`),
  // defaulting to the old billable set — so every saved diagram behaves
  // identically until its owner says otherwise.
  //
  // `processMessage` opens with one gate this does NOT repeat:
  // `if (await stageWhatsAppImport(row)) return;`. Calling it again would be a
  // bug, not a fix — it replies to the owner, so a second call sends a second
  // message. The import path and this one now see the SAME messages, and that is
  // deliberate: staging keeps working exactly as before while a workflow can
  // also observe and act on the arrival.
  const { replyId } = classifyMessagePayload(payload);
  const kind = typeof payload.type === 'string' ? payload.type : '';

  const armed = await listArmedWorkflows();
  if (armed.length === 0) return [];

  // ORDERED BEFORE THE LOOKUPS, and that ordering is the cost control: resolving
  // who a message is about costs two queries, and the overwhelming majority of
  // inbound rows are kinds no armed workflow asked for. `planRuns` would reject
  // them anyway — this just refuses to pay for the answer first.
  if (!armed.some((w) => acceptsKind(w, kind))) return [];

  // WHO the run is about, and there are two shapes.
  //
  // A guest speaking to us resolves to an event AND a contact. An owner sending
  // a list resolves to their event and NO contact — they are not a guest, so
  // every guest-touching node refuses inside the run (`requireGuestContext`),
  // exactly as it does for `trigger.webhook`.
  const resolved = OWNER_WHATSAPP_MESSAGE_KINDS.includes(kind)
    ? await resolveOwnerSender(payload.from)
    : await resolveGuestSender(row, payload);
  if (!resolved) return [];

  // Resolved ONCE per message, before any workflow is matched: three armed
  // workflows firing on the same message share this lookup.
  const context = await resolveTriggerContext(resolved.eventId, resolved.contactId);

  const planned = planRuns(
    {
      eventId: resolved.eventId,
      contactId: resolved.contactId,
      kind,
      ...context,
      // The inbox ROW id, not the provider message id: the row is what the
      // drain is at-least-once over, and it is what a reprocess re-reads.
      inboxRowId: row.id,
      // WHICH OF OUR LINES it came in on. Straight off the row — the column the
      // inbound router already reads — so `planRuns` needs no lookup.
      phoneNumberId: row.phone_number_id,
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

/**
 * Does this workflow's trigger accept this message kind?
 *
 * A cheap pre-filter, NOT the decision: `planRuns` asks the same question again
 * through `matchesKind`, which is the authority and also applies the keyword and
 * the receiving-number filters. This exists only so a message no workflow wants
 * costs no database round-trip.
 *
 * A workflow whose definition will not parse, or whose trigger is not the
 * inbound-WhatsApp one, is counted as NOT accepting — the same answer `planRuns`
 * would reach, so the pre-filter can never hide a run the real matcher wanted.
 */
function acceptsKind(workflow: { definition: unknown }, kind: string): boolean {
  const parsed = editorDiagramSchema.safeParse(workflow.definition);
  if (!parsed.success) return false;
  const trigger = parsed.data.nodes.find((n) => n.data.type === whatsappInboundDefinition.type);
  return trigger ? matchesKind(trigger.data.properties?.messageKinds, kind) : false;
}

/** A guest speaking to us: an event AND a contact. */
async function resolveGuestSender(
  row: WebhookInboxRow,
  payload: { from?: string },
): Promise<{ eventId: string; contactId: string } | null> {
  const contextId = row.context_message_id;
  return (
    (contextId ? await resolveByContextId(contextId) : null) ??
    (payload.from ? await resolveInboundContact(payload.from) : null)
  );
}

/**
 * An OWNER sending us a list: their event, and no contact.
 *
 * Reuses `resolveOwnerActiveEvents` — the same lookup the import path uses — so
 * "which event is this owner's" has exactly one answer in the codebase.
 *
 * MORE THAN ONE ACTIVE EVENT MEANS NO RUN, deliberately. The import path already
 * refuses to guess here (misroute incident 2026-07-06: a brit guest list landed
 * on a newer active event because "newest wins") and replies asking the owner to
 * use the right event's screen. A workflow must not quietly pick one either —
 * and it must not answer, because the import path is already answering.
 */
async function resolveOwnerSender(
  from: string | undefined,
): Promise<{ eventId: string; contactId: null } | null> {
  if (!from) return null;

  // ⚠️ NORMALISED FIRST, AND THAT LINE IS THE WHOLE FUNCTION WORKING.
  //
  // MEASURED 2026-09-13, after a live list produced no run and no error: Meta
  // sends `from` WITHOUT a leading '+' ("972…", 12 chars), while
  // `resolveOwnerActiveEvents` compares it against `normalizePhone(profile.phone)`
  // — which returns E.164 and DOES carry the '+'. Passing the raw value could
  // therefore never match any profile, and the function returned an empty list,
  // which reads as "this sender owns no active event" and is indistinguishable
  // from a stranger. No run, no error, nothing in a log.
  //
  // The import path never had this bug because `readImportPayload` normalises
  // before it calls the same function. This is the second caller, and it has to
  // do the same thing.
  const sender = normalizePhone(from);
  if (!sender) return null;

  const events = await resolveOwnerActiveEvents(sender);
  if (events.length !== 1) return null;
  return { eventId: events[0]!.id, contactId: null };
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
  /**
   * `null` when the sender is the OWNER rather than a guest — a CSV or contact
   * cards. The event's own name and date still resolve (a list arriving is very
   * much about an event); `guest_name` does not, because there is no guest, and
   * it is OMITTED rather than emptied so `| default:'…'` still fires.
   */
  contactId: string | null,
): Promise<TriggerContext> {
  const empty = {};
  try {
    const admin = createAdminClient();

    const [guests, event] = await Promise.all([
      contactId === null
        ? Promise.resolve({ data: [] as { full_name: string | null }[] })
        : admin
            .from('guests')
            .select('full_name')
            .eq('event_id', eventId)
            .eq('contact_id', contactId),
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
