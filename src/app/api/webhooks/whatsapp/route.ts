import { type NextRequest, NextResponse } from 'next/server';
import { WhatsAppAPI } from 'whatsapp-api-js';
import type { PostData } from 'whatsapp-api-js/types';

import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import {
  insertWebhookEvents,
  type WebhookInboxInsert,
} from '@/lib/data/webhooks';

// Meta WhatsApp inbound webhook — persist-then-process (B2). Server-to-server:
// the X-Hub-Signature-256 HMAC IS the auth (no session/CSRF). This route does
// the minimum: verify the signature with the installed whatsapp-api-js, normalize
// EVERY event in the (possibly batched) payload, durably insert into
// webhook_inbox, and return 200 fast. A pg-boss worker does all economic logic
// out-of-band. Fail-closed: disabled/unsigned ⇒ nothing is written. Never log the
// raw body, phone, payload, or app secret.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Meta timestamps are unix SECONDS as strings → ISO, or null if absent/garbage.
function tsToIso(ts: string | undefined): string | null {
  if (!ts) return null;
  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

// Flatten the verified PostData into webhook_inbox rows. We DON'T use the
// library's emitter/`post()` dispatch on purpose: it only reads
// entry[0].changes[0] and messages[0]/statuses[0], silently dropping the rest of
// a batched delivery. Iterating the typed PostData ourselves (no hand-written
// payload types) captures every message and status. Dedupe is at the DB via
// (provider, dedupe_key); the worker is idempotent regardless.
function normalizeWebhookRows(data: PostData): WebhookInboxInsert[] {
  const rows: WebhookInboxInsert[] = [];
  for (const entry of data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;

      if ('messages' in value) {
        for (const message of value.messages) {
          if (!message?.id) continue;
          rows.push({
            provider: 'whatsapp',
            event_kind: 'message',
            dedupe_key: `wa-msg:${message.id}`,
            message_id: message.id,
            context_message_id: message.context?.id ?? null,
            phone_number_id: phoneNumberId,
            event_at: tsToIso(message.timestamp),
            payload: message as unknown as WebhookInboxInsert['payload'],
          });
        }
      } else if ('statuses' in value) {
        for (const status of value.statuses) {
          if (!status?.id || !status?.status) continue;
          rows.push({
            provider: 'whatsapp',
            event_kind: 'status',
            // status is keyed by (id, status) so each lifecycle transition
            // (sent→delivered→read) persists once without colliding.
            dedupe_key: `wa-status:${status.id}:${status.status}`,
            message_id: status.id,
            context_message_id: null,
            phone_number_id: phoneNumberId,
            event_at: tsToIso(status.timestamp),
            payload: status as unknown as WebhookInboxInsert['payload'],
          });
        }
      }
    }
  }
  return rows;
}

// GET: Meta's subscription verification challenge. Gate on the configured verify
// token ONLY — Meta may verify the callback URL before outreach is switched on.
export async function GET(request: NextRequest) {
  const config = await getWhatsAppConfig();
  if (!config?.verifyToken) {
    return new NextResponse('not found', { status: 404 });
  }
  const params = request.nextUrl.searchParams;
  if (
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') === config.verifyToken
  ) {
    return new NextResponse(params.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('forbidden', { status: 403 });
}

// POST: a signed inbound delivery. Verify → normalize → persist. No billing here.
export async function POST(request: NextRequest) {
  const [enabled, config] = await Promise.all([
    getOutreachEnabled(),
    getWhatsAppConfig(),
  ]);
  // 200 (not 5xx) so a misconfigured/disabled endpoint doesn't trigger Meta
  // retry storms; nothing is written.
  if (!enabled || !config?.appSecret) {
    return new NextResponse('ok', { status: 200 });
  }

  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  // Verify with the library's HMAC (no hand-rolled crypto). secure:true derives
  // the key from appSecret and validates X-Hub-Signature-256 over the raw body.
  const wa = new WhatsAppAPI({
    token: config.accessToken,
    appSecret: config.appSecret,
    secure: true,
  });
  let verified = false;
  try {
    verified = await wa.verifyRequestSignature(raw, signature ?? '');
  } catch {
    // Missing appSecret/crypto.subtle — appSecret is gated above and subtle is
    // present on the Node runtime; fail closed on the unexpected.
    verified = false;
  }
  if (!verified) {
    return new NextResponse('invalid signature', { status: 401 });
  }

  let data: PostData;
  try {
    data = JSON.parse(raw) as PostData;
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }

  const rows = normalizeWebhookRows(data);
  if (rows.length > 0) {
    await insertWebhookEvents(rows);
  }
  return new NextResponse('ok', { status: 200 });
}
