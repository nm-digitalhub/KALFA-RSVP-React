// The dispatch table the ActivityRunnerPort uses, and the handlers of the node
// types that have not yet moved to `nodes/<name>/runtime.ts`.
//
// A handler is a pure function of (config, trigger payload, deps). It performs
// its own side effect through the narrow GuestActionsPort and returns a
// NodeExecutionResult. It never claims its own ledger row — that happens one
// layer up, in activity-runner.ts, so the claim/side-effect ordering is written
// once rather than in every handler.
import { RSVP_STATUSES, type RsvpStatus } from '@/lib/constants';
import { SUMIT_HOLDS_FOLDER_ID, sumitHoldCurrencyLabel, sumitHoldStatusLabel } from '@/lib/sumit/hold-status';
import { readIntegrationRuntimeError } from '@/lib/integrations/errors';

import { toBusinessOutcome } from '../voice-outcome';

import {
  ACTION_BRANCH_HANDLES,
  CONDITION_BRANCH_HANDLES,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  GUEST_FIELDS,
  CALLBACK_TOPICS,
  HTTP_METHODS,
  LEGACY_PROPERTY_ALIASES,
  MAX_FANOUT_DEPTH,
  type HttpHeader,
  NOTIFY_LEVELS,
  SALES_CALLBACK_TOPIC,
  SWITCH_DEFAULT_BRANCH_ID,
  SWITCH_DEFAULT_HANDLE,
  type SwitchBranch,
  type SwitchCondition,
  type ConditionField,
  type ConditionOperator,
  type KalfaNodeType,
  type MicrosoftMailContentType,
  type MicrosoftMailImportance,
  SUMIT_DOCUMENT_TYPES,
  AI_AGENT_MAX_TURNS,
  AI_AGENT_MODELS,
} from '../catalogue/types';

import {
  PermanentNodeExecutionError,
  TransientNodeExecutionError,
} from '../vendor/workflowbuilder/execution-core/errors';

// The shared step contract lives in ./shared so node runtimes can import it
// without importing this registry. Re-exported for every existing caller.
import {
  readEnum,
  readString,
  requireGuestContext,
  type StepContext,
  type StepHandler,
  type WorkflowTriggerPayload,
} from './shared';
import { WorkflowWaitSignal } from '../engine/wait-signal';
import * as setValueDefinition from '../nodes/logic-set-value/definition';
import { setValue } from '../nodes/logic-set-value/runtime';

export type { StepContext, StepHandler, WorkflowTriggerPayload };

// ---------------------------------------------------------------------------
// trigger.webhook
// ---------------------------------------------------------------------------

// An external system calls in and a run starts.
//
// The DYNAMIC trigger: it declares no field list. Whatever JSON the caller sent
// is published as this node's output and is readable anywhere as
// `{{trigger.body.<path>}}`. A new caller with a different shape needs no code
// change, no migration and no new node type — which is the difference between
// this and every other trigger a workflow tool hard-codes.
//
// It performs no side effect. By the time a run exists the request has already
// been received, authenticated by its token and persisted as the trigger payload.
const webhookTrigger: StepHandler = async (_config, ctx) => ({
  output: {
    body: ctx.trigger.body ?? {},
    // ⚠️ PUBLISHED SEPARATELY, AND IT HAS TO BE RETURNED HERE TOO. The query
    // string was added to the trigger payload and to this node's outputSchema on
    // 2026-09-22 — but not to this return, so `{{nodes.<trigger>.query.x}}`
    // resolved to nothing while the picker happily offered it. A declaration is
    // a promise the HANDLER keeps; declaring without returning is the same class
    // of defect as returning without declaring, and the same gate now catches
    // both.
    query: ctx.trigger.query ?? {},
  },
});

// ---------------------------------------------------------------------------
// trigger.sumit_card
// ---------------------------------------------------------------------------

// SUMIT's trigger module told us a card changed. Like every trigger it performs
// no side effect — it publishes what arrived, under names a later step can pick.
//
// The shape is SUMIT's own, as its "פעולות אוטומציה" log shows it:
//
//   { "Folder": 440486517, "EntityID": 632049688, "Type": "CreateOrUpdate",
//     "Properties": { "Billing_Amount": [11.8], "Billing_PaymentSource":
//       [{ "Version": 1, "Status": 0, "SchemaID": …, "ID": …, "Name": "…" }], … } }
//
// Every property is an ARRAY. REFERENCE properties hold objects with a `Name`;
// ENUM properties hold the bare code — measured on this account's live
// releases, `Billing_Status: [3]`, `Billing_Currency: [1]`. Which properties
// arrive is decided by the columns of the VIEW the owner chose in SUMIT. `resolveTemplate` walks a dotted path through arrays as
// well as objects, so `{{nodes.<id>.properties.Billing_Amount.0}}` reaches the
// first element with no flattening of ours.
//
// ⚠️ `null`, NEVER `undefined`, FOR ANYTHING MISSING. A plain `{{…}}` reference
// THROWS on `undefined` and resolves `null` to the text "null" — so a body with a
// field absent cannot fail every step that quotes it. The payload is UNSIGNED,
// which is also why nothing here trusts its types: whatever is not the expected
// shape becomes null rather than a crash.
const sumitCardTrigger: StepHandler = async (_config, ctx) => {
  const body = ctx.trigger.body ?? {};
  const scalar = (value: unknown): string | number | null =>
    typeof value === 'string' || typeof value === 'number' ? value : null;
  const rawProperties = body.Properties;
  // NAMES for the enum codes SUMIT sends bare — only for the frame-holds folder,
  // whose codes we have evidence for; the same `Billing_*` code may mean
  // something else in another folder. `null` otherwise (see the rule above).
  const holdProperties =
    Number(body.Folder) === SUMIT_HOLDS_FOLDER_ID && rawProperties && typeof rawProperties === 'object'
      ? (rawProperties as { Billing_Status?: unknown[]; Billing_Currency?: unknown[] })
      : null;

  return {
    output: {
      folder: scalar(body.Folder),
      entityId: scalar(body.EntityID),
      changeType: typeof body.Type === 'string' ? body.Type : null,
      properties:
        rawProperties && typeof rawProperties === 'object' && !Array.isArray(rawProperties)
          ? rawProperties
          : {},
      // The whole of it as well, for a field this node does not name.
      body,
      holdStatus: holdProperties ? sumitHoldStatusLabel(holdProperties.Billing_Status?.[0]) : null,
      holdCurrency: holdProperties ? sumitHoldCurrencyLabel(holdProperties.Billing_Currency?.[0]) : null,
    },
  };
};

