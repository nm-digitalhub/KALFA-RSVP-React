import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
  requirePlatformPermission: vi.fn(),
  // The source imports getOrgContext from THIS module (not '@/lib/data/orgs' —
  // that path is never actually called by exchange-connections.ts). Fixed
  // activeOrgId so createExchangeConnection's per_org branch doesn't hit the
  // real cookie-based getOrgContext (unmockable here — needs next/headers).
  getOrgContext: vi.fn(async () => ({ activeOrgId: 'org-1' })),
}));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import {
  createExchangeConnection,
  getExchangeConnectionMode,
  listMyExchangeConnections,
  revokeExchangeConnection,
} from '@/lib/data/exchange-connections';

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

/**
 * A per-table-aware admin double for the mode-aware authorization tests
 * below. `app_settings` answers `getExchangeConnectionMode()`;
 * `exchange_connections` answers with `connectionRows` regardless of filter
 * (mirrors what a real per_org query — no user_id filter — would return) and
 * records every `.eq()`/`.update()` call it saw so a test can assert whether
 * `user_id` was actually filtered on.
 */
function mockAdminModeAware(opts: {
  mode: 'per_user' | 'per_org';
  connectionRows: Row[];
  onUpdate?: (patch: Row) => void;
}) {
  const calls: { table: string; eq: [string, unknown][]; op: string }[] = [];
  vi.mocked(createAdminClient).mockReturnValue({
    from: (table: string) => {
      const record = { table, eq: [] as [string, unknown][], op: 'select' };
      calls.push(record);
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        update: (patch: Row) => {
          record.op = 'update';
          opts.onUpdate?.(patch);
          return chain;
        },
        eq: (col: string, val: unknown) => {
          record.eq.push([col, val]);
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve(
            table === 'app_settings'
              ? { data: { exchange_connection_mode: opts.mode }, error: null }
              : { data: opts.connectionRows[0] ?? null, error: null },
          ),
        then: (f: (v: unknown) => unknown) =>
          f({
            data: table === 'exchange_connections' ? opts.connectionRows : null,
            error: null,
          }),
      };
      return chain;
    },
  } as unknown as ReturnType<typeof createAdminClient>);
  return { calls };
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

// Incident 2026-08-23: the admin calendar page showed "no verified Exchange
// connection" while a perfectly valid, verified row existed — because every
// read here stayed scoped to `user_id` regardless of the configured
// exchange_connection_mode. 'per_org' is supposed to mean "shared with every
// admin who has manage_settings"; these pin the fix — that mode actually
// drops the user_id filter — and guard the correctness-critical duplicate
// check in createExchangeConnection (two admins each getting their own
// 'verified' row for the same shared mailbox would make the automated
// scheduler's loadBusinessConnection refuse with 'ambiguous_connection' and
// silently halt every calendar-driven callback in the system).
describe('exchange_connection_mode = per_org — the 2026-08-23 visibility bug', () => {
  it('getExchangeConnectionMode reads the configured mode', async () => {
    mockAdminModeAware({ mode: 'per_org', connectionRows: [] });
    expect(await getExchangeConnectionMode()).toBe('per_org');
    mockAdminModeAware({ mode: 'per_user', connectionRows: [] });
    expect(await getExchangeConnectionMode()).toBe('per_user');
  });

  it('per_user mode still filters exchange_connections by the caller\'s own user_id (unchanged behavior)', async () => {
    const { calls } = mockAdminModeAware({
      mode: 'per_user',
      connectionRows: [{ id: 'c1', user_id: 'user-1', status: 'verified', mailbox_email: 'x@kalfa.me' }],
    });
    const rows = await listMyExchangeConnections();
    expect(rows).toHaveLength(1);
    const connCall = calls.find((c) => c.table === 'exchange_connections');
    expect(connCall?.eq).toContainEqual(['user_id', 'user-1']);
  });

  it('per_org mode returns every row and does NOT filter by user_id — the actual fix', async () => {
    const { calls } = mockAdminModeAware({
      mode: 'per_org',
      // A row created under a DIFFERENT user_id than the current session's —
      // exactly the shape that reproduced the bug live.
      connectionRows: [
        { id: 'c1', user_id: 'some-other-admin', status: 'verified', mailbox_email: 'office@kalfa.me' },
      ],
    });
    const rows = await listMyExchangeConnections();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('verified');
    const connCall = calls.find((c) => c.table === 'exchange_connections');
    expect(connCall?.eq.some(([col]) => col === 'user_id')).toBe(false);
  });

  it('per_org mode: revokeExchangeConnection does not require the caller to be the original connector', async () => {
    const { calls } = mockAdminModeAware({
      mode: 'per_org',
      connectionRows: [{ id: 'c1', user_id: 'some-other-admin', status: 'verified' }],
    });
    await revokeExchangeConnection('c1');
    const updateCall = calls.find((c) => c.table === 'exchange_connections' && c.op === 'update');
    expect(updateCall?.eq).toContainEqual(['id', 'c1']);
    expect(updateCall?.eq.some(([col]) => col === 'user_id')).toBe(false);
  });

  it('per_user mode: revokeExchangeConnection still scopes the update to the caller', async () => {
    const { calls } = mockAdminModeAware({
      mode: 'per_user',
      connectionRows: [{ id: 'c1', user_id: 'user-1', status: 'verified' }],
    });
    await revokeExchangeConnection('c1');
    const updateCall = calls.find((c) => c.table === 'exchange_connections' && c.op === 'update');
    expect(updateCall?.eq).toContainEqual(['user_id', 'user-1']);
  });

  it('per_org mode: createExchangeConnection\'s duplicate check looks ORG-WIDE, not just the caller\'s rows', async () => {
    // A DIFFERENT admin already has a verified row for this mailbox — the
    // ambiguous-connection hazard this test exists to prevent.
    const { calls } = mockAdminModeAware({
      mode: 'per_org',
      connectionRows: [
        { id: 'existing', user_id: 'some-other-admin', status: 'verified', mailbox_email: 'office@kalfa.me' },
      ],
    });
    const res = await createExchangeConnection({ mailboxEmail: 'office@kalfa.me' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('משותף') });
    const dupCheck = calls.find(
      (c) => c.table === 'exchange_connections' && c.op === 'select',
    );
    // The lookup must NOT have been narrowed to the caller's own user_id.
    expect(dupCheck?.eq.some(([col]) => col === 'user_id')).toBe(false);
    expect(dupCheck?.eq).toContainEqual(['mailbox_email', 'office@kalfa.me']);
  });
});
