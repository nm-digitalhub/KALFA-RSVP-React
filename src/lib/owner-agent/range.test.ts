import { describe, expect, it } from 'vitest';

import { OWNER_AGENT_RANGES, rangeStartIso } from './range';

describe('rangeStartIso', () => {
  it('the range enum is exactly today | 7d | 30d', () => {
    expect([...OWNER_AGENT_RANGES]).toEqual(['today', '7d', '30d']);
  });

  it("'today' is Israel midnight, not UTC midnight (summer, IDT +03:00)", () => {
    // 22:30 UTC on the 24th is 01:30 on the 25th in Israel: the UTC date and
    // the Israel date differ, so a UTC-midnight or slice(0,10) bug shows here.
    const now = Date.parse('2026-09-24T22:30:00Z');
    expect(rangeStartIso('today', now)).toBe('2026-09-24T21:00:00.000Z');
  });

  it("'today' is Israel midnight in winter (IST +02:00)", () => {
    const now = Date.parse('2026-01-15T23:30:00Z'); // 01:30 on the 16th in Israel
    expect(rangeStartIso('today', now)).toBe('2026-01-15T22:00:00.000Z');
  });

  it("'today' mid-day: same Israel and UTC date", () => {
    const now = Date.parse('2026-09-24T10:00:00Z'); // 13:00 Israel
    expect(rangeStartIso('today', now)).toBe('2026-09-23T21:00:00.000Z');
  });

  it("'7d' and '30d' are rolling N × 24h windows ending now", () => {
    const now = Date.parse('2026-09-24T22:30:00Z');
    expect(rangeStartIso('7d', now)).toBe('2026-09-17T22:30:00.000Z');
    expect(rangeStartIso('30d', now)).toBe('2026-08-25T22:30:00.000Z');
  });
});