// ---------------------------------------------------------------------------
// trigger.schedule
// ---------------------------------------------------------------------------

// The clock's entry node. Like the other triggers it performs no side effect —
// the decision that this moment matched was made at PLAN time (`schedule.ts`),
// because a run that should not have started must not exist rather than start
// and immediately stop. By the time this executes, the answer was yes.
//
// It publishes the slot it fired for, so a later step can name it
// (`{{nodes.<id>.firedAt}}`) — the one fact a scheduled run knows about itself.
const scheduleTrigger: StepHandler = async (_config, ctx) => ({
  output: { firedAt: (ctx.trigger.body as { firedAt?: unknown } | undefined)?.firedAt ?? null },
});

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

// N named branches, each with its own conditions — the SDK's `DecisionBranches`
// shape, evaluated here.
//
// REBUILT 2026-09-13. The first version hard-coded three cases plus a default,
// on the reasoning that "the WORKER would have to discover the port list from
// the diagram". It does discover it — from the branch the conditions selected —
// and that is not a hazard, it is how a dynamic switch has to work. The SDK
// ships the composer; the ceiling was mine.
//
// FIRST MATCH WINS, top to bottom, which is the order the owner sees on the
// canvas. A branch with no conditions never matches (it would otherwise swallow
// everything below it); the DEFAULT branch is selected by ELIMINATION, not by a
// condition, which is why it needs none.
//
// Both sides of every row arrive ALREADY RESOLVED — `resolveConfigTemplates`
// walked the whole config first — so `x` and `y` can each be a literal, a
// `{{trigger.…}}` or a `{{nodes.…}}`, and this function never knows which.

function readBranches(config: Record<string, unknown>): SwitchBranch[] {
  const raw = config.decisionBranches;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is SwitchBranch =>
      typeof b === 'object' && b !== null && typeof (b as SwitchBranch).sourceHandle === 'string',
  );
}

/** One row. The operator set is the SDK's own; nothing else is accepted. */
export function evaluateSwitchCondition(row: SwitchCondition): boolean {
  const x = typeof row.x === 'string' ? row.x.trim() : '';
  const y = typeof row.y === 'string' ? row.y.trim() : '';
  const lower = (v: string) => v.toLowerCase();

  switch (row.comparisonOperator) {
    case 'isEqual':
      return lower(x) === lower(y);
    case 'isNotEqual':
      return lower(x) !== lower(y);
    case 'isContaining':
      return lower(x).includes(lower(y));
    case 'isNotContaining':
      return !lower(x).includes(lower(y));
    // Numeric comparisons on non-numbers are FALSE rather than NaN-propagating:
    // an owner comparing text with `isGreaterThan` gets "no" and takes the
    // default, instead of a branch chosen by an accident of coercion.
    case 'isGreaterThan':
    case 'isLessThan':
    case 'isGreaterThanOrEqual':
    case 'isLessThanOrEqual': {
      const a = Number(x);
      const b = Number(y);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (row.comparisonOperator === 'isGreaterThan') return a > b;
      if (row.comparisonOperator === 'isLessThan') return a < b;
      if (row.comparisonOperator === 'isGreaterThanOrEqual') return a >= b;
      return a <= b;
    }
    // Dates. Same rule: unparseable is FALSE, never a coin flip.
    case 'isBefore':
    case 'isAfter': {
      const a = Date.parse(x);
      const b = Date.parse(y);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return row.comparisonOperator === 'isBefore' ? a < b : a > b;
    }
    default:
      return false;
  }
}

/**
 * The rows of ONE branch, joined by a SINGLE operator read off `conditions[0]`.
 *
 * ⚠️ NOT a per-row fold, and the first version here was wrong about this.
 *
 * MEASURED in the shipped control (`dist/index-CEBfv0NZ.js`): the AND/OR picker
 * is rendered with `shouldShowOperator: index === 0 && lastIndex !== 0` — so it
 * appears on the FIRST row only, and only once a second row exists. Its onChange
 * writes `logicalOperator` to that row alone; adding a row appends the module
 * default `{ …, logicalOperator: 'AND' }`, and no code path back-fills the
 * choice onto siblings. Rows 1..n therefore carry a stale `'AND'` FOREVER,
 * whatever the owner picked.
 *
 * So there is one operator per branch, not one per join, and the control says as
 * much in words: its two labels are `conditions.compare.all` ("all") and
 * `conditions.compare.one` ("one"). A fold over each row's own field would have
 * read 'AND' from row 2 and quietly ANDed a branch the owner set to OR — a
 * misroute with nothing on screen to explain it.
 *
 * ALL → every row must hold. ONE → any row is enough.
 */
export function evaluateSwitchBranch(conditions: SwitchCondition[] | undefined): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return false;

  // `?? 'AND'` is the control's own default, for a row saved before the picker
  // was ever touched.
  const join = conditions[0]?.logicalOperator ?? 'AND';
  return join === 'OR'
    ? conditions.some(evaluateSwitchCondition)
    : conditions.every(evaluateSwitchCondition);
}

const switchNode: StepHandler = async (config) => {
  const branches = readBranches(config);

  for (const branch of branches) {
    // The default is chosen by elimination below, never by evaluation — it has
    // no conditions and must not be skipped past by an empty-conditions rule.
    if (branch.id === SWITCH_DEFAULT_BRANCH_ID) continue;
    if (evaluateSwitchBranch(branch.conditions)) {
      return {
        output: { matched: true, branch: branch.label ?? branch.id },
        nextPort: branch.sourceHandle,
      };
    }
  }

  // The declared default if the owner kept it, otherwise the reserved handle —
  // so a diagram whose default branch was deleted still names a port rather
  // than dead-ending with no explanation.
  const fallback =
    branches.find((b) => b.id === SWITCH_DEFAULT_BRANCH_ID)?.sourceHandle ??
    SWITCH_DEFAULT_HANDLE;

  return { output: { matched: false, branch: null }, nextPort: fallback };
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
    'rsvpStatus' in config
      ? config
      : { ...config, rsvpStatus: config[LEGACY_PROPERTY_ALIASES.rsvpStatus!] },
    'rsvpStatus',
    RSVP_STATUSES,
    'action.update_guest_status',
  );

  const { eventId, contactId } = requireGuestContext(ctx, 'action.update_guest_status');
  const guests = await ctx.deps.guests.getGuestsForContact(eventId, contactId);

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

  await ctx.deps.guests.recordRsvpFromWhatsapp(eventId, guest.id, status);

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

