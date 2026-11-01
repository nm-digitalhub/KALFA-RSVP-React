import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.kalfa.me') }));

const api = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};
const paths: string[] = [];
vi.mock('./graph-client', () => ({
  graphClient: () => ({
    api: (path: string) => {
      paths.push(path);
      return api;
    },
  }),
  mailboxPath: (mailbox: string) => `/users/${encodeURIComponent(mailbox)}`,
}));

import {
  ensureCalendarSubscription,
  ensureIntakeSubscription,
  mailboxOfCalendarSubscription,
  type GraphSubscription,
} from './subscriptions';

const URL = 'https://beta.kalfa.me/api/webhooks/microsoft-graph';
const DAY = 24 * 60 * 60_000;

function sub(over: Partial<GraphSubscription>): GraphSubscription {
  return {
    id: 'sub-1',
    resource: '/users/agent%40kalfa.me/events',
    expirationDateTime: new Date(Date.now() + 2 * DAY).toISOString(),
    notificationUrl: URL,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  paths.length = 0;
  process.env.MS_GRAPH_WEBHOOK_SECRET = 'secret';
  api.post.mockImplementation(async (body: { resource: string }) =>
    sub({ id: 'new', resource: body.resource }),
  );
  api.patch.mockImplementation(async () => sub({ id: 'renewed' }));
});

afterEach(() => {
  delete process.env.MS_GRAPH_WEBHOOK_SECRET;
});

describe('ensureIntakeSubscription', () => {
  it('creates the intake subscription with exactly the payload it always had', async () => {
    api.get.mockResolvedValueOnce({ value: [] });

    await ensureIntakeSubscription('owner@kalfa.me', 'folder-1');

    const body = api.post.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(
      ['changeType', 'clientState', 'expirationDateTime', 'notificationUrl', 'resource'].sort(),
    );
    expect(body).toMatchObject({
      changeType: 'created',
      notificationUrl: URL,
      resource: '/users/owner%40kalfa.me/mailFolders/folder-1/messages',
      clientState: 'secret',
    });
  });
});

describe('ensureCalendarSubscription', () => {
  it('creates one for created, updated and deleted events, with lifecycle notifications on the same route', async () => {
    api.get.mockResolvedValueOnce({ value: [] });

    const result = await ensureCalendarSubscription('agent@kalfa.me');

    expect(result.action).toBe('created');
    expect(api.post.mock.calls[0][0]).toMatchObject({
      changeType: 'created,updated,deleted',
      notificationUrl: URL,
      lifecycleNotificationUrl: URL,
      resource: '/users/agent%40kalfa.me/events',
    });
  });

  it('leaves a live one alone and renews one under 24 hours', async () => {
    expect((await ensureCalendarSubscription('agent@kalfa.me', [sub({})])).action).toBe('ok');
    expect(api.post).not.toHaveBeenCalled();

    const dying = sub({ expirationDateTime: new Date(Date.now() + 60 * 60_000).toISOString() });
    expect((await ensureCalendarSubscription('agent@kalfa.me', [dying])).action).toBe('renewed');
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it("never treats another deployment's subscription on the same mailbox as its own", async () => {
    const elsewhere = sub({ id: 'theirs', notificationUrl: 'https://other.example/api/webhooks/microsoft-graph' });

    const result = await ensureCalendarSubscription('agent@kalfa.me', [elsewhere]);

    expect(result.action).toBe('created');
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('keeps the longest-lived of two and deletes the other', async () => {
    const short = sub({ id: 'short', expirationDateTime: new Date(Date.now() + 1.5 * DAY).toISOString() });
    const long = sub({ id: 'long' });

    const result = await ensureCalendarSubscription('agent@kalfa.me', [short, long]);

    expect(result).toMatchObject({ action: 'ok', id: 'long' });
    expect(paths).toContain('/subscriptions/short');
    expect(api.delete).toHaveBeenCalledTimes(1);
  });
});

describe('mailboxOfCalendarSubscription', () => {
  it('reads the mailbox back from a calendar resource, and nothing else', () => {
    expect(mailboxOfCalendarSubscription({ resource: '/users/Agent%40Kalfa.me/events' })).toBe('agent@kalfa.me');
    expect(mailboxOfCalendarSubscription({ resource: 'users/agent@kalfa.me/events' })).toBe('agent@kalfa.me');
    expect(
      mailboxOfCalendarSubscription({ resource: '/users/owner%40kalfa.me/mailFolders/f/messages' }),
    ).toBeNull();
  });
});
