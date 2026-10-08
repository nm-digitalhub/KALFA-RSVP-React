import { describe, expect, it } from 'vitest';

import { formatCountdown, percentLeft, spokenRemaining } from './countdown';

describe('formatCountdown', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatCountdown((58 * 60 + 12) * 1000, { hours: true })).toBe('00:58:12');
    expect(formatCountdown(3_600_000, { hours: true })).toBe('01:00:00');
  });

  it('folds hours into minutes when asked for MM:SS', () => {
    expect(formatCountdown(24 * 60_000, { hours: false })).toBe('24:00');
    expect(formatCountdown(90 * 60_000 + 5_000, { hours: false })).toBe('90:05');
  });

  it('rounds up so a partial second still shows as left, and never goes negative', () => {
    expect(formatCountdown(1, { hours: false })).toBe('00:01');
    expect(formatCountdown(0, { hours: false })).toBe('00:00');
    expect(formatCountdown(-5000, { hours: true })).toBe('00:00:00');
  });
});

describe('percentLeft', () => {
  it('is a clamped whole percent', () => {
    expect(percentLeft(30, 100)).toBe(30);
    expect(percentLeft(-5, 100)).toBe(0);
    expect(percentLeft(500, 100)).toBe(100);
    expect(percentLeft(1, 0)).toBe(0);
  });
});

describe('spokenRemaining', () => {
  it('reads minutes and seconds', () => {
    expect(spokenRemaining((58 * 60 + 12) * 1000)).toBe('58 דקות ו-12 שניות');
    expect(spokenRemaining(60_000)).toBe('1 דקות');
    expect(spokenRemaining(45_000)).toBe('45 שניות');
  });
});
