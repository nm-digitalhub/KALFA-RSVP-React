import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/company', () => ({ getCompanyLegal: vi.fn() }));
vi.mock('@/lib/data/agreements-doc', () => ({ getApprovedPackageAgreementDoc: vi.fn() }));
vi.mock('@/lib/data/agreement-config', () => ({ getAgreementConfigTokens: vi.fn() }));
vi.mock('../../campaign-actions', () => ({ approvePackageTermsAction: vi.fn() }));
vi.mock('./agreement-sheet', () => ({
  AgreementSheet: ({ html }: { html: string }) => <div data-marker="sheet" dangerouslySetInnerHTML={{ __html: html }} />,
}));
vi.mock('./approve-package-terms-form', () => ({
  ApprovePackageTermsForm: ({ termsVersion }: { termsVersion: string }) => (
    <div data-marker="approve-form" data-version={termsVersion} />
  ),
}));

import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { getCompanyLegal } from '@/lib/data/company';
import { PackageTermsStep } from './package-terms-step';

// The "אישור תנאי החבילה" step: the key terms, the full terms to read, and the two-box approval. It shows the terms of
// THIS campaign (its snapshotted price and quota) and refuses to offer an approval unless the package contract is approved.

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const campaign = {
  id: 'c1',
  event_id: 'e1',
  package_price: 150,
  contact_quota: 100,
  max_contacts: 0,
  allowed_channels: ['whatsapp', 'call'],
  start_at: null,
  close_at: FUTURE,
};
// The package contract is an admin-managed document: here a small body with the package tokens.
const PACKAGE_DOC = {
  version: '2026-10-v6',
  status: 'approved' as const,
  bodyHtml: '<h1>חבילה במחיר קבוע</h1><p>{{packagePrice}} · עד {{contactQuota}} אנשי קשר</p><p>תשלום אחד, פעם אחת.</p>',
};

async function render(over: { campaign?: Record<string, unknown>; eventDate?: string } = {}) {
  const tree = await PackageTermsStep({
    eventId: 'e1',
    campaign: { ...campaign, ...over.campaign } as never,
    event: { name: 'החתונה', event_date: over.eventDate ?? FUTURE },
  });
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCompanyLegal).mockResolvedValue({
    name: 'קאלפא', id: '51-1', address: 'הרצל 1', contactPhone: '03', contactEmail: 'a@b.c', privacyUrl: '', termsUrl: '', warrantyText: 'w',
  } as never);
  vi.mocked(getApprovedPackageAgreementDoc).mockResolvedValue(PACKAGE_DOC);
  vi.mocked(getAgreementConfigTokens).mockResolvedValue({} as never);
});

describe('PackageTermsStep', () => {
  it('shows the campaign\'s own price and quota, the full terms, and the approval form for the version shown', async () => {
    const html = await render();
    expect(html).toContain('₪150');
    expect(html).toContain('עד 100 אנשי קשר');
    expect(html).toContain('וואטסאפ');
    // the full terms are the package contract, carrying the same figures
    expect(html).toContain('data-marker="sheet"');
    expect(html).toContain('חבילה במחיר קבוע');
    expect(html).toContain('data-marker="approve-form"');
    expect(html).toContain('data-version="2026-10-v6"');
  });

  it('says it is a single payment after the approval, without a signature, a code, or a hold', async () => {
    const html = await render();
    expect(html).toContain('תשלום אחד');
    expect(html).not.toMatch(/חתימה|קוד אימות|תפיסה/);
  });

  it('offers no approval while the package contract is not approved (a draft is never offered)', async () => {
    vi.mocked(getApprovedPackageAgreementDoc).mockResolvedValue(null);
    const html = await render();
    expect(html).not.toContain('data-marker="approve-form"');
    expect(html).toContain('פנו לתמיכה');
  });

  it('offers no approval for a campaign that has no package price or quota', async () => {
    for (const over of [{ package_price: null }, { contact_quota: null }]) {
      const html = await render({ campaign: over });
      expect(html).not.toContain('data-marker="approve-form"');
    }
  });

  it('offers no approval for an event that has already passed', async () => {
    const html = await render({ eventDate: PAST });
    expect(html).not.toContain('data-marker="approve-form"');
    expect(html).toContain('מועד האירוע כבר חלף');
  });
});