// Dial this run's guest with a configured voice agent.
//
// ⚠️ WHY THIS EXISTS ALONGSIDE `action.start_rsvp_ai_callback`. That node is
// bound to ONE agent — the RSVP campaign engine's — and adding a second agent
// used to mean a second node, a second dispatcher and a migration. This one
// names a row in `voice_purposes`, so an owner who has built an agent on
// ElevenLabs and a rule on Voximplant can use it from a workflow without any
// code at all.
//
// ⚠️ A REFUSAL IS A COMPLETED STEP, NOT THE ERROR BRANCH. An agent switched off,
// a guest on the DNC list, a dial outside the permitted hours, Shabbat — in each
// of those the rules worked exactly as written. Routing them to a failure path
// would send a workflow down an error route because the system behaved
// correctly. Only a misconfigured STEP throws.
/**
 * Statuses that mean the attempt will never report anything further.
 *
 * A LITERAL and not an import: the canonical list is `PURPOSE_SETTLED` in
 * `@/lib/data/voice-purpose-attempts`, which begins with `import 'server-only'`,
 * and this module is the engine — it is bundled into the worker and exercised by
 * tests that hold no Supabase client.
 *
 * Kept in step with that file BEHAVIOURALLY, in `voice-call-wait.test.ts`: one
 * case proves 'concluded' and 'failed' do not park, another proves 'unknown'
 * does. A value that drifts between the two lists changes one of those answers.
 *
 * `unknown` is deliberately absent, in both places. It is written when
 * `StartScenarios` gave an answer we could not classify, so the call may well be
 * ringing and its scenario still holds a valid token. Treating it as finished
 * would discard exactly the outcome a waiting step wants most.
 */
const PURPOSE_SETTLED: readonly string[] = ['concluded', 'failed'];

/**
 * The outcome of a call, shaped for the graph.
 *
 * `concluded` is the field a condition node downstream will branch on, and it
 * answers one question only: did the call end AND report? A timeout, an
 * ambiguous start and a call still running all read false — they are different
 * reasons, carried in `finishReason`, but none of them is an outcome.
 */
function voiceOutcomeOutput(
  attemptId: string,
  o: {
    dispatchStatus: string;
    finishReason: string | null;
    callStatus?: string | null;
    callDurationSec: number | null;
  } | null,
) {
  return {
    dialed: true,
    // ⚠️ `outcome` IS THE FIELD A BRANCH SHOULD TEST. The three below it are the
    // telephony's own words — `sip_486`, `Normal termination`, a status the
    // dispatcher chose — and asking an owner to write a condition against those
    // is asking them to know that 486 is Busy Here. They stay because a person
    // debugging a call wants them; they are not what a diagram should read.
    outcome: toBusinessOutcome({
      dispatchStatus: o?.dispatchStatus,
      finishReason: o?.finishReason,
      // The scenario's own verdict, which outranks the reason string — see
      // toBusinessOutcome. Absent on rows recorded before 2026-09-15.
      callStatus: o?.callStatus,
    }),
    status: o?.dispatchStatus ?? 'unknown',
    concluded: o?.dispatchStatus === 'concluded',
    attemptId,
    ...(o?.finishReason ? { finishReason: o.finishReason } : {}),
    ...(o?.callDurationSec != null ? { durationSec: o.callDurationSec } : {}),
  };
}

const startVoiceCall: StepHandler = async (config, ctx) => {
  const purposeKey = readString(config, 'purposeKey').trim();
  if (purposeKey === '') {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "שיחה עם סוכן קולי" לא הוגדר עם ייעוד.',
    );
  }

  const waitForOutcome = config.waitForOutcome === true;
  const readOutcome = ctx.deps.guests.readVoicePurposeOutcome;

  // ⚠️ THE RESUME BRANCH COMES FIRST, exactly as in `logic.wait`, and for the
  // same reason: on resume the whole graph replays, so a handler that dialled
  // again here would telephone the guest a second time. The ledger is what knows
  // this row was parked and its wait is over.
  //
  // ⚠️ AND IT READS THE ROW RATHER THAN ASSUMING IT WAS WOKEN. Three different
  // things can deliver a parked run — the event-driven wake, the `resume_at`
  // ceiling, and the recovery sweep — and only the first means the call
  // reported. Reading makes all three produce the same honest answer, which is
  // also how the ceiling fires correctly on a call that never came back.
  if (ctx.resumedFromWait) {
    if (!readOutcome) {
      // The port vanished between parking and waking (an older worker on a
      // rolling deploy). Nothing is wrong with the CALL, so this is a completed
      // step with no outcome rather than a failure of the graph.
      return { output: { dialed: true, status: 'unknown', concluded: false, resumed: true } };
    }
    const outcome = await readOutcome({ runId: ctx.runId, nodeId: ctx.nodeId });
    return {
      output: { ...voiceOutcomeOutput(outcome?.attemptId ?? '', outcome), resumed: true },
    };
  }

  const dial = ctx.deps.guests.startVoicePurposeCall;
  if (!dial) {
    throw new PermanentNodeExecutionError(
      'capability_unavailable',
      'הפעולה "שיחה עם סוכן קולי" אינה זמינה בסביבה הזו.',
    );
  }

  const guest = requireGuestContext(ctx, 'action.start_voice_call');

  // ⚠️ TRIMMED, AND EMPTY IS DROPPED RATHER THAN SENT. Every one of these ships
  // as '' in the node's defaults, so a diagram that never opened the "פרמטרי
  // החיוג" group would otherwise send four empty strings and force the
  // dispatcher to decide what '' means. Dropping them here makes "not set" and
  // "not sent" the same thing, which is what the port documents.
  //
  // `toOverride` has already been through `resolveConfigTemplates`, so a
  // `{{nodes.<id>.phone}}` written in the editor arrives as a number — and an
  // unresolvable reference has already failed the step by then, loudly, rather
  // than dialling a literal brace.
  const overrides = {
    ...(readString(config, 'callerId').trim() ? { callerId: readString(config, 'callerId').trim() } : {}),
    ...(readString(config, 'ruleId').trim() ? { ruleId: readString(config, 'ruleId').trim() } : {}),
    ...(readString(config, 'toOverride').trim() ? { to: readString(config, 'toOverride').trim() } : {}),
    ...(readString(config, 'agentId').trim() ? { agentId: readString(config, 'agentId').trim() } : {}),
  };

  const outcome = await dial({
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    eventId: guest.eventId,
    contactId: guest.contactId,
    purposeKey,
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
  });

  const placed = {
    dialed: outcome.ok,
    // ⚠️ `outcome` ON THE REFUSAL PATH, and deliberately NOT on the other one.
    //
    // A downstream `{{nodes.<id>.outcome}}` is STRICT — `resolve-template` throws
    // `Unresolved template reference` rather than resolving to '' — so a diagram
    // that branches on the call's result used to fail outright the first time a
    // dial was refused for DNC, Shabbat or balance. Those are the cases where the
    // rules worked correctly, and they mapped to no value at all.
    //
    // A refusal is 'failed' for the same reason the dispatcher's own `failed` is:
    // no call was placed, so nothing can ever report on it.
    //
    // A dial that SUCCEEDED without waiting gets no `outcome`, because there is
    // no honest value for it. The call is in progress; 'completed' would claim it
    // finished and 'no_answer' would claim the guest did not pick up. A diagram
    // that wants to branch on how a call went has to wait for it — and a strict
    // reference failing loudly is the correct way to say so.
    ...(outcome.ok ? {} : { outcome: 'failed' as const }),
    status: outcome.status,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.attemptId ? { attemptId: outcome.attemptId } : {}),
  };

  // ── park, or carry on ──────────────────────────────────────────────────────
  //
  // OPT-IN, and default off. This node has been dialling and continuing since it
  // shipped; turning every existing graph into one that stops at the call would
  // be changing live automations nobody edited.
  if (!waitForOutcome) return { output: placed };

  // Nothing to wait on. `attemptId` is empty on the refusal paths, and also on
  // `already_dispatched` when the row it collided with could not be re-read —
  // parking on an empty correlation would be a park no callback can ever match.
  if (!outcome.attemptId || !outcome.tokenExpiresAt || !readOutcome) {
    return { output: placed };
  }

  // A call that is ALREADY settled has nothing left to report. `concluded` means
  // it ended and said how; `failed` means the dispatch itself never placed one.
  // Either way a wait would run to the ceiling and learn nothing.
  const already = await readOutcome({ runId: ctx.runId, nodeId: ctx.nodeId });
  if (already && PURPOSE_SETTLED.includes(already.dispatchStatus)) {
    return { output: voiceOutcomeOutput(outcome.attemptId, already) };
  }

  // ⚠️ THE CEILING IS THE TOKEN'S OWN EXPIRY, never a duration chosen here. The
  // callback route refuses an expired token, so a park past that instant is a
  // park no wake can reach — the run would sleep to a deadline that had already
  // stopped being wakeable. `voice_purposes.token_ttl_sec` is the one number,
  // and an owner who edits it moves this ceiling with it.
  throw new WorkflowWaitSignal(
    outcome.tokenExpiresAt,
    outcome.attemptId,
    // ⚠️ READS, NEVER DIALS. The attempt already exists; this asks the same
    // question the check above asked, but from the other side of the park — and
    // it is the ONLY thing that catches a call that ended in the window between
    // them. A verifier that re-dispatched would telephone the guest twice.
    async () => {
      const latest = await readOutcome({ runId: ctx.runId, nodeId: ctx.nodeId });
      return latest !== null && PURPOSE_SETTLED.includes(latest.dispatchStatus);
    },
  );
};

