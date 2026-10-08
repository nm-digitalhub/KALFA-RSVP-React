import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const requirePlatformOwner = vi.fn();
vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: (...args: unknown[]) => requirePlatformOwner(...args) }));
const createAdminClient = vi.fn(() => ({ admin: true }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createAdminClient() }));

const queries = {
  countPendingRdpRequests: vi.fn(),
  getActiveRdpGrant: vi.fn(),
  getRdpRequestDetail: vi.fn(),
  getRdpRequestOwnerExtras: vi.fn(),
  listFirstGatewayAllows: vi.fn(),
  listRdpRequestsPage: vi.fn(),
  nameMap: vi.fn(),
};
vi.mock('@/lib/rdp-access/queries', () => ({
  countPendingRdpRequests: (...a: unknown[]) => queries.countPendingRdpRequests(...a),
  getActiveRdpGrant: (...a: unknown[]) => queries.getActiveRdpGrant(...a),
  getRdpRequestDetail: (...a: unknown[]) => queries.getRdpRequestDetail(...a),
  getRdpRequestOwnerExtras: (...a: unknown[]) => queries.getRdpRequestOwnerExtras(...a),
  listFirstGatewayAllows: (...a: unknown[]) => queries.listFirstGatewayAllows(...a),
  listRdpRequestsPage: (...a: unknown[]) => queries.listRdpRequestsPage(...a),
  nameMap: (...a: unknown[]) => queries.nameMap(...a),
}));

import {
  RDP_OWNER_PAGE_SIZE,
  getRdpAccessOverview,
  getRdpAccessRequestDetail,
  listRdpAccessRequests,
} from './rdp-access-owner';

const REQUEST = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  for (const fn of [requirePlatformOwner, ...Object.values(queries)]) fn.mockReset();
  createAdminClient.mockClear();
  requirePlatformOwner.mockResolvedValue({ id: 'owner' });
  queries.nameMap.mockResolvedValue(new Map([[USER, 'יוסי כהן']]));
  queries.listFirstGatewayAllows.mockResolvedValue(new Map());
});

