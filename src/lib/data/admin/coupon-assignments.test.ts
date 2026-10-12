import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { listEligibleBenefits } from '@/lib/data/coupon-benefits';
import { createStaffAssignment, listStaffAssignments, voidStaffAssignment } from './coupon-assignments';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/coupon-benefits', () => ({ listEligibleBenefits: vi.fn() }));

type Result = { data: unknown; error: { message: string; code?: string } | null };

function tableClient(queues: Record<string, Result[]>) {
  const calls: Record<string, Array<Record<string, ReturnType<typeof vi.fn>>>> = {};
  const client = {
    from: vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'order', 'limit', 'single', 'maybeSingle']) {
        builder[m] = vi.fn(() => builder);
      }
      builder.then = (onFulfilled: (value: Result) => unknown) => onFulfilled(result);
      (calls[table] ??= []).push(builder as Record<string, ReturnType<typeof vi.fn>>);
      return builder;
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) } },
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

describe('createStaffAssignment', () => {
  it('freezes the options from the SHARED computation (100.50 at 1%→… here 5% → 5.03 / 95.47)', async () => {
    const { calls } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
      coupon_assignments: [{ data: { id: 'a-new' }, error: null }],
      coupon_assignment_options: [{ data: null, error: null }],
      coupon_assignment_events: [{ data: null, error: null }],
    });

    const r = await createStaffAssignment(input);

    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
    expect(r.outcome).toBe('created');
    // decimal.js: 5% of ₪100.50 = 5.025 → 5.03 (half-up); final 95.47 — exact decimals.
    expect(calls.coupon_assignment_options[0].insert).toHaveBeenCalledWith([
      { assignment_id: 'a-new', package_id: 'p-1', list_price: 100.5, discount_amount: 5.03, final_price: 95.47 },
    ]);
    expect(calls.coupon_assignments[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ assigned_by: 'staff-1', user_id: 'u-1', kind: 'percent', value: 5 }),
    );
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'coupon.assigned' }));
  });

  it('refuses an offer staff may not assign (D14 — who may assign)', async () => {
    tableClient({ offers: [{ data: { ...offerRow, allow_staff: false }, error: null }] });

    await expect(createStaffAssignment(input)).rejects.toThrow('ההצעה אינה מוקצית על ידי צוות');
  });

  it('an idempotent retry returns the EXISTING assignment — never a second one', async () => {
    tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
      coupon_assignments: [
        { data: null, error: { message: 'dup', code: '23505' } },
        { data: { id: 'a-old', expires_at: FUTURE }, error: null },
      ],
    });

    const r = await createStaffAssignment(input);

    expect(r).toMatchObject({ assignmentId: 'a-old', outcome: 'existing', duplicateVoided: 'none' });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('D18 duplicate: an identical option set voids the SHORTER-lived (the previous one here), audited', async () => {
    vi.mocked(listEligibleBenefits).mockResolvedValue([
      {
        assignmentId: 'a-old',
        state: 'assigned',
        boundCampaignId: null,
        expiresAt: '2026-10-20T00:00:00.000Z',
        claimed: true,
        options: [{ packageId: 'p-1', listPrice: 100.5, discountAmount: 5.03, finalPrice: 95.47 }],
      },
    ]);
    const { calls } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
      coupon_assignments: [
        { data: { id: 'a-new' }, error: null }, // the insert
        { data: null, error: null }, // the void update
      ],
      coupon_assignment_options: [{ data: null, error: null }],
      coupon_assignment_events: [
        { data: null, error: null }, // assigned
        { data: null, error: null }, // voided
      ],
    });

    const r = await createStaffAssignment(input);

    expect(r.duplicateVoided).toBe('previous');
    expect(calls.coupon_assignments[1].update).toHaveBeenCalledWith({ state: 'void' });
    expect(calls.coupon_assignments[1].eq).toHaveBeenCalledWith('id', 'a-old');
    expect(calls.coupon_assignment_events[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({ assignment_id: 'a-old', action: 'voided', reason: 'duplicate' }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'coupon.voided_duplicate' }),
    );
  });

  it('a DIFFERENT final price is not a duplicate — both stay (best price decides at binding)', async () => {
    vi.mocked(listEligibleBenefits).mockResolvedValue([
      {
        assignmentId: 'a-old',
        state: 'assigned',
        boundCampaignId: null,
        expiresAt: FUTURE,
        claimed: true,
        options: [{ packageId: 'p-1', listPrice: 100.5, discountAmount: 10, finalPrice: 90.5 }],
      },
    ]);
    const { calls } = tableClient({
      offers: [{ data: offerRow, error: null }],
      packages: [{ data: packageRows, error: null }],
      coupon_assignments: [{ data: { id: 'a-new' }, error: null }],
      coupon_assignment_options: [{ data: null, error: null }],
      coupon_assignment_events: [{ data: null, error: null }],
    });

    const r = await createStaffAssignment(input);

    expect(r.duplicateVoided).toBe('none');
    expect(calls.coupon_assignments).toHaveLength(1); // only the insert — no void pass
  });

  it('gate: rejects without manage_billing and reads nothing', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = tableClient({});

    await expect(createStaffAssignment(input)).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('voidStaffAssignment (tasks 5.5/7.3)', () => {
  it('REFUSES a void while the campaign has a pending package payment — held by that payment', async () => {
    const { client } = tableClient({
      coupon_assignments: [{ data: { id: 'a-1', state: 'bound', bound_campaign_id: 'c-1' }, error: null }],
      payment_operations: [{ data: { id: 'op-1' }, error: null }],
    });

    const r = await voidStaffAssignment('a-1');

    expect(r).toEqual({ outcome: 'refused', reason: 'held_by_payment' });
    // Nothing was written: no release, no void.
    expect(client.rpc).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('refuses a benefit bound into APPROVED terms (a locked round) — it pays or lapses', async () => {
    tableClient({
      coupon_assignments: [{ data: { id: 'a-1', state: 'bound', bound_campaign_id: 'c-1' }, error: null }],
      payment_operations: [{ data: null, error: null }],
      campaign_pricing: [{ data: { id: 'r-1', locked_at: FUTURE, coupon_assignment_id: 'a-1' }, error: null }],
    });

    expect(await voidStaffAssignment('a-1')).toEqual({
      outcome: 'refused',
      reason: 'held_by_approved_terms',
    });
  });

  it('voids an unbound assignment with an audited event', async () => {
    const { client, calls } = tableClient({
      coupon_assignments: [
        { data: { id: 'a-1', state: 'assigned', bound_campaign_id: null }, error: null },
        { data: null, error: null }, // the void update
      ],
      coupon_assignment_events: [{ data: null, error: null }],
    });

    const r = await voidStaffAssignment('a-1');

    expect(r).toEqual({ outcome: 'voided' });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(calls.coupon_assignments[1].update).toHaveBeenCalledWith({ state: 'void' });
    expect(calls.coupon_assignment_events[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'voided', reason: 'staff_void' }),
    );
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'coupon.voided' }));
  });

  it('a BOUND assignment on an unlocked round is released first (the price returns to list), then voided', async () => {
    const { client } = tableClient({
      coupon_assignments: [
        { data: { id: 'a-1', state: 'bound', bound_campaign_id: 'c-1' }, error: null },
        { data: null, error: null }, // the void update
      ],
      payment_operations: [{ data: null, error: null }],
      campaign_pricing: [{ data: { id: 'r-1', locked_at: null, coupon_assignment_id: 'a-1' }, error: null }],
      coupon_assignment_events: [{ data: null, error: null }],
    });

    const r = await voidStaffAssignment('a-1');

    expect(r).toEqual({ outcome: 'voided' });
    expect(client.rpc).toHaveBeenCalledWith('release_coupon_assignment', {
      _assignment_id: 'a-1',
      _reason: 'voided_by_staff',
      _actor_user_id: 'staff-1',
    });
  });

  it('a consumed assignment has nothing to void', async () => {
    tableClient({
      coupon_assignments: [{ data: { id: 'a-1', state: 'consumed', bound_campaign_id: 'c-1' }, error: null }],
    });

    expect(await voidStaffAssignment('a-1')).toEqual({ outcome: 'refused', reason: 'already_ended' });
  });
});