const startRsvpAiCallback: StepHandler = async (_config, ctx) => {
  const dispatch = ctx.deps.guests.startRsvpAiCallback;
  if (!dispatch) {
    throw new PermanentNodeExecutionError(
      'voice_agent_not_wired',
      'צומת סוכן הקול אינו מחובר למימוש השרת.',
    );
  }

  const guest = requireGuestContext(ctx, 'action.start_rsvp_ai_callback');
  const outcome = await dispatch({
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    eventId: guest.eventId,
    contactId: guest.contactId,
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

  const { contactId } = requireGuestContext(ctx, 'action.send_whatsapp');
  const outcome = await ctx.deps.guests.sendWhatsAppReply(contactId, body);
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
  //
  // With ONE exception, and it is the whole secrets design: `{{secrets.<NAME>}}`
  // is skipped by the resolver and is still a literal token here. The handler
  // must therefore never inspect, log or copy a header value — it passes the
  // rows straight to the port, which substitutes them at the socket.
  const body = readString(config, 'body');
  const method = readOptionalEnum(config, 'method', HTTP_METHODS);
  const headers = readHeaderRows(config);
  const captureResponse = config.captureResponse === true;

  const result = await ctx.deps.webhook.post({
    url,
    method,
    headers,
    body,
    idempotencyKey: `${ctx.runId}:${ctx.nodeId}`,
    captureResponse,
  });

  // The URL is NOT in the output. It is already on the node in the editor, and
  // repeating it in the run log would copy a path segment — the one place this
  // node can legitimately carry a secret — into a second store.
  //
  // Neither are the HEADERS, for a stronger version of the same reason: after
  // the port ran they would be the substituted values.
  const base = {
    status: result.status,
    // Only when asked for. `undefined` rather than `null` so a node that did not
    // capture does not advertise an empty `body` in the variable picker.
    ...(captureResponse
      ? { body: result.body ?? '', truncated: result.truncated === true }
      : {}),
  };

  return result.ok
    ? { output: { ok: true, ...base } }
    : {
        output: { ok: false, ...base, reason: result.reason ?? null },
        nextPort: ACTION_BRANCH_HANDLES.error,
      };
};

/**
 * Header rows as the owner typed them — shape-checked, contents untouched.
 *
 * DELIBERATELY NOT VALIDATED BEYOND THE SHAPE. Reserved names, newlines and
 * secret substitution are all the port's job, because the port is the only thing
 * between here and a socket and a second copy of those rules would drift.
 */
function readHeaderRows(config: Record<string, unknown>): HttpHeader[] {
  const raw = config.headers;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const { name, value } = row as Partial<HttpHeader>;
    return typeof name === 'string' ? [{ name, value: typeof value === 'string' ? value : '' }] : [];
  });
}

/**
 * An enum field that may legitimately be absent.
 *
 * Distinct from `readEnum`, which THROWS on a missing value. `method` was added
 * after nodes were already saved without it, and a node that meant POST must
 * keep meaning POST rather than failing permanently on its next run.
 */
