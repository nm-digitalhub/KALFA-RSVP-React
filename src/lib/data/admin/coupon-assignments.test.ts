import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { listEligibleBenefits } from '@/lib/data/coupon-benefits';
import { createStaffAssignment, listStaffAssignments, lookupStaffAssignmentRecipient, voidStaffAssignment } from './coupon-assignments';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/coupon-benefits', () => ({ listEligibleBenefits: vi.fn() }));

type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

function tableClient(queues: Record<string, Result[]>) {
  const calls: Record<string, Array<Record<string, ReturnType<typeof vi.fn>>>> = {};
  const client = {
    from: vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'single', 'maybeSingle']) {
        builder[m] = vi.fn(() => builder);
      }
      builder.then = (onFulfilled: (value: Result) => unknown) => onFulfilled(result);
      (calls[table] ??= []).push(builder as Record<string, ReturnType<typeof vi.fn>>);
      return builder;
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })),
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return { client, calls };
}

const FUTURE = '2030-01-01T00:00:00.000Z';

const offerRow = {
  id: 'o-1',
  kind: 'percent',
  value: 5,
  validity_days: 14,
  allow_staff: true,
  is_active: true,
  offer_packages: [{ package_id: 'p-1', value_override: null }],
};

const packageRows = [{ id: 'p-1', name: 'בסיס', price_with_vat: 100.5 }];

const input = { userId: 'u-1', offerId: 'o-1', idempotencyKey: 'k-1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'staff-1' } as unknown as User);
  vi.mocked(listEligibleBenefits).mockResolvedValue([]);
});

describe('createStaffAssignment (over the ONE-transaction RPC)', () => {
  function rpcResult(overrides: Record<string, unknown> = {}) {
    return {
      assignment_id: 'a-new',
      kept_assignment_id: 'a-new',
      outcome: 'created',
      duplicate_voided: 'none',
      expires_at: FUTURE,
      ...overrides,
    };
  }

  it('sends the SERVER-computed frozen terms to the transaction (100.50 at 5% → 5.03 / 95.47)', async () => {
    const { client } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
      activity_log: [{ data: null, error: null }],
    });
    client.rpc.mockResolvedValueOnce({ data: rpcResult(), error: null } as never);

    const r = await createStaffAssignment(input);

    expect(client.rpc).toHaveBeenCalledWith('create_staff_coupon_assignment', {
      _staff_id: 'staff-1',
      _user_id: 'u-1',
      _offer_id: 'o-1',
      _idempotency_key: 'k-1',
      _confirmed_options: [
        { package_id: 'p-1', list_price: 100.5, discount_amount: 5.03, final_price: 95.47 },
      ],
    });
    expect(r).toMatchObject({ outcome: 'created', assignmentId: 'a-new', keptAssignmentId: 'a-new' });
    expect(r.options).toEqual([{ packageId: 'p-1', packageName: 'בסיס', listPrice: 100.5, finalPrice: 95.47 }]);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'coupon.assigned' }));
  });

  it('refuses an offer staff may not assign (D14) before any transaction', async () => {
    const { client } = tableClient({
      offers: [{ data: { ...offerRow, allow_staff: false }, error: null }],
    });
    await expect(createStaffAssignment(input)).rejects.toThrow('אינה מוקצית על ידי צוות');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('an idempotent replay ("existing") answers the STORED options — never a fresh computation', async () => {
    const { client } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
      coupon_assignment_options: [
        {
          data: [
            // The stored promise differs from today's price — the answer must carry IT.
            { package_id: 'p-1', list_price: 80, final_price: 76, packages: { name: 'בסיס' } },
          ],
          error: null,
        },
      ],
    });
    client.rpc.mockResolvedValueOnce({
      data: rpcResult({ assignment_id: 'a-old', kept_assignment_id: 'a-old', outcome: 'existing' }),
      error: null,
    } as never);

    const r = await createStaffAssignment(input);

    expect(r).toMatchObject({ assignmentId: 'a-old', outcome: 'existing', duplicateVoided: 'none' });
    expect(r.options).toEqual([{ packageId: 'p-1', packageName: 'בסיס', listPrice: 80, finalPrice: 76 }]);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('a replay whose key served a DIFFERENT request is refused by the transaction', async () => {
    const { client } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
    });
    client.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'assign: key already used for a different request' },
    } as never);

    await expect(createStaffAssignment(input)).rejects.toThrow('מפתח הפעולה כבר שימש');
  });

  it('the transaction-reported duplicate outcomes map: previous voided / NEW voided points at the kept row', async () => {
    const { client } = tableClient({
      offers: [{ data: offerRow, error: null }, { data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }, { data: packageRows, error: null }],
      activity_log: [{ data: null, error: null }, { data: null, error: null }, { data: null, error: null }, { data: null, error: null }],
    });
    client.rpc.mockResolvedValueOnce({
      data: rpcResult({ duplicate_voided: 'previous' }),
      error: null,
    } as never);
    const kept = await createStaffAssignment(input);
    expect(kept).toMatchObject({ duplicateVoided: 'previous', keptAssignmentId: 'a-new' });
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'coupon.voided_duplicate' }));

    client.rpc.mockResolvedValueOnce({
      data: rpcResult({ assignment_id: 'a-new-voided', kept_assignment_id: 'a-kept', duplicate_voided: 'new' }),
      error: null,
    } as never);
    const lost = await createStaffAssignment(input);
    expect(lost).toMatchObject({ duplicateVoided: 'new', keptAssignmentId: 'a-kept' });
  });

  it('gate: rejects without manage_billing and reads nothing', async () => {
    const { client } = tableClient({});
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('redirect'));

    await expect(createStaffAssignment(input)).rejects.toThrow('redirect');
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});


