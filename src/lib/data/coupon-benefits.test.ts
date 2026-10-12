import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';
import {
  listEligibleBenefits,
  bindBestBenefit,
  lapseExpiredBoundBenefit,
  releaseCancelledCampaignBenefit,
  acceptBenefitForCampaign,
} from './coupon-benefits';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

// Eligibility is PROVEN, never claimed (task 5.2): these tests pin the two proofs — a staff
// assignment on the account, and a VERIFIED phone equal to the assignment's phone — and that a
// shared link / profile referral has no path into this module at all.

type Result = { data: unknown; error: { message: string } | null };

// The module runs several queries (own rows, phone rows, the claim update) plus the bind RPC —
// a per-table result queue with recorded builders, like the offers data-layer tests.
function tableClient(queues: Record<string, Result[]>) {
  const calls: Record<string, Array<Record<string, ReturnType<typeof vi.fn>>>> = {};
  const rpc = vi.fn(
    async (): Promise<{ data: unknown; error: { message: string } | null }> => ({
      data: null,
      error: null,
    }),
  );
  const client = {
    from: vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'update', 'eq', 'in', 'is', 'maybeSingle']) {
        builder[m] = vi.fn(() => builder);
      }
      builder.then = (onFulfilled: (value: Result) => unknown) => onFulfilled(result);
      (calls[table] ??= []).push(builder as Record<string, ReturnType<typeof vi.fn>>);
      return builder;
    }),
    rpc,
  };
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, calls, rpc };
}

const FUTURE = '2030-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

// Auth stores bare digits; verifiedPhoneOf normalizes to E.164.
const verifiedUser = { id: 'u-1', phone: '972501234567', phone_confirmed_at: FUTURE };
const unverifiedUser = { id: 'u-1', phone: '972501234567', phone_confirmed_at: undefined };

function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    state: 'assigned',
    bound_campaign_id: null,
    expires_at: FUTURE,
    user_id: null,
    coupon_assignment_options: [
      { package_id: 'p-1', list_price: 100, discount_amount: 5, final_price: 95 },
    ],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('listEligibleBenefits — the two proofs', () => {
  it('a staff assignment on the account is eligible without any phone', async () => {
    const { calls } = tableClient({
      coupon_assignments: [{ data: [assignmentRow({ user_id: 'u-1' })], error: null }],
    });

    const benefits = await listEligibleBenefits(unverifiedUser);

    expect(benefits).toHaveLength(1);
    expect(benefits[0].claimed).toBe(true);
    expect(calls.coupon_assignments[0].eq).toHaveBeenCalledWith('user_id', 'u-1');
    // No verified phone → the phone query never runs.
    expect(calls.coupon_assignments).toHaveLength(1);
  });

  it('an unclaimed assignment on the VERIFIED phone is eligible, matched in E.164', async () => {
    const { calls } = tableClient({
      coupon_assignments: [
        { data: [], error: null },
        { data: [assignmentRow({ phone_e164: '+972501234567' })], error: null },
      ],
    });

    const benefits = await listEligibleBenefits(verifiedUser);

    expect(benefits).toHaveLength(1);
    expect(benefits[0].claimed).toBe(false);
    expect(calls.coupon_assignments[1].eq).toHaveBeenCalledWith('phone_e164', '+972501234567');
    // Claimed-by-another rows are excluded at the query: only unclaimed phone rows match.
    expect(calls.coupon_assignments[1].is).toHaveBeenCalledWith('user_id', null);
  });

  it('an UNVERIFIED phone proves nothing — only the account query runs', async () => {
    const { calls } = tableClient({ coupon_assignments: [{ data: [], error: null }] });

    const benefits = await listEligibleBenefits(unverifiedUser);

    expect(benefits).toEqual([]);
    expect(calls.coupon_assignments).toHaveLength(1);
  });

  it('never reads profiles or any referral — a shared link has no path in', async () => {
    const { client } = tableClient({ coupon_assignments: [{ data: [], error: null }] });

    await listEligibleBenefits(verifiedUser);

    const tables = client.from.mock.calls.map(([t]) => t);
    expect(tables.every((t) => t === 'coupon_assignments')).toBe(true);
  });
});

