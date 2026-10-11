import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { createAdminClient } from '@/lib/supabase/admin';
import { createFakeCountClient, nonNumericLeaves } from '@/test/fake-count-client';
import { getBillingSummary } from './billing';

type AdminClient = ReturnType<typeof createAdminClient>;

// 01:30 Israel on 2026-09-25: Israel midnight = 2026-09-24T21:00Z, rolling
// 7d = 2026-09-17T22:30Z, rolling 30d = 2026-08-25T22:30Z.
const NOW = Date.parse('2026-09-24T22:30:00Z');

// Every ledger row carries the card/token/document columns the core must never
// select, and every credit its free-text reason.
const secret = {
  card_token_ref: 'tok_live_123',
  citizen_id_secret: '123456789',
  provider_document_url: 'https://doc/receipt',
  amount: 450,
};
const collect = { payment_operation_kinds: { effect: 'collect' } };
const giveBack = { payment_operation_kinds: { effect: 'return' } };
const hold = { payment_operation_kinds: { effect: 'commit' } };
// What owner_agent_billing_sums returns: ONE row (PostgREST hands a
// table-returning function back as an array). Non-integer shekels on purpose.
const SUMS_ROW = {
  charged_amount: 1350.5,
  credit_applied_amount: 100,
  unvoided_credit_amount: 170,
  credit_granted_amount: 100,
};
type SumsHandler = (args: Record<string, unknown> | undefined) => { data: unknown; error: { message: string } | null };
const sumsOk: SumsHandler = () => ({ data: [SUMS_ROW], error: null });

function db(sums: SumsHandler = sumsOk) {
  return createFakeCountClient({
    payment_operations: [
      // collected after Israel midnight
      { id: 'o1', ...secret, ...collect, outcome: 'succeeded', is_test: false, occurred_at: '2026-09-24T21:30:00Z' },
      // collected earlier this week (before Israel midnight, inside 7d)
      { id: 'o2', ...secret, ...collect, outcome: 'succeeded', is_test: false, occurred_at: '2026-09-20T10:00:00Z' },
      // collected outside 7d, inside 30d
      { id: 'o3', ...secret, ...collect, outcome: 'succeeded', is_test: false, occurred_at: '2026-09-01T10:00:00Z' },
      // test money is never counted
      { id: 'o4', ...secret, ...collect, outcome: 'succeeded', is_test: true, occurred_at: '2026-09-24T21:40:00Z' },
      // a refund after Israel midnight
      { id: 'o5', ...secret, ...giveBack, outcome: 'succeeded', is_test: false, occurred_at: '2026-09-24T22:00:00Z' },
      // a declined purchase after Israel midnight
      { id: 'o6', ...secret, ...collect, outcome: 'failed', is_test: false, occurred_at: '2026-09-24T21:50:00Z' },
      // outcome not known yet, and one a person must resolve (current state)
      { id: 'o7', ...secret, ...collect, outcome: 'pending', is_test: false, occurred_at: '2026-08-01T10:00:00Z' },
      { id: 'o8', ...secret, ...giveBack, outcome: 'review', is_test: false, occurred_at: '2026-08-01T10:00:00Z' },
      // a pay-per-result hold (history): neither a payment nor a refund
      { id: 'o9', ...secret, ...hold, outcome: 'succeeded', is_test: false, occurred_at: '2026-09-24T21:35:00Z' },
    ],
    billing_credits: [
      { id: 'b1', amount: 100, reason: 'פיצוי ללקוחה דנה', created_at: '2026-09-24T21:10:00Z', voided_at: null },
      { id: 'b2', amount: 40, reason: 'x', created_at: '2026-09-19T10:00:00Z', voided_at: null },
      { id: 'b3', amount: 60, reason: 'x', created_at: '2026-09-19T10:00:00Z', voided_at: '2026-09-24T21:20:00Z' },
      { id: 'b4', amount: 30, reason: 'x', created_at: '2026-07-01T10:00:00Z', voided_at: null },
    ],
  }, { rpc: { owner_agent_billing_sums: sums } });
}

