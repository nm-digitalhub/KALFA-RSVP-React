import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, viewMock, listMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  viewMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/admin/alerts', () => ({
  getSlackAlertsView: viewMock,
  listOpsAlerts: listMock,
}));

import SlackIntegrationPage from './page';

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

const TOKEN = 'xoxb-REAL-BOT-TOKEN-DO-NOT-LEAK';

async function render({ page = '2' }: { page?: string } = {}) {
  permMock.mockResolvedValue({ id: 'u1' });
  viewMock.mockResolvedValue({
    connected: true,
    hasToken: true,
    channelId: 'C0123456789',
    enabled: true,
    mentionUserId: 'U0123456789',
    mentionMinLevel: 'error',
    categories: {
      errors: true,
      sendHealth: true,
      campaignBilling: false,
      security: true,
      customerInquiry: false,
    },
  });
  listMock.mockResolvedValue({
    items: [],
    page: Number(page),
    pageSize: 20,
    total: 100,
  });
  return SlackIntegrationPage({ searchParams: Promise.resolve({ page }) });
}

describe('/admin/integrations/slack', () => {
  it('gates on manage_settings', async () => {
    await render();
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });

  it('renders both moved pieces', async () => {
    const names = componentNames(await render());
    expect(names).toContain('AlertsClient');
    expect(names).toContain('AlertsHistory');
  });

  it('paginates to ITSELF, not to the page being retired', async () => {
    // The lifted table came from alerts/page.tsx with basePath hardcoded to
    // '/admin/alerts'. Copied unchanged, a reader on page 2 here would be thrown
    // onto the legacy page. Asserting rendered text would not catch an href.
    const history = collect(await render()).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'AlertsHistory',
    );
    expect(history?.basePath).toBe('/admin/integrations/slack');
  });

  it('passes the requested page through to the query', async () => {
    await render({ page: '3' });
    expect(listMock).toHaveBeenCalledWith({ page: 3 });
  });

  it('links back to the integrations index', async () => {
    const hrefs = collect(await render())
      .map((p) => p.href)
      .filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/integrations');
  });

  it('says the only verification is manual, matching the index card', async () => {
    // The card carries healthCheckAvailable:false. If this page implied a scheduled
    // check, the two surfaces would contradict each other again — the exact defect
    // fixed on the live panel 2026-09-10.
    expect(textOf(await render())).toContain('אין כאן בדיקה מתוזמנת');
  });

  it('never renders the bot token as page text', async () => {
    // getSlackAlertsView returns hasToken only; nothing here should be able to print
    // a token even if one were added to the view by mistake.
    viewMock.mockResolvedValueOnce({
      connected: true,
      hasToken: true,
      channelId: 'C0123456789',
      enabled: true,
      mentionUserId: '',
      mentionMinLevel: 'off',
      slack_bot_token: TOKEN,
      categories: {
        errors: true,
        sendHealth: true,
        campaignBilling: true,
        security: true,
        customerInquiry: true,
      },
    });
    listMock.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    permMock.mockResolvedValue({ id: 'u1' });
    const tree = await SlackIntegrationPage({ searchParams: Promise.resolve({}) });
    expect(textOf(tree)).not.toContain(TOKEN);
  });
});
