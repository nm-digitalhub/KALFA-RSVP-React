import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// vi.mock is hoisted above everything, so what its factory uses is created with vi.hoisted
const { queries, FakeQueryError } = vi.hoisted(() => {
  class FakeQueryError extends Error {
    constructor(readonly operation: string) {
      super(`rdp-access: ${operation} failed`);
    }
  }
  return {
    FakeQueryError,
    queries: {
      listGatewayAllows: vi.fn(),
      listGrantsByIds: vi.fn(),
      listRdpRequestExtras: vi.fn(),
      listRequestsByIds: vi.fn(),
      listTunnelTraces: vi.fn(),
    },
  };
});
vi.mock('./queries', () => ({
  RdpQueryError: FakeQueryError,
  listGatewayAllows: (...a: unknown[]) => queries.listGatewayAllows(...a),
  listGrantsByIds: (...a: unknown[]) => queries.listGrantsByIds(...a),
  listRdpRequestExtras: (...a: unknown[]) => queries.listRdpRequestExtras(...a),
  listRequestsByIds: (...a: unknown[]) => queries.listRequestsByIds(...a),
  listTunnelTraces: (...a: unknown[]) => queries.listTunnelTraces(...a),
}));

import { classifyConnection, cutStateOf, loadConnections, permissionOf } from './connections';

const NOW = new Date('2026-10-07T00:30:00.000Z');
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '55555555-5555-4555-8555-555555555555';
const R1 = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const admin = {} as never;

const tunnel = (id: string, connectedOn = '2026-10-07T00:10:00.000Z') => ({
  tunnelId: id, user: 'desktopuser', clientIp: '198.51.100.20', target: 'desktop.example.test:3389', connectedOn,
});
const trace = (tunnelId: string, grantId = G1, requestId: string | null = R1) => ({ tunnelId, grantId, requestId, at: '2026-10-07T00:10:00.000Z' });
const grant = (over: Record<string, unknown> = {}) => ({
  id: G1, request_id: R1, user_id: USER, status: 'active', target: 'desktop.example.test:3389', starts_at: '2026-10-07T00:00:00.000Z',
  expires_at: '2026-10-07T01:00:00.000Z', ended_at: null, ended_reason: null, files_issued: 2, max_files: 20,
  tunnels_cut_at: null, cut_attempts: 0, last_cut_error: null, ...over,
});
const gatewayOk = (...tunnels: ReturnType<typeof tunnel>[]) => async () => ({ ok: true as const, value: { tunnels } });

describe('permissionOf', () => {
  it('maps the grant status, treating an active grant past its end as expired', () => {
    expect(permissionOf(grant(), NOW)).toBe('active');
    expect(permissionOf(grant({ expires_at: '2026-10-07T00:29:00.000Z' }), NOW)).toBe('expired');
    expect(permissionOf(grant({ status: 'expired' }), NOW)).toBe('expired');
    expect(permissionOf(grant({ status: 'revoked' }), NOW)).toBe('revoked');
    expect(permissionOf(grant({ status: 'ended' }), NOW)).toBe('ended');
    expect(permissionOf(grant({ status: 'something_new' }), NOW)).toBe('unknown');
  });
});

