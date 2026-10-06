import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  OWNER_AGENT_REPLY_EXPIRE_SECONDS,
  OWNER_AGENT_REPLY_QUEUE_POLICY,
  OWNER_AGENT_STOP_TIMEOUT_MS,
} from '@/lib/owner-agent/consumer/budgets';
import { STRANDED_AFTER_MS } from '@/lib/owner-agent/consumer/sweep';

import {
  REPORT_CATCH_UP_MS,
  REPORT_EXPIRE_SECONDS,
  REPORT_MAX_MS,
  REPORT_MODEL_MAX_MS,
  REPORT_QUEUE_POLICY,
  REPORT_STRANDED_AFTER_MS,
  reportRetryChainMs,
} from './budgets';

// The chain in budgets.ts, asserted rather than left to agree by hand. The
// last link is the CONSUMER's stop timeout, imported from consumer/budgets.ts:
// a graceful stop must wait for a report in flight exactly as for an answer.

describe('report budgets', () => {
  it('one report < expireInSeconds < the consumer stop timeout', () => {
    expect(REPORT_MAX_MS).toBeLessThan(REPORT_EXPIRE_SECONDS * 1000);
    expect(REPORT_EXPIRE_SECONDS * 1000).toBeLessThan(OWNER_AGENT_STOP_TIMEOUT_MS);
  });

  it('the queue policy carries the expiry', () => {
    expect(REPORT_QUEUE_POLICY.expireInSeconds).toBe(REPORT_EXPIRE_SECONDS);
  });

  it('every retry of a report still lands inside the catch-up window', () => {
    // 150 + (30 + 150) + (60 + 150) seconds.
    expect(reportRetryChainMs()).toBe(540_000);
    expect(reportRetryChainMs()).toBeLessThan(REPORT_CATCH_UP_MS);
  });

  it('a stranded run is re-enqueued only after its job had time to start, and long before the window closes', () => {
    expect(REPORT_STRANDED_AFTER_MS).toBe(STRANDED_AFTER_MS);
    expect(REPORT_STRANDED_AFTER_MS).toBeLessThan(REPORT_CATCH_UP_MS);
  });

  it('a model report fits inside the REPLY queue it runs on, retries included', () => {
    expect(REPORT_MODEL_MAX_MS).toBeLessThan(OWNER_AGENT_REPLY_EXPIRE_SECONDS * 1000);
    expect(OWNER_AGENT_REPLY_QUEUE_POLICY.expireInSeconds).toBe(OWNER_AGENT_REPLY_EXPIRE_SECONDS);
    expect(reportRetryChainMs(OWNER_AGENT_REPLY_QUEUE_POLICY)).toBeLessThan(REPORT_CATCH_UP_MS);
  });
});
