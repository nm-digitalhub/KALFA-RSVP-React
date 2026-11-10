import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/console-calls', () => ({ CONSOLE_DIAL_AUDIT_ACTION: 'console_call.dial_intent' }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { DEFAULT_CALLBACK_POLICY } from '@/lib/callbacks/schedule-policy';
import { createAdminClient } from '@/lib/supabase/admin';
import { countRecentAuditedCallbackDials, recordSystemCallbackDialAudit } from './callback-dial-audit';

type Admin = ReturnType<typeof createAdminClient>;
const policy = { ...DEFAULT_CALLBACK_POLICY, maxAttempts: 3, attemptWindowMs: 60_000 };

function countClient(result: { count: number | null; error: unknown }) {
  const filters: unknown[][] = [];
  const builder = {
    select: () => builder,
    eq: (...args: unknown[]) => (filters.push(['eq', ...args]), builder),
    gte: (...args: unknown[]) => (filters.push(['gte', ...args]), Promise.resolve(result)),
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: () => builder } as unknown as Admin);
  return filters;
}

beforeEach(() => vi.clearAllMocks());

describe('countRecentAuditedCallbackDials', () => {
  it('counts the audited dials of this request inside the policy window', async () => {
    const filters = countClient({ count: 2, error: null });
    await expect(countRecentAuditedCallbackDials('req-1', 1_000_000, policy)).resolves.toBe(2);
    expect(filters).toEqual([
      ['eq', 'action', 'console_call.dial_intent'],
      ['eq', 'meta->>callback_request_id', 'req-1'],
      ['gte', 'created_at', new Date(1_000_000 - 60_000).toISOString()],
    ]);
  });

  it('reads an unreadable count as capped (fail-closed)', async () => {
    countClient({ count: null, error: { message: 'x' } });
    await expect(countRecentAuditedCallbackDials('req-1', 1_000_000, policy)).resolves.toBe(3);
  });
});

describe('recordSystemCallbackDialAudit', () => {
  it('writes the console dial action with no user and the request id only', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ insert }) } as unknown as Admin);
    await recordSystemCallbackDialAudit('req-1');
    expect(insert).toHaveBeenCalledWith({
      event_id: null,
      user_id: null,
      action: 'console_call.dial_intent',
      meta: { callback_request_id: 'req-1' },
    });
  });

  it('never throws when the write cannot be made', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('no client');
    });
    await expect(recordSystemCallbackDialAudit('req-1')).resolves.toBeUndefined();
  });
});
