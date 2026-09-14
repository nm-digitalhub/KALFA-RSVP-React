import type { KalfaNodeType } from './catalogue/types';

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
export const VOICE_OUTCOME_NODES: readonly KalfaNodeType[] = ['action.start_voice_call'];

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
