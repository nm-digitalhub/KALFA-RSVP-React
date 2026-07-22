import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { updateWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import {
  getVoximplantChannelConfig,
  updateVoximplantLiveCalls,
  updateCallConsentRequired,
} from '@/lib/data/admin/voximplant-channel';
import {
  updateWhatsAppChannelAction,
  updateVoximplantLiveCallsAction,
  updateCallConsentRequiredAction,
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