describe('the owner module gates every export on requirePlatformOwner, before any read', () => {
  it('refuses all three entry points when the gate throws', async () => {
    requirePlatformOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(getRdpAccessOverview()).rejects.toThrow('NEXT_REDIRECT');
    await expect(listRdpAccessRequests({ filter: 'all', page: 1 })).rejects.toThrow('NEXT_REDIRECT');
    await expect(getRdpAccessRequestDetail(REQUEST)).rejects.toThrow('NEXT_REDIRECT');
    expect(createAdminClient).not.toHaveBeenCalled();
    for (const fn of Object.values(queries)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('getRdpAccessOverview', () => {
  it('counts the pending requests and names the person behind the live grant', async () => {
    queries.countPendingRdpRequests.mockResolvedValue(2);
    queries.getActiveRdpGrant.mockResolvedValue({ expires_at: '2026-10-07T01:00:00.000Z', files_issued: 1, max_files: 20 });
    queries.listRdpRequestsPage.mockResolvedValue({ rows: [{ requester_id: USER }], total: 1 });
    const overview = await getRdpAccessOverview();
    expect(overview).toMatchObject({
      pendingCount: 2,
      active: { requesterName: 'יוסי כהן', expiresAt: '2026-10-07T01:00:00.000Z', filesIssued: 1, maxFiles: 20 },
    });
  });

  it('has no active entry without a live grant, and does not look one up', async () => {
    queries.countPendingRdpRequests.mockResolvedValue(0);
    queries.getActiveRdpGrant.mockResolvedValue(null);
    expect((await getRdpAccessOverview()).active).toBeNull();
    expect(queries.listRdpRequestsPage).not.toHaveBeenCalled();
  });
});

describe('listRdpAccessRequests', () => {
  it('pages in the database and derives each row\'s display status from its grant', async () => {
    const base = { reason: 'החלפת מפתח', requested_minutes: 60, granted_minutes: null, requester_id: USER, created_at: '2026-10-06T23:56:00.000Z' };
    queries.listRdpRequestsPage.mockResolvedValue({
      total: 3,
      rows: [
        { ...base, id: 'a', status: 'pending', grant: null },
        { ...base, id: 'b', status: 'approved', granted_minutes: 5, grant: { id: 'gb', status: 'active', expires_at: '2999-01-01T00:00:00.000Z', files_issued: 4, max_files: 20 } },
        { ...base, id: 'c', status: 'approved', granted_minutes: 5, grant: { id: 'gc', status: 'revoked', expires_at: '2999-01-01T00:00:00.000Z', files_issued: 1, max_files: 20 } },
      ],
    });
    queries.listFirstGatewayAllows.mockResolvedValue(new Map([['gb', '2026-10-07T00:00:09.000Z']]));
    const result = await listRdpAccessRequests({ filter: 'all', page: 2 });
    expect(queries.listRdpRequestsPage).toHaveBeenCalledWith({ admin: true }, expect.objectContaining({ filter: 'all', page: 2, pageSize: RDP_OWNER_PAGE_SIZE }));
    expect(result.total).toBe(3);
    expect(result.items.map((i) => [i.id, i.status, i.filesIssued, i.requesterName])).toEqual([
      ['a', 'pending', 0, 'יוסי כהן'],
      ['b', 'active', 4, 'יוסי כהן'],
      ['c', 'ended', 1, 'יוסי כהן'],
    ]);
    // the connection comes from the gateway's own trace, one batch query for the grants on the page
    expect(queries.listFirstGatewayAllows).toHaveBeenCalledWith({ admin: true }, ['gb', 'gc']);
    expect(result.items.map((i) => i.connectedAt)).toEqual([null, '2026-10-07T00:00:09.000Z', null]);
  });
});

describe('getRdpAccessRequestDetail', () => {
  it('returns null for an unknown request', async () => {
    queries.getRdpRequestDetail.mockResolvedValue(null);
    expect(await getRdpAccessRequestDetail(REQUEST)).toBeNull();
  });

  it('builds the view field by field: no approver context, no cut error text, no raw event detail', async () => {
    queries.getRdpRequestDetail.mockResolvedValue({
      request: {
        id: REQUEST, status: 'approved', reason: 'החלפת מפתח', requested_minutes: 60, granted_minutes: 5, requester_id: USER,
        created_at: '2026-10-06T23:56:00.000Z', expires_at: '2026-10-07T00:26:00.000Z', answered_at: '2026-10-07T00:00:07.000Z',
        approver_context: { os_user: 'secret' }, answered_by: 'x',
      },
      grant: {
        id: 'g', status: 'revoked', target: 'desktop.example.test:3389', starts_at: '2026-10-07T00:00:07.000Z', expires_at: '2026-10-07T00:05:07.000Z',
        ended_at: '2026-10-07T00:00:12.000Z', ended_reason: 'revoked_by_owner', files_issued: 1, max_files: 20, tunnels_cut_at: '2026-10-07T00:06:19.000Z', cut_attempts: 2, last_cut_error: 'timeout',
      },
      events: [
        { at: '2026-10-07T00:00:07.000Z', kind: 'approved', actor_kind: 'owner_cli', outcome: null, detail: { secret: 1 } },
        { at: '2026-10-07T00:00:09.000Z', kind: 'tunnel_check', actor_kind: 'gateway', outcome: 'allow' },
      ],
    });
    queries.getRdpRequestOwnerExtras.mockResolvedValue({ requestIp: '203.0.113.7', answerNote: 'בדיקת שער' });

    const detail = await getRdpAccessRequestDetail(REQUEST);
    expect(detail).toMatchObject({
      id: REQUEST,
      status: 'ended',
      requesterName: 'יוסי כהן',
      requestIp: '203.0.113.7',
      answerNote: 'בדיקת שער',
      grantedMinutes: 5,
      grant: { target: 'desktop.example.test:3389', filesIssued: 1, maxFiles: 20, tunnelsCutAt: '2026-10-07T00:06:19.000Z', cutAttempts: 2, endedReason: 'revoked_by_owner' },
      connectedAt: '2026-10-07T00:00:09.000Z',
      events: [
        { at: '2026-10-07T00:00:07.000Z', kind: 'approved', actorKind: 'owner_cli', outcome: null },
        { at: '2026-10-07T00:00:09.000Z', kind: 'tunnel_check', actorKind: 'gateway', outcome: 'allow' },
      ],
    });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('os_user');
    expect(serialized).not.toContain('last_cut_error');
    expect(serialized).not.toContain('secret');
  });
});
