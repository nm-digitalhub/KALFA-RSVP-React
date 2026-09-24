// The dispatch table the ActivityRunnerPort uses, and the handlers of the node
// types that have not yet moved to `nodes/<name>/runtime.ts`.
//
// A handler is a pure function of (config, trigger payload, deps). It performs
// its own side effect through the narrow GuestActionsPort and returns a
// NodeExecutionResult. It never claims its own ledger row — that happens one
// layer up, in activity-runner.ts, so the claim/side-effect ordering is written
// once rather than in every handler.
import { SUMIT_HOLDS_FOLDER_ID, sumitHoldCurrencyLabel, sumitHoldStatusLabel } from '@/lib/sumit/hold-status';

import { toBusinessOutcome } from '../voice-outcome';

import {
  ACTION_BRANCH_HANDLES,
  MAX_FANOUT_DEPTH,
  type KalfaNodeType,
} from '../catalogue/types';

import { PermanentNodeExecutionError } from '../vendor/workflowbuilder/execution-core/errors';

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
import * as aiAgentDefinition from '../nodes/action-ai-agent/definition';
import { aiAgent } from '../nodes/action-ai-agent/runtime';
import * as callbackRequestDefinition from '../nodes/action-create-callback-request/definition';
import { createCallbackRequest } from '../nodes/action-create-callback-request/runtime';
import * as importGuestListDefinition from '../nodes/action-import-guest-list/definition';
import { importGuestList } from '../nodes/action-import-guest-list/runtime';
import * as microsoftSendEmailDefinition from '../nodes/action-microsoft-send-email/definition';
import { microsoftSendEmail } from '../nodes/action-microsoft-send-email/runtime';
import * as notifyTeamDefinition from '../nodes/action-notify-team/definition';
import { notifyTeam } from '../nodes/action-notify-team/runtime';
import * as sendTemplateDefinition from '../nodes/action-send-template/definition';
import { sendTemplate } from '../nodes/action-send-template/runtime';
import * as sendWhatsappDefinition from '../nodes/action-send-whatsapp/definition';
import { sendWhatsapp } from '../nodes/action-send-whatsapp/runtime';
import * as setGuestFieldDefinition from '../nodes/action-set-guest-field/definition';
import { setGuestField } from '../nodes/action-set-guest-field/runtime';
import * as startRsvpAiCallbackDefinition from '../nodes/action-start-rsvp-ai-callback/definition';
import { startRsvpAiCallback } from '../nodes/action-start-rsvp-ai-callback/runtime';
import * as sumitCreateCustomerDefinition from '../nodes/action-sumit-create-customer/definition';
import { sumitCreateCustomer } from '../nodes/action-sumit-create-customer/runtime';
import * as sumitCreateDocumentDefinition from '../nodes/action-sumit-create-document/definition';
import { sumitCreateDocument } from '../nodes/action-sumit-create-document/runtime';
import * as updateGuestStatusDefinition from '../nodes/action-update-guest-status/definition';
import { updateGuestStatus } from '../nodes/action-update-guest-status/runtime';
import * as webhookDefinition from '../nodes/action-webhook/definition';
import { webhook } from '../nodes/action-webhook/runtime';
import * as conditionDefinition from '../nodes/logic-condition/definition';
import { condition } from '../nodes/logic-condition/runtime';
import * as setValueDefinition from '../nodes/logic-set-value/definition';
import { setValue } from '../nodes/logic-set-value/runtime';
import * as switchDefinition from '../nodes/logic-switch/definition';
import { switchNode } from '../nodes/logic-switch/runtime';

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
// logic.switch
// ---------------------------------------------------------------------------

// The handler and its branch evaluators live in `nodes/logic-switch/runtime.ts`.
// The evaluators are re-exported for every existing caller of this module.
export { evaluateSwitchBranch, evaluateSwitchCondition } from '../nodes/logic-switch/runtime';

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// Total over KalfaNodeType: adding a type to the catalogue without a handler is
// a compile error, not a run-time surprise.
// ---------------------------------------------------------------------------
// action.start_voice_call
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


export const STEP_HANDLERS: Record<KalfaNodeType, StepHandler> = {
  'trigger.whatsapp_inbound': whatsappInbound,
  'trigger.webhook': webhookTrigger,
  'trigger.schedule': scheduleTrigger,
  'trigger.sumit_card': sumitCardTrigger,
  [conditionDefinition.type]: condition,
  [switchDefinition.type]: switchNode,
  [updateGuestStatusDefinition.type]: updateGuestStatus,
  [sendWhatsappDefinition.type]: sendWhatsapp,
  [microsoftSendEmailDefinition.type]: microsoftSendEmail,
  [startRsvpAiCallbackDefinition.type]: startRsvpAiCallback,
  'action.start_voice_call': startVoiceCall,
  [notifyTeamDefinition.type]: notifyTeam,
  [webhookDefinition.type]: webhook,
  [setGuestFieldDefinition.type]: setGuestField,
  [callbackRequestDefinition.type]: createCallbackRequest,
  [importGuestListDefinition.type]: importGuestList,
  'logic.wait': waitNode,
  [sendTemplateDefinition.type]: sendTemplate,
  'action.start_for_each_guest': startForEachGuest,
  [setValueDefinition.type]: setValue,
  [sumitCreateDocumentDefinition.type]: sumitCreateDocument,
  [sumitCreateCustomerDefinition.type]: sumitCreateCustomer,
  [aiAgentDefinition.type]: aiAgent,
};
