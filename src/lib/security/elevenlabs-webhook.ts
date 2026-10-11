import { ElevenLabsClient, ElevenLabsError } from '@elevenlabs/elevenlabs-js';

// Verify an ElevenLabs webhook signature (post-call / workspace webhooks) with the official SDK's
// WebhooksClient.constructEvent (@elevenlabs/elevenlabs-js, src/wrapper/webhooks.ts). What it checks, read from the
// installed SDK 11.10.2026:
//   - header `ElevenLabs-Signature`, value `t=<unix>,v0=<hex>`;
//   - digest = HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as lowercase hex, compared WITH the `v0=` prefix;
//   - timestamp tolerance is 30 minutes, ONE-SIDED — only timestamps OLDER than now-30m are refused (a forged future
//     timestamp needs the secret anyway: it is inside the signed string);
//   - on success it returns JSON.parse(rawBody).
// The SDK reports a failure only as an ElevenLabsError message; the messages below are mapped to fixed reasons so the
// routes and tests keep a stable contract. The routes collapse every reason into one 401 (no oracle).
//
// ⚠️ Owner decision 11.10.2026: use the SDK rather than our own HMAC. Its digest comparison is a plain string `!==`,
// not constant-time; the earlier hand-written version used timingSafeEqual.
//
// The `rawBody` MUST be the exact received bytes. The signing secret is the shared secret shown once at webhook
// creation; KALFA stores it as env `ELEVENLABS_WEBHOOK` / `ELEVENLABS_SALES_WEBHOOK`.

export type WebhookVerifyReason = 'no_secret' | 'malformed_header' | 'expired' | 'bad_signature';
export type WebhookVerifyResult =
  | {
      valid: true;
      /** The parsed body. `undefined` when the signature is valid but the body is not JSON. */
      event: unknown;
    }
  | { valid: false; reason: WebhookVerifyReason };

// constructEvent needs no API key and makes no request; the client is only its host.
const webhooks = new ElevenLabsClient({ apiKey: 'webhook-verification-only' }).webhooks;

function reasonOf(error: ElevenLabsError): WebhookVerifyReason {
  const message = error.message;
  if (message.includes('Webhook secret not configured')) return 'no_secret';
  if (message.includes('Timestamp outside the tolerance zone')) return 'expired';
  if (message.includes('does not match the expected signature')) return 'bad_signature';
  // 'Missing signature header' and 'No signature hash found with expected scheme v0'.
  return 'malformed_header';
}

export async function verifyElevenLabsWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
): Promise<WebhookVerifyResult> {
  if (!secret) return { valid: false, reason: 'no_secret' };
  if (!signatureHeader) return { valid: false, reason: 'malformed_header' };
  try {
    const event: unknown = await webhooks.constructEvent(rawBody, signatureHeader, secret);
    return { valid: true, event };
  } catch (error) {
    if (error instanceof ElevenLabsError) return { valid: false, reason: reasonOf(error) };
    // The signature passed and JSON.parse(rawBody) threw: a signed body that is not JSON.
    if (error instanceof SyntaxError) return { valid: true, event: undefined };
    return { valid: false, reason: 'bad_signature' };
  }
}
