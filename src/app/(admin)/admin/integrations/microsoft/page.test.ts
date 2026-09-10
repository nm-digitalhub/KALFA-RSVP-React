import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, healthMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  healthMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/microsoft/health', () => ({ checkMicrosoftHealth: healthMock }));

import MicrosoftPage from './page';

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
    if (typeof n === 'number') return void parts.push(String(n));
    if (Array.isArray(n)) return void n.forEach(visit);
    if (n && typeof n === 'object') visit((n as { props?: { children?: unknown } }).props?.children);
  };
  visit(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const componentNames = (tree: unknown) =>
  collect(tree)
    .map((p) => {
      const t = p.__type as { name?: string } | undefined;
      return typeof t === 'function' ? (t.name ?? '') : '';
    })
    .filter(Boolean);

const HEALTHY = {
  ok: true as const,
  organization: 'KALFA',
  verifiedDomains: ['kalfa.me'],
  mailbox: 'netanel.kalfa@kalfa.me',
  mailboxResolves: true,
  certName: 'CN=KALFA Calendar Service',
  certExpiresAt: '2031-08-14T18:00:38Z',
  certDaysRemaining: 1799,
  clientSecretCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'u1' });
  healthMock.mockResolvedValue(HEALTHY);
});

describe('/admin/integrations/microsoft', () => {
  it('gates on manage_settings', async () => {
    await MicrosoftPage();
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });

  it('renders the status card', async () => {
    expect(componentNames(await MicrosoftPage())).toContain('MicrosoftStatusCard');
  });

  it('keeps the page up when the probe throws, passing null rather than a fake state', async () => {
    // "We could not check" is a statement about the CHECK, not about the connection.
    healthMock.mockRejectedValue(new Error('boom'));
    const card = collect(await MicrosoftPage()).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'MicrosoftStatusCard',
    );
    expect(card?.health).toBeNull();
  });

  it('says the check reads our own tenant and no customer data', async () => {
    const text = textOf(await MicrosoftPage());
    expect(text).toContain('לא נשלח דואר');
    expect(text).toContain('לא נקרא מידע של אף לקוח');
  });

  it('explains that the data comes from Graph, not from our own table', async () => {
    // The distinction is the reason this page exists: exchange_connections can only
    // answer for one admin.
    expect(textOf(await MicrosoftPage())).toContain('לא מהטבלה שלנו');
  });

  it('offers no save button for something the panel cannot change', async () => {
    // The identity lives in env vars and in the Azure app registration. A form here
    // would promise an edit that cannot happen.
    const names = componentNames(await MicrosoftPage());
    expect(names).not.toContain('SubmitButton');
    expect(textOf(await MicrosoftPage())).toContain('תעודה אינה שדה שטופס יכול להחזיק');
  });

  it('links back to the index and to where Exchange connections DO live', async () => {
    const hrefs = collect(await MicrosoftPage())
      .map((p) => p.href)
      .filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/integrations');
    expect(hrefs).toContain('/admin/settings');
  });
});
