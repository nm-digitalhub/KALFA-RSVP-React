// The dependencies the workflow engine needs from the rest of KALFA, as
// interfaces rather than imports.
//
// Same shape and the same reason as `StepExecutionDeps` in
// src/lib/outreach/enqueue.ts: this module and everything downstream of it stay
// free of `server-only`, Supabase and pg-boss, so the engine and every step
// handler are unit-testable without a database. The worker wires the real
// implementations; the tests wire fakes and assert on what was called.
import type { RsvpStatus } from '@/lib/constants';

import type { GuestField, HttpHeader, HttpMethod, NotifyLevel } from '../catalogue/types';

// ---------------------------------------------------------------------------
// The execution ledger
// ---------------------------------------------------------------------------

/**
 * The outcome of trying to claim a node's step row.
 *
 * `claimed` — this attempt owns the node and must perform its side effect.
 * `already_done` — a previous attempt finished it. The vendored `runGraph` keeps
 *   no per-node checkpoint, so a pg-boss retry replays the WHOLE graph from the
 *   start node; this is the answer that stops the second send. It carries the
 *   original result so the replayed graph routes exactly as it did the first
 *   time rather than re-deciding a branch on an empty one.
 * `in_flight` — another attempt holds the node right now. Distinct from
 *   `already_done` because it must NOT be treated as success: nothing has
 *   finished, and continuing downstream would run on a result that does not
 *   exist yet.
 *
 * A `running` row means one of two things, and THE ROW ALONE CANNOT TELL THEM
 * APART: another attempt is working on it, or an attempt died holding it. Two
 * mechanisms separate them, and the implementation needs both:
 *
 *   1. `singletonKey: runId` on the pg-boss send, so the same run is never
 *      delivered concurrently. (Same idiom as QUEUES.logExport.) With it, a
 *      `running` row found by a RETRY is necessarily abandoned, not contended.
 *   2. A staleness lease on `started_at`, so a genuinely abandoned row is
 *      reclaimable rather than poisoning the run forever.
 *
 * Without the lease, ANY crash makes a run permanently unrecoverable: the retry
 * meets the dead attempt's own `running` row on the very first node, reports
 * `in_flight`, and fails. Safe, but never durable.
 *
 * THE COST OF THE LEASE, stated plainly. Reclaiming reopens exactly one window:
 * a node whose side effect completed but whose `completeStep` never landed will
 * run a second time. So **every action node must be safe to call twice**, either
 * because the operation is naturally idempotent (`submit_rsvp` setting the same
 * status again is the same row) or because it carries its own deterministic
 * dedup key (the `detId` / `deferId` idiom in src/lib/outreach). `send_whatsapp`
 * will need the second kind. This is a rule about which actions may exist, not
 * an implementation detail of this file.
 */
export type StepClaim =
  | {
      kind: 'claimed';
      /**
       * True when this claim took over a row that was PARKED and whose deadline
       * has now passed — `logic.wait` finishing its wait.
       *
       * The wait node cannot tell "first arrival" from "woke up" on its own: on
       * resume the whole graph replays, and a node that recomputed its deadline
       * from config would park for another full duration, every time, forever.
       * The ledger is the only thing that knows, so the ledger says so.
       */
      resumedFromWait?: boolean;
    }
  | { kind: 'already_done'; result: unknown }
  | { kind: 'in_flight' };

export interface StepLedgerPort {
  /**
   * Claim the (runId, nodeId) row before the side effect. Backed by
   * `unique (run_id, node_id)`: a concurrent attempt gets 23505 and must be
   * reported as `in_flight` or `already_done` — never swallowed into a fresh
   * claim.
   *
   * A `running` row older than `STEP_LEASE_MS` is RECLAIMED (returns `claimed`,
   * with `started_at` reset). Younger than that, it is `in_flight`. See the
   * StepClaim comment for why both halves are required.
   */
  claimStep(args: {
    runId: string;
    nodeId: string;
    nodeType: string;
  }): Promise<StepClaim>;

