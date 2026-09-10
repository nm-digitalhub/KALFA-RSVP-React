import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, configMock, healthMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  configMock: vi.fn(),
  healthMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/admin/settings', () => ({ getSumitCredentials: configMock }));
vi.mock('@/lib/sumit/health', () => ({ checkSumitHealth: healthMock }));

import SumitPage from './page';

function collect(node: unknown, out: Array<Record<string, unknown>> = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (el.props) out.push({ ...el.props, __type: el.type });
  collect(el.props?.children, out);
  return out;
}

function textOf(node: unknown): string {
  const parts: string[] = [];
  const visit = (n: unknown): void => {
    if (typeof n === 'string') return void parts.push(n);
    if (Array.isArray(n)) return void n.forEach(visit);
    if (n && typeof n === 'object') visit((n as { props?: { children?: unknown } }).props?.children);
  };
  visit(node);
  return parts.join(' ');
}

const componentNames = (tree: unknown) =>
  collect(tree)
    .map((p) => {
      const t = p.__type as { name?: string } | undefined;
      return typeof t === 'function' ? (t.name ?? '') : '';
    })
    .filter(Boolean);

const KEY = 'SUMIT-KEY-SECRET';

async function render({ companyId = '123456', apiKey = KEY, healthThrows = false } = {}) {
  permMock.mockResolvedValue({ id: 'u1' });
  configMock.mockResolvedValue({
    sumit_company_id: companyId,
    sumit_api_public_key: 'pub',
    sumit_api_key: apiKey,
    configured: Boolean(companyId && apiKey),
  });
  if (healthThrows) healthMock.mockRejectedValue(new Error('boom'));
  else healthMock.mockResolvedValue({
    ok: true, companyName: 'KALFA RSVP', corporateNumber: '316125434',
    documentsEmail: 'docs@example.com',
  });
  return SumitPage();
}

describe('/admin/integrations/sumit', () => {
  it('gates on manage_settings', async () => {
    await render();
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });

  it('renders both moved pieces', async () => {
    const names = componentNames(await render());
    expect(names).toContain('SumitCredentialsForm');
    expect(names).toContain('SumitStatusCard');
  });

  it('does not probe SUMIT when nothing is stored', async () => {
    // A fresh install must read "not set up", never "SUMIT rejected you".
    healthMock.mockClear();
    const tree = await render({ companyId: '', apiKey: '' });
    expect(healthMock).not.toHaveBeenCalled();
    const card = collect(tree).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'SumitStatusCard',
    );
    expect(card?.health).toBeNull();
  });

  it('keeps the credentials form up when the probe throws', async () => {
    const tree = await render({ healthThrows: true });
    expect(componentNames(tree)).toContain('SumitCredentialsForm');
  });

  it('says the money switches are NOT here, and links to where they are', async () => {
    // "Can we reach the provider" and "should we charge anyone" are different
    // questions; one page inviting both is how the second gets answered by accident.
    const tree = await render();
    expect(textOf(tree)).toContain('מתגי הכסף');
    const hrefs = collect(tree).map((p) => p.href).filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/settings');
    expect(hrefs).toContain('/admin/sumit-test');
    expect(hrefs).toContain('/admin/integrations');
  });

  it('states that the check creates nothing and charges nothing', async () => {
    const text = textOf(await render());
    expect(text).toContain('לא מבוצע חיוב');
    expect(text).toContain('לא נקרא מידע של אף לקוח');
  });

  it('never renders the api key as page text', async () => {
    expect(textOf(await render())).not.toContain(KEY);
  });
});
