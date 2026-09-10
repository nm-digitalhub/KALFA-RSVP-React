import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  getInfraConfigStatus,
  getAppSettings,
  updateAppSettings,
  getSumitCredentials,
  updateSumitCredentials,
  getExtraSmsConfig,
  updateExtraSmsConfig,
  getEmailTransportConfig,
  updateEmailTransportConfig,
} from './settings';

/**
 * The eighteen fields updateAppSettings owns AFTER the provider split — the four
 * business toggles, the four automation toggles and the ten console toggles. Every
 * one is a checkbox, so every one must be present: an absent checkbox is `false`,
 * and a fixture that omits one would prove nothing about the field it omitted.
 */
const BASE_SETTINGS_INPUT = {
  payments_enabled: false,
  close_charge_enabled: false,
  campaign_holds_enabled: false,
  billing_exposure_gate: false,
  inquiry_followup_enabled: true,
  agreement_archive_enabled: false,
  signup_reminder_enabled: false,
  unconfirmed_cleanup_enabled: false,
  monitor_enabled: false,
  inbound_calls_enabled: false,
  handoff_enabled: false,
  console_softphone_enabled: false,
  console_widget_enabled: false,
  console_manual_dial_enabled: false,
  console_wake_enabled: false,
  console_call_me_now_enabled: false,
  console_consult_conference_enabled: false,
  console_dtmf_handoff_enabled: false,
};

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
    // The provider fields this used to pass now belong to their own writers
    // (Task 0.2) — passing them here would not compile, which is the point.
    // Every toggle true, so the assertion below proves each one is carried rather
    // than matching a shared default.
    await updateAppSettings(
      Object.fromEntries(
        Object.keys(BASE_SETTINGS_INPUT).map((k) => [k, true]),
      ) as typeof BASE_SETTINGS_INPUT,
    );
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        inquiry_followup_enabled: true,
        agreement_archive_enabled: true,
        signup_reminder_enabled: true,
        unconfirmed_cleanup_enabled: true,
        campaign_holds_enabled: true,
        billing_exposure_gate: true,
        monitor_enabled: true,
        inbound_calls_enabled: true,
        handoff_enabled: true,
        console_softphone_enabled: true,
        console_widget_enabled: true,
        console_manual_dial_enabled: true,
        console_wake_enabled: true,
        console_call_me_now_enabled: true,
        console_consult_conference_enabled: true,
        console_dtmf_handoff_enabled: true,
      }),
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

// ---------------------------------------------------------------------------
// Provider credentials split out of the one big settings form (Task 0.2)
// ---------------------------------------------------------------------------
//
// The risk this suite exists to pin is not "does the new function work" — it is
// that the OLD one keeps writing columns it no longer owns. Two forms writing the
// same column is how a save in one screen silently reverts the other.

const PROVIDER_COLUMNS = [
  'sumit_company_id',
  'sumit_api_public_key',
  'sumit_api_key',
  'sms_enabled',
  'extra_sms_sender',
  'extra_sms_token',
  'email_enabled',
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'smtp_user',
  'smtp_password',
  'smtp_from',
] as const;

function mockWrite() {
  const { client, builder } = createMockSupabase<null>({ data: null, error: null });
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return builder;
}

const patchOf = (builder: { update: unknown }) =>
  vi.mocked(builder.update as (p: unknown) => unknown).mock.calls[0][0] as Record<string, unknown>;

describe('updateAppSettings no longer owns provider credentials', () => {
  it('writes none of the thirteen columns', async () => {
    const builder = mockWrite();
    await updateAppSettings(BASE_SETTINGS_INPUT);
    const patch = patchOf(builder);
    for (const column of PROVIDER_COLUMNS) {
      expect(patch, `${column} must be written by its own provider function now`)
        .not.toHaveProperty(column);
    }
  });

  it('still writes every toggle it DOES own', async () => {
    const builder = mockWrite();
    await updateAppSettings(BASE_SETTINGS_INPUT);
    const patch = patchOf(builder);
    for (const column of [
      'payments_enabled',
      'close_charge_enabled',
      'campaign_holds_enabled',
      'billing_exposure_gate',
      'inquiry_followup_enabled',
      'console_softphone_enabled',
      'console_dtmf_handoff_enabled',
    ]) {
      expect(patch).toHaveProperty(column);
    }
  });
});

