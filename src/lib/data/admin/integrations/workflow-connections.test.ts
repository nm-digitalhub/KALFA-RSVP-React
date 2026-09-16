import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permissionMock, adminMock } = vi.hoisted(() => ({
  permissionMock: vi.fn(),
  adminMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permissionMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));

import {
  listActiveMicrosoftWorkflowConnections,
  listMicrosoftWorkflowConnectionsForAdmin,
} from './workflow-connections';

function harness(result: { data: unknown[] | null; error: unknown }) {
  const orderId = vi.fn(async () => result);
  const orderLabel = vi.fn(() => ({ order: orderId }));
  const contains = vi.fn(() => ({ order: orderLabel }));
  const eqStatus = vi.fn(() => ({ contains }));
  const eqProvider = vi.fn(() => ({ eq: eqStatus }));
  const select = vi.fn(() => ({ eq: eqProvider }));
  const from = vi.fn(() => ({ select }));
  adminMock.mockReturnValue({ from });

  return { from, select, eqProvider, eqStatus, contains, orderLabel, orderId };
}

beforeEach(() => {
  vi.clearAllMocks();
  permissionMock.mockResolvedValue({ id: 'staff-1' });
});

describe('listActiveMicrosoftWorkflowConnections', () => {
  it('reads only active Microsoft connections that grant Mail.Send', async () => {
    const h = harness({
      data: [{ id: 'connection-1', label: 'תיבת מכירות' }],
      error: null,
    });

    await expect(listActiveMicrosoftWorkflowConnections()).resolves.toEqual([
      { value: 'connection-1', label: 'תיבת מכירות' },
    ]);
    expect(permissionMock).toHaveBeenCalledWith('integrations.read');
    expect(h.from).toHaveBeenCalledWith('integration_connections');
    expect(h.select).toHaveBeenCalledWith('id, label');
    expect(h.eqProvider).toHaveBeenCalledWith('provider', 'microsoft');
    expect(h.eqStatus).toHaveBeenCalledWith('status', 'active');
    expect(h.contains).toHaveBeenCalledWith('scopes', ['Mail.Send']);
  });

  it('never returns secrets, provider metadata, labels as values, or full rows', async () => {
    harness({
      data: [
        {
          id: 'connection-1',
          label: 'תיבת מכירות',
          vault_secret_id: 'must-not-leak',
          metadata: { tenant: 'must-not-leak' },
        },
      ],
      error: null,
    });

    const result = await listActiveMicrosoftWorkflowConnections();
    expect(result).toEqual([{ value: 'connection-1', label: 'תיבת מכירות' }]);
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(result[0]?.value).not.toBe(result[0]?.label);
  });

  it('throws instead of presenting a database failure as an empty list', async () => {
    harness({ data: null, error: { message: 'boom' } });

    await expect(listActiveMicrosoftWorkflowConnections()).rejects.toThrow(
      'טעינת חיבורי Microsoft הפעילים נכשלה',
    );
  });
});

function adminHarness(result: { data: unknown[] | null; error: unknown }) {
  const order = vi.fn(async () => result);
  const eqProvider = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq: eqProvider }));
  const from = vi.fn(() => ({ select }));
  adminMock.mockReturnValue({ from });

  return { from, select, eqProvider, order };
}

describe('listMicrosoftWorkflowConnectionsForAdmin', () => {
  it('requires integrations.read and reads Microsoft rows only', async () => {
    const h = adminHarness({ data: [], error: null });

    await listMicrosoftWorkflowConnectionsForAdmin();

    expect(permissionMock).toHaveBeenCalledWith('integrations.read');
    expect(h.from).toHaveBeenCalledWith('integration_connections');
    expect(h.select).toHaveBeenCalledWith('label, status, created_at, updated_at, scopes');
    expect(h.eqProvider).toHaveBeenCalledWith('provider', 'microsoft');
  });

  it('returns only safe status metadata and reduces Mail.Send to a boolean', async () => {
    adminHarness({
      data: [
        {
          id: 'must-not-leak',
          label: 'תיבת מכירות',
          status: 'active',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T11:00:00.000Z',
          scopes: ['openid', 'Mail.Send'],
          vault_secret_id: 'vault-must-not-leak',
          metadata: { tenant: 'metadata-must-not-leak' },
          refresh_token: 'token-must-not-leak',
        },
      ],
      error: null,
    });

    const result = await listMicrosoftWorkflowConnectionsForAdmin();

    expect(result).toEqual([
      {
        label: 'תיבת מכירות',
        status: 'active',
        createdAt: '2026-09-16T10:00:00.000Z',
        updatedAt: '2026-09-16T11:00:00.000Z',
        mailSendReady: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|Mail\.Send|openid/);
  });

  it('does not mark disabled or insufficient-scope connections as ready', async () => {
    adminHarness({
      data: [
        {
          label: 'חיבור כבוי',
          status: 'disabled',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T11:00:00.000Z',
          scopes: ['Mail.Send'],
        },
        {
          label: 'ללא הרשאת דואר',
          status: 'active',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T11:00:00.000Z',
          scopes: ['openid'],
        },
      ],
      error: null,
    });

    await expect(listMicrosoftWorkflowConnectionsForAdmin()).resolves.toEqual([
      expect.objectContaining({ label: 'חיבור כבוי', mailSendReady: false }),
      expect.objectContaining({ label: 'ללא הרשאת דואר', mailSendReady: false }),
    ]);
  });
});
