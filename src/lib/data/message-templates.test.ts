import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  getTemplateByKey,
  resolveTemplateForEvent,
} from '@/lib/data/message-templates-resolve';
import { logActivity } from '@/lib/data/activity';
import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  acknowledgeTemplateCategory,
  listMessageTemplates,
  updateMessageTemplate,
} from '@/lib/data/message-templates';

type Row = Record<string, unknown>;

beforeEach(() => vi.clearAllMocks());

function mockAdmin(result: { data: Row | null; error: { message: string } | null }) {
  const m = createMockSupabase<Row>(result);
  vi.mocked(createAdminClient).mockReturnValue(
    m.client as unknown as ReturnType<typeof createAdminClient>,
  );
  return m;
}

describe('getTemplateByKey', () => {
  it('resolves an active template by message_key', async () => {
    const { client, builder } = mockAdmin({
      data: { name: 'rsvp_invite', language: 'he', channel: 'whatsapp' },
      error: null,
    });

    const r = await getTemplateByKey('rsvp_invite');

    expect(client.from).toHaveBeenCalledWith('message_templates');
    expect(builder.eq).toHaveBeenCalledWith('message_key', 'rsvp_invite');
    expect(builder.eq).toHaveBeenCalledWith('active', true);
    expect(r).toEqual({ name: 'rsvp_invite', language: 'he', channel: 'whatsapp' });
  });

  it('returns null when no active template matches', async () => {
    mockAdmin({ data: null, error: null });
    await expect(getTemplateByKey('missing')).resolves.toBeNull();
  });
});

