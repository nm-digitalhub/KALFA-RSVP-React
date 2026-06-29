import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

type Row = Record<string, unknown>;

beforeEach(() => vi.clearAllMocks());

function mockAdmin(result: { data: Row | null; error: { message: string } | null }) {
  const { client } = createMockSupabase<Row>(result);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
}
function mockAdminThrows() {
  vi.mocked(createAdminClient).mockImplementation(() => {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  });
}

describe('getOutreachEnabled', () => {
  it('true only when the column is present and on', async () => {
    mockAdmin({ data: { outreach_enabled: true }, error: null });
    await expect(getOutreachEnabled()).resolves.toBe(true);
  });
  it('false when off', async () => {
    mockAdmin({ data: { outreach_enabled: false }, error: null });
    await expect(getOutreachEnabled()).resolves.toBe(false);
  });
  it('false (fail-closed) when the column is absent (pre-migration)', async () => {
    mockAdmin({ data: { payments_enabled: true }, error: null });
    await expect(getOutreachEnabled()).resolves.toBe(false);
  });
  it('false on a read error', async () => {
    mockAdmin({ data: null, error: { message: 'boom' } });
    await expect(getOutreachEnabled()).resolves.toBe(false);
  });
  it('false when the admin client cannot be created', async () => {
    mockAdminThrows();
    await expect(getOutreachEnabled()).resolves.toBe(false);
  });
});

describe('getWhatsAppConfig', () => {
  it('returns the config when phone-number-id and token are present', async () => {
    mockAdmin({
      data: {
        whatsapp_phone_number_id: 'PNID',
        whatsapp_access_token: 'TKN',
        whatsapp_app_secret: 'SEC',
        whatsapp_verify_token: 'VT',
      },
      error: null,
    });
    await expect(getWhatsAppConfig()).resolves.toEqual({
      phoneNumberId: 'PNID',
      wabaId: null,
      accessToken: 'TKN',
      appSecret: 'SEC',
      verifyToken: 'VT',
    });
  });
  it('null when the phone-number-id is missing', async () => {
    mockAdmin({ data: { whatsapp_access_token: 'TKN' }, error: null });
    await expect(getWhatsAppConfig()).resolves.toBeNull();
  });
  it('null when the token is missing', async () => {
    mockAdmin({ data: { whatsapp_phone_number_id: 'PNID' }, error: null });
    await expect(getWhatsAppConfig()).resolves.toBeNull();
  });
  it('null on error / pre-migration', async () => {
    mockAdmin({ data: null, error: { message: 'x' } });
    await expect(getWhatsAppConfig()).resolves.toBeNull();
  });
});