describe('listStaffAssignments (task 7.3 — the screen reads held states and the D10 guard)', () => {
  function listRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'a-1',
      created_at: '2026-10-12T10:00:00.000Z',
      expires_at: FUTURE,
      state: 'bound',
      user_id: null,
      phone_e164: '+972501234567',
      sales_call_attempt_id: 'call-1',
      assigned_by: null,
      bound_campaign_id: 'c-1',
      offers: { title: 'הטבה' },
      coupon_assignment_options: [{ final_price: 190, packages: { name: 'בסיס' } }],
      ...overrides,
    };
  }

  it('held by a PENDING payment, by a payment in REVIEW, and by APPROVED terms — each shown as such', async () => {
    tableClient({
      coupon_assignments: [
        {
          data: [
            listRow({ id: 'a-pend', bound_campaign_id: 'c-pend' }),
            listRow({ id: 'a-rev', bound_campaign_id: 'c-rev' }),
            listRow({ id: 'a-lock', bound_campaign_id: 'c-lock' }),
            listRow({ id: 'a-free', state: 'assigned', bound_campaign_id: null }),
          ],
          error: null,
        },
      ],
      campaigns: [
        {
          data: [
            { id: 'c-pend', template_id: 'p-1', events: { name: 'אירוע א' }, packages: { name: 'בסיס' } },
            { id: 'c-rev', template_id: 'p-1', events: { name: 'אירוע ב' }, packages: { name: 'בסיס' } },
            { id: 'c-lock', template_id: 'p-1', events: { name: 'אירוע ג' }, packages: { name: 'בסיס' } },
          ],
          error: null,
        },
      ],
      campaign_pricing: [{ data: [{ campaign_id: 'c-lock', locked_at: '2026-10-12T11:00:00.000Z' }], error: null }],
      payment_operations: [
        {
          data: [
            { campaign_id: 'c-pend', outcome: 'pending' },
            { campaign_id: 'c-rev', outcome: 'review' },
          ],
          error: null,
        },
      ],
    });

    const { rows, guardCount } = await listStaffAssignments();

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('a-pend')).toMatchObject({ payment: 'pending', heldBy: 'payment', guard: false });
    expect(byId.get('a-rev')).toMatchObject({ payment: 'review', heldBy: 'review', guard: false });
    expect(byId.get('a-lock')).toMatchObject({ payment: 'none', heldBy: 'approved_terms' });
    // The unheld row offers the void (heldBy null), and nothing trips the guard.
    expect(byId.get('a-free')).toMatchObject({ heldBy: null, source: { kind: 'agent' } });
    expect(guardCount).toBe(0);
  });

  it('D10 guard: a SUCCEEDED payment whose assignment was not consumed is surfaced and counted', async () => {
    const { client } = tableClient({
      coupon_assignments: [
        {
          data: [
            listRow({ id: 'a-bad', bound_campaign_id: 'c-paid', user_id: 'u-9' }),
            listRow({ id: 'a-ok', state: 'consumed', bound_campaign_id: 'c-paid2' }),
          ],
          error: null,
        },
      ],
      campaigns: [
        {
          data: [
            { id: 'c-paid', template_id: 'p-1', events: { name: 'אירוע' }, packages: { name: 'בסיס' } },
            { id: 'c-paid2', template_id: 'p-1', events: { name: 'אירוע 2' }, packages: { name: 'בסיס' } },
          ],
          error: null,
        },
      ],
      campaign_pricing: [{ data: [], error: null }],
      payment_operations: [
        {
          data: [
            { campaign_id: 'c-paid', outcome: 'succeeded' },
            { campaign_id: 'c-paid2', outcome: 'succeeded' },
          ],
          error: null,
        },
      ],
    });
    client.auth.admin.getUserById.mockResolvedValue({
      data: { user: { id: 'u-9', email: 'owner@example.com' } },
      error: null,
    } as never);

    const { rows, guardCount } = await listStaffAssignments();

    const byId = new Map(rows.map((r) => [r.id, r]));
    // The damage row: paid but never consumed — flagged; the phone is masked, the claim shows the email.
    expect(byId.get('a-bad')).toMatchObject({
      guard: true,
      target: { userEmail: 'owner@example.com', phoneMasked: '+9725…567', claimed: true },
    });
    // Consumed-and-paid is the HEALTHY shape — not a guard row.
    expect(byId.get('a-ok')).toMatchObject({ guard: false, state: 'consumed' });
    expect(guardCount).toBe(1);
  });

  it('gate: rejects without manage_billing and reads nothing', async () => {
    const { client } = tableClient({});
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('redirect'));

    await expect(listStaffAssignments()).rejects.toThrow('redirect');
    expect(client.from).not.toHaveBeenCalled();
  });
});