describe('classifyConnection', () => {
  it('attributes a tunnel recorded under exactly one permission, with that permission\'s facts', () => {
    expect(classifyConnection(tunnel(T1), [trace(T1)], grant(), NOW)).toMatchObject({
      attribution: 'attributed', grantId: G1, requestId: R1, permission: 'active',
      grantStartsAt: '2026-10-07T00:00:00.000Z', grantExpiresAt: '2026-10-07T01:00:00.000Z',
    });
    expect(classifyConnection(tunnel(T1), [trace(T1)], grant({ status: 'revoked', ended_at: '2026-10-07T00:20:00.000Z' }), NOW)).toMatchObject({
      permission: 'revoked', grantEndedAt: '2026-10-07T00:20:00.000Z',
    });
  });

  it('counts the same permission recorded twice as one', () => {
    expect(classifyConnection(tunnel(T1), [trace(T1), trace(T1)], grant(), NOW).attribution).toBe('attributed');
  });

  it('reports no attribution when nothing is recorded, and never borrows one from a permission that happens to be active', () => {
    for (const traces of [undefined, []]) {
      expect(classifyConnection(tunnel(T1), traces, grant(), NOW)).toMatchObject({ attribution: 'none', grantId: null, permission: null });
    }
  });

  it('is ambiguous when the records disagree or point at a permission that cannot be found', () => {
    expect(classifyConnection(tunnel(T1), [trace(T1, G1), trace(T1, G2)], grant(), NOW)).toMatchObject({ attribution: 'ambiguous', grantId: null, permission: null });
    expect(classifyConnection(tunnel(T1), [trace(T1)], undefined, NOW).attribution).toBe('ambiguous');
  });

  it('keeps the gateway\'s own facts about the connection', () => {
    expect(classifyConnection(tunnel(T2, '2026-10-07T00:05:00.000Z'), [], undefined, NOW)).toMatchObject({
      tunnelId: T2, gatewayUser: 'desktopuser', clientIp: '198.51.100.20', target: 'desktop.example.test:3389', connectedOn: '2026-10-07T00:05:00.000Z',
    });
  });
});

describe('cutStateOf', () => {
  const ended = { status: 'revoked', tunnels_cut_at: null, cut_attempts: 0, last_cut_error: null };
  it('tells where the disconnect of an ended permission stands, from the grant row only', () => {
    expect(cutStateOf({ ...ended, status: 'active' })).toBe('not_needed');
    expect(cutStateOf(ended)).toBe('not_attempted');
    expect(cutStateOf({ ...ended, cut_attempts: 1, last_cut_error: 'ok' })).toBe('pending');
    expect(cutStateOf({ ...ended, cut_attempts: 1, last_cut_error: null })).toBe('pending');
    expect(cutStateOf({ ...ended, cut_attempts: 2, last_cut_error: 'timeout' })).toBe('failed');
    expect(cutStateOf({ ...ended, cut_attempts: 2, tunnels_cut_at: '2026-10-07T00:20:00.000Z' })).toBe('confirmed');
  });
});

