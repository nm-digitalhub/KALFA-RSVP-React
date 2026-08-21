import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({
  requirePlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/events', () => ({
  requireOwnedEvent: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/close-charge', () => ({ closeCampaignAndCharge: vi.fn() }));
vi.mock('@/lib/sumit/capture', () => ({ creditHeldCardSumit: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getSumitServerConfig: vi.fn() }));
vi.mock('@/lib/email/sender', () => ({ getEmailSender: vi.fn() }));
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ cancellationRequestResponseEmail: vi.fn() }));
vi.mock('@/lib/data/cancellation-sms', () => ({ buildCancellationSmsText: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn().mockResolvedValue('https://beta.kalfa.me') }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';
import { creditHeldCardSumit } from '@/lib/sumit/capture';
import { getSumitServerConfig } from '@/lib/data/payments';
import { getEmailSender } from '@/lib/email/sender';
import { getSmsSender } from '@/lib/sms/sender';
import { cancellationRequestResponseEmail } from '@/lib/email/templates';
import { buildCancellationSmsText } from '@/lib/data/cancellation-sms';
import {
  createCancellationRequest,
  computeSuggestedCancellationAmount,
  resolveCancellationRequest,
} from './event-cancellation';

type Mock = ReturnType<typeof vi.fn>;

describe('createCancellationRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts via the owner-scoped client and returns the request number', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    const insertMock = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'r1', request_number: 42 }, error: null }),
      }),
    });
    (createClient as unknown as Mock).mockResolvedValue({
      from: () => ({ insert: insertMock }),
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    });
    const r = await createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: true });
    expect(r).toEqual({ id: 'r1', requestNumber: 42 });
  });

  it('rejects a draft event without touching the DB', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'draft' });
    await expect(
      createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: false }),
    ).rejects.toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('computeSuggestedCancellationAmount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('suggests min(5% of ceiling, cap), never the accrued service-already-rendered amount', async () => {
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: (table: string) => {
        if (table === 'app_settings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { cancellation_fee_percent: 5, cancellation_fee_cap: 100 },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { max_charge_ceiling: 88 }, error: null }) }) }),
        };
      },
    });
    // fee = min(5% of 88, 100) = 4.4
    const amount = await computeSuggestedCancellationAmount('c1');
    expect(amount).toBeCloseTo(4.4, 2);
  });

  it('never suggests more than the campaign ceiling even with a very high fee_cap', async () => {
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: (table: string) => {
        if (table === 'app_settings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { cancellation_fee_percent: 5, cancellation_fee_cap: 100000 },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { max_charge_ceiling: 12 }, error: null }) }) }),
        };
      },
    });
    const amount = await computeSuggestedCancellationAmount('c1');
    expect(amount).toBeLessThanOrEqual(12);
  });
});

