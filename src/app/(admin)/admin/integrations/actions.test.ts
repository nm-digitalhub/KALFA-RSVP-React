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
// actions.ts imports the Voximplant channel + outreach-master DALs
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
import { createVoicePurpose, updateVoicePurpose, listVoicePurposesForAdmin } from '@/lib/data/admin/voice-purposes';
import {
  getVoximplantChannelConfig,
  updateVoximplantLiveCalls,
} from '@/lib/data/admin/voximplant-channel';
import { updateChannelMetadata } from '@/lib/data/admin/channel-catalog';
import { updateSendPolicy } from '@/lib/data/admin/integrations/send-policy';
import { DEFAULT_SEND_POLICY } from '@/lib/outreach/send-policy';
import { sendPolicyFromFormData } from '@/lib/validation/send-policy-form';
import {
  updateWhatsAppChannelAction,
  updateVoximplantLiveCallsAction,
  updateChannelCatalogAction,
  updateSendPolicyAction,
} from './actions';

type VoxChannelConfig = Awaited<ReturnType<typeof getVoximplantChannelConfig>>;

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/access-denied;307;',
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

describe.each([
  { name: 'create voice purpose', action: createVoicePurposeAction, write: vi.mocked(createVoicePurpose) },
  { name: 'update voice purpose', action: updateVoicePurposeAction, write: vi.mocked(updateVoicePurpose) },
])('$name authorization', ({ action, write }) => {
  it('propagates a DAL redirect even after the earlier read was allowed', async () => {
    vi.mocked(getVoximplantChannelConfig).mockResolvedValue({} as VoxChannelConfig);
    vi.mocked(listVoicePurposesForAdmin).mockResolvedValue([]);
    write.mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(action({}, fd({ key: 'test_purpose', displayName: 'ייעוד בדיקה' }))).rejects.toBe(NEXT_REDIRECT);
  });
});

describe('updateWhatsAppChannelAction — Next.js control-flow signals (requirePlatformPermission)', () => {
  it('propagates a NEXT_REDIRECT from updateWhatsAppChannelConfig instead of returning { error }', async () => {
    vi.mocked(updateWhatsAppChannelConfig).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      updateWhatsAppChannelAction({}, fd(FIELDS)),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateWhatsAppChannelConfig).mockRejectedValue(new Error('db down'));

    const result = await updateWhatsAppChannelAction({}, fd(FIELDS));

    expect(result).toEqual({ serverError: 'עדכון הגדרות הערוץ נכשל. נסו שוב.' });
  });
});

describe('updateVoximplantLiveCallsAction — fail-closed live-dial toggle', () => {
  it('refuses to ENABLE without a full config, and does NOT write', async () => {
    vi.mocked(getVoximplantChannelConfig).mockResolvedValue({
      fullyConfigured: false,
    } as VoxChannelConfig);

    const result = await updateVoximplantLiveCallsAction(
      {},
      fd({ voximplant_live_calls: 'on' }),
    );

    expect(result?.serverError).toContain('קונפיג מלא');
    expect(updateVoximplantLiveCalls).not.toHaveBeenCalled();
  });

  it('ENABLES when the config is complete', async () => {
    vi.mocked(getVoximplantChannelConfig).mockResolvedValue({
      fullyConfigured: true,
    } as VoxChannelConfig);

    const result = await updateVoximplantLiveCallsAction(
      {},
      fd({ voximplant_live_calls: 'on' }),
    );

    expect(updateVoximplantLiveCalls).toHaveBeenCalledWith(true);
    expect(result?.data?.notice).toBeTruthy();
  });

  it('DISABLES without a config check (no fail-closed guard on turning off)', async () => {
    const result = await updateVoximplantLiveCallsAction({}, fd({}));

    expect(getVoximplantChannelConfig).not.toHaveBeenCalled();
    expect(updateVoximplantLiveCalls).toHaveBeenCalledWith(false);
    expect(result?.data?.notice).toBeTruthy();
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
      {},
      fd({ ...OK, display_name: '' }),
    );
    expect(result?.validationErrors?.fieldErrors?.display_name).toEqual(['שם תצוגה חובה']);
    expect(updateChannelMetadata).not.toHaveBeenCalled();
  });

  it('saves valid metadata (checkboxes → booleans, sort coerced to number)', async () => {
    const result = await updateChannelCatalogAction({}, fd(OK));
    expect(updateChannelMetadata).toHaveBeenCalledWith({
      key: 'call',
      display_name: 'שיחת AI',
      is_built: true,
      active: true,
      sort_order: 2,
    });
    expect(result?.data?.notice).toBeTruthy();
  });

  it('absent checkboxes → false (hidden / not-built)', async () => {
    await updateChannelCatalogAction(
      {},
      fd({ key: 'call', display_name: 'x', sort_order: '0' }),
    );
    expect(updateChannelMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ is_built: false, active: false }),
    );
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(updateChannelMetadata).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(updateChannelCatalogAction({}, fd(OK))).rejects.toBe(
      NEXT_REDIRECT,
    );
  });

  it('a genuine error becomes a friendly message, not a throw', async () => {
    vi.mocked(updateChannelMetadata).mockRejectedValueOnce(new Error('db down'));
    const result = await updateChannelCatalogAction({}, fd(OK));
    expect(result?.serverError).toBe('עדכון הערוץ נכשל. נסו שוב.');
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
      {},
      policyForm({ 'weekday.0.start': '10:00', 'weekday.0.end': '18:00' }),
    );
    expect(updateSendPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        weekday: expect.arrayContaining([{ start: '10:00', end: '18:00' }]),
      }),
    );
    expect(result?.data?.notice).toBeTruthy();
  });

  it('a window past the ceiling is REFUSED and never reaches the DAL', async () => {
    const form = policyForm({ 'weekday.1.end': '22:00' });
    const result = await updateSendPolicyAction({}, form);
    expect(result?.validationErrors?.fieldErrors).toBeTruthy();
    expect(updateSendPolicy).not.toHaveBeenCalled();
    // The refusal reaches the form exactly as the pure translation states it: the same field names (dotted, or
    // `_root`) and the same text.
    const refused = sendPolicyFromFormData(form);
    expect(refused.ok).toBe(false);
    expect(result?.validationErrors?.fieldErrors).toEqual(refused.ok ? undefined : refused.fieldErrors);
  });

  it('a crafted Saturday window does not open Shabbat sends', async () => {
    // The page renders no Saturday inputs. Anything arriving under those names is
    // a hand-built request, and it must change nothing.
    const result = await updateSendPolicyAction(
      {},
      policyForm({ 'weekday.6.start': '09:00', 'weekday.6.end': '20:30' }),
    );
    expect(result?.data?.notice).toBeTruthy();
    expect(updateSendPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ weekday: expect.arrayContaining([null]) }),
    );
    const saved = vi.mocked(updateSendPolicy).mock.calls[0][0];
    expect(saved.weekday[6]).toBeNull();
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(updateSendPolicy).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(updateSendPolicyAction({}, policyForm())).rejects.toBe(
      NEXT_REDIRECT,
    );
  });

  it('a write failure becomes a friendly message', async () => {
    vi.mocked(updateSendPolicy).mockRejectedValueOnce(new Error('db down'));
    const result = await updateSendPolicyAction({}, policyForm());
    expect(result?.serverError).toBe('שמירת מדיניות השליחה נכשלה. נסו שוב.');
  });
});
