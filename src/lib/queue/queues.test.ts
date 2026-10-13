import { describe, expect, it } from 'vitest';

import { CALL_RETRY, isFinalDelivery } from './queues';

describe('isFinalDelivery', () => {
  const limit = CALL_RETRY.retryLimit;

  it('is false on every delivery before the last one', () => {
    for (let retryCount = 0; retryCount < limit; retryCount += 1) {
      expect(isFinalDelivery({ retryCount, retryLimit: limit }), `retryCount ${retryCount}`).toBe(false);
    }
  });

  it('is true when the retry count has reached the limit', () => {
    expect(isFinalDelivery({ retryCount: limit, retryLimit: limit })).toBe(true);
  });

  it('stays true past the limit (a row advanced further than its limit is still final)', () => {
    expect(isFinalDelivery({ retryCount: limit + 1, retryLimit: limit })).toBe(true);
  });

  it('a job with no retries allowed is final on its first delivery', () => {
    expect(isFinalDelivery({ retryCount: 0, retryLimit: 0 })).toBe(true);
  });
});
