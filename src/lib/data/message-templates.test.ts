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
