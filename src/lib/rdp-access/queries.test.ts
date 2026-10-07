import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  countRdpRequestsSince,
  getRdpGrantRequestId,
  getRdpRequestOwnerExtras,
  listFirstGatewayAllows,
  listGatewayAllows,
  listGrantsByIds,
  listRequestsByIds,
  listTunnelTraces,
  listRdpRequestExtras,
  listRecentRdpEvents,
  listRdpRequestsPage,
} from './queries';

type Call = { table: string; method: string; args: unknown[] };

// A chainable stand-in for the PostgREST builder. Every method records itself and returns the chain; awaiting the
// chain resolves with the next queued result, which is how the real builder behaves (it is a thenable).
function fakeAdmin(results: Array<{ data: unknown; error?: unknown; count?: number | null }>) {
  const calls: Call[] = [];
  const queue = [...results];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'eq', 'neq', 'gt', 'gte', 'in', 'range', 'limit']) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => void) => {
      const next = queue.shift() ?? { data: [], error: null };
      resolve({ error: null, count: null, ...next });
    };
    return chain;
  };
  return { admin: { from } as never, calls };
}

const NOW = new Date('2026-10-07T00:00:00.000Z');
const NIL = '00000000-0000-0000-0000-000000000000';
const REQ = (id: string) => ({ id, status: 'pending', requester_id: null });

describe('listRdpRequestsPage', () => {
  it('filters pending in the database, pages with a range and attaches each request\'s grant', async () => {
    const { admin, calls } = fakeAdmin([
      { data: [REQ('a'), REQ('b')], count: 7 },
      { data: [{ request_id: 'b', id: 'g', status: 'active', files_issued: 2, max_files: 20, expires_at: 'x', ended_at: null, ended_reason: null }] },
    ]);
    const { rows, total } = await listRdpRequestsPage(admin, { filter: 'pending', page: 3, pageSize: 25, now: NOW });
    expect(total).toBe(7);
    expect(calls).toContainEqual({ table: 'rdp_access_requests', method: 'eq', args: ['status', 'pending'] });
    expect(calls).toContainEqual({ table: 'rdp_access_requests', method: 'range', args: [50, 74] });
    expect(calls).toContainEqual({ table: 'rdp_access_grants', method: 'in', args: ['request_id', ['a', 'b']] });
    expect(rows[0]).toMatchObject({ id: 'a', grant: null });
    expect(rows[1]).toMatchObject({ id: 'b', grant: { id: 'g', files_issued: 2 } });
    expect(rows[1]!.grant).not.toHaveProperty('request_id');
  });

  it('active matches the live grant\'s request, or nothing at all when there is no live grant', async () => {
    const live = fakeAdmin([{ data: [{ id: 'g', request_id: 'r1' }] }, { data: [REQ('r1')], count: 1 }, { data: [] }]);
    await listRdpRequestsPage(live.admin, { filter: 'active', page: 1, pageSize: 25, now: NOW });
    expect(live.calls).toContainEqual({ table: 'rdp_access_requests', method: 'eq', args: ['id', 'r1'] });

    const none = fakeAdmin([{ data: [] }, { data: [], count: 0 }]);
    await listRdpRequestsPage(none.admin, { filter: 'active', page: 1, pageSize: 25, now: NOW });
    expect(none.calls).toContainEqual({ table: 'rdp_access_requests', method: 'eq', args: ['id', NIL] });
  });

  it('finished is everything answered except the request behind the live grant', async () => {
    const { admin, calls } = fakeAdmin([{ data: [{ id: 'g', request_id: 'r1' }] }, { data: [REQ('r0')], count: 1 }, { data: [] }]);
    await listRdpRequestsPage(admin, { filter: 'finished', page: 1, pageSize: 25, now: NOW });
    expect(calls).toContainEqual({ table: 'rdp_access_requests', method: 'neq', args: ['status', 'pending'] });
    expect(calls).toContainEqual({ table: 'rdp_access_requests', method: 'neq', args: ['id', 'r1'] });
  });

  it('all and pending never look up the live grant, and a database error carries the operation name only', async () => {
    const all = fakeAdmin([{ data: [], count: 0 }]);
    await listRdpRequestsPage(all.admin, { filter: 'all', page: 1, pageSize: 25, now: NOW });
    expect(all.calls.some((c) => c.table === 'rdp_access_grants')).toBe(false);

    const broken = fakeAdmin([{ data: null, error: { message: 'relation "x" does not exist' } }]);
    await expect(listRdpRequestsPage(broken.admin, { filter: 'all', page: 1, pageSize: 25, now: NOW })).rejects.toThrow(
      'rdp-access: list_requests_page failed',
    );
  });
});

