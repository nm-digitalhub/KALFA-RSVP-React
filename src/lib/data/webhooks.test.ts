import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let upsertError: { message: string } | null = null;
const upsert = vi.fn(async () => ({ error: upsertError }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ upsert }) }),
}));

const send = vi.fn(async (..._args: unknown[]) => 'job-id' as string | null);
const getWebJobSender = vi.fn(async () => ({ send }));
vi.mock('@/lib/queue/web-sender', () => ({
  getWebJobSender: () => getWebJobSender(),
}));

import { insertWebhookEvents, WEBHOOK_NUDGE_SLOT_SECONDS } from './webhooks';

const ROW = { provider: 'whatsapp', dedupe_key: 'k1', event_kind: 'message', payload: {} } as never;

beforeEach(() => {
  vi.clearAllMocks();
  upsertError = null;
});

// Persist-then-process: every persist nudges webhook-process so events are
// handled within seconds, with the */5 cron only as a safety net.
describe('insertWebhookEvents — nudge', () => {
  it('persists, then files one throttled/debounced webhook-process job', async () => {
    await insertWebhookEvents([ROW]);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('webhook-process', {}, {
      singletonKey: 'webhook-nudge',
      singletonSeconds: WEBHOOK_NUDGE_SLOT_SECONDS,
      singletonNextSlot: true,
    });
  });

  it('a failed nudge never fails the persist (the cron drains the rows)', async () => {
    send.mockRejectedValueOnce(new Error('pool exhausted'));
    await expect(insertWebhookEvents([ROW])).resolves.toBeUndefined();
    getWebJobSender.mockRejectedValueOnce(new Error('connect failed'));
    await expect(insertWebhookEvents([ROW])).resolves.toBeUndefined();
  });

  it('does not nudge when nothing was persisted', async () => {
    await insertWebhookEvents([]);
    upsertError = { message: 'boom' };
    await expect(insertWebhookEvents([ROW])).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
