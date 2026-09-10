// The integrations panel's status row, and the two things it must never do:
// load a credential to print a tick, and conflate "not configured" with "switched
// off".
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/analytics/ga4-config', () => ({ getGa4ConfigStatus: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ envAllowsLiveCalls: vi.fn(() => true) }));

import { createClient } from '@/lib/supabase/server';
import { getGa4ConfigStatus } from '@/lib/analytics/ga4-config';
import { envAllowsLiveCalls } from '@/lib/data/voximplant-config';

import { getIntegrationsStatus, getIntegrationsConfiguredFlags } from './integrations';
import type { JobHealthRow } from './db-health';

/** Everything present and switched on — the measured state of the live row on 2026-09-10. */
const ALL_ON = {
  whatsapp_configured: true,
  whatsapp_enabled: true,
  voximplant_configured: true,
  voximplant_enabled: true,
  extra_sms_configured: true,
  extra_sms_enabled: true,
  email_configured: true,
  email_enabled: true,
  sumit_configured: true,
  sumit_enabled: true,
  slack_configured: true,
  slack_enabled: true,
  elevenlabs_configured: true,
};

/** `rows` is what the RPC returns — [] is the staff gate refusing, not "all off". */
function mockRpc(rows: unknown[] | null, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  return rpc;
}

const NO_JOBS: JobHealthRow[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGa4ConfigStatus).mockResolvedValue({ ok: true } as never);
  vi.mocked(envAllowsLiveCalls).mockReturnValue(true);
  delete process.env.ELEVENLABS_API_KEY;
});

describe('getIntegrationsConfiguredFlags', () => {
  it('asks the database once, through the COOKIE client', async () => {
    const rpc = mockRpc([ALL_ON]);

    await getIntegrationsConfiguredFlags();

    // The cookie client, not createAdminClient: the RPC is SECURITY DEFINER and
    // gates on is_platform_staff() internally, which needs the CALLER's auth.uid().
    // Service-role would arrive with no uid and be refused.
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('integrations_configured_flags');
  });

  it('returns null on zero rows — the staff gate refusing is NOT "nothing is configured"', async () => {
    mockRpc([]);
    expect(await getIntegrationsConfiguredFlags()).toBeNull();
  });

  it('returns null on an error rather than guessing', async () => {
    mockRpc(null, { message: 'boom' });
    expect(await getIntegrationsConfiguredFlags()).toBeNull();
  });
});

