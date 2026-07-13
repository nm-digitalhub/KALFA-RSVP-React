import type { ChatPostMessageArguments } from '@slack/web-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo convention).
vi.mock('server-only', () => ({}));

// Mock the Slack Web API so no real request is ever made. `postMessage` is shared
// across WebClient instances so a fresh `new WebClient(token)` per call still
// records onto the same spy (documented Vitest v4 class-mock pattern).
const { postMessage, WebClient } = vi.hoisted(() => {
  const pm = vi.fn<(args: ChatPostMessageArguments) => Promise<{ ok: boolean }>>();
  return {
    postMessage: pm,
    WebClient: vi.fn(
      class {
        chat = { postMessage: pm };
      },
    ),
  };
});
vi.mock('@slack/web-api', () => ({
  WebClient,
  ErrorCode: {
    RequestError: 'slack_webapi_request_error',
    HTTPError: 'slack_webapi_http_error',
  },
}));

// Control the config the notifier reads; keep the real categoryEnabled mapping.
vi.mock('@/lib/data/alerts-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/alerts-config')>();
  return { ...actual, getAlertsConfig: vi.fn() };
});

// ops_alerts audit insert — a shared spy so tests can assert / fail it.
const opsInsert = vi.fn<(row: unknown) => Promise<{ error: unknown }>>();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: () => ({ insert: opsInsert }) })),
}));

import { getAlertsConfig, type AlertsConfig } from '@/lib/data/alerts-config';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

import {
  __dedupSizeForTests,
  __resetSlackAlertStateForTests,
  sendSlackAlert,
  sendSlackTestAlert,
} from './slack';

const ENABLED: AlertsConfig = {
  enabled: true,
  botToken: 'xoxb-test-token',
  channelId: 'C123',
  mentionUserId: null,
  mentionMinLevel: 'off',
  categories: {
    errors: true,
    campaignBilling: true,
    sendHealth: true,
    security: true,
  },
};

// The composed message the notifier sends (channel + text fallback + a colored
// attachment carrying the Block Kit blocks). `ChatPostMessageArguments` is a
// union whose members don't all expose `text`/`attachments`, so we read the
// recorded call through this concrete shape for assertions.
type SentPayload = {
  channel: string;
  text?: string;
  link_names?: boolean;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  attachments?: Array<{ color?: string; blocks?: Array<{ type: string }> }>;
};
function sentPayload(call = 0): SentPayload {
  return postMessage.mock.calls[call][0] as unknown as SentPayload;
}
function serialized(call = 0): string {
  return JSON.stringify(sentPayload(call));
}

beforeEach(() => {
  postMessage.mockReset();
  postMessage.mockResolvedValue({ ok: true });
  WebClient.mockClear();
  opsInsert.mockReset();
  opsInsert.mockResolvedValue({ error: null });
  vi.mocked(getAlertsConfig).mockResolvedValue(ENABLED);
  __resetSlackAlertStateForTests();
  __resetRateLimitStateForTests();
});

