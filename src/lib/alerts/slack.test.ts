import type { IncomingWebhookSendArguments } from '@slack/webhook';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo test
// convention, see url.test.ts). Mock the Slack webhook so no real request is
// ever made and we can assert on send().
vi.mock('server-only', () => ({}));

// vi.hoisted exposes the shared `send` spy to both the (hoisted) vi.mock factory
// and the tests. The class is wrapped in vi.fn() so the constructor itself is
// spyable — the documented Vitest v4 pattern for mocking an exported class
// (docs/guide/mocking/classes.md). `send` is shared across instances so a fresh
// `new IncomingWebhook(url)` per call still records onto the same spy.
const { send, IncomingWebhook } = vi.hoisted(() => {
  const sendFn = vi.fn<(payload: IncomingWebhookSendArguments) => Promise<{ text: string }>>();
  return {
    send: sendFn,
    IncomingWebhook: vi.fn(
      class {
        send = sendFn;
      },
    ),
  };
});
// Mock only IncomingWebhook + ErrorCode (the runtime values the notifier uses).
vi.mock('@slack/webhook', () => ({
  IncomingWebhook,
  ErrorCode: { RequestError: 'slack_webhook_request_error', HTTPError: 'slack_webhook_http_error' },
}));

import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

import { __dedupSizeForTests, __resetSlackAlertStateForTests, sendSlackAlert } from './slack';

const WEBHOOK_URL = 'https://hooks.slack.example/services/T000/B000/XXXX';

/** The payload object passed to webhook.send() on the Nth (default first) call. */
function sentPayload(call = 0): IncomingWebhookSendArguments {
  return send.mock.calls[call][0];
}
/** Whole payload serialized — asserts redaction across text AND block content. */
function serialized(call = 0): string {
  return JSON.stringify(sentPayload(call));
}

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ text: 'ok' });
  IncomingWebhook.mockClear();
  __resetSlackAlertStateForTests();
  __resetRateLimitStateForTests();
  process.env.SLACK_ALERT_WEBHOOK_URL = WEBHOOK_URL;
});

afterEach(() => {
  delete process.env.SLACK_ALERT_WEBHOOK_URL;
});

