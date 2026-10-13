import { describe, expect, it, vi, beforeEach } from 'vitest';

// recordPackageApproval pulls in PDF/email/storage; mock the whole import graph so the suite loads.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ approveCampaign: vi.fn() }));
vi.mock('@/lib/data/company', () => ({ getCompanyLegal: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/agreements-doc', () => ({
  getApprovedPackageAgreementDoc: vi.fn(),
}));
vi.mock('@/lib/data/agreement-config', () => ({ getAgreementConfigTokens: vi.fn() }));
vi.mock('@/lib/data/authorized-fill', () => ({ fillAuthorizedSet: vi.fn() }));
vi.mock('@/lib/agreements/pdf', () => ({
  renderAgreementPdf: vi.fn(),
  sha256Hex: vi.fn(),
}));
vi.mock('@/lib/storage/legal-docs', () => ({ uploadLegalDoc: vi.fn(), removeLegalDoc: vi.fn() }));
vi.mock('@/lib/email/sender', () => ({ getEmailSender: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ agreementEmail: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn().mockResolvedValue('https://kalfa.test/agreement') }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { getProfile } from '@/lib/data/profiles';
import { getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import { approveCampaign } from '@/lib/data/campaigns';
import { getCompanyLegal } from '@/lib/data/company';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import type { AgreementDoc } from '@/lib/agreements/template';
import { renderAgreementPdf, sha256Hex } from '@/lib/agreements/pdf';
import { removeLegalDoc, uploadLegalDoc } from '@/lib/storage/legal-docs';
import { getEmailSender } from '@/lib/email/sender';
import { agreementEmail } from '@/lib/email/templates';
import { recordPackageApproval } from '@/lib/data/agreements';

beforeEach(() => vi.clearAllMocks());

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
        allowed_channels: ['whatsapp'],
        start_at: null,
        close_at: '2999-01-01T00:00:00+00:00',
        ...over,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
    // Phase 2 (task 2.2): after the campaign row the code reads the CURRENT pricing round, inserts the approval
    // request, then calls the one-transaction rpc. The builder serves campaign → round → (default for the rest).
    const round = { id: 'round-1', version: 3, locked_at: null, list_price: 150, discount_amount: 0, package_price: 150, ...(over.__round as Record<string, unknown> ?? {}) };
    delete (over as Record<string, unknown>).__round;
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) => f({ data: { id: 'c1', event_id: 'e1', status: 'pending_approval', package_price: 150, contact_quota: 100, allowed_channels: ['whatsapp'], start_at: null, close_at: '2999-01-01T00:00:00+00:00', ...over }, error: null }))
      .mockImplementationOnce((f) => f({ data: (over.package_price === null ? null : round) as never, error: null }));
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    (client as unknown as { rpc: typeof rpc }).rpc = rpc;
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
    return { builder, send, rpc: (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc };
  }

  let rpcOf: () => ReturnType<typeof vi.fn>;
  it('records the approval with the exact document, without a signature or a phone, then approves the campaign and mails a copy', async () => {
    const { builder, send, rpc } = wire();
    rpcOf = () => rpc;

    const result = await recordPackageApproval(approvalInput);

    expect(result).toEqual({ ok: true });
    // The structured PDF input carries the exact package figures,
    // approval evidence and approved agreement document.
    expect(renderAgreementPdf).toHaveBeenCalledTimes(1);

    const [pdfInput] = vi.mocked(renderAgreementPdf).mock.calls[0];

    expect(pdfInput.content).toMatchObject({
      packagePrice: 150,
      contactQuota: 100,
      eventName: 'Event',
    });

    expect(pdfInput.approval).toEqual({
      approverName: 'דנה כהן',
      approvedDateText: expect.any(String),
      ip: '203.0.113.5',
    });

    expect(pdfInput.doc).toBe(PACKAGE_DOC);
    expect(pdfInput.extraTokens).toEqual({});
    // only the PDF is stored — there is no signature image
    expect(uploadLegalDoc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadLegalDoc).mock.calls[0][0]).toMatch(/agreement-.*\.pdf$/);
    // The approval request precedes the upload, pinned to the exact round and version.
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ campaign_id: 'c1', pricing_round_id: 'round-1', expected_version: 3 }),
    );
    // One transaction in the database: request concluded, agreement stored, campaign approved, price locked.
    expect(rpcOf()).toHaveBeenCalledWith('approve_package_terms', expect.objectContaining({
      _campaign_id: 'c1',
      _pricing_round_id: 'round-1',
      _expected_version: 3,
      _signer_user_id: 'u1',
      _agreement_version: '2026-10-v6',
      _ip: '203.0.113.5',
      _user_agent: 'UA/1',
      _content_hash: 'hash-abc',
    }));
    // a copy of the terms goes to the customer (§14ג(ב))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'dana@example.com' }));
  });

  it('a campaign without a package is refused: there are no terms to approve', async () => {
    wire({ package_price: null, contact_quota: null });
    const result = await recordPackageApproval(approvalInput);
    expect(result).toEqual({ ok: false, error: 'תנאי הקמפיין חסרים' });
    expect(uploadLegalDoc).not.toHaveBeenCalled();
  });

  it('is refused unless the package contract is approved — a draft or missing document is never accepted', async () => {
    wire({}, null);
    const result = await recordPackageApproval(approvalInput);
    expect(result).toEqual({ ok: false, error: 'הסכם החבילה טרם הופעל — פנו לתמיכה' });
  });

  it('is refused when the terms changed since the customer read them — they must read the new text', async () => {
    wire();
    const result = await recordPackageApproval({ ...approvalInput, termsVersion: 'draft-2026-10-v6' });
    expect(result).toEqual({ ok: false, error: 'נוסח התנאים עודכן. קראו שוב ואשרו.' });
    expect(uploadLegalDoc).not.toHaveBeenCalled();
  });

  it.each([
    ['a campaign that is no longer waiting for approval', { status: 'approved' }, 'ניתן לאשר רק קמפיין הממתין לאישור'],
    ['a campaign without a quota', { contact_quota: null }, 'תנאי הקמפיין חסרים'],
  ])('%s is refused', async (_label, over, error) => {
    const { rpc } = wire(over);
    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: false, error });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a past event, or one whose details are not confirmed, is refused before anything is rendered or stored', async () => {
    wire();
    vi.mocked(requireOwnedEvent).mockResolvedValue({ ...futureEvent, event_date: '2020-01-01T00:00:00+00:00' });
    expect((await recordPackageApproval(approvalInput)).ok).toBe(false);
    vi.mocked(requireOwnedEvent).mockResolvedValue({ ...futureEvent, status: 'draft' as never });
    expect((await recordPackageApproval(approvalInput)).ok).toBe(false);
    expect(renderAgreementPdf).not.toHaveBeenCalled();
    expect(uploadLegalDoc).not.toHaveBeenCalled();
  });

  it('when the approval request cannot be stored the campaign is NOT approved', async () => {
    const { builder, rpc } = wire();
    // third awaited chain = the approval_requests insert
    vi.spyOn(builder, 'then').mockImplementationOnce((f) => f({ data: null, error: { message: 'boom' } }));

    const result = await recordPackageApproval(approvalInput);

    expect(result).toEqual({ ok: false, error: 'שמירת האישור נכשלה' });
    expect(rpc).not.toHaveBeenCalled();
    expect(uploadLegalDoc).not.toHaveBeenCalled();
  });

  it('fills the list right after the approval, so the places follow the order of addition from then on', async () => {
    const { rpc } = wire();
    void rpc;
    vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict: 'filled', admitted: 2, size: 2, quota: 100, waiting: 0 });
    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
    expect(fillAuthorizedSet).toHaveBeenCalledWith('e1', 'c1', 'package_approval');
  });

  it('a failed fill never undoes the approval', async () => {
    wire();
    vi.mocked(fillAuthorizedSet).mockRejectedValue(new Error('מילוי רשימת אנשי הקשר נכשל'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
  });

  it('does not fill when the approval itself was refused', async () => {
    const { rpc } = wire();
    rpc.mockResolvedValue({ data: null, error: { message: 'approve_refused: campaign status is approved' } });
    expect((await recordPackageApproval(approvalInput)).ok).toBe(false);
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
  });

  it('a failed receipt e-mail never undoes the approval', async () => {
    const { send } = wire();
    send.mockRejectedValue(new Error('smtp down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
  });

  // ── task 2.2's own verifies: a stale version, an unknown outcome, and the request-id resolution ──

  it('a STALE VERSION is a definite refusal: the request is concluded refused and its PDF removed', async () => {
    const { builder, rpc } = wire();
    rpc.mockResolvedValue({ data: null, error: { message: 'approve_refused: stale pricing version' } });

    const result = await recordPackageApproval(approvalInput);

    expect(result.ok).toBe(false);
    expect(removeLegalDoc).toHaveBeenCalledTimes(1);
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ state: 'refused' }));
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
  });

  it('an UNKNOWN outcome that DID commit is resolved by the request id: success, PDF kept', async () => {
    const { builder, rpc } = wire();
    rpc.mockRejectedValue(new Error('fetch failed'));
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) => f({ data: null, error: null })) // the approval_requests insert
      .mockImplementationOnce((f) => f({ data: { id: 'sa-1' } as never, error: null })); // the lookup finds the stored agreement

    expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
    expect(removeLegalDoc).not.toHaveBeenCalled();
  });

  it('an unknown outcome with NO stored agreement stays unknown: error, PDF kept, nothing removed', async () => {
    const { builder, rpc } = wire();
    rpc.mockResolvedValue({ data: null, error: { message: 'network timeout' } });
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) => f({ data: null, error: null })) // the approval_requests insert
      .mockImplementationOnce((f) => f({ data: null, error: null })); // the lookup finds nothing

    const result = await recordPackageApproval(approvalInput);

    expect(result).toEqual({ ok: false, error: 'האישור לא הושלם. נסו שוב.' });
    expect(removeLegalDoc).not.toHaveBeenCalled();
  });
});