describe('voidStaffAssignment (over the ONE-transaction RPC, ד.3)', () => {
  it('a voided outcome forwards the REQUIRED staff reason and audits', async () => {
    const { client } = tableClient({ activity_log: [{ data: null, error: null }] });
    client.rpc.mockResolvedValueOnce({ data: { outcome: 'voided' }, error: null } as never);

    const r = await voidStaffAssignment('a-1', '  טעות בהקצאה  ');

    expect(client.rpc).toHaveBeenCalledWith('void_staff_coupon_assignment', {
      _staff_id: 'staff-1',
      _assignment_id: 'a-1',
      _staff_reason: 'טעות בהקצאה',
    });
    expect(r).toEqual({ outcome: 'voided' });
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'coupon.voided' }));
  });

  it('an empty reason is refused before the transaction is ever called', async () => {
    const { client } = tableClient({});
    await expect(voidStaffAssignment('a-1', '   ')).rejects.toThrow('נדרשת סיבת ביטול');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('every transaction refusal maps through: held_by_payment / held_by_review / held_by_approved_terms / needs_investigation / already_ended', async () => {
    const { client } = tableClient({});
    for (const reason of [
      'held_by_payment',
      'held_by_review',
      'held_by_approved_terms',
      'needs_investigation',
      'already_ended',
    ] as const) {
      client.rpc.mockResolvedValueOnce({ data: { outcome: 'refused', reason }, error: null } as never);
      expect(await voidStaffAssignment('a-1', 'סיבה')).toEqual({ outcome: 'refused', reason });
    }
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('gate: rejects without manage_billing and calls nothing', async () => {
    const { client } = tableClient({});
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('redirect'));

    await expect(voidStaffAssignment('a-1', 'סיבה')).rejects.toThrow('redirect');
    expect(client.rpc).not.toHaveBeenCalled();
  });
});


describe('listStaffAssignments (admin-panel א.2/א.3 — the SQL list and the global guard)', () => {
  function rpcRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'a-1',
      created_at: '2026-10-12T10:00:00.000Z',
      expires_at: FUTURE,
      state: 'bound',
      end_reason: null,
      offer_title: 'לקוחות מצטרפים',
      user_id: null,
      phone_e164: '+972501234567',
      source_kind: 'agent',
      total_count: 1,
      ...overrides,
    };
  }

  it('passes normalized filters to the SQL function and maps rows (display, masking, claim)', async () => {
    const { client } = tableClient({
      profiles: [{ data: [], error: null }],
      payment_operations: [{ data: null, error: null, count: 0 }],
    });
    client.rpc.mockResolvedValueOnce({ data: [rpcRow()], error: null } as never);

    const list = await listStaffAssignments({
      status: 'nonsense' as never, // invalid → normalized away
      source: 'agent',
      sort: 'bad' as never, // invalid → newest
      page: -3, // invalid → 1
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_list_coupon_assignments', {
      _user_id: null,
      _phone: null,
      _status: null,
      _source: 'agent',
      _offer_id: null,
      _sort: 'newest',
      _page: 1,
      _page_size: 25,
    });
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({
      display: { key: 'bound', label: 'משויכת לאירוע' },
      offerTitle: 'לקוחות מצטרפים',
      target: { phoneMasked: '+9725…567', claimed: false, name: null },
      sourceKind: 'agent',
    });
  });

  it('an out-of-range page is corrected to the last page while keeping the filters', async () => {
    const { client } = tableClient({
      profiles: [{ data: [], error: null }],
      payment_operations: [{ data: null, error: null, count: 0 }],
    });
    client.rpc
      .mockResolvedValueOnce({ data: [], error: null } as never) // page 9 → empty
      .mockResolvedValueOnce({ data: [rpcRow({ total_count: 30 })], error: null } as never) // probe page 1
      .mockResolvedValueOnce({ data: [rpcRow({ id: 'a-26', total_count: 30 })], error: null } as never); // last page

    const list = await listStaffAssignments({ page: 9, source: 'staff' });

    expect(list.page).toBe(2); // 30 rows / 25 per page → last page 2
    expect(list.total).toBe(30);
    expect(client.rpc).toHaveBeenLastCalledWith(
      'admin_list_coupon_assignments',
      expect.objectContaining({ _page: 2, _source: 'staff' }),
    );
  });

  it('an email q that matches no account is an honest empty result — the list query never runs', async () => {
    const { client } = tableClient({
      payment_operations: [{ data: null, error: null, count: 2 }],
    });
    client.rpc.mockResolvedValueOnce({ data: [], error: null } as never); // the exact-email lookup

    const list = await listStaffAssignments({ q: 'missing@example.com' });

    expect(client.rpc).toHaveBeenCalledWith('admin_lookup_account_by_email', { _email: 'missing@example.com' });
    expect(client.rpc).not.toHaveBeenCalledWith('admin_list_coupon_assignments', expect.anything());
    expect(list).toMatchObject({ rows: [], total: 0, globalGuardCount: 2, guardCheckStatus: 'ok' });
  });

  it('the global guard counts via the succeeded-payment join and is independent of the page rows', async () => {
    const { client, calls } = tableClient({
      profiles: [{ data: [], error: null }],
      payment_operations: [{ data: null, error: null, count: 3 }],
    });
    client.rpc.mockResolvedValueOnce({ data: [rpcRow()], error: null } as never);

    const list = await listStaffAssignments({ status: 'waiting' });

    expect(list.globalGuardCount).toBe(3);
    expect(list.guardCheckStatus).toBe('ok');
    // Attribution is the pricing-round join with outcome=succeeded only — pending never masks it.
    const guardCall = calls.payment_operations[0];
    expect(guardCall.eq).toHaveBeenCalledWith('outcome', 'succeeded');
    expect(guardCall.neq).toHaveBeenCalledWith('campaign_pricing.coupon_assignments.state', 'consumed');
  });

  it('a FAILED guard check reports failed with a null count — never a clean zero', async () => {
    const { client } = tableClient({
      profiles: [{ data: [], error: null }],
      payment_operations: [{ data: null, error: { message: 'boom' }, count: null }],
    });
    client.rpc.mockResolvedValueOnce({ data: [], error: null } as never);

    const list = await listStaffAssignments();

    expect(list.guardCheckStatus).toBe('failed');
    expect(list.globalGuardCount).toBeNull();
  });

  it('a failed list read THROWS a safe message — the screen renders an error with retry, not an empty list', async () => {
    const { client } = tableClient({});
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as never);

    await expect(listStaffAssignments()).rejects.toThrow('טעינת ההטבות נכשלה');
  });

  it('gate: rejects without manage_billing and reads nothing', async () => {
    const { client } = tableClient({});
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('redirect'));

    await expect(listStaffAssignments()).rejects.toThrow('redirect');
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('lookupStaffAssignmentRecipient (ג.1 — three distinct answers)', () => {
  it('found: one indexed SQL lookup (no page-capped scan), with the account and its active benefits', async () => {
    const { client } = tableClient({});
    client.rpc.mockResolvedValueOnce({
      data: [{ id: 'u-9', email: 'c@x.il', full_name: 'נועם' }],
      error: null,
    } as never);
    vi.mocked(listEligibleBenefits).mockResolvedValue([
      {
        assignmentId: 'a-1', state: 'assigned', boundCampaignId: null,
        expiresAt: FUTURE, claimed: true,
        options: [{ packageId: 'p-1', listPrice: 100, discountAmount: 10, finalPrice: 90 }],
      },
    ] as never);

    const r = await lookupStaffAssignmentRecipient('c@x.il');

    expect(client.rpc).toHaveBeenCalledWith('admin_lookup_account_by_email', { _email: 'c@x.il' });
    expect(r).toMatchObject({
      status: 'found',
      account: { id: 'u-9', email: 'c@x.il', name: 'נועם' },
      activeBenefits: [{ summary: '90₪' }],
    });
  });

  it('not_found is a REAL absence — an empty lookup answer, not a capped scan that gave up', async () => {
    const { client } = tableClient({});
    client.rpc.mockResolvedValueOnce({ data: [], error: null } as never);

    expect(await lookupStaffAssignmentRecipient('missing@x.il')).toEqual({ status: 'not_found' });
  });

  it('a FAILED lookup answers unavailable — never not_found', async () => {
    const { client } = tableClient({});
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as never);

    expect(await lookupStaffAssignmentRecipient('c@x.il')).toEqual({ status: 'unavailable' });
  });
});

