import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getOutreachEnabled,
  getWhatsAppChannel,
  getWhatsAppConfig,
} from '@/lib/data/outreach-config';
import { resolveNumberForRoleStrict } from '@/lib/data/provider-numbers-resolve';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/provider-numbers-resolve', () => ({
  resolveNumberForRoleStrict: vi.fn(),
}));

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

// ---------------------------------------------------------------------------
// The inbound router's view of the channel. Everything here is about one
// question: when is the split considered LIVE? Anything short of a usable
// assignment must read as legacy, because legacy = today's behaviour.
describe('getWhatsAppChannel', () => {
  const CONFIGURED = {
    whatsapp_phone_number_id: 'PNID',
    whatsapp_access_token: 'TKN',
    whatsapp_app_secret: 'SEC',
    whatsapp_verify_token: 'VT',
  };

  it('role unassigned → legacy (import fields null) — how this ships', async () => {
    mockAdmin({ data: CONFIGURED, error: null });
    vi.mocked(resolveNumberForRoleStrict).mockResolvedValue(null);
    await expect(getWhatsAppChannel()).resolves.toEqual({
      phoneNumberId: 'PNID',
      wabaId: null,
      accessToken: 'TKN',
      appSecret: 'SEC',
      verifyToken: 'VT',
      importPhoneNumberId: null,
      importDisplayNumber: null,
    });
  });

  it('role assigned → carries the Meta id and the E.164 form', async () => {
    mockAdmin({ data: CONFIGURED, error: null });
    vi.mocked(resolveNumberForRoleStrict).mockResolvedValue({
      e164: '+97233301505',
      providerRef: '1298694319994421',
    });
    await expect(getWhatsAppChannel()).resolves.toMatchObject({
      importPhoneNumberId: '1298694319994421',
      importDisplayNumber: '+97233301505',
    });
  });

  it('a row with no Meta phone_number_id is NOT a usable assignment', async () => {
    // There would be nothing to route on; treating it as live would classify
    // every RSVP reply as "unknown" and stop billing.
    mockAdmin({ data: CONFIGURED, error: null });
    vi.mocked(resolveNumberForRoleStrict).mockResolvedValue({
      e164: '+97233301505',
      providerRef: null,
    });
    await expect(getWhatsAppChannel()).resolves.toMatchObject({
      importPhoneNumberId: null,
      importDisplayNumber: null,
    });
  });

  it('the RSVP number given the import role reads as legacy, not as a split', async () => {
    // One number cannot be both. Honouring it would classify every inbound
    // reply as 'import' and silently stop all billing.
    mockAdmin({ data: CONFIGURED, error: null });
    vi.mocked(resolveNumberForRoleStrict).mockResolvedValue({
      e164: '+97237219347',
      providerRef: 'PNID',
    });
    await expect(getWhatsAppChannel()).resolves.toMatchObject({
      importPhoneNumberId: null,
      importDisplayNumber: null,
    });
  });

  it('null when WhatsApp is not configured at all — the role is never asked', async () => {
    mockAdmin({ data: { whatsapp_access_token: 'TKN' }, error: null });
    await expect(getWhatsAppChannel()).resolves.toBeNull();
    expect(resolveNumberForRoleStrict).not.toHaveBeenCalled();
  });

  it('PROPAGATES a role read failure instead of reporting legacy', async () => {
    mockAdmin({ data: CONFIGURED, error: null });
    vi.mocked(resolveNumberForRoleStrict).mockRejectedValue(new Error('connection reset'));
    await expect(getWhatsAppChannel()).rejects.toThrow(/connection reset/);
  });
});
