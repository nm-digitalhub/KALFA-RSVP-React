import { describe, expect, it } from 'vitest';

import { asEventType, formatEventDateLine } from '@/lib/data/event-display';

describe('asEventType', () => {
  it('passes through valid enum values', () => {
    expect(asEventType('wedding')).toBe('wedding');
    expect(asEventType('brit')).toBe('brit');
  });

  it('falls back to "other" for unknown/null', () => {
    expect(asEventType('nope')).toBe('other');
    expect(asEventType(null)).toBe('other');
    expect(asEventType('')).toBe('other');
  });
});

describe('formatEventDateLine', () => {
  it('returns null for empty/invalid input', () => {
    expect(formatEventDateLine(null)).toBeNull();
    expect(formatEventDateLine('not-a-date')).toBeNull();
  });

  it('includes the Israel Gregorian date and time for a timestamptz with a time', () => {
    const line = formatEventDateLine('2026-07-12T14:30:00+00:00');
    expect(line).toContain('12.07.2026'); // 14:30 UTC → Israel same day
    expect(line).toContain('17:30'); // +3h IDT
  });
});
