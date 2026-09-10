import 'server-only';

// Starting a workflow because a person asked, not because a guest sent WhatsApp.
//
// WHY THIS FILE EXISTS. Until it did, `trigger.whatsapp_inbound` was the only
// trigger in the catalogue and `createRunsForInboundMessage` was the only code
// path that created a run. The measured result on 2026-09-10: 20 saved
// workflows, one armed, and `select count(*) from workflow_runs` = 0. The engine
// had never executed once — not because anything was broken, but because nothing
// could start it. An editor, a runner, a catalogue, a step ledger and a live log
// were all built behind a door only a guest could open.
//
// So this is deliberately NOT "a test button". It is a second entry point with
// the same standing as the first, and the pieces it uses are the same pieces:
// `resolveTriggerContext` and `buildTriggerPayload` are shared with the inbound
// drain precisely so a workflow behaves identically whichever way it started.
import { getWebJobSender } from '@/lib/queue/web-sender';
import { createAdminClient } from '@/lib/supabase/admin';

import { enqueueWorkflowRun } from './enqueue';
import { resolveTriggerContext } from './inbound';
import { createRunIfNew, loadWorkflowForRun } from './store';
import { buildTriggerPayload, findTriggerNode } from './trigger';

export type ManualRunInput = {
  workflowId: string;
  /** Whose data the run reads. Verified against the workflow's own scope below. */
  eventId: string;
  /** The contact the run acts on. Verified to belong to `eventId`. */
  contactId: string;
  /**
   * Stands in for the guest's message. A workflow whose trigger has a keyword,
   * or whose steps read `{{trigger.message_text}}`, behaves the same as it would
   * on a real inbound message carrying this text.
   */
  messageText?: string;
  /** Stands in for a quick-reply button id, same reasoning. */
  buttonPayload?: string;
};

export type ManualRunResult =
  | { ok: true; runId: string }
  | { ok: false; reason: ManualRunRefusal };

export type ManualRunRefusal =
  | 'workflow_not_found'
  | 'workflow_scoped_to_other_event'
  | 'no_trigger_node'
  | 'contact_not_in_event'
  | 'run_not_created';

/**
 * Create a real run and hand it to the worker.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK:
 *
 *   * `is_active`. Arming decides whether GUESTS can start a workflow. A person
 *     with admin rights choosing to run one is the trigger, and requiring the
 *     workflow to be armed first would mean the only way to try something is to
 *     expose it to real inbound traffic — which is the trap this file exists to
 *     get out of.
 *   * The trigger's TYPE or its keyword. `planRuns` matches those because it is
 *     deciding whether a message it did not ask for should fire an automation.
 *     Here the request is explicit. A workflow whose trigger is a schedule, or a
 *     form, or something not invented yet, still runs.
 *
 * WHAT IT DOES CHECK, because these are correctness rather than policy: the
 * workflow exists, its event scope permits this event, it has exactly one
 * trigger node (the adapter would reject the graph otherwise, and failing here
 * gives a named reason instead of a stalled run), and the contact really belongs
 * to the event whose data the run will read.
 *
 * Authorization is NOT here. The calling Server Action requires BOTH
 * `view_customer_data` and `manage_voice`; this module is the domain logic.
 *
 * ⚠️ IF A DEDICATED `workflows.execute` PERMISSION IS EVER ADDED, READ THIS.
 *
 * Decision 2026-09-10: `ops_engineer` holds `manage_voice` but not
 * `view_customer_data`, so it can arm a workflow and cannot run one. That is
 * deliberate — the two axes of the role design (system vs. customer) do not
 * overlap, and widening `view_customer_data` to open one action would collapse
 * them. The correct future fix is a dedicated key, NOT a wider one.
 *
 * But a dedicated key alone is not enough, because of how the UI reaches this
 * function today: `listContactsForManualRun` sends GUEST NAMES to the browser so
 * an admin can pick one from a dropdown. A holder of `workflows.execute` without
 * `view_customer_data` must never receive that list. Whoever adds the key must
 * also change the shape: the caller names a workflow and an event, the SERVER
 * resolves which contact to act on, and no guest list crosses the wire.
 */
export async function startManualRun(input: ManualRunInput): Promise<ManualRunResult> {
  const workflow = await loadWorkflowForRun(input.workflowId);
  if (!workflow) return { ok: false, reason: 'workflow_not_found' };

  // A workflow pinned to one event must not be pointed at another's guests, the
  // same rule `planRuns` enforces. `null` is global and runs for any event.
  if (workflow.eventId !== null && workflow.eventId !== input.eventId) {
    return { ok: false, reason: 'workflow_scoped_to_other_event' };
  }

  const trigger = findTriggerNode(workflow.definition);
  if (!trigger) return { ok: false, reason: 'no_trigger_node' };

  // Ownership, server-side, on the id the browser sent. Without this a crafted
  // request could run a workflow against a contact from someone else's event.
  const admin = createAdminClient();
  const { data: contact } = await admin
    .from('contacts')
    .select('event_id')
    .eq('id', input.contactId)
    .maybeSingle();
  if (!contact || contact.event_id !== input.eventId) {
    return { ok: false, reason: 'contact_not_in_event' };
  }

  const context = await resolveTriggerContext(input.eventId, input.contactId);

  const runId = await createRunIfNew({
    workflowId: input.workflowId,
    eventId: input.eventId,
    triggerSource: 'manual',
    // NULL, which the column's own comment already anticipated: "NULL for a run
    // with no natural key (a manual test run)". Asking twice is two runs, on
    // purpose — re-running after an edit is the whole point.
    dedupeKey: null,
    triggerPayload: buildTriggerPayload({
      eventId: input.eventId,
      contactId: input.contactId,
      messageText: input.messageText ?? '',
      buttonPayload: input.buttonPayload ?? '',
      context,
    }),
  });

  // `createRunIfNew` returns undefined only on a unique-key collision, which
  // cannot happen with a null dedupe key. Reported rather than asserted.
  if (!runId) return { ok: false, reason: 'run_not_created' };

  const boss = await getWebJobSender();
  await enqueueWorkflowRun(boss, runId);

  return { ok: true, runId };
}
