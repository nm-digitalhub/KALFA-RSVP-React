import { type NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

import { insertWebhookEvents } from '@/lib/data/webhooks';

// Resend delivery-outcome notifications — persist-then-process, the same shape as
// the Graph and WhatsApp webhooks. Server-to-server: the Standard Webhooks
// signature IS the auth (no session, no CSRF).
//
// Why this exists: once Resend accepts a message, every downstream failure is
// currently invisible to us. `sender.ts` throws only when the API call itself is
// rejected — a wrong address, a full mailbox or a spam block is silent, so the
// follow-up cascade keeps mailing an address that is bouncing every send. See
// docs/inquiry-routing-and-messageid-plan-2026-08-26.md §8.1/§8.2.
//
// NOTE: no `export const runtime` here on purpose. VERIFIED against the installed
// Next.js docs (03-file-conventions/02-route-segment-config/runtime.md): 'nodejs'
// is the default and the Edge runtime is deprecated — "Remove the `runtime`
// export from your route files". The older webhook routes still carry it.
// `dynamic` is likewise unnecessary: route handlers are uncached by default and
// only GET can opt in, so a POST-only route is never cached.
//
// Never log the payload — it carries recipient addresses and subjects.

// Events we act on. Everything else is acknowledged and dropped rather than
// rejected: Resend retries anything that is not a 200 (Immediately, 5s, 5m, 30m,
// 2h, 5h, 10h, 10h — eight attempts over ~27.5h) and DISABLES an endpoint that
// keeps failing, so a 4xx on an event type we simply don't want would eventually
// switch delivery off for the events we do.
const HANDLED_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
]);

/**
 * Standard Webhooks names its headers `webhook-*`; Resend sends the Svix-branded
 * `svix-*` aliases. Read both so a rename on their side cannot silently break
 * verification. (resend.webhooks.verify() maps whichever we pass onto the
 * `webhook-*` names internally — VERIFIED in resend/dist/index.mjs.)
 */
function signatureHeaders(request: NextRequest) {
  const pick = (svix: string, standard: string) =>
    request.headers.get(svix) ?? request.headers.get(standard) ?? '';
  return {
    id: pick('svix-id', 'webhook-id'),
    timestamp: pick('svix-timestamp', 'webhook-timestamp'),
    signature: pick('svix-signature', 'webhook-signature'),
  };
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // 200, not 5xx: an unconfigured deployment must not trigger the retry ladder
  // or get itself disabled. Same reasoning as the WhatsApp route's disabled path.
  if (!secret) return new NextResponse('not configured', { status: 200 });

  // RAW body. The signature is byte-sensitive, so this must never be
  // request.json() (which would re-serialise). Next.js's own webhook example
  // uses request.text() and notes no bodyParser config is needed in App Router.
  const raw = await request.text();
  const headers = signatureHeaders(request);

  // verify() does HMAC-SHA256 with a timing-safe compare AND rejects timestamps
  // outside a 5-minute window (WEBHOOK_TOLERANCE_IN_SECONDS in standardwebhooks),
  // which is our replay protection. It throws WebhookVerificationError on any
  // failure and returns the parsed payload on success.
  // `email_id` and `message_id` are DIFFERENT identifiers, and the docs say so
  // explicitly (resend.com/docs/webhooks/emails/*, read 2026-08-26):
  //   email_id   — "Unique identifier for the specific email"  (Resend's UUID)
  //   message_id — "RFC Message-ID header value for the email"
  // Both are present on all six events we subscribe to.
  let event: { type?: string; data?: { email_id?: string; message_id?: string } };
  try {
    // A placeholder key, not RESEND_API_KEY: verified against resend/dist's own
    // source (Webhooks.verify(), 2026-08-30) that it never touches this.key or
    // makes any API call — it only builds a Webhook(payload.webhookSecret)
    // instance internally. The Resend constructor's own "Missing API key" throw
    // only fires when BOTH the constructor arg AND process.env.RESEND_API_KEY
    // are absent, so any non-empty string here fully decouples signature
    // verification from that unrelated env var (bug found by qa-runner
    // 2026-08-29: a test env without RESEND_API_KEY set failed every case with
    // a misleading "invalid signature" instead of the real cause).
    event = new Resend('unused-webhook-verify-only').webhooks.verify({
      payload: raw,
      headers,
      webhookSecret: secret,
    }) as typeof event;
  } catch {
    // Verify BEFORE persisting so an unsigned caller cannot fill the table.
    // 401 is deliberate: a genuine Resend delivery never lands here, and an
    // unsigned one SHOULD be retried at rather than quietly accepted.
    return new NextResponse('invalid signature', { status: 401 });
  }

  // The per-delivery id, NOT email_id: one email emits several events over its
  // lifetime (sent → delivered → bounced), so keying on email_id would collapse
  // distinct events into one. Resend names svix-id as the duplicate-detection
  // identifier, which is exactly what UNIQUE(provider, dedupe_key) needs.
  const deliveryId = headers.id;
  if (!deliveryId || !event?.type) {
    return new NextResponse('malformed', { status: 400 });
  }
  if (!HANDLED_EVENTS.has(event.type)) {
    return new NextResponse('ignored', { status: 200 });
  }

  await insertWebhookEvents([
    {
      provider: 'resend',
      dedupe_key: deliveryId,
      event_kind: 'email_delivery',
      // The RFC 5322 Message-ID, NOT Resend's email_id. This column means "the
      // provider's message identifier we correlate on" everywhere else in
      // webhook_inbox, and for mail that is the Message-ID header — the value
      // In-Reply-To/References are matched against, which is what the threading
      // work in §8.1/§8.2 needs. It arrives free on every delivery event, so the
      // GET /emails/{id} poll (and its two-format trap) is not needed here.
      // email_id is not lost: the whole payload is stored below.
      message_id: event.data?.message_id ?? null,
      payload: JSON.parse(raw),
    },
  ]);

  return new NextResponse('ok', { status: 200 });
}