describe('getRdpGrantRequestId and getRdpRequestOwnerExtras', () => {
  it('reads the request id of a grant, or null', async () => {
    expect(await getRdpGrantRequestId(fakeAdmin([{ data: [{ request_id: 'r1' }] }]).admin, 'g')).toBe('r1');
    expect(await getRdpGrantRequestId(fakeAdmin([{ data: [] }]).admin, 'g')).toBeNull();
  });

  it('returns the address and the note, treating a non-text inet value as unknown', async () => {
    expect(await getRdpRequestOwnerExtras(fakeAdmin([{ data: [{ id: 'r', request_ip: '203.0.113.7', answer_note: 'בדיקת שער', answered_by: 'owner-1' }] }]).admin, 'r')).toEqual({
      requestIp: '203.0.113.7',
      answerNote: 'בדיקת שער',
      answeredBy: 'owner-1',
    });
    expect(await getRdpRequestOwnerExtras(fakeAdmin([{ data: [{ id: 'r', request_ip: null, answer_note: null, answered_by: null }] }]).admin, 'r')).toEqual({
      requestIp: null,
      answerNote: null,
      answeredBy: null,
    });
    expect(await getRdpRequestOwnerExtras(fakeAdmin([{ data: [] }]).admin, 'r')).toEqual({ requestIp: null, answerNote: null, answeredBy: null });
  });
});

describe('listRdpRequestExtras', () => {
  it('reads every requested row in one query and keys them by id', async () => {
    const { admin, calls } = fakeAdmin([
      { data: [{ id: 'a', request_ip: '203.0.113.7', answer_note: null, answered_by: 'o' }, { id: 'b', request_ip: 42, answer_note: 'x', answered_by: null }] },
    ]);
    const extras = await listRdpRequestExtras(admin, ['a', 'b']);
    expect(calls.filter((c) => c.method === 'in')).toEqual([{ table: 'rdp_access_requests', method: 'in', args: ['id', ['a', 'b']] }]);
    expect(extras.get('a')).toEqual({ requestIp: '203.0.113.7', answerNote: null, answeredBy: 'o' });
    expect(extras.get('b')).toEqual({ requestIp: null, answerNote: 'x', answeredBy: null });
  });

  it('does not query at all for an empty list', async () => {
    const { admin, calls } = fakeAdmin([]);
    expect((await listRdpRequestExtras(admin, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('listRecentRdpEvents', () => {
  it('asks for the newest events and keeps only the safe columns', async () => {
    const { admin, calls } = fakeAdmin([
      { data: [{ at: 't', kind: 'approved', actor_kind: 'owner_cli', request_id: 'r', outcome: null, detail: { secret: 1 }, client_ip: '1.2.3.4' }] },
    ]);
    const events = await listRecentRdpEvents(admin, { limit: 6 });
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'select', args: ['at, kind, actor_kind, request_id, outcome'] });
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'order', args: ['at', { ascending: false }] });
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'limit', args: [6] });
    expect(events).toEqual([{ at: 't', kind: 'approved', actorKind: 'owner_cli', requestId: 'r', outcome: null }]);
  });
});

describe('countRdpRequestsSince', () => {
  it('counts by status from a given instant, and treats a missing count as zero', async () => {
    const since = new Date('2026-10-06T00:00:00.000Z');
    const { admin, calls } = fakeAdmin([{ data: null, count: 3 }]);
    expect(await countRdpRequestsSince(admin, { status: 'expired', since })).toBe(3);
    expect(calls).toContainEqual({ table: 'rdp_access_requests', method: 'eq', args: ['status', 'expired'] });
    expect(calls).toContainEqual({ table: 'rdp_access_requests', method: 'gte', args: ['created_at', since.toISOString()] });
    expect(await countRdpRequestsSince(fakeAdmin([{ data: null, count: null }]).admin, { status: 'expired', since })).toBe(0);
  });
});

describe('listFirstGatewayAllows', () => {
  it('asks once for the allowed gateway checks of the grants, oldest first, and keeps the first per grant', async () => {
    const { admin, calls } = fakeAdmin([
      { data: [{ grant_id: 'g1', at: 't1' }, { grant_id: 'g2', at: 't2' }, { grant_id: 'g1', at: 't3' }, { grant_id: null, at: 't0' }] },
    ]);
    const first = await listFirstGatewayAllows(admin, ['g1', 'g2', 'g3']);
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'eq', args: ['kind', 'tunnel_check'] });
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'eq', args: ['outcome', 'allow'] });
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'in', args: ['grant_id', ['g1', 'g2', 'g3']] });
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'order', args: ['at', { ascending: true }] });
    expect([...first]).toEqual([['g1', 't1'], ['g2', 't2']]);
  });

  it('does not query for no grants, and a database error names the operation only', async () => {
    const none = fakeAdmin([]);
    expect((await listFirstGatewayAllows(none.admin, [])).size).toBe(0);
    expect(none.calls).toHaveLength(0);
    await expect(listFirstGatewayAllows(fakeAdmin([{ data: null, error: { message: 'boom: secret' } }]).admin, ['g'])).rejects.toThrow(
      'rdp-access: list_gateway_allows failed',
    );
  });
});

