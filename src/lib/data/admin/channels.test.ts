import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import {
  getWhatsAppChannelConfig,
  updateWhatsAppChannelConfig,
} from '@/lib/data/admin/channels';

type Row = {
  outreach_enabled: boolean;
  whatsapp_phone_number_id: string | null;
  whatsapp_access_token: string | null;
  whatsapp_app_secret: string | null;
  whatsapp_verify_token: string | null;
};

function mock(row: Row | null) {
  const { client, builder } = createMockSupabase<Row>({ data: row, error: null });
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { client, builder };
}

beforeEach(() => vi.clearAllMocks());

describe('getWhatsAppChannelConfig', () => {
  it('reports configured=true when both phone id and token are present', async () => {
    mock({
      outreach_enabled: false,
      whatsapp_phone_number_id: 'PNID',
      whatsapp_access_token: 'TOK',
      whatsapp_app_secret: null,
      whatsapp_verify_token: 'verify',
    });
    const cfg = await getWhatsAppChannelConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.whatsapp_phone_number_id).toBe('PNID');
    expect(cfg.whatsapp_app_secret).toBe(''); // null coalesced to ''
  });

  it('reports configured=false when the token is missing', async () => {
    mock({
      outreach_enabled: false,
      whatsapp_phone_number_id: 'PNID',
      whatsapp_access_token: null,
      whatsapp_app_secret: null,
      whatsapp_verify_token: null,
    });
    const cfg = await getWhatsAppChannelConfig();
    expect(cfg.configured).toBe(false);
  });

  it('handles a missing settings row (all empty, not configured)', async () => {
    mock(null);
    const cfg = await getWhatsAppChannelConfig();
    expect(cfg.configured).toBe(false);
    expect(cfg.outreach_enabled).toBe(false);
    expect(cfg.whatsapp_access_token).toBe('');
  });
});

describe('updateWhatsAppChannelConfig', () => {
  it('persists the toggle + maps empty strings to null (intentional unset)', async () => {
    const { builder } = mock(null);
    await updateWhatsAppChannelConfig({
      outreach_enabled: true,
      whatsapp_phone_number_id: 'PNID',
      whatsapp_waba_id: 'WABA123',
      whatsapp_access_token: 'TOK',
      whatsapp_app_secret: '',
      whatsapp_verify_token: '',
    });
    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.outreach_enabled).toBe(true);
    expect(payload.whatsapp_phone_number_id).toBe('PNID');
    expect(payload.whatsapp_waba_id).toBe('WABA123');
    expect(payload.whatsapp_app_secret).toBeNull();
    expect(payload.whatsapp_verify_token).toBeNull();
  });
});
