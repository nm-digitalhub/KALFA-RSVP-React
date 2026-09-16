import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/channels', () => ({
  updateWhatsAppChannelConfig: vi.fn(),
  testWhatsAppConnection: vi.fn(),
}));
// actions.ts now also imports the Voximplant channel + outreach-master DALs
// (both `server-only`). Stub them so importing './actions' doesn't pull the
// server-only guard into this Node test suite.
// `./actions` imports this DAL, and it is `server-only` — an unstubbed
// server-only import fails the whole FILE at import time, not one test.
// Same gotcha the channel-catalog DAL caused here in July.
vi.mock('@/lib/data/admin/voice-purposes', () => ({
  createVoicePurpose: vi.fn(),
  updateVoicePurpose: vi.fn(),
  listVoicePurposesForAdmin: vi.fn(),
}));
vi.mock('@/lib/data/admin/voximplant-channel', () => ({
  getVoximplantChannelConfig: vi.fn(),
  updateVoximplantChannelConfig: vi.fn(),
  testVoximplantConnection: vi.fn(),
  updateVoximplantLiveCalls: vi.fn(),
  updateCallConsentRequired: vi.fn(),
}));
vi.mock('@/lib/data/admin/outreach-master', () => ({
  getOutreachMasterState: vi.fn(),
  setOutreachEnabled: vi.fn(),
}));
vi.mock('@/lib/data/admin/channel-catalog', () => ({
  updateChannelMetadata: vi.fn(),
}));
vi.mock('@/lib/data/admin/integrations/send-policy', () => ({
  updateSendPolicy: vi.fn(),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { updateWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import {
  getVoximplantChannelConfig,
  updateVoximplantLiveCalls,
  updateCallConsentRequired,
} from '@/lib/data/admin/voximplant-channel';
import { updateChannelMetadata } from '@/lib/data/admin/channel-catalog';
import { updateSendPolicy } from '@/lib/data/admin/integrations/send-policy';
import { DEFAULT_SEND_POLICY } from '@/lib/outreach/send-policy';
import {
  updateWhatsAppChannelAction,
  updateVoximplantLiveCallsAction,
  updateCallConsentRequiredAction,
  updateChannelCatalogAction,
  updateSendPolicyAction,
} from './actions';

type VoxChannelConfig = Awaited<ReturnType<typeof getVoximplantChannelConfig>>;

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = {
  whatsapp_phone_number_id: '',
  whatsapp_waba_id: '',
  whatsapp_access_token: '',
  whatsapp_app_secret: '',
  whatsapp_verify_token: '',
};

beforeEach(() => vi.clearAllMocks());

describe('updateWhatsAppChannelAction — Next.js control-flow signals (requireAdmin)', () => {
  it('propagates a NEXT_REDIRECT from updateWhatsAppChannelConfig instead of returning { error }', async () => {
    vi.mocked(updateWhatsAppChannelConfig).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      updateWhatsAppChannelAction(null, fd(FIELDS)),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateWhatsAppChannelConfig).mockRejectedValue(new Error('db down'));

    const result = await updateWhatsAppChannelAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'עדכון הגדרות הערוץ נכשל. נסו שוב.' });
  });
});

describe('updateVoximplantLiveCallsAction — fail-closed live-dial toggle', () => {
  it('refuses to ENABLE without a full config, and does NOT write', async () => {
    vi.mocked(getVoximplantChannelConfig).mockResolvedValue({
      fullyConfigured: false,
    } as VoxChannelConfig);

    const result = await updateVoximplantLiveCallsAction(
      null,
      fd({ voximplant_live_calls: 'on' }),
    );

    expect(result?.error).toContain('קונפיג מלא');
    expect(updateVoximplantLiveCalls).not.toHaveBeenCalled();
  });

  it('ENABLES when the config is complete', async () => {
    vi.mocked(getVoximplantChannelConfig).mockResolvedValue({
      fullyConfigured: true,
    } as VoxChannelConfig);

    const result = await updateVoximplantLiveCallsAction(
      null,
      fd({ voximplant_live_calls: 'on' }),
    );

    expect(updateVoximplantLiveCalls).toHaveBeenCalledWith(true);
    expect(result?.notice).toBeTruthy();
  });

  it('DISABLES without a config check (no fail-closed guard on turning off)', async () => {
    const result = await updateVoximplantLiveCallsAction(null, fd({}));

    expect(getVoximplantChannelConfig).not.toHaveBeenCalled();
    expect(updateVoximplantLiveCalls).toHaveBeenCalledWith(false);
    expect(result?.notice).toBeTruthy();
  });
});

describe('updateCallConsentRequiredAction — the AI-call consent gate toggle', () => {
  it('checkbox present → REQUIRES consent (true)', async () => {
    const result = await updateCallConsentRequiredAction(
      null,
      fd({ call_consent_required: 'on' }),
    );
    expect(updateCallConsentRequired).toHaveBeenCalledWith(true);
    expect(result?.notice).toBeTruthy();
  });

  // The security-relevant direction: an absent checkbox LIFTS the requirement,
  // permitting dials without prior consent. It must still write false (not refuse).
  it('checkbox absent → LIFTS the requirement (false)', async () => {
    const result = await updateCallConsentRequiredAction(null, fd({}));
    expect(updateCallConsentRequired).toHaveBeenCalledWith(false);
    expect(result?.notice).toBeTruthy();
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(updateCallConsentRequired).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(
      updateCallConsentRequiredAction(null, fd({ call_consent_required: 'on' })),
    ).rejects.toBe(NEXT_REDIRECT);
  });

  it('a genuine error becomes a friendly message, not a throw', async () => {
    vi.mocked(updateCallConsentRequired).mockRejectedValueOnce(new Error('db down'));
    const result = await updateCallConsentRequiredAction(null, fd({}));
    expect(result?.error).toBeTruthy();
  });
});

describe('updateChannelCatalogAction — catalog display-metadata edit', () => {
  const OK = {
    key: 'call',
    display_name: 'שיחת AI',
    is_built: 'on',
    active: 'on',
    sort_order: '2',
  };

  it('rejects an empty display_name and does NOT write', async () => {
    const result = await updateChannelCatalogAction(
      null,
      fd({ ...OK, display_name: '' }),
    );
    expect(result?.fieldErrors?.display_name).toBeTruthy();
    expect(updateChannelMetadata).not.toHaveBeenCalled();
  });

  it('saves valid metadata (checkboxes → booleans, sort coerced to number)', async () => {
    const result = await updateChannelCatalogAction(null, fd(OK));
    expect(updateChannelMetadata).toHaveBeenCalledWith({
      key: 'call',
      display_name: 'שיחת AI',
      is_built: true,
      active: true,
      sort_order: 2,
    });
    expect(result?.notice).toBeTruthy();
  });

  it('absent checkboxes → false (hidden / not-built)', async () => {
    await updateChannelCatalogAction(
      null,
      fd({ key: 'call', display_name: 'x', sort_order: '0' }),
    );
    expect(updateChannelMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ is_built: false, active: false }),
    );
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(updateChannelMetadata).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(updateChannelCatalogAction(null, fd(OK))).rejects.toBe(
      NEXT_REDIRECT,
    );
  });

  it('a genuine error becomes a friendly message, not a throw', async () => {
    vi.mocked(updateChannelMetadata).mockRejectedValueOnce(new Error('db down'));
    const result = await updateChannelCatalogAction(null, fd(OK));
    expect(result?.error).toBe('עדכון הערוץ נכשל. נסו שוב.');
  });
});

