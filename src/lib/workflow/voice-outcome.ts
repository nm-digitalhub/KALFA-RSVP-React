import type { KalfaNodeType } from './catalogue/types';
import * as startVoiceCallDefinition from './nodes/action-start-voice-call/definition';

// What a voice call MEANT, as opposed to what the telephony reported.
//
// ⚠️ WHY THIS LAYER EXISTS. Until now a workflow branching on a call had to read
// `finishReason` — a string that is sometimes a word ('completed'), sometimes a
// sentence ('Normal termination'), and sometimes `sip_${code}` built at run time
// inside the scenario. Asking an owner to write `{{nodes.x.finishReason}} ==
// 'sip_486'` in a condition box is asking them to know that 486 is Busy Here. It
// also makes every diagram fragile: the scenario can emit a SIP code nobody has
// seen before, and the graph silently takes the wrong branch.
//
// ⚠️ AND WHY IT IS NOT AN ENUM OF KNOWN STRINGS. The scenario interpolates the
// code (`sip_${e.code}`), so the set is open by construction. Classifying by SIP
// CLASS rather than by a list is what makes an unseen code land somewhere
// sensible instead of nowhere.
//
// The technical fields stay on the node's output beside this. Nothing is
// replaced — a debugger still wants `sip_486`, and a graph wants 'no_answer'.

/**
 * The four answers a workflow can usefully branch on.
 *
 * `follow_up_required` is DELIBERATELY UNMAPPED today. It means "the guest asked
 * to be contacted again", which only the agent knows and no scenario currently
 * reports; mapping something to it on a guess would put runs down a path that
 * nothing actually verified. It is in the vocabulary because the branch is worth
 * drawing before the signal exists — see `voice-outcome.test.ts`.
 */
export type VoiceBusinessOutcome = 'completed' | 'no_answer' | 'failed' | 'follow_up_required';

/** The node types whose output carries a business outcome. */
export const VOICE_OUTCOME_NODES: readonly KalfaNodeType[] = [startVoiceCallDefinition.type];

/**
 * SIP response classes, as they matter to a person rather than to a switch.
 *
 * 486 Busy Here, 480 Temporarily Unavailable, 408 Request Timeout and 603
 * Decline all mean the same thing to an owner: the guest did not take the call.
 * A 4xx that is about the NUMBER (404 Not Found, 484 Address Incomplete) and
 * every 5xx mean the call could not be placed at all, which is a failure to
 * report rather than a person who did not answer.
 */
function classifySip(code: number): VoiceBusinessOutcome {
  // ⚠️ 6xx IS TESTED BEFORE 5xx, and the order is the correction. A `>= 500`
  // catch-all swallowed the whole Global Failure class, so 600 Busy Everywhere
  // and 603 Decline — a person not taking the call — came out as an
  // infrastructure failure. Caught by the "unseen 4xx" test, which is exactly
  // what an open code set is supposed to surface.
  if (code === 604 || code === 606) return 'failed'; // does not exist anywhere / not acceptable
  if (code >= 600) return 'no_answer'; // 600 busy everywhere, 603 decline
  if (code >= 500) return 'failed'; // the network could not carry it

  // Codes about the NUMBER rather than the person.
  if (code === 404 || code === 484 || code === 485) return 'failed';

  // Everything else in 4xx is the callee not taking it: busy, unavailable, timed
  // out. An unseen 4xx lands here, which is the safe side — it reads as "did not
  // reach them", never as "it worked".
  if (code >= 400) return 'no_answer';

  // 1xx-3xx never appear as a termination reason; if one does, it is not an
  // outcome anybody should branch on as success.
  return 'failed';
}

/**
 * Map one attempt's technical outcome onto the business one.
 *
 * Takes BOTH fields because neither is enough alone: `dispatch_status` knows
 * whether a call was placed and reported, `finish_reason` knows how it ended.
 * A concluded attempt with no reason is still a completed call; an unconcluded
 * one is never completed however it ended.
 */
export function toBusinessOutcome(input: {
  dispatchStatus: string | null | undefined;
  finishReason: string | null | undefined;
  /**
   * The scenario's OWN normalized verdict, when the row carries one.
   *
   * ⚠️ IT WINS OVER `finishReason`, AND THAT IS THE FIX. The callback sends this
   * beside a free-text `error_reason`, and the route used to keep only the
   * error: `finish_reason = error_reason ?? call_status`. So on every failure
   * path the scenario has — `missing_secret`, `ctx_parse_error`,
   * `ctx_fetch_error`, `ctx_fetch_failed_<code>` — the verdict was thrown away
   * and this function saw a concluded attempt with a string it does not know,
   * which its `default` reads as 'completed'. A call that failed before anyone
   * was reached came back to the diagram as a SUCCESS.
   *
   * Optional, because rows written before 2026-09-15 have no such column; for
   * them the `finishReason` reasoning below is unchanged and still correct.
   */
  callStatus?: string | null | undefined;
}): VoiceBusinessOutcome {
  const status = input.dispatchStatus ?? '';
  const reason = (input.finishReason ?? '').trim();

  // Never placed, or placed and known to have failed to start. Nothing about the
  // guest, everything about the dispatch.
  if (status === 'failed') return 'failed';

  // Placed, ambiguous, and never reported. NOT 'failed': the call may well have
  // happened and simply never came back, and telling an owner it failed would be
  // a stronger claim than anyone can make.
  if (status === 'unknown') return 'no_answer';

  // Still in flight — the ceiling fired before the call reported. Same reasoning
  // as 'unknown': no outcome is not a bad outcome.
  if (status !== 'concluded') return 'no_answer';

  // ⚠️ BEFORE THE REASON IS READ AT ALL. The scenario computed this from the
  // same event it built the reason from, and it is the one field whose
  // vocabulary we control end to end — `voxPurposeCallbackSchema` pins it to
  // four values. Reading it first is what stops an unmapped error string from
  // being interpreted as a success by the `default` below.
  //
  // 'no_response' is the guest ANSWERING and then saying nothing
  // (`wasAnswered ? 'no_response' : 'no_answer'` in the scenario). It is not a
  // fourth business outcome: to an owner deciding what to do next, a call that
  // reached nobody and a call that reached someone who did not engage both mean
  // "we did not get an answer".
  switch (input.callStatus ?? '') {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'no_answer':
    case 'no_response':
      return 'no_answer';
    default:
      break; // absent (a legacy row) — fall through to the reason.
  }

  const sip = /^sip_(\d{3})\b/.exec(reason);
  if (sip) return classifySip(Number(sip[1]));

  switch (reason.toLowerCase()) {
    case '':
    case 'completed':
    case 'normal termination':
      return 'completed';
    // The dispatcher's own two, both meaning the start was never confirmed.
    case 'ambiguous_start_response':
    case 'network_error_during_start':
      return 'no_answer';
    default:
      // A reason the scenario invented and nobody has mapped. It CONCLUDED, so
      // the call reached the guest and ended — 'completed' is the honest read,
      // and the raw reason is still on the output for whoever needs the detail.
      return 'completed';
  }
}
