import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, configMock } = vi.hoisted(() => ({ permMock: vi.fn(), configMock: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/admin/integrations/cardcom-config', () => ({ readCardcomAdminConfig: configMock }));

import CardcomPage from './page';

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

const componentNames = (tree: unknown) =>
  collect(tree)
    .map((p) => {
      const t = p.__type as { name?: string } | undefined;
      return typeof t === 'function' ? (t.name ?? '') : '';
    })
    .filter(Boolean);

const find = (tree: unknown, name: string) =>
  collect(tree).find((p) => (p.__type as { name?: string } | undefined)?.name === name);

const CONFIG = {
  exists: true, terminalNumber: 1001, apiName: 'kalfa-api', enabled: true, hasPassword: true, isTestTerminal: false,
  updatedAt: '2026-10-07T10:00:00.000Z',
};
const EMPTY = { exists: false, terminalNumber: null, apiName: null, enabled: false, hasPassword: false, isTestTerminal: false, updatedAt: null };

async function render(config: Record<string, unknown> = CONFIG) {
  permMock.mockResolvedValue({ id: 'u1' });
  configMock.mockResolvedValue(config);
  return CardcomPage();
}

describe('/admin/integrations/cardcom', () => {
  it('gates on integrations.manage', async () => {
    await render();
    expect(permMock).toHaveBeenCalledWith('integrations.manage');
  });

  it('renders the status card and the form', async () => {
    const names = componentNames(await render());
    expect(names).toContain('CardcomStatusCard');
    expect(names).toContain('CardcomConfigForm');
  });

  it('hands the form the saved values, and only whether a password is stored — never the password', async () => {
    const form = find(await render(), 'CardcomConfigForm');
    expect(form?.values).toEqual({ terminal_number: '1001', api_name: 'kalfa-api', enabled: true, has_password: true });
  });

  it('shows an empty form when nothing was ever saved', async () => {
    const form = find(await render(EMPTY), 'CardcomConfigForm');
    expect(form?.values).toEqual({ terminal_number: '', api_name: '', enabled: false, has_password: false });
  });

  it('links back to the index and to the money switches in settings', async () => {
    const hrefs = collect(await render()).map((p) => p.href).filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/integrations');
    expect(hrefs).toContain('/admin/settings');
  });
});
