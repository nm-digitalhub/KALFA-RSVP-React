import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sendSlackAlert = vi.fn();
const sendPushToUser = vi.fn();
const listRdpOwnerIds = vi.fn();
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: (...a: unknown[]) => sendSlackAlert(...a) }));
vi.mock('@/lib/data/push-delivery', () => ({ sendPushToUser: (...a: unknown[]) => sendPushToUser(...a) }));
vi.mock('./queries', () => ({ listRdpOwnerIds: (...a: unknown[]) => listRdpOwnerIds(...a) }));

import { notifyOwnersOfRdpRequest } from './notify-request';

const ADMIN = {} as Parameters<typeof notifyOwnersOfRdpRequest>[0];
const REQUEST = '01a11300-fcd7-7560-95e0-275a8b203f73';
const OWNER_A = '22222222-2222-4222-8222-222222222222';
const OWNER_B = '33333333-3333-4333-8333-333333333333';
const SENT = { attempted: 1, sent: 1, failed: 0, revoked: 0 };

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sendSlackAlert.mockReset().mockResolvedValue('1700000000.000100');
  sendPushToUser.mockReset().mockResolvedValue(SENT);
  listRdpOwnerIds.mockReset().mockResolvedValue([OWNER_A]);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('notifyOwnersOfRdpRequest', () => {
  it('posts a security warning with the short id in the title and the command that opens the approval screen', async () => {
    await notifyOwnersOfRdpRequest(ADMIN, { requestId: REQUEST, minutes: 60 });
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith({
      level: 'warn',
      category: 'security',
      source: 'rdp-access:request',
      title: 'בקשת גישה לשולחן העבודה ממתינה (01a11300)',
      detail: '60 דקות. לאישור: npm run rdp:access -- watch',
    });
  });

  it('pushes to every owner, deep-linking the request and tagging it so repeats replace each other', async () => {
    listRdpOwnerIds.mockResolvedValue([OWNER_A, OWNER_B]);
    const result = await notifyOwnersOfRdpRequest(ADMIN, { requestId: REQUEST, minutes: 30 });
    expect(sendPushToUser).toHaveBeenCalledTimes(2);
    expect(sendPushToUser).toHaveBeenCalledWith(OWNER_A, {
      title: 'KALFA — גישה לשולחן העבודה',
      body: 'בקשה חדשה ממתינה לאישור (30 דקות)',
      url: `/admin/rdp-access/requests/${REQUEST}`,
      tag: 'rdp-access-01a11300',
    });
    expect(sendPushToUser).toHaveBeenCalledWith(OWNER_B, expect.objectContaining({ tag: 'rdp-access-01a11300' }));
    expect(result).toEqual({ slack: true, ownersLookedUp: true, ownersFound: 2, pushed: 2, failed: 0 });
  });

  it('adds up several devices of one owner and counts failed deliveries', async () => {
    sendPushToUser.mockResolvedValue({ attempted: 3, sent: 2, failed: 1, revoked: 0 });
    const result = await notifyOwnersOfRdpRequest(ADMIN, { requestId: REQUEST, minutes: 60 });
    expect(result).toMatchObject({ pushed: 2, failed: 1 });
  });

  it('keeps going when one owner delivery throws, and reports it without the error text', async () => {
    listRdpOwnerIds.mockResolvedValue([OWNER_A, OWNER_B]);
    sendPushToUser.mockRejectedValueOnce(new Error('secret endpoint https://push.example/abc')).mockResolvedValueOnce(SENT);
    const result = await notifyOwnersOfRdpRequest(ADMIN, { requestId: REQUEST, minutes: 60 });
    expect(result).toMatchObject({ pushed: 1, failed: 1 });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('push.example');
  });

  it('still pushes when Slack is off, de-duplicated or unreachable', async () => {
    sendSlackAlert.mockResolvedValue(null);
    const result = await notifyOwnersOfRdpRequest(ADMIN, { requestId: REQUEST, minutes: 60 });
    expect(result).toMatchObject({ slack: false, pushed: 1 });
  });

  it('still posts to Slack, and does not throw, when the owners cannot be looked up', async () => {
    listRdpOwnerIds.mockRejectedValue(new Error('relation "platform_roles" does not exist'));
    const result = await notifyOwnersOfRdpRequest(ADMIN, { requestId: REQUEST, minutes: 60 });
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(result).toEqual({ slack: true, ownersLookedUp: false, ownersFound: 0, pushed: 0, failed: 0 });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('platform_roles');
  });

  it('reports no owners without pushing anything', async () => {
    listRdpOwnerIds.mockResolvedValue([]);
    const result = await notifyOwnersOfRdpRequest(ADMIN, { requestId: REQUEST, minutes: 60 });
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ownersLookedUp: true, ownersFound: 0, pushed: 0 });
  });

  it('puts no name, reason or address in either message, and only the short id in Slack', async () => {
    await notifyOwnersOfRdpRequest(ADMIN, { requestId: REQUEST, minutes: 60 });
    const slackText = JSON.stringify(sendSlackAlert.mock.calls);
    expect(slackText).not.toContain(REQUEST);
    expect(slackText).toContain('01a11300');
    const pushText = JSON.stringify(sendPushToUser.mock.calls);
    expect(pushText).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(pushText).not.toContain('@');
  });
});