function readOptionalEnum<T extends string>(
  config: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = config[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

// ---------------------------------------------------------------------------
// action.set_guest_field
// ---------------------------------------------------------------------------

// Write ONE field on the guest behind this run's contact.
//
// The narrowest possible write, and that is the design: `GUEST_FIELDS` names the
// three columns a workflow may touch, and status and the headcount are not among
// them — they belong to `submit_rsvp`, which keeps their numbers consistent with
// each other.
//
// ריבוי-אורחים: a phone may back several guests, and "whose meal preference?" has
// no answer. Reported as a COMPLETED step with `skipped: true`, not a failure —
// the same shape `action.update_guest_status` uses, because nothing went wrong
// and there was simply nothing unambiguous to do.
const setGuestField: StepHandler = async (config, ctx) => {
  const field = readEnum(config, 'field', GUEST_FIELDS, 'action.set_guest_field');
  // Already resolved: `resolveConfigTemplates` walked the config first, so this
  // can legitimately be the guest's own words via `{{trigger.message_text}}`.
  const value = readString(config, 'value');

  const write = ctx.deps.guests.setGuestField;
  if (!write) {
    // A port that predates the node. Fail CLOSED and loudly rather than
    // reporting a write that never happened as success.
    throw new PermanentNodeExecutionError(
      'unsupported',
      'עדכון שדה אורח אינו זמין בהרצה הזו.',
    );
  }

  const guest = requireGuestContext(ctx, 'action.set_guest_field');
  const result = await write({
    eventId: guest.eventId,
    contactId: guest.contactId,
    field,
    value,
  });

  return result.ok
    ? { output: { updated: true, field, guestId: result.guestId ?? null } }
    : {
        output: { updated: false, skipped: true, field, reason: result.reason ?? null },
      };
};

// ---------------------------------------------------------------------------
// action.create_callback_request
// ---------------------------------------------------------------------------

// Put the guest in front of a person.
//
// The escape hatch every automation owes: a workflow that cannot answer should
// hand over rather than guess. Unlike `action.notify_team`, which tells the team
// something happened, this creates a row in the queue they work from — with the
// name and number already on it.
//
// `created: false` is a SUCCESS, not the error branch. It means an open request
// already covers this guest, and the dedupe that produced it is what stops a
// guest who writes twice from being called twice. Routing that to the error
// branch would send a workflow down a failure path for the system working.
const createCallbackRequest: StepHandler = async (config, ctx) => {
  const topic = readString(config, 'topic').trim();
  const note = readString(config, 'note');

  // ⚠️ NEVER THE SALES TOPIC FROM A GUEST NODE.
  //
  // `topic` is not a label, it is the ROUTER: `enqueueSalesCallDispatch` gates
  // on `topic === 'מכירות'` and nothing downstream re-examines who the person
  // is. This node is guest-scoped — `requireGuestContext` below, and the port
  // reads `guests.full_name` / `guests.phone` — so that string would put the
  // sales-closing agent on the phone to a wedding guest to sell them KALFA.
  //
  // The form no longer offers it, and this refuses it anyway: the value lives in
  // a jsonb row that the form does not re-validate, and an older saved diagram
  // may carry anything. Permanent rather than routed to the error branch — it is
  // a configuration mistake, not a runtime condition, and retrying cannot help.
  if (topic === SALES_CALLBACK_TOPIC) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      `הצעד "בקשת חזרה לאורח" לא יכול לפנות בנושא "${SALES_CALLBACK_TOPIC}" — הנושא הזה מנתב לסוכן המכירות, והצעד הזה פונה לאורח באירוע.`,
    );
  }

  const create = ctx.deps.guests.createCallbackRequest;
  if (!create) {
    throw new PermanentNodeExecutionError(
      'unsupported',
      'יצירת בקשת חזרה אינה זמינה בהרצה הזו.',
    );
  }

  const guest = requireGuestContext(ctx, 'action.create_callback_request');
  const result = await create({
    eventId: guest.eventId,
    contactId: guest.contactId,
    // An empty topic falls back to the first of the offered values rather than
    // to an internal label: the team reads this column in the callback queue,
    // and the agent is handed it as `{{topic_he}}`.
    topic: topic === '' ? CALLBACK_TOPICS[0] : topic,
    note,
  });

  if (!result.ok) {
    return {
      output: { created: false, reason: result.reason ?? null },
      nextPort: ACTION_BRANCH_HANDLES.error,
    };
  }
  return {
    output: result.created
      ? { created: true }
      : { created: false, skipped: true, reason: 'already_open' },
  };
};

// ---------------------------------------------------------------------------
// action.import_guest_list
// ---------------------------------------------------------------------------

/**
 * The list that started this run, staged for review.
 *
 * ⚠️ THIS IS THE NODE THAT MAKES GUEST IMPORT A FLOW INSTEAD OF A MECHANISM.
 *
 * Importing from WhatsApp used to be unreachable from a workflow twice over: a
 * file or a contact card never started a run (the BILLING classifier was the
 * automation gate), and there was no step that could do anything with one. Both
 * halves are gone — `matchesKind` on the trigger, and this.
 *
 * IT NEEDS NO CONFIG. Everything it could be asked is either settled (which
 * event) or belongs on the canvas (what to do about 400 rows, or about a file
 * that would not parse). A node whose behaviour is chosen in its own form is the
 * hard-coded mechanism again, wearing a different shape.
 *
 * SAFE TO RUN TWICE, which the step lease requires: staging is keyed on the
 * inbound message id, so a replay reports `created: false` and returns the same
 * review link rather than staging a second copy of the same list.
 *
 * A `created: false` is NOT the error branch. It means the list is already
 * staged — usually because the hard-coded import path, which still runs beside
 * this, won the race. Nothing went wrong; the owner has their link either way.
 */
const importGuestList: StepHandler = async (config, ctx) => {
  void config;

  const port = ctx.deps.guests.importGuestList;
  if (!port) {
    throw new PermanentNodeExecutionError(
      'capability_unavailable',
      'הפעולה "קליטת רשימת אורחים" אינה זמינה בסביבה הזו.',
    );
  }

  // NOT `requireGuestContext`: this run is about an OWNER sending a list, so it
  // deliberately has no contact. It does need the event — without one there is
  // nowhere to stage — and `inboxRowId` is where the list itself lives.
  const { eventId, inboxRowId } = ctx.trigger;
  if (!eventId || !inboxRowId) {
    throw new PermanentNodeExecutionError(
      'missing_import_context',
      'הצעד "קליטת רשימת אורחים" פועל רק בתהליך שמתחיל מקובץ או מאנשי קשר שנשלחו בוואטסאפ.',
    );
  }

  const result = await port({ inboxRowId, eventId });

  return result.ok
    ? {
        output: {
          staged: true,
          created: result.created,
          // THE LIST ITSELF, on the run's own record. Readable downstream as
          // `{{nodes.<id>.rows}}` — the reason it is here rather than only in
          // the staging table, which is wiped the moment the owner decides.
          rows: result.rows,
          rowCount: result.rowCount,
          errorCount: result.errorCount,
          fileName: result.fileName,
          reviewUrl: result.reviewUrl,
        },
      }
    : {
        output: { staged: false, reason: result.reason, message: result.message ?? null },
        nextPort: ACTION_BRANCH_HANDLES.error,
      };
};


