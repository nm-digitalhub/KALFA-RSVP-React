import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';
import { creditConsumedByCampaign } from './credit-consumed';

// How much of the customer's credit each campaign has already used up. Two places can say so, and exactly one of them
// is asked per campaign: the payment ledger when the campaign has ANY ledger row (the historical campaigns have both,
// and must not be counted twice), the old campaigns.credit_applied column otherwise.
const op = (campaign_id: string, effect: string, outcome: string, credit_applied: number | string, over: TableRow = {}): TableRow => ({
  campaign_id,
  outcome,
  credit_applied,
  payment_operation_kinds: { effect },
  ...over,
});
const db = (rows: TableRow[]) => createFakeTableClient({ payment_operations: rows });
const run = (rows: TableRow[], campaigns: Array<{ id: string; credit_applied: number | string | null }>) =>
  creditConsumedByCampaign(db(rows).client as never, campaigns);

describe('creditConsumedByCampaign', () => {
  it('a campaign with no ledger rows is read from the old column', async () => {
    expect(await run([], [{ id: 'c1', credit_applied: 84 }])).toEqual(new Map([['c1', 84]]));
  });

  it('a null or missing old column is zero', async () => {
    expect(await run([], [{ id: 'c1', credit_applied: null }])).toEqual(new Map([['c1', 0]]));
  });

  it('a campaign with ledger rows is read from the ledger — credit used by a succeeded collect', async () => {
    const m = await run([op('c1', 'collect', 'succeeded', 30)], [{ id: 'c1', credit_applied: 0 }]);
    expect(m.get('c1')).toBe(30);
  });

  it('a campaign that is in BOTH places is counted once, not twice (the two historical campaigns)', async () => {
    const m = await run([op('c1', 'collect', 'succeeded', 84)], [{ id: 'c1', credit_applied: 84 }]);
    expect(m.get('c1')).toBe(84);
  });

  it('once the ledger has the campaign, the old column is no longer consulted', async () => {
    const m = await run([op('c1', 'collect', 'succeeded', 0)], [{ id: 'c1', credit_applied: 84 }]);
    expect(m.get('c1')).toBe(0);
  });

  it('adds up several succeeded collects of one campaign (a purchase and an upgrade)', async () => {
    const m = await run(
      [op('c1', 'collect', 'succeeded', 30), op('c1', 'collect', 'succeeded', '12.50')],
      [{ id: 'c1', credit_applied: 0 }],
    );
    expect(m.get('c1')).toBe(42.5);
  });

  it.each([
    ['a failed collect', op('c1', 'collect', 'failed', 30)],
    ['a pending collect', op('c1', 'collect', 'pending', 30)],
    ['a collect in review', op('c1', 'collect', 'review', 30)],
    ['a hold (commit)', op('c1', 'commit', 'succeeded', 30)],
    ['a refund (return)', op('c1', 'return', 'succeeded', 30)],
  ])('%s does not count as credit used — and the campaign is still read from the ledger', async (_name, row) => {
    const m = await run([row], [{ id: 'c1', credit_applied: 99 }]);
    expect(m.get('c1')).toBe(0);
  });

  it('keeps each campaign apart', async () => {
    const m = await run(
      [op('c1', 'collect', 'succeeded', 30), op('c2', 'collect', 'succeeded', 5)],
      [{ id: 'c1', credit_applied: 0 }, { id: 'c2', credit_applied: 0 }, { id: 'c3', credit_applied: '7' }],
    );
    expect([...m]).toEqual([['c1', 30], ['c2', 5], ['c3', 7]]);
  });

  it('asks for nothing when there are no campaigns', async () => {
    const fake = db([]);
    expect(await creditConsumedByCampaign(fake.client as never, [])).toEqual(new Map());
    expect(fake.ops).toHaveLength(0);
  });

  it('asks the ledger once, for exactly the given campaigns', async () => {
    const fake = db([]);
    await creditConsumedByCampaign(fake.client as never, [{ id: 'c1', credit_applied: 0 }, { id: 'c2', credit_applied: 0 }]);
    expect(fake.ops).toHaveLength(1);
    expect(fake.ops[0]).toMatchObject({ table: 'payment_operations', op: 'select', filters: [['in', 'campaign_id', ['c1', 'c2']]] });
  });

  it('THROWS when the ledger cannot be read — a guard must never silently count zero', async () => {
    const fake = db([]);
    fake.fail('payment_operations', '57014', 'select');
    await expect(creditConsumedByCampaign(fake.client as never, [{ id: 'c1', credit_applied: 84 }])).rejects.toThrow();
  });
});
