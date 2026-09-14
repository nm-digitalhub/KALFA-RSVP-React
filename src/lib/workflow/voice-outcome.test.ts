import { describe, expect, it } from 'vitest';

import { toBusinessOutcome, type VoiceBusinessOutcome } from './voice-outcome';

// The mapping a workflow branches on, tested against the vocabulary PRODUCTION
// actually produces — not against an invented one.
//
// Queried on 2026-09-14: `completed` (10), `sip_408` (2), `sip_480` (1) across
// the attempt tables, plus `Normal termination`, `ambiguous_start_response` and
// `network_error_during_start` written by the dispatchers, and `sip_${code}`
// built at run time inside the scenario.

const outcome = (dispatchStatus: string, finishReason: string | null): VoiceBusinessOutcome =>
  toBusinessOutcome({ dispatchStatus, finishReason });

describe('the values production has actually written', () => {
  it('maps every one of them', () => {
    expect(outcome('concluded', 'completed')).toBe('completed');
    expect(outcome('concluded', 'Normal termination')).toBe('completed');
    // 408 Request Timeout, 480 Temporarily Unavailable — the guest did not take it.
    expect(outcome('concluded', 'sip_408')).toBe('no_answer');
    expect(outcome('concluded', 'sip_480')).toBe('no_answer');
  });
});

describe('SIP is classified, never enumerated', () => {
  it('⚠️ an unseen 4xx reads as no_answer, not as success', () => {
    // The scenario interpolates the code, so the set is open by construction.
    // A code nobody has mapped must land on the safe side: "did not reach them".
    for (const code of [400, 403, 486, 487, 488, 499, 600, 603]) {
      expect(outcome('concluded', `sip_${code}`), String(code)).toBe('no_answer');
    }
  });

  it('⚠️ 6xx is a PERSON, not a network — the two classes are not one range', () => {
    // A `>= 500` catch-all swallowed the Global Failure class and turned
    // 600 Busy Everywhere and 603 Decline into infrastructure failures. They are
    // the clearest "they did not take the call" the protocol has.
    expect(outcome('concluded', 'sip_600')).toBe('no_answer');
    expect(outcome('concluded', 'sip_603')).toBe('no_answer');
    // …except the two that say the number itself is unreachable anywhere.
    expect(outcome('concluded', 'sip_604')).toBe('failed');
    expect(outcome('concluded', 'sip_606')).toBe('failed');
  });

  it('a code about the NUMBER, or any 5xx, is a failure to place the call', () => {
    // 404 Not Found / 484 Address Incomplete / 485 Ambiguous say the number is
    // wrong; 5xx says the network could not carry it. Neither is a person
    // choosing not to answer, and an owner chasing "no answer" would waste a
    // callback on a number that can never work.
    for (const code of [404, 484, 485, 500, 503, 504]) {
      expect(outcome('concluded', `sip_${code}`), String(code)).toBe('failed');
    }
  });

  it('matches the code, not a prefix that merely looks like one', () => {
    // `sip_registration_fail` exists in the codebase and is not a response code.
    expect(outcome('concluded', 'sip_registration_fail')).toBe('completed');
  });
});

describe('the status decides before the reason does', () => {
  it('⚠️ a dispatch that FAILED is never anything else', () => {
    expect(outcome('failed', 'completed')).toBe('failed');
  });

  it('⚠️ an ambiguous start is no_answer, NOT failed', () => {
    // `unknown` means StartScenarios gave an answer we could not classify — the
    // call may well have happened. Reporting 'failed' would be a stronger claim
    // than anyone is in a position to make.
    expect(outcome('unknown', 'ambiguous_start_response')).toBe('no_answer');
    expect(outcome('unknown', 'network_error_during_start')).toBe('no_answer');
  });

  it('⚠️ a call still in flight is no_answer — the ceiling fired first', () => {
    // The wait's own timeout, which is a legitimate business result and not an
    // error: the rules placed the call correctly and nothing came back.
    expect(outcome('confirmed', null)).toBe('no_answer');
    expect(outcome('pending', null)).toBe('no_answer');
  });

  it('a concluded call with no reason at all still completed', () => {
    expect(outcome('concluded', null)).toBe('completed');
    expect(outcome('concluded', '')).toBe('completed');
  });
});

describe('follow_up_required', () => {
  it('⚠️ is in the vocabulary and DELIBERATELY unmapped', () => {
    // It means "the guest asked to be contacted again", which only the agent
    // knows and no scenario reports today. Mapping something to it on a guess
    // would send runs down a path nothing verified. The branch is worth drawing
    // before the signal exists; inventing the signal is not.
    const everyKnownInput: [string, string | null][] = [
      ['concluded', 'completed'],
      ['concluded', 'Normal termination'],
      ['concluded', 'sip_408'],
      ['concluded', 'sip_486'],
      ['concluded', 'sip_503'],
      ['unknown', 'ambiguous_start_response'],
      ['failed', null],
      ['confirmed', null],
    ];
    for (const [s, r] of everyKnownInput) {
      expect(outcome(s, r)).not.toBe('follow_up_required');
    }
  });
});