  /**
   * Record the node's finished result.
   *
   * `result` is the WHOLE `NodeExecutionResult` — `{ output, nextPort? }` — not
   * just its `output` field, and `claimStep` must hand exactly this back as
   * `already_done.result`. The distinction is the difference between a correct
   * replay and a wrong one: `nextPort` is the branch a condition node chose, and
   * a replay that lost it would re-decide the branch on an empty value and could
   * run a subtree that never ran.
   *
   * The `workflow_run_steps.output` column therefore holds the full result. The
   * column name is the runner's word for it, kept rather than renamed so the row
   * and the port read the same in a log.
   */
  completeStep(args: {
    runId: string;
    nodeId: string;
    result: unknown;
  }): Promise<void>;

  failStep(args: {
    runId: string;
    nodeId: string;
    message: string;
  }): Promise<void>;

  /**
   * Park a claimed step until `waitUntil`.
   *
   * NOT `failStep` with a nicer message, and not leaving the row `running`:
   *
   *   * `failed` would let the next attempt take the row over immediately
   *     (`takeOverFailedRow`), so the wait would end the moment pg-boss redelivered
   *     for any other reason.
   *   * `running` would be reclaimed by the 15-minute lease, re-running the node
   *     and restarting its wait — a 3-day wait would never elapse.
   *
   * Optional so a port that predates waits fails closed rather than silently
   * treating a wait as an ordinary failure.
   */
  beginWait?(args: {
    runId: string;
    nodeId: string;
    waitUntil: string;
    /**
     * The external event the park is waiting for, when the node named one.
     *
     * The STORE does not persist this — the step row is parked by deadline and
     * that is all it needs. It travels here because this call is the only place
     * that sees a park with the ORIGINAL error object still in hand: the vendored
     * runner flattens a throw to `{message, code, attempt}` before emitting
     * `node_failed`, so anything else on the error is gone by the time the event
     * is observed. `run-workflow` wraps this method to capture the park, which
     * is what lets the run row record the correlation without parsing it back
     * out of an error message.
     */
    correlationId?: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Run status
// ---------------------------------------------------------------------------

// Mirrors the workflow_runs.status check constraint, which in turn mirrors
// ExecutionStatus in the vendored runner. Three lists, one vocabulary.
export type RunStatus =
  | 'pending'
  | 'running'
  /**
   * Parked at a `logic.wait`, waiting for its deadline.
   *
   * NOT terminal — see TERMINAL_RUN_STATUSES below. A parked run is still in
   * flight: it stamps no `finished_at`, it is still cancellable, and pg-boss is
   * holding a delayed job for it.
   */
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled';

/**
 * How long a claimed-but-unfinished step is presumed live.
 *
 * Follows the 15-minute window `voximplant-reconcile` already uses for
 * pre-terminal rows, for the same reason: it is comfortably longer than any
 * single step should take, so a reclaim inside it would be a false positive,
 * and short enough that a crashed run recovers on the next retry rather than
 * on a human's next glance at the dashboard.
 */
export const STEP_LEASE_MS = 15 * 60 * 1000;

/**
 * The error code a node raises when another attempt already holds it.
 *
 * ⚠️ NOT A FAILURE OF THE RUN, and the distinction is the whole point. It says
 * "someone else is doing this right now", which is a scheduling fact about two
 * deliveries, not anything wrong with the workflow the owner drew. `run-workflow`
 * intercepts it the way it intercepts a wait: no `node_failed`, no
 * `execution_failed`, no terminal status — the run is left exactly as it is and
 * the job is retried.
 *
 * Exported so the raiser and the interceptor share one string. It used to be a
 * literal in `activity-runner`, read by nobody, and a rename would have silently
 * turned every contention back into a failed run.
 */
export const STEP_IN_FLIGHT_CODE = 'step_in_flight';

/**
 * The code raised when the QUEUE has taken this run's job away mid-walk.
 *
 * Handled exactly like `STEP_IN_FLIGHT_CODE` — no `node_failed`, no
 * `execution_failed`, no terminal status — because it means the same thing from
 * the run's point of view: this delivery must stop and the one that now owns the
 * job will carry on. The two are separate codes so a log tells them apart: one
 * is "someone else is already on this node", the other is "I am not the one
 * running this any more".
 */
export const RUN_ABANDONED_CODE = 'run_abandoned';

export interface RunStorePort {
  /**
   * Write the run's status. The implementation also stamps `finished_at` when
   * the status is terminal ('completed' | 'incomplete' | 'failed' |
   * 'cancelled') — this is the only writer of that column, so a run with a
   * terminal status and a null `finished_at` would be a bug in the store rather
   * than a state the engine can produce.
   */
  setRunStatus(args: {
    runId: string;
    status: RunStatus;
    errorMessage?: string;
    /**
     * When a `waiting` run should wake. Written with the status and CLEARED on
     * every other status, so the column reads as "still owed a wake-up" rather
     * than as a record of one that already happened.
     */
    resumeAt?: string;
    /**
     * The EXTERNAL EVENT a `waiting` run is parked on — an opaque id the waking
     * side can look the run up by (for a voice step, the attempt id).
     *
     * `resumeAt` and this are two halves of one wait, not alternatives: the
     * deadline stays the CEILING (an event that never arrives must not park a
     * run for ever) and this is the channel that can bring the run back sooner.
     *
     * Same lifecycle rule as `resumeAt` — written with 'waiting', cleared on
     * everything else — so a stale id can never be matched by an unrelated event
     * after the run has moved on.
     */
    resumeCorrelationId?: string;
  }): Promise<void>;
}

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'incomplete',
  'failed',
  'cancelled',
];

// ---------------------------------------------------------------------------
// What the action nodes are allowed to do
// ---------------------------------------------------------------------------

// Deliberately narrow. A step handler cannot reach a Supabase client, only these
// named operations — so the set of things a workflow can do to a guest is
// readable in one place instead of inferred from every handler.
export interface GuestActionsPort {
  /**
   * Guests behind one contact. A phone may back several guests (guests.contact_id
   * is not unique), which is why this returns a list and the handler refuses to
   * guess — see the comment in webhook-processing.ts.
   */
  getGuestsForContact(
    eventId: string,
    contactId: string,
  ): Promise<{ id: string; rsvp_token: string }[]>;

  /**
   * Stage the guest list that started this run, for `action.import_guest_list`.
   *
   * Optional only so a recording/test port that predates the node fails closed
   * rather than gaining a capability implicitly — the same rule every other
   * added method here follows.
   *
   * ⚠️ THE ROWS COME BACK, and that is a deliberate owner ruling (2026-09-13).
   *
   * They land in `workflow_run_steps.output` and in the editor's log panel, so a
   * run says WHAT arrived and a later step can act on the list
   * (`{{nodes.<id>.rows}}`). The staging table is wiped once the owner confirms
   * or discards — it is a work queue — so this is not a second copy that
   * outlives the first; it is the copy that records what the automation saw.
   */
  importGuestList?(input: {
    /** The inbox row the trigger fired on. The list lives on it. */
    inboxRowId: string;
    eventId: string;
  }): Promise<
    | {
        ok: true;
        created: boolean;
        /** The parsed list. See the note above on why it is returned. */
        rows: { full_name: string; phone: string | null; expected_count: number | null; group: string }[];
        rowCount: number;
        errorCount: number;
        fileName: string | null;
        reviewUrl: string;
      }
    | { ok: false; reason: string; message?: string }
  >;

  /**
   * Send an APPROVED WhatsApp template to this run's guest.
   *
   * ⚠️ WHY THIS EXISTS ALONGSIDE `sendWhatsAppReply`, which also sends WhatsApp.
   * They are not interchangeable:
   *
   *   `sendWhatsAppReply` sends FREE TEXT, which WhatsApp permits only inside
   *     the 24-hour window a guest's own message opens. Right for answering
   *     someone who just wrote; useless for reaching someone who did not.
   *
   *   this sends an APPROVED TEMPLATE, which is what may be sent at any time —
   *     and therefore the only thing an automation triggered by a clock can use.
   *
   * It reuses the campaign path's own send rather than reimplementing it, so
   * every rule that path enforces applies unchanged: the opt-out and consent
   * gate (`terminalReasonFor`, which reads the live setting rather than assuming
   * one), MM Lite routing for MARKETING templates, and the outbound interaction
   * log.
   *
   * Optional so a port predating the node fails closed rather than gaining the
   * ability to message guests implicitly.
   */
  sendWhatsAppTemplate?(input: {
    eventId: string;
    contactId: string;
    /** One of `message_templates.message_key` — 'thankyou', 'reminder_1', … */
    messageKey: string;
  }): Promise<{ ok: boolean; reason?: string }>;

  /**
   * Start a run of another workflow for each guest matching the filter.
   *
   * ⚠️ THE CAP IS ENFORCED IN THE IMPLEMENTATION, not by the caller. A handler
   * that trusted its own config would be trusting a jsonb row, and the row is
   * what a fan-out gone wrong would have edited.
   *
   * Returns COUNTS, never the guests: the rows created are the record, and a
   * list of 300 names in a step output would be a third copy of the guest list.
   *
   * Optional so a port predating the node fails closed rather than gaining the
   * ability to start hundreds of runs implicitly.
   */
  startRunsForGuests?(input: {
    parentRunId: string;
    nodeId: string;
    eventId: string;
    targetWorkflowId: string;
    statuses?: string[];
    requirePhone: boolean;
    maxGuests: number;
    /**
     * Which generation the children being created belong to — 1 for a fan-out
     * inside a run nobody fanned out to.
     *
     * Stamped onto each child's trigger payload so the fan-out inside THAT run
     * can refuse to create a deeper one. `workflow_runs` has no parent link, so
     * this is the only record of the chain. See `MAX_FANOUT_DEPTH`.
     */
    depth: number;
  }): Promise<
    | { ok: true; matched: number; started: number; capped: boolean }
    | { ok: false; reason: string }
  >;

  /**
   * Start the existing production RSVP voice agent for the contact that owns
   * this workflow run. Optional only so recording/test ports that predate the
   * node fail closed rather than gaining any network capability implicitly.
   */
  /**
   * Dial this run's contact with whichever configured voice agent the step
   * names.
   *
   * ⚠️ SEPARATE FROM `startRsvpAiCallback`, which is bound to the RSVP campaign
   * engine — a touchpoint, a campaign, a billing outcome. This one starts a
   * purpose from the `voice_purposes` registry, which is how a NEW agent
   * becomes usable without a new dispatcher.
   *
   * Optional, so a recording or test port that predates it fails closed rather
   * than gaining the ability to telephone people implicitly.
   */
  startVoicePurposeCall?(input: {
    runId: string;
    nodeId: string;
    eventId: string | null;
    contactId: string;
    purposeKey: string;
    /**
     * Per-node dial parameters, each one an OVERRIDE and each one optional.
     *
     * ⚠️ BLANK MEANS "AS BEFORE", never "none". An absent `ruleId` dials the
     * rule configured on the purpose; an absent `callerId` uses the account's
     * configured number; an absent `to` dials the contact's own phone. That is
     * what makes this field safe to add to a port every existing diagram
     * already calls — none of them carries these values, and none of them
     * changes behaviour.
     *
     * ⚠️ `to` IS NOT A PERMISSION TO DIAL ANYWHERE. The dispatcher still runs
     * every gate against the CONTACT — DNC, opt-out, consent, the replay guard
     * — because the contact is who the call is about. This only decides which
     * number that call is placed to, for the case where the contact's reachable
     * line is not the one on their row.
     */
    overrides?: {
      callerId?: string;
      ruleId?: string;
      to?: string;
      agentId?: string;
    };
  }): Promise<{
    ok: boolean;
    status: string;
    reason?: string;
    attemptId?: string;
    /**
     * When this call's access token expires — the CEILING for a step that waits
     * on the outcome, because the callback route refuses an expired token and a
     * longer park could never be woken. Absent when no attempt row was created.
     */
    tokenExpiresAt?: string;
  }>;

  /**
   * What the call this step placed ended up doing, read back from the attempt
   * row rather than from having been woken.
   *
   * ⚠️ THE READ IS THE POINT. A parked run is delivered by whichever arrives
   * first — the event-driven wake, the `resume_at` ceiling, or the recovery
   * sweep — and only the first says anything happened. A resume that assumed it
   * had been woken would report an outcome on a call that never reported, and
   * the timeout case would be indistinguishable from success.
   *
   * Optional for the same reason as the dialler above: a port that predates it
   * fails closed rather than silently answering "no outcome" for every call.
   */
  readVoicePurposeOutcome?(input: {
    runId: string;
    nodeId: string;
  }): Promise<{
    attemptId: string;
    dispatchStatus: string;
    finishReason: string | null;
    /** The scenario's own normalized verdict; null on rows predating it. */
    callStatus: string | null;
    callDurationSec: number | null;
  } | null>;

  startRsvpAiCallback?(input: {
    runId: string;
    nodeId: string;
    eventId: string;
    contactId: string;
  }): Promise<{
    ok: boolean;
    status: string;
    reason?: string;
    attemptId?: string;
    callSessionHistoryId?: number;
  }>;

  /**
   * Record an RSVP through the same atomic `submit_rsvp` gate the public form
   * uses. No RSVP rule is reimplemented in a workflow step.
   */
  submitRsvp(
    token: string,
    input: { status: RsvpStatus; adults: number; kids: number },
  ): Promise<{ ok: boolean; reason?: string }>;

  /** The activity-log entry, so an automated change is as auditable as a manual one. */
  recordRsvpFromWhatsapp(
    eventId: string,
    guestId: string,
    status: RsvpStatus,
  ): Promise<void>;

  /**
   * Write ONE field on the guest behind this run's contact.
   *
   * Naturally idempotent — the same value into the same column twice is the same
   * row — which is what makes it a legal action node under the lease rule at the
   * top of this file.
   *
   * `ok: false` with a reason is an ORDINARY answer, not a throw: the commonest
   * one is the shared-phone case below, where nothing went wrong and there was
   * simply nothing unambiguous to do.
   *
   * ריבוי-אורחים: a phone may back several guests, and "whose meal preference?"
   * has no answer. The implementation refuses rather than guessing — the same
   * rule `action.update_guest_status` and the inbound webhook already follow.
   */
  setGuestField?(input: {
    eventId: string;
    contactId: string;
    field: GuestField;
    value: string;
  }): Promise<{ ok: boolean; guestId?: string; reason?: string }>;

  /**
   * Put this guest in a human's callback queue.
   *
   * ⚠️ NOT IDEMPOTENT ON ITS OWN — a second row is a second phone call to a real
   * person, so the implementation MUST dedupe on an open request for the same
   * phone inside a window. That is the same guard `console-calls.ts` applies to
   * missed inbound calls, and it is the reason this is a port method rather than
   * an insert a handler could write itself.
   *
   * `created: false` is a success: it means an open request already covers this
   * guest. Reporting it as a failure would send a workflow down its error branch
   * for the system behaving correctly.
   */
  createCallbackRequest?(input: {
    eventId: string;
    contactId: string;
    topic: string;
    note: string;
  }): Promise<{ ok: boolean; created: boolean; reason?: string }>;

  /**
   * Reply to the guest who started this run, over WhatsApp.
   *
   * A FREE-TEXT session message, and that is only legal inside the 24-hour
   * customer-service window a guest opens by writing to us. Every workflow that
   * can reach this handler was started BY an inbound message, so the window is
   * open by construction — the guest wrote a moment ago. `sendWhatsAppText`'s
   * own comment states the rule: "allowed ONLY inside the 24h customer-service
   * window a guest opened by replying … No template, no marketing cap."
   *
   * That also settles the compliance question: this is a session reply to a
   * conversation the guest started, not a marketing send, so the 131049
   * per-user marketing cap does not apply and no separate consent is required
   * beyond the message they just sent us.
   *
   * The moment a scheduled trigger or a delay node exists, that reasoning stops
   * holding — a send hours later can fall outside the window and Meta answers
   * 131047. The outcome below is what makes that visible rather than silent.
   */
  sendWhatsAppReply(
    contactId: string,
    body: string,
  ): Promise<{ ok: boolean; reason?: string }>;
}

/**
 * An alert to the KALFA team — the one action whose audience is us, not a guest.
 *
 * A PORT rather than a direct `sendSlackAlert` call, and the reason is the rule
 * at the top of this file: everything downstream of it stays free of
 * `server-only`. `@/lib/alerts/slack` is server-only, reads a file, and builds a
 * Supabase admin client — importing it from a step handler pulled all three into
 * the module the WORKER bundles and the tests import, and every test that
 * touches a handler failed at import with "This module cannot be imported from a
 * Client Component module". Measured, not predicted: that is how this port came
 * to exist.
 *
 * The second reason is the dry run. Without a seam here, pressing "test" in the
 * editor would post a REAL message to the team's Slack channel — an outward
 * effect from a button whose entire promise is that it has none.
 *
 * `sent: false` is an ORDINARY answer, not a failure: alerts disabled, the
 * category switched off, a duplicate inside the dedup window, or the global
 * per-minute cap. None of those is a reason to fail a guest's run.
 */
export interface TeamAlertsPort {
  notifyTeam(input: {
    level: NotifyLevel;
    title: string;
    detail: string;
  }): Promise<{ sent: boolean }>;
}

/**
 * An outgoing HTTP call to a system that is not ours.
 *
 * The first action node whose effect leaves KALFA entirely, and the reasons it
 * is a PORT rather than a `fetch` in the handler are the same two that produced
 * `TeamAlertsPort` — plus one that is new and worse.
 *
 *   1. Layering. Everything downstream of this file stays free of `server-only`
 *      so handlers are unit-testable without a network.
 *   2. THE DRY RUN. Pressing "test" in the editor must have no outward effect.
 *      With a `fetch` in the handler, a test run would POST a guest's details to
 *      a third party from a button whose whole promise is that it does nothing.
 *   3. The SSRF surface is exactly one function. `validateWebhookUrl` runs in
 *      the implementation, not in the handler, so there is no path to the socket
 *      that skips it.
 *
 * ⚠️ IT CAN FIRE TWICE, AND WE CANNOT MAKE THE RECEIVER IDEMPOTENT.
 * `StepClaim`'s lease reclaims a `running` row whose side effect finished but
 * whose `completeStep` never landed — the documented cost of being able to
 * recover a crashed run at all. For a row we own that is harmless (`submit_rsvp`
 * setting the same status twice is the same row). For someone else's endpoint it
 * is a second POST, and only they can decide what that means.
 *
 * So the implementation sends `X-Kalfa-Idempotency-Key: <runId>:<nodeId>` —
 * deterministic, identical across replays of the same node in the same run — and
 * the node's help text says to key on it. That is the honest contract: we cannot
 * promise exactly-once, so we make at-least-once dedupable by the only party who
 * can act on it.
 *
 * `ok: false` is an ORDINARY answer (a non-2xx, a timeout, a refused URL), not a
 * throw. The handler turns it into the error port so a workflow can route around
 * a failing endpoint, which is the behaviour a branchable action node owes.
 */
export interface OutboundWebhookPort {
  post(input: {
    /** Already validated by the implementation; the handler never sees a socket. */
    url: string;
    /** Absent means POST — what every diagram saved before methods existed meant. */
    method?: HttpMethod;
    /**
     * Header rows as the owner typed them, values possibly still carrying
     * `{{secrets.<NAME>}}`. The IMPLEMENTATION substitutes them, never the
     * handler — so a secret is never in a value the handler could return.
     */
    headers?: HttpHeader[];
    body: string;
    /** Deterministic per (run, node). The receiver's dedup key. */
    idempotencyKey: string;
    /** Opt in to reading the answer back, capped. Off by default. */
    captureResponse?: boolean;
  }): Promise<{
    ok: boolean;
    status: number | null;
    reason?: string;
    /** Present only when `captureResponse` was asked for and bytes arrived. */
    body?: string;
    /** True when the answer was longer than the cap and was cut. */
    truncated?: boolean;
  }>;
}

/**
 * The execution event log — append-only, ordered, one row per emitted event.
 *
 * The vendored `runGraph` already emits exactly the events a live canvas replay
 * needs; until now we discarded them. This port is where they land.
 *
 * NOT the same thing as the step ledger, and the difference matters: the ledger
 * is a SET (one row per node, unique, claimed before the side effect) and this
 * is a LOG (a node appears more than once when a pg-boss retry replays the
 * graph). Folding them together would either break the uniqueness that stops a
 * second send, or lose the ordering the canvas replays from.
 *
 * Optional: a dry run has no rows to write, and execution must not depend on the
 * log being available — a failure to record an event is never a reason to fail a
 * run that is otherwise healthy.
 */
export interface ExecutionLogPort {
  appendEvent(args: {
    runId: string;
    type: string;
    nodeId?: string;
    payload?: unknown;
  }): Promise<void>;
}

export type IntegrationExecutionResult = {
  /** Provider HTTP status; internal to the executor, never a workflow output contract. */
  status: number;
};

export interface IntegrationsPort {
  execute(args: {
    /** Provider the node expects. Prevents a Microsoft node from using another provider's connection. */
    provider: string;
    connectionId: string;
    capability: string;
    input: unknown;
  }): Promise<IntegrationExecutionResult>;
}

/**
 * SUMIT's ACCOUNTING operations — creating a document, creating a customer.
 *
 * ⚠️ WHY THIS IS A PORT AND NOT A DIRECT IMPORT, which is the whole reason it
 * exists. `engine/dry-run.ts` states the rule: "a dry run is NOT a second
 * implementation… only the ports are swapped." A handler that imported
 * `src/lib/sumit/*` directly would therefore reach the LIVE provider from the
 * editor's "הרצת בדיקה" button — issuing a real document against the real
 * books, on a click whose own panel promises "לא נשלחת הודעה ולא משתנים
 * אורחים". Owner decision 2026-09-22: a test run must say what it WOULD do and
 * do nothing.
 *
 * ⚠️ AND WHY IT IS NOT `IntegrationsPort`. Four separate blockers, each fatal on
 * its own: `execute()` returns `{ status }` only and its own comment forbids
 * treating that as a workflow output contract (a document id could never come
 * back); `connectionId` is mandatory and SUMIT has no `integration_connections`
 * row; `CredentialPresentation` can place a credential in a header or a query
 * string and SUMIT authenticates inside the JSON BODY; and SUMIT's credentials
 * live in `app_settings`, not in the connection store.
 *
 * ⚠️ SCOPE IS DELIBERATE. Nothing here moves money. Authorize, capture and
 * credit are absent, so no workflow node can reach them through this port at
 * all — the node set that charges a card is a separate, separately-approved
 * piece of work with three open questions (see
 * plans/sumit-workflow-nodes-plan.md §2 stage 3).
 */
export interface AccountingPort {
  createDocument(input: {
    type: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    customerExternalId?: string;
    customerNoVat?: boolean;
    items?: { name: string; quantity: number; unitPrice: number }[];
    isDraft?: boolean;
    sendByEmail?: boolean;
    description?: string;
  }): Promise<{
    documentId: number;
    documentNumber: number | null;
    customerId: number | null;
    documentDownloadUrl: string | null;
  }>;

  createCustomer(input: {
    name: string;
    email?: string;
    phone?: string;
    city?: string;
    address?: string;
    companyNumber?: string;
    externalId?: string;
    noVat?: boolean;
  }): Promise<{ customerId: number; customerHistoryUrl: string | null }>;
}

/**
 * One headless Claude run, for `action.ai_agent`.
 *
 * ⚠️ THIS IS NOT A NEW AI PROVIDER, AND DELIBERATELY SO. The repo already runs
 * Claude headless for the fleet — `.claude/fleet/bin/run-role.sh` shells
 * `claude -p … --settings <tier file> --output-format json`, authenticating with
 * `CLAUDE_CODE_OAUTH_TOKEN` rather than an API key. MEASURED 2026-09-23: there
 * is no AI provider key anywhere in the environment, and `ai` / `@ai-sdk/openai`
 * are installed with ZERO imports in the entire codebase. Adding a second way to
 * reach a model would mean a second credential, a second permission model and a
 * second place to audit.
 *
 * ⚠️ WHICH TOOLS THE MODEL MAY USE IS A FILE, NOT AN ARGUMENT. The settings file
 * this port passes is the gate: `dontAsk` makes it fail-closed, `deny` always
 * beats `allow`, and a `PreToolUse` hook blocks before permission evaluation so
 * an allow rule cannot override it. That is three walls the fleet already
 * relies on, reused rather than reinvented.
 *
 * The port takes a PROMPT and returns TEXT. It does not know what a workflow is,
 * and the handler does not know how a model is reached — the same split every
 * other port here keeps.
 */
export interface AiAgentPort {
  run(input: {
    /** The system prompt, already `{{…}}`-resolved by the engine. */
    prompt: string;
    /** Model alias as the CLI spells it: `haiku`, `sonnet`. */
    model: string;
    /** Tool names this node declared. The settings file is what enforces them. */
    tools: readonly string[];
    /** Hard ceiling on agent turns, so a loop cannot run the clock out. */
    maxTurns: number;
  }): Promise<{
    /** What the model answered. Empty string is a legitimate answer. */
    text: string;
    /** Reported by `--output-format json`; null when the CLI did not give one. */
    costUsd: number | null;
    /** For correlating a run with the CLI's own trace. */
    sessionId: string | null;
  }>;
}

/**
 * One headless Claude run, for `action.ai_agent`.
 *
 * ⚠️ NOT A NEW AI PROVIDER, DELIBERATELY. This repo already runs Claude headless
 * for the fleet — `.claude/fleet/bin/run-role.sh` shells
 * `claude -p … --settings <tier file> --output-format json` and authenticates
 * with `CLAUDE_CODE_OAUTH_TOKEN`, not an API key. MEASURED 2026-09-23: there is
 * no AI provider key anywhere in the environment, and `ai` / `@ai-sdk/openai`
 * are installed with ZERO imports in the whole codebase. A second route to a
 * model would mean a second credential, a second permission model and a second
 * thing to audit.
 *
 * ⚠️ `tools` IS CARRIED BUT NOT YET HONOURED, and the field says so rather than
 * pretending. The node collects tool NAMES from the diagram; the live port drops
 * them, because the thing that would make them mean something — an MCP server
 * exposing KALFA capabilities, plus a settings file permitting exactly those —
 * does not exist yet. An earlier version of this port demanded such a file by an
 * env var that was never created anywhere, which made the node armable and
 * unrunnable. What the node does today is ask a model and return text.
 *
 * ⚠️ AND THAT IS WHY `action.ai_agent` IS ABSENT FROM `SECRET_BEARING_NODE_TYPES`.
 * A `{{secrets.…}}` reference only means something in a node whose PORT performs
 * the substitution before the socket (`action.webhook` is the only one). This
 * port reads its token from the environment itself, so the diagram never carries
 * a credential and there is nothing to defer.
 *
 * The port takes a prompt and returns text. It does not know what a workflow is,
 * and the handler does not know how a model is reached — the same split every
 * other port here keeps.
 */
export interface AiAgentPort {
  run(input: {
    /** The system prompt, already `{{…}}`-resolved by the engine. */
    prompt: string;
    /** Model alias as the CLI spells it: `haiku`, `sonnet`. */
    model: string;
    /** Tool names the node declared. The settings file is what enforces them. */
    tools: readonly string[];
    /** Hard ceiling on agent turns, so a loop cannot run the clock out. */
    maxTurns: number;
  }): Promise<{
    /** What the model answered. An empty string is a legitimate answer. */
    text: string;
    /** From `--output-format json`; null when the CLI reported none. */
    costUsd: number | null;
    /** For correlating a step with the CLI's own trace. */
    sessionId: string | null;
  }>;
}

export type WorkflowEngineDeps = {
  ledger: StepLedgerPort;
  runs: RunStorePort;
  guests: GuestActionsPort;
  /**
   * Required, not optional. An optional alerts port would mean a workflow
   * carrying `action.notify_team` runs to "completed" while the alert silently
   * goes nowhere — the exact failure that node exists to prevent.
   */
  alerts: TeamAlertsPort;
  /**
   * Required for the same reason `alerts` is: optional would mean a workflow
   * carrying `action.webhook` runs to "completed" while the call silently goes
   * nowhere. The dry run supplies a recording stub that makes no request.
   */
  webhook: OutboundWebhookPort;
  /** Integration side effects are resolved server-side from a stored connection. */
  integrations: IntegrationsPort;
  /**
   * Required, not optional — the same reasoning as `alerts` and `webhook`.
   * Optional would mean a workflow carrying a document node runs to "completed"
   * while the receipt silently never exists. The dry run supplies a recording
   * stub that issues nothing.
   */
  accounting: AccountingPort;
  /** One headless Claude run. See AiAgentPort. */
  ai: AiAgentPort;
  /** Omitted by the dry run, which returns its trace directly. */
  log?: ExecutionLogPort;
};
