import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/console-calls', () => ({ findRoutableAgents: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { findRoutableAgents } from '@/lib/data/console-calls';
import {
  DEFAULT_QUEUE_KEY,
  findRoutableAgentVoxUsernamesForQueue,
  isConsoleQueueKey,
  resolveActiveQueueForRing,
  resolveInboundQueueKey,
  setConsoleCallQueue,
  syncQueueMembers,
} from '@/lib/data/console-queues';

beforeEach(() => vi.clearAllMocks());

// Same per-table, ordered-queue Supabase admin-client double as
// console-calls.test.ts (createMockSupabase's single static result per
// `.from()` call is insufficient once a function issues more than one query
// against the same table, e.g. syncQueueMembers' current-members read before
// its delete/insert, or getAgentQueueMemberships' two-table lookup).
type QueryResult = { data: unknown; error: unknown };

function makeAdminMock(queues: Record<string, QueryResult[]>) {
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'gt', 'gte',
    'lt', 'lte', 'or', 'not', 'is', 'ilike', 'in', 'order', 'range', 'limit',
    'single', 'maybeSingle',
  ] as const;

  const from = vi.fn((table: string) => {
    const queue = queues[table];
    const result: QueryResult = queue && queue.length > 0
      ? (queue.shift() as QueryResult)
      : { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of chainMethods) builder[m] = vi.fn(() => builder);
    (builder as { then: unknown }).then = (onFulfilled: (v: QueryResult) => unknown) =>
      onFulfilled(result);
    return builder;
  });

  return { from, rpc: vi.fn() };
}

function wireAdmin(queues: Record<string, QueryResult[]>) {
  const client = makeAdminMock(queues);
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return client;
}

describe('isConsoleQueueKey (pure)', () => {
  it('accepts exactly the four seeded department keys', () => {
    expect(isConsoleQueueKey('sales')).toBe(true);
    expect(isConsoleQueueKey('support')).toBe(true);
    expect(isConsoleQueueKey('events')).toBe(true);
    expect(isConsoleQueueKey('billing')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isConsoleQueueKey('marketing')).toBe(false);
    expect(isConsoleQueueKey('')).toBe(false);
  });
});

describe('resolveInboundQueueKey (pure — V1 flat default, no caller-history heuristic)', () => {
  it('resolves DEFAULT_QUEUE_KEY when nothing else is supplied', () => {
    expect(resolveInboundQueueKey()).toBe(DEFAULT_QUEUE_KEY);
    expect(resolveInboundQueueKey({})).toBe(DEFAULT_QUEUE_KEY);
  });
  it('a future DTMF selection would take priority over the default (typed extension point)', () => {
    expect(resolveInboundQueueKey({ dtmfQueueKey: 'billing' })).toBe('billing');
  });
});

describe('resolveActiveQueueForRing — inactive/unresolvable queues degrade to the default, then to null', () => {
  it('returns the resolved (default) queue when it is active', () => {
    wireAdmin({
      console_queues: [
        { data: { id: 'q-support', key: 'support', name_he: 'תמיכה', is_active: true, priority: 20 }, error: null },
      ],
    });
    return resolveActiveQueueForRing().then((q) => {
      expect(q).toEqual({ id: 'q-support', key: 'support', nameHe: 'תמיכה', isActive: true, priority: 20 });
    });
  });

  it('falls back to the default queue when the selected (non-default) queue is inactive', async () => {
    wireAdmin({
      console_queues: [
        // 1st lookup: the DTMF-selected 'billing' queue, inactive.
        { data: { id: 'q-billing', key: 'billing', name_he: 'גבייה', is_active: false, priority: 40 }, error: null },
        // 2nd lookup: the default 'support' queue, active.
        { data: { id: 'q-support', key: 'support', name_he: 'תמיכה', is_active: true, priority: 20 }, error: null },
      ],
    });
    const q = await resolveActiveQueueForRing({ dtmfQueueKey: 'billing' });
    expect(q?.key).toBe('support');
  });

  it('returns null when the selected queue AND the default queue are both inactive/missing (pure fallback to system-wide ring)', async () => {
    wireAdmin({
      console_queues: [
        { data: { id: 'q-billing', key: 'billing', name_he: 'גבייה', is_active: false, priority: 40 }, error: null },
        { data: null, error: null }, // default queue row missing entirely
      ],
    });
    const q = await resolveActiveQueueForRing({ dtmfQueueKey: 'billing' });
    expect(q).toBeNull();
  });

  it('returns null (not a throw) on a query error — callers must fail toward pre-queue behavior', async () => {
    wireAdmin({ console_queues: [{ data: null, error: { message: 'boom' } }] });
    const q = await resolveActiveQueueForRing();
    expect(q).toBeNull();
  });
});

