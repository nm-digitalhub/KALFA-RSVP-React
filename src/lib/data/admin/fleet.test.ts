import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { readFile } from 'node:fs/promises';
import {
  answerFleetRequest,
  getFleetConversation,
  getFleetRequestRole,
  listFleetConversations,
  parseConversationCursor,
} from './fleet';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
// react.cache() is request-scoped in RSC; in tests it would memoize across
// cases, so make it a pass-through.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

const REQUEST_ID = '3f2c8a54-9b1d-4e6f-8a2b-7c5d9e0f1a2b';

function useClient<Row>(result: { data: Row | null; error: { message: string } | null }) {
  const mock = createMockSupabase<Row>(result);
  vi.mocked(createClient).mockResolvedValue(
    mock.client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin' } as unknown as User);
});

describe('answerFleetRequest — B1: the owner cannot answer a request they opened', () => {
  it('refuses an owner-origin request before calling the RPC', async () => {
    const { client } = useClient({
      data: { role: 'social-manager', title: 'בדיקה', payload: { origin: 'owner' } },
      error: null,
    });
    await expect(
      answerFleetRequest({ id: REQUEST_ID, verdict: 'answered', answer: 'כן' }),
    ).rejects.toThrow('לא ניתן להשיב לפנייה ששלחת');
    expect(client.rpc).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('refuses an unknown id without calling the RPC', async () => {
    const { client } = useClient({ data: null, error: null });
    await expect(
      answerFleetRequest({ id: REQUEST_ID, verdict: 'approved', answer: null }),
    ).rejects.toThrow('הפנייה לא נמצאה');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('answers an agent-filed request through the RPC and posts to Slack', async () => {
    const { client } = useClient({
      data: { role: 'ops-monitor', title: 'אישור פריסה', payload: {} },
      error: null,
    });
    await answerFleetRequest({ id: REQUEST_ID, verdict: 'approved', answer: null });
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
    expect(client.rpc).toHaveBeenCalledWith('fleet_answer_request', {
      p_id: REQUEST_ID,
      p_verdict: 'approved',
      p_answer: undefined,
    });
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'המענה נרשם (אושר): אישור פריסה', source: 'fleet:ops-monitor' }),
    );
  });

  it('maps an RPC race to a safe Hebrew message', async () => {
    const { client } = useClient({
      data: { role: 'ops-monitor', title: 'x', payload: {} },
      error: null,
    });
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'request is not pending' } });
    await expect(
      answerFleetRequest({ id: REQUEST_ID, verdict: 'approved', answer: null }),
    ).rejects.toThrow('הפנייה כבר נענתה או פגה');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

// A client whose every `.from()` returns its OWN builder, resolving the next
// queued result — getFleetConversation runs several distinct queries.
function useQueuedClient(results: { data: unknown; error: { message: string } | null }[]) {
  const builders: ReturnType<typeof createMockSupabase>['builder'][] = [];
  let i = 0;
  const client = {
    from: vi.fn(() => {
      const { builder } = createMockSupabase(results[i++] ?? { data: [], error: null });
      builders.push(builder);
      return builder;
    }),
    rpc: vi.fn(),
  };
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  return { client, builders };
}

const U = (n: number) => `3f2c8a54-9b1d-4e6f-8a2b-7c5d9e0f1a${String(n).padStart(2, '0')}`;

function convRow(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: U(n),
    role: 'ops-monitor',
    kind: 'question',
    tier: 0,
    title: `t${n}`,
    body: 'b',
    payload: {},
    status: 'consumed',
    answer: null,
    created_at: `2026-09-20T09:${String(n).padStart(2, '0')}:00.000Z`,
    answered_at: null,
    expires_at: '2026-09-23T09:00:00.000Z',
    consumed_at: null,
    ...overrides,
  };
}

describe('getFleetConversation', () => {
  it('rejects a malformed role before touching the database', async () => {
    const { client } = useQueuedClient([]);
    await expect(getFleetConversation("x'),or(")).rejects.toThrow('שם סוכן לא תקין');
    expect(client.from).not.toHaveBeenCalled();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });

  it('merges pending rows that fell outside the window and looks up handoffs by uuid only', async () => {
    const pendingOld = convRow(1, { status: 'pending', created_at: '2026-09-01T00:00:00.000Z' });
    const { builders } = useQueuedClient([
      // window (desc)
      { data: [convRow(3), convRow(2, { id: 'not-a-uuid' })], error: null },
      // pending
      { data: [pendingOld], error: null },
      // goals
      { data: [], error: null },
      // handoff lookup (no thread roots missing → only one lookup query)
      { data: [{ id: U(9), role: 'main', created_at: '2026-09-20T10:00:00.000Z', handoff_from: U(3) }], error: null },
    ]);
    const conv = await getFleetConversation('ops-monitor');
    expect(conv.rows.map((r) => r.id)).toEqual([U(1), 'not-a-uuid', U(3)]);
    expect(conv.handoffsOut).toEqual([
      { fromId: U(3), toRole: 'main', toId: U(9), at: '2026-09-20T10:00:00.000Z' },
    ]);
    const handoffIn = builders[3].in.mock.calls[0];
    expect(handoffIn[0]).toBe('payload->>handoff_from');
    expect(handoffIn[1]).not.toContain('not-a-uuid');
    expect(conv.olderCursor).toBeNull();
    expect(conv.newerCursor).toBeNull();
    expect(conv.focusFound).toBeNull();
  });

  it('re-anchors the window on a focus that is older than the latest page', async () => {
    const { builders } = useQueuedClient([
      { data: [convRow(5)], error: null }, // latest window, focus not in it
      { data: [], error: null }, // pending
      { data: [], error: null }, // goals
      { data: { id: U(2), role: 'ops-monitor', created_at: convRow(2).created_at }, error: null }, // focus row
      { data: [convRow(2), convRow(1)], error: null }, // anchored window
      { data: [], error: null }, // handoffs
    ]);
    const conv = await getFleetConversation('ops-monitor', { focus: U(2) });
    expect(conv.focusFound).toBe(true);
    expect(conv.rows.map((r) => r.id)).toEqual([U(1), U(2)]);
    expect(builders[4].lte).toHaveBeenCalledWith('created_at', convRow(2).created_at);
    expect(conv.newerCursor).toBe(convRow(2).created_at);
  });

  it('reports a focus that belongs to another role as not found', async () => {
    useQueuedClient([
      { data: [convRow(5)], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: { id: U(2), role: 'social-manager', created_at: convRow(2).created_at }, error: null },
      { data: [], error: null },
    ]);
    const conv = await getFleetConversation('ops-monitor', { focus: U(2) });
    expect(conv.focusFound).toBe(false);
  });

  it('fetches one extra row to know older history exists', async () => {
    const page = Array.from({ length: 51 }, (_, k) =>
      convRow(0, { id: U(k), created_at: new Date(Date.parse('2026-09-20T12:00:00Z') - k * 60_000).toISOString() }),
    );
    useQueuedClient([
      { data: page, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    const conv = await getFleetConversation('ops-monitor');
    expect(conv.rows).toHaveLength(50);
    expect(conv.olderCursor).toBe(page[49].created_at);
  });
});

describe('parseConversationCursor', () => {
  it('accepts only offset ISO timestamps', () => {
    expect(parseConversationCursor('2026-09-20T09:00:00.123456+00:00')).toEqual({
      kind: 'before',
      at: '2026-09-20T09:00:00.123456+00:00',
    });
    expect(parseConversationCursor(undefined, '2026-09-20T09:00:00Z')).toEqual({ kind: 'after', at: '2026-09-20T09:00:00Z' });
    expect(parseConversationCursor("2026'),or(")).toEqual({ kind: 'latest' });
  });
});

describe('listFleetConversations', () => {
  it('runs a fixed three queries and flags an unreadable fleet.json as an error', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));
    const { client, builders } = useQueuedClient([
      { data: [], error: null },
      { data: [{ id: U(1), role: 'main', status: 'pending', origin: null }], error: null },
      { data: [], error: null },
    ]);
    const list = await listFleetConversations();
    expect(client.from).toHaveBeenCalledTimes(3);
    expect(builders[0].limit).toHaveBeenCalledWith(300);
    expect(list.rolesUnavailable).toBe(true);
    expect(list.conversations).toEqual([expect.objectContaining({ role: 'main', waitingForYou: 1 })]);
  });

  it('lists every configured role, even without activity', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ roles: { 'qa-runner': { enabled: true }, main: { enabled: false } } }) as never,
    );
    useQueuedClient([
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    const list = await listFleetConversations();
    expect(list.rolesUnavailable).toBe(false);
    expect(list.conversations.map((c) => [c.role, c.enabled])).toEqual([
      ['main', false],
      ['qa-runner', true],
    ]);
  });
});

