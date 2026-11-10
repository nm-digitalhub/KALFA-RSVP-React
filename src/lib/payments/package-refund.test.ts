import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { packagePaymentRecord } from './package-refund';

function seed(kind: string, outcome: string, over: TableRow = {}): TableRow {
  return {
    id: `seed-${kind}-${outcome}`,
    campaign_id: 'c1',
    event_id: 'e1',
    kind,
    outcome,
    amount: 120,
    credit_applied: 0,
    occurred_at: '2026-10-01T10:00:00.000Z',
    recorded_at: '2026-10-01T10:00:00.000Z',
    meta: {},
    ...over,
  };
}

const PURCHASE = seed('package_purchase', 'succeeded', { id: 'pur1', provider_document_id: 77, provider_document_number: 40106 });

function useDb(rows: TableRow[] = [PURCHASE]) {
  vi.mocked(createAdminClient).mockReturnValue(createFakeTableClient({ payment_operations: rows }).client as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  useDb();
});

// The ledger facts shown next to the money: the purchase's document and how THIS request's last refund attempt ended.
describe('packagePaymentRecord', () => {
  it('the document the purchase issued, and no attempt when the request refunded nothing yet', async () => {
    const record = await packagePaymentRecord('c1', 'req1');
    expect(record.purchaseDocument).toMatchObject({ id: 77, number: 40106 });
    expect(record.lastRefundAttempt).toBeNull();
  });

  it('the LAST attempt of THIS request, with the provider\'s own answer', async () => {
    useDb([
      PURCHASE,
      seed('refund', 'failed', { id: 'r1', amount: 120, meta: { cancellation_request_id: 'req1' }, recorded_at: '2026-10-09T11:00:00.000Z', occurred_at: '2026-10-09T11:00:00.000Z' }),
      seed('refund', 'failed', {
        id: 'r2', amount: 120, meta: { cancellation_request_id: 'req1' }, provider_status: '9006', provider_status_description: 'אין הרשאה',
        recorded_at: '2026-10-09T13:00:00.000Z', occurred_at: '2026-10-09T13:00:00.000Z',
      }),
      seed('refund', 'failed', { id: 'r3', amount: 120, meta: { cancellation_request_id: 'other' }, recorded_at: '2026-10-09T14:00:00.000Z', occurred_at: '2026-10-09T14:00:00.000Z' }),
    ]);
    expect((await packagePaymentRecord('c1', 'req1')).lastRefundAttempt).toEqual({
      outcome: 'failed', providerStatus: '9006', providerStatusDescription: 'אין הרשאה', recordedAt: '2026-10-09T13:00:00.000Z',
    });
  });

  it('a campaign that never paid has no purchase document', async () => {
    useDb([]);
    expect(await packagePaymentRecord('c1')).toEqual({ purchaseDocument: null, lastRefundAttempt: null });
  });
});