// ---------------------------------------------------------------------------
// logic.wait — the run parks here and comes back later
// ---------------------------------------------------------------------------

// The park signal is shared engine code — see ../engine/wait-signal.ts.
// Re-exported for every existing caller of this module.
export { WORKFLOW_WAIT_CODE, WorkflowWaitSignal, readWaitSignal, type WaitVerifier } from '../engine/wait-signal';

/**
 * How long a wait may be.
 *
 * A CEILING, not a preference. The deadline is stored and pg-boss holds a
 * delayed job for the whole span; a typo of "90" in a field meaning days is a
 * job sitting in the queue for three months. A year is past any real use of this
 * product — an event is over — so it costs nothing and catches the typo.
 */
export const MAX_WAIT_MS = 365 * 24 * 60 * 60 * 1000;

/** The units a wait is expressed in, smallest first. */
export const WAIT_UNITS = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
} as const;

export type WaitUnit = keyof typeof WAIT_UNITS;

const waitNode: StepHandler = async (config, ctx) => {
  // ⚠️ THE RESUME BRANCH COMES FIRST, and without it a wait never ends.
  //
  // On resume the entire graph replays. A node that recomputed its deadline from
  // config would park for another full duration on every wake-up — a 3-day wait
  // that is never over. The LEDGER is the only thing that knows this row was
  // already parked and its time has passed, which is why `claimStep` reports it
  // and the handler is told rather than asked to work it out.
  if (ctx.resumedFromWait) {
    return { output: { waited: true, resumed: true } };
  }

  const unit = readEnum(config, 'unit', Object.keys(WAIT_UNITS) as WaitUnit[], 'logic.wait');
  const rawAmount = config.amount;
  const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "המתנה" הוגדר עם משך לא חוקי. יש להזין מספר גדול מאפס.',
    );
  }

  const ms = amount * WAIT_UNITS[unit];
  if (ms > MAX_WAIT_MS) {
    // Permanent: a shorter retry will not make the number smaller.
    throw new PermanentNodeExecutionError(
      'wait_too_long',
      'הצעד "המתנה" הוגדר לטווח ארוך משנה. קצרו את המשך.',
    );
  }

  throw new WorkflowWaitSignal(new Date(Date.now() + ms).toISOString());
};


// ---------------------------------------------------------------------------
// action.start_for_each_guest
// ---------------------------------------------------------------------------

// One run per matching guest — the step that turns "do this for everyone" into
// something an owner can draw.
//
// ⚠️ THE MOST DANGEROUS NODE IN THE PALETTE, and the guards are the feature.
// A single press starts hundreds of runs that each reach a real person. Three
// separate ceilings apply, on purpose:
//
//   1. `maxGuests` — the owner's own, REQUIRED with no default. A node that
//      shipped with a generous one would be a node whose blast radius nobody
//      chose.
//   2. FAN_OUT_HARD_CAP — in code, above the owner's. `maxGuests` lives in a
//      jsonb row, and the row is exactly what a mistake would have edited.
//   3. The port enforces both again, because a handler that trusted its own
//      config would be trusting that same row.
//
// IT MUST NOT FAN OUT TO ITSELF. A workflow starting itself per guest, where
// each child fans out again, is an exponential that ends with the queue full and
// every guest messaged many times. Refused permanently rather than capped.
const startForEachGuest: StepHandler = async (config, ctx) => {
  const port = ctx.deps.guests.startRunsForGuests;
  if (!port) {
    throw new PermanentNodeExecutionError(
      'capability_unavailable',
      'הפעולה "הרצה לכל אורח" אינה זמינה בסביבה הזו.',
    );
  }

  // The EVENT, not a guest: this node runs once, about a whole list. It needs no
  // contact — the children are what carry one — so `requireGuestContext` would
  // be the wrong gate and would make the node unusable in the scheduled run it
  // exists for.
  const eventId = ctx.trigger.eventId;
  if (!eventId) {
    throw new PermanentNodeExecutionError(
      'missing_event_context',
      'הצעד "הרצה לכל אורח" פועל על אירוע. שייכו את התהליך לאירוע מסוים.',
    );
  }

  const targetWorkflowId = readString(config, 'targetWorkflowId').trim();
  if (targetWorkflowId === '') {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "הרצה לכל אורח" לא הוגדר עם תהליך להרצה.',
    );
  }

  // ⚠️ NOT ITSELF. Documented as a rule from the day this node was written and
  // never implemented until 2026-09-14: a workflow starting itself per guest has
  // every child fan out again, and the dedupe key cannot stop it because the
  // parent run id is new each generation.
  //
  // Also checked at ARM time, where it is a static property of the diagram and
  // can be refused before anything runs. Kept here too because arming is not
  // required to be a fan-out TARGET — a workflow can be started by another
  // fan-out without ever being armed — and because the id lives in a jsonb row
  // that arming does not re-read.
  if (targetWorkflowId === ctx.workflowId) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "הרצה לכל אורח" מצביע על התהליך הזה עצמו. תהליך שמפעיל את עצמו לכל אורח אינו נעצר.',
    );
  }

  // ⚠️ AND NOT ENDLESSLY DEEP. `self` is only the shortest cycle; W1 → W2 → W1
  // is the same exponential. Depth is what actually bounds the tree.
  // ⚠️ COERCED, NOT TRUSTED. `trigger_payload` is jsonb and nothing guarantees a
  // number in it. `'lots' + 1` is `'lots1'`, and `'lots1' > 3` is FALSE — so a
  // junk value would sail past this cap in every generation, forever. Anything
  // that is not a finite non-negative number counts as depth 0, which is the
  // safe reading: it costs one generation, where trusting it costs all of them.
  const parentDepth = ctx.trigger.fanoutDepth;
  const depth =
    (typeof parentDepth === 'number' && Number.isFinite(parentDepth) && parentDepth >= 0
      ? Math.floor(parentDepth)
      : 0) + 1;
  if (depth > MAX_FANOUT_DEPTH) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      `הצעד "הרצה לכל אורח" חרג מעומק השרשרת המותר (${MAX_FANOUT_DEPTH}). תהליך מפעיל תהליך שמפעיל תהליך — כנראה מעגל.`,
    );
  }

  const rawMax = config.maxGuests;
  const maxGuests = typeof rawMax === 'number' ? rawMax : Number(rawMax);
  if (!Number.isFinite(maxGuests) || maxGuests <= 0) {
    // Permanent and explicit: a missing ceiling is the one thing this node must
    // never treat as "no limit".
    throw new PermanentNodeExecutionError(
      'missing_cap',
      'הצעד "הרצה לכל אורח" חייב תקרה — כמה אורחים לכל היותר.',
    );
  }

  const statuses = Array.isArray(config.statuses)
    ? config.statuses.filter((v): v is string => typeof v === 'string')
    : [];

  const result = await port({
    parentRunId: ctx.runId,
    nodeId: ctx.nodeId,
    eventId,
    targetWorkflowId,
    ...(statuses.length > 0 ? { statuses } : {}),
    // Default TRUE: a run about a guest with no phone can do nothing that
    // reaches them, so it is noise in the log and a wasted job.
    requirePhone: config.requirePhone !== false,
    maxGuests,
    // The generation this fan-out is creating. The port stamps it on each
    // child so the NEXT fan-out can refuse a fourth.
    depth,
  });

  return result.ok
    ? {
        output: {
          started: result.started,
          matched: result.matched,
          // `capped` is not cosmetic: it is the difference between "everyone got
          // one" and "the first 200 did", and an owner reading the log needs to
          // know which happened.
          capped: result.capped,
        },
      }
    : {
        output: { started: 0, reason: result.reason },
        nextPort: ACTION_BRANCH_HANDLES.error,
      };
};


