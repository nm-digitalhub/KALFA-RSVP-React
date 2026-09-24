// `action.start_voice_call` — the step handler. Server side: SDK-free, and it
// imports the shared step contract from `steps/shared`, never from
// `steps/index` (the registry imports this file, so that would be a cycle).
//
// The park signal it throws is shared engine code, not this node's — see
// ../../engine/wait-signal.ts. `logic.wait` parks with it too.
import { WorkflowWaitSignal } from '../../engine/wait-signal';
import { readString, requireGuestContext, type StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';
import { toBusinessOutcome } from '../../voice-outcome';

import * as startVoiceCallDefinition from './definition';
import type { StartVoiceCallConfig } from './definition';

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

export const startVoiceCall: StepHandler = async (config, ctx) => {
  const purposeKey = readString<StartVoiceCallConfig>(config, 'purposeKey').trim();
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

  const guest = requireGuestContext(ctx, startVoiceCallDefinition.type);

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
    ...(readString<StartVoiceCallConfig>(config, 'callerId').trim() ? { callerId: readString<StartVoiceCallConfig>(config, 'callerId').trim() } : {}),
    ...(readString<StartVoiceCallConfig>(config, 'ruleId').trim() ? { ruleId: readString<StartVoiceCallConfig>(config, 'ruleId').trim() } : {}),
    ...(readString<StartVoiceCallConfig>(config, 'toOverride').trim() ? { to: readString<StartVoiceCallConfig>(config, 'toOverride').trim() } : {}),
    ...(readString<StartVoiceCallConfig>(config, 'agentId').trim() ? { agentId: readString<StartVoiceCallConfig>(config, 'agentId').trim() } : {}),
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
