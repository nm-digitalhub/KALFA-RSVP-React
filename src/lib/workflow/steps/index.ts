// One handler per node type, and the dispatch table the ActivityRunnerPort uses.
//
// A handler is a pure function of (config, trigger payload, deps). It performs
// its own side effect through the narrow GuestActionsPort and returns a
// NodeExecutionResult. It never claims its own ledger row — that happens one
// layer up, in activity-runner.ts, so the claim/side-effect ordering is written
// once rather than in every handler.
import { RSVP_STATUSES, type RsvpStatus } from '@/lib/constants';

import {
  ACTION_BRANCH_HANDLES,
  CONDITION_BRANCH_HANDLES,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  NOTIFY_LEVELS,
  SWITCH_CASE_COUNT,
  SWITCH_CASE_HANDLES,
  SWITCH_DEFAULT_HANDLE,
  type ConditionField,
  type ConditionOperator,
  type KalfaNodeType,
} from '../catalogue/types';

import type {
  GuestActionsPort,
  OutboundWebhookPort,
  TeamAlertsPort,
} from '../engine/ports';
import { PermanentNodeExecutionError } from '../vendor/workflowbuilder/execution-core/errors';
import type { NodeExecutionResult } from '../vendor/workflowbuilder/execution-core/ports/activity-runner.port';

// ---------------------------------------------------------------------------
// The trigger payload a run carries
// ---------------------------------------------------------------------------

// What the webhook drain hands a run. Narrow and explicit: the condition node's
// readable fields (CONDITION_FIELDS) are exactly the keys here, so the two
// cannot drift without a type error.
/**
 * What a run starts with, and — since the template resolver landed — the whole
 * of what `{{trigger.…}}` can name.
 *
 * The first four fields are the message. The last three are CONTEXT, added
 * 2026-09-10 because a resolver with nothing to resolve is not a feature: the
 * pipe was open and `{{trigger.message_text}}` was the only interesting thing
 * in it, so a personalised reply still could not say the guest's name.
 *
 * `guest_name` is a FIRST name, through `deriveGuestFirstName` — the same
 * derivation both WhatsApp send paths already use, so an automated greeting
 * reads exactly like a manual one, household rows included ("משפחת כהן" yields
 * nothing rather than greeting "שלום משפחת,").
 *
 * It is EMPTY when the phone backs more than one guest. That is the same
 * refusal `action.update_guest_status` makes, for the same reason: with several
 * guests behind one contact there is no answer to "whose name", and greeting
 * the wrong person by name is worse than not greeting at all.
 *
 * ON PII. These land in `workflow_runs.trigger_payload` and in the
 * `node_started` event payload. That store already holds `message_text` — the
 * guest's own words — so a first name and the event they were invited to add no
 * new CATEGORY of exposure. `redact.ts` is key-based and will not mask them, by
 * design: a workflow that cannot see a name cannot personalise a message, which
 * is the entire point of the field.
 */
export type WorkflowTriggerPayload = {
  eventId: string;
  contactId: string;
  message_text: string;
  button_payload: string;
  /**
   * The three below are OMITTED when unknown, never set to `''`, and the
   * difference is the whole behaviour of the fallback modifiers.
   *
   * `resolveTemplate` fires `?` and `| default:'…'` only when the resolved value
   * is strictly `undefined` — `''`, `null` and `0` are real values, which the
   * vendor's own suite pins (resolve-template.test.ts, "the modifier only fires
   * for undefined"). So normalising an unknown name to `''` did not merely lose
   * the name: it silently defeated the owner's own fallback. Someone writing
   *
   *     שלום {{trigger.guest_name | default:'אורח יקר'}}
   *
   * got `שלום ` — a sentence with a hole — because the empty string resolved.
   * Absent, the same template reads `שלום אורח יקר`.
   *
   * A strict `{{trigger.guest_name}}` now throws when the name is unknown, which
   * is the documented contract and the loud half of the same choice.
   */
  /** First name of the single linked guest. Absent when there is not exactly one. */
  guest_name?: string;
  event_name?: string;
  /** dd.MM.yyyy in Israel time — display-ready, never re-parsed. */
  event_date?: string;
};

export type StepContext = {
  runId: string;
  nodeId: string;
  trigger: WorkflowTriggerPayload;
  deps: { guests: GuestActionsPort; alerts: TeamAlertsPort; webhook: OutboundWebhookPort };
};

export type StepHandler = (
  config: Record<string, unknown>,
  ctx: StepContext,
) => Promise<NodeExecutionResult>;

// ---------------------------------------------------------------------------
// Config readers
// ---------------------------------------------------------------------------