describe('loadConnections', () => {
  function stub(grantRow = grant()) {
    for (const fn of Object.values(queries)) fn.mockReset();
    queries.listTunnelTraces.mockResolvedValue(new Map([[T1, [trace(T1)]]]));
    queries.listGrantsByIds.mockResolvedValue(new Map([[G1, grantRow]]));
    queries.listRequestsByIds.mockResolvedValue(
      new Map([[R1, { id: R1, status: 'approved', reason: 'החלפת מפתח', requested_minutes: 60, granted_minutes: 5, requester_id: USER, created_at: 'x', expires_at: 'x', answered_at: 'x' }]]),
    );
    queries.listRdpRequestExtras.mockResolvedValue(new Map([[R1, { requestIp: '203.0.113.7', answerNote: null, answeredBy: OWNER }]]));
    queries.listGatewayAllows.mockResolvedValue(new Map([[G1, ['2026-10-07T00:10:00.000Z', '2026-10-07T00:15:00.000Z']]]));
  }

  it('says the connections are unknown, not none, when the gateway could not be asked, and reads nothing', async () => {
    stub();
    expect(await loadConnections(admin, async () => ({ ok: false, kind: 'unreachable' }), NOW)).toEqual({ gateway: 'failed' });
    expect(queries.listTunnelTraces).not.toHaveBeenCalled();
  });

  it('returns a successful empty list without a single database read', async () => {
    stub();
    expect(await loadConnections(admin, gatewayOk(), NOW)).toEqual({ gateway: 'ok', attribution: 'ok', connections: [] });
    expect(queries.listTunnelTraces).not.toHaveBeenCalled();
  });

  it('ties a connection to its request, approver, both addresses and the permission window', async () => {
    stub();
    const result = await loadConnections(admin, gatewayOk(tunnel(T2, '2026-10-07T00:20:00.000Z'), tunnel(T1)), NOW);
    if (result.gateway !== 'ok') throw new Error('expected the gateway to answer');
    expect(result.attribution).toBe('ok');
    expect(result.connections.map((c) => c.tunnelId)).toEqual([T1, T2]); // oldest first
    expect(result.connections[0]).toMatchObject({
      attribution: 'attributed', permission: 'active', grantId: G1, requestId: R1, reason: 'החלפת מפתח', requesterId: USER, approverId: OWNER,
      clientIp: '198.51.100.20', requestIp: '203.0.113.7', requestedMinutes: 60, grantedMinutes: 5, tunnelsOpened: 2, cut: 'not_needed', filesIssued: 2, maxFiles: 20,
    });
    // no allowed check is recorded for the second tunnel: nothing is borrowed from the one that has it
    expect(result.connections[1]).toMatchObject({ attribution: 'none', grantId: null, reason: null, approverId: null, requestIp: null, tunnelsOpened: 0, cut: null });
    expect(queries.listTunnelTraces).toHaveBeenCalledWith(admin, [T1, T2]);
  });

  it('shows an open connection under a revoked permission with how its disconnect stands', async () => {
    stub(grant({ status: 'revoked', ended_at: '2026-10-07T00:20:00.000Z', cut_attempts: 3, last_cut_error: 'timeout' }));
    const result = await loadConnections(admin, gatewayOk(tunnel(T1)), NOW);
    if (result.gateway !== 'ok') throw new Error('expected the gateway to answer');
    expect(result.connections[0]).toMatchObject({ attribution: 'attributed', permission: 'revoked', cut: 'failed', cutError: 'timeout', grantEndedAt: '2026-10-07T00:20:00.000Z' });
  });

  it('shows an open connection under an expired permission', async () => {
    stub(grant({ status: 'expired', ended_at: '2026-10-07T00:25:00.000Z' }));
    const result = await loadConnections(admin, gatewayOk(tunnel(T1)), NOW);
    if (result.gateway !== 'ok') throw new Error('expected the gateway to answer');
    expect(result.connections[0]).toMatchObject({ attribution: 'attributed', permission: 'expired' });
  });

  it('does not list an allowed check whose tunnel the gateway no longer holds', async () => {
    stub();
    queries.listTunnelTraces.mockResolvedValue(new Map([[T1, [trace(T1)]], ['gone-tunnel', [trace('gone-tunnel')]]]));
    const result = await loadConnections(admin, gatewayOk(tunnel(T1)), NOW);
    if (result.gateway !== 'ok') throw new Error('expected the gateway to answer');
    expect(result.connections.map((c) => c.tunnelId)).toEqual([T1]);
  });

  it('keeps the connections and marks their permissions unavailable when the database fails but the gateway answers', async () => {
    stub();
    queries.listTunnelTraces.mockRejectedValue(new FakeQueryError('list_tunnel_traces'));
    const result = await loadConnections(admin, gatewayOk(tunnel(T1), tunnel(T2)), NOW);
    if (result.gateway !== 'ok') throw new Error('expected the gateway to answer');
    expect(result.attribution).toBe('failed');
    expect(result.connections).toHaveLength(2);
    for (const connection of result.connections) {
      expect(connection).toMatchObject({ attribution: 'unavailable', permission: null, grantId: null, clientIp: '198.51.100.20' });
    }
  });

  it('does not swallow an error that is not a database error', async () => {
    stub();
    queries.listTunnelTraces.mockRejectedValue(new TypeError('a bug'));
    await expect(loadConnections(admin, gatewayOk(tunnel(T1)), NOW)).rejects.toThrow('a bug');
  });

  it('is ambiguous, not "none", when a tunnel is recorded under two permissions', async () => {
    stub();
    queries.listTunnelTraces.mockResolvedValue(new Map([[T1, [trace(T1, G1), trace(T1, G2)]]]));
    const result = await loadConnections(admin, gatewayOk(tunnel(T1)), NOW);
    if (result.gateway !== 'ok') throw new Error('expected the gateway to answer');
    expect(result.connections[0]).toMatchObject({ attribution: 'ambiguous', grantId: null, permission: null });
  });
});
