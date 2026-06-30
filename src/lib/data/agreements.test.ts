import { describe, expect, it, vi, beforeEach } from 'vitest';

// recordSignedAgreement pulls in PDF/email/storage; mock the whole import graph so
// the suite loads, and configure only the pre-guard path (the L1 past-event check
// sits right after the ownership read, BEFORE OTP/PDF/storage).
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ approveCampaign: vi.fn() }));
vi.mock('@/lib/data/company', () => ({ getCompanyLegal: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/data/otp', () => ({ verifyOtp: vi.fn() }));
vi.mock('@/lib/phone', () => ({ normalizePhone: vi.fn(() => '+972501234567') }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/agreements/template', () => ({ renderAgreementDocument: vi.fn() }));
vi.mock('@/lib/data/agreements-doc', () => ({ getActiveAgreementDoc: vi.fn() }));
vi.mock('@/lib/data/agreement-config', () => ({ getAgreementConfigTokens: vi.fn() }));
vi.mock('@/lib/agreements/pdf', () => ({
  renderAgreementPdf: vi.fn(),
  sha256Hex: vi.fn(),
}));
vi.mock('@/lib/storage/legal-docs', () => ({ uploadLegalDoc: vi.fn() }));
vi.mock('@/lib/email/sender', () => ({ getEmailSender: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ agreementEmail: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { getProfile } from '@/lib/data/profiles';
import { verifyOtp } from '@/lib/data/otp';
import { recordSignedAgreement } from '@/lib/data/agreements';

beforeEach(() => vi.clearAllMocks());

const PNG_DATA_URL = 'data:image/png;base64,aGVsbG8=';

const input = {
  campaignId: 'c1',
  otpCode: '123456',
  signatureDataUrl: PNG_DATA_URL,
  tosVersion: 'v1',
  ip: null,
  userAgent: null,
};

function wireCampaign() {
  const { client } = createMockSupabase({
    data: {
      id: 'c1',
      event_id: 'e1',
      status: 'pending_approval',
      price_per_reached: 1,
      max_contacts: 1,
      max_charge_ceiling: 1,
      allowed_channels: ['whatsapp'],
      start_at: null,
      close_at: null,
    },
    error: null,
  });
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  vi.mocked(requireUser).mockResolvedValue(
    { id: 'u1', email: 'u@x.co' } as unknown as Awaited<
      ReturnType<typeof requireUser>
    >,
  );
  vi.mocked(getProfile).mockResolvedValue({
    full_name: 'Test Signer',
    phone: '0501234567',
  } as unknown as Awaited<ReturnType<typeof getProfile>>);
}

describe('recordSignedAgreement — L1 past-event guard', () => {
  it('rejects a past event BEFORE OTP/PDF (no otp verification)', async () => {
    wireCampaign();
    vi.mocked(requireOwnedEvent).mockResolvedValue({
      id: 'e1',
      name: 'Past Event',
      status: 'active',
      event_date: '2020-01-01T00:00:00+00:00',
      rsvp_deadline: null,
    });

    const result = await recordSignedAgreement(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('האירוע כבר חלף');
    // Proves the guard short-circuits before the expensive, side-effecting work.
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

// S2.4 — R9: every commercial campaign action requires event.status='active'.
describe('recordSignedAgreement — R9 active-event guard', () => {
  it('rejects a draft event BEFORE OTP/PDF (no otp verification)', async () => {
    wireCampaign();
    vi.mocked(requireOwnedEvent).mockResolvedValue({
      id: 'e1',
      name: 'Draft Event',
      status: 'draft',
      event_date: '2999-01-01T00:00:00+00:00',
      rsvp_deadline: null,
    });

    const result = await recordSignedAgreement(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('טרם פורסם');
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