// A node's config reached us through the editor and a jsonb column. The property
// SCHEMA constrains what the form can produce; it constrains nothing about what
// is in the row. These readers are the narrowing, and a bad value is a
// PermanentNodeExecutionError — it will fail identically on every retry, so the
// engine must not spend three attempts discovering that.
function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

function readEnum<T extends string>(
  config: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  nodeType: KalfaNodeType,
): T {
  const value = config[key];
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new PermanentNodeExecutionError(
    'invalid_config',
    `הצעד "${nodeType}" הוגדר עם ערך לא חוקי בשדה "${key}".`,
  );
}

// ---------------------------------------------------------------------------
// trigger.whatsapp_inbound
// ---------------------------------------------------------------------------

// The entry node. It performs no side effect: by the time a run exists the
// message has already arrived and been persisted. Its job is to publish the
// payload as this node's output, so the rest of the graph reads it the same way
// it reads any other node's result.
//
// The `keyword` filter is applied at ENQUEUE time, not here — a run that should
// not have started must not exist at all, rather than start and immediately stop
// (which would leave a run row implying something happened). See
// matchesTrigger in ../trigger.ts.
const whatsappInbound: StepHandler = async (_config, ctx) => ({
  output: {
    message_text: ctx.trigger.message_text,
    button_payload: ctx.trigger.button_payload,
  },
});

// ---------------------------------------------------------------------------
// logic.condition
// ---------------------------------------------------------------------------

/**
 * Compare two already-resolved strings.
 *
 * Takes the LEFT-HAND VALUE, not a field name. That is the whole opening: the
 * left side used to be an index into the trigger payload, so a condition could
 * only ever ask about the inbound message. Now `resolveConfigTemplates` has
 * already turned `{{nodes.<id>.value}}` — or any other reference — into text by
 * the time this runs, and this function no longer knows or cares where the
 * string came from.
 */
export function compareValues(
  actual: string,
  operator: ConditionOperator,
  operand: string,
): boolean {
  // Case-insensitive throughout. Hebrew has no case, but a keyword may be Latin
  // ("YES", "ok") and an owner typing one should not have to match the guest's
  // shift key.
  const a = actual.trim().toLowerCase();
  const b = operand.trim().toLowerCase();
  switch (operator) {
    case 'contains':
      // An empty needle would match everything, which is never what an owner
      // who left the box blank meant.
      return b !== '' && a.includes(b);
    case 'not_contains':
      return b === '' || !a.includes(b);
    case 'equals':
      return a === b;
    case 'not_equals':
      return a !== b;
    case 'starts_with':
      return b !== '' && a.startsWith(b);
    case 'ends_with':
      return b !== '' && a.endsWith(b);
    case 'is_empty':
      return a === '';
    case 'is_not_empty':
      return a !== '';
  }
}

/**
 * @deprecated Kept because it is the shape the pre-`left` diagrams evaluate
 * under, and because `dry-run`'s trace and two test files name it. Reads a field
 * off the trigger payload and defers to {@link compareValues}.
 */
export function evaluateCondition(
  field: ConditionField,
  operator: ConditionOperator,
  operand: string,
  trigger: WorkflowTriggerPayload,
): boolean {
  return compareValues(trigger[field] ?? '', operator, operand);
}

// Branches by naming a port. `isEdgeLive` in the runner fires the outgoing edge
// whose `sourceHandle` matches — by `===`, with no normalisation on either side —
// and prunes the rest.
//
// CORRECTED 2026-09-09. This returned 'true' / 'false', and the comment here
// asserted that "the editor's two branches must be drawn with handles 'true' and
// 'false'" as though that were arrangeable. It was not: those strings are not
// handle ids and the editor could never emit one. A node drawn from the palette
// carried a single source handle spelled 'source', so BOTH outgoing edges
// matched neither port, every condition pruned both branches, and the run ended
// `execution_incomplete` with a DeadEnd. The unit tests hand-built their edges
// with `sourceHandle: 'true'` and so agreed with the comment rather than with
// the editor — which is why tsc, eslint, the suite and the build all passed over
// a node type that could not work.
//
// The ports are now `CONDITION_BRANCH_HANDLES`, the same ids the palette seeds
// into `decisionBranches` and the SDK's decision renderer puts on the handles.
//
// Naming a port is still a promise of a live route: if no edge carries that
// handle the run ends `incomplete` with a DeadEnd naming this node. That is the
// intended reading — a condition wired to only one branch genuinely has a dead
// end on the other — and it surfaces to the owner instead of passing silently.

