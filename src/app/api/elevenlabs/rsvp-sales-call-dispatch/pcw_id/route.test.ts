import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

// Rewritten 2026-09-01 with the route itself: storing the analysis and resolving
// the stuck attempt moved to the worker (elevenlabs-analysis-processing.test.ts
// covers them). What is left here is the intake contract — verify, persist the
// raw delivery, answer — plus the security envelope, which did not change.
vi.mock('server-only', () => ({}));
const { insertMock, slackMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  slackMock: vi.fn(),
}));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents: insertMock }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: slackMock }));

import { POST } from './route';

const SECRET = 'wsec_test_secret';

function body(type = 'post_call_transcription'): string {
  return JSON.stringify({
    type,
    event_timestamp: 1_784_500_000,
    data: {
      conversation_id: 'conv_sales_1',
      agent_id: 'a',
      status: 'done',
      transcript: [{ role: 'user', message: 'SECRET_SPEECH' }],
      metadata: { call_duration_secs: 10, cost: 5, feedback: { overall_score: 0.8 } },
      analysis: { call_successful: 'unknown' },
    },
  });
}

function sign(raw: string, tSec = Math.floor(Date.now() / 1000), secret = SECRET): string {
  const v0 = createHmac('sha256', secret).update(`${tSec}.${raw}`).digest('hex');
  return `t=${tSec},v0=${v0}`;
}
function req(raw: string, headers: Record<string, string> = {}) {
  return new Request('https://kalfa.test/api/elevenlabs/rsvp-sales-call-dispatch/pcw_id', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.10', ...headers },
    body: raw,
  });
}
const call = (raw: string, headers?: Record<string, string>) => POST(req(raw, headers));

beforeEach(() => {
  __resetRateLimitStateForTests();
  insertMock.mockReset().mockResolvedValue(undefined);
  slackMock.mockReset().mockResolvedValue(undefined);
  process.env.ELEVENLABS_SALES_WEBHOOK = SECRET;
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/elevenlabs/rsvp-sales-call-dispatch/pcw_id', () => {
  it('persists the delivery under the sales kind and returns 200', async () => {
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw) });
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'elevenlabs',
        event_kind: 'el_analysis_sales',
        message_id: 'conv_sales_1',
        // The provider's own dedupe recipe: conversation_id + event_timestamp.
        dedupe_key: 'conv_sales_1:1784500000',
      }),
    ]);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a bad signature with a uniform 401, persists nothing', async () => {
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw, undefined, 'wrong-secret') });
    expect(res.status).toBe(401);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('is dark (401) when no secret is configured', async () => {
    delete process.env.ELEVENLABS_SALES_WEBHOOK;
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw) });
    expect(res.status).toBe(401);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rejects an expired timestamp (older than 30m) with 401', async () => {
    const raw = body();
    const stale = Math.floor(Date.now() / 1000) - 31 * 60;
    expect((await call(raw, { 'elevenlabs-signature': sign(raw, stale) })).status).toBe(401);
  });

  // This endpoint is bound to five workspace usages, so most of what arrives is
  // not a call at all. Anything but post_call_transcription is answered and
  // dropped — post_call_audio especially, which is heavy PII.
  it('ignores a non post_call_transcription type (post_call_audio) with 200, persists nothing', async () => {
    const raw = body('post_call_audio');
    const res = await call(raw, { 'elevenlabs-signature': sign(raw) });
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
  });

  // The provider's integration guidance: return 200 promptly after validating
  // the signature, because repeated non-200 can auto-disable the webhook. A
  // failed insert is therefore raised as an alert, never as a status code.
  it('still answers 200 when the insert fails, and alerts without PII', async () => {
    insertMock.mockRejectedValue(new Error('db down'));
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw) });
    expect(res.status).toBe(200);
    expect(slackMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(slackMock.mock.calls[0][0])).not.toContain('SECRET_SPEECH');
  });

  it('rejects an oversized body (Content-Length hint) with 413', async () => {
    const res = await call('{}', { 'content-length': String(256 * 1024 + 1) });
    expect(res.status).toBe(413);
  });


  it('stamps no-store on failure responses too (401)', async () => {
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw, undefined, 'wrong-secret') });
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rate-limits fail-closed past the window cap', async () => {
    const raw = body();
    const sig = sign(raw);
    for (let i = 0; i < 300; i++) {
      const res = await call(raw, { 'elevenlabs-signature': sig });
      expect(res.status).toBe(200);
    }
    expect((await call(raw, { 'elevenlabs-signature': sig })).status).toBe(429);
  });
});