describe('resolveTemplateForEvent', () => {
  // Doubles as the mock row AND (spread) the expected resolved shape.
  // resolveTemplateForEvent always returns rsvpQuickReply (false unless
  // components.rsvp_quick_reply === true), so it rides along in the expectations.
  const genericRow = {
    name: 'kalfa_event_invite_v2',
    language: 'he',
    channel: 'whatsapp',
    rsvpQuickReply: false,
    paramContract: null,
  };

  it('swaps the name when components.variants has the event type', async () => {
    const { client, builder } = mockAdmin({
      data: {
        ...genericRow,
        components: { variants: { wedding: 'kalfa_wedding_invite_v1' } },
      },
      error: null,
    });

    const r = await resolveTemplateForEvent('invite', 'wedding');

    expect(client.from).toHaveBeenCalledWith('message_templates');
    expect(builder.select).toHaveBeenCalledWith('name, language, channel, components');
    expect(builder.eq).toHaveBeenCalledWith('message_key', 'invite');
    expect(builder.eq).toHaveBeenCalledWith('active', true);
    expect(r).toEqual({
      name: 'kalfa_wedding_invite_v1',
      language: 'he',
      channel: 'whatsapp',
      mediaName: null,
      rsvpQuickReply: false,
      paramContract: null,
    });
  });

  it('falls through to the generic name when no variant matches', async () => {
    // No components at all.
    mockAdmin({ data: { ...genericRow, components: null }, error: null });
    await expect(resolveTemplateForEvent('invite', 'wedding')).resolves.toEqual(
      { ...genericRow, mediaName: null },
    );

    // Variants exist but not for this event type.
    mockAdmin({
      data: {
        ...genericRow,
        components: { variants: { wedding: 'kalfa_wedding_invite_v1' } },
      },
      error: null,
    });
    await expect(resolveTemplateForEvent('invite', 'birthday')).resolves.toEqual(
      { ...genericRow, mediaName: null },
    );
  });


  it('media_variants: the per-event-type media name wins over the global fallback', async () => {
    mockAdmin({
      data: {
        ...genericRow,
        components: {
          media_variant: 'kalfa_event_invite_media_v1',
          media_variants: { brit: 'kalfa_brit_invite_trad_media_v1' },
        },
      },
      error: null,
    });
    await expect(resolveTemplateForEvent('invite', 'brit')).resolves.toEqual({
      ...genericRow,
      mediaName: 'kalfa_brit_invite_trad_media_v1',
    });

    // another event type falls back to the global media sibling
    mockAdmin({
      data: {
        ...genericRow,
        components: {
          media_variant: 'kalfa_event_invite_media_v1',
          media_variants: { brit: 'kalfa_brit_invite_trad_media_v1' },
        },
      },
      error: null,
    });
    await expect(resolveTemplateForEvent('invite', 'birthday')).resolves.toEqual({
      ...genericRow,
      mediaName: 'kalfa_event_invite_media_v1',
    });
  });

  it('media_variants: malformed shapes fall back safely', async () => {
    for (const media_variants of ['x', 42, ['a'], { brit: 9 }, { brit: ' ' }]) {
      mockAdmin({
        data: { ...genericRow, components: { media_variants } },
        error: null,
      });
      await expect(resolveTemplateForEvent('invite', 'brit')).resolves.toEqual({
        ...genericRow,
        mediaName: null,
      });
    }
  });

  it('treats malformed components as no variant, without throwing', async () => {
    const malformed: unknown[] = [
      'not-an-object',
      42,
      ['array'],
      { variants: 'not-an-object' },
      { variants: ['array'] },
      { variants: { wedding: 123 } },
      { variants: { wedding: '' } },
      { variants: { wedding: '   ' } },
      { variants: null },
    ];
    for (const components of malformed) {
      mockAdmin({ data: { ...genericRow, components }, error: null });
      await expect(resolveTemplateForEvent('invite', 'wedding')).resolves.toEqual(
        { ...genericRow, mediaName: null },
      );
    }
  });

  it('rsvp_quick_reply is EVENT-TYPE-scoped: true only for the enabled event type', async () => {
    // brit enabled in the map → rsvpQuickReply true.
    mockAdmin({
      data: { ...genericRow, components: { rsvp_quick_reply: { brit: true } } },
      error: null,
    });
    await expect(resolveTemplateForEvent('invite', 'brit')).resolves.toMatchObject({
      rsvpQuickReply: true,
    });

    // the SAME key for a non-enabled event type → false (never injects for wedding).
    mockAdmin({
      data: { ...genericRow, components: { rsvp_quick_reply: { brit: true } } },
      error: null,
    });
    await expect(resolveTemplateForEvent('invite', 'wedding')).resolves.toMatchObject({
      rsvpQuickReply: false,
    });

    // malformed map shapes fall back to off, never throwing.
    for (const rsvp_quick_reply of ['x', 42, ['brit'], { brit: 1 }, { brit: 'yes' }, null]) {
      mockAdmin({ data: { ...genericRow, components: { rsvp_quick_reply } }, error: null });
      await expect(resolveTemplateForEvent('invite', 'brit')).resolves.toMatchObject({
        rsvpQuickReply: false,
      });
    }
  });

  it('paramContract resolves per event type from components.param_contract', async () => {
    // brit → its personal contract.
    mockAdmin({
      data: { ...genericRow, components: { param_contract: { brit: 'brit_trad_invite' } } },
      error: null,
    });
    await expect(resolveTemplateForEvent('invite', 'brit')).resolves.toMatchObject({
      paramContract: 'brit_trad_invite',
    });

    // a different event type → null (falls back to the standard tuple).
    mockAdmin({
      data: { ...genericRow, components: { param_contract: { brit: 'brit_trad_invite' } } },
      error: null,
    });
    await expect(resolveTemplateForEvent('invite', 'wedding')).resolves.toMatchObject({
      paramContract: null,
    });

    // malformed shapes fall back to null, never throwing.
    for (const param_contract of ['x', 42, ['brit'], { brit: 9 }, { brit: '' }, null]) {
      mockAdmin({ data: { ...genericRow, components: { param_contract } }, error: null });
      await expect(resolveTemplateForEvent('invite', 'brit')).resolves.toMatchObject({
        paramContract: null,
      });
    }
  });

  it('returns null when no active row matches (inactive stays fail-closed)', async () => {
    // active=false rows never reach the resolver — the query filters on
    // active=true, so an inactive-only key resolves to no data.
    const { builder } = mockAdmin({ data: null, error: null });
    await expect(resolveTemplateForEvent('invite', 'wedding')).resolves.toBeNull();
    expect(builder.eq).toHaveBeenCalledWith('active', true);
  });

  it('returns null on query error or null required fields', async () => {
    mockAdmin({ data: null, error: { message: 'boom' } });
    await expect(resolveTemplateForEvent('invite', 'wedding')).resolves.toBeNull();

    mockAdmin({
      data: { ...genericRow, name: null, components: null },
      error: null,
    });
    await expect(resolveTemplateForEvent('invite', 'wedding')).resolves.toBeNull();
  });
});

