import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createFakeTableClient } from '@/test/fake-table-client';
import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { recordStaffAccess } from './access-log';
import {
  getUserDetail,
  grantBillingCredit,
  listAllUsers,
  setUserSuspended,
  voidBillingCredit,
} from './users';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('./access-log', () => ({ recordStaffAccess: vi.fn() }));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

// Wire createAdminClient() to a double whose awaited chains resolve to `result`
// (including the `count` used by the last-staff guard). Also attaches an
// `auth.admin.updateUserById` stub (ok by default) so setUserSuspended's ban
// call resolves.
function wireAdminClient(result: { data: unknown; error: unknown; count?: number }) {
  const { client } = createMockSupabase(result as never);
  const withAuth = {
    ...client,
    auth: { admin: { updateUserById: vi.fn(async () => ({ data: {}, error: null })) } },
  };
  vi.mocked(createAdminClient).mockReturnValue(
    withAuth as unknown as ReturnType<typeof createAdminClient>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
});

// The "must remain at least one" protection lives on the platform_staff axis:
// `platform_staff_prevent_last_owner` is a DB trigger (so it holds against any
// writer, not just this one) and `assignStaffRole` adds the role-change case the
// trigger cannot see, since the trigger fires on DELETE.


describe('getUserDetail — break-glass audit', () => {
  const REASON = 'בירור פנייה בנושא חיוב עבור החשבון של המשתמש';

  // The audit runs BEFORE getUserById, so returning an error there short-circuits
  // the read — enough to assert whether the audit row was (not) recorded without
  // mocking every downstream table chain.
  function wireGetUserByIdError() {
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: null,
            error: { message: 'not found' },
          })),
        },
      },
      from: vi.fn(),
    } as unknown as ReturnType<typeof createAdminClient>);
  }

  it('records a break-glass audit (subject_type user + reason) when viewing ANOTHER user', async () => {
    wireGetUserByIdError();
    await getUserDetail('u-2', REASON);
    expect(recordStaffAccess).toHaveBeenCalledTimes(1);
    expect(recordStaffAccess).toHaveBeenCalledWith({
      staffId: 'admin-1',
      permission: 'manage_staff',
      subjectType: 'user',
      subjectId: 'u-2',
      ownerId: 'u-2',
      reason: REASON,
    });
  });

  it('does NOT record an audit for a self-view (subjectId === staffId)', async () => {
    wireGetUserByIdError();
    await getUserDetail('admin-1');
    expect(recordStaffAccess).not.toHaveBeenCalled();
  });
});

describe('getUserDetail — SUMIT customer number', () => {
  const UID = '44444444-4444-4444-8444-444444444444';
  const REASON = 'בירור פנייה בנושא חיוב עבור החשבון של המשתמש';

  // The whole read path, not just the audit: every table the detail view assembles, plus the auth lookup.
  function wireDetail(sumitRows: Array<Record<string, unknown>>) {
    const db = createFakeTableClient({
      profiles: [{ id: UID, full_name: 'דנה', phone: '0501234567' }],
      platform_staff: [],
      organization_members: [],
      events: [],
      sumit_customers: sumitRows,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      ...db.client,
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: UID, email: 'dana@example.com', created_at: '2026-01-01T00:00:00Z', last_sign_in_at: null, banned_until: null } },
            error: null,
          })),
        },
      },
    } as unknown as ReturnType<typeof createAdminClient>);
    return db;
  }

  it("carries the number SUMIT gave the account being viewed — and not another account's", async () => {
    wireDetail([
      { user_id: 'someone-else', sumit_customer_id: 9 },
      { user_id: UID, sumit_customer_id: 2127277236 },
    ]);
    expect((await getUserDetail(UID, REASON))?.customerNumber).toBe(2127277236);
  });

  it('is null for an account that has not paid yet', async () => {
    wireDetail([]);
    expect((await getUserDetail(UID, REASON))?.customerNumber).toBeNull();
  });

  it('an unreadable number does not take the rest of the user page down with it', async () => {
    const db = wireDetail([{ user_id: UID, sumit_customer_id: 1 }]);
    db.fail('sumit_customers', '57014', 'select');
    const detail = await getUserDetail(UID, REASON);
    expect(detail?.email).toBe('dana@example.com');
    expect(detail?.customerNumber).toBeNull();
  });
});

