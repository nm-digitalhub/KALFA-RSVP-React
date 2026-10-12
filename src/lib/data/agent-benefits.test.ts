import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminClient } from '@/lib/supabase/admin';
import { applyAgentDiscount } from './agent-benefits';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

// The agent's discount brain (task 6.2): these tests pin the spec's verify list — a repeat call
// answers the SAME assignment; an allowed escalation replaces with history kept and never worsens
// a shared package's promised price; it is refused while a payment is open; a failed write
// promises nothing; and no caller-sent price, value or package exists anywhere in the input.

type Result = { data: unknown; error: { message: string; code?: string } | null };

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
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'limit', 'single', 'maybeSingle']) {
        builder[m] = vi.fn(() => builder);
      }
      builder.then = (onFulfilled: (value: Result) => unknown) => onFulfilled(result);
      (calls[table] ??= []).push(builder as Record<string, ReturnType<typeof vi.fn>>);
      return builder;
    }),
    rpc,
  };
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return { client, calls, rpc };
}

const FUTURE = '2030-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

const input = { callAttemptId: 'call-1', phoneE164: '+972501234567', objectionReason: 'יקר לי, המחיר גבוה' };

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    title: 'הנחה אחרי התנגדות מחיר',
    kind: 'percent',
    value: 5,
    validity_days: 14,
    may_replace: false,
    agent_objections: ['מחיר'],
    created_at: '2026-10-01T00:00:00.000Z',
    offer_packages: [{ package_id: 'p-1', value_override: null }],
    ...overrides,
  };
}

const packageRows = [{ id: 'p-1', name: 'בסיס', price_with_vat: 200 }];

