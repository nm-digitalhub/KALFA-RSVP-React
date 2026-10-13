import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { getStaffAssignmentDetail } from './coupon-assignments';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/coupon-benefits', () => ({ listEligibleBenefits: vi.fn() }));

// getStaffAssignmentDetail (admin-panel א.4): sections fail SOFT, payments attribute via
// the assignment's own pricing rounds, the chosen package matches by id, and display
// advice (allowedActions) mirrors — but never replaces — the server-side void decision.

type Result = { data: unknown; error: { message: string } | null };

function tableClient(queues: Record<string, Result[]>) {
  const client = {
    from: vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'single', 'maybeSingle']) {
        builder[m] = vi.fn(() => builder);
      }
      builder.then = (onFulfilled: (value: Result) => unknown) => onFulfilled(result);
      return builder;
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'c@x.il' } }, error: null })) } },
  };
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return client;
}

const FUTURE = '2030-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    created_at: '2026-10-12T10:00:00.000Z',
    expires_at: FUTURE,
    state: 'bound',
    kind: 'percent',
    value: 10,
    user_id: null,
    phone_e164: '+972501234567',
    claimed_at: null,
    sales_call_attempt_id: 'call-1',
    assigned_by: null,
    bound_campaign_id: 'c-1',
    offer_id: 'o-1',
    offers: { title: 'לקוחות מצטרפים' },
    coupon_assignment_options: [
      { package_id: 'p-1', list_price: 100, discount_amount: 10, final_price: 90, packages: { name: 'חבילה' } },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'staff-1' } as unknown as User);
});

