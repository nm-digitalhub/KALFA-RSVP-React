import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTemplateByKey } from '@/lib/data/message-templates';

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