describe('listTunnelTraces', () => {
  it('returns every allowed check of each tunnel, oldest first, so a tunnel under two grants stays visible', async () => {
    const { admin, calls } = fakeAdmin([
      {
        data: [
          { tunnel_ref: 't1', grant_id: 'g1', request_id: 'r1', at: 'a' },
          { tunnel_ref: 't1', grant_id: 'g2', request_id: 'r2', at: 'b' },
          { tunnel_ref: 't2', grant_id: 'g1', request_id: null, at: 'c' },
          { tunnel_ref: null, grant_id: 'g1', request_id: 'r1', at: 'd' },
          { tunnel_ref: 't3', grant_id: null, request_id: null, at: 'e' },
        ],
      },
    ]);
    const traces = await listTunnelTraces(admin, ['t1', 't2', 't3']);
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'eq', args: ['kind', 'tunnel_check'] });
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'eq', args: ['outcome', 'allow'] });
    expect(calls).toContainEqual({ table: 'rdp_access_events', method: 'in', args: ['tunnel_ref', ['t1', 't2', 't3']] });
    expect(traces.get('t1')!.map((t) => t.grantId)).toEqual(['g1', 'g2']);
    expect(traces.get('t2')).toEqual([{ tunnelId: 't2', grantId: 'g1', requestId: null, at: 'c' }]);
    expect(traces.has('t3')).toBe(false); // an allowed check with no grant on it is no attribution
  });

  it('does not query for no tunnels, and a database error names the operation only', async () => {
    const none = fakeAdmin([]);
    expect((await listTunnelTraces(none.admin, [])).size).toBe(0);
    expect(none.calls).toHaveLength(0);
    await expect(listTunnelTraces(fakeAdmin([{ data: null, error: { message: 'boom: secret' } }]).admin, ['t'])).rejects.toThrow('rdp-access: list_tunnel_traces failed');
  });
});

describe('listGatewayAllows', () => {
  it('groups the allowed checks by grant, oldest first', async () => {
    const { admin } = fakeAdmin([{ data: [{ grant_id: 'g1', at: 'a' }, { grant_id: 'g2', at: 'b' }, { grant_id: 'g1', at: 'c' }, { grant_id: null, at: 'd' }] }]);
    expect([...(await listGatewayAllows(admin, ['g1', 'g2']))]).toEqual([['g1', ['a', 'c']], ['g2', ['b']]]);
  });
});

describe('listGrantsByIds / listRequestsByIds', () => {
  it('reads the rows by id in one query each and keys them, and skips the query for no ids', async () => {
    const grants = fakeAdmin([{ data: [{ id: 'g1', status: 'active' }, { id: 'g2', status: 'revoked' }] }]);
    const byId = await listGrantsByIds(grants.admin, ['g1', 'g2']);
    expect(grants.calls).toContainEqual({ table: 'rdp_access_grants', method: 'in', args: ['id', ['g1', 'g2']] });
    expect([...byId.keys()]).toEqual(['g1', 'g2']);

    const requests = fakeAdmin([{ data: [{ id: 'r1' }] }]);
    expect([...(await listRequestsByIds(requests.admin, ['r1'])).keys()]).toEqual(['r1']);
    expect(requests.calls).toContainEqual({ table: 'rdp_access_requests', method: 'in', args: ['id', ['r1']] });

    const none = fakeAdmin([]);
    expect((await listGrantsByIds(none.admin, [])).size).toBe(0);
    expect((await listRequestsByIds(none.admin, [])).size).toBe(0);
    expect(none.calls).toHaveLength(0);
  });
});
