import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, listMock, flagsMock, ownerMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  listMock: vi.fn(),
  flagsMock: vi.fn(),
  ownerMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({
  requirePlatformPermission: permMock,
  isPlatformOwner: ownerMock,
}));
vi.mock('@/lib/data/admin/integrations/provider-numbers', () => ({
  listProviderNumbers: listMock,
}));
vi.mock('@/lib/ops/integrations', () => ({
  getIntegrationsConfiguredFlags: flagsMock,
}));
vi.mock('./actions', () => ({
  addNumberAction: vi.fn(),
  assignRoleAction: vi.fn(),
  deregisterNumberAction: vi.fn(),
  registerNumberAction: vi.fn(),
  requestCodeAction: vi.fn(),
  syncMetaNumbersAction: vi.fn(),
  syncVoximplantNumbersAction: vi.fn(),
  verifyCodeAction: vi.fn(),
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
  ownerMock.mockResolvedValue(true);
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

  it('renders the table, the sync controls and the roles panel', async () => {
    const names = componentNames(await NumbersPage());
    expect(names).toContain('NumbersTable');
    expect(names).toContain('SyncButtons');
    expect(names).toContain('RolesPanel');
  });

  it('hands the roles panel every number, not only the assigned ones', async () => {
    // The panel builds its rows from the ROLE list and looks the holder up in this
    // array; a filtered list would make an unassigned number unpickable.
    listMock.mockResolvedValue([
      number(),
      number({ id: 'n2', roles: [], e164: '+97233301505' }),
    ]);
    const panel = collect(await NumbersPage()).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'RolesPanel',
    );
    expect((panel?.numbers as unknown[]).length).toBe(2);
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

describe('the add-number wizard', () => {
  it('is offered when Meta is connected', async () => {
    const tree = await NumbersPage();
    expect(componentNames(tree)).toContain('AddNumberWizard');
  });

  it('is NOT offered when Meta was never connected', async () => {
    // An add-number form against absent credentials can only fail, and the failure
    // would read as "Meta rejected the number" rather than "we have no token".
    flagsMock.mockResolvedValue({ whatsapp_configured: false, voximplant_configured: true });
    const tree = await NumbersPage();
    expect(componentNames(tree)).not.toContain('AddNumberWizard');
  });

  it('tells the wizard whether the viewer may register, without gating on it', async () => {
    ownerMock.mockResolvedValue(false);
    const tree = await NumbersPage();
    const wizard = collect(tree).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'AddNumberWizard',
    );
    expect(wizard?.isOwner).toBe(false);
    // The page still renders: hiding the last step is a UI courtesy, and the action
    // it submits to carries its own requirePlatformOwner.
    expect(wizard).toBeDefined();
  });

  it('no longer claims that adding a number happens on the provider page', async () => {
    // It used to say exactly that, and the sentence outlived the fact.
    const text = textOf(await NumbersPage());
    expect(text).toContain('הוספת מספר');
    expect(text).not.toContain('ואימות מספר מול Meta נשארים בעמוד הספק');
  });
});

describe('the deregister panel', () => {
  it('is shown to the owner', async () => {
    ownerMock.mockResolvedValue(true);
    expect(componentNames(await NumbersPage())).toContain('MetaNumberManagement');
  });

  it('is absent for staff who are not the owner', async () => {
    // Hiding it is a courtesy, not the boundary — deregisterNumberAction carries its
    // own requirePlatformOwner. The page still renders everything else.
    ownerMock.mockResolvedValue(false);
    const names = componentNames(await NumbersPage());
    expect(names).not.toContain('MetaNumberManagement');
    expect(names).toContain('NumbersTable');
  });

  it('states the 72-hour cost where the control lives, not only in a tooltip', async () => {
    ownerMock.mockResolvedValue(true);
    const text = textOf(await NumbersPage());
    expect(text).toContain('72 שעות');
  });
});

describe('the wizard can be re-entered for a number already added', () => {
  it('is handed the Meta numbers a resume can point at', async () => {
    // Meta has NO delete-phone-number API (verified 2026-09-11), so a number added
    // and abandoned is stranded unless the wizard can reopen onto it.
    const tree = await NumbersPage();
    const wizard = collect(tree).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'AddNumberWizard',
    );
    const candidates = wizard?.candidates as Array<{ provider: string }> | undefined;
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates!.every((c) => c.provider === 'meta_whatsapp')).toBe(true);
  });

  it('offers only numbers Meta knows by an id', async () => {
    // A backfill row with no provider_ref has nothing to send a code to.
    listMock.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        provider: 'meta_whatsapp',
        providerRef: null,
        e164: '+972501234567',
        displayLabel: 'ללא מזהה',
        isActive: true,
        roles: [],
        source: 'backfill',
        snapshot: null,
        updatedAt: '2026-09-11T00:00:00Z',
      },
    ]);
    const tree = await NumbersPage();
    const wizard = collect(tree).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'AddNumberWizard',
    );
    expect((wizard?.candidates as unknown[]).length).toBe(0);
  });
});