describe('updateSendPolicyAction', () => {
  /** The default policy as the form posts it. */
  function policyForm(overrides: Record<string, string> = {}): FormData {
    const f = new FormData();
    for (let d = 0; d <= 5; d++) {
      const w = DEFAULT_SEND_POLICY.weekday[d]!;
      f.set(`weekday.${d}.start`, w.start);
      f.set(`weekday.${d}.end`, w.end);
    }
    f.set('hardCap', DEFAULT_SEND_POLICY.hardCap);
    f.set('motzashPlusMin', String(DEFAULT_SEND_POLICY.motzashPlusMin));
    f.set('spreadSpanMinutes', String(DEFAULT_SEND_POLICY.spreadSpanMs / 60_000));
    f.set('defaultPreferred', DEFAULT_SEND_POLICY.defaultPreferred);
    Object.entries(DEFAULT_SEND_POLICY.preferredTimeByDaysBefore).forEach(
      ([k, v], i) => {
        f.set(`preferred.${i}.days`, k);
        f.set(`preferred.${i}.time`, v);
      },
    );
    for (const [k, v] of Object.entries(overrides)) f.set(k, v);
    return f;
  }

  it('saves a narrowed window', async () => {
    const result = await updateSendPolicyAction(
      null,
      policyForm({ 'weekday.0.start': '10:00', 'weekday.0.end': '18:00' }),
    );
    expect(updateSendPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        weekday: expect.arrayContaining([{ start: '10:00', end: '18:00' }]),
      }),
    );
    expect(result?.notice).toBeTruthy();
  });

  it('a window past the ceiling is REFUSED and never reaches the DAL', async () => {
    const result = await updateSendPolicyAction(
      null,
      policyForm({ 'weekday.1.end': '22:00' }),
    );
    expect(result?.fieldErrors).toBeTruthy();
    expect(updateSendPolicy).not.toHaveBeenCalled();
  });

  it('a crafted Saturday window does not open Shabbat sends', async () => {
    // The page renders no Saturday inputs. Anything arriving under those names is
    // a hand-built request, and it must change nothing.
    const result = await updateSendPolicyAction(
      null,
      policyForm({ 'weekday.6.start': '09:00', 'weekday.6.end': '20:30' }),
    );
    expect(result?.notice).toBeTruthy();
    expect(updateSendPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ weekday: expect.arrayContaining([null]) }),
    );
    const saved = vi.mocked(updateSendPolicy).mock.calls[0][0];
    expect(saved.weekday[6]).toBeNull();
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(updateSendPolicy).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(updateSendPolicyAction(null, policyForm())).rejects.toBe(
      NEXT_REDIRECT,
    );
  });

  it('a write failure becomes a friendly message', async () => {
    vi.mocked(updateSendPolicy).mockRejectedValueOnce(new Error('db down'));
    const result = await updateSendPolicyAction(null, policyForm());
    expect(result?.error).toContain('מדיניות השליחה');
  });
});
