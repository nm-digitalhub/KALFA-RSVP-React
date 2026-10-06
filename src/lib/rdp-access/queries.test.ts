import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  countRdpRequestsSince,
  getRdpGrantRequestId,
  getRdpRequestOwnerExtras,
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
    expect(await getRdpRequestOwnerExtras(fakeAdmin([{ data: [{ id: 'r', request_ip: '203.0.113.7', answer_note: 'בדיקת שער' }] }]).admin, 'r')).toEqual({
      requestIp: '203.0.113.7',
      answerNote: 'בדיקת שער',
    });
    expect(await getRdpRequestOwnerExtras(fakeAdmin([{ data: [{ id: 'r', request_ip: null, answer_note: null }] }]).admin, 'r')).toEqual({
      requestIp: null,
      answerNote: null,
    });
    expect(await getRdpRequestOwnerExtras(fakeAdmin([{ data: [] }]).admin, 'r')).toEqual({ requestIp: null, answerNote: null });
  });
});

describe('listRdpRequestExtras', () => {
  it('reads every requested row in one query and keys them by id', async () => {
    const { admin, calls } = fakeAdmin([
      { data: [{ id: 'a', request_ip: '203.0.113.7', answer_note: null }, { id: 'b', request_ip: 42, answer_note: 'x' }] },
    ]);
    const extras = await listRdpRequestExtras(admin, ['a', 'b']);
    expect(calls.filter((c) => c.method === 'in')).toEqual([{ table: 'rdp_access_requests', method: 'in', args: ['id', ['a', 'b']] }]);
    expect(extras.get('a')).toEqual({ requestIp: '203.0.113.7', answerNote: null });
    expect(extras.get('b')).toEqual({ requestIp: null, answerNote: 'x' });
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