describe('getFleetRequestRole', () => {
  it('returns null for a non-uuid without querying', async () => {
    const { client } = useQueuedClient([]);
    expect(await getFleetRequestRole('abc')).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('createOwnerFleetContinuation', () => {
  it('derives role, tier, thread root and "המשך:" title from the stored rows', async () => {
    const { createOwnerFleetContinuation } = await import('./fleet');
    const { client } = useQueuedClient([
      // the replied-to row: itself a reply in thread U(1)
      {
        data: { id: U(2), role: 'ops-monitor', tier: 1, title: 'המשך: שאלה', status: 'completed', payload: { thread_root: U(1) } },
        error: null,
      },
      // the thread root's title
      { data: { title: 'שאלה' }, error: null },
    ]);
    client.rpc.mockResolvedValueOnce({ data: [{ id: U(7), created_at: new Date().toISOString() }], error: null });
    const r = await createOwnerFleetContinuation({ continueFrom: U(2), body: 'עוד פרט' });
    expect(client.rpc).toHaveBeenCalledWith('fleet_owner_request', {
      p_role: 'ops-monitor',
      p_kind: 'question',
      p_tier: 1,
      p_title: 'המשך: שאלה',
      p_body: 'עוד פרט',
      p_thread_root: U(1),
    });
    expect(r).toMatchObject({ id: U(7), deduplicated: false, role: 'ops-monitor' });
  });

  it('refuses to "continue" an agent request that is still open (answer it instead)', async () => {
    const { createOwnerFleetContinuation } = await import('./fleet');
    const { client } = useQueuedClient([
      { data: { id: U(2), role: 'ops-monitor', tier: 0, title: 't', status: 'pending', payload: {} }, error: null },
    ]);
    await expect(createOwnerFleetContinuation({ continueFrom: U(2), body: 'עוד' })).rejects.toThrow(
      'הפנייה עדיין ממתינה למענה',
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
