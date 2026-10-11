import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyElevenLabsWebhook } from './elevenlabs-webhook';

const SECRET = 'wsec_test_shared_secret';
const NOW = 1_784_500_000_000; // fixed clock (ms) — the SDK reads Date.now()
const event = { type: 'post_call_transcription', data: { conversation_id: 'c1' } };
const body = JSON.stringify(event);

// Build a valid `ElevenLabs-Signature` header for a given timestamp (unix seconds).
function sign(tSeconds: number, rawBody: string, secret = SECRET): string {
  const v0 = createHmac('sha256', secret).update(`${tSeconds}.${rawBody}`).digest('hex');
  return `t=${tSeconds},v0=${v0}`;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyElevenLabsWebhook', () => {
  const nowSec = Math.floor(NOW / 1000);

  it('accepts a correctly-signed, fresh request and returns the parsed body', async () => {
    expect(await verifyElevenLabsWebhook(body, sign(nowSec, body), SECRET)).toEqual({ valid: true, event });
  });

  it('accepts when the header parts are in reverse order (order-independent)', async () => {
    const v0 = createHmac('sha256', SECRET).update(`${nowSec}.${body}`).digest('hex');
    expect(await verifyElevenLabsWebhook(body, `v0=${v0},t=${nowSec}`, SECRET)).toEqual({ valid: true, event });
  });

  it('a signed body that is not JSON is valid, with no event', async () => {
    const raw = 'not json';
    expect(await verifyElevenLabsWebhook(raw, sign(nowSec, raw), SECRET)).toEqual({ valid: true, event: undefined });
  });

  it('rejects a tampered body', async () => {
    const header = sign(nowSec, body);
    expect(await verifyElevenLabsWebhook(body + 'x', header, SECRET)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects a wrong secret', async () => {
    expect(await verifyElevenLabsWebhook(body, sign(nowSec, body, 'other_secret'), SECRET)).toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a timestamp older than the 30-minute tolerance', async () => {
    const stale = nowSec - 31 * 60;
    expect(await verifyElevenLabsWebhook(body, sign(stale, body), SECRET)).toEqual({ valid: false, reason: 'expired' });
  });

  it('accepts a timestamp within the 30-minute tolerance', async () => {
    const recent = nowSec - 29 * 60;
    expect(await verifyElevenLabsWebhook(body, sign(recent, body), SECRET)).toEqual({ valid: true, event });
  });

  it('rejects a header without both parts', async () => {
    for (const h of [null, undefined, '', 'garbage', `t=${nowSec}`, 'v0=abc']) {
      expect(await verifyElevenLabsWebhook(body, h, SECRET)).toEqual({ valid: false, reason: 'malformed_header' });
    }
  });

  it('a non-numeric timestamp is refused (the SDK reaches the digest and reports a bad signature)', async () => {
    expect(await verifyElevenLabsWebhook(body, 't=abc,v0=def', SECRET)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects when no secret is configured', async () => {
    expect(await verifyElevenLabsWebhook(body, sign(nowSec, body), null)).toEqual({ valid: false, reason: 'no_secret' });
  });
});
