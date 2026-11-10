import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/exchange-ews/mailbox-credential', () => ({ resolveMailboxPassword: vi.fn() }));

import { resolveMailboxPassword } from '@/lib/exchange-ews/mailbox-credential';
import type { createAdminClient } from '@/lib/supabase/admin';
import { loadBusinessExchangeConnection } from './exchange-business-connection';

type Admin = ReturnType<typeof createAdminClient>;

function adminWith(result: { data: unknown; error: unknown }): Admin {
  const builder = { select: () => builder, eq: () => builder, limit: () => Promise.resolve(result) };
  return { from: () => builder } as unknown as Admin;
}

const ROW = { id: 'c1', mailbox_email: 'office@example.test', auth_method: 'something-else' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveMailboxPassword).mockReturnValue('pw');
});

describe('loadBusinessExchangeConnection', () => {
  it('returns the single verified connection, with an unexpected auth method narrowed', async () => {
    await expect(loadBusinessExchangeConnection(adminWith({ data: [ROW], error: null }))).resolves.toEqual({
      ok: true,
      connection: { id: 'c1', config: { mailboxEmail: 'office@example.test', password: 'pw', authMethod: 'ntlm' } },
    });
  });

  it('refuses rather than guesses', async () => {
    const reason = async (result: { data: unknown; error: unknown }) => {
      const loaded = await loadBusinessExchangeConnection(adminWith(result));
      return loaded.ok ? null : loaded.reason;
    };
    expect(await reason({ data: null, error: { message: 'x' } })).toBe('connection_lookup_failed');
    expect(await reason({ data: [], error: null })).toBe('no_verified_connection');
    expect(await reason({ data: [ROW, { ...ROW, id: 'c2' }], error: null })).toBe('ambiguous_connection');
  });

  it('fails closed when the mailbox credential cannot be resolved', async () => {
    vi.mocked(resolveMailboxPassword).mockImplementation(() => {
      throw new Error('no key');
    });
    await expect(loadBusinessExchangeConnection(adminWith({ data: [ROW], error: null }))).resolves.toEqual({
      ok: false,
      reason: 'decrypt_failed',
    });
  });
});