describe('getBillingSummary (core)', () => {
  it("'today' counts payments and credits from Israel midnight", async () => {
    const { client } = db();
    const s = await getBillingSummary(client as unknown as AdminClient, 'today', NOW);
    expect(s).toEqual({
      paymentsInRange: 1, // o1; o4 is test money, o9 a hold
      refundsInRange: 1, // o5
      paymentsFailedInRange: 1, // o6
      operationsPending: 1, // o7
      operationsInReview: 1, // o8
      creditsActive: 3, // b1, b2, b4
      creditsGrantedInRange: 1, // b1
      creditsVoidedInRange: 1, // b3
      chargedAmountIls: 1350.5,
      creditAppliedAmountIls: 100,
      creditGrantedAmountIls: 100,
      creditUnvoidedAmountIls: 170,
    });
  });

  it("'7d' and '30d' widen only the range-bound counts", async () => {
    const { client } = db();
    const s7 = await getBillingSummary(client as unknown as AdminClient, '7d', NOW);
    expect(s7.paymentsInRange).toBe(2); // o1, o2
    expect(s7.creditsGrantedInRange).toBe(2); // b1, b2 (b3 voided)
    const s30 = await getBillingSummary(client as unknown as AdminClient, '30d', NOW);
    expect(s30.paymentsInRange).toBe(3);
    expect(s30.creditsGrantedInRange).toBe(2); // b4 is older than 30d
    expect(s30.operationsPending).toBe(1); // current state, not range-bound
  });

  it('every query is a head-only exact count selecting only id (and, on the ledger, the kind it filters on)', async () => {
    const { client, calls } = db();
    await getBillingSummary(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      expect(['payment_operations', 'billing_credits']).toContain(c.table);
      expect(c.columns).toBe(c.table === 'payment_operations' ? 'id, payment_operation_kinds!inner(effect)' : 'id');
      expect(c.selectOptions).toEqual({ count: 'exact', head: true });
    }
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: 'payment_operations',
        filters: [
          { op: 'eq', args: ['is_test', false] },
          { op: 'eq', args: ['payment_operation_kinds.effect', 'collect'] },
          { op: 'eq', args: ['outcome', 'succeeded'] },
          { op: 'gte', args: ['occurred_at', '2026-09-17T22:30:00.000Z'] },
        ],
      }),
    );
  });

  it('result is numbers only — no token, card, document URL or credit reason', async () => {
    const { client } = db();
    const s = await getBillingSummary(client as unknown as AdminClient, '30d', NOW);
    expect(nonNumericLeaves(s)).toEqual([]);
    const json = JSON.stringify(s);
    for (const leak of ['tok_live', '123456789', 'https://', 'דנה']) {
      expect(json).not.toContain(leak);
    }
  });

  it('reads the sums from ONE rpc call, with the range start as _since', async () => {
    const { client, rpcCalls } = db();
    await getBillingSummary(client as unknown as AdminClient, '7d', NOW);
    expect(rpcCalls).toEqual([{ fn: 'owner_agent_billing_sums', args: { _since: '2026-09-17T22:30:00.000Z' } }]);
  });

  it.each([
    ['an rpc error', () => ({ data: null, error: { message: 'boom' } })],
    ['no row', () => ({ data: [], error: null })],
    ['two rows', () => ({ data: [SUMS_ROW, SUMS_ROW], error: null })],
    ['a non-array answer', () => ({ data: SUMS_ROW, error: null })],
    ['a negative sum', () => ({ data: [{ ...SUMS_ROW, charged_amount: -1 }], error: null })],
    ['a string sum', () => ({ data: [{ ...SUMS_ROW, credit_applied_amount: '100' }], error: null })],
    ['a missing sum', () => ({ data: [{ ...SUMS_ROW, credit_granted_amount: null }], error: null })],
    ['NaN', () => ({ data: [{ ...SUMS_ROW, unvoided_credit_amount: Number.NaN }], error: null })],
  ] as [string, SumsHandler][])('throws a bare code on %s (no guessed sum)', async (_label, handler) => {
    const { client } = db(handler);
    const err = await getBillingSummary(client as unknown as AdminClient, '30d', NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^billing_sums_(failed|unexpected)$/);
  });

  it('throws on a query error (no confident 0)', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['billing_credits'] });
    await expect(
      getBillingSummary(client as unknown as AdminClient, 'today', NOW),
    ).rejects.toThrow();
  });
});

// A closed window (cores/window.ts) that holds o2 (collected 20.9) and b2
// (granted 19.9) and ends before everything dated 24.9 21:00Z or later.
const WINDOW = { sinceIso: '2026-09-19T00:00:00.000Z', untilIso: '2026-09-24T21:00:00.000Z' };

describe('getBillingSummary with a window', () => {
  it('bounds the in-range counts and passes _until to the sums rpc', async () => {
    const { client, rpcCalls } = db();
    const s = await getBillingSummary(client as unknown as AdminClient, 'today', NOW, WINDOW);
    expect(s.paymentsInRange).toBe(1); // o2; o1 (21:30Z) is after the until bound
    expect(s.refundsInRange).toBe(0); // o5 at 22:00Z is after it
    expect(s.creditsGrantedInRange).toBe(1); // b2
    expect(s.creditsVoidedInRange).toBe(0); // b3 voided at 21:20Z, after it
    // Current state ignores the window.
    expect(s.operationsPending).toBe(1);
    expect(s.creditsActive).toBe(3);
    expect(rpcCalls).toEqual([
      { fn: 'owner_agent_billing_sums', args: { _since: WINDOW.sinceIso, _until: WINDOW.untilIso } },
    ]);
  });

  it('without a window the rpc keeps its exact one-argument shape and no until bound is added', async () => {
    const { client, rpcCalls, calls } = db();
    await getBillingSummary(client as unknown as AdminClient, 'today', NOW);
    expect(Object.keys(rpcCalls[0].args ?? {})).toEqual(['_since']);
    expect(calls.flatMap((c) => c.filters).some((f) => f.op === 'lt')).toBe(false);
  });
});