function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    offer_id: 'o-1',
    state: 'assigned',
    bound_campaign_id: null,
    expires_at: FUTURE,
    offers: { title: 'הנחה אחרי התנגדות מחיר' },
    coupon_assignment_options: [
      { package_id: 'p-1', list_price: 200, final_price: 190, packages: { name: 'בסיס' } },
    ],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('applyAgentDiscount — one per call (D3)', () => {
  it('a repeated call in the SAME sales call answers the existing assignment, frozen prices included', async () => {
    const { client } = tableClient({
      coupon_assignments: [{ data: assignmentRow(), error: null }],
    });

    const answer = await applyAgentDiscount(input);

    expect(answer).toEqual({
      status: 'offer',
      offer: { id: 'o-1', title: 'הנחה אחרי התנגדות מחיר' },
      options: [{ package_id: 'p-1', package_name: 'בסיס', list_price: 200, final_price: 190 }],
      expiresAt: FUTURE,
    });
    // Nothing was written: the first read answered.
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});

describe('applyAgentDiscount — a fresh assignment', () => {
  function freshQueues(extra: Partial<Record<string, Result[]>> = {}) {
    return {
      coupon_assignments: [
        { data: null, error: null }, // own-call read
        { data: [], error: null }, // phone active read
        { data: { id: 'a-new' }, error: null }, // insert
      ],
      offers: [{ data: [offerRow()], error: null }],
      packages: [{ data: packageRows, error: null }],
      coupon_assignment_options: [{ data: null, error: null }],
      coupon_assignment_events: [{ data: null, error: null }],
      activity_log: [{ data: null, error: null }],
      ...extra,
    } as Record<string, Result[]>;
  }

  it('records the assignment with computed options BEFORE promising, and audits the objection', async () => {
    const { calls } = tableClient(freshQueues());

    const answer = await applyAgentDiscount(input);

    expect(answer.status).toBe('offer');
    expect(calls.coupon_assignments[2].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        offer_id: 'o-1',
        sales_call_attempt_id: 'call-1',
        phone_e164: '+972501234567',
        kind: 'percent',
        value: 5,
      }),
    );
    expect(calls.coupon_assignment_options[0].insert).toHaveBeenCalledWith([
      { assignment_id: 'a-new', package_id: 'p-1', list_price: 200, discount_amount: 10, final_price: 190 },
    ]);
    expect(calls.coupon_assignment_events[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assigned', reason: input.objectionReason }),
    );
    expect(calls.activity_log[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'coupon.agent_discount',
        user_id: null,
        meta: expect.objectContaining({ outcome: 'assigned', objectionReason: input.objectionReason }),
      }),
    );
  });

  it('no matching offer → the defined no-offer answer, audited', async () => {
    const { calls } = tableClient(
      freshQueues({ offers: [{ data: [offerRow({ agent_objections: ['אין לי אירוע'] })], error: null }] }),
    );

    expect(await applyAgentDiscount(input)).toEqual({ status: 'no_offer' });
    expect(calls.activity_log[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ outcome: 'no_offer' }) }),
    );
  });

  it('a failed write promises NOTHING — no offer is returned on an insert error', async () => {
    tableClient(
      freshQueues({
        coupon_assignments: [
          { data: null, error: null },
          { data: [], error: null },
          { data: null, error: { message: 'boom' } },
        ],
      }),
    );

    expect(await applyAgentDiscount(input)).toEqual({ status: 'no_offer' });
  });

  it('an offer that floors a package at zero cannot be honored and is skipped', async () => {
    tableClient(
      freshQueues({ offers: [{ data: [offerRow({ kind: 'amount', value: 200 })], error: null }] }),
    );

    expect(await applyAgentDiscount(input)).toEqual({ status: 'no_offer' });
  });

  it('an EXPLICIT objection match beats a catch-all offer', async () => {
    const { calls } = tableClient(
      freshQueues({
        offers: [
          {
            data: [
              offerRow({ id: 'o-catchall', agent_objections: [], value: 10 }),
              offerRow({ id: 'o-price', agent_objections: ['מחיר'] }),
            ],
            error: null,
          },
        ],
      }),
    );

    const answer = await applyAgentDiscount(input);

    expect(answer.status).toBe('offer');
    expect(calls.coupon_assignments[2].insert).toHaveBeenCalledWith(
      expect.objectContaining({ offer_id: 'o-price' }),
    );
  });

  it('an EXPIRED active row is voided in the assign path, and a fresh assignment follows', async () => {
    const { calls } = tableClient(
      freshQueues({
        coupon_assignments: [
          { data: null, error: null },
          { data: [assignmentRow({ expires_at: PAST })], error: null },
          { data: null, error: null }, // the void update
          { data: { id: 'a-new' }, error: null }, // the insert
        ],
        coupon_assignment_events: [
          { data: null, error: null }, // voided (expired)
          { data: null, error: null }, // assigned
        ],
      }),
    );

    const answer = await applyAgentDiscount(input);

    expect(answer.status).toBe('offer');
    expect(calls.coupon_assignments[2].update).toHaveBeenCalledWith({ state: 'void' });
    expect(calls.coupon_assignment_events[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'voided', reason: 'expired' }),
    );
  });
});

