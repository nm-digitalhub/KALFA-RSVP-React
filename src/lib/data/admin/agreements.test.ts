import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/agreement-config', () => ({ getAgreementConfigTokens: vi.fn() }));
vi.mock('@/lib/data/company', () => ({ getCompanyLegal: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { getCompanyLegal } from '@/lib/data/company';
import { logActivity } from '@/lib/data/activity';
import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import { approveAgreement, getAgreementForAdmin, updateAgreement } from './agreements';

const COMPANY = {
  name: 'קאלפא',
  id: '51-1234567',
  address: 'הרצל 1',
  contactPhone: '03-1234567',
  contactEmail: 'support@kalfa.me',
  privacyUrl: 'https://beta.kalfa.me/privacy',
  termsUrl: 'https://beta.kalfa.me/terms',
  warrantyText: 'ת',
  instagramUrl: '',
};
const GOOD_BODY = '<h1>חבילה</h1><p>{{packagePrice}} · עד {{contactQuota}} · {{company.name}}</p>';

// A query builder that also has .match (the admin layer selects the package row with it).
function wire(results: Array<{ data?: unknown; error?: unknown }> = [{ data: null, error: null }]) {
  const { client, builder } = createMockSupabase<unknown>({ data: null, error: null });
  Object.assign(builder, { match: vi.fn(() => builder) });
  const then = vi.spyOn(builder, 'then');
  for (const r of results) then.mockImplementationOnce((f) => f({ data: r.data ?? null, error: (r.error ?? null) as never }));
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return builder as typeof builder & { match: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  for (const m of [requirePlatformPermission, logActivity, getAgreementConfigTokens, getCompanyLegal, createAdminClient]) {
    vi.mocked(m).mockReset();
  }
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as unknown as User);
  vi.mocked(getAgreementConfigTokens).mockResolvedValue({ liabilityCap: '', retentionDays: '' });
  vi.mocked(getCompanyLegal).mockResolvedValue(COMPANY);
});

describe('every admin function is behind manage_settings', () => {
  it.each([
    ['getAgreementForAdmin', () => getAgreementForAdmin()],
    ['updateAgreement', () => updateAgreement({ version: '2026-10-v6', bodyHtml: GOOD_BODY })],
    ['approveAgreement', () => approveAgreement('2026-10-v6')],
  ])('%s refuses before touching the database when the gate throws', async (_name, call) => {
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(call()).rejects.toThrow('NEXT_REDIRECT');
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });
});

describe('getAgreementForAdmin', () => {
  it('reads the single package row', async () => {
    const pkg = wire([{ data: { version: 'draft-2026-10-v6', body_html: GOOD_BODY, status: 'draft', approved_at: null } }]);
    expect(await getAgreementForAdmin()).toEqual({ version: 'draft-2026-10-v6', bodyHtml: GOOD_BODY, status: 'draft', approvedAt: null });
    expect(pkg.match).toHaveBeenCalledWith({ model: 'package' });
  });

  it('with no package row yet shows an EMPTY draft', async () => {
    wire([{ data: null }]);
    expect(await getAgreementForAdmin()).toEqual({
      version: 'draft-2026-10-v6',
      status: 'draft',
      bodyHtml: '',
      approvedAt: null,
    });
  });
});

describe('updateAgreement', () => {
  it('saves a package body as a DRAFT on the package row, and audits it', async () => {
    const b = wire();
    await updateAgreement({ version: 'draft-2026-10-v6', bodyHtml: GOOD_BODY });
    expect(b.update).toHaveBeenCalledWith({
      version: 'draft-2026-10-v6',
      body_html: GOOD_BODY,
      status: 'draft',
      approved_by: null,
      approved_at: null,
    });
    expect(b.match).toHaveBeenCalledWith({ model: 'package' });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.agreement.updated',
      meta: { model: 'package', version: 'draft-2026-10-v6' },
    });
  });

  it('a package document needs a body — it has no in-code text to fall back to', async () => {
    const b = wire();
    await expect(updateAgreement({ version: '2026-10-v6', bodyHtml: '   ' })).rejects.toThrow('נוסח חוזה החבילה חייב להיות מלא');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('takes only the package version: an earlier pay-per-result version is refused', async () => {
    const b = wire();
    await expect(updateAgreement({ version: '2026-09-v5', bodyHtml: GOOD_BODY })).rejects.toThrow('גרסת חוזה החבילה חייבת להיות');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('a database failure is a safe message', async () => {
    wire([{ error: { message: 'constraint agreement_documents_model_shape' } }]);
    await expect(updateAgreement({ version: '2026-10-v6', bodyHtml: GOOD_BODY })).rejects.toThrow('שמירת החוזה נכשלה');
  });
});

describe('approveAgreement', () => {
  it('approves a valid package body, recording who approved it', async () => {
    const b = wire([{ data: { body_html: GOOD_BODY } }, { data: null }]);
    await approveAgreement('2026-10-v6');
    expect(b.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', version: '2026-10-v6', approved_by: 'admin-1' }),
    );
    expect(b.match).toHaveBeenLastCalledWith({ model: 'package' });
    expect(logActivity).toHaveBeenCalledWith({ action: 'admin.agreement.approved', meta: { model: 'package', version: '2026-10-v6' } });
  });

  it('refuses a package body that does not state the price and the quota', async () => {
    const b = wire([{ data: { body_html: '<p>{{company.name}}</p>' } }]);
    await expect(approveAgreement('2026-10-v6')).rejects.toThrow('{{packagePrice}} {{contactQuota}}');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('refuses a body with a token no one resolves (a typo would reach the customer as literal braces)', async () => {
    const b = wire([{ data: { body_html: `${GOOD_BODY}<p>{{pakagePrice}}</p>` } }]);
    await expect(approveAgreement('2026-10-v6')).rejects.toThrow('{{pakagePrice}}');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('refuses a body that quotes a retired pay-per-result figure (an unknown token)', async () => {
    const b = wire([{ data: { body_html: `${GOOD_BODY}<p>{{pricePerReached}}</p>` } }]);
    await expect(approveAgreement('2026-10-v6')).rejects.toThrow('{{pricePerReached}}');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('accepts the admin-config tokens as known', async () => {
    wire([{ data: { body_html: `${GOOD_BODY}<p>{{liabilityCap}}</p>` } }, { data: null }]);
    await expect(approveAgreement('2026-10-v6')).resolves.toBeUndefined();
  });

  it('refuses a package approval with no body at all', async () => {
    const b = wire([{ data: { body_html: null } }]);
    await expect(approveAgreement('2026-10-v6')).rejects.toThrow('נוסח חוזה החבילה חייב להיות מלא');
    expect(b.update).not.toHaveBeenCalled();
  });
});

describe('PDF compatibility gates approval, not draft saving', () => {
  it('approves rich document HTML', async () => {
    const body = `${GOOD_BODY}<section dir="rtl"><h4>תנאי</h4><p style="color:blue"><u>קו</u><mark>סימון</mark><small>קטן</small></p><pre><code>  const fee = 10;</code></pre></section>`;
    const b = wire([{ data: { body_html: body } }, { data: null }]);
    await approveAgreement('2026-10-v6');
    expect(b.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', version: '2026-10-v6', approved_by: 'admin-1', approved_at: expect.any(String) }));
  });
  it.each(['<iframe src="/terms"></iframe>', '<p style="display:none">hidden</p>', '<p onclick="x()">x</p>', '<a href="javascript:x()">link</a>'])('does not write or audit approval when incompatible: %s', async (html) => {
    const b = wire([{ data: { body_html: `${GOOD_BODY}${html}` } }]);
    await expect(approveAgreement('2026-10-v6')).rejects.toThrow('לא ניתן לאשר את החוזה משום שחלק מהנוסח אינו ניתן לייצוג ב-PDF');
    expect(b.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
  it('saves an unfinished, incompatible raw HTML draft unchanged', async () => {
    const body = '<table><tr><td>{{unfinished}}</td></tr></table>';
    const b = wire();
    await updateAgreement({ version: 'draft-2026-10-v6', bodyHtml: body });
    expect(b.update).toHaveBeenCalledWith({ version: 'draft-2026-10-v6', body_html: body, status: 'draft', approved_by: null, approved_at: null });
  });
});

// The body is checked raw above; the links the {{privacyLink}} / {{termsLink}} tokens expand to come from the company
// settings, so approval also checks the body AFTER the tokens are replaced, with the real company data.
describe('PDF compatibility after the tokens are replaced', () => {
  const WITH_LINKS = `${GOOD_BODY}<p>{{privacyLink}} · {{termsLink}}</p>`;

  it('approves when the company links expand to compatible anchors', async () => {
    const b = wire([{ data: { body_html: WITH_LINKS } }, { data: null }]);
    await approveAgreement('2026-10-v6');
    expect(getCompanyLegal).toHaveBeenCalledTimes(1);
    expect(b.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  it.each([
    ['a script address in the privacy URL', { privacyUrl: 'javascript:alert(1)' }],
    ['an unsupported protocol in the terms URL', { termsUrl: 'ftp://kalfa.me/terms' }],
  ])('refuses %s: nothing is written or audited', async (_label, over) => {
    vi.mocked(getCompanyLegal).mockResolvedValue({ ...COMPANY, ...over });
    const b = wire([{ data: { body_html: WITH_LINKS } }]);
    await expect(approveAgreement('2026-10-v6')).rejects.toThrow('לאחר החלפת התחליפים');
    expect(b.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('a body without the link tokens is unaffected by bad company links (they never reach the document)', async () => {
    vi.mocked(getCompanyLegal).mockResolvedValue({ ...COMPANY, privacyUrl: 'javascript:alert(1)' });
    const b = wire([{ data: { body_html: GOOD_BODY } }, { data: null }]);
    await approveAgreement('2026-10-v6');
    expect(b.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  it('keeps the earlier raw-body check: an incompatible element is refused before the company data is read', async () => {
    wire([{ data: { body_html: `${GOOD_BODY}<iframe src="/terms"></iframe>` } }]);
    await expect(approveAgreement('2026-10-v6')).rejects.toThrow('אינו ניתן לייצוג ב-PDF');
    expect(getCompanyLegal).not.toHaveBeenCalled();
  });
});
