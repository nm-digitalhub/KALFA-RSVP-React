import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { closedEventRefusal } from './dial-preconditions';

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
    // as "after" them — a guard that passes no matter where the gate sits. This
    // test failed exactly that way when first written.
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

  it('keeps the override explicit and opt-in', () => {
    // Testing the audio path on a closed event is legitimate; doing it by
    // accident is what made three worthless calls look like a success.
    expect(launcher).toContain('allow-closed-event');
    // main() only — the header comment documents the flag too, and matching that
    // would place the "override" before the gate and prove nothing.
    const body = launcher.slice(launcher.indexOf('async function main'));
    const gate = body.indexOf('closedEventRefusal(cctx)');
    const override = body.indexOf("flag('allow-closed-event')");
    expect(override).toBeGreaterThan(gate); // the override sits inside the refusal branch
  });
});