// How much of a granted credit is still available. What a campaign has already used comes from the payment ledger when
// the campaign has ledger rows (a package purchase), from the old campaigns.credit_applied column otherwise.
describe('getUserDetail — the credit balance counts what the ledger says was used', () => {
  const UID = '44444444-4444-4444-8444-444444444444';
  const REASON = 'בירור פנייה בנושא חיוב עבור החשבון של המשתמש';
  const usedByPurchase = (credit: number) => ({
    campaign_id: 'c1',
    outcome: 'succeeded',
    credit_applied: credit,
    payment_operation_kinds: { effect: 'collect' },
  });

  function wireBalance(campaigns: Array<Record<string, unknown>>, ledger: Array<Record<string, unknown>>) {
    const db = createFakeTableClient({
      profiles: [{ id: UID, full_name: 'דנה', phone: '0501234567' }],
      platform_staff: [],
      organization_members: [],
      events: [{ id: 'e1', name: 'החתונה', owner_id: UID }],
      sumit_customers: [],
      billing_credits: [{ id: 'cr1', event_id: 'e1', campaign_id: null, amount: 100, reason: 'הטבה', created_at: '2026-10-01T00:00:00Z', voided_at: null, void_reason: null }],
      campaigns,
      payment_operations: ledger,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      ...db.client,
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: UID, email: 'dana@example.com', created_at: '2026-01-01T00:00:00Z', last_sign_in_at: null, banned_until: null } },
            error: null,
          })),
        },
      },
    } as unknown as ReturnType<typeof createAdminClient>);
    return db;
  }

  it('credit used through a package purchase is subtracted from what is left', async () => {
    wireBalance([{ id: 'c1', event_id: 'e1', status: 'approved', credit_applied: 0 }], [usedByPurchase(40)]);
    expect((await getUserDetail(UID, REASON))?.creditBalances).toEqual([
      { eventId: 'e1', eventName: 'החתונה', granted: 100, applied: 40, remaining: 60 },
    ]);
  });

  it('a campaign from before the ledger is still read from the old column', async () => {
    wireBalance([{ id: 'c1', event_id: 'e1', status: 'closed', credit_applied: 84 }], []);
    expect((await getUserDetail(UID, REASON))?.creditBalances).toMatchObject([{ applied: 84, remaining: 16 }]);
  });

  it('a campaign recorded in both places is counted once', async () => {
    wireBalance([{ id: 'c1', event_id: 'e1', status: 'closed', credit_applied: 84 }], [usedByPurchase(84)]);
    expect((await getUserDetail(UID, REASON))?.creditBalances).toMatchObject([{ applied: 84, remaining: 16 }]);
  });
});