describe('getStaffAssignmentDetail', () => {
  it('unknown id → null (the page 404s only after the permission gate ran)', async () => {
    tableClient({ coupon_assignments: [{ data: null, error: null }] });
    expect(await getStaffAssignmentDetail('missing')).toBeNull();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
  });

  it('missing options → a data-quality warning, never substitute prices', async () => {
    tableClient({
      coupon_assignments: [{ data: baseRow({ coupon_assignment_options: [], bound_campaign_id: null }), error: null }],
      coupon_assignment_events: [{ data: [], error: null }],
      sales_call_attempts: [{ data: { callback_request_id: 'cb-1' }, error: null }],
      campaign_pricing: [{ data: [], error: null }],
    });

    const d = await getStaffAssignmentDetail('a-1');

    expect(d?.frozenOptions).toEqual([]);
    expect(d?.warnings.some((w) => w.includes('אפשרויות מחיר שמורות'))).toBe(true);
  });

  it('an unknown history action renders as "פעולה נוספת" with the raw code — no crash; a missing actor is מערכת', async () => {
    tableClient({
      coupon_assignments: [{ data: baseRow({ bound_campaign_id: null }), error: null }],
      coupon_assignment_events: [
        { data: [{ at: '2026-10-12T10:00:00Z', action: 'strange_new_action', actor_user_id: null, reason: null }], error: null },
      ],
      sales_call_attempts: [{ data: null, error: null }],
      campaign_pricing: [{ data: [], error: null }],
    });

    const d = await getStaffAssignmentDetail('a-1');
    expect(d?.history).toEqual([
      expect.objectContaining({ actionLabel: 'פעולה נוספת', known: false, rawAction: 'strange_new_action', actorLabel: 'מערכת' }),
    ]);
  });

  it('a failed history read marks the SECTION unavailable; the main record still renders', async () => {
    tableClient({
      coupon_assignments: [{ data: baseRow({ bound_campaign_id: null }), error: null }],
      coupon_assignment_events: [{ data: null, error: { message: 'boom' } }],
      sales_call_attempts: [{ data: null, error: null }],
      campaign_pricing: [{ data: [], error: null }],
    });

    const d = await getStaffAssignmentDetail('a-1');
    expect(d?.history).toBe('unavailable');
    expect(d?.assignment.id).toBe('a-1');
  });

  it('historical consumption stays visible after release: consumed, unbound — payments via its rounds still listed', async () => {
    tableClient({
      coupon_assignments: [{ data: baseRow({ state: 'consumed', bound_campaign_id: null }), error: null }],
      coupon_assignment_events: [{ data: [], error: null }],
      sales_call_attempts: [{ data: null, error: null }],
      campaign_pricing: [{ data: [{ id: 'r-1', version: 2 }], error: null }],
      payment_operations: [
        { data: [{ id: 'op-1', amount: 90, outcome: 'succeeded', occurred_at: '2026-10-12T11:00:00Z', pricing_round_id: 'r-1' }], error: null },
      ],
    });

    const d = await getStaffAssignmentDetail('a-1');

    expect(d?.currentBinding).toBeNull();
    expect(d?.paymentAttempts).toEqual([
      expect.objectContaining({ amount: 90, outcome: 'succeeded', roundVersion: 2 }),
    ]);
    // Consumed + succeeded is the HEALTHY shape: no exception warning, void is already_ended.
    expect(d?.warnings.some((w) => w.includes('דורש בדיקה'))).toBe(false);
    expect(d?.allowedActions).toEqual({ canVoid: false, blockReason: 'already_ended' });
    expect(d?.assignment.display.key).toBe('consumed');
  });

  it('a succeeded payment on its round while NOT consumed → consumption_exception blocks the void', async () => {
    tableClient({
      coupon_assignments: [{ data: baseRow({ bound_campaign_id: null }), error: null }],
      coupon_assignment_events: [{ data: [], error: null }],
      sales_call_attempts: [{ data: null, error: null }],
      campaign_pricing: [{ data: [{ id: 'r-1', version: 1 }], error: null }],
      payment_operations: [
        { data: [{ id: 'op-1', amount: 90, outcome: 'succeeded', occurred_at: '2026-10-12T11:00:00Z', pricing_round_id: 'r-1' }], error: null },
      ],
    });

    const d = await getStaffAssignmentDetail('a-1');
    expect(d?.allowedActions).toEqual({ canVoid: false, blockReason: 'consumption_exception' });
    expect(d?.warnings.some((w) => w.includes('דורש בדיקה'))).toBe(true);
  });

  it('a bound assignment on a locked round is held by approved terms; a clean one can void', async () => {
    const queues = {
      coupon_assignments: [{ data: baseRow(), error: null }],
      coupon_assignment_events: [{ data: [], error: null }],
      sales_call_attempts: [{ data: { callback_request_id: null }, error: null }],
      campaign_pricing: [
        { data: [], error: null }, // own rounds
        { data: { package_price: 90, locked_at: '2026-10-12T12:00:00Z' }, error: null }, // current round
      ],
      campaigns: [{ data: { id: 'c-1', template_id: 'p-1', events: { id: 'e-1', name: 'אירוע' }, packages: { name: 'חבילה' } }, error: null }],
      payment_operations: [{ data: null, error: null }], // no open payment
    };
    tableClient(queues as never);

    const d = await getStaffAssignmentDetail('a-1');
    expect(d?.currentBinding).toMatchObject({ packageId: 'p-1', locked: true, roundPrice: 90 });
    expect(d?.allowedActions).toEqual({ canVoid: false, blockReason: 'held_by_approved_terms' });
  });

  it('expired with an OPEN payment: the saved-terms sentence appears and pending blocks the void', async () => {
    tableClient({
      coupon_assignments: [{ data: baseRow({ expires_at: PAST }), error: null }],
      coupon_assignment_events: [{ data: [], error: null }],
      sales_call_attempts: [{ data: { callback_request_id: null }, error: null }],
      campaign_pricing: [
        { data: [], error: null },
        { data: { package_price: 90, locked_at: null }, error: null },
      ],
      campaigns: [{ data: { id: 'c-1', template_id: 'p-1', events: { id: 'e-1', name: 'אירוע' }, packages: { name: 'חבילה' } }, error: null }],
      payment_operations: [{ data: { outcome: 'pending' }, error: null }],
    });

    const d = await getStaffAssignmentDetail('a-1');
    expect(d?.assignment.display.key).toBe('expired');
    expect(d?.warnings.some((w) => w.includes('התשלום הפתוח כפוף לתנאים שנשמרו'))).toBe(true);
    expect(d?.allowedActions.blockReason).toBe('held_by_payment');
  });
});
