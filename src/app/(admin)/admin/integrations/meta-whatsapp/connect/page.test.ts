import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { ownerMock, readinessMock, listMock } = vi.hoisted(() => ({
  ownerMock: vi.fn(),
  readinessMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: ownerMock }));
vi.mock('@/lib/data/admin/integrations/whatsapp-es', () => ({
  getEsReadiness: readinessMock,
  listEsConnections: listMock,
}));
vi.mock('./actions', () => ({ connectEmbeddedSignupAction: vi.fn() }));

import ConnectPage from './page';

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

const launcherProps = (tree: unknown) =>
  collect(tree).find((p) => (p.__type as { name?: string })?.name === 'EmbeddedSignupLauncher');

beforeEach(() => {
  vi.clearAllMocks();
  ownerMock.mockResolvedValue({ id: 'u1' });
  listMock.mockResolvedValue([]);
});

describe('/admin/integrations/meta-whatsapp/connect', () => {
  it('gates on the platform owner', async () => {
    readinessMock.mockResolvedValue({ ready: false, reason: 'r' });
    await ConnectPage();
    expect(ownerMock).toHaveBeenCalled();
  });

  it('not ready: shows the reason and renders no launcher', async () => {
    readinessMock.mockResolvedValue({ ready: false, reason: 'חסר מזהה התצורה' });
    const tree = await ConnectPage();
    expect(textOf(tree)).toContain('חסר מזהה התצורה');
    expect(launcherProps(tree)).toBeUndefined();
  });

  it('ready: the launcher gets the app id and config id', async () => {
    readinessMock.mockResolvedValue({ ready: true, appId: '1667254024607706', configId: '123456789' });
    const props = launcherProps(await ConnectPage());
    expect(props).toMatchObject({ appId: '1667254024607706', configId: '123456789' });
  });

  it('lists existing connections', async () => {
    readinessMock.mockResolvedValue({ ready: false, reason: 'r' });
    listMock.mockResolvedValue([
      {
        label: 'WhatsApp +972 50-000-0000',
        status: 'active',
        createdAt: '2026-09-25T10:00:00Z',
        platformType: 'CLOUD_API',
        sync: null,
      },
    ]);
    expect(textOf(await ConnectPage())).toContain('WhatsApp +972 50-000-0000');
  });

  it('a failed sync reads as failed, not as done', async () => {
    readinessMock.mockResolvedValue({ ready: false, reason: 'r' });
    listMock.mockResolvedValue([
      {
        label: 'WhatsApp +972 50-000-0000',
        status: 'active',
        createdAt: '2026-09-25T10:00:00Z',
        platformType: 'CLOUD_API',
        sync: { requestedAt: '2026-09-25T10:01:00Z', contacts: 'requested', history: 'failed' },
      },
    ]);
    const text = textOf(await ConnectPage());
    expect(text).toContain('אנשי קשר: הופעל');
    expect(text).toContain('היסטוריה: נכשל');
  });
});