describe('getIntegrationsStatus', () => {
  const byKey = async (rows: unknown[] = [ALL_ON], jobs: JobHealthRow[] = NO_JOBS) => {
    mockRpc(rows);
    const items = await getIntegrationsStatus(jobs);
    return Object.fromEntries(items.map((i) => [i.key, i]));
  };

  it('throws when the flags are unavailable, so the panel shows a reason', async () => {
    // Fail CLOSED and visibly. Returning a list of `configured: false` would render
    // as "every provider is unconfigured" — a confident wrong answer, and the exact
    // ambiguity the RPC returns zero rows to avoid.
    mockRpc([]);
    await expect(getIntegrationsStatus(NO_JOBS)).rejects.toThrow();
  });

  it('reads NO credential — the five secret-returning resolvers are gone', async () => {
    // The regression guard. This module used to call getWhatsAppConfig,
    // getVoximplantConfig, getElevenLabsApiKeyWithSource, getAlertsConfig and
    // getSumitServerConfig — five functions that each return the real credential —
    // purely to test it for null. Nothing leaked (only booleans are rendered), but
    // five secrets sat in process memory on every /admin/debug load. A textual
    // check, deliberately: mocking them would prove they are not called in THIS
    // test, while this proves they are not imported at all.
    const raw = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./integrations.ts', import.meta.url), 'utf8'),
    );
    // Comments are stripped first, deliberately. The file's header NAMES those five
    // functions to explain what it stopped doing and why — that explanation is worth
    // more than the convenience of a blunter grep, and a comment cannot call anything.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'getWhatsAppConfig',
      'getVoximplantConfig',
      'getElevenLabsApiKeyWithSource',
      'getAlertsConfig',
      'getSumitServerConfig',
      'getSmsSender',
    ]) {
      expect(source, `${forbidden} returns a credential and must not be used to derive a boolean`)
        .not.toContain(forbidden);
    }
  });

  it('separates "configured" from "switched off" — the ExtrA bug', async () => {
    // getSmsSender() threw SmsConfigError when `!sms_enabled || !token || !sender`,
    // so turning the SMS switch OFF made the panel report ExtrA as NOT CONFIGURED.
    const items = await byKey([{ ...ALL_ON, extra_sms_enabled: false }]);
    expect(items['extra-sms'].configured).toBe(true);
    expect(items['extra-sms'].enabled).toBe(false);
  });

  it('carries each provider its own switch', async () => {
    const items = await byKey([
      { ...ALL_ON, whatsapp_enabled: false, sumit_enabled: false, slack_enabled: false },
    ]);
    expect(items.whatsapp).toMatchObject({ configured: true, enabled: false });
    expect(items.sumit).toMatchObject({ configured: true, enabled: false });
    expect(items.slack).toMatchObject({ configured: true, enabled: false });
    expect(items.voximplant).toMatchObject({ configured: true, enabled: true });
  });

  it('ORs the ElevenLabs env fallback, which SQL cannot see', async () => {
    const off = await byKey([{ ...ALL_ON, elevenlabs_configured: false }]);
    expect(off.elevenlabs.configured).toBe(false);

    process.env.ELEVENLABS_API_KEY = 'sk-from-env';
    const on = await byKey([{ ...ALL_ON, elevenlabs_configured: false }]);
    expect(on.elevenlabs.configured).toBe(true);
  });

  it('ANDs the Voximplant kill switch over the DB toggle', async () => {
    // VOXIMPLANT_LIVE_CALLS='false' is an emergency stop no admin click can undo.
    vi.mocked(envAllowsLiveCalls).mockReturnValue(false);
    const items = await byKey([ALL_ON]);
    expect(items.voximplant.configured).toBe(true);
    expect(items.voximplant.enabled).toBe(false);
  });

  it('says plainly when a provider has no switch at all', async () => {
    // ElevenLabs and GA4 have no enabled column. Mirroring `configured` is the
    // honest answer; inventing a switch would be worse than saying there is none.
    const items = await byKey([ALL_ON]);
    expect(items.elevenlabs.enabled).toBe(items.elevenlabs.configured);
    expect(items.ga4.enabled).toBe(items.ga4.configured);
  });

  it('keeps GA4 on its env probe', async () => {
    vi.mocked(getGa4ConfigStatus).mockResolvedValue({ ok: false, issue: 'missing_property_id' } as never);
    const items = await byKey([ALL_ON]);
    expect(items.ga4.configured).toBe(false);
  });

  it('still derives "last checked" from pg-boss, never a live provider call', async () => {
    const items = await byKey([ALL_ON], [
      { queueName: 'voximplant-balance-check', lastCompletedOn: '2026-09-10T09:00:00Z' },
      { queueName: 'elevenlabs-quota-check', lastCompletedOn: '2026-09-10T08:00:00Z' },
    ] as JobHealthRow[]);
    expect(items.voximplant.lastCheckedAt).toBe('2026-09-10T09:00:00Z');
    expect(items.elevenlabs.lastCheckedAt).toBe('2026-09-10T08:00:00Z');
    expect(items.whatsapp.lastCheckedAt).toBeNull();
  });

  it('covers every provider the panel expects, plus the two the plan adds', async () => {
    const items = await byKey();
    expect(Object.keys(items).sort()).toEqual(
      ['elevenlabs', 'extra-sms', 'ga4', 'resend-email', 'slack', 'sumit', 'voximplant', 'whatsapp'].sort(),
    );
  });
});