const condition: StepHandler = async (config, ctx) => {
  const operator = readEnum(config, 'operator', CONDITION_OPERATORS, 'logic.condition');
  const operand = readString(config, 'value');

  // `left` arrives ALREADY RESOLVED — `resolveConfigTemplates` walked the whole
  // config before this handler was called — so an owner comparing
  // `{{nodes.<id>.value}}` gets the computed text here, not the reference.
  //
  // Falling back to `field` rather than requiring `left` is what keeps every
  // diagram saved before this working unchanged: those carry a field name and no
  // left-hand expression, and they must keep evaluating identically.
  const left = readString(config, 'left').trim();
  const actual =
    left === ''
      ? (ctx.trigger[readEnum(config, 'field', CONDITION_FIELDS, 'logic.condition')] ?? '')
      : left;

  const result = compareValues(actual, operator, operand);
  return {
    output: { result },
    nextPort: result ? CONDITION_BRANCH_HANDLES.true : CONDITION_BRANCH_HANDLES.false,
  };
};

// ---------------------------------------------------------------------------
// logic.switch
// ---------------------------------------------------------------------------

// Route one value to one of three named cases, or to the default.
//
// WHAT IT ADDS OVER `logic.condition`, which is not "more branches". A condition
// names one of two ports and BOTH of them mean "the test" — so "none of the
// above" has to be modelled as false, and a three-way answer needs two chained
// conditions whose second one re-reads a value the first already looked at. Here
// the unmatched route is its own port, so the shape on the canvas is the shape
// of the decision.
//
// Comparison is `compareValues(..., 'equals', ...)` and not a new rule: the same
// case-insensitive, trimmed equality every condition already uses. An owner who
// learns one learns both, and a value that routes to case 2 here would have
// satisfied `equals` there.
//
// FIRST MATCH WINS, and the order is the order on the canvas — case 1 before
// case 2 before case 3. Two cases with the same text is not an error; the second
// is simply unreachable, which is visible on the node rather than hidden in a
// validation message.
const switchNode: StepHandler = async (config) => {
  // Already resolved: `resolveConfigTemplates` walked the whole config before
  // this ran, so `left` is the computed text and not `{{trigger.…}}`.
  const actual = readString(config, 'left');

  for (let i = 0; i < SWITCH_CASE_COUNT; i++) {
    const candidate = readString(config, `case${i + 1}`).trim();
    // EMPTY IS AN UNUSED BRANCH, not a match against the empty string. Without
    // this, a switch with one case filled in would send every empty value to
    // case 2 and the default could never be reached.
    if (candidate === '') continue;
    if (compareValues(actual, 'equals', candidate)) {
      return {
        output: { matched: true, case: i + 1, value: actual },
        nextPort: SWITCH_CASE_HANDLES[i],
      };
    }
  }

  return {
    output: { matched: false, case: null, value: actual },
    nextPort: SWITCH_DEFAULT_HANDLE,
  };
};

// ---------------------------------------------------------------------------
// action.update_guest_status
// ---------------------------------------------------------------------------

