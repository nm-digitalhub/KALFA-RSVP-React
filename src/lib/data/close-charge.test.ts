import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/payments', () => ({
  getPaymentsEnabled: vi.fn(),
  getCloseChargeEnabled: vi.fn(),
  getSumitServerConfig: vi.fn(),
}));
vi.mock('@/lib/agreements/template', async (orig) => {
  // Use the REAL allow-list predicate + version constant (a change to the
  // allow-list must be caught here), keeping only VAT_RATE_PERCENT explicit.
  const actual = await orig<typeof import('@/lib/agreements/template')>();
  return {
    VAT_RATE_PERCENT: 18,
    BASE_FEE_AGREEMENT_VERSION: actual.BASE_FEE_AGREEMENT_VERSION,
    isBaseFeeAgreementVersion: actual.isBaseFeeAgreementVersion,
  };
});
vi.mock('@/lib/data/agreements', () => ({
  getSignedAgreementVersion: vi.fn(),
}));
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
vi.mock('@/lib/data/tax-ceiling', () => ({
  checkOsekPaturCeilingAfterCharge: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
// closeCampaignAndCharge is platform-admin only (billing op); it self-gates on
// requireAdmin as its first statement.
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));

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
import { getSignedAgreementVersion } from '@/lib/data/agreements';
import { SumitDeclinedError } from '@/lib/sumit/charge';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { requireAdmin } from '@/lib/auth/dal';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';

// Mock admin client for the owner lookups (events.owner_id → auth user email +
// profiles.full_name for the receipt "לכבוד" line).
const adminClientMock = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data:
            table === 'profiles'
              ? { full_name: 'בעל האירוע' }
              : { owner_id: 'u1' },
          error: null,
        }),
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
  signed: getSignedAgreementVersion as unknown as Mock,
};