describe('sendSlackAlert', () => {
  it('is a no-op when SLACK_ALERT_WEBHOOK_URL is unset', async () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;
    await sendSlackAlert({ level: 'error', title: 'boom' });
    expect(IncomingWebhook).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('is a no-op when SLACK_ALERT_WEBHOOK_URL is empty/whitespace', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = '   ';
    await sendSlackAlert({ level: 'warn', title: 'boom' });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a rich payload (text fallback + colored attachment with blocks)', async () => {
    await sendSlackAlert({
      level: 'error',
      title: 'worker job failed',
      source: 'step',
      detail: 'Error · digest=abc',
      fields: { method: 'POST', path: '/r/x' },
    });
    expect(send).toHaveBeenCalledTimes(1);
    const payload = sentPayload();

    // Plain-text fallback is still present and carries the essentials.
    expect(typeof payload.text).toBe('string');
    expect(payload.text).toContain('worker job failed');
    expect(payload.text).toContain('source: step');
    expect(payload.text).toContain('method: POST');

    // Colored attachment (error = #E01E5A) with a non-empty blocks array.
    expect(payload.attachments?.[0]?.color).toBe('#E01E5A');
    const blocks = payload.attachments?.[0]?.blocks;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks?.length ?? 0).toBeGreaterThan(0);
    expect(blocks?.[0]?.type).toBe('header');

    // Link previews suppressed.
    expect(payload.unfurl_links).toBe(false);
    expect(payload.unfurl_media).toBe(false);
  });

  it('constructor defaults set only timeout + retryConfig (no ignored identity fields)', async () => {
    await sendSlackAlert({ level: 'info', title: 'hello' });
    expect(IncomingWebhook).toHaveBeenCalledWith(
      WEBHOOK_URL,
      expect.objectContaining({ timeout: expect.any(Number), retryConfig: expect.any(Object) }),
    );
    // Slack IGNORES these on incoming webhooks — they must NOT be set (dead code).
    const ctorArgs = IncomingWebhook.mock.calls[0] as unknown[];
    const defaults = ctorArgs[1] as Record<string, unknown>;
    expect(defaults).not.toHaveProperty('username');
    expect(defaults).not.toHaveProperty('icon_emoji');
    expect(defaults).not.toHaveProperty('channel');
  });

  it('sets the attachment color per severity level', async () => {
    await sendSlackAlert({ level: 'error', title: 'e' });
    await sendSlackAlert({ level: 'warn', title: 'w' });
    await sendSlackAlert({ level: 'info', title: 'i' });
    expect(sentPayload(0).attachments?.[0]?.color).toBe('#E01E5A');
    expect(sentPayload(1).attachments?.[0]?.color).toBe('#ECB22E');
    expect(sentPayload(2).attachments?.[0]?.color).toBe('#36C5F0');
  });

  it('mention:true adds link_names and an @here prefix (config-ready path)', async () => {
    await sendSlackAlert({ level: 'warn', title: 'ping', mention: true });
    const payload = sentPayload();
    expect(payload.link_names).toBe(true);
    expect(payload.text).toContain('<!here>');
  });

  it('mention omitted → no channel ping', async () => {
    await sendSlackAlert({ level: 'warn', title: 'quiet' });
    const payload = sentPayload();
    expect(payload.link_names).toBeUndefined();
    expect(payload.text).not.toContain('<!here>');
  });

  it('never throws when the webhook send rejects', async () => {
    send.mockRejectedValue(new Error('network down'));
    await expect(sendSlackAlert({ level: 'error', title: 'boom', source: 'x' })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('suppresses a duplicate (level|title|source) within the dedup window', async () => {
    const input = { level: 'error' as const, title: 'same', source: 'worker' };
    await sendSlackAlert(input);
    await sendSlackAlert(input);
    await sendSlackAlert(input);
    // Only the first identical alert is actually sent within the window.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does NOT dedup alerts that differ by level/title/source', async () => {
    await sendSlackAlert({ level: 'error', title: 'a', source: 's' });
    await sendSlackAlert({ level: 'warn', title: 'a', source: 's' });
    await sendSlackAlert({ level: 'error', title: 'b', source: 's' });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('masks Israeli-phone-like values (PII redaction, defense-in-depth)', async () => {
    await sendSlackAlert({
      level: 'warn',
      title: 'contact issue',
      detail: 'phone 0501234567 failed',
      fields: { intl: '+972-50-123-4567' },
    });
    const s = serialized();
    expect(s).not.toContain('0501234567');
    expect(s).not.toContain('972-50-123-4567');
    expect(s).toContain('[redacted-phone]');
  });

  it('masks email addresses (PII redaction, defense-in-depth)', async () => {
    await sendSlackAlert({
      level: 'error',
      title: 'signup failed',
      detail: 'duplicate key for guest@example.co.il',
      fields: { user: 'Jane.Doe+tag@sub.domain.com' },
    });
    const s = serialized();
    expect(s).not.toContain('guest@example.co.il');
    expect(s).not.toContain('Jane.Doe+tag@sub.domain.com');
    expect(s).toContain('[redacted-email]');
  });

  it('bounds dedup map growth by pruning expired distinct keys', async () => {
    // Many distinct keys whose windows are already expired: each opens its own
    // dedup entry. Once the map crosses the prune threshold, expired entries are
    // dropped, so size stays bounded instead of growing without limit.
    const base = Date.now() - 10 * 60_000; // 10 min ago → all windows expired
    vi.spyOn(Date, 'now').mockReturnValue(base);
    for (let i = 0; i < 400; i++) {
      await sendSlackAlert({ level: 'error', title: `distinct-${i}`, source: 's' });
    }
    // Advance "now" past the dedup window so the accumulated entries are expired,
    // then one more call triggers the opportunistic prune.
    vi.spyOn(Date, 'now').mockReturnValue(base + 120_000);
    await sendSlackAlert({ level: 'error', title: 'trigger', source: 's' });
    vi.restoreAllMocks();
    // Far below the number of distinct keys created — proves pruning ran.
    expect(__dedupSizeForTests()).toBeLessThan(300);
  });

  it('masks token-like strings but preserves UUIDs', async () => {
    await sendSlackAlert({
      level: 'error',
      title: 'auth failure',
      detail: 'token EAABsecret1234567890abcdefXYZ used',
      fields: { campaign_id: '294d23e1-0000-4000-8000-000000000000' },
    });
    const s = serialized();
    expect(s).toContain('[redacted-token]');
    expect(s).not.toContain('EAABsecret1234567890abcdefXYZ');
    // UUIDs are hyphen-separated and must stay readable for debugging.
    expect(s).toContain('294d23e1-0000-4000-8000-000000000000');
  });
});
