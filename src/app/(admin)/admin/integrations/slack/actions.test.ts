import { beforeEach, describe, expect, it, vi } from 'vitest';

// The action client (src/lib/safe-action.ts) is server-only.
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/alerts', () => ({
  updateSlackConnection: vi.fn(),
  clearSlackConnection: vi.fn(),
  setSlackAlertsEnabled: vi.fn(),
  setSlackAlertCategory: vi.fn(),
  setSlackMention: vi.fn(),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackTestAlert: vi.fn() }));

import { actionErrorMessage } from '@/lib/action-result';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { setSlackAlertsEnabled, setSlackMention, updateSlackConnection } from '@/lib/data/admin/alerts';
import { sendSlackTestAlert } from '@/lib/alerts/slack';
import {
  saveSlackConnectionAction,
  saveSlackMentionAction,
  sendTestAlertAction,
  setAlertToggleAction,
} from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin' } as never);
});

describe('saveSlackConnectionAction — authorization', () => {
  it('propagates the permission redirect instead of returning { error }', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(
      saveSlackConnectionAction({}, fd({ slack_bot_token: 'xoxb-a1', slack_alert_channel_id: 'C123456' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(updateSlackConnection).not.toHaveBeenCalled();
  });

  // The gate runs before the input is validated (a `use()` middleware): a caller without the
  // permission is redirected, never answered with field messages about what it sent.
  it('refuses a caller without the permission before validating the input', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(
      saveSlackConnectionAction({}, fd({ slack_bot_token: 'not-a-token', slack_alert_channel_id: 'lobby' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(updateSlackConnection).not.toHaveBeenCalled();
  });

  // Not just "a gate ran" — WHICH key. This action writes a Slack bot token and
  // a channel id; until 2026-09-10 it asked only requireAdmin(), so once the two
  // auth axes were merged every staff role, an auditor included, could rewrite
  // the alerting webhook. Asserting the key is what makes a silent widening back
  // to the coarse floor fail here instead of shipping.
  it('demands manage_settings by name', async () => {
    await saveSlackConnectionAction(
      {},
      fd({ slack_bot_token: 'xoxb-a1', slack_alert_channel_id: 'C123456' }),
    );
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });
});

describe('saveSlackConnectionAction — validation', () => {
  it('rejects a bot token that is not xoxb-…', async () => {
    const r = await saveSlackConnectionAction(
      {},
      fd({ slack_bot_token: 'not-a-token', slack_alert_channel_id: 'C123456' }),
    );
    expect(r.validationErrors?.fieldErrors?.slack_bot_token?.length).toBeGreaterThan(0);
    expect(updateSlackConnection).not.toHaveBeenCalled();
  });

  it('rejects a channel id that is not C…', async () => {
    const r = await saveSlackConnectionAction(
      {},
      fd({ slack_bot_token: 'xoxb-abc123', slack_alert_channel_id: 'lobby' }),
    );
    expect(r.validationErrors?.fieldErrors?.slack_alert_channel_id?.length).toBeGreaterThan(0);
    expect(updateSlackConnection).not.toHaveBeenCalled();
  });

  it('accepts a valid token + channel and NEVER echoes the token back', async () => {
    const r = await saveSlackConnectionAction(
      {},
      fd({ slack_bot_token: 'xoxb-secret-value', slack_alert_channel_id: 'C123456' }),
    );
    expect(updateSlackConnection).toHaveBeenCalledWith({
      botToken: 'xoxb-secret-value',
      channelId: 'C123456',
    });
    expect(r).toEqual({ data: { notice: 'החיבור נשמר' } });
    // The secret must not leak into the returned state under any key.
    expect(JSON.stringify(r)).not.toContain('xoxb-secret-value');
  });

  it('accepts a blank token (keep existing) with a valid channel', async () => {
    const r = await saveSlackConnectionAction(
      {},
      fd({ slack_bot_token: '', slack_alert_channel_id: 'C999999' }),
    );
    expect(updateSlackConnection).toHaveBeenCalledWith({ botToken: '', channelId: 'C999999' });
    expect(r).toEqual({ data: { notice: 'החיבור נשמר' } });
  });
});

describe('saveSlackMentionAction — validation', () => {
  it('rejects a member id that is not U…/W…', async () => {
    const r = await saveSlackMentionAction(
      {},
      fd({ slack_mention_user_id: 'nope', slack_mention_min_level: 'error' }),
    );
    expect(r.validationErrors?.fieldErrors?.slack_mention_user_id?.length).toBeGreaterThan(0);
    expect(setSlackMention).not.toHaveBeenCalled();
  });

  it('accepts a blank member id (no mention target) with a threshold', async () => {
    const r = await saveSlackMentionAction(
      {},
      fd({ slack_mention_user_id: '', slack_mention_min_level: 'off' }),
    );
    expect(setSlackMention).toHaveBeenCalledWith({ userId: '', minLevel: 'off' });
    expect(r).toEqual({ data: { notice: 'הגדרות האזכור נשמרו' } });
  });

  it('accepts a valid U… member id and threshold', async () => {
    const r = await saveSlackMentionAction(
      {},
      fd({ slack_mention_user_id: 'U0ABC123', slack_mention_min_level: 'warn' }),
    );
    expect(setSlackMention).toHaveBeenCalledWith({ userId: 'U0ABC123', minLevel: 'warn' });
    expect(r).toEqual({ data: { notice: 'הגדרות האזכור נשמרו' } });
  });

  it('rejects an unknown threshold value', async () => {
    const r = await saveSlackMentionAction(
      {},
      fd({ slack_mention_user_id: 'U0ABC123', slack_mention_min_level: 'bogus' }),
    );
    expect(r.validationErrors?.fieldErrors?.slack_mention_min_level?.length).toBeGreaterThan(0);
    expect(setSlackMention).not.toHaveBeenCalled();
  });
});

describe('sendTestAlertAction', () => {
  it('reports success when the test alert is delivered', async () => {
    vi.mocked(sendSlackTestAlert).mockResolvedValue({ ok: true });
    const r = await sendTestAlertAction({});
    expect(r.data?.notice).toBeTruthy();
  });

  it('reports a not_configured error distinctly', async () => {
    vi.mocked(sendSlackTestAlert).mockResolvedValue({ ok: false, reason: 'not_configured' });
    const r = await sendTestAlertAction({});
    expect(r.serverError).toContain('שמרו חיבור');
  });
});

describe('setAlertToggleAction', () => {
  it('demands manage_settings, then saves the master switch', async () => {
    const r = await setAlertToggleAction({ enabled: true });
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
    expect(setSlackAlertsEnabled).toHaveBeenCalledWith(true);
    expect(r).toEqual({ data: { notice: 'נשמר' } });
  });

  // A crafted request can send any value; the cast stands in for it.
  it('answers a malformed value with the one Hebrew sentence and saves nothing', async () => {
    const r = await setAlertToggleAction({ enabled: 'yes' as unknown as boolean });
    expect(actionErrorMessage(r)).toBe('ערך לא תקין');
    expect(setSlackAlertsEnabled).not.toHaveBeenCalled();
  });

  it('checks the permission before the value', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(setAlertToggleAction({ enabled: 'yes' as unknown as boolean })).rejects.toThrow('NEXT_REDIRECT');
    expect(setSlackAlertsEnabled).not.toHaveBeenCalled();
  });
});
