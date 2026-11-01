import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.kalfa.me') }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/exchange-ews/mailbox-credential', () => ({ resolveMailboxPassword: vi.fn(() => '') }));
vi.mock('@/lib/exchange-ews/calendar-provider', () => ({
  calendarProvider: { getAvailability: vi.fn() },
  selectedCalendarProvider: vi.fn(() => 'graph'),
}));
vi.mock('@/lib/microsoft/graph-client', () => ({
  graphConfigured: vi.fn(() => true),
  mailboxPath: (mailbox: string) => `/users/${encodeURIComponent(mailbox)}`,
  graphClient: vi.fn(),
}));
vi.mock('@/lib/microsoft/subscriptions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/microsoft/subscriptions')>(
    '@/lib/microsoft/subscriptions',
  );
  return {
    // Pure: the real ones are what the code under test must agree with.
    mailboxOfCalendarSubscription: actual.mailboxOfCalendarSubscription,
    notificationUrl: actual.notificationUrl,
    webhookClientState: vi.fn(() => 'secret'),
    listSubscriptions: vi.fn(),
    ensureCalendarSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    renewSubscription: vi.fn(),
  };
});

import type { PgBoss } from 'pg-boss';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { calendarProvider } from '@/lib/exchange-ews/calendar-provider';
import {
  deleteSubscription,
  ensureCalendarSubscription,
  type GraphSubscription,
  listSubscriptions,
  renewSubscription,
  webhookClientState,
} from '@/lib/microsoft/subscriptions';
import { calendarPresenceWakeJobId, CALENDAR_PRESENCE_SWEEP_KEY, QUEUES } from '@/lib/queue/queues';
import { createAdminClient } from '@/lib/supabase/admin';

import {
  handleCalendarLifecycleEvent,
  handleCalendarNotification,
  nextCalendarPresenceWakeMs,
  runCalendarPresenceJob,
} from './console-agent-calendar-presence';

const NOW = Date.parse('2026-10-30T10:20:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const URL = 'https://beta.kalfa.me/api/webhooks/microsoft-graph';

type Db = {
  agents: { user_id: string }[];
  connections: Record<string, unknown>[];
  agentsError: { message: string } | null;
  upserts: Record<string, unknown>[];
};
let db: Db;

function connection(userId: string, mailbox: string) {
  return {
    id: `conn-${userId}`,
    user_id: userId,
    mailbox_email: mailbox,
    auth_method: 'ntlm',
    status: 'verified',
    credential_ciphertext: null,
    credential_iv: null,
    credential_auth_tag: null,
    encryption_key_version: 1,
  };
}

function fakeAdmin() {
  return {
    from(table: string) {
      if (table === 'console_agents') {
        return { select: async () => ({ data: db.agents, error: db.agentsError }) };
      }
      if (table === 'exchange_connections') {
        const q = { select: () => q, eq: () => q, in: async () => ({ data: db.connections, error: null }) };
        return q;
      }
      return {
        upsert: async (row: Record<string, unknown>) => {
          db.upserts.push(row);
          return { error: null };
        },
      };
    },
  };
}

const boss = { send: vi.fn() };
const asBoss = boss as unknown as PgBoss;

function window(startMs: number, endMs: number, showAs = 'busy') {
  return { start: new Date(startMs), end: new Date(endMs), showAs };
}

function calendarSub(id: string, mailbox: string, notificationUrl = URL): GraphSubscription {
  return {
    id,
    resource: `/users/${encodeURIComponent(mailbox)}/events`,
    expirationDateTime: new Date(NOW + 48 * HOUR).toISOString(),
    notificationUrl,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db = {
    agents: [{ user_id: 'agent-1' }],
    connections: [connection('agent-1', 'Agent@Kalfa.me')],
    agentsError: null,
    upserts: [],
  };
  vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as never);
  vi.mocked(webhookClientState).mockReturnValue('secret');
});

