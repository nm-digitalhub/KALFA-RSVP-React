import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// storeCallAnalysis begins with `import 'server-only'` (stub it) and writes via
// the service-role client. The admin client is mocked with a table-branching
// stub: 'call_attempts' resolves the correlation-token lookup; 'call_analysis'
// captures the upsert row so we can assert what is (and isn't) persisted.
vi.mock('server-only', () => ({}));
const { attemptMock, upsertMock } = vi.hoisted(() => ({ attemptMock: vi.fn(), upsertMock: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === 'call_attempts'
        ? { select: () => ({ eq: () => ({ maybeSingle: attemptMock }) }) }
        : { upsert: upsertMock },
  }),
}));

import { storeCallAnalysis } from './elevenlabs-analysis';
import type { NormalizedCallAnalysis } from '@/lib/validation/elevenlabs-payloads';

const base: NormalizedCallAnalysis = {
  conversationId: 'c1',
  agentId: 'a',
  callSuccessful: 'success',
  status: 'done',
  overallScore: 0.9,
  callDurationSecs: 10,
  costCredits: 5,
  terminationReason: 'x',
  analysisAt: '2026-07-19T00:00:00.000Z',
  correlationToken: null,
};

beforeEach(() => {
  attemptMock.mockReset();
  upsertMock.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.clearAllMocks());

describe('storeCallAnalysis (link + persist)', () => {
  it('links to the call attempt when the correlation token matches', async () => {
    attemptMock.mockResolvedValue({ data: { id: 'att-1', event_id: 'evt-1' }, error: null });
    const res = await storeCallAnalysis({ ...base, correlationToken: 'nonce-1' });
    expect(res).toBe('stored');
    const row = upsertMock.mock.calls[0][0];
    expect(row).toMatchObject({ conversation_id: 'c1', call_attempt_id: 'att-1', event_id: 'evt-1' });
    expect(row.linked_at).toBeTruthy();
  });

  it('stores an orphan (nulls) when no token is present — never queries attempts', async () => {
    const res = await storeCallAnalysis(base);
    expect(res).toBe('stored');
    expect(attemptMock).not.toHaveBeenCalled();
    const row = upsertMock.mock.calls[0][0];
    expect(row.call_attempt_id).toBeNull();
    expect(row.event_id).toBeNull();
    expect(row.linked_at).toBeNull();
  });

  it('stores an orphan when the token matches no attempt', async () => {
    attemptMock.mockResolvedValue({ data: null, error: null });
    const res = await storeCallAnalysis({ ...base, correlationToken: 'unknown' });
    expect(res).toBe('stored');
    expect(upsertMock.mock.calls[0][0].call_attempt_id).toBeNull();
  });

  it('still stores (orphan) when the link lookup throws — never fails on linking', async () => {
    attemptMock.mockRejectedValue(new Error('db blip'));
    const res = await storeCallAnalysis({ ...base, correlationToken: 'nonce-1' });
    expect(res).toBe('stored');
    expect(upsertMock.mock.calls[0][0].call_attempt_id).toBeNull();
  });

  it('returns error when the upsert fails', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'boom' } });
    expect(await storeCallAnalysis(base)).toBe('error');
  });
});