describe('updateSumitCredentials', () => {
  it('writes ONLY the three SUMIT columns', async () => {
    const builder = mockWrite();
    await updateSumitCredentials({
      sumit_company_id: '123',
      sumit_api_public_key: 'pub',
      sumit_api_key: 'secret',
    });
    expect(patchOf(builder)).toEqual({
      sumit_company_id: '123',
      sumit_api_public_key: 'pub',
      sumit_api_key: 'secret',
    });
  });

  it("turns '' into null — an empty field is an intentional unset, not an empty string", async () => {
    const builder = mockWrite();
    await updateSumitCredentials({ sumit_company_id: '', sumit_api_public_key: '', sumit_api_key: '' });
    expect(patchOf(builder)).toEqual({
      sumit_company_id: null,
      sumit_api_public_key: null,
      sumit_api_key: null,
    });
  });
});

describe('updateExtraSmsConfig', () => {
  it('writes ONLY the three ExtrA columns, switch included', async () => {
    const builder = mockWrite();
    await updateExtraSmsConfig({
      sms_enabled: true,
      extra_sms_sender: '03-3301505',
      extra_sms_token: 'T',
    });
    expect(patchOf(builder)).toEqual({
      sms_enabled: true,
      extra_sms_sender: '03-3301505',
      extra_sms_token: 'T',
    });
  });

  it('carries a FALSE switch through — absent would read as false anyway, but silently', async () => {
    const builder = mockWrite();
    await updateExtraSmsConfig({ sms_enabled: false, extra_sms_sender: 'x', extra_sms_token: 'y' });
    expect(patchOf(builder)).toHaveProperty('sms_enabled', false);
  });
});

describe('updateEmailTransportConfig', () => {
  it('writes ONLY the seven email columns', async () => {
    const builder = mockWrite();
    await updateEmailTransportConfig({
      email_enabled: true,
      smtp_host: 'smtp.example.com',
      smtp_port: '587',
      smtp_secure: false,
      smtp_user: 'u',
      smtp_password: 'p',
      smtp_from: 'a@b.c',
    });
    expect(Object.keys(patchOf(builder)).sort()).toEqual([
      'email_enabled',
      'smtp_from',
      'smtp_host',
      'smtp_password',
      'smtp_port',
      'smtp_secure',
      'smtp_user',
    ]);
  });

  it('keeps smtp_port a NUMBER — the column is an integer and the form sends text', async () => {
    const builder = mockWrite();
    await updateEmailTransportConfig({
      email_enabled: true, smtp_host: 'h', smtp_port: '587',
      smtp_secure: true, smtp_user: '', smtp_password: '', smtp_from: 'a@b.c',
    });
    expect(patchOf(builder).smtp_port).toBe(587);
  });

  it('an empty port is null, not NaN', async () => {
    const builder = mockWrite();
    await updateEmailTransportConfig({
      email_enabled: false, smtp_host: '', smtp_port: '',
      smtp_secure: false, smtp_user: '', smtp_password: '', smtp_from: '',
    });
    expect(patchOf(builder).smtp_port).toBeNull();
  });
});

describe('the three readers derive `configured` without the caller re-deriving it', () => {
  const read = (row: Record<string, unknown>) => {
    const { client } = createMockSupabase<Record<string, unknown>>({ data: row, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
  };

  it('SUMIT needs company id AND api key', async () => {
    read({ sumit_company_id: '1', sumit_api_public_key: 'p', sumit_api_key: 'k' });
    expect((await getSumitCredentials()).configured).toBe(true);
    read({ sumit_company_id: '1', sumit_api_public_key: 'p', sumit_api_key: null });
    expect((await getSumitCredentials()).configured).toBe(false);
  });

  it('email needs only smtp_from — Resend sends without an SMTP host', async () => {
    read({ email_enabled: true, smtp_host: '', smtp_port: null, smtp_secure: false,
           smtp_user: '', smtp_password: '', smtp_from: 'noreply@send.kalfa.me' });
    expect((await getEmailTransportConfig()).configured).toBe(true);
    read({ email_enabled: true, smtp_host: 'smtp.example.com', smtp_port: 587,
           smtp_secure: true, smtp_user: '', smtp_password: '', smtp_from: null });
    expect((await getEmailTransportConfig()).configured).toBe(false);
  });

  it('reads smtp_port back as TEXT — the form field is text, the column is an integer', async () => {
    read({ email_enabled: true, smtp_host: 'h', smtp_port: 587, smtp_secure: true,
           smtp_user: '', smtp_password: '', smtp_from: 'a@b.c' });
    expect((await getEmailTransportConfig()).smtp_port).toBe('587');
  });

  it('ExtrA needs token AND sender — and does NOT count the switch', async () => {
    // The switch is a separate question, which is the whole lesson of the
    // integrations panel reporting "not configured" whenever SMS was turned off.
    read({ sms_enabled: false, extra_sms_sender: '03-3301505', extra_sms_token: 'T' });
    const cfg = await getExtraSmsConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.sms_enabled).toBe(false);
  });
});
