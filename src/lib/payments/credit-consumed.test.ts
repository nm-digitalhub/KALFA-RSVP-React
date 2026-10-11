import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';
import { creditConsumedByCampaign } from './credit-consumed';

// How much of the customer's credit each campaign has already used up: the credit of its succeeded collects in the
// payment ledger. A campaign with no ledger row has used none.
const op = (campaign_id: string, effect: string, outcome: string, credit_applied: number | string, over: TableRow = {}): TableRow => ({
  campaign_id,
  outcome,
  credit_applied,
  payment_operation_kinds: { effect },
  ...over,
});
const db = (rows: TableRow[]) => createFakeTableClient({ payment_operations: rows });
const run = (rows: TableRow[], campaignIds: string[]) => creditConsumedByCampaign(db(rows).client as never, campaignIds);

describe('creditConsumedByCampaign', () => {
  it('a campaign with no ledger rows has used no credit', async () => {
    expect(await run([], ['c1'])).toEqual(new Map([['c1', 0]]));
  });

  it('credit used by a succeeded collect is read from the ledger', async () => {
    expect((await run([op('c1', 'collect', 'succeeded', 30)], ['c1'])).get('c1')).toBe(30);
  });

  it('a historical pay-per-result charge counts its credit (₪84 on a ₪0 charge)', async () => {
    expect((await run([op('c1', 'collect', 'succeeded', 84, { amount: 0 })], ['c1'])).get('c1')).toBe(84);
  });

  it('adds up several succeeded collects of one campaign (a purchase and an upgrade)', async () => {
    const m = await run([op('c1', 'collect', 'succeeded', 30), op('c1', 'collect', 'succeeded', '12.50')], ['c1']);
    expect(m.get('c1')).toBe(42.5);
  });

  it.each([
    ['a failed collect', op('c1', 'collect', 'failed', 30)],
    ['a pending collect', op('c1', 'collect', 'pending', 30)],
    ['a collect in review', op('c1', 'collect', 'review', 30)],
    ['a hold (commit)', op('c1', 'commit', 'succeeded', 30)],
    ['a refund (return)', op('c1', 'return', 'succeeded', 30)],
  ])('%s does not count as credit used', async (_name, row) => {
    expect((await run([row], ['c1'])).get('c1')).toBe(0);
  });

  it('keeps each campaign apart, in the order asked', async () => {
    const m = await run([op('c1', 'collect', 'succeeded', 30), op('c2', 'collect', 'succeeded', 5)], ['c1', 'c2', 'c3']);
    expect([...m]).toEqual([['c1', 30], ['c2', 5], ['c3', 0]]);
  });

  it('asks for nothing when there are no campaigns', async () => {
    const fake = db([]);
    expect(await creditConsumedByCampaign(fake.client as never, [])).toEqual(new Map());
    expect(fake.ops).toHaveLength(0);
  });

  it('asks the ledger once, for exactly the given campaigns', async () => {
    const fake = db([]);
    await creditConsumedByCampaign(fake.client as never, ['c1', 'c2']);
    expect(fake.ops).toHaveLength(1);
    expect(fake.ops[0]).toMatchObject({ table: 'payment_operations', op: 'select', filters: [['in', 'campaign_id', ['c1', 'c2']]] });
  });

  it('THROWS when the ledger cannot be read — a guard must never silently count zero', async () => {
    const fake = db([]);
    fake.fail('payment_operations', '57014', 'select');
    await expect(creditConsumedByCampaign(fake.client as never, ['c1'])).rejects.toThrow();
  });
});
