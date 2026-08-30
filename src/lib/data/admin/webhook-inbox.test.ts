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
  webhookProviderLabel,
  WEBHOOK_KIND_VARIANTS,
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
    // 'הודעה נכנסת', not 'הודעה': four integrations now share this table, so an
    // inbound WhatsApp message has to be distinguishable from a delivery status
    // and from inbound mail at a glance.
    expect(webhookKindLabel('message')).toBe('הודעה נכנסת');
    expect(webhookKindLabel('foo')).toBe('foo');
  });

  // Regression guard for the actual defect: seven of the nine endpoints had no
  // Hebrew label, so their badge rendered the raw English slug (graph_mail,
  // call_owner_note) inside an RTL Hebrew admin. Every kind that any route can
  // write MUST be named here — a new endpoint without a label fails this test.
  it('names EVERY event_kind a route can write, in Hebrew', () => {
    const ALL_KINDS = [
      'message',
      'status',
      'graph_mail',
      'email_delivery',
      'call_result',
      'call_rsvp',
      'call_owner_note',
      'call_dnc',
      'mtg_dnc',
      'sls_dnc',
    ];
    for (const kind of ALL_KINDS) {
      const label = webhookKindLabel(kind);
      expect(label, `${kind} has no Hebrew label`).not.toBe(kind);
      expect(label, `${kind} label is not Hebrew`).toMatch(/[\u0590-\u05FF]/);
      expect(WEBHOOK_KIND_VARIANTS[kind], `${kind} has no badge variant`).toBeDefined();
    }
  });

  // A DNC row is an opt-out request — a legal obligation under the Israeli spam
  // law. It must not render as a routine neutral row in the list.
  it('flags every opt-out kind with a warning badge', () => {
    for (const kind of ['call_dnc', 'mtg_dnc', 'sls_dnc']) {
      expect(WEBHOOK_KIND_VARIANTS[kind], kind).toBe('warning');
    }
  });

  it('names every provider in Hebrew and falls back to the raw value', () => {
    for (const provider of ['whatsapp', 'graph', 'voximplant', 'resend']) {
      expect(webhookProviderLabel(provider), provider).not.toBe(provider);
    }
    expect(webhookProviderLabel('unknown')).toBe('unknown');
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

  // The provider filter. Four integrations share webhook_inbox, so without this
  // one integration's traffic could not be isolated at all — the column was
  // selected and displayed but never filterable.
  it('filters by provider, in the DB and not in the browser', async () => {
    const { builder } = mock([{ id: 'a1' }], 1);
    await listWebhookInbox({ provider: 'resend' });
    expect(builder.eq).toHaveBeenCalledWith('provider', 'resend');
  });

  // provider is COARSE (integration) and kind is FINE (route). 'voximplant' is
  // written by six routes, so the two must compose rather than override.
  it('composes provider AND kind to isolate a single voximplant route', async () => {
    const { builder } = mock([], 0);
    await listWebhookInbox({ provider: 'voximplant', kind: 'call_dnc' });
    expect(builder.eq).toHaveBeenCalledWith('provider', 'voximplant');
    expect(builder.eq).toHaveBeenCalledWith('event_kind', 'call_dnc');
  });

  it('applies no provider predicate when the filter is absent', async () => {
    const { builder } = mock([], 0);
    await listWebhookInbox({});
    expect(builder.eq).not.toHaveBeenCalledWith('provider', expect.anything());
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
