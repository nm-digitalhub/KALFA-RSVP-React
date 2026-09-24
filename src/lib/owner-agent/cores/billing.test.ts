import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { createAdminClient } from '@/lib/supabase/admin';
import { createFakeCountClient, nonNumericLeaves } from '@/test/fake-count-client';
import { getBillingSummary } from './billing';

type AdminClient = ReturnType<typeof createAdminClient>;

// 01:30 Israel on 2026-09-25: Israel midnight = 2026-09-24T21:00Z, rolling
// 7d = 2026-09-17T22:30Z, rolling 30d = 2026-08-25T22:30Z.
const NOW = Date.parse('2026-09-24T22:30:00Z');

// Every campaign row carries the card/token/document columns the core must
// never select, and every credit its free-text reason.
const secret = {
  card_token_ref: 'tok_live_123',
  card_citizen_id: '123456789',
  auth_external_ref: 'ext-1',
  charge_document_url: 'https://doc/receipt',
  final_charge_amount: 450,
  credit_applied: 50,
};
function db() {
  return createFakeCountClient({
    campaigns: [
      // charged after Israel midnight
      { id: 'c1', ...secret, charge_status: 'charged', charged_at: '2026-09-24T21:30:00Z', capture_status: 'captured', release_status: null },
      // charged earlier this week (before Israel midnight, inside 7d)
      { id: 'c2', ...secret, charge_status: 'charged', charged_at: '2026-09-20T10:00:00Z', capture_status: 'captured', release_status: null },
      // charged outside 7d, inside 30d
      { id: 'c3', ...secret, charge_status: 'charged', charged_at: '2026-09-01T10:00:00Z', capture_status: 'captured', release_status: null },
      { id: 'c4', ...secret, charge_status: 'nothing_to_charge', charged_at: '2026-09-24T22:00:00Z', capture_status: 'authorized', release_status: 'released' },
      { id: 'c5', ...secret, charge_status: 'pending', charged_at: null, capture_status: 'authorized', release_status: null },
      { id: 'c6', ...secret, charge_status: 'charge_failed', charged_at: null, capture_status: 'authorized', release_status: null },
      { id: 'c7', ...secret, charge_status: 'charge_review', charged_at: null, capture_status: 'authorized', release_status: null },
      // hold in place, no charge outcome yet → awaiting charge
      { id: 'c8', ...secret, charge_status: null, charged_at: null, capture_status: 'authorized', release_status: null },
      // hold authorized but released in SUMIT → not awaiting
      { id: 'c9', ...secret, charge_status: null, charged_at: null, capture_status: 'authorized', release_status: 'released' },
      // no hold yet
      { id: 'c10', ...secret, charge_status: null, charged_at: null, capture_status: null, release_status: null },
    ],
    billing_credits: [
      { id: 'b1', amount: 100, reason: 'פיצוי ללקוחה דנה', created_at: '2026-09-24T21:10:00Z', voided_at: null },
      { id: 'b2', amount: 40, reason: 'x', created_at: '2026-09-19T10:00:00Z', voided_at: null },
      { id: 'b3', amount: 60, reason: 'x', created_at: '2026-09-19T10:00:00Z', voided_at: '2026-09-24T21:20:00Z' },
      { id: 'b4', amount: 30, reason: 'x', created_at: '2026-07-01T10:00:00Z', voided_at: null },
    ],
  });
}

describe('getBillingSummary (core)', () => {
  it("'today' counts charges and credits from Israel midnight", async () => {
    const { client } = db();
    const s = await getBillingSummary(client as unknown as AdminClient, 'today', NOW);
    expect(s).toEqual({
      chargedInRange: 1, // c1
      nothingToChargeInRange: 1, // c4
      chargesPending: 1,
      chargesFailed: 1,
      chargesInReview: 1,
      holdsAwaitingCharge: 1, // c8 only: c9 released, c5–c7 have an outcome
      creditsActive: 3, // b1, b2, b4
      creditsGrantedInRange: 1, // b1
      creditsVoidedInRange: 1, // b3
    });
  });

  it("'7d' and '30d' widen only the range-bound counts", async () => {
    const { client } = db();
    const s7 = await getBillingSummary(client as unknown as AdminClient, '7d', NOW);
    expect(s7.chargedInRange).toBe(2); // c1, c2
    expect(s7.creditsGrantedInRange).toBe(2); // b1, b2 (b3 voided)
    const s30 = await getBillingSummary(client as unknown as AdminClient, '30d', NOW);
    expect(s30.chargedInRange).toBe(3);
    expect(s30.creditsGrantedInRange).toBe(2); // b4 is older than 30d
    expect(s30.holdsAwaitingCharge).toBe(1); // current state, not range-bound
  });

  it('every query is a head-only exact count selecting only id', async () => {
    const { client, calls } = db();
    await getBillingSummary(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(9);
    for (const c of calls) {
      expect(['campaigns', 'billing_credits']).toContain(c.table);
      expect(c.columns).toBe('id');
      expect(c.selectOptions).toEqual({ count: 'exact', head: true });
    }
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: 'campaigns',
        filters: [
          { op: 'eq', args: ['charge_status', 'charged'] },
          { op: 'gte', args: ['charged_at', '2026-09-17T22:30:00.000Z'] },
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

  it('carries no sum field until the aggregates migration is applied', async () => {
    const { client } = db();
    const s = await getBillingSummary(client as unknown as AdminClient, '30d', NOW);
    for (const key of Object.keys(s)) expect(key).not.toMatch(/amount|sum/i);
  });

  it('throws on a query error (no confident 0)', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['billing_credits'] });
    await expect(
      getBillingSummary(client as unknown as AdminClient, 'today', NOW),
    ).rejects.toThrow();
  });
});
