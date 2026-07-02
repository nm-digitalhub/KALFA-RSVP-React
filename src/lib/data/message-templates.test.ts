import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  getTemplateByKey,
  listMessageTemplates,
  resolveTemplateForEvent,
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
  const genericRow = {
    name: 'kalfa_event_invite_v2',
    language: 'he',
    channel: 'whatsapp',
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
    });
  });

  it('falls through to the generic name when no variant matches', async () => {
    // No components at all.
    mockAdmin({ data: { ...genericRow, components: null }, error: null });
    await expect(resolveTemplateForEvent('invite', 'wedding')).resolves.toEqual(
      genericRow,
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
      genericRow,
    );
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
        genericRow,
      );
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
