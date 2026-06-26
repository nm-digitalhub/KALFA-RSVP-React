import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/payments', () => ({
  getPaymentsEnabled: vi.fn(),
  getCloseChargeEnabled: vi.fn(),
  getSumitServerConfig: vi.fn(),
}));
vi.mock('@/lib/agreements/template', () => ({ VAT_RATE_PERCENT: 18 }));
vi.mock('@/lib/data/campaigns', () => ({
  closeCampaign: vi.fn(),
  getCampaignForCharge: vi.fn(),
  lockCampaignForCharge: vi.fn(),
  recordCampaignCharge: vi.fn(),
  markCampaignChargeOutcome: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ getCampaignBillingSummary: vi.fn() }));
vi.mock('@/lib/sumit/capture', () => ({ captureHeldCardSumit: vi.fn() }));

import {
  getPaymentsEnabled,
  getCloseChargeEnabled,
  getSumitServerConfig,
} from '@/lib/data/payments';
import {
  closeCampaign,
  getCampaignForCharge,
  lockCampaignForCharge,
  recordCampaignCharge,
  markCampaignChargeOutcome,
} from '@/lib/data/campaigns';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import { captureHeldCardSumit } from '@/lib/sumit/capture';
import { SumitDeclinedError } from '@/lib/sumit/charge';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';

type Mock = ReturnType<typeof vi.fn>;
const m = {
  payments: getPaymentsEnabled as unknown as Mock,
  close: getCloseChargeEnabled as unknown as Mock,
  sumit: getSumitServerConfig as unknown as Mock,
  forCharge: getCampaignForCharge as unknown as Mock,
  lock: lockCampaignForCharge as unknown as Mock,
  summary: getCampaignBillingSummary as unknown as Mock,
  capture: captureHeldCardSumit as unknown as Mock,
};

function happy() {
  m.payments.mockResolvedValue(true);
  m.close.mockResolvedValue(true);
  m.sumit.mockResolvedValue({ companyId: 1, apiKey: 'k' });
  m.forCharge.mockResolvedValue({
    id: 'c1',
    event_id: 'e1',
    status: 'active',
    capture_status: 'authorized',
    charge_status: null,
    sumit_customer_ref: 'kalfa-campaign-c1',
    max_charge_ceiling: '88',
  });
  m.summary.mockResolvedValue({
    reachedCount: 3,
    accrued: 12,
    ceiling: 88,
    maxContacts: 22,
  });
  m.lock.mockResolvedValue(true);
  m.capture.mockResolvedValue({ documentId: 555 });
}

beforeEach(() => vi.clearAllMocks());

describe('closeCampaignAndCharge', () => {
  it('does nothing when close-charge is disabled (fail-closed)', async () => {
    m.payments.mockResolvedValue(true);
    m.close.mockResolvedValue(false);
    m.sumit.mockResolvedValue({ companyId: 1, apiKey: 'k' });
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'disabled', amount: 0 });
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('bad_state when no held card (capture_status not authorized)', async () => {
    happy();
    m.forCharge.mockResolvedValue({
      id: 'c1',
      event_id: 'e1',
      status: 'closed',
      capture_status: null,
      charge_status: null,
      sumit_customer_ref: 'kalfa-campaign-c1',
      max_charge_ceiling: '88',
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r.outcome).toBe('bad_state');
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('bad_state when the hold has no recoverable Customer ref (pre-fix hold)', async () => {
    happy();
    m.forCharge.mockResolvedValue({
      id: 'c1',
      event_id: 'e1',
      status: 'closed',
      capture_status: 'authorized',
      charge_status: null,
      sumit_customer_ref: null,
      max_charge_ceiling: '88',
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r.outcome).toBe('bad_state');
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('nothing_to_charge when nothing was reached (accrued 0)', async () => {
    happy();
    m.summary.mockResolvedValue({
      reachedCount: 0,
      accrued: 0,
      ceiling: 88,
      maxContacts: 22,
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'nothing_to_charge', amount: 0 });
    expect(markCampaignChargeOutcome).toHaveBeenCalledWith(
      'c1',
      'nothing_to_charge',
    );
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('charges exactly the accrued total and records it', async () => {
    happy();
    const r = await closeCampaignAndCharge('c1');
    expect(closeCampaign).toHaveBeenCalledWith('c1');
    expect(captureHeldCardSumit).toHaveBeenCalledWith(
      expect.objectContaining({
        customerRef: 'kalfa-campaign-c1',
        amount: '12',
      }),
    );
    expect(recordCampaignCharge).toHaveBeenCalledWith('c1', {
      amount: 12,
      documentId: 555,
    });
    expect(r).toEqual({ outcome: 'charged', amount: 12 });
  });

  it('caps the amount at the ceiling', async () => {
    happy();
    m.summary.mockResolvedValue({
      reachedCount: 99,
      accrued: 100,
      ceiling: 88,
      maxContacts: 22,
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'charged', amount: 88 });
    expect(captureHeldCardSumit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '88' }),
    );
  });

  it('bad_state (idempotent) when the charge guard is already taken', async () => {
    happy();
    m.lock.mockResolvedValue(false);
    const r = await closeCampaignAndCharge('c1');
    expect(r.outcome).toBe('bad_state');
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('declined → charge_failed on a definitive SUMIT decline', async () => {
    happy();
    m.capture.mockRejectedValue(new SumitDeclinedError());
    const r = await closeCampaignAndCharge('c1');
    expect(r.outcome).toBe('declined');
    expect(markCampaignChargeOutcome).toHaveBeenCalledWith('c1', 'charge_failed');
  });

  it('review (not retry) on a network/ambiguous outcome', async () => {
    happy();
    m.capture.mockRejectedValue(new Error('network'));
    const r = await closeCampaignAndCharge('c1');
    expect(r.outcome).toBe('review');
    expect(markCampaignChargeOutcome).toHaveBeenCalledWith('c1', 'charge_review');
  });
});
