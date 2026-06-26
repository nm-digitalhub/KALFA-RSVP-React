import { describe, expect, it, vi } from 'vitest';

// campaigns.ts begins with `import 'server-only'`; computeCeiling is pure.
vi.mock('server-only', () => ({}));

import { computeCeiling } from '@/lib/data/campaigns';

describe('computeCeiling', () => {
  it('is price-per-reached × max contacts (the billing ceiling, §7)', () => {
    expect(computeCeiling(2.5, 100)).toBe(250);
    expect(computeCeiling(4, 250)).toBe(1000);
  });

  it('rounds to agorot (2 decimals), no float drift', () => {
    expect(computeCeiling(0.1, 3)).toBe(0.3); // not 0.30000000000000004
    expect(computeCeiling(1.234, 1)).toBe(1.23); // rounds down
    expect(computeCeiling(1.236, 1)).toBe(1.24); // rounds up
  });
});
