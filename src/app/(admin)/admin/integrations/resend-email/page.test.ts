// Guards the silent-deletion class this branch has been chasing since Task 0.3, plus
// the two claims this page makes that would be wrong if the code drifted: which
// transport is live, and that a dead probe does not take the form down.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, configMock, probeMock, providerMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  configMock: vi.fn(),
  probeMock: vi.fn(),
  providerMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/admin/settings', () => ({ getEmailTransportConfig: configMock }));
vi.mock('@/lib/email/run-health-check', () => ({ probeEmailHealth: probeMock }));
vi.mock('@/lib/email/sender', () => ({ selectedEmailProvider: providerMock }));

import ResendEmailPage from './page';

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

/** Every string in a text position, array children included — see the ExtrA page test. */
function textOf(node: unknown): string {
  const parts: string[] = [];
  const visit = (n: unknown): void => {
    if (typeof n === 'string') {
      parts.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
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

const PASSWORD = 'SMTP-PASSWORD-SECRET';

async function render({
  provider = 'resend' as 'resend' | 'smtp',
  health = {
    ok: true as const,
    transport: 'resend' as const,
    from: 'KALFA <noreply@kalfa.me>',
    domain: 'kalfa.me',
    domainStatus: 'verified',
    records: [{ record: 'DKIM', status: 'verified' }],
    fullyVerified: true,
  } as unknown,
  probeThrows = false,
} = {}) {
  permMock.mockResolvedValue({ id: 'u1' });
  providerMock.mockReturnValue(provider);
  configMock.mockResolvedValue({
    email_enabled: true,
    smtp_host: 'smtp.example.com',
    smtp_port: '587',
    smtp_secure: false,
    smtp_user: 'user',
    smtp_password: PASSWORD,
    smtp_from: 'KALFA <noreply@kalfa.me>',
    configured: true,
  });
  if (probeThrows) probeMock.mockRejectedValue(new Error('boom'));
  else probeMock.mockResolvedValue(health);
  return ResendEmailPage();
}

describe('/admin/integrations/resend-email', () => {
  it('gates on manage_settings', async () => {
    await render();
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });

  it('renders both moved pieces — neither silently dropped', async () => {
    const names = componentNames(await render());
    expect(names).toContain('EmailTransportForm');
    expect(names).toContain('EmailHealthCard');
  });

  it('names the live transport, and says the panel does not choose it', async () => {
    // EMAIL_PROVIDER is an env switch so a rollback needs no deploy and no database.
    // A page offering to change it here would be lying about where the control is.
    const text = textOf(await render({ provider: 'resend' }));
    expect(text).toContain('EMAIL_PROVIDER');
    expect(text).toContain('לא מהפאנל');

    const props = collect(await render({ provider: 'smtp' })).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'EmailTransportForm',
    );
    expect(props?.activeProvider).toBe('smtp');
  });

  it('keeps the credentials form up when the probe throws', async () => {
    // That form is how someone FIXES a dead transport — it must outlive the probe.
    const tree = await render({ probeThrows: true });
    expect(componentNames(tree)).toContain('EmailTransportForm');
    const card = collect(tree).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'EmailHealthCard',
    );
    expect(card?.health).toBeNull();
  });

  it('hands the probe verdict straight to the card', async () => {
    const card = collect(await render()).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'EmailHealthCard',
    );
    expect(card?.health).toMatchObject({ ok: true, domain: 'kalfa.me' });
  });

  it('warns that Supabase Auth mail is a SECOND path this page does not cover', async () => {
    // Same From address, different sender, unaffected by EMAIL_PROVIDER — which is
    // exactly why someone would assume this page covers it.
    const text = textOf(await render());
    expect(text).toContain('Supabase Auth');
    expect(text).toContain('אינם נבדקים כאן');
  });

  it('never renders the smtp password as page text', async () => {
    expect(textOf(await render())).not.toContain(PASSWORD);
  });

  it('links back to the index', async () => {
    const hrefs = collect(await render())
      .map((p) => p.href)
      .filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/integrations');
  });
});
