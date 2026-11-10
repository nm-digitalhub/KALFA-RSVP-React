import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import {
  countActiveDispatchAttempts,
  DISPATCH_PRE_TERMINAL,
  getAttemptByAccessToken,
  getCallbackRequestContactForAttempt,
  recordAttemptDialConfirmed,
  recordAttemptDispatchConcluded,
  recordAttemptDispatchOutcome,
  setAttemptElConversationId,
} from './dispatch-attempt-store';

type Result = { data?: unknown; error?: unknown; count?: number | null };

// A chainable PostgREST stand-in: every filter returns the builder, the builder
// resolves to the queued result for its table.
function mockAdmin(results: Record<string, Result[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const result = results[table]?.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'update', 'eq', 'in']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(result);
    builder.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
  return { calls, from };
}

const TABLES = ['callback_request_attempts', 'sales_call_attempts'] as const;

beforeEach(() => vi.clearAllMocks());

describe.each(TABLES)('dispatch-attempt-store on %s', (table) => {
  it('confirms a dial only from a pre-terminal status and leaves dispatch_status alone', async () => {
    const { calls } = mockAdmin({ [table]: [{ data: { id: 'a1' }, error: null }] });
    await expect(recordAttemptDialConfirmed(table, 'a1', 42)).resolves.toEqual({ applied: true });
    const update = calls.find((c) => c.method === 'update')!.args[0] as Record<string, unknown>;
    expect(update.vox_call_session_history_id).toBe('42');
    expect(update).not.toHaveProperty('dispatch_status');
    expect(calls).toContainEqual({ table, method: 'eq', args: ['id', 'a1'] });
    expect(calls).toContainEqual({ table, method: 'in', args: ['dispatch_status', DISPATCH_PRE_TERMINAL] });
  });

  it('reports applied:false when the guarded update matched no row', async () => {
    mockAdmin({ [table]: [{ data: null, error: null }] });
    await expect(recordAttemptDispatchOutcome(table, 'a1', 'start_unknown', 'r')).resolves.toEqual({ applied: false });
  });

  it('writes the terminal status behind the same pre-terminal guard', async () => {
    const { calls } = mockAdmin({ [table]: [{ data: { id: 'a1' }, error: null }] });
    await recordAttemptDispatchConcluded(table, 'a1', 'completed', 31);
    expect(calls.find((c) => c.method === 'update')!.args[0]).toMatchObject({
      dispatch_status: 'concluded',
      finish_reason: 'completed',
      call_duration_sec: 31,
    });
    expect(calls).toContainEqual({ table, method: 'in', args: ['dispatch_status', DISPATCH_PRE_TERMINAL] });
  });

  it('sets the conversation id without a dispatch_status guard', async () => {
    const { calls } = mockAdmin({ [table]: [{ data: { id: 'a1' }, error: null }] });
    await setAttemptElConversationId(table, 'a1', 'conv_1');
    expect(calls.some((c) => c.method === 'in')).toBe(false);
  });

  it('throws on a failed write and on a failed count', async () => {
    mockAdmin({ [table]: [{ data: null, error: { message: 'x' } }, { count: null, error: { message: 'x' } }] });
    await expect(recordAttemptDialConfirmed(table, 'a1', 1)).rejects.toThrow('רישום אימות החיוג נכשל');
    await expect(countActiveDispatchAttempts(table, 'count_failed')).rejects.toThrow('count_failed');
  });

  it('counts pre-terminal rows', async () => {
    const { calls } = mockAdmin({ [table]: [{ count: 3, error: null }] });
    await expect(countActiveDispatchAttempts(table, 'count_failed')).resolves.toBe(3);
    expect(calls).toContainEqual({ table, method: 'in', args: ['dispatch_status', DISPATCH_PRE_TERMINAL] });
  });

  it('looks an attempt up by access token and never selects the token back', async () => {
    const row = { id: 'a1', callback_request_id: 'r1', token_expires_at: '2026-01-01T00:00:00Z' };
    const { calls } = mockAdmin({ [table]: [{ data: row, error: null }] });
    await expect(getAttemptByAccessToken(table, 'tok', 'msg')).resolves.toEqual(row);
    expect(calls).toContainEqual({ table, method: 'eq', args: ['access_token', 'tok'] });
    expect(String(calls.find((c) => c.method === 'select')!.args[0])).not.toContain('access_token');
  });

  it('resolves the parent request contact, or null when either row is missing', async () => {
    mockAdmin({
      [table]: [{ data: { callback_request_id: 'r1' }, error: null }],
      callback_requests: [{ data: { full_name: 'דנה', phone: '+972500000000', topic: null }, error: null }],
    });
    await expect(getCallbackRequestContactForAttempt(table, 'a1', 'msg')).resolves.toEqual({
      callbackRequestId: 'r1',
      fullName: 'דנה',
      phone: '+972500000000',
      topic: null,
    });

    mockAdmin({ [table]: [{ data: null, error: null }] });
    await expect(getCallbackRequestContactForAttempt(table, 'a1', 'msg')).resolves.toBeNull();
  });
});