function mockCookie<T>(result: { data: T | null; error: { message: string } | null }) {
  const m = createMockSupabase<T>(result);
  vi.mocked(createClient).mockResolvedValue(
    m.client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return m;
}

describe('listMessageTemplates', () => {
  it('reads all templates via the admin cookie client', async () => {
    const { client, builder } = mockCookie<Row[]>({
      data: [{ id: 't1', message_key: 'invite', channel: 'whatsapp' }],
      error: null,
    });
    const r = await listMessageTemplates();
    expect(client.from).toHaveBeenCalledWith('message_templates');
    expect(builder.order).toHaveBeenCalledWith('channel', { ascending: true });
    expect(r).toHaveLength(1);
  });
});

describe('updateMessageTemplate', () => {
  it('updates content + active, mapping empty body to null', async () => {
    const { builder } = mockCookie<Row>({ data: null, error: null });
    await updateMessageTemplate('t1', {
      name: 'rsvp_invite_he',
      language: 'he',
      body: '',
      active: true,
    });
    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.name).toBe('rsvp_invite_he');
    expect(payload.active).toBe(true);
    expect(payload.body).toBeNull();
    expect(builder.eq).toHaveBeenCalledWith('id', 't1');
  });
});

// ── acknowledgeTemplateCategory (D4) ────────────────────────────────────────
// A bespoke double rather than createMockSupabase: this function READS and then
// WRITES, and the two calls must be able to answer differently — the whole point
// of the pin is what happens when the row moved between them.
type AckRow = {
  id: string;
  message_key: string;
  category: string | null;
  requested_category: string;
};

const ROW_ID = '22222222-2222-4222-8222-222222222222';
const BASE: AckRow = {
  id: ROW_ID,
  message_key: 'gift',
  category: 'MARKETING',
  requested_category: 'UTILITY',
};

/** `updated` is what the pinned UPDATE ... .select('id') matched. */
function mockAck(row: AckRow | null, updated: Array<{ id: string }> = [{ id: ROW_ID }]) {
  const calls: { update?: Record<string, unknown>; eq: Array<[string, unknown]> } = {
    eq: [],
  };
  vi.mocked(createClient).mockResolvedValue({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
      update: (values: Record<string, unknown>) => {
        calls.update = values;
        const chain = {
          eq: (col: string, val: unknown) => {
            calls.eq.push([col, val]);
            return chain;
          },
          select: async () => ({ data: updated, error: null }),
        };
        return chain;
      },
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return calls;
}

describe('acknowledgeTemplateCategory', () => {
  it('writes Meta’s category into requested_category and audits the move', async () => {
    const calls = mockAck(BASE);
    const r = await acknowledgeTemplateCategory(ROW_ID, 'MARKETING');
    expect(r).toEqual({ ok: true, from: 'UTILITY', to: 'MARKETING' });
    expect(calls.update).toEqual({ requested_category: 'MARKETING' });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.templates.category_acknowledged',
      meta: { message_key: 'gift', from: 'UTILITY', to: 'MARKETING' },
    });
  });

  it('PINS the write to the category that was on screen', async () => {
    // Without the pin, a sync landing between page load and click would get a
    // different value accepted silently.
    const calls = mockAck(BASE);
    await acknowledgeTemplateCategory(ROW_ID, 'MARKETING');
    expect(calls.eq).toContainEqual(['category', 'MARKETING']);
  });

  it('refuses when the category moved since the page was rendered', async () => {
    const calls = mockAck({ ...BASE, category: 'AUTHENTICATION' });
    const r = await acknowledgeTemplateCategory(ROW_ID, 'MARKETING');
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('רעננו') });
    expect(calls.update).toBeUndefined();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('refuses when the pinned UPDATE matched nothing — the race caught late', async () => {
    const calls = mockAck(BASE, []);
    const r = await acknowledgeTemplateCategory(ROW_ID, 'MARKETING');
    expect(r.ok).toBe(false);
    // The write was ATTEMPTED and matched no row; nothing changed, and no audit
    // row claims something did.
    expect(calls.update).toEqual({ requested_category: 'MARKETING' });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('refuses a template that has never been synced', async () => {
    const calls = mockAck({ ...BASE, category: null });
    const r = await acknowledgeTemplateCategory(ROW_ID, 'MARKETING');
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('טרם סונכרנה') });
    expect(calls.update).toBeUndefined();
  });

  it('refuses when there is no drift to accept', async () => {
    const calls = mockAck({ ...BASE, requested_category: 'MARKETING' });
    const r = await acknowledgeTemplateCategory(ROW_ID, 'MARKETING');
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('אין פער') });
    expect(calls.update).toBeUndefined();
  });

  it('gates on manage_settings', async () => {
    mockAck(BASE);
    await acknowledgeTemplateCategory(ROW_ID, 'MARKETING');
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });
});