describe('applyAgentDiscount — D16/D23: the phone already holds an active assignment', () => {
  it('without an allowed escalation, the EXISTING assignment is the answer — same options, same expiry', async () => {
    const { rpc, calls } = tableClient({
      coupon_assignments: [
        { data: null, error: null },
        { data: [assignmentRow()], error: null },
      ],
      offers: [{ data: [offerRow()], error: null }], // matches, but may_replace=false
      packages: [{ data: packageRows, error: null }],
      activity_log: [{ data: null, error: null }],
    });

    const answer = await applyAgentDiscount(input);

    expect(answer).toMatchObject({ status: 'offer', expiresAt: FUTURE });
    expect(rpc).not.toHaveBeenCalled();
    expect(calls.activity_log[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ outcome: 'existing_returned' }) }),
    );
  });

  it('an allowed escalation replaces: old closed into history, new recorded, better prices answered', async () => {
    const better = offerRow({ id: 'o-better', value: 10, may_replace: true }); // final 180 < 190
    const { calls } = tableClient({
      coupon_assignments: [
        { data: null, error: null },
        { data: [assignmentRow()], error: null },
        { data: null, error: null }, // void update of a-1
        { data: { id: 'a-new' }, error: null }, // insert
      ],
      offers: [{ data: [better], error: null }],
      packages: [{ data: packageRows, error: null }],
      coupon_assignment_options: [{ data: null, error: null }],
      coupon_assignment_events: [
        { data: null, error: null }, // voided (escalation_replaced)
        { data: null, error: null }, // assigned
      ],
      activity_log: [{ data: null, error: null }],
    });

    const answer = await applyAgentDiscount(input);

    expect(answer).toMatchObject({
      status: 'offer',
      offer: { id: 'o-better' },
      options: [expect.objectContaining({ final_price: 180 })],
    });
    expect(calls.coupon_assignment_events[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ assignment_id: 'a-1', action: 'voided', reason: 'escalation_replaced' }),
    );
    expect(calls.activity_log[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ outcome: 'escalated', replacedAssignmentId: 'a-1' }),
      }),
    );
  });

  it('a replacement that would RAISE a shared package\'s promised price is refused', async () => {
    const worse = offerRow({ id: 'o-worse', value: 2, may_replace: true }); // final 196 > 190
    const { rpc } = tableClient({
      coupon_assignments: [
        { data: null, error: null },
        { data: [assignmentRow()], error: null },
      ],
      offers: [{ data: [worse], error: null }],
      packages: [{ data: packageRows, error: null }],
      activity_log: [{ data: null, error: null }],
    });

    const answer = await applyAgentDiscount(input);

    expect(answer).toMatchObject({ status: 'offer', offer: { id: 'o-1' }, expiresAt: FUTURE });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('escalation is refused while the assignment\'s campaign has an OPEN package payment (D23)', async () => {
    const better = offerRow({ id: 'o-better', value: 10, may_replace: true });
    tableClient({
      coupon_assignments: [
        { data: null, error: null },
        { data: [assignmentRow({ state: 'bound', bound_campaign_id: 'c-1' })], error: null },
      ],
      offers: [{ data: [better], error: null }],
      packages: [{ data: packageRows, error: null }],
      payment_operations: [{ data: { id: 'op-1' }, error: null }], // pending/review exists
      activity_log: [{ data: null, error: null }],
    });

    const answer = await applyAgentDiscount(input);

    // The held assignment is returned unchanged — never replaced.
    expect(answer).toMatchObject({ status: 'offer', offer: { id: 'o-1' } });
  });

  it('an allowed escalation of a BOUND (unlocked, unpaid) assignment releases, replaces and re-binds', async () => {
    const better = offerRow({ id: 'o-better', value: 10, may_replace: true });
    const { rpc } = tableClient({
      coupon_assignments: [
        { data: null, error: null },
        { data: [assignmentRow({ state: 'bound', bound_campaign_id: 'c-1' })], error: null },
        { data: null, error: null }, // void update
        { data: { id: 'a-new' }, error: null }, // insert
      ],
      offers: [{ data: [better], error: null }],
      packages: [{ data: packageRows, error: null }],
      payment_operations: [{ data: null, error: null }], // no open payment
      campaign_pricing: [{ data: { id: 'r-1', locked_at: null }, error: null }],
      coupon_assignment_options: [{ data: null, error: null }],
      coupon_assignment_events: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      activity_log: [{ data: null, error: null }],
    });

    const answer = await applyAgentDiscount(input);

    expect(answer).toMatchObject({ status: 'offer', offer: { id: 'o-better' } });
    expect(rpc).toHaveBeenCalledWith('release_coupon_assignment', expect.objectContaining({ _assignment_id: 'a-1' }));
    expect(rpc).toHaveBeenCalledWith('bind_coupon_assignment', expect.objectContaining({ _assignment_id: 'a-new', _campaign_id: 'c-1' }));
  });
});
