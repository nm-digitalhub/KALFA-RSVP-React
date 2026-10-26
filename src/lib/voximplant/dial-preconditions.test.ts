import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BRANCH_ID_PATTERN,
  bridgeLaunchPayload,
  closedEventDialMessage,
  closedEventRefusal,
  CUSTOM_DATA_CAP_BYTES,
  parseTestBranch,
  testAttemptRefusal,
} from './dial-preconditions';

const repoRoot = join(__dirname, '..', '..', '..');
const launcher = readFileSync(
  join(repoRoot, 'scripts', 'voximplant', 'bridge-call.ts'),
  'utf8',
);

// 2026-07-21 12:00 IDT — the day three bridge calls were placed against an event
// that had already happened, scored 100/100, and wrote no RSVP.
const NOW = Date.parse('2026-07-21T09:00:00+00:00');
const open = {
  eventStatus: 'active',
  eventDate: '2026-08-01T18:00:00+03:00',
  rsvpDeadline: null,
};

describe('closedEventRefusal', () => {
  it('permits a dial when the event can still record an answer', () => {
    expect(closedEventRefusal(open, NOW)).toBeNull();
  });

  it('refuses the exact case that produced the 2026-07-21 calls', () => {
    const reason = closedEventRefusal(
      { ...open, eventDate: '2026-07-12T20:00:00+03:00' },
      NOW,
    );
    expect(reason).toContain('event day has passed');
  });

  it('refuses a non-active event and names the status the operator must fix', () => {
    expect(closedEventRefusal({ ...open, eventStatus: 'draft' }, NOW)).toContain("'draft'");
  });

  it('refuses a passed RSVP deadline and quotes the date', () => {
    expect(closedEventRefusal({ ...open, rsvpDeadline: '2026-07-20' }, NOW)).toContain('2026-07-20');
  });

  it('permits a deadline of TODAY — the DB compares strictly greater-than', () => {
    expect(closedEventRefusal({ ...open, rsvpDeadline: '2026-07-21' }, NOW)).toBeNull();
  });

  it('refuses when the context could not be loaded at all', () => {
    // Fail-closed: not knowing whether an answer is recordable is not permission
    // to dial. This is the branch that would otherwise let an unresolvable
    // campaign through the one gate this launcher has.
    expect(closedEventRefusal(null, NOW)).toContain('no campaign/event context');
  });
});

// The refusal above is only worth anything if the launcher actually consults it,
// BEFORE it dials. bridge-call.ts calls main() at module scope, so that ordering
// cannot be exercised in-process without placing a real call — these read the
// source instead, in the same spirit as cli-guard.test.ts.
describe('bridge-call.ts launcher wiring (source guard)', () => {
  it('consults closedEventRefusal', () => {
    expect(launcher).toContain('closedEventRefusal');
  });

  it('refuses BEFORE stamping a nonce or calling startScenarios', () => {
    // Measure inside main() only. Searching the whole file finds the IMPORT of
    // stampElCorrelationNonce/startScenarios near the top and reports the gate
    // as "after" them — a guard that passes no matter where the gate sits.
    const body = launcher.slice(launcher.indexOf('async function main'));
    const gate = body.indexOf('closedEventRefusal(cctx)');
    const stamp = body.indexOf('await stampElCorrelationNonce');
    const dial = body.indexOf('await startScenarios(');
    expect(gate).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(-1);
    expect(dial).toBeGreaterThan(-1);
    // A gate that runs after the dial is not a gate. This pins the order so a
    // future refactor cannot quietly move the check below the call.
    expect(gate).toBeLessThan(stamp);
    expect(gate).toBeLessThan(dial);
  });

  it('does not reimplement the shared closed-event rule locally', () => {
    // The two dial paths diverged once because each carried its own copy of the
    // conditions. The launcher must ask, never re-derive.
    expect(launcher).not.toContain('rsvpClosedReason');
    expect(launcher).not.toContain('isPastEventDay');
  });

  it('has no closed-event override (voice-test-environment D6)', () => {
    // ctx refuses a closed event before the call connects, so an "audio-path" test there runs the agent without the
    // guest's or the event's details — the 2026-10-25 call. The only way through is the test event.
    expect(launcher).not.toContain('allow-closed-event');
    expect(launcher).toContain('closedEventDialMessage(closedReason)');
  });

  it('validates --branch before it reads or writes anything', () => {
    const body = launcher.slice(launcher.indexOf('async function main'));
    const branch = body.indexOf("parseTestBranch(flag('branch'))");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(body.indexOf('await getCallAttemptById'));
  });

  it('measures the payload before stamping the nonce', () => {
    const body = launcher.slice(launcher.indexOf('async function main'));
    const cap = body.indexOf('bytes > CUSTOM_DATA_CAP_BYTES');
    expect(cap).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(body.indexOf('await stampElCorrelationNonce'));
  });
});

