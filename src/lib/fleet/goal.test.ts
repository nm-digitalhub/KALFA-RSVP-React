import { describe, expect, it } from 'vitest';

import { goalWakeAtSchema, isGoalCloseStuck, isGoalProgressStuck } from './goal';

describe('goalWakeAtSchema', () => {
  it('rejects the naive datetime-local form outright', () => {
    expect(goalWakeAtSchema.safeParse('2026-07-29T22:19').success).toBe(false);
  });

  it('accepts a Z-suffixed or explicit-offset value', () => {
    expect(goalWakeAtSchema.safeParse('2026-07-29T19:19:00.000Z').success).toBe(true);
    expect(goalWakeAtSchema.safeParse('2026-07-29T22:19+03:00').success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(goalWakeAtSchema.safeParse('').success).toBe(false);
  });
});

describe('isGoalProgressStuck / isGoalCloseStuck', () => {
  it('treats only the success outcome as not-stuck', () => {
    expect(isGoalProgressStuck('advanced')).toBe(false);
    for (const o of ['paused_on_failures', 'stale_step', 'not_active', 'not_found'] as const) {
      expect(isGoalProgressStuck(o)).toBe(true);
    }

    expect(isGoalCloseStuck('closed')).toBe(false);
    for (const o of ['stale_step', 'not_found', 'already_closed'] as const) {
      expect(isGoalCloseStuck(o)).toBe(true);
    }
  });
});
