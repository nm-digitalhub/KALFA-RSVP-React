import { beforeEach, describe, expect, it, vi } from 'vitest';

// The browser client is replaced by a recording fake; the subscribe callback and the broadcast handler are captured so
// each test drives the channel by hand.
type Handler = () => void;
type StatusCb = (status: string) => void;

const fake = vi.hoisted(() => {
  const state = {
    setAuth: vi.fn(async () => {}),
    removeChannel: vi.fn(async () => 'ok'),
    channels: [] as Array<{ topic: string }>,
    channelCalls: [] as Array<{ topic: string; opts: unknown }>,
    on: [] as Array<{ type: string; filter: unknown; handler: Handler }>,
    status: null as StatusCb | null,
    authGate: null as Promise<void> | null,
  };
  return state;
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    realtime: {
      setAuth: async () => {
        await fake.setAuth();
        if (fake.authGate) await fake.authGate;
      },
    },
    getChannels: () => fake.channels,
    removeChannel: fake.removeChannel,
    channel: (topic: string, opts: unknown) => {
      fake.channelCalls.push({ topic, opts });
      const ch = {
        topic: `realtime:${topic}`,
        on(type: string, filter: unknown, handler: Handler) {
          fake.on.push({ type, filter, handler });
          return ch;
        },
        subscribe(cb: StatusCb) {
          fake.status = cb;
          return ch;
        },
      };
      fake.channels.push(ch);
      return ch;
    },
  }),
}));

import { PERMISSIONS_CHANGED_EVENT, permissionTopic, subscribePermissionChanges } from './permission-changes';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fake.setAuth.mockClear();
  fake.removeChannel.mockClear();
  fake.channels = [];
  fake.channelCalls = [];
  fake.on = [];
  fake.status = null;
  fake.authGate = null;
});

describe('subscribePermissionChanges', () => {
  it("joins the user's own private topic with Broadcast Replay from the render time, after the token resolved", async () => {
    subscribePermissionChanges('u-1', 1_700_000_000_000, () => {});
    await flush();
    expect(fake.setAuth).toHaveBeenCalledTimes(1);
    expect(fake.channelCalls).toEqual([
      {
        topic: 'staff:u-1',
        opts: { config: { private: true, broadcast: { replay: { since: 1_700_000_000_000, limit: 1 } } } },
      },
    ]);
    expect(fake.on).toHaveLength(1);
    expect(fake.on[0].type).toBe('broadcast');
    expect(fake.on[0].filter).toEqual({ event: 'permissions_changed' });
  });

  it('topic and event match the database trigger (migration 20261022100542)', () => {
    expect(permissionTopic('abc')).toBe('staff:abc');
    expect(PERMISSIONS_CHANGED_EVENT).toBe('permissions_changed');
  });

  it('a broadcast (live or replayed) calls onChange; channel status alone does not', async () => {
    const onChange = vi.fn();
    subscribePermissionChanges('u-1', 0, onChange);
    await flush();
    fake.status?.('SUBSCRIBED');
    fake.status?.('CHANNEL_ERROR');
    fake.status?.('SUBSCRIBED');
    expect(onChange).not.toHaveBeenCalled();
    fake.on[0].handler();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('cleanup removes the channel and ignores later events', async () => {
    const onChange = vi.fn();
    const stop = subscribePermissionChanges('u-1', 0, onChange);
    await flush();
    stop();
    expect(fake.removeChannel).toHaveBeenCalledTimes(1);
    fake.on[0].handler();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cleanup before the token resolves creates no channel', async () => {
    let release!: () => void;
    fake.authGate = new Promise<void>((r) => (release = r));
    const stop = subscribePermissionChanges('u-1', 0, () => {});
    stop();
    release();
    await flush();
    expect(fake.channelCalls).toEqual([]);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it('a channel still held for the same topic (StrictMode remount) is removed before a fresh one is made', async () => {
    const stale = { topic: 'realtime:staff:u-1' };
    fake.channels = [stale];
    subscribePermissionChanges('u-1', 0, () => {});
    await flush();
    expect(fake.removeChannel).toHaveBeenCalledWith(stale);
    expect(fake.channelCalls).toHaveLength(1);
  });
});
