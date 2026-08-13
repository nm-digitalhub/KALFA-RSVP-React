import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { pickActiveCalendarWindow } from './provider';

// Outlook/Exchange presence-sync research (12.8): this function is the SINGLE
// place "what counts as busy right now" is computed for calendar-derived
// presence — shared (in intent, if not yet in code — see
// console-agent-calendar-presence.ts's module header) by the interactive
// admin-avatar dot and the console-agent worker sync. Correctness here is
// what stands between a real meeting and a false "available" (or vice versa).
describe('pickActiveCalendarWindow (pure)', () => {
  const NOW = Date.parse('2026-08-12T12:00:00.000Z');

  it('returns null when nothing intersects "now"', () => {
    expect(pickActiveCalendarWindow([], NOW)).toBeNull();
    expect(
      pickActiveCalendarWindow(
        [
          {
            start: new Date('2026-08-12T13:00:00.000Z'), // future
            end: new Date('2026-08-12T14:00:00.000Z'),
            showAs: 'busy',
          },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it('ignores free-marked items even when they intersect "now"', () => {
    expect(
      pickActiveCalendarWindow(
        [
          {
            start: new Date('2026-08-12T11:00:00.000Z'),
            end: new Date('2026-08-12T13:00:00.000Z'),
            showAs: 'free',
          },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it('picks the single blocking window in effect, returning its end as epoch ms', () => {
    const endMs = Date.parse('2026-08-12T12:30:00.000Z');
    const result = pickActiveCalendarWindow(
      [{ start: new Date('2026-08-12T11:30:00.000Z'), end: new Date(endMs), showAs: 'busy' }],
      NOW,
    );
    expect(result).toEqual({ showAs: 'busy', endMs });
  });

  it('start<=now<end is INCLUSIVE of start, EXCLUSIVE of end (a meeting that just ended does not count)', () => {
    // Ends exactly at NOW — must NOT be picked.
    expect(
      pickActiveCalendarWindow(
        [{ start: new Date(NOW - 3_600_000), end: new Date(NOW), showAs: 'busy' }],
        NOW,
      ),
    ).toBeNull();
    // Starts exactly at NOW — MUST be picked.
    expect(
      pickActiveCalendarWindow(
        [{ start: new Date(NOW), end: new Date(NOW + 3_600_000), showAs: 'busy' }],
        NOW,
      ),
    ).not.toBeNull();
  });

  it('ranks OOF > Busy > WorkingElsewhere > Tentative when several windows overlap', () => {
    const base = { start: new Date(NOW - 60_000), end: new Date(NOW + 60_000) };
    const items = [
      { ...base, showAs: 'tentative' as const },
      { ...base, showAs: 'working_elsewhere' as const },
      { ...base, showAs: 'oof' as const },
      { ...base, showAs: 'busy' as const },
    ];
    // Order shuffled on purpose — the ranking, not array position, must decide.
    expect(pickActiveCalendarWindow([items[0], items[2], items[3], items[1]], NOW)?.showAs).toBe(
      'oof',
    );
    expect(pickActiveCalendarWindow([items[0], items[1], items[3]], NOW)?.showAs).toBe('busy');
    expect(pickActiveCalendarWindow([items[0], items[1]], NOW)?.showAs).toBe('working_elsewhere');
    expect(pickActiveCalendarWindow([items[0]], NOW)?.showAs).toBe('tentative');
  });
});