describe('sendSlackAlert — gating', () => {
  it('no-op when alerting is disabled', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({ ...ENABLED, enabled: false });
    await sendSlackAlert({ level: 'error', title: 'boom', category: 'errors' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('no-op when no bot token', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({ ...ENABLED, botToken: null });
    await sendSlackAlert({ level: 'error', title: 'boom', category: 'errors' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('no-op when no channel id', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({ ...ENABLED, channelId: null });
    await sendSlackAlert({ level: 'error', title: 'boom', category: 'errors' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("no-op when the alert's category toggle is off", async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({
      ...ENABLED,
      categories: { ...ENABLED.categories, sendHealth: false },
    });
    await sendSlackAlert({ level: 'warn', title: 'SMS send failed', category: 'send_health' });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('sendSlackAlert — send', () => {
  it('posts to the configured channel with a rich payload', async () => {
    await sendSlackAlert({
      level: 'error',
      title: 'worker job failed',
      source: 'step',
      detail: 'Error · digest=abc',
      fields: { method: 'POST', path: '/r/x' },
      category: 'errors',
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = sentPayload();

    expect(payload.channel).toBe('C123');
    expect(typeof payload.text).toBe('string');
    expect(payload.text).toContain('worker job failed');
    expect(payload.attachments?.[0]?.color).toBe('#E01E5A');
    const blocks = payload.attachments?.[0]?.blocks;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks?.[0]?.type).toBe('header');
    expect(payload.unfurl_links).toBe(false);
    expect(payload.unfurl_media).toBe(false);
  });

  it('constructs the WebClient with the bot token + timeout/retryConfig', async () => {
    await sendSlackAlert({ level: 'info', title: 'hello', category: 'errors' });
    expect(WebClient).toHaveBeenCalledWith(
      'xoxb-test-token',
      expect.objectContaining({
        timeout: expect.any(Number),
        retryConfig: expect.any(Object),
      }),
    );
  });

  it('sets the attachment color per severity level', async () => {
    await sendSlackAlert({ level: 'error', title: 'e', category: 'errors' });
    await sendSlackAlert({ level: 'warn', title: 'w', category: 'errors' });
    await sendSlackAlert({ level: 'info', title: 'i', category: 'errors' });
    expect(sentPayload(0).attachments?.[0]?.color).toBe('#E01E5A');
    expect(sentPayload(1).attachments?.[0]?.color).toBe('#ECB22E');
    expect(sentPayload(2).attachments?.[0]?.color).toBe('#36C5F0');
  });

  it('prepends a personal <@id> mention when the level meets the configured threshold', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({
      ...ENABLED,
      mentionUserId: 'U0ABC123',
      mentionMinLevel: 'warn',
    });
    await sendSlackAlert({ level: 'error', title: 'ping', category: 'errors' });
    const payload = sentPayload();
    expect(payload.text?.startsWith('<@U0ABC123> ')).toBe(true);
    // User-id mentions resolve without link_names — it must NOT be sent.
    expect(payload.link_names).toBeUndefined();
    expect(payload.text).not.toContain('<!here>');
  });

  it('mentions when the level exactly equals the threshold', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({
      ...ENABLED,
      mentionUserId: 'U0ABC123',
      mentionMinLevel: 'warn',
    });
    await sendSlackAlert({ level: 'warn', title: 'ping', category: 'errors' });
    expect(sentPayload().text?.startsWith('<@U0ABC123> ')).toBe(true);
  });

  it('does NOT mention when the level is below the threshold', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({
      ...ENABLED,
      mentionUserId: 'U0ABC123',
      mentionMinLevel: 'error',
    });
    await sendSlackAlert({ level: 'warn', title: 'ping', category: 'errors' });
    expect(sentPayload().text).not.toContain('<@U0ABC123>');
  });

  it('does NOT mention when min level is off, even with a member id set', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({
      ...ENABLED,
      mentionUserId: 'U0ABC123',
      mentionMinLevel: 'off',
    });
    await sendSlackAlert({ level: 'error', title: 'ping', category: 'errors' });
    expect(sentPayload().text).not.toContain('<@U0ABC123>');
  });

  it('does NOT mention when no member id is configured', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({
      ...ENABLED,
      mentionUserId: null,
      mentionMinLevel: 'info',
    });
    await sendSlackAlert({ level: 'error', title: 'ping', category: 'errors' });
    const payload = sentPayload();
    expect(payload.text).not.toContain('<@');
    expect(payload.link_names).toBeUndefined();
  });

  it('never throws when postMessage rejects', async () => {
    postMessage.mockRejectedValue(new Error('network down'));
    await expect(
      sendSlackAlert({ level: 'error', title: 'boom', source: 'x', category: 'errors' }),
    ).resolves.toBeUndefined();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('suppresses a duplicate (level|title|source) within the dedup window', async () => {
    const input = {
      level: 'error' as const,
      title: 'same',
      source: 'worker',
      category: 'errors' as const,
    };
    await sendSlackAlert(input);
    await sendSlackAlert(input);
    await sendSlackAlert(input);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('masks phone, email, and token strings but preserves UUIDs', async () => {
    await sendSlackAlert({
      level: 'error',
      title: 'auth failure',
      detail: 'token EAABsecret1234567890abcdefXYZ for guest@example.co.il on 0501234567',
      fields: { campaign_id: '294d23e1-0000-4000-8000-000000000000' },
      category: 'errors',
    });
    const s = serialized();
    expect(s).toContain('[redacted-token]');
    expect(s).toContain('[redacted-email]');
    expect(s).toContain('[redacted-phone]');
    expect(s).not.toContain('EAABsecret1234567890abcdefXYZ');
    expect(s).not.toContain('guest@example.co.il');
    expect(s).not.toContain('0501234567');
    expect(s).toContain('294d23e1-0000-4000-8000-000000000000');
  });

  it('bounds dedup map growth by pruning expired distinct keys', async () => {
    const base = Date.now() - 10 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(base);
    for (let i = 0; i < 400; i++) {
      await sendSlackAlert({ level: 'error', title: `distinct-${i}`, source: 's', category: 'errors' });
    }
    vi.spyOn(Date, 'now').mockReturnValue(base + 120_000);
    await sendSlackAlert({ level: 'error', title: 'trigger', source: 's', category: 'errors' });
    vi.restoreAllMocks();
    expect(__dedupSizeForTests()).toBeLessThan(300);
  });
});

describe('sendSlackAlert — ops_alerts audit', () => {
  it('records a delivered=true row when the send succeeds', async () => {
    await sendSlackAlert({ level: 'error', title: 'worker fatal', source: 'worker-fatal', category: 'errors' });
    expect(opsInsert).toHaveBeenCalledTimes(1);
    expect(opsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        title: 'worker fatal',
        source: 'worker-fatal',
        category: 'errors',
        delivered: true,
        suppressed_count: 0,
      }),
    );
  });

  it('records delivered=false when the send fails', async () => {
    postMessage.mockRejectedValue(new Error('boom'));
    await sendSlackAlert({ level: 'error', title: 'x', category: 'errors' });
    expect(opsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: false }),
    );
  });

  it('a failing audit insert does NOT break the send', async () => {
    opsInsert.mockRejectedValue(new Error('insert failed'));
    await expect(
      sendSlackAlert({ level: 'error', title: 'x', category: 'errors' }),
    ).resolves.toBeUndefined();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('sendSlackTestAlert', () => {
  it('bypasses the enabled + category gates but requires token + channel', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({
      ...ENABLED,
      enabled: false,
      categories: { errors: false, campaignBilling: false, sendHealth: false, security: false },
    });
    const r = await sendSlackTestAlert();
    expect(r.ok).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('reports not_configured when no token/channel', async () => {
    vi.mocked(getAlertsConfig).mockResolvedValue({ ...ENABLED, botToken: null });
    const r = await sendSlackTestAlert();
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('reports send_failed when Slack rejects', async () => {
    postMessage.mockRejectedValue(new Error('bad token'));
    const r = await sendSlackTestAlert();
    expect(r).toEqual({ ok: false, reason: 'send_failed' });
  });
});