// ---------------------------------------------------------------------------
// action.send_template
// ---------------------------------------------------------------------------

// An APPROVED WhatsApp template to this run's guest.
//
// ⚠️ THE COMPANION TO `action.send_whatsapp`, and the reason both exist. Free
// text may be sent only inside the 24-hour window a guest's own message opens —
// perfect for answering someone who just wrote, and useless for reaching someone
// who did not. A template may be sent at any time, so this is the ONLY send a
// workflow started by a clock can actually deliver.
//
// Every Meta and consent rule is the campaign path's, reused rather than copied:
// see template-send.ts.
//
// A REFUSAL IS A COMPLETED STEP, not the error branch, whenever the system
// behaved correctly — an opted-out guest, a template not approved for this event
// type, a household with no phone. Routing those to the failure path would send
// a workflow down an error route because the rules worked.
const sendTemplate: StepHandler = async (config, ctx) => {
  const port = ctx.deps.guests.sendWhatsAppTemplate;
  if (!port) {
    throw new PermanentNodeExecutionError(
      'capability_unavailable',
      'הפעולה "שליחת תבנית" אינה זמינה בסביבה הזו.',
    );
  }

  const messageKey = readString(config, 'messageKey').trim();
  if (messageKey === '') {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "שליחת תבנית" לא הוגדר עם תבנית לשליחה.',
    );
  }

  const { eventId, contactId } = requireGuestContext(ctx, 'action.send_template');
  const result = await port({ eventId, contactId, messageKey });

  return result.ok
    ? { output: { sent: true, messageKey } }
    : { output: { sent: false, skipped: true, reason: result.reason ?? 'send_failed' } };
};

const microsoftSendEmail: StepHandler = async (config, ctx) => {
  const connectionId = readString(config, 'connectionId').trim();
  const to = readString(config, 'to').trim();
  const cc = readString(config, 'cc').trim();
  const bcc = readString(config, 'bcc').trim();
  const replyTo = readString(config, 'replyTo').trim();
  const subject = readString(config, 'subject').trim();
  const body = readString(config, 'body');

  // Narrowed here rather than passed through, so a jsonb row holding a number,
  // a null or a value from a newer version cannot reach the transport. Each
  // fallback is Graph's own default, which is what an absent field has always
  // meant.
  const contentType: MicrosoftMailContentType =
    readString(config, 'contentType').trim() === 'HTML' ? 'HTML' : 'Text';

  const rawImportance = readString(config, 'importance').trim();
  const importance: MicrosoftMailImportance =
    rawImportance === 'high' || rawImportance === 'low' ? rawImportance : 'normal';

  const saveToSentItems =
    typeof config.saveToSentItems === 'boolean' ? config.saveToSentItems : true;

  // The same four fields as before. `cc`, `bcc` and `replyTo` are deliberately
  // NOT required: a mail with no carbon copy is an ordinary mail.
  if (!connectionId || !to || !subject || !body.trim()) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "שליחת דוא״ל ב-Microsoft 365" חסר חיבור, נמען, נושא או תוכן.',
    );
  }

  try {
    await ctx.deps.integrations.execute({
      provider: 'microsoft',
      connectionId,
      capability: 'mail.send',
      // The optional ADDRESS fields are omitted when empty rather than sent as
      // '', so the transport never has to tell "no carbon copy" apart from
      // "a carbon copy that resolved to nothing".
      input: {
        to,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        ...(replyTo ? { replyTo } : {}),
        subject,
        body,
        contentType,
        importance,
        saveToSentItems,
      },
    });
  } catch (error) {
    const integrationError = readIntegrationRuntimeError(error);
    if (!integrationError) throw error;

    const ErrorType =
      integrationError.classification === 'transient'
        ? TransientNodeExecutionError
        : PermanentNodeExecutionError;
    throw new ErrorType(integrationError.code, integrationError.message, { cause: error });
  }

  // Microsoft Graph sendMail returns 202 with no response body. `accepted` means
  // Graph accepted the request; it is deliberately not a delivery receipt.
  return { output: { accepted: true } };
};

/**
 * `action.sumit_create_document` — issue an accounting document.
 *
 * ⚠️ NO MONEY MOVES HERE, and the PORT is what guarantees it: `ctx.deps.accounting`
 * exposes document and customer creation only. Authorize, capture and credit are
 * not on it, so this handler could not charge a card even if it tried.
 *
 * ⚠️ AND NOTHING REACHES THE PROVIDER FROM A DRY RUN. The port is swapped for a
 * recording stub (engine/dry-run.ts), so the editor's "הרצת בדיקה" reports what
 * it WOULD issue and the books stay untouched — the owner's explicit decision,
 * 2026-09-22.
 *
 * The item is OPTIONAL: `Accounting_Typed_DocumentItem` is itself optional in the
 * spec and a receipt legitimately carries none. A HALF-filled item is refused
 * rather than sent — SUMIT answers a nameless item with "Missing Item details",
 * and a priced line with no name is never what was meant.
 */