describe('bindBestBenefit', () => {
  const args = { campaignId: 'c-1', eventId: 'e-1', packageId: 'p-1' };

  it('binds a staff assignment and records the activity row', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [{ data: [assignmentRow({ user_id: 'u-1' })], error: null }],
    });

    const result = await bindBestBenefit({ ...args, user: unverifiedUser });

    expect(result).toBe('bound');
    expect(rpc).toHaveBeenCalledWith('bind_coupon_assignment', {
      _assignment_id: 'a-1',
      _campaign_id: 'c-1',
      _actor_user_id: 'u-1',
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'e-1', action: 'campaign.benefit_bound' }),
    );
  });

  it('claims a phone benefit ONCE before binding (the verified matching phone applies)', async () => {
    const { calls, rpc } = tableClient({
      coupon_assignments: [
        { data: [], error: null }, // own rows
        { data: [assignmentRow()], error: null }, // phone rows (unclaimed)
        { data: [{ id: 'a-1' }], error: null }, // the claim update won
      ],
    });

    const result = await bindBestBenefit({ ...args, user: verifiedUser });

    expect(result).toBe('bound');
    const claim = calls.coupon_assignments[2];
    expect(claim.update).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u-1', claimed_at: expect.any(String) }),
    );
    expect(claim.is).toHaveBeenCalledWith('user_id', null);
    expect(rpc).toHaveBeenCalled();
  });

  it('a lost claim race skips the benefit instead of binding someone else’s', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [
        { data: [], error: null },
        { data: [assignmentRow()], error: null },
        { data: [], error: null }, // claim matched no row — another account won
      ],
    });

    const result = await bindBestBenefit({ ...args, user: verifiedUser });

    expect(result).toBe('none');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('an expired benefit is never bound', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [
        { data: [assignmentRow({ user_id: 'u-1', expires_at: PAST })], error: null },
      ],
    });

    expect(await bindBestBenefit({ ...args, user: unverifiedUser })).toBe('none');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a benefit without an option for the chosen package is never bound', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [
        { data: [assignmentRow({ user_id: 'u-1' })], error: null },
      ],
    });

    expect(await bindBestBenefit({ ...args, packageId: 'p-other', user: unverifiedUser })).toBe(
      'none',
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a benefit bound to ANOTHER campaign is not available', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [
        {
          data: [assignmentRow({ user_id: 'u-1', state: 'bound', bound_campaign_id: 'c-other' })],
          error: null,
        },
      ],
    });

    expect(await bindBestBenefit({ ...args, user: unverifiedUser })).toBe('none');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('with several benefits, the LOWEST final price for the chosen package wins (D18)', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [
        {
          data: [
            assignmentRow({ id: 'a-small', user_id: 'u-1' }), // final 95
            assignmentRow({
              id: 'a-big',
              user_id: 'u-1',
              coupon_assignment_options: [
                { package_id: 'p-1', list_price: 100, discount_amount: 20, final_price: 80 },
              ],
            }),
          ],
          error: null,
        },
      ],
    });

    await bindBestBenefit({ ...args, user: unverifiedUser });

    expect(rpc).toHaveBeenCalledWith(
      'bind_coupon_assignment',
      expect.objectContaining({ _assignment_id: 'a-big' }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a benefit the OTHER proof path cannot reach is never bound for this account', async () => {
    // A phone assignment claimed by another account never reaches the candidate list (the phone
    // query carries user_id IS NULL), so there is nothing to bind — the referral/link scenario.
    const { rpc } = tableClient({
      coupon_assignments: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    });

    expect(await bindBestBenefit({ ...args, user: verifiedUser })).toBe('none');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a bind refused mid-flight falls through to the next candidate', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [
        {
          data: [
            assignmentRow({
              id: 'a-big',
              user_id: 'u-1',
              coupon_assignment_options: [
                { package_id: 'p-1', list_price: 100, discount_amount: 20, final_price: 80 },
              ],
            }),
            assignmentRow({ id: 'a-small', user_id: 'u-1' }),
          ],
          error: null,
        },
      ],
    });
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'bind: assignment expired' } })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await bindBestBenefit({ ...args, user: unverifiedUser });

    expect(result).toBe('bound');
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'bind_coupon_assignment',
      expect.objectContaining({ _assignment_id: 'a-small' }),
    );
  });
});

