import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/company', () => ({ getCompanyLegal: vi.fn() }));
vi.mock('@/lib/data/admin/agreements', () => ({ getAgreementForAdmin: vi.fn() }));
vi.mock('@/lib/data/agreement-config', () => ({
  getAgreementConfigTokens: vi.fn(),
  getAgreementConfigForAdmin: vi.fn(),
}));
vi.mock('../_components', () => ({
  PageHeading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  Badge: ({ children }: { children: React.ReactNode }) => <span data-marker="badge">{children}</span>,
}));
vi.mock('./agreement-client', () => ({
  AgreementEditor: (props: { version: string; tokens: string[] }) => (
    <div data-marker="editor" data-version={props.version} data-tokens={props.tokens.join(',')} />
  ),
}));
vi.mock('./agreement-config-form', () => ({ AgreementConfigForm: () => <div data-marker="config-form" /> }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getAgreementConfigForAdmin, getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { getAgreementForAdmin } from '@/lib/data/admin/agreements';
import { getCompanyLegal } from '@/lib/data/company';
import AdminAgreementPage from './page';

const company = {
  name: 'קאלפא', id: '51-1', address: 'הרצל 1', contactPhone: '03', contactEmail: 'a@b.c', privacyUrl: '', termsUrl: '', warrantyText: 'w',
};

async function render() {
  return renderToStaticMarkup(await AdminAgreementPage());
}

const doc = (over: Record<string, unknown>) => ({
  version: 'draft-2026-10-v6', status: 'draft', bodyHtml: '<h1>חבילה</h1><p>{{packagePrice}} · {{contactQuota}}</p>', approvedAt: null, ...over,
});

beforeEach(() => {
  for (const m of [requirePlatformPermission, getCompanyLegal, getAgreementForAdmin, getAgreementConfigTokens, getAgreementConfigForAdmin]) {
    vi.mocked(m).mockReset();
  }
  vi.mocked(getCompanyLegal).mockResolvedValue(company as never);
  vi.mocked(getAgreementConfigTokens).mockResolvedValue({ liabilityCap: '' });
  vi.mocked(getAgreementConfigForAdmin).mockResolvedValue({} as never);
  vi.mocked(getAgreementForAdmin).mockResolvedValue(doc({}) as never);
});

describe('/admin/agreement', () => {
  it('is behind manage_settings', async () => {
    await render();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });

  it('shows the package contract, with no tab to another contract, and offers its tokens', async () => {
    const html = await render();
    expect(getAgreementForAdmin).toHaveBeenCalledWith();
    expect(html).not.toContain('חיוב לפי תוצאה');
    expect(html).not.toContain('?model=');
    const tokens = /data-tokens="([^"]*)"/.exec(html)?.[1].split(',') ?? [];
    expect(tokens).toEqual(expect.arrayContaining(['packagePrice', 'contactQuota', 'liabilityCap']));
    expect(tokens).not.toContain('pricePerReached');
    expect(tokens).not.toContain('baseFee');
  });

  it('previews the contract with the sample package figures', async () => {
    vi.mocked(getAgreementForAdmin).mockResolvedValue(doc({ bodyHtml: '<p>{{packagePrice}} · {{contactQuota}}</p>' }) as never);
    const html = await render();
    expect(html).toContain('₪150.00');
    expect(html).toContain('100');
  });

  it('with no text there is nothing to preview — a notice, not an error', async () => {
    vi.mocked(getAgreementForAdmin).mockResolvedValue(doc({ bodyHtml: '' }) as never);
    const html = await render();
    expect(html).toContain('עדיין אין נוסח לחוזה החבילה');
    expect(html).not.toContain('class="agreement-doc"');
  });

  it('is not labelled "default template" (there is none)', async () => {
    expect(await render()).not.toContain('תבנית ברירת מחדל');
  });
});