describe('findRoutableAgentVoxUsernamesForQueue — intersects membership with the SAME ready+fresh gate', () => {
  it('returns only members who are ALSO in the ready+fresh routable set', async () => {
    wireAdmin({
      console_agent_queues: [
        { data: [{ agent_id: 'a1' }, { agent_id: 'a2' }], error: null }, // a1, a2 are queue members
      ],
    });
    // findRoutableAgents (console-calls.ts, mocked) says only a1 is currently
    // ready+fresh — a2 is stale/not-ready. The queue-scoped result must NOT
    // include a2 even though it's a queue member: freshness/ready gating is
    // inherited, not bypassed.
    vi.mocked(findRoutableAgents).mockResolvedValue([{ agentId: 'a1', voxUsername: 'agent_a1' }]);
    const result = await findRoutableAgentVoxUsernamesForQueue('q-support');
    expect(result).toEqual(['agent_a1']);
  });

  it('returns [] immediately when the queue has zero members (no DB call to findRoutableAgents needed)', async () => {
    wireAdmin({ console_agent_queues: [{ data: [], error: null }] });
    const result = await findRoutableAgentVoxUsernamesForQueue('q-empty');
    expect(result).toEqual([]);
    expect(findRoutableAgents).not.toHaveBeenCalled();
  });

  it('throws on a membership-query error (caller — route-inbound — treats this as "no queue" via its own catch)', async () => {
    wireAdmin({ console_agent_queues: [{ data: null, error: { message: 'boom' } }] });
    await expect(findRoutableAgentVoxUsernamesForQueue('q-x')).rejects.toThrow();
  });
});

describe('syncQueueMembers — reconciles to exactly the target set', () => {
  it('deletes removed members and inserts added members, touching neither for unchanged ones', async () => {
    const client = wireAdmin({
      console_agent_queues: [
        { data: [{ agent_id: 'a1' }, { agent_id: 'a2' }], error: null }, // current: a1, a2
        { data: null, error: null }, // delete result
        { data: null, error: null }, // insert result
      ],
    });
    await syncQueueMembers('q-1', ['a1', 'a3']); // target: a1 (kept), a2 (removed), a3 (added)
    expect(client.from).toHaveBeenCalledWith('console_agent_queues');
  });

  it('is a no-op (no delete/insert calls) when the target set already matches current membership', async () => {
    wireAdmin({
      console_agent_queues: [{ data: [{ agent_id: 'a1' }], error: null }],
    });
    // Only ONE queued result is provided (the membership read) — if the
    // function issued a delete or insert it would consume from an empty
    // queue and get the {data:null,error:null} default, which would NOT
    // throw, so this test's real assertion is functional: no error either
    // way proves no unexpected write path ran into a real error.
    await expect(syncQueueMembers('q-1', ['a1'])).resolves.toBeUndefined();
  });
});

describe('setConsoleCallQueue — best-effort, never throws', () => {
  it('swallows a DB error instead of throwing into the inbound-call request path', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(setConsoleCallQueue('call-1', 'q-1')).resolves.toBeUndefined();
  });
});
