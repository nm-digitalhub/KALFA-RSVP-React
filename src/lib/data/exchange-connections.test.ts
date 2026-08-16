import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
  requirePlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/orgs', () => ({ getOrgContext: vi.fn(async () => ({ activeOrgId: null })) }));
vi.mock('@/lib/exchange-ews/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/exchange-ews/crypto')>();
  return {
    ...actual,
    encryptCredential: vi.fn(() => ({
      ciphertext: 'ct',
      iv: 'iv',
      authTag: 'tag',
      keyVersion: 1,
    })),
  };
});

import { createAdminClient } from '@/lib/supabase/admin';
import { encryptCredential } from '@/lib/exchange-ews/crypto';
import { createExchangeConnection } from '@/lib/data/exchange-connections';

type Row = Record<string, unknown>;

// Two awaited chains: the app_settings mode read, then the existing-row lookup.
// Both resolve empty so the fresh-insert path runs.
function mockAdmin(inserts: Row[]) {
  const chain: Record<string, unknown> = {
    insert(row: Row) {
      inserts.push(row);
      return Promise.resolve({ error: null });
    },
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (f: (v: unknown) => unknown) => f({ data: null, error: null }),
  };
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => chain,
  } as unknown as ReturnType<typeof createAdminClient>);
}

const original = process.env.EXCHANGE_PROVIDER;
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  if (original === undefined) delete process.env.EXCHANGE_PROVIDER;
  else process.env.EXCHANGE_PROVIDER = original;
});

// This is a credential-COLLECTING entry point reachable from a live admin form,
// so what it does with a secret is worth pinning precisely.
describe('createExchangeConnection — the credential is provider-conditional', () => {
  it('stores NO secret under graph, and says so in auth_method', async () => {
    delete process.env.EXCHANGE_PROVIDER; // graph is the default
    const inserts: Row[] = [];
    mockAdmin(inserts);

    const res = await createExchangeConnection({ mailboxEmail: 'office@kalfa.me' });

    expect(res.ok).toBe(true);
    // Never called: nothing should encrypt a secret that authenticates nothing.
    expect(encryptCredential).not.toHaveBeenCalled();
    expect(inserts[0]).toMatchObject({
      auth_method: 'certificate',
      credential_ciphertext: null,
      credential_iv: null,
      credential_auth_tag: null,
    });
  });

  // Even if a password is somehow posted, Graph has no use for it — storing it
  // anyway would recreate exactly the situation this removes.
  it('ignores a password that arrives anyway under graph', async () => {
    delete process.env.EXCHANGE_PROVIDER;
    const inserts: Row[] = [];
    mockAdmin(inserts);

    await createExchangeConnection({ mailboxEmail: 'office@kalfa.me', password: 'hunter2' });

    expect(encryptCredential).not.toHaveBeenCalled();
    expect(inserts[0].credential_ciphertext).toBeNull();
  });

  it('still stores an encrypted secret under ews, where NTLM needs one', async () => {
    process.env.EXCHANGE_PROVIDER = 'ews';
    const inserts: Row[] = [];
    mockAdmin(inserts);

    const res = await createExchangeConnection({
      mailboxEmail: 'office@kalfa.me',
      password: 'hunter2',
    });

    expect(res.ok).toBe(true);
    expect(encryptCredential).toHaveBeenCalledOnce();
    expect(inserts[0]).toMatchObject({
      auth_method: 'ntlm',
      credential_ciphertext: 'ct',
    });
  });

  // The requirement moved from the form schema to here, because only here is the
  // active provider known. It must still be enforced.
  it('refuses under ews when no password was supplied', async () => {
    process.env.EXCHANGE_PROVIDER = 'ews';
    const inserts: Row[] = [];
    mockAdmin(inserts);

    const res = await createExchangeConnection({ mailboxEmail: 'office@kalfa.me' });

    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
