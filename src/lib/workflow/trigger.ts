// Which armed workflows an inbound WhatsApp message starts, and under what key.
//
// Pure: takes the message and the armed workflows, returns the runs to create.
// The drain performs the I/O. Written this way because the decision "does this
// message start this workflow?" is the one place a mistake is expensive in both
// directions — a missed run is an automation that silently does nothing, an
// extra run is a duplicate action on a guest — and it is worth being able to
// test exhaustively without a database.
import { editorDiagramSchema } from './adapter/editor-schema';
import { isTriggerType } from './catalogue/nodes';

export type ArmedWorkflow = {
  id: string;
  /** null = global; otherwise the workflow only runs for this event. */
  eventId: string | null;
  definition: unknown;
};

export type InboundMessage = {
  eventId: string;
  contactId: string;
  /** The inbox row's id. The run's dedupe key is derived from it — see below. */
  inboxRowId: string;
  messageText: string;
  buttonPayload: string;
  /**
   * Context resolved ONCE by the caller, before any workflow is matched.
   *
   * It belongs here rather than inside `planRuns` because this module is pure —
   * it takes a message and a list of armed workflows and returns plans, with no
   * I/O of its own, which is what makes it testable without a database. The
   * lookups live in `inbound.ts`, which is already holding an admin client.
   *
   * Resolved once per MESSAGE, not once per matched workflow: three armed
   * workflows firing on the same message share one guest lookup.
   */
  /**
   * Absent, never `''`, when the phone backs anything other than exactly one
   * guest — so a template's `| default:'…'` fires. See the note on
   * `WorkflowTriggerPayload`.
   */
  guestName?: string;
  eventName?: string;
  eventDate?: string;
};

export type PlannedRun = {
  workflowId: string;
  eventId: string;
  /**
   * Run-level idempotency, one layer above the per-node ledger. Keyed on the
   * INBOX ROW, not on the message id and not on the clock: the drain is
   * at-least-once over the same rows, and Meta retries the same delivery. One
   * inbox row plus one workflow is one run, forever — enforced by
   * workflow_runs_dedupe_key_uidx, so even two workers draining concurrently
   * produce a single row.
   */
  dedupeKey: string;
  /**
   * Structurally `WorkflowTriggerPayload`, restated rather than imported: this
   * module is read by the webhook drain and must not pull in ./steps, which
   * carries the handlers and their dependencies. `tsc` still catches a drift
   * between the two, because the worker assigns one to the other.
   */
  triggerPayload: {
    eventId: string;
    contactId: string;
    message_text: string;
    button_payload: string;
    // Optional for the same reason as on `WorkflowTriggerPayload`: omitted, not
    // emptied, so `| default:'…'` in a template actually fires.
    guest_name?: string;
    event_name?: string;
    event_date?: string;
  };
};

/**
 * The keyword filter, applied HERE rather than inside the trigger node's
 * handler. A workflow whose keyword does not match must not produce a run at
 * all: a run row that started and immediately stopped reads, in the admin UI and
 * in any later audit, as "the automation ran" — which is exactly the wrong
 * thing to record about a message it was configured to ignore.
 *
 * Empty or absent keyword means every inbound message matches, which is the
 * documented default in the node's own property description.
 */
export function matchesKeyword(keyword: unknown, messageText: string): boolean {
  if (typeof keyword !== 'string' || keyword.trim() === '') return true;
  return messageText.toLowerCase().includes(keyword.trim().toLowerCase());
}

/**
 * The trigger node of a stored diagram, if it has exactly one.
 *
 * Rule 1 again: which types may start is the catalogue's answer, never the
 * stored JSON's. This reads `data.type` and asks `isTriggerType` — it does not
 * look for a `role` or an `isStartNode` key, because a stored value would be
 * discarded by the adapter moments later anyway, and reading one here would
 * make THIS the place a crafted row could choose an entry point.
 */
export function findTriggerNode(
  storedDefinition: unknown,
): { type: string; properties: Record<string, unknown> } | undefined {
  const parsed = editorDiagramSchema.safeParse(storedDefinition);
  if (!parsed.success) return undefined;

  const triggers = parsed.data.nodes.filter((n) => isTriggerType(n.data.type));
  // Zero or several is a contract violation the adapter will report with a
  // named error when the run is attempted. Not starting a run on an ambiguous
  // graph is the conservative half of that; the owner still sees the error the
  // next time they open or save the workflow.
  if (triggers.length !== 1) return undefined;

  const trigger = triggers[0]!;
  return { type: trigger.data.type, properties: trigger.data.properties };
}

/**
 * Every run an inbound message should create. Order follows the input, so two
 * drains of the same row plan the same runs in the same order.
 */
export function planRuns(
  message: InboundMessage,
  armed: readonly ArmedWorkflow[],
): PlannedRun[] {
  const planned: PlannedRun[] = [];

  for (const workflow of armed) {
    // A workflow scoped to an event never fires for another one. Global
    // workflows (eventId === null) fire for every event.
    if (workflow.eventId !== null && workflow.eventId !== message.eventId) continue;

    const trigger = findTriggerNode(workflow.definition);
    if (!trigger) continue;

    // Only the inbound-WhatsApp trigger responds to an inbound WhatsApp
    // message. Written as an equality rather than "is a trigger" so adding a
    // second trigger type (a schedule, a form submission) cannot accidentally
    // arm it against this event source.
    if (trigger.type !== 'trigger.whatsapp_inbound') continue;

    if (!matchesKeyword(trigger.properties.keyword, message.messageText)) continue;

    planned.push({
      workflowId: workflow.id,
      eventId: message.eventId,
      dedupeKey: `whatsapp_inbound:${message.inboxRowId}:${workflow.id}`,
      // The frozen record of what started this run. `{{trigger.…}}` names
      // exactly these keys, so the snake_case is a contract with every saved
      // workflow — not a style choice — and renaming one breaks references an
      // owner already typed.
      triggerPayload: {
        eventId: message.eventId,
        contactId: message.contactId,
        message_text: message.messageText,
        button_payload: message.buttonPayload,
        // Spread-when-present. Writing `guest_name: undefined` would put the
        // key in the jsonb row as null, and null is a REAL value to the
        // resolver — the fallback would not fire and we would be back where we
        // started.
        ...(message.guestName === undefined ? {} : { guest_name: message.guestName }),
        ...(message.eventName === undefined ? {} : { event_name: message.eventName }),
        ...(message.eventDate === undefined ? {} : { event_date: message.eventDate }),
      },
    });
  }

  return planned;
}
