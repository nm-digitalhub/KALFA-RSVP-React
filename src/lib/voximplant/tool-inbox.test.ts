import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents: vi.fn(async () => {}) }));

import { insertWebhookEvents } from '@/lib/data/webhooks';

import { persistVoxInboxEvent } from './tool-inbox';

describe('persistVoxInboxEvent', () => {
  beforeEach(() => vi.mocked(insertWebhookEvents).mockClear());

  it('writes one voximplant inbox row keyed by the token-verified attempt id', async () => {
    const payload = { reason: 'asked' };
    await persistVoxInboxEvent({
      eventKind: 'mtg_dnc',
      dedupeKey: 'vox-mtg-dnc:attempt-1',
      attemptId: 'attempt-1',
      payload,
    });
    expect(insertWebhookEvents).toHaveBeenCalledTimes(1);
    const [rows] = vi.mocked(insertWebhookEvents).mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'voximplant',
      event_kind: 'mtg_dnc',
      dedupe_key: 'vox-mtg-dnc:attempt-1',
      message_id: 'attempt-1',
      payload,
    });
    expect(Number.isNaN(Date.parse(String(rows[0].event_at)))).toBe(false);
  });

  it('lets a persist failure propagate so the route answers 500 and does not process', async () => {
    vi.mocked(insertWebhookEvents).mockRejectedValueOnce(new Error('db down'));
    await expect(
      persistVoxInboxEvent({ eventKind: 'call_rsvp', dedupeKey: 'k', attemptId: 'a', payload: {} }),
    ).rejects.toThrow('db down');
  });
});
