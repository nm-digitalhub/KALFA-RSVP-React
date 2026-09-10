import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, listMock, flagsMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  listMock: vi.fn(),
  flagsMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/admin/integrations/provider-numbers', () => ({
  listProviderNumbers: listMock,
}));
vi.mock('@/lib/ops/integrations', () => ({
  getIntegrationsConfiguredFlags: flagsMock,
}));
vi.mock('./actions', () => ({
  syncMetaNumbersAction: vi.fn(),
  syncVoximplantNumbersAction: vi.fn(),
}));

import NumbersPage from './page';

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
  // Collapse runs of whitespace: the walk joins every text node with a space, so an
  // interpolated `{count}` next to a literal string produces a DOUBLE space that no
  // reader ever sees. Asserting around that artifact would be testing the walker.
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const componentNames = (tree: unknown) =>
  collect(tree)
    .map((p) => {
      const t = p.__type as { name?: string } | undefined;
      return typeof t === 'function' ? (t.name ?? '') : '';
    })
    .filter(Boolean);

function number(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    provider: 'voximplant',
    providerRef: null,
    e164: '+97237219347',
    displayLabel: 'מספר יוצא (Caller ID)',
    isActive: true,
    snapshot: null,
    snapshotAt: null,
    source: 'backfill',
    roles: ['voice_caller_id_rsvp'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'u1' });
  flagsMock.mockResolvedValue({
    whatsapp_configured: true,
    voximplant_configured: true,
  });
  listMock.mockResolvedValue([number()]);
});

describe('/admin/integrations/numbers', () => {
  it('gates on manage_settings', async () => {
    await NumbersPage();
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });

  it('renders the table and the sync controls', async () => {
    const names = componentNames(await NumbersPage());
    expect(names).toContain('NumbersTable');
    expect(names).toContain('SyncButtons');
  });

  it('makes NO live provider call on render', async () => {
    // An unbounded third-party latency in a hot render path is how an admin page
    // becomes unopenable during a provider incident. The rows come from the table;
    // a live read happens only when someone presses sync.
    await NumbersPage();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(flagsMock).toHaveBeenCalledTimes(1);
  });

  it('disables a provider\'s sync button when that provider is not configured', async () => {
    // "No numbers yet" and "never connected" look identical in a row count, and only
    // the second is unfixable by pressing the button.
    flagsMock.mockResolvedValue({
      whatsapp_configured: false,
      voximplant_configured: true,
    });
    const buttons = collect(await NumbersPage()).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'SyncButtons',
    );
    expect(buttons?.metaConfigured).toBe(false);
    expect(buttons?.voximplantConfigured).toBe(true);
  });

  it('treats an unreadable flags RPC as NOT configured rather than as configured', async () => {
    // getIntegrationsConfiguredFlags returns null on refusal — "we could not ask" is
    // not "everything is connected", and the optimistic reading would offer a button
    // that can only fail.
    flagsMock.mockResolvedValue(null);
    const buttons = collect(await NumbersPage()).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'SyncButtons',
    );
    expect(buttons?.metaConfigured).toBe(false);
    expect(buttons?.voximplantConfigured).toBe(false);
  });

  it('counts the numbers holding no role and says what that means', async () => {
    listMock.mockResolvedValue([
      number(),
      number({ id: 'n2', roles: [], e164: '+97233301505' }),
    ]);
    const text = textOf(await NumbersPage());
    expect(text).toContain('2');
    expect(text).toContain('1 ללא תפקיד');
    expect(text).toContain('לא ישמשו לשליחה או לחיוג');
  });

  it('says nothing about unassigned numbers when every number has a role', async () => {
    const text = textOf(await NumbersPage());
    expect(text).not.toContain('ללא תפקיד —');
  });

  it('links back to the index and to each provider page', async () => {
    const hrefs = collect(await NumbersPage())
      .map((p) => p.href)
      .filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/integrations');
    expect(hrefs).toContain('/admin/integrations/meta-whatsapp');
    expect(hrefs).toContain('/admin/integrations/voximplant');
    expect(hrefs).toContain('/admin/integrations/extra-sms');
  });
});