describe('lapseExpiredBoundBenefit (D15 — payment is the deciding step)', () => {
  const args = { campaignId: 'c-1', assignmentId: 'a-1', listPrice: 200, actorUserId: 'u-1' };

  it('keeps a benefit that is still valid — no supersede', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [{ data: { expires_at: FUTURE }, error: null }],
    });

    expect(await lapseExpiredBoundBenefit(args)).toBe('kept');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('supersedes an EXPIRED benefit to the list price with reason lapsed_reapproval', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [{ data: { expires_at: PAST }, error: null }],
    });

    expect(await lapseExpiredBoundBenefit(args)).toBe('lapsed');
    expect(rpc).toHaveBeenCalledWith('supersede_campaign_pricing', {
      _campaign_id: 'c-1',
      _reason: 'lapsed_reapproval',
      _list_price: 200,
      _discount_amount: 0,
      _actor_user_id: 'u-1',
    });
  });

  it('a refused supersede keeps the flow — the DB open guard rules there', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [{ data: { expires_at: PAST }, error: null }],
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'supersede: the campaign has money movement' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await lapseExpiredBoundBenefit(args)).toBe('kept');
    errorSpy.mockRestore();
  });

  it('an unreadable assignment keeps the flow (fail-open to the DB guard, never a silent supersede)', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [{ data: null, error: { message: 'boom' } }],
    });

    expect(await lapseExpiredBoundBenefit(args)).toBe('kept');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('releaseCancelledCampaignBenefit (D17 — a cancelled campaign frees its benefit)', () => {
  it('releases the bound, unconsumed assignment with the cancel reason', async () => {
    const { rpc, calls } = tableClient({
      coupon_assignments: [{ data: { id: 'a-1' }, error: null }],
    });

    expect(await releaseCancelledCampaignBenefit('c-1', 'staff-1')).toBe('released');
    expect(calls.coupon_assignments[0].eq).toHaveBeenCalledWith('bound_campaign_id', 'c-1');
    expect(calls.coupon_assignments[0].eq).toHaveBeenCalledWith('state', 'bound');
    expect(rpc).toHaveBeenCalledWith('release_coupon_assignment', {
      _assignment_id: 'a-1',
      _reason: 'campaign_cancelled',
      _actor_user_id: 'staff-1',
    });
  });

  it('no bound assignment → nothing to do', async () => {
    const { rpc } = tableClient({ coupon_assignments: [{ data: null, error: null }] });

    expect(await releaseCancelledCampaignBenefit('c-1', 'staff-1')).toBe('none');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a refused release (money movement) is loud but non-fatal', async () => {
    const { rpc } = tableClient({ coupon_assignments: [{ data: { id: 'a-1' }, error: null }] });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'release: the campaign has money movement' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await releaseCancelledCampaignBenefit('c-1', 'staff-1')).toBe('none');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('acceptBenefitForCampaign (task 5.5 — ש5/D21/D22)', () => {
  const args = { campaignId: 'c-1', eventId: 'e-1', packageId: 'p-1' };

  it('supersedes the approved price with the benefit option and normalizes the binding', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [{ data: [assignmentRow({ user_id: 'u-1' })], error: null }],
    });

    const result = await acceptBenefitForCampaign({ ...args, user: unverifiedUser });

    expect(result).toBe('accepted');
    expect(rpc).toHaveBeenNthCalledWith(1, 'supersede_campaign_pricing', {
      _campaign_id: 'c-1',
      _reason: 'benefit_accepted',
      _list_price: 100,
      _discount_amount: 5,
      _assignment_id: 'a-1',
      _actor_user_id: 'u-1',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'bind_coupon_assignment', {
      _assignment_id: 'a-1',
      _campaign_id: 'c-1',
      _actor_user_id: 'u-1',
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.benefit_accepted' }),
    );
  });

  it('no usable benefit → none, and nothing is superseded', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [
        { data: [assignmentRow({ user_id: 'u-1', expires_at: PAST })], error: null },
      ],
    });

    expect(await acceptBenefitForCampaign({ ...args, user: unverifiedUser })).toBe('none');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a refused supersede (money movement) answers none and changes nothing', async () => {
    const { rpc } = tableClient({
      coupon_assignments: [{ data: [assignmentRow({ user_id: 'u-1' })], error: null }],
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'supersede: the campaign has money movement' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await acceptBenefitForCampaign({ ...args, user: unverifiedUser })).toBe('none');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(logActivity).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
