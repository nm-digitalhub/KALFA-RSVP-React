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
  AgreementEditor: (props: { model: string; version: string; tokens: string[] }) => (
    <div data-marker="editor" data-model={props.model} data-version={props.version} data-tokens={props.tokens.join(',')} />
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

async function render(model?: string | string[]) {
  const tree = await AdminAgreementPage({ searchParams: Promise.resolve(model === undefined ? {} : { model }) });
  return renderToStaticMarkup(tree);
}

const doc = (over: Record<string, unknown>) => ({
  model: 'per_result', version: '2026-07-v4', status: 'approved', bodyHtml: null, approvedAt: null, ...over,
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

  it('shows the pay-per-result contract by default, and a tab to the package contract', async () => {
    const html = await render();
    expect(getAgreementForAdmin).toHaveBeenCalledWith('per_result');
    expect(html).toContain('data-model="per_result"');
    expect(html).toContain('חיוב לפי תוצאה');
    expect(html).toContain('href="/admin/agreement?model=package"');
    expect(html).toContain('תבנית ברירת מחדל');
  });

  it('an unknown model falls back to the pay-per-result contract rather than failing', async () => {
    const html = await render('subscription');
    expect(getAgreementForAdmin).toHaveBeenCalledWith('per_result');
    expect(html).toContain('data-model="per_result"');
  });

  it('the package tab loads the package document, offers its tokens and none of the pay-per-result figures', async () => {
    vi.mocked(getAgreementForAdmin).mockResolvedValue(
      doc({ model: 'package', version: 'draft-2026-10-v6', status: 'draft', bodyHtml: '<h1>חבילה</h1><p>{{packagePrice}} · {{contactQuota}}</p>' }) as never,
    );
    const html = await render('package');
    expect(getAgreementForAdmin).toHaveBeenCalledWith('package');
    expect(html).toContain('data-model="package"');
    const tokens = /data-tokens="([^"]*)"/.exec(html)?.[1].split(',') ?? [];
    expect(tokens).toEqual(expect.arrayContaining(['packagePrice', 'contactQuota', 'liabilityCap']));
    expect(tokens).not.toContain('pricePerReached');
    expect(tokens).not.toContain('baseFee');
  });

  it('previews the package contract with the sample package figures', async () => {
    vi.mocked(getAgreementForAdmin).mockResolvedValue(
      doc({ model: 'package', version: 'draft-2026-10-v6', status: 'draft', bodyHtml: '<p>{{packagePrice}} · {{contactQuota}}</p>' }) as never,
    );
    const html = await render('package');
    expect(html).toContain('₪150.00');
    expect(html).toContain('100');
  });

  it('with no package text there is nothing to preview — a notice, not an error and not another contract', async () => {
    vi.mocked(getAgreementForAdmin).mockResolvedValue(
      doc({ model: 'package', version: 'draft-2026-10-v6', status: 'draft', bodyHtml: '' }) as never,
    );
    const html = await render('package');
    expect(html).toContain('עדיין אין נוסח לחוזה החבילה');
    expect(html).not.toContain('class="agreement-doc"');
  });

  it('a package document is not labelled "default template" (it has none)', async () => {
    vi.mocked(getAgreementForAdmin).mockResolvedValue(
      doc({ model: 'package', version: 'draft-2026-10-v6', status: 'draft', bodyHtml: '<p>{{packagePrice}} {{contactQuota}}</p>' }) as never,
    );
    expect(await render('package')).not.toContain('תבנית ברירת מחדל');
  });
});
