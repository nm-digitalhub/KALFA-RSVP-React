import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { ownerMock, settingsMock, numbersMock, allowlistMock, staffMock, auditMock } = vi.hoisted(
  () => ({
    ownerMock: vi.fn(),
    settingsMock: vi.fn(),
    numbersMock: vi.fn(),
    allowlistMock: vi.fn(),
    staffMock: vi.fn(),
    auditMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: ownerMock }));
vi.mock('@/lib/data/admin/owner-agent', () => ({
  OWNER_AGENT_AUDIT_LIMIT: 50,
  getOwnerAgentSettings: settingsMock,
  listOwnerAgentNumbers: numbersMock,
  listOwnerAgentAllowlist: allowlistMock,
  listOwnerAgentStaff: staffMock,
  listOwnerAgentAudit: auditMock,
}));
vi.mock('./actions', () => ({
  setOwnerAgentEnabledAction: vi.fn(),
  setOwnerAgentNumberAction: vi.fn(),
  setOwnerAgentDailyCapAction: vi.fn(),
  addAllowlistEntryAction: vi.fn(),
  setAllowlistEntryEnabledAction: vi.fn(),
  relabelAllowlistEntryAction: vi.fn(),
  removeAllowlistEntryAction: vi.fn(),
}));

import OwnerAgentPage from './page';

type Props = Record<string, unknown> & { __type?: unknown };

function collect(node: unknown, out: Props[] = []): Props[] {
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

function propsOf(tree: unknown, name: string): Props | undefined {
  return collect(tree).find((p) => {
    const t = p.__type as { name?: string } | undefined;
    return typeof t === 'function' && t.name === name;
  });
}

const STAFF_ID = '0b7e1f2a-3c4d-4e5f-9a6b-7c8d9e0f1a2b';
const ENTRY_ID = '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a';

beforeEach(() => {
  vi.clearAllMocks();
  ownerMock.mockResolvedValue({ id: 'owner' });
  settingsMock.mockResolvedValue({ enabled: false, phoneNumberId: '1234567890123456', dailyCap: 50 });
  numbersMock.mockResolvedValue([
    {
      providerRef: '1234567890123456',
      label: 'אישורי הגעה',
      maskedNumber: '033***1505',
      isActive: true,
      roles: ['whatsapp_rsvp_sender'],
    },
  ]);
  allowlistMock.mockResolvedValue([
    {
      id: ENTRY_ID,
      maskedNumber: '050***4567',
      staffUserId: STAFF_ID,
      staffName: 'בעל המערכת',
      isStaff: true,
      enabled: true,
      label: null,
      createdAt: '2026-09-24T08:00:00Z',
      verifiedMatch: true,
    },
  ]);
  staffMock.mockResolvedValue([
    { userId: STAFF_ID, name: 'בעל המערכת', roleLabel: 'בעלים', isOwnerRole: true, hasVerifiedPhone: true },
  ]);
  auditMock.mockResolvedValue([]);
});

describe('/admin/integrations/owner-agent', () => {
  it('gates on requirePlatformOwner — not on a permission key', async () => {
    await OwnerAgentPage();
    expect(ownerMock).toHaveBeenCalledTimes(1);
  });

  it('reads nothing when the gate refuses', async () => {
    ownerMock.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(OwnerAgentPage()).rejects.toThrow('NEXT_REDIRECT');
    for (const m of [settingsMock, numbersMock, allowlistMock, staffMock, auditMock]) {
      expect(m).not.toHaveBeenCalled();
    }
  });

  it('hands the picker every number and the saved selection', async () => {
    const tree = await OwnerAgentPage();
    const picker = propsOf(tree, 'NumberPicker');
    expect(picker?.selected).toBe('1234567890123456');
    expect(picker?.numbers).toHaveLength(1);
  });

  it('tells the switch whether turning it on would actually divert anything', async () => {
    const tree = await OwnerAgentPage();
    expect(propsOf(tree, 'OwnerAgentSwitch')).toMatchObject({
      enabled: false,
      numberSelected: true,
      activeEntries: 1,
    });
  });

  it('counts only enabled rows that still belong to staff as active', async () => {
    allowlistMock.mockResolvedValue([
      { id: ENTRY_ID, enabled: false, isStaff: true },
      { id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f', enabled: true, isStaff: false },
    ]);
    const tree = await OwnerAgentPage();
    expect(propsOf(tree, 'OwnerAgentSwitch')?.activeEntries).toBe(0);
  });

  it('renders the allow-list, the cap and the audit', async () => {
    const tree = await OwnerAgentPage();
    expect(propsOf(tree, 'AllowlistPanel')?.entries).toHaveLength(1);
    expect(propsOf(tree, 'OwnerAgentDailyCapForm')?.dailyCap).toBe(50);
    const audit = propsOf(tree, 'AuditTable');
    expect(audit?.rows).toEqual([]);
    expect((audit?.staffNames as Map<string, string>).get(STAFF_ID)).toBe('בעל המערכת');
  });

  it('passes no raw phone number to any component', async () => {
    const tree = await OwnerAgentPage();
    // The data props handed to components (the client ones cross to the browser);
    // element plumbing (`children`, component types) is not data and is skipped.
    const json = JSON.stringify(collect(tree), (key, value) =>
      key === '__type' || key === 'children' || key === 'type' ? undefined : value,
    );
    expect(json).toContain('050***4567'); // the walk really saw the allow-list
    expect(json).not.toMatch(/\+\d{7,}/);
  });

  it('says, until stages 4 and 6 ship, that nothing here takes effect yet', async () => {
    const tree = await OwnerAgentPage();
    const note = collect(tree).find((p) => p.role === 'note');
    expect(note).toBeDefined();
    expect(JSON.stringify(note?.children)).toContain('הסוכן עדיין לא מחובר');
  });

  it('links back to the index', async () => {
    const tree = await OwnerAgentPage();
    const hrefs = collect(tree)
      .map((p) => p.href)
      .filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/integrations');
  });
});
