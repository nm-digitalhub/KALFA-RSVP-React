import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { getInfraConfigStatus, getAppSettings, updateAppSettings } from './settings';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as never);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getAppSettings / updateAppSettings — inquiry_followup_enabled', () => {
  it('getAppSettings fails closed (false) when the column is null', async () => {
    const { client } = createMockSupabase<{ inquiry_followup_enabled: boolean | null }>({
      data: { inquiry_followup_enabled: null },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const settings = await getAppSettings();
    expect(settings.inquiry_followup_enabled).toBe(false);
  });

  it('updateAppSettings writes inquiry_followup_enabled through to the update payload', async () => {
    const { client, builder } = createMockSupabase<null>({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await updateAppSettings({
      payments_enabled: false,
      close_charge_enabled: false,
      sumit_company_id: '',
      sumit_api_public_key: '',
      sumit_api_key: '',
      sms_enabled: false,
      extra_sms_sender: '',
      extra_sms_token: '',
      email_enabled: false,
      smtp_host: '',
      smtp_port: '',
      smtp_secure: false,
      smtp_user: '',
      smtp_password: '',
      smtp_from: '',
      inquiry_followup_enabled: true,
    });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ inquiry_followup_enabled: true }),
    );
  });
});

describe('getInfraConfigStatus', () => {
  it('reports SUPABASE_SERVICE_ROLE_KEY as configured:false when unset', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const items = await getInfraConfigStatus();

    expect(
      items.find((i) => i.key === 'SUPABASE_SERVICE_ROLE_KEY')?.configured,
    ).toBe(false);
  });

  it('reports SUPABASE_SERVICE_ROLE_KEY as configured:false for the placeholder value', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service-role-key';

    const items = await getInfraConfigStatus();

    expect(
      items.find((i) => i.key === 'SUPABASE_SERVICE_ROLE_KEY')?.configured,
    ).toBe(false);
  });

  it('reports SUPABASE_SERVICE_ROLE_KEY as configured:true for a real value', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-real-looking-service-role-key';

    const items = await getInfraConfigStatus();

    expect(
      items.find((i) => i.key === 'SUPABASE_SERVICE_ROLE_KEY')?.configured,
    ).toBe(true);
  });

  it('gates on requirePlatformPermission and never evaluates config when it redirects', async () => {
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(redirectErr);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-real-looking-service-role-key';

    await expect(getInfraConfigStatus()).rejects.toThrow('NEXT_REDIRECT');
  });
});
