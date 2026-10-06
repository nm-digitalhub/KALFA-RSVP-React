import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { indexMock, catalogMock } = vi.hoisted(() => ({
  indexMock: vi.fn(),
  catalogMock: vi.fn(),
}));

vi.mock('@/lib/data/admin/integrations', () => ({ getIntegrationsIndex: indexMock }));
vi.mock('@/lib/data/admin/channel-catalog', () => ({ listAllChannels: catalogMock }));

import AdminIntegrationsPage from './page';

beforeEach(() => vi.clearAllMocks());

type El = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

function collect(node: unknown, out: El[] = [], depth = 0): El[] {
  if (!node || typeof node !== 'object' || depth > 40) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out, depth + 1));
    return out;
  }
  const el = node as El;
  out.push(el);
  collect(el.props?.children, out, depth + 1);
  return out;
}

const componentNames = (tree: unknown) =>
  collect(tree)
    .map((el) => (typeof el.type === 'function' ? ((el.type as { name?: string }).name ?? '') : ''))
    .filter(Boolean);

function hrefs(tree: unknown): string[] {
  return collect(tree)
    .map((el) => el.props?.href)
    .filter((h): h is string => typeof h === 'string');
}

const CHANNELS = [
  { key: 'whatsapp', display_name: 'וואטסאפ', is_built: true, active: true, sort_order: 1 },
  { key: 'call', display_name: 'שיחה', is_built: false, active: false, sort_order: 2 },
];

async function render({ canManageSettings }: { canManageSettings: boolean }) {
  indexMock.mockResolvedValue({
    cards: [
      {
        key: 'meta_whatsapp',
        label: 'Meta / WhatsApp',
        href: '/admin/integrations/meta-whatsapp',
        configured: true,
        enabled: true,
        allowed: true,
        healthCheckAvailable: true,
        lastCheckedAt: null,
        note: null,
      },
    ],
    canManageSettings,
    showsLastChecked: true,
  });
  catalogMock.mockResolvedValue(CHANNELS);
  return AdminIntegrationsPage();
}

describe('the integrations index hosts the channel catalog (Task 0.6 Step 4b)', () => {
  it('renders the catalog editor with the channels, for a manage_settings viewer', async () => {
    const tree = await render({ canManageSettings: true });
    expect(componentNames(tree)).toContain('ChannelCatalogEditor');
    const editor = collect(tree).find(
      (el) => typeof el.type === 'function' && (el.type as { name?: string }).name === 'ChannelCatalogEditor',
    );
    expect(editor?.props?.channels).toEqual(CHANNELS);
  });

  it('no longer links anywhere near the deleted /admin/channels page', async () => {
    const tree = await render({ canManageSettings: true });
    expect(hrefs(tree).some((h) => h.startsWith('/admin/channels'))).toBe(false);
    expect(hrefs(tree).some((h) => h.startsWith('/admin/alerts'))).toBe(false);
  });

  it('does NOT call listAllChannels for a viewer without manage_settings', async () => {
    // listAllChannels enforces manage_settings itself and REDIRECTS on failure —
    // out of the admin area entirely. Calling it unconditionally would eject a
    // staff member with a lower permission from a page they are allowed to read,
    // which is the exact behaviour this consolidation exists to stop.
    const tree = await render({ canManageSettings: false });
    expect(catalogMock).not.toHaveBeenCalled();
    expect(componentNames(tree)).not.toContain('ChannelCatalogEditor');
  });
});
