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
// The real contract-model predicate (the model↔contract check is what is under test), a fake renderer.
vi.mock('@/lib/agreements/template', async (importOriginal) => ({
  isPackageAgreementVersion: (await importOriginal<typeof import('@/lib/agreements/template')>()).isPackageAgreementVersion,
  renderAgreementDocument: vi.fn().mockReturnValue('<html>agreement</html>'),
}));
vi.mock('@/lib/data/agreements-doc', () => ({
  getActiveAgreementDoc: vi.fn(),
  getApprovedPackageAgreementDoc: vi.fn(),
}));
vi.mock('@/lib/data/agreement-config', () => ({ getAgreementConfigTokens: vi.fn() }));
vi.mock('@/lib/data/authorized-fill', () => ({ fillAuthorizedSet: vi.fn() }));
vi.mock('@/lib/agreements/pdf', () => ({
  renderAgreementPdf: vi.fn(),
  sha256Hex: vi.fn(),
}));
vi.mock('@/lib/storage/legal-docs', () => ({ uploadLegalDoc: vi.fn() }));
vi.mock('@/lib/email/sender', () => ({ getEmailSender: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ agreementEmail: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn().mockResolvedValue('https://kalfa.test/agreement') }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { getProfile } from '@/lib/data/profiles';
import { verifyOtp } from '@/lib/data/otp';
import { getActiveAgreementDoc, getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import { approveCampaign } from '@/lib/data/campaigns';
import { getCompanyLegal } from '@/lib/data/company';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { renderAgreementDocument, type AgreementDoc } from '@/lib/agreements/template';
import { renderAgreementPdf, sha256Hex } from '@/lib/agreements/pdf';
import { uploadLegalDoc } from '@/lib/storage/legal-docs';
import { getEmailSender } from '@/lib/email/sender';
import { agreementEmail } from '@/lib/email/templates';
import { recordPackageApproval, recordSignedAgreement } from '@/lib/data/agreements';

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

function wireCampaign(packagePrice: number | null = null) {
  const { client } = createMockSupabase({
    data: {
      id: 'c1',
      event_id: 'e1',
      status: 'pending_approval',
      package_price: packagePrice,
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
      event_type: 'birthday',
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

// R9: every commercial campaign action requires event.status='active'.
describe('recordSignedAgreement — R9 active-event guard', () => {
  it('rejects a draft event BEFORE OTP/PDF (no otp verification)', async () => {
    wireCampaign();
    vi.mocked(requireOwnedEvent).mockResolvedValue({
      id: 'e1',
      name: 'Draft Event',
      status: 'draft',
      event_type: 'birthday',
      event_date: '2999-01-01T00:00:00+00:00',
      rsvp_deadline: null,
    });

    const result = await recordSignedAgreement(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('טרם אושרו');
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

// The contract a customer signs must be the one for the campaign's pricing model: a fixed-price package campaign under
// the package contract, a pay-per-result campaign under the pay-per-result one. The money follows the SIGNED version
// (close-charge), and a package contract's text states a different price — so a mismatch is refused BEFORE the OTP is
// burned and before anything is rendered or stored.
describe('recordSignedAgreement — the contract matches the campaign\'s pricing model', () => {
  const futureEvent = {
    id: 'e1',
    name: 'Event',
    status: 'active' as const,
    event_type: 'wedding' as const,
    event_date: '2999-01-01T00:00:00+00:00',
    rsvp_deadline: null,
  };
  const doc = (version: string) => ({ version, status: 'approved' as const, bodyHtml: null });

  function setup(packagePrice: number | null, version: string) {
    wireCampaign(packagePrice);
    vi.mocked(requireOwnedEvent).mockResolvedValue(futureEvent);
    vi.mocked(getActiveAgreementDoc).mockResolvedValue(doc(version));
    vi.mocked(verifyOtp).mockResolvedValue(false); // stops the flow right after the OTP when it is reached
  }

  it('a pay-per-result campaign is refused under the package contract, before the OTP', async () => {
    setup(null, '2026-10-v6');
    const result = await recordSignedAgreement(input);
    expect(result).toEqual({ ok: false, error: 'ההסכם הפעיל אינו מתאים למודל התמחור של הקמפיין — פנו לתמיכה' });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('a pay-per-result campaign under a pay-per-result contract proceeds to the OTP', async () => {
    setup(null, '2026-09-v5');
    await recordSignedAgreement(input);
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });

  // A fixed-price package is APPROVED by ticking the box (recordPackageApproval), never signed: the signature path
  // refuses it outright, whichever contract is active, before any code is burned or anything is rendered.
  it.each(['2026-10-v6', 'draft-2026-10-v6', '2026-09-v5'])(
    'a package campaign never takes the signature path (active contract %s)',
    async (version) => {
      setup(150, version);
      const result = await recordSignedAgreement(input);
      expect(result).toEqual({ ok: false, error: 'קמפיין חבילה מאושר באישור התנאים ולא בחתימה' });
      expect(verifyOtp).not.toHaveBeenCalled();
    },
  );
});

// ---- the fixed-price package: approved by ticking the box ------------------------------------------------------------
describe('recordPackageApproval — the customer approves the package terms (no signature, no phone code)', () => {
  const futureEvent = {
    id: 'e1',
    name: 'Event',
    status: 'active' as const,
    event_type: 'wedding' as const,
    event_date: '2999-01-01T00:00:00+00:00',
    rsvp_deadline: null,
  };
  const approvalInput = { campaignId: 'c1', termsVersion: '2026-10-v6', ip: '203.0.113.5', userAgent: 'UA/1' };
  const PACKAGE_DOC: AgreementDoc = { version: '2026-10-v6', status: 'approved', bodyHtml: '<p>{{packagePrice}} {{contactQuota}}</p>' };

  function wire(over: Record<string, unknown> = {}, doc: AgreementDoc | null = PACKAGE_DOC) {
    const { client, builder } = createMockSupabase({
      data: {
        id: 'c1',
        event_id: 'e1',
        status: 'pending_approval',
        package_price: 150,
        contact_quota: 100,
        max_contacts: 0,
        allowed_channels: ['whatsapp'],
        start_at: null,
        close_at: '2999-01-01T00:00:00+00:00',
        ...over,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(requireUser).mockResolvedValue({ id: 'u1', email: 'dana@example.com' } as never);
    vi.mocked(getProfile).mockResolvedValue({ full_name: 'דנה כהן', phone: null } as never);
    vi.mocked(requireOwnedEvent).mockResolvedValue(futureEvent);
    vi.mocked(getApprovedPackageAgreementDoc).mockResolvedValue(doc);
    vi.mocked(fillAuthorizedSet).mockReset(); // a previous test's rejection must not leak into this one
    vi.mocked(getCompanyLegal).mockResolvedValue({ name: 'קאלפא', id: '1', address: 'a', contactPhone: 'p', contactEmail: 'e', privacyUrl: '', termsUrl: '', warrantyText: 'w' } as never);
    vi.mocked(getAgreementConfigTokens).mockResolvedValue({} as never);
    vi.mocked(renderAgreementPdf).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(sha256Hex).mockReturnValue('hash-abc');
    vi.mocked(uploadLegalDoc).mockResolvedValue(undefined as never);
    vi.mocked(approveCampaign).mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getEmailSender).mockResolvedValue({ send } as never);
    vi.mocked(agreementEmail).mockResolvedValue({ subject: 's', html: 'h', text: 't' });
    return { builder, send };
  }

  it('records the approval with the exact document, without a signature or a phone, then approves the campaign and mails a copy', async () => {
    const { builder, send } = wire();

    const result = await recordPackageApproval(approvalInput);

    expect(result).toEqual({ ok: true });
    expect(verifyOtp).not.toHaveBeenCalled();
    // the document carries the package figures and an APPROVAL block (no signature image)
    const [content, sig, doc] = vi.mocked(renderAgreementDocument).mock.calls[0];
    expect(content).toMatchObject({ packagePrice: 150, contactQuota: 100, eventName: 'Event' });
    expect(sig).toMatchObject({ signerName: 'דנה כהן', signatureDataUrl: null, verifiedPhone: null, ip: '203.0.113.5' });
    expect(doc?.version).toBe('2026-10-v6');
    // only the PDF is stored — there is no signature image
    expect(uploadLegalDoc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadLegalDoc).mock.calls[0][0]).toMatch(/agreement-.*\.pdf$/);
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: 'c1',
        event_id: 'e1',
        signer_user_id: 'u1',
        agreement_version: '2026-10-v6',
        ip: '203.0.113.5',
        user_agent: 'UA/1',
        signature_ref: null,
        verified_phone: null,
        otp_verified_at: null,
        content_hash: 'hash-abc',
      }),
    );
    expect(approveCampaign).toHaveBeenCalledWith('c1', '2026-10-v6');
    // a copy of the terms goes to the customer (§14ג(ב))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'dana@example.com' }));
  });

  it('a pay-per-result campaign is refused: it is signed, not approved by a click', async () => {
    wire({ package_price: null, contact_quota: null });
    const result = await recordPackageApproval(approvalInput);
    expect(result).toEqual({ ok: false, error: 'קמפיין זה נחתם בחתימה ואינו מאושר באישור תנאים' });
    expect(uploadLegalDoc).not.toHaveBeenCalled();
    expect(approveCampaign).not.toHaveBeenCalled();
  });

  it('is refused unless the package contract is approved — a draft or missing document is never accepted', async () => {
    wire({}, null);
    const result = await recordPackageApproval(approvalInput);
    expect(result).toEqual({ ok: false, error: 'הסכם החבילה טרם הופעל — פנו לתמיכה' });
    expect(getActiveAgreementDoc).not.toHaveBeenCalled();
    expect(approveCampaign).not.toHaveBeenCalled();
  });

  it('is refused when the terms changed since the customer read them — they must read the new text', async () => {
    wire();
    const result = await recordPackageApproval({ ...approvalInput, termsVersion: 'draft-2026-10-v6' });
    expect(result).toEqual({ ok: false, error: 'נוסח התנאים עודכן. קראו שוב ואשרו.' });
    expect(uploadLegalDoc).not.toHaveBeenCalled();
    expect(approveCampaign).not.toHaveBeenCalled();
  });

  it.each([
    ['a campaign that is no longer waiting for approval', { status: 'approved' }, 'ניתן לאשר רק קמפיין הממתין לאישור'],
    ['a campaign without a quota', { contact_quota: null }, 'תנאי הקמפיין חסרים'],
  ])('%s is refused', async (_label, over, error) => {
    wire(over);
    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: false, error });
    expect(approveCampaign).not.toHaveBeenCalled();
  });

  it('a past event, or one whose details are not confirmed, is refused before anything is rendered or stored', async () => {
    wire();
    vi.mocked(requireOwnedEvent).mockResolvedValue({ ...futureEvent, event_date: '2020-01-01T00:00:00+00:00' });
    expect((await recordPackageApproval(approvalInput)).ok).toBe(false);
    vi.mocked(requireOwnedEvent).mockResolvedValue({ ...futureEvent, status: 'draft' as never });
    expect((await recordPackageApproval(approvalInput)).ok).toBe(false);
    expect(renderAgreementDocument).not.toHaveBeenCalled();
    expect(uploadLegalDoc).not.toHaveBeenCalled();
  });

  it('when the evidence cannot be stored the campaign is NOT approved', async () => {
    const { builder } = wire();
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) => f({ data: { id: 'c1', event_id: 'e1', status: 'pending_approval', package_price: 150, contact_quota: 100, max_contacts: 0, allowed_channels: ['whatsapp'], start_at: null, close_at: null } as never, error: null }))
      .mockImplementationOnce((f) => f({ data: null, error: { message: 'boom' } }));

    const result = await recordPackageApproval(approvalInput);

    expect(result).toEqual({ ok: false, error: 'שמירת האישור נכשלה' });
    expect(approveCampaign).not.toHaveBeenCalled();
  });

  it('fills the list right after the approval, so the places follow the order of addition from then on', async () => {
    wire();
    vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict: 'filled', admitted: 2, size: 2, quota: 100, waiting: 0 });
    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
    expect(fillAuthorizedSet).toHaveBeenCalledWith('e1', 'c1', 'package_approval');
    expect(vi.mocked(approveCampaign).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fillAuthorizedSet).mock.invocationCallOrder[0]);
  });

  it('a failed fill never undoes the approval', async () => {
    wire();
    vi.mocked(fillAuthorizedSet).mockRejectedValue(new Error('מילוי רשימת אנשי הקשר נכשל'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
    expect(approveCampaign).toHaveBeenCalled();
  });

  it('does not fill when the approval itself was refused', async () => {
    wire();
    vi.mocked(approveCampaign).mockRejectedValue(new Error('אישור הקמפיין נכשל'));
    await expect(recordPackageApproval(approvalInput)).rejects.toThrow();
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
  });

  it('a failed receipt e-mail never undoes the approval', async () => {
    const { send } = wire();
    send.mockRejectedValue(new Error('smtp down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
    expect(approveCampaign).toHaveBeenCalled();
  });
});