describe('closedEventDialMessage', () => {
  it('names the reason and the test-event helper, and offers no override', () => {
    const message = closedEventDialMessage("the event status is 'closed', not 'active'");
    expect(message).toContain("'closed'");
    expect(message).toContain('npm run test-call:attempt');
    expect(message).not.toContain('allow-closed-event');
  });
});

// A live branch id, read 2026-10-25 (the RSVP agent's Main): 36 characters.
const LIVE_BRANCH_ID = 'agtbrch_4101kxj3n5tqf2kae5recbbn2rtj';

describe('parseTestBranch', () => {
  it('absent means Main', () => {
    expect(parseTestBranch(undefined)).toEqual({ ok: true, branchId: null });
  });

  it('accepts a branch id in the form the API returns', () => {
    expect(LIVE_BRANCH_ID).toHaveLength(36);
    expect(parseTestBranch(LIVE_BRANCH_ID)).toEqual({ ok: true, branchId: LIVE_BRANCH_ID });
  });

  it.each([
    ['a bare flag', '__present__'],
    ['an agent id', 'agent_9701kxj3n54ye518a3s518cexd48'],
    ['an empty id', 'agtbrch_'],
    ['upper case', 'agtbrch_ABC'],
    ['an injected quote', 'agtbrch_abc","to":"+972500000000'],
  ])('refuses %s', (_label, raw) => {
    expect(parseTestBranch(raw).ok).toBe(false);
  });

  it('is the pattern RSVPAgent.voxengine.js applies to customData.br', () => {
    const scenario = readFileSync(
      join(repoRoot, 'voxfiles/applications/kalfa-rsvp.kalfarsvp.voximplant.com/scenarios/src/RSVPAgent.voxengine.js'),
      'utf8',
    );
    expect(scenario).toContain(BRANCH_ID_PATTERN.source);
  });
});

describe('bridgeLaunchPayload', () => {
  const base = {
    to: '+972536212562',
    from: '97237219347',
    tok: '0123456789abcdef0123456789abcdef',
    u: 'https://beta.kalfa.me',
  };

  it('carries no br key without a branch — the scenario then runs on Main', () => {
    const { payload } = bridgeLaunchPayload({ ...base, branchId: null });
    expect(JSON.parse(payload)).toEqual(base);
  });

  it('adds br and stays within the customData cap with a 36-character branch id', () => {
    const { payload, bytes } = bridgeLaunchPayload({ ...base, branchId: LIVE_BRANCH_ID });
    expect(JSON.parse(payload)).toEqual({ ...base, br: LIVE_BRANCH_ID });
    expect(bytes).toBe(Buffer.byteLength(payload, 'utf8'));
    expect(bytes).toBeLessThanOrEqual(CUSTOM_DATA_CAP_BYTES);
  });
});

describe('testAttemptRefusal', () => {
  const ok = { markedAsTest: true, event: open, guestCount: 1, phoneAllowed: true };

  it('permits a marked, open test event with one guest on the allowlist', () => {
    expect(testAttemptRefusal(ok, NOW)).toBeNull();
  });

  it('refuses an event that is not marked as a test event', () => {
    expect(testAttemptRefusal({ ...ok, markedAsTest: false }, NOW)).toContain('not marked as a test event');
  });

  it('refuses a test event that can no longer record an answer', () => {
    const past = { ...ok, event: { ...open, eventDate: '2026-07-12T20:00:00+03:00' } };
    expect(testAttemptRefusal(past, NOW)).toContain('event day has passed');
  });

  it('refuses a contact that does not back exactly one guest', () => {
    expect(testAttemptRefusal({ ...ok, guestCount: 2 }, NOW)).toContain('exactly one');
  });

  it('refuses a number that is not on the allowlist', () => {
    expect(testAttemptRefusal({ ...ok, phoneAllowed: false }, NOW)).toContain('VOX_TEST_NUMBERS');
  });
});
