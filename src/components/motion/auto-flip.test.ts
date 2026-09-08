import { describe, expect, it } from 'vitest';

import { autoFlipDelay, frontImageState } from './auto-flip';

const timing = { autoFlipMs: 1400, dwellMs: 2500 };

describe('frontImageState', () => {
  it('no image → none; not complete → pending; complete with pixels → loaded; complete without → failed', () => {
    expect(frontImageState(null)).toBe('none');
    expect(frontImageState({ complete: false, naturalWidth: 0 })).toBe('pending');
    expect(frontImageState({ complete: true, naturalWidth: 540 })).toBe('loaded');
    expect(frontImageState({ complete: true, naturalWidth: 0 })).toBe('failed');
  });
});

describe('autoFlipDelay (the flip never hides an invitation the guest has not seen)', () => {
  it('no image: the plain timer from mount (unchanged behaviour)', () => {
    expect(autoFlipDelay('none', 0, timing)).toBe(1400);
  });

  it('image still loading: nothing is scheduled — the load/error event schedules it', () => {
    expect(autoFlipDelay('pending', 0, timing)).toBeNull();
    expect(autoFlipDelay('pending', 5000, timing)).toBeNull();
  });

  it('image loaded: dwell on it — 2.5s from the moment it became visible', () => {
    expect(autoFlipDelay('loaded', 0, timing)).toBe(2500); // load event just fired, or cached at mount
    expect(autoFlipDelay('loaded', 1000, timing)).toBe(1500);
    expect(autoFlipDelay('loaded', 9000, timing)).toBe(0);
  });

  it('image failed: fall back to the plain timer counted from mount, never negative', () => {
    expect(autoFlipDelay('failed', 0, timing)).toBe(1400);
    expect(autoFlipDelay('failed', 600, timing)).toBe(800);
    expect(autoFlipDelay('failed', 3000, timing)).toBe(0);
  });
});
