import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyElevenLabsWebhook } from './elevenlabs-webhook';

const SECRET = 'wsec_test_shared_secret';
const NOW = 1_784_500_000_000; // fixed clock (ms)
const body = JSON.stringify({ type: 'post_call_transcription', data: { conversation_id: 'c1' } });

// Build a valid `ElevenLabs-Signature` header for a given timestamp (unix seconds).
function sign(tSeconds: number, rawBody: string, secret = SECRET): string {
  const v0 = createHmac('sha256', secret).update(`${tSeconds}.${rawBody}`).digest('hex');
  return `t=${tSeconds},v0=${v0}`;
}

describe('verifyElevenLabsWebhook', () => {
  const nowSec = Math.floor(NOW / 1000);

  it('accepts a correctly-signed, fresh request', () => {
    expect(verifyElevenLabsWebhook(body, sign(nowSec, body), SECRET, NOW)).toEqual({ valid: true });
  });

  it('accepts when the header parts are in reverse order (order-independent)', () => {
    const v0 = createHmac('sha256', SECRET).update(`${nowSec}.${body}`).digest('hex');
    expect(verifyElevenLabsWebhook(body, `v0=${v0},t=${nowSec}`, SECRET, NOW)).toEqual({ valid: true });
  });

  it('rejects a tampered body', () => {
    const header = sign(nowSec, body);
    const res = verifyElevenLabsWebhook(body + 'x', header, SECRET, NOW);
    expect(res).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects a wrong secret', () => {
    const res = verifyElevenLabsWebhook(body, sign(nowSec, body, 'other_secret'), SECRET, NOW);
    expect(res).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects a timestamp older than the 30-minute tolerance', () => {
    const stale = nowSec - 31 * 60;
    expect(verifyElevenLabsWebhook(body, sign(stale, body), SECRET, NOW)).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('accepts a timestamp within the 30-minute tolerance', () => {
    const recent = nowSec - 29 * 60;
    expect(verifyElevenLabsWebhook(body, sign(recent, body), SECRET, NOW)).toEqual({ valid: true });
  });

  it('rejects malformed headers (missing parts, non-numeric t, null)', () => {
    for (const h of [null, undefined, '', 'garbage', `t=${nowSec}`, 'v0=abc', `t=abc,v0=def`]) {
      expect(verifyElevenLabsWebhook(body, h, SECRET, NOW).reason).toBe('malformed_header');
    }
  });

  it('rejects when no secret is configured', () => {
    expect(verifyElevenLabsWebhook(body, sign(nowSec, body), null, NOW)).toEqual({
      valid: false,
      reason: 'no_secret',
    });
  });
});
