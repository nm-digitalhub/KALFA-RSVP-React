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
vi.mock('@/lib/data/billing', () => ({
  getCampaignBillingSummary: vi.fn(),
  getCampaignCreditTotal: vi.fn(),
}));
vi.mock('@/lib/sumit/capture', () => ({ captureHeldCardSumit: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

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
import {
  getCampaignBillingSummary,
  getCampaignCreditTotal,
} from '@/lib/data/billing';
import { captureHeldCardSumit } from '@/lib/sumit/capture';
import { SumitDeclinedError } from '@/lib/sumit/charge';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';

// Mock admin client for the owner-email lookup (events.owner_id → auth user email).
const adminClientMock = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { owner_id: 'u1' }, error: null }),
      }),
    }),
  }),
  auth: {
    admin: {
      getUserById: async () => ({
        data: { user: { email: 'owner@example.com' } },
        error: null,
      }),
    },
  },
};

type Mock = ReturnType<typeof vi.fn>;
const m = {
  payments: getPaymentsEnabled as unknown as Mock,
  close: getCloseChargeEnabled as unknown as Mock,
  sumit: getSumitServerConfig as unknown as Mock,
  forCharge: getCampaignForCharge as unknown as Mock,
  lock: lockCampaignForCharge as unknown as Mock,
  summary: getCampaignBillingSummary as unknown as Mock,
  credits: getCampaignCreditTotal as unknown as Mock,
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
    card_token_ref: 'tok-abc',
    card_exp_month: 7,
    card_exp_year: 2031,
    card_citizen_id: '316125434',
    auth_external_ref: 'ext-1',
    max_charge_ceiling: 88,
  });
  m.summary.mockResolvedValue({
    reachedCount: 3,
    accrued: 12,
    ceiling: 88,
    maxContacts: 22,
  });
  m.credits.mockResolvedValue(0);
  m.lock.mockResolvedValue(true);
  (createAdminClient as unknown as Mock).mockReturnValue(adminClientMock);
  m.capture.mockResolvedValue({
    documentId: 555,
    documentNumber: 40103,
    documentUrl: 'https://pay.sumit.co.il/x?download=555',
    authNumber: '0692601',
    paymentId: 777,
  });
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
      max_charge_ceiling: 88,
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r.outcome).toBe('bad_state');
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('bad_state when the hold has no saved card token/expiry/citizenID (pre-fix hold)', async () => {
    happy();
    m.forCharge.mockResolvedValue({
      id: 'c1',
      event_id: 'e1',
      status: 'closed',
      capture_status: 'authorized',
      charge_status: null,
      card_token_ref: null,
      card_exp_month: null,
      card_exp_year: null,
      card_citizen_id: null,
      auth_external_ref: null,
      max_charge_ceiling: 88,
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
        cardToken: 'tok-abc',
        expMonth: 7,
        expYear: 2031,
        citizenId: '316125434',
        amount: '12',
      }),
    );
    expect(recordCampaignCharge).toHaveBeenCalledWith('c1', {
      amount: 12,
      documentId: 555,
      documentNumber: 40103,
      documentUrl: 'https://pay.sumit.co.il/x?download=555',
      authNumber: '0692601',
      paymentId: 777,
    });
    expect(r).toEqual({ outcome: 'charged', amount: 12 });
    // Additive campaign_billing alert on a successful final charge.
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        category: 'campaign_billing',
        title: 'חיוב סופי בוצע',
        fields: expect.objectContaining({
          campaign_id: 'c1',
          event_id: 'e1',
          amount: 12,
          document_id: 555,
        }),
      }),
    );
  });

  it('caps the amount at the CAMPAIGN ceiling, not the summary ceiling', async () => {
    happy();
    // Deliberately different values so the assertion can tell which one the
    // code actually used — the campaign's max_charge_ceiling must win.
    m.forCharge.mockResolvedValue({
      id: 'c1',
      event_id: 'e1',
      status: 'active',
      capture_status: 'authorized',
      charge_status: null,
      card_token_ref: 'tok-abc',
      card_exp_month: 7,
      card_exp_year: 2031,
      card_citizen_id: '316125434',
      auth_external_ref: 'ext-1',
      max_charge_ceiling: 60,
    });
    m.summary.mockResolvedValue({
      reachedCount: 99,
      accrued: 100,
      ceiling: 88,
      maxContacts: 22,
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'charged', amount: 60 });
    expect(captureHeldCardSumit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '60' }),
    );
  });

  it('falls back to summary.ceiling when the campaign has no max_charge_ceiling yet (null)', async () => {
    happy();
    m.forCharge.mockResolvedValue({
      id: 'c1',
      event_id: 'e1',
      status: 'active',
      capture_status: 'authorized',
      charge_status: null,
      card_token_ref: 'tok-abc',
      card_exp_month: 7,
      card_exp_year: 2031,
      card_citizen_id: '316125434',
      auth_external_ref: 'ext-1',
      max_charge_ceiling: null,
    });
    m.summary.mockResolvedValue({
      reachedCount: 99,
      accrued: 100,
      ceiling: 45,
      maxContacts: 22,
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'charged', amount: 45 });
    expect(captureHeldCardSumit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '45' }),
    );
  });

  it('subtracts approved credits from the charged amount (G1/D5)', async () => {
    happy();
    // accrued 12, ceiling 88, credit ₪5 → charge 7.
    m.credits.mockResolvedValue(5);
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'charged', amount: 7 });
    expect(captureHeldCardSumit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '7' }),
    );
  });

  it('nothing_to_charge when credits ≥ the capped total (no SUMIT call)', async () => {
    happy();
    m.credits.mockResolvedValue(20); // ≥ accrued 12
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'nothing_to_charge', amount: 0 });
    expect(markCampaignChargeOutcome).toHaveBeenCalledWith(
      'c1',
      'nothing_to_charge',
    );
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('review (NOT nothing_to_charge) when the summary RPC errors — the zero-bill guard', async () => {
    happy();
    m.summary.mockRejectedValue(new Error('rpc down'));
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'review', amount: 0 });
    expect(markCampaignChargeOutcome).toHaveBeenCalledWith('c1', 'charge_review');
    expect(markCampaignChargeOutcome).not.toHaveBeenCalledWith(
      'c1',
      'nothing_to_charge',
    );
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('review when the credit lookup errors (also a zero-bill guard)', async () => {
    happy();
    m.credits.mockRejectedValue(new Error('rpc down'));
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'review', amount: 0 });
    expect(markCampaignChargeOutcome).toHaveBeenCalledWith('c1', 'charge_review');
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
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
    // Additive campaign_billing warn on a definitive decline.
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'campaign_billing',
        title: 'החיוב הסופי נדחה על ידי חברת האשראי',
        fields: { campaign_id: 'c1', event_id: 'e1', amount: 12 },
      }),
    );
  });

  it('review (not retry) on a network/ambiguous outcome', async () => {
    happy();
    m.capture.mockRejectedValue(new Error('network'));
    const r = await closeCampaignAndCharge('c1');
    expect(r.outcome).toBe('review');
    expect(markCampaignChargeOutcome).toHaveBeenCalledWith('c1', 'charge_review');
    // The ambiguous/network path is covered by send_health in the SUMIT layer —
    // close-charge must NOT emit a campaign_billing alert here (no double-report).
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