// The first real side effect, and deliberately one that sends nothing outward:
// it changes a row we own. `send_whatsapp` is the next node, once this chain is
// proven end to end.
const updateGuestStatus: StepHandler = async (config, ctx) => {
  // `rsvpStatus` first, `status` second. The key was renamed when the SDK's own
  // node-lifecycle `status` — Active / Draft / Disabled — moved into the same
  // properties object; every diagram saved before that carries the old name and
  // has to keep working untouched.
  const status: RsvpStatus = readEnum(
    'rsvpStatus' in config ? config : { ...config, rsvpStatus: config.status },
    'rsvpStatus',
    RSVP_STATUSES,
    'action.update_guest_status',
  );

  const guests = await ctx.deps.guests.getGuestsForContact(
    ctx.trigger.eventId,
    ctx.trigger.contactId,
  );

  // ריבוי-אורחים: a phone may back several guests, and "who did this message
  // mean?" has no answer. The inbound webhook refuses to guess (C9 in
  // webhook-processing.ts) and so does this: the same rule, because it is a rule
  // about shared phones, not about which code path arrived at it. Reported as a
  // completed step with `skipped: true` rather than a failure — nothing went
  // wrong, there was simply nothing unambiguous to do.
  if (guests.length !== 1) {
    return {
      output: {
        skipped: true,
        reason: guests.length === 0 ? 'no_guest_for_contact' : 'ambiguous_contact',
        guestCount: guests.length,
      },
    };
  }

  const guest = guests[0]!;

  // Through submit_rsvp, the same atomic gate the public form uses — it enforces
  // token validity, event status and revocation. `attending` requires at least
  // one attendee (the RPC rejects zero), so it defaults to a single adult and
  // the guest refines the count via their link; declined/maybe carry none.
  const outcome = await ctx.deps.guests.submitRsvp(guest.rsvp_token, {
    status,
    adults: status === 'attending' ? 1 : 0,
    kids: 0,
  });

  if (!outcome.ok) {
    // A refused RSVP is a real failure of this step — the owner drew a graph
    // that promised to set a status and it did not get set. Permanent: a
    // revoked token or a closed event will refuse every retry identically.
    throw new PermanentNodeExecutionError(
      'rsvp_rejected',
      `עדכון סטטוס האורח נדחה (${outcome.reason ?? 'לא ידוע'}).`,
    );
  }

  await ctx.deps.guests.recordRsvpFromWhatsapp(ctx.trigger.eventId, guest.id, status);

  return { output: { guestId: guest.id, status } };
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// Total over KalfaNodeType: adding a type to the catalogue without a handler is
// a compile error, not a run-time surprise.
// ---------------------------------------------------------------------------
// action.start_rsvp_ai_callback
// ---------------------------------------------------------------------------

const startRsvpAiCallback: StepHandler = async (_config, ctx) => {
  const dispatch = ctx.deps.guests.startRsvpAiCallback;
  if (!dispatch) {
    throw new PermanentNodeExecutionError(
      'voice_agent_not_wired',
      'צומת סוכן הקול אינו מחובר למימוש השרת.',
    );
  }

  const outcome = await dispatch({
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    eventId: ctx.trigger.eventId,
    contactId: ctx.trigger.contactId,
  });

  if (!outcome.ok) {
    throw new PermanentNodeExecutionError(
      'voice_agent_dispatch_refused',
      `הפעלת שיחת הסוכן נדחתה (${outcome.reason ?? outcome.status}).`,
    );
  }

  return {
    output: {
      started: true,
      status: outcome.status,
      ...(outcome.attemptId ? { attemptId: outcome.attemptId } : {}),
      ...(outcome.callSessionHistoryId !== undefined
        ? { callSessionHistoryId: outcome.callSessionHistoryId }
        : {}),
    },
  };
};

// ---------------------------------------------------------------------------
// action.send_whatsapp
// ---------------------------------------------------------------------------

// The first step that speaks to a guest, and the first whose failure is visible
// to someone outside this system.
//
// THE RECIPIENT IS NOT CONFIGURABLE. It is `ctx.trigger.contactId` — the
// contact whose message started this run. There is no "to" field on the node
// and there is deliberately no way to add one: an automation that could name
// its own recipient is a broadcast tool, and the consent story for a broadcast
// is nothing like the one for a reply.
//
// WHY A FREE-TEXT SEND IS LEGAL HERE. Meta allows a non-template message only
// inside the 24-hour customer-service window a guest opens by writing to us.
// Every path into this handler begins at `trigger.whatsapp_inbound`, so the
// guest wrote moments ago and the window is open by construction. That is also
// why 131049 — the per-user MARKETING cap — does not apply: this is a session
// reply inside a conversation the guest started.
//
// The reasoning is load-bearing and it is tied to the trigger, not to this
// node. A scheduled trigger or a delay step would break it, and the send would
// come back 131047 ("re-engagement required"). When either lands, this handler
// needs a template fallback — not a comment.
//
// A refusal is a COMPLETED step with `skipped: true`, matching
// `action.update_guest_status`: nothing went wrong in the graph, the message
// simply had nowhere to go, and the run log says which of the three reasons it
// was.
const sendWhatsapp: StepHandler = async (config, ctx) => {
  const body = readString(config, 'body').trim();
  if (body === '') {
    return { output: { skipped: true, reason: 'empty_body' } };
  }

  const outcome = await ctx.deps.guests.sendWhatsAppReply(ctx.trigger.contactId, body);
  if (!outcome.ok) {
    return { output: { skipped: true, reason: outcome.reason ?? 'send_failed' } };
  }

  // The body is NOT echoed into the output. Step outputs land in
  // `workflow_run_events`, which is append-only and read by the SSE stream —
  // the message text is already in the node's own config, and copying it into
  // the event log would duplicate guest-facing content into a second store for
  // no gain.
  return { output: { sent: true, length: body.length } };
};

// ---------------------------------------------------------------------------
// action.notify_team
// ---------------------------------------------------------------------------

// The only action pointed INWARD. It crosses `TeamAlertsPort` rather than calling
// the Slack module directly — see that port's comment for the two reasons
// (`server-only` leaking into the worker bundle, and a dry run posting for real).
//
// The implementation behind the port is already fail-soft, deduped and
// rate-limited, so a workflow firing on every inbound message cannot flood the
// channel: the same title within the dedup window is suppressed by the alert
// layer, not by anything here.
//
// `detail` passes through the template resolver like every other field, so an
// alert can quote the guest. That is a deliberate widening of what reaches
// Slack: the channel is staff-only and already carries `workflow run failed`
// details, but an owner writing `{{trigger.message_text}}` here is choosing to
// put a guest's words there. Worth knowing; not worth forbidding.
const notifyTeam: StepHandler = async (config, ctx) => {
  // The schema marks `title` required, so the FORM will not let an owner leave
  // it blank. That constrains the form, not the row: a diagram saved before the
  // field existed, or one arriving through the import modal, can still carry an
  // empty title — and the SDK's validation plugin, which would catch it on the
  // canvas, is Enterprise and not licensed here. An alert with no title tells a
  // reader nothing, so it is skipped rather than sent as a blank line.
  const title = readString(config, 'title').trim();
  if (title === '') {
    return { output: { skipped: true, reason: 'empty_title' } };
  }

  const { sent } = await ctx.deps.alerts.notifyTeam({
    level: readEnum(config, 'level', NOTIFY_LEVELS, 'action.notify_team'),
    title,
    detail: readString(config, 'detail'),
  });

  // `sent: false` is an ordinary answer, not a failure — alerts disabled, the
  // category switched off, a duplicate inside the dedup window, or the global
  // per-minute cap. None of those is a reason to fail a guest's run, and the
  // reason is on the output so the log says which happened.
  return sent
    ? { output: { sent: true } }
    : { output: { sent: false, skipped: true, reason: 'alert_suppressed' } };
};

// ---------------------------------------------------------------------------
// action.webhook
// ---------------------------------------------------------------------------

// POST to a system that is not ours.
//
// The handler is deliberately thin: it reads two fields, builds the dedup key,
// and hands everything to the port. Every security decision — https, no private
// space, no redirect following, the timeout, the capped response — lives in the
// implementation behind that port, so there is no path from here to a socket
// that skips them.
//
// THE DEDUP KEY IS `<runId>:<nodeId>`, and the choice matters. It is the same on
// every replay of this node in this run, which is exactly the case the step
// lease can produce: a POST that completed but whose `completeStep` never landed
// gets sent again, and the receiver can recognise it. It is DIFFERENT for the
// same node in a different run, so two genuine messages from two guests are two
// calls and not one deduplicated away.
//
// A failure is an ANSWER, not a throw: it routes to the error branch so a
// workflow can carry on — notify the team, try a second endpoint — instead of
// ending `failed` because someone else's server was down.
const webhook: StepHandler = async (config, ctx) => {
  const url = readString(config, 'url').trim();
  // Already resolved: `resolveConfigTemplates` walked the config first, so this
  // is the rendered body and not `{{trigger.…}}`.
  const body = readString(config, 'body');

  const result = await ctx.deps.webhook.post({
    url,
    body,
    idempotencyKey: `${ctx.runId}:${ctx.nodeId}`,
  });

  // The URL is NOT in the output. It is already on the node in the editor, and
  // repeating it in the run log would copy a path segment — the one place this
  // node can legitimately carry a secret — into a second store.
  return result.ok
    ? { output: { ok: true, status: result.status } }
    : {
        output: { ok: false, status: result.status, reason: result.reason ?? null },
        nextPort: ACTION_BRANCH_HANDLES.error,
      };
};

// ---------------------------------------------------------------------------
// logic.set_value
// ---------------------------------------------------------------------------

// No I/O, and that is the feature.
//
// The value arrives here ALREADY RESOLVED — `resolveConfigTemplates` ran over
// the whole config before this handler was called — so this returns it as an
// output and downstream nodes read it as `{{nodes.<id>.value}}`.
//
// One line of code for a real composition primitive: define a greeting once and
// use it in every branch, instead of repeating the same expression in three
// message bodies and fixing a typo in two of them.
const setValue: StepHandler = async (config) => ({
  output: { value: readString(config, 'value') },
});

export const STEP_HANDLERS: Record<KalfaNodeType, StepHandler> = {
  'trigger.whatsapp_inbound': whatsappInbound,
  'logic.condition': condition,
  'logic.switch': switchNode,
  'action.update_guest_status': updateGuestStatus,
  'action.send_whatsapp': sendWhatsapp,
  'action.start_rsvp_ai_callback': startRsvpAiCallback,
  'action.notify_team': notifyTeam,
  'action.webhook': webhook,
  'logic.set_value': setValue,
};