describe('listAllUsers — search', () => {
  const ID = '11111111-1111-4111-8111-111111111111';

  it('short-circuits a pasted UUID to a direct id lookup (no page scan)', async () => {
    const { client } = createMockSupabase({ data: [], error: null });
    const getUserById = vi.fn(async () => ({
      data: { user: { id: ID, email: 'x@y.z' } },
      error: null,
    }));
    const listUsers = vi.fn(async () => ({ data: { users: [], total: 0 }, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({
      ...client,
      auth: { admin: { getUserById, listUsers } },
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await listAllUsers({ search: ID });

    expect(getUserById).toHaveBeenCalledWith(ID);
    expect(listUsers).not.toHaveBeenCalled();
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe(ID);
  });

  it('sanitizes the term for the profiles .or() filter (no wildcard/paren injection)', async () => {
    let orArg = '';
    const profilesBuilder: Record<string, unknown> = {};
    profilesBuilder.select = vi.fn(() => profilesBuilder);
    profilesBuilder.or = vi.fn((a: string) => {
      orArg = a;
      return profilesBuilder;
    });
    profilesBuilder.limit = vi.fn(async () => ({ data: [], error: null }));
    const listUsers = vi.fn(async () => ({
      data: { users: [], total: 0, nextPage: null },
      error: null,
    }));
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => profilesBuilder),
      auth: { admin: { listUsers } },
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await listAllUsers({ search: 'a%b,(c)"d' });

    // %, comma, parens and quote are stripped → "abcd"; the ilike pattern is
    // rebuilt around the safe term.
    expect(orArg).toBe('full_name.ilike.%abcd%,phone.ilike.%abcd%');
    expect(res.items).toEqual([]);
  });
});

describe('grantBillingCredit — owner scoping', () => {
  // The submitted event id is never trusted for ownership: the credit may only
  // land on an event the target user actually owns.
  it('rejects when the chosen event is not owned by the target user', async () => {
    wireAdminClient({ data: { id: 'e1', owner_id: 'owner-1' }, error: null });
    await expect(
      grantBillingCredit({ eventId: 'e1', amount: 10, reason: 'הטבה', ownerId: 'owner-2' }),
    ).rejects.toThrow('אינו שייך למשתמש');
  });

  it('allows when the event owner matches the target user', async () => {
    wireAdminClient({ data: { id: 'e1', owner_id: 'owner-1' }, error: null });
    await expect(
      grantBillingCredit({ eventId: 'e1', amount: 10, reason: 'הטבה', ownerId: 'owner-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('voidBillingCredit — soft-void + pool-invariant guard', () => {
  type Row = Record<string, unknown>;
  function wireVoid({
    credit,
    ownerId = 'owner-1',
    pool = [] as Row[],
    applied = [] as Row[],
    ledger = [] as Row[],
    ledgerError = false,
    updated = { id: 'cr1' } as Row | null,
  }: {
    credit: Row | null;
    ownerId?: string;
    pool?: Row[];
    applied?: Row[];
    // payment_operations rows of the event's campaigns (credit used through the payment ledger)
    ledger?: Row[];
    ledgerError?: boolean;
    updated?: Row | null;
  }) {
    const billingCredits = {
      select: vi.fn((cols: string) =>
        String(cols).includes('voided_at') && String(cols).includes('event_id')
          ? // credit fetch: .eq('id').maybeSingle()
            { eq: vi.fn(() => ({ maybeSingle: async () => ({ data: credit, error: null }) })) }
          : // active pool: .eq('event_id').is('voided_at', null)  (awaited)
            { eq: vi.fn(() => ({ is: vi.fn(async () => ({ data: pool, error: null })) })) },
      ),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            select: vi.fn(() => ({ maybeSingle: async () => ({ data: updated, error: null }) })),
          })),
        })),
      })),
    };
    const events = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: async () => ({ data: { owner_id: ownerId }, error: null }) })),
      })),
    };
    const campaigns = {
      select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: applied, error: null })) })),
    };
    const paymentOperations = {
      select: vi.fn(() => ({
        in: vi.fn(async () => (ledgerError ? { data: null, error: { message: 'x' } } : { data: ledger, error: null })),
      })),
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((t: string) =>
        t === 'events'
          ? events
          : t === 'campaigns'
            ? campaigns
            : t === 'payment_operations'
              ? paymentOperations
              : billingCredits,
      ),
    } as unknown as ReturnType<typeof createAdminClient>);
  }

  const REASON = 'תוקן בטעות — סכום שגוי';

  it('rejects an already-voided credit', async () => {
    wireVoid({ credit: { id: 'cr1', event_id: 'e1', amount: 10, voided_at: '2026-07-20T00:00:00Z' } });
    await expect(voidBillingCredit({ creditId: 'cr1', reason: REASON })).rejects.toThrow('כבר בוטל');
  });

  it('rejects when the credit is not owned by the target user', async () => {
    wireVoid({ credit: { id: 'cr1', event_id: 'e1', amount: 10, voided_at: null }, ownerId: 'owner-1' });
    await expect(
      voidBillingCredit({ creditId: 'cr1', reason: REASON, ownerId: 'owner-2' }),
    ).rejects.toThrow('אינו שייך');
  });

  it('blocks voiding a credit already consumed by a settled charge', async () => {
    wireVoid({
      credit: { id: 'cr1', event_id: 'e1', amount: 100, voided_at: null },
      pool: [{ amount: 100 }],
      applied: [{ id: 'c1', credit_applied: 84 }], // poolAfterVoid 0 < consumed 84
    });
    await expect(
      voidBillingCredit({ creditId: 'cr1', reason: REASON, ownerId: 'owner-1' }),
    ).rejects.toThrow('שכבר נוצל');
  });

  it('blocks voiding a credit that a package PURCHASE already used (the old column says 0, the ledger says 50)', async () => {
    wireVoid({
      credit: { id: 'cr1', event_id: 'e1', amount: 100, voided_at: null },
      pool: [{ amount: 100 }],
      applied: [{ id: 'c1', credit_applied: 0 }],
      ledger: [{ campaign_id: 'c1', outcome: 'succeeded', credit_applied: 50, payment_operation_kinds: { effect: 'collect' } }],
    });
    await expect(
      voidBillingCredit({ creditId: 'cr1', reason: REASON, ownerId: 'owner-1' }),
    ).rejects.toThrow('שכבר נוצל');
  });

  it('fails closed when the ledger cannot be read — the credit is not voided on a guess', async () => {
    wireVoid({
      credit: { id: 'cr1', event_id: 'e1', amount: 100, voided_at: null },
      pool: [{ amount: 100 }],
      applied: [{ id: 'c1', credit_applied: 0 }],
      ledgerError: true,
    });
    await expect(voidBillingCredit({ creditId: 'cr1', reason: REASON, ownerId: 'owner-1' })).rejects.toThrow();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('voids an unsettled credit and records the audit + Slack alert', async () => {
    wireVoid({
      credit: { id: 'cr1', event_id: 'e1', amount: 160, voided_at: null },
      pool: [{ amount: 160 }],
      applied: [{ id: 'c1', credit_applied: 0 }], // unsettled → poolAfterVoid 0 >= 0
      updated: { id: 'cr1' },
    });
    await expect(
      voidBillingCredit({ creditId: 'cr1', reason: REASON, ownerId: 'owner-1' }),
    ).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.billing_credit_voided' }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'campaign_billing', title: 'זיכוי בוטל' }),
    );
  });

  it('rejects a too-short reason before any DB call', async () => {
    wireVoid({ credit: { id: 'cr1', event_id: 'e1', amount: 10, voided_at: null } });
    await expect(voidBillingCredit({ creditId: 'cr1', reason: 'ab' })).rejects.toThrow('סיבה');
  });
});

describe('setUserSuspended', () => {
  it('blocks suspending yourself', async () => {
    wireAdminClient({ data: null, error: null });
    await expect(setUserSuspended('admin-1', true)).rejects.toThrow('עצמך');
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('emits a security warn with the SUSPEND title on a suspend', async () => {
    // data:null → the target is not platform staff, so the last-staff guard passes.
    wireAdminClient({ data: null, error: null });
    await expect(setUserSuspended('u-2', true)).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'security',
        title: 'משתמש הושהה',
        fields: { actorUserId: 'admin-1', targetUserId: 'u-2' },
      }),
    );
  });

  it('emits a security warn with the RESTORE title on a reactivate', async () => {
    wireAdminClient({ data: null, error: null });
    await expect(setUserSuspended('u-2', false)).resolves.toBeUndefined();
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'security',
        title: 'משתמש שוחזר',
        fields: { actorUserId: 'admin-1', targetUserId: 'u-2' },
      }),
    );
  });
});