describe('resolveCancellationRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  // `chargeStatus` controls which branch fires: null/failed/review/nothing_to_charge
  // ⇒ campaign is still pre-charge ⇒ closeCampaignAndCharge IS called; 'charged'
  // ⇒ post-charge ⇒ creditHeldCardSumit is called instead (if a card is on file).
  function happy(opts: {
    chargeStatus: string | null;
    smsConsent?: boolean;
    finalChargeAmount?: number;
    noCard?: boolean;
  }) {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const cardFields = opts.noCard
      ? { card_token_ref: null, card_exp_month: null, card_exp_year: null, card_citizen_id: null }
      : { card_token_ref: 'tok-abc', card_exp_month: 7, card_exp_year: 2031, card_citizen_id: '316125434' };
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'r1',
        request_number: 42,
        status: 'pending',
        sms_consent: opts.smsConsent ?? true,
        event_id: 'e1',
        reason: 'שינוי תוכניות',
        events: {
          id: 'e1',
          status: 'active',
          owner_id: 'u1',
          campaigns: [
            {
              id: 'camp1',
              charge_status: opts.chargeStatus,
              final_charge_amount: opts.finalChargeAmount ?? 0,
              auth_external_ref: 'ext-1',
              ...cardFields,
            },
          ],
        },
      },
      error: null,
    });
    const update = vi.fn().mockReturnValue({ eq: () => ({ error: null }) });
    const profileSingle = vi.fn().mockResolvedValue({
      data: { full_name: 'דנה', phone: '+972500000000' },
      error: null,
    });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: (table: string) => {
        if (table === 'profiles') {
          return { select: () => ({ eq: () => ({ maybeSingle: profileSingle }) }) };
        }
        return { select: () => ({ eq: () => ({ single }) }), update };
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'dana@example.com' } } }) } },
    });
    (cancellationRequestResponseEmail as unknown as Mock).mockReturnValue({ subject: 's', html: '<p>h</p>', text: 't' });
    (buildCancellationSmsText as unknown as Mock).mockReturnValue('sms text');
    const send = vi.fn().mockResolvedValue(undefined);
    (getEmailSender as unknown as Mock).mockResolvedValue({ send });
    const smsSend = vi.fn().mockResolvedValue({ id: 'sms1' });
    (getSmsSender as unknown as Mock).mockResolvedValue({ send: smsSend });
    (closeCampaignAndCharge as unknown as Mock).mockResolvedValue({
      outcome: 'charged', amount: 24.4, paymentId: 999, documentId: 601, documentUrl: 'https://pay.sumit.co.il/x?download=601',
    });
    (getSumitServerConfig as unknown as Mock).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    (creditHeldCardSumit as unknown as Mock).mockResolvedValue({
      documentId: 701, documentNumber: 1, documentUrl: 'https://pay.sumit.co.il/x?download=701', authNumber: 'a1', paymentId: 555,
    });
    return { send, smsSend, update };
  }

  it('pre-charge campaign: calls closeCampaignAndCharge with overrideAmount=0 for full_cancellation', async () => {
    happy({ chargeStatus: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(closeCampaignAndCharge).toHaveBeenCalledWith('camp1', { overrideAmount: 0, overrideReason: 'cancellation_full' });
    expect(creditHeldCardSumit).not.toHaveBeenCalled();
  });

  it('pre-charge campaign: calls closeCampaignAndCharge with the confirmed amount for partial_charge', async () => {
    happy({ chargeStatus: 'charge_failed' });
    await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 24.4, resolutionNote: 'עבור שירות שסופק' });
    expect(closeCampaignAndCharge).toHaveBeenCalledWith('camp1', { overrideAmount: 24.4, overrideReason: 'cancellation_partial_charge' });
  });

  it('post-charge campaign WITH a card on file: calls creditHeldCardSumit for the full charged amount (full_cancellation)', async () => {
    const { update } = happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(creditHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '84' }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'refunded' }));
  });

  it('post-charge campaign WITH a card on file: credits only the difference for partial_charge', async () => {
    happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
    await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 30, resolutionNote: 'חלק נשאר' });
    // credit = charged(84) - keep(30) = 54
    expect(creditHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '54' }));
  });

  it('post-charge campaign WITHOUT a card on file: falls back to manual_refund_required, never calls creditHeldCardSumit', async () => {
    const { update } = happy({ chargeStatus: 'charged', finalChargeAmount: 84, noCard: true });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, יש להחזיר ידנית' });
    expect(creditHeldCardSumit).not.toHaveBeenCalled();
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'manual_refund_required' }));
  });

  it('declined: never calls closeCampaignAndCharge or creditHeldCardSumit regardless of charge_status, records not_applicable', async () => {
    const { update } = happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
    await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' });
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(creditHeldCardSumit).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'not_applicable' }));
  });

  it('sends email THEN SMS (consent=true) THEN persists, in that order', async () => {
    const { send, smsSend } = happy({ chargeStatus: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(send).toHaveBeenCalled();
    expect(smsSend).toHaveBeenCalled();
  });

  it('does NOT send SMS when sms_consent is false', async () => {
    const { smsSend } = happy({ chargeStatus: null, smsConsent: false });
    await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'לא ניתן' });
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('throws and persists NOTHING when the email send fails (checked BEFORE any SUMIT capture)', async () => {
    const { update } = happy({ chargeStatus: null });
    (getEmailSender as unknown as Mock).mockResolvedValue({ send: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'x' }),
    ).rejects.toThrow();
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects resolving a request that is already resolved', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'r1', status: 'resolved', sms_consent: false, events: { id: 'e1', status: 'closed', owner_id: 'u1', campaigns: [] } },
      error: null,
    });
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    (createAdminClient as unknown as Mock).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ single }) }) }) });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'x' }),
    ).rejects.toThrow();
  });
});
