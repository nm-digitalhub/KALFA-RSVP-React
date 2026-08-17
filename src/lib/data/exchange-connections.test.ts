import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
  requirePlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/orgs', () => ({ getOrgContext: vi.fn(async () => ({ activeOrgId: null })) }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createExchangeConnection } from '@/lib/data/exchange-connections';

type Row = Record<string, unknown>;

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

beforeEach(() => vi.clearAllMocks());

// This is a credential-COLLECTING entry point reachable from a live admin form
// at /admin/settings, so what it does with a secret is worth pinning exactly.
//
// It used to demand a mailbox password, encrypt it, and store it forever — for a
// connection Graph authenticates with the application certificate and which
// never read the stored value. With the EWS backend removed there is no longer
// any provider that wants one, so the honest answer is that nothing is stored.
describe('createExchangeConnection', () => {
  it('stores NO credential, and says certificate in auth_method', async () => {
    const inserts: Row[] = [];
    mockAdmin(inserts);

    const res = await createExchangeConnection({ mailboxEmail: 'office@kalfa.me' });

    expect(res.ok).toBe(true);
    expect(inserts[0]).toMatchObject({
      mailbox_email: 'office@kalfa.me',
      auth_method: 'certificate',
      credential_ciphertext: null,
      credential_iv: null,
      credential_auth_tag: null,
    });
  });

  // Nothing should be persisted even if a password reaches the action — a stale
  // form, a replayed POST, a client that kept the old field. Storing it would
  // recreate precisely the surface this removed.
  it('persists nothing when a password arrives anyway', async () => {
    const inserts: Row[] = [];
    mockAdmin(inserts);

    await createExchangeConnection({ mailboxEmail: 'office@kalfa.me', password: 'hunter2' });

    const row = inserts[0] as Record<string, unknown>;
    expect(row.credential_ciphertext).toBeNull();
    // The password must not have leaked into any other column either.
    expect(JSON.stringify(row)).not.toContain('hunter2');
  });
});