describe('createStaffAssignment — the confirmed-preview match (ג.2)', () => {
  it('drifted terms between preview and confirm are REFUSED with the re-confirm message, before any write', async () => {
    const { calls } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
    });

    await expect(
      createStaffAssignment({
        ...input,
        // The staff member confirmed yesterday's price; today's computation differs.
        confirmedOptions: [{ packageId: 'p-1', listPrice: 90, discountAmount: 4.5, finalPrice: 85.5 }],
      }),
    ).rejects.toThrow('תנאי ההצעה השתנו');

    expect(calls.coupon_assignments).toBeUndefined(); // nothing was inserted or sent
  });

  it('matching confirmed terms proceed into the transaction', async () => {
    const { client } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
      activity_log: [{ data: null, error: null }],
    });
    client.rpc.mockResolvedValueOnce({
      data: { assignment_id: 'a-new', kept_assignment_id: 'a-new', outcome: 'created', duplicate_voided: 'none', expires_at: FUTURE },
      error: null,
    } as never);

    const r = await createStaffAssignment({
      ...input,
      confirmedOptions: [{ packageId: 'p-1', listPrice: 100.5, discountAmount: 5.03, finalPrice: 95.47 }],
    });
    expect(r).toMatchObject({ outcome: 'created', keptAssignmentId: 'a-new' });
  });

  it('a race the pre-check missed still refuses from INSIDE the transaction', async () => {
    const { client } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
    });
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'assign: terms changed' } } as never);

    await expect(createStaffAssignment(input)).rejects.toThrow('תנאי ההצעה השתנו');
  });
});