function happy() {
  (requireAdmin as unknown as Mock).mockResolvedValue({ id: 'admin' });
  m.payments.mockResolvedValue(true);
  m.close.mockResolvedValue(true);
  m.sumit.mockResolvedValue({ companyId: 1, apiKey: 'k' });
  // Default: the signed contract is the APPROVED base-fee version (draft-free, as
  // the approve flow records it), so a snapshotted base is honored (the D5 guard
  // only bites on a mismatch — exercised in its suite).
  m.signed.mockResolvedValue('2026-07-v4');
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
    // Pre-model campaign: base/included 0 ⇒ pure per-reached at ₪4/reach.
    base_price: 0,
    included_reached: 0,
    price_per_reached: 4,
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
  it('rejects a non-admin caller BEFORE reading config or the campaign', async () => {
    happy();
    const redirected = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app;307;' });
    vi.mocked(requireAdmin).mockRejectedValue(redirected);

    await expect(closeCampaignAndCharge('c1')).rejects.toThrow('NEXT_REDIRECT');
    expect(getPaymentsEnabled).not.toHaveBeenCalled();
    expect(getCampaignForCharge).not.toHaveBeenCalled();
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('proceeds for a platform admin (requireAdmin resolves) and charges', async () => {
    happy();
    const r = await closeCampaignAndCharge('c1');
    expect(requireAdmin).toHaveBeenCalled();
    expect(r).toEqual({ outcome: 'charged', amount: 12, paymentId: 777, billingModel: 'per_reached' });
  });

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
      0,
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
        customerEmail: 'owner@example.com',
        customerName: 'בעל האירוע',
      }),
    );
    expect(recordCampaignCharge).toHaveBeenCalledWith('c1', {
      amount: 12,
      creditApplied: 0,
      documentId: 555,
      documentNumber: 40103,
      documentUrl: 'https://pay.sumit.co.il/x?download=555',
      authNumber: '0692601',
      paymentId: 777,
    });
    expect(r).toEqual({ outcome: 'charged', amount: 12, paymentId: 777, billingModel: 'per_reached' });
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
      base_price: 0,
      included_reached: 0,
      price_per_reached: 4,
    });
    m.summary.mockResolvedValue({
      reachedCount: 99,
      accrued: 100,
      ceiling: 88,
      maxContacts: 22,
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'charged', amount: 60, paymentId: 777, billingModel: 'per_reached' });
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
      base_price: 0,
      included_reached: 0,
      price_per_reached: 4,
    });
    m.summary.mockResolvedValue({
      reachedCount: 99,
      accrued: 100,
      ceiling: 45,
      maxContacts: 22,
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'charged', amount: 45, paymentId: 777, billingModel: 'per_reached' });
    expect(captureHeldCardSumit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '45' }),
    );
  });

  it('new model: charges the flat base even at 0 reached (base ₪200, included 200)', async () => {
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
      max_charge_ceiling: 600,
      base_price: 200,
      included_reached: 200,
      price_per_reached: 4,
    });
    m.summary.mockResolvedValue({ reachedCount: 0, accrued: 0, ceiling: 600, maxContacts: 300 });
    const r = await closeCampaignAndCharge('c1');
    // Base charged even though nobody was reached (plan D1 — service fee), and
    // NOT settled as nothing_to_charge.
    expect(r).toEqual({ outcome: 'charged', amount: 200, paymentId: 777, billingModel: 'base_overage' });
    expect(captureHeldCardSumit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '200' }),
    );
  });

  it('subtracts approved credits from the charged amount (G1/D5) and records the slice consumed', async () => {
    happy();
    // accrued 12, ceiling 88, credit ₪5 → charge 7; all ₪5 of the credit used.
    m.credits.mockResolvedValue(5);
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'charged', amount: 7, paymentId: 777, billingModel: 'per_reached' });
    // The pool is read for the campaign AND its event (event-level credits).
    expect(getCampaignCreditTotal).toHaveBeenCalledWith('c1', 'e1');
    expect(captureHeldCardSumit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '7' }),
    );
    expect(recordCampaignCharge).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ amount: 7, creditApplied: 5 }),
    );
  });

  it('nothing_to_charge when credits ≥ the capped total — consumes only the capped slice', async () => {
    happy();
    m.credits.mockResolvedValue(20); // ≥ accrued 12
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'nothing_to_charge', amount: 0 });
    // credit_applied records 12 (what the bill needed), NOT the ₪20 granted —
    // the ₪8 remainder stays available at the event level.
    expect(markCampaignChargeOutcome).toHaveBeenCalledWith(
      'c1',
      'nothing_to_charge',
      12,
    );
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('bad_state on a terminal charge_status — never re-marks nothing_to_charge over a real charge', async () => {
    happy();
    // Already charged; a later big event-level credit must NOT flip it to ₪0.
    m.forCharge.mockResolvedValue({
      id: 'c1',
      event_id: 'e1',
      status: 'closed',
      capture_status: 'authorized',
      charge_status: 'charged',
      card_token_ref: 'tok-abc',
      card_exp_month: 7,
      card_exp_year: 2031,
      card_citizen_id: '316125434',
      auth_external_ref: 'ext-1',
      max_charge_ceiling: 88,
    });
    m.credits.mockResolvedValue(160);
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'bad_state', amount: 0 });
    expect(markCampaignChargeOutcome).not.toHaveBeenCalled();
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('bad_state when already settled as nothing_to_charge (terminal, idempotent)', async () => {
    happy();
    m.forCharge.mockResolvedValue({
      id: 'c1',
      event_id: 'e1',
      status: 'closed',
      capture_status: 'authorized',
      charge_status: 'nothing_to_charge',
      card_token_ref: 'tok-abc',
      card_exp_month: 7,
      card_exp_year: 2031,
      card_citizen_id: '316125434',
      auth_external_ref: 'ext-1',
      max_charge_ceiling: 88,
    });
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({ outcome: 'bad_state', amount: 0 });
    expect(markCampaignChargeOutcome).not.toHaveBeenCalled();
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

  // D5 guard — the ₪200 base fee may be billed ONLY when the customer signed a
  // base-fee agreement version. A snapshotted base under any other signature is
  // suppressed → pure per-reached, so a v3-signer is never charged the base.
  describe('D5 guard — base fee bound to the signed agreement version', () => {
    const withBase = {
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
      max_charge_ceiling: 600,
      base_price: 200,
      included_reached: 200,
      price_per_reached: 4,
    };

    it('honors the base for the APPROVED base-fee version (2026-07-v4)', async () => {
      happy();
      m.forCharge.mockResolvedValue({ ...withBase });
      m.signed.mockResolvedValue('2026-07-v4');
      m.summary.mockResolvedValue({ reachedCount: 0, accrued: 0, ceiling: 600, maxContacts: 300 });
      const r = await closeCampaignAndCharge('c1');
      expect(r).toEqual({ outcome: 'charged', amount: 200, paymentId: 777, billingModel: 'base_overage' });
      expect(sendSlackAlert).not.toHaveBeenCalledWith(
        expect.objectContaining({ source: 'close-charge-d5-guard' }),
      );
    });

    it('SUPPRESSES the base to per-reached for a v3 signer (0 reached → nothing_to_charge)', async () => {
      happy();
      m.forCharge.mockResolvedValue({ ...withBase });
      m.signed.mockResolvedValue('draft-2026-07-v3');
      m.summary.mockResolvedValue({ reachedCount: 0, accrued: 0, ceiling: 600, maxContacts: 300 });
      const r = await closeCampaignAndCharge('c1');
      expect(r).toEqual({ outcome: 'nothing_to_charge', amount: 0 });
      expect(captureHeldCardSumit).not.toHaveBeenCalled();
      expect(sendSlackAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'close-charge-d5-guard',
          fields: expect.objectContaining({
            campaign_id: 'c1',
            signed_version: 'draft-2026-07-v3',
          }),
        }),
      );
    });

    it('suppressed base still bills per-reached overage on reached contacts (v3 signer)', async () => {
      happy();
      m.forCharge.mockResolvedValue({ ...withBase });
      m.signed.mockResolvedValue('draft-2026-07-v3');
      // base+included suppressed to 0 → 5 reached × ₪4 = ₪20 (no free included).
      m.summary.mockResolvedValue({ reachedCount: 5, accrued: 0, ceiling: 600, maxContacts: 300 });
      const r = await closeCampaignAndCharge('c1');
      // D5-suppressed billing reports the plan ACTUALLY billed: per_reached.
      expect(r).toEqual({ outcome: 'charged', amount: 20, paymentId: 777, billingModel: 'per_reached' });
      expect(captureHeldCardSumit).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '20' }),
      );
    });

    it('suppresses the base when nothing was signed (null) — safe default', async () => {
      happy();
      m.forCharge.mockResolvedValue({ ...withBase });
      m.signed.mockResolvedValue(null);
      m.summary.mockResolvedValue({ reachedCount: 0, accrued: 0, ceiling: 600, maxContacts: 300 });
      const r = await closeCampaignAndCharge('c1');
      expect(r).toEqual({ outcome: 'nothing_to_charge', amount: 0 });
      expect(sendSlackAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'close-charge-d5-guard',
          fields: expect.objectContaining({ signed_version: 'none' }),
        }),
      );
    });

    it('routes to review (never a terminal settle) when the signature read errors', async () => {
      happy();
      m.forCharge.mockResolvedValue({ ...withBase });
      m.signed.mockRejectedValue(new Error('db down'));
      m.summary.mockResolvedValue({ reachedCount: 0, accrued: 0, ceiling: 600, maxContacts: 300 });
      const r = await closeCampaignAndCharge('c1');
      expect(r).toEqual({ outcome: 'review', amount: 0 });
      expect(markCampaignChargeOutcome).toHaveBeenCalledWith('c1', 'charge_review');
      expect(captureHeldCardSumit).not.toHaveBeenCalled();
    });
  });
});
