import { beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo convention).
vi.mock('server-only', () => ({}));

vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getSumitServerConfig: vi.fn() }));
vi.mock('@/lib/sumit/crm-holds', () => ({
  listSumitHolds: vi.fn(),
  SUMIT_HOLD_STATUS_OPEN: 1,
  SUMIT_HOLD_STATUS_RELEASED: 3,
}));

// campaigns: select().eq().not().or() resolves the open-hold list.
// activity_log: insert() resolves ok.
// campaigns update: update().eq().or().select() resolves the per-row write.
const selectOrMock = vi.fn();
const updateSelectMock = vi.fn();
const insertMock = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'activity_log') {
        return { insert: insertMock };
      }
      // campaigns: two distinct chains share this mock — the initial read
      // (select/eq/not/or) and the per-row write (update/eq/or/select). Both
      // terminate in a single awaited call, so one mock per table is enough
      // as long as each test queues results in call order.
      return {
        select: () => ({ eq: () => ({ not: () => ({ or: selectOrMock }) }) }),
        update: () => ({ eq: () => ({ or: () => ({ select: updateSelectMock }) }) }),
      };
    },
  }),
}));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { getSumitServerConfig } from '@/lib/data/payments';
import { listSumitHolds } from '@/lib/sumit/crm-holds';
import { runSumitHoldReconcile } from './sumit-hold-reconcile';

const openHold = (over: Partial<{
  id: string; event_id: string; hold_order_document_id: number; auth_amount: number | null;
}> = {}) => ({
  id: 'campaign-1', event_id: 'event-1', hold_order_document_id: 1001, auth_amount: 152,
  ...over,
});

beforeEach(() => {
  vi.mocked(sendSlackAlert).mockReset().mockResolvedValue(null);
  vi.mocked(getSumitServerConfig).mockReset();
  vi.mocked(listSumitHolds).mockReset();
  selectOrMock.mockReset();
  updateSelectMock.mockReset();
  insertMock.mockReset().mockResolvedValue({ error: null });
});

describe('runSumitHoldReconcile', () => {
  it('is a no-op when there are no open holds needing a check', async () => {
    selectOrMock.mockResolvedValue({ data: [], error: null });

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 0, released: 0, failed: false });
    expect(getSumitServerConfig).not.toHaveBeenCalled();
    expect(listSumitHolds).not.toHaveBeenCalled();
  });

  it('fails closed when the initial campaigns read errors', async () => {
    selectOrMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 0, released: 0, failed: true });
  });

  it('fails closed when SUMIT server config is unavailable', async () => {
    selectOrMock.mockResolvedValue({ data: [openHold()], error: null });
    vi.mocked(getSumitServerConfig).mockResolvedValue(null);

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 1, released: 0, failed: true });
    expect(listSumitHolds).not.toHaveBeenCalled();
  });

  it('fails closed when the SUMIT CRM call throws', async () => {
    selectOrMock.mockResolvedValue({ data: [openHold()], error: null });
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(listSumitHolds).mockRejectedValue(new Error('network'));

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 1, released: 0, failed: true });
  });

  it('leaves a still-open hold untouched (Billing_Status 1)', async () => {
    selectOrMock.mockResolvedValue({ data: [openHold()], error: null });
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(listSumitHolds).mockResolvedValue([
      { entityId: 1, orderDocumentId: 1001, billingStatus: 1, amount: 152, date: null },
    ]);

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 1, released: 0, failed: false });
    expect(updateSelectMock).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('ignores Billing_Status 2 (charged) by design — never syncs it', async () => {
    selectOrMock.mockResolvedValue({ data: [openHold()], error: null });
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(listSumitHolds).mockResolvedValue([
      { entityId: 1, orderDocumentId: 1001, billingStatus: 2, amount: 152, date: null },
    ]);

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 1, released: 0, failed: false });
    expect(updateSelectMock).not.toHaveBeenCalled();
  });

  it('syncs release_status, records activity, and alerts on a released hold', async () => {
    selectOrMock.mockResolvedValue({ data: [openHold()], error: null });
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(listSumitHolds).mockResolvedValue([
      { entityId: 1, orderDocumentId: 1001, billingStatus: 3, amount: 152, date: null },
    ]);
    updateSelectMock.mockResolvedValue({ data: [{ id: 'campaign-1' }], error: null });

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 1, released: 1, failed: false });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'event-1',
        user_id: null,
        action: 'campaign.hold_released_synced',
      }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'campaign_billing', level: 'info' }),
    );
  });

  it('a hold with no matching SUMIT entity is left untouched', async () => {
    selectOrMock.mockResolvedValue({ data: [openHold({ hold_order_document_id: 9999 })], error: null });
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(listSumitHolds).mockResolvedValue([
      { entityId: 1, orderDocumentId: 1001, billingStatus: 3, amount: 152, date: null },
    ]);

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 1, released: 0, failed: false });
    expect(updateSelectMock).not.toHaveBeenCalled();
  });

  it('a lost CAS race on the update (0 rows) is not counted as released', async () => {
    selectOrMock.mockResolvedValue({ data: [openHold()], error: null });
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(listSumitHolds).mockResolvedValue([
      { entityId: 1, orderDocumentId: 1001, billingStatus: 3, amount: 152, date: null },
    ]);
    updateSelectMock.mockResolvedValue({ data: [], error: null });

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 1, released: 0, failed: false });
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a failed activity_log insert does not block the release sync itself', async () => {
    selectOrMock.mockResolvedValue({ data: [openHold()], error: null });
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(listSumitHolds).mockResolvedValue([
      { entityId: 1, orderDocumentId: 1001, billingStatus: 3, amount: 152, date: null },
    ]);
    updateSelectMock.mockResolvedValue({ data: [{ id: 'campaign-1' }], error: null });
    insertMock.mockRejectedValue(new Error('insert failed'));

    const result = await runSumitHoldReconcile();

    expect(result).toEqual({ checked: 1, released: 1, failed: false });
    expect(sendSlackAlert).toHaveBeenCalled();
  });
});