const sumitCreateDocument: StepHandler = async (config, ctx) => {
  const documentType = readEnum(
    config,
    'documentType',
    SUMIT_DOCUMENT_TYPES,
    'action.sumit_create_document',
  );
  const customerName = readString(config, 'customerName').trim();
  if (!customerName) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "הפקת מסמך ב-SUMIT" חסר שם לקוח.',
    );
  }

  const itemName = readString(config, 'itemName').trim();
  const itemUnitPrice = Number(config.itemUnitPrice);
  const rawQuantity = Number(config.itemQuantity);
  const itemQuantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
  const hasPrice = Number.isFinite(itemUnitPrice) && itemUnitPrice !== 0;

  if (Boolean(itemName) !== hasPrice) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'שורת הפריט במסמך חלקית — מלאו גם שם פריט וגם מחיר, או השאירו את שניהם ריקים.',
    );
  }

  const optional = (key: string): string | undefined => {
    const value = readString(config, key).trim();
    return value ? value : undefined;
  };

  const result = await ctx.deps.accounting.createDocument({
    type: documentType,
    customerName,
    // Omitted when blank rather than sent as '', so SUMIT never has to tell a
    // deliberately-empty field from one that resolved to nothing.
    customerEmail: optional('customerEmail'),
    customerPhone: optional('customerPhone'),
    customerExternalId: optional('customerExternalId'),
    ...(typeof config.customerNoVat === 'boolean'
      ? { customerNoVat: config.customerNoVat }
      : {}),
    ...(itemName && hasPrice
      ? { items: [{ name: itemName, quantity: itemQuantity, unitPrice: itemUnitPrice }] }
      : {}),
    description: optional('documentDescription'),
    ...(typeof config.isDraft === 'boolean' ? { isDraft: config.isDraft } : {}),
    ...(typeof config.sendByEmail === 'boolean' ? { sendByEmail: config.sendByEmail } : {}),
  });

  // Returned WHOLE, so a later node can reference any field as
  // {{nodes.<id>.documentId}} — the resolver already serves node types nobody
  // had written when it was built (activity-runner's resolveConfigTemplates).
  return { output: result };
};

/** `action.sumit_create_customer` — create a customer card. No money moves. */
const sumitCreateCustomer: StepHandler = async (config, ctx) => {
  const name = readString(config, 'customerName').trim();
  if (!name) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "יצירת לקוח ב-SUMIT" חסר שם לקוח.',
    );
  }

  const optional = (key: string): string | undefined => {
    const value = readString(config, key).trim();
    return value ? value : undefined;
  };

  const result = await ctx.deps.accounting.createCustomer({
    name,
    email: optional('customerEmail'),
    phone: optional('customerPhone'),
    city: optional('city'),
    address: optional('address'),
    companyNumber: optional('companyNumber'),
    externalId: optional('externalId'),
    ...(typeof config.noVat === 'boolean' ? { noVat: config.noVat } : {}),
  });

  return { output: result };
};

// ---------------------------------------------------------------------------
// action.ai_agent — one headless Claude run, as a workflow step
// ---------------------------------------------------------------------------

/**
 * Ask a model, and put its answer on the run.
 *
 * ⚠️ IT REACHES THE MODEL ONLY THROUGH `ctx.deps.ai`, which is the property the
 * dry run depends on. The editor's "הרצת בדיקה" panel promises the run changes
 * nothing; a model call changes no row but does cost money and does return prose
 * an owner could mistake for a real answer. The dry run swaps PORTS, so a future
 * edit that spawned the CLI directly here would bill a card from a test button
 * — the same trap `sumit-accounting.test.ts` source-scans for.
 *
 * ⚠️ THE ANSWER IS TEXT, AND THAT IS THE WHOLE CONTRACT. No JSON parsing, no
 * schema coercion, no "the model said yes so branch left". A step that tried to
 * interpret the answer would be deciding, silently and differently every run,
 * what counts as agreement. Branching stays where it already works: put a
 * `logic.condition` after this node and compare `{{nodes.<id>.text}}` yourself,
 * in a rule that is visible on the canvas and the same on every run.
 */
const aiAgent: StepHandler = async (config, ctx) => {
  const prompt = readString(config, 'systemPrompt').trim();
  if (prompt === '') {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "סוכן AI" לא הוגדר עם הנחיה.',
    );
  }

  const model = readEnum(config, 'model', [...AI_AGENT_MODELS], 'action.ai_agent');

  const rawTurns = config.maxTurns;
  const requested = typeof rawTurns === 'number' ? rawTurns : Number(rawTurns);
  // Clamped rather than refused: a value outside the range is a slider that
  // moved, not a step nobody configured, and failing a run over it would be the
  // wrong trade. The CEILING is what matters — it is what stops a loop.
  const maxTurns = Number.isFinite(requested)
    ? Math.min(Math.max(Math.floor(requested), AI_AGENT_MAX_TURNS.min), AI_AGENT_MAX_TURNS.max)
    : AI_AGENT_MAX_TURNS.default;

  // ⚠️ NAMES ONLY, AND THE PORT DOES NOT ACT ON THEM YET. `apiKey` is part of the
  // SDK control's fixed row shape and is deliberately never read — a diagram is
  // exportable. The names are collected here so the shape is right the day a
  // tool layer exists; until then the live port drops them, and the panel says
  // so in as many words.
  const tools = Array.isArray(config.tools)
    ? config.tools
        .map((row) =>
          row && typeof row === 'object' && typeof (row as { tool?: unknown }).tool === 'string'
            ? (row as { tool: string }).tool.trim()
            : '',
        )
        .filter((name) => name !== '')
    : [];

  const answer = await ctx.deps.ai.run({ prompt, model, tools, maxTurns });

  return {
    output: {
      text: answer.text,
      // Published so a run's cost is visible on the step that spent it, the way
      // the fleet's own index line records it per role.
      costUsd: answer.costUsd,
      sessionId: answer.sessionId,
    },
  };
};

export const STEP_HANDLERS: Record<KalfaNodeType, StepHandler> = {
  'trigger.whatsapp_inbound': whatsappInbound,
  'trigger.webhook': webhookTrigger,
  'trigger.schedule': scheduleTrigger,
  'trigger.sumit_card': sumitCardTrigger,
  'logic.condition': condition,
  'logic.switch': switchNode,
  'action.update_guest_status': updateGuestStatus,
  'action.send_whatsapp': sendWhatsapp,
  'action.microsoft_send_email': microsoftSendEmail,
  'action.start_rsvp_ai_callback': startRsvpAiCallback,
  'action.start_voice_call': startVoiceCall,
  'action.notify_team': notifyTeam,
  'action.webhook': webhook,
  'action.set_guest_field': setGuestField,
  'action.create_callback_request': createCallbackRequest,
  'action.import_guest_list': importGuestList,
  'logic.wait': waitNode,
  'action.send_template': sendTemplate,
  'action.start_for_each_guest': startForEachGuest,
  [setValueDefinition.type]: setValue,
  'action.sumit_create_document': sumitCreateDocument,
  'action.sumit_create_customer': sumitCreateCustomer,
  'action.ai_agent': aiAgent,
};
