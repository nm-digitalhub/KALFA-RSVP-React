import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { getWebhookHealth } from '@/lib/data/admin/webhook-inbox';
import { webhookProcessState } from '@/lib/data/admin/labels';
import { createFakeCountClient, nonNumericLeaves } from '@/test/fake-count-client';
import {
  WEBHOOK_CLAIM_ATTEMPT_CAP,
  countUnprocessedWebhooks,
  countWebhooksWithLastError,
  getSystemHealthSummary,
} from './system-health';

type AdminClient = ReturnType<typeof createAdminClient>;

// 01:30 Israel on 2026-09-25; Israel midnight = 2026-09-24T21:00Z.
const NOW = Date.parse('2026-09-24T22:30:00Z');

const payload = { entry: [{ changes: [{ value: { contacts: [{ wa_id: '972501234567', profile: { name: 'דנה' } }] } }] }] };
function db() {
  return createFakeCountClient({
    webhook_inbox: [
      // processed cleanly, the latest processed at 22:20Z
      { id: 'w1', payload, received_at: '2026-09-24T22:10:00Z', processed_at: '2026-09-24T22:20:00Z', attempts: 0, last_error: null },
      // errored once, then processed — counts in withLastError, NOT erroringNow
      { id: 'w2', payload, received_at: '2026-09-24T21:40:00Z', processed_at: '2026-09-24T21:45:00Z', attempts: 1, last_error: 'boom' },
      // waiting, no error — the most recent row received (22:25Z)
      { id: 'w3', payload, received_at: '2026-09-24T22:25:00Z', processed_at: null, attempts: 0, last_error: null },
      // erroring and still being retried — the oldest pending row
      { id: 'w4', payload, received_at: '2026-09-24T22:00:00Z', processed_at: null, attempts: 2, last_error: 'timeout' },
      // dead-lettered (at the claim cap), received last week
      { id: 'w5', payload, received_at: '2026-09-19T10:00:00Z', processed_at: null, attempts: 5, last_error: 'poison' },
      // processed last week
      { id: 'w6', payload, received_at: '2026-09-19T09:00:00Z', processed_at: '2026-09-19T09:01:00Z', attempts: 0, last_error: null },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as unknown as User);
});

describe('getSystemHealthSummary (core)', () => {
  it("'today': current state, ages in minutes, received since Israel midnight", async () => {
    const { client } = db();
    const s = await getSystemHealthSummary(client as unknown as AdminClient, 'today', NOW);
    expect(s).toEqual({
      unprocessed: 3, // w3, w4, w5
      withLastError: 3, // w2 (later processed), w4, w5
      erroringNow: 2, // w4, w5 — the inspector's 'error' state
      deadLettered: 1, // w5
      minutesSinceLastReceived: 5, // w3 at 22:25Z
      minutesSinceLastProcessed: 10, // w1 at 22:20Z (not w6)
      oldestPendingMinutes: 30, // w4 at 22:00Z; the dead-lettered w5 is excluded
      receivedInRange: 4, // w1–w4
    });
  });

  it('erroringNow is exactly the inspector error state; deadLettered uses the claim cap', async () => {
    const { client } = db();
    const s = await getSystemHealthSummary(client as unknown as AdminClient, '7d', NOW);
    const rows = [
      { processed_at: '2026-09-24T22:20:00Z', last_error: null },
      { processed_at: '2026-09-24T21:45:00Z', last_error: 'boom' },
      { processed_at: null, last_error: null },
      { processed_at: null, last_error: 'timeout' },
      { processed_at: null, last_error: 'poison' },
      { processed_at: '2026-09-19T09:01:00Z', last_error: null },
    ];
    expect(s.erroringNow).toBe(rows.filter((r) => webhookProcessState(r) === 'error').length);
    expect(WEBHOOK_CLAIM_ATTEMPT_CAP).toBe(5);
    expect(s.receivedInRange).toBe(6);
  });

  it('empty inbox: zeros and null ages', async () => {
    const { client } = createFakeCountClient({ webhook_inbox: [] });
    const s = await getSystemHealthSummary(client as unknown as AdminClient, '30d', NOW);
    expect(s).toEqual({
      unprocessed: 0,
      withLastError: 0,
      erroringNow: 0,
      deadLettered: 0,
      minutesSinceLastReceived: null,
      minutesSinceLastProcessed: null,
      oldestPendingMinutes: null,
      receivedInRange: 0,
    });
  });

  it('never selects payload, ids or error text', async () => {
    const { client, calls } = db();
    await getSystemHealthSummary(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      expect(c.table).toBe('webhook_inbox');
      expect(['id', 'received_at', 'processed_at']).toContain(c.columns);
      if (c.columns === 'id') expect(c.selectOptions).toEqual({ count: 'exact', head: true });
    }
  });

  it('result is numbers only', async () => {
    const { client } = db();
    const s = await getSystemHealthSummary(client as unknown as AdminClient, '30d', NOW);
    expect(nonNumericLeaves(s)).toEqual([]);
    const json = JSON.stringify(s);
    expect(json).not.toContain('972');
    expect(json).not.toContain('boom');
  });

  it('throws on a query error', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['webhook_inbox'] });
    await expect(
      getSystemHealthSummary(client as unknown as AdminClient, 'today', NOW),
    ).rejects.toThrow();
  });
});

describe('wrapper ↔ core parity (same data, same number)', () => {
  it('the /admin/webhooks header strip reads the core counts', async () => {
    const { client } = db();
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as AdminClient);
    const page = await getWebhookHealth();
    expect(requirePlatformPermission).toHaveBeenCalledWith('view_webhooks');
    const summary = await getSystemHealthSummary(client as unknown as AdminClient, 'today', NOW);
    expect(page).toEqual({
      receivedLast: '2026-09-24T22:25:00Z',
      unprocessedCount: summary.unprocessed,
      failedCount: summary.withLastError,
    });
    expect(page.unprocessedCount).toBe(await countUnprocessedWebhooks(client as unknown as AdminClient));
    expect(page.failedCount).toBe(await countWebhooksWithLastError(client as unknown as AdminClient));
  });

  it('the header strip keeps its fail-soft zeros on a query error', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['webhook_inbox'] });
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as AdminClient);
    expect(await getWebhookHealth()).toEqual({
      receivedLast: null,
      unprocessedCount: 0,
      failedCount: 0,
    });
  });

  it('the header strip does not touch data when the gate rejects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(getWebhookHealth()).rejects.toThrow('NEXT_REDIRECT');
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
