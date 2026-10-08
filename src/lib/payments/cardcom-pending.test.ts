import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

let fake: FakeTableClient;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }));

import { isCardcomPurchasePending } from './cardcom-pending';

// The payment page asks one thing: is the purchase that is waiting on this campaign a CardCom form the buyer can pick up
// again? Only then does a pending payment show the form instead of "in progress" (a SUMIT charge in flight never does).

const op = (over: TableRow = {}): TableRow => ({ id: 'op1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', meta: { provider: 'cardcom' }, ...over });

describe('isCardcomPurchasePending', () => {
  it('is true for a pending CardCom purchase of the campaign', async () => {
    fake = createFakeTableClient({ payment_operations: [op()] });
    await expect(isCardcomPurchasePending('c1')).resolves.toBe(true);
  });

  it.each([
    ['a pending purchase with no provider (SUMIT)', [op({ meta: { payerUserId: 'u' } })]],
    ['a CardCom purchase that is already closed', [op({ outcome: 'failed' })]],
    ['a CardCom purchase in review', [op({ outcome: 'review' })]],
    ['another campaign\'s purchase', [op({ campaign_id: 'c2' })]],
    ['another kind of operation', [op({ kind: 'refund' })]],
    ['nothing at all', []],
  ])('is false for %s', async (_label, rows) => {
    fake = createFakeTableClient({ payment_operations: rows as TableRow[] });
    await expect(isCardcomPurchasePending('c1')).resolves.toBe(false);
  });

  it('is false, not a throw, when the ledger cannot be read', async () => {
    fake = createFakeTableClient({ payment_operations: [op()] });
    fake.fail('payment_operations', '42501');
    await expect(isCardcomPurchasePending('c1')).resolves.toBe(false);
  });
});
