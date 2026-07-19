import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

vi.mock('server-only', () => ({}));
const { storeMock, slackMock } = vi.hoisted(() => ({ storeMock: vi.fn(), slackMock: vi.fn() }));
vi.mock('@/lib/data/elevenlabs-analysis', () => ({ storeCallAnalysis: storeMock }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: slackMock }));

import { POST } from './route';

const SECRET = 'wsec_test_secret';

function body(type = 'post_call_transcription'): string {
  return JSON.stringify({
    type,
    event_timestamp: 1_784_500_000,
    data: {
      conversation_id: 'conv_1',
      agent_id: 'a',
      status: 'done',
      transcript: [{ role: 'user', message: 'SECRET_SPEECH' }],
      metadata: { call_duration_secs: 10, cost: 5, feedback: { overall_score: 0.8 } },
      analysis: { call_successful: 'success' },
    },
  });
}

function sign(raw: string, tSec = Math.floor(Date.now() / 1000), secret = SECRET): string {
  const v0 = createHmac('sha256', secret).update(`${tSec}.${raw}`).digest('hex');
  return `t=${tSec},v0=${v0}`;
}
function req(raw: string, headers: Record<string, string> = {}) {
  return new Request('https://kalfa.test/api/elevenlabs/rsvp/update', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9', ...headers },
    body: raw,
  });
}
const call = (raw: string, headers?: Record<string, string>) => POST(req(raw, headers));

beforeEach(() => {
  __resetRateLimitStateForTests();
  storeMock.mockReset().mockResolvedValue('stored');
  slackMock.mockReset().mockResolvedValue(undefined);
  process.env.ELEVENLABS_WEBHOOK = SECRET;
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/elevenlabs/rsvp/update', () => {
  it('stores a valid post_call_transcription (metadata only) and returns 200', async () => {
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw) });
    expect(res.status).toBe(200);
    expect(storeMock).toHaveBeenCalledOnce();
    expect(storeMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1', callSuccessful: 'success' }),
    );
    // The stored object never carries the transcript speech.
    expect(JSON.stringify(storeMock.mock.calls[0][0])).not.toContain('SECRET_SPEECH');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a bad signature with a uniform 401, stores nothing', async () => {
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw, undefined, 'wrong-secret') });
    expect(res.status).toBe(401);
    expect(storeMock).not.toHaveBeenCalled();
  });

  it('is dark (401) when no secret is configured', async () => {
    delete process.env.ELEVENLABS_WEBHOOK;
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw) });
    expect(res.status).toBe(401);
    expect(storeMock).not.toHaveBeenCalled();
  });

  it('rejects an expired timestamp (older than 30m) with 401', async () => {
    const raw = body();
    const stale = Math.floor(Date.now() / 1000) - 31 * 60;
    expect((await call(raw, { 'elevenlabs-signature': sign(raw, stale) })).status).toBe(401);
  });

  it('ignores a non post_call_transcription type (post_call_audio) with 200, stores nothing', async () => {
    const raw = body('post_call_audio');
    const res = await call(raw, { 'elevenlabs-signature': sign(raw) });
    expect(res.status).toBe(200);
    expect(storeMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized body (Content-Length hint) with 413', async () => {
    const res = await call('{}', { 'content-length': String(256 * 1024 + 1) });
    expect(res.status).toBe(413);
  });

  it('rejects an oversized ACTUAL body (hard cap after read) with 413', async () => {
    const big = `{"x":"${'y'.repeat(257 * 1024)}"}`;
    const res = await call(big, { 'elevenlabs-signature': 'irrelevant' });
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

  it('returns 500 and fires a PII-free alert when the store fails', async () => {
    storeMock.mockResolvedValue('error');
    const raw = body();
    const res = await call(raw, { 'elevenlabs-signature': sign(raw) });
    expect(res.status).toBe(500);
    expect(slackMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(slackMock.mock.calls[0][0])).not.toContain('SECRET_SPEECH');
  });
});
