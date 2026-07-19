import { createHmac, timingSafeEqual } from 'node:crypto';

// Verify an ElevenLabs webhook signature (post-call / workspace webhooks).
// Scheme confirmed against the OFFICIAL SDK (elevenlabs-js
// src/wrapper/webhooks.ts → WebhooksClient.constructEvent), 2026-07-19:
//   - header `ElevenLabs-Signature` (HTTP, case-insensitive), value `t=<unix>,v0=<hex>`;
//   - digest = HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as lowercase hex;
//   - the SDK compares the value WITH the `v0=` prefix on both sides;
//   - timestamp tolerance is 30 minutes, ONE-SIDED — it rejects only timestamps
//     OLDER than now-30m (no future bound; a forged future timestamp is a non-issue
//     because it is inside the signed string, so it needs the secret anyway).
// The `rawBody` MUST be the exact received bytes — verify BEFORE JSON.parse.
// The signing secret is the shared secret shown once at webhook creation (not
// retrievable via API); KALFA stores it as env `ELEVENLABS_WEBHOOK`.

const TOLERANCE_MS = 30 * 60 * 1000;

export type WebhookVerifyReason = 'no_secret' | 'malformed_header' | 'expired' | 'bad_signature';
export interface WebhookVerifyResult {
  valid: boolean;
  reason?: WebhookVerifyReason;
}

// Parse `t=<unix>,v0=<hex>` — order-independent, tolerant of extra comma parts.
function parseSignatureHeader(header: string | null | undefined): { t: string; v0: string } | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim());
  const t = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v0 = parts.find((p) => p.startsWith('v0='))?.slice(3);
  if (!t || !v0 || !/^\d+$/.test(t)) return null;
  return { t, v0 };
}

export function verifyElevenLabsWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number,
): WebhookVerifyResult {
  if (!secret) return { valid: false, reason: 'no_secret' };
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { valid: false, reason: 'malformed_header' };

  // Freshness: `t` is unix SECONDS; reject anything older than the 30-min window.
  const tsMs = Number(parsed.t) * 1000;
  if (!Number.isFinite(tsMs) || tsMs < nowMs - TOLERANCE_MS) return { valid: false, reason: 'expired' };

  const expected = 'v0=' + createHmac('sha256', secret).update(`${parsed.t}.${rawBody}`).digest('hex');
  const presented = 'v0=' + parsed.v0;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  // Length guard first (timingSafeEqual throws on mismatch); a hex-length diff is
  // itself a bad signature.
  if (a.length !== b.length) return { valid: false, reason: 'bad_signature' };
  return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'bad_signature' };
}
