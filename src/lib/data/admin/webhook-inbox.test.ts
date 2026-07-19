import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  listWebhookInbox,
  resolveWebhookAssociations,
} from '@/lib/data/admin/webhook-inbox';
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

  it('gates on requirePlatformPermission and applies server filters, returning a PageResult', async () => {
    const { builder } = mock([{ id: 'a1' }], 1);

    const res = await listWebhookInbox({
      kind: 'status',
      state: 'error',
      q: 'wamid_1',
    });

    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
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

  // SECURITY: the search term must produce exactly three ilike clauses with no
  // injected condition, even when it contains PostgREST metacharacters.
  it('sanitises a search term into exactly three ilike clauses (no injection)', async () => {
    const { builder } = mock([], 0);
    await listWebhookInbox({ q: 'a,b)c*%"d' });

    expect(builder.or).toHaveBeenCalledTimes(1);
    const filter = builder.or.mock.calls[0][0] as string;
    // Metacharacters stripped -> "abcd"; wrapped in * for contains-match.
    expect(filter).toBe(
      'message_id.ilike.*abcd*,context_message_id.ilike.*abcd*,phone_number_id.ilike.*abcd*',
    );
    // No extra clause was injected: the three known clauses account for the
    // only commas in the string.
    expect(filter.split(',')).toHaveLength(3);
  });

  it('does not call .or when the sanitised search is empty', async () => {
    const { builder } = mock([], 0);
    await listWebhookInbox({ q: '(),*%' });
    expect(builder.or).not.toHaveBeenCalled();
  });
});

describe('resolveWebhookAssociations', () => {
  // Regression guard: this function queries contact_interactions/events via the
  // service-role (RLS-bypassing) client. It was previously missing its own
  // requirePlatformPermission() gate, relying entirely on its one caller (an admin-layout
  // page) already having checked -- a latent risk for any future caller that
  // doesn't go through that page first.
  it('gates on requirePlatformPermission even when there is nothing to resolve', async () => {
    const result = await resolveWebhookAssociations([]);
    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(0);
  });
});