describe('nextCalendarPresenceWakeMs', () => {
  it('is the earliest edge after now across overlapping windows', () => {
    const windows = [window(NOW - 10 * MIN, NOW + 50 * MIN), window(NOW + 20 * MIN, NOW + 90 * MIN)];
    expect(nextCalendarPresenceWakeMs(windows, NOW)).toBe(NOW + 20 * MIN);
  });

  it('ignores free time', () => {
    expect(nextCalendarPresenceWakeMs([window(NOW + 5 * MIN, NOW + 10 * MIN, 'free')], NOW)).not.toBe(
      NOW + 5 * MIN,
    );
  });

  it('with nothing in range, falls back to an hour mark between 3 and 4 hours out', () => {
    const at = nextCalendarPresenceWakeMs([], NOW);
    expect(at % HOUR).toBe(0);
    expect(at - NOW).toBeGreaterThanOrEqual(3 * HOUR);
    expect(at - NOW).toBeLessThan(4 * HOUR);
  });

  it('two reads in the same hour fall back to the same moment, so their chains merge', () => {
    expect(nextCalendarPresenceWakeMs([], NOW)).toBe(nextCalendarPresenceWakeMs([], NOW + 30 * MIN));
  });
});

describe('runCalendarPresenceJob — one agent', () => {
  it('writes the busy window in effect and queues the read for its end', async () => {
    const end = NOW + 40 * MIN;
    vi.mocked(calendarProvider.getAvailability).mockResolvedValueOnce({
      ok: true,
      data: [window(NOW - 10 * MIN, end, 'oof'), window(NOW + 2 * HOUR, NOW + 3 * HOUR)],
    } as never);

    const result = await runCalendarPresenceJob(asBoss, { agentId: 'agent-1' }, { nowMs: NOW });

    expect(result).toEqual({ kind: 'agent', outcome: 'synced' });
    expect(db.upserts[0]).toMatchObject({
      agent_id: 'agent-1',
      busy_until: new Date(end).toISOString(),
      show_as: 'oof',
      last_error_code: null,
    });
    expect(boss.send).toHaveBeenCalledWith(
      QUEUES.calendarPresenceSync,
      { agentId: 'agent-1', at: end },
      expect.objectContaining({
        id: calendarPresenceWakeJobId('agent-1', end),
        singletonKey: 'agent-1',
        startAfter: new Date(end + 2_000),
      }),
    );
  });

  it('a wake whose worker clock trails the boundary still reads AT the boundary', async () => {
    const start = NOW + 30 * MIN;
    vi.mocked(calendarProvider.getAvailability).mockResolvedValueOnce({
      ok: true,
      data: [window(start, start + HOUR)],
    } as never);

    await runCalendarPresenceJob(asBoss, { agentId: 'agent-1', at: start }, { nowMs: start - 1_500 });

    expect(db.upserts[0]).toMatchObject({ busy_until: new Date(start + HOUR).toISOString(), show_as: 'busy' });
    expect(boss.send.mock.calls[0][1]).toEqual({ agentId: 'agent-1', at: start + HOUR });
  });

  it('a failed read keeps the known window and tries again at the next 10-minute mark', async () => {
    vi.mocked(calendarProvider.getAvailability).mockResolvedValueOnce({ ok: false, error: 'provider_error' } as never);

    const result = await runCalendarPresenceJob(asBoss, { agentId: 'agent-1' }, { nowMs: NOW + MIN });

    expect(result).toEqual({ kind: 'agent', outcome: 'failed' });
    expect(db.upserts[0]).not.toHaveProperty('busy_until');
    expect(db.upserts[0]).toMatchObject({ last_error_code: 'provider_error' });
    expect(boss.send.mock.calls[0][1]).toEqual({ agentId: 'agent-1', at: NOW + 10 * MIN });
  });

  it('ends the chain for someone who is no longer an agent with a verified connection', async () => {
    const result = await runCalendarPresenceJob(asBoss, { agentId: 'someone-else' }, { nowMs: NOW });

    expect(result).toEqual({ kind: 'agent', outcome: 'not_an_agent' });
    expect(calendarProvider.getAvailability).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('a failed database read throws into the retry policy instead of reading as "no agents"', async () => {
    db.agentsError = { message: 'down' };
    await expect(runCalendarPresenceJob(asBoss, { agentId: 'agent-1' }, { nowMs: NOW })).rejects.toThrow(
      'calendar_presence_agents_read_failed',
    );
  });
});

describe('runCalendarPresenceJob — the sweep', () => {
  beforeEach(() => {
    db.agents = [{ user_id: 'agent-1' }, { user_id: 'agent-2' }];
    db.connections = [connection('agent-1', 'agent@kalfa.me'), connection('agent-2', 'second@kalfa.me')];
  });

  it("ensures each agent's subscription, deletes one nobody owns, leaves another deployment's alone, and queues every agent", async () => {
    const existing = [
      calendarSub('keep', 'agent@kalfa.me'),
      calendarSub('orphan', 'gone@kalfa.me'),
      calendarSub('theirs', 'gone@kalfa.me', 'https://other.example/api/webhooks/microsoft-graph'),
    ];
    vi.mocked(listSubscriptions).mockResolvedValueOnce(existing);

    const result = await runCalendarPresenceJob(asBoss, null);

    expect(result).toEqual({ kind: 'sweep', candidates: 2, subscriptions: 'ensured', queued: 2 });
    expect(deleteSubscription).toHaveBeenCalledTimes(1);
    expect(deleteSubscription).toHaveBeenCalledWith('orphan');
    expect(vi.mocked(ensureCalendarSubscription).mock.calls.map((c) => c[0]).sort()).toEqual([
      'agent@kalfa.me',
      'second@kalfa.me',
    ]);
    expect(boss.send.mock.calls.map((c) => c[2].singletonKey).sort()).toEqual(['agent-1', 'agent-2']);
    expect(boss.send.mock.calls[0][2]).toMatchObject({ singletonSeconds: 5, singletonNextSlot: true });
  });

  it('a subscription that cannot be kept alive alerts, and every agent is still queued', async () => {
    vi.mocked(listSubscriptions).mockRejectedValueOnce(new Error('graph_down'));

    const result = await runCalendarPresenceJob(asBoss, {});

    expect(result).toMatchObject({ subscriptions: 'failed', queued: 2 });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', source: 'calendar_presence' }));
  });

  it('without the webhook secret it touches no subscription and still queues every agent', async () => {
    vi.mocked(webhookClientState).mockImplementation(() => {
      throw new Error('graph_webhook_secret_missing');
    });

    const result = await runCalendarPresenceJob(asBoss, null);

    expect(result).toMatchObject({ subscriptions: 'unconfigured', queued: 2 });
    expect(listSubscriptions).not.toHaveBeenCalled();
  });
});

describe('calendar notifications', () => {
  it("queue the owning agent's sync, coalesced", async () => {
    const outcome = await handleCalendarNotification(asBoss, [calendarSub('sub-1', 'agent@kalfa.me')], 'sub-1');

    expect(outcome).toBe('queued');
    expect(boss.send).toHaveBeenCalledWith(
      QUEUES.calendarPresenceSync,
      { agentId: 'agent-1' },
      expect.objectContaining({ singletonKey: 'agent-1', singletonSeconds: 5, singletonNextSlot: true }),
    );
  });

  it('a subscription no agent owns is a no-op, not an error', async () => {
    await expect(handleCalendarNotification(asBoss, [], 'sub-unknown')).resolves.toBe('unknown_subscription');
    expect(boss.send).not.toHaveBeenCalled();
  });
});

describe('lifecycle notifications', () => {
  const subs = async () => [calendarSub('sub-1', 'agent@kalfa.me')];

  it('reauthorizationRequired renews the subscription', async () => {
    vi.mocked(renewSubscription).mockResolvedValueOnce(calendarSub('sub-1', 'agent@kalfa.me'));

    const outcome = await handleCalendarLifecycleEvent(asBoss, subs, {
      subscriptionId: 'sub-1',
      lifecycleEvent: 'reauthorizationRequired',
    });

    expect(outcome).toBe('renewed');
    expect(renewSubscription).toHaveBeenCalledWith('sub-1');
  });

  it('a renewal that fails falls back to the sweep', async () => {
    vi.mocked(renewSubscription).mockRejectedValueOnce(new Error('404'));

    const outcome = await handleCalendarLifecycleEvent(asBoss, subs, {
      subscriptionId: 'sub-1',
      lifecycleEvent: 'reauthorizationRequired',
    });

    expect(outcome).toBe('sweep_queued');
    expect(boss.send.mock.calls[0][2]).toMatchObject({ singletonKey: CALENDAR_PRESENCE_SWEEP_KEY });
  });

  it("missed reads that agent again", async () => {
    const outcome = await handleCalendarLifecycleEvent(asBoss, subs, {
      subscriptionId: 'sub-1',
      lifecycleEvent: 'missed',
    });

    expect(outcome).toBe('queued');
    expect(boss.send.mock.calls[0][1]).toEqual({ agentId: 'agent-1' });
  });

  it('subscriptionRemoved queues the sweep, which recreates it', async () => {
    const outcome = await handleCalendarLifecycleEvent(asBoss, subs, {
      subscriptionId: 'sub-1',
      lifecycleEvent: 'subscriptionRemoved',
    });

    expect(outcome).toBe('sweep_queued');
    expect(boss.send.mock.calls[0][1]).toEqual({});
  });
});
