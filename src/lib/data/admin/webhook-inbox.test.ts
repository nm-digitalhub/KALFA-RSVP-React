import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/dal';
import { listWebhookInbox } from '@/lib/data/admin/webhook-inbox';
import {
  webhookProcessState,
  deliveryStatusVariant,
  webhookKindLabel,
} from '@/lib/data/admin/labels';

beforeEach(() => vi.clearAllMocks());

describe('webhookProcessState', () => {
  it('processed_at wins (terminal) even with a stale last_error', () => {
    expect(webhookProcessState({ processed_at: 't', last_error: 'e' })).toBe(
      'processed',
    );
  });
  it('error when only last_error is set (retrying)', () => {
    expect(webhookProcessState({ processed_at: null, last_error: 'e' })).toBe(
      'error',
    );
  });
  it('pending when neither is set', () => {
    expect(webhookProcessState({ processed_at: null, last_error: null })).toBe(
      'pending',
    );
  });
});

describe('label helpers (free-text → map + fallback)', () => {
  it('delivery variant maps known + falls back to neutral', () => {
    expect(deliveryStatusVariant('read')).toBe('success');
    expect(deliveryStatusVariant('failed')).toBe('destructive');
    expect(deliveryStatusVariant('weird')).toBe('neutral');
    expect(deliveryStatusVariant(null)).toBe('neutral');
  });
  it('kind label falls back to the raw value', () => {
    expect(webhookKindLabel('message')).toBe('הודעה');
    expect(webhookKindLabel('foo')).toBe('foo');
  });
});

describe('listWebhookInbox', () => {
  function mock(rows: unknown[], count: number) {
    const { client, builder } = createMockSupabase<unknown>({
      data: rows as unknown,
      error: null,
      count,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return { client, builder };
  }

  it('gates on requireAdmin and applies server filters, returning a PageResult', async () => {
    const { builder } = mock([{ id: 'a1' }], 1);

    const res = await listWebhookInbox({
      kind: 'status',
      state: 'error',
      q: 'wamid_1',
    });

    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(builder.eq).toHaveBeenCalledWith('event_kind', 'status');
    // state=error → processed_at IS NULL AND last_error IS NOT NULL
    expect(builder.is).toHaveBeenCalledWith('processed_at', null);
    expect(builder.not).toHaveBeenCalledWith('last_error', 'is', null);
    // q → ilike across technical ids only (never guest phone)
    expect(builder.or).toHaveBeenCalledTimes(1);
    expect(builder.order).toHaveBeenCalledWith('received_at', {
      ascending: false,
    });
    expect(res).toMatchObject({ total: 1, page: 1 });
    expect(res.items).toHaveLength(1);
  });

  it('pending state filters on both nulls', async () => {
    const { builder } = mock([], 0);
    await listWebhookInbox({ state: 'pending' });
    expect(builder.is).toHaveBeenCalledWith('processed_at', null);
    expect(builder.is).toHaveBeenCalledWith('last_error', null);
  });
});
