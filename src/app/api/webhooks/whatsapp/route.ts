import { createHash } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';
import { WhatsAppAPI } from 'whatsapp-api-js';
import type { PostData } from 'whatsapp-api-js/types';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import {
  insertWebhookDelivery,
  insertWebhookEvents,
  type WebhookInboxInsert,
} from '@/lib/data/webhooks';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

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

// Template-health webhook fields (message_template_status_update,
// template_category_update, template_correct_category_detection,
// message_template_quality_update) are NOT part of whatsapp-api-js's typed
// PostData union (it only models "messages"/"calls") — live-doc-verified
// shapes (2026-08-27), read generically off the raw parsed JSON rather than
// hand-invented. See src/lib/data/template-health-processing.ts for how each
// is applied to message_templates.
interface RawChange {
  field: string;
  value: Record<string, unknown>;
}
interface RawEntry {
  id?: string;
  time?: number;
  changes?: RawChange[];
}
type RawPostData = { entry?: RawEntry[] };

const TEMPLATE_HEALTH_FIELDS = new Set([
  'message_template_status_update',
  'template_category_update',
  'template_correct_category_detection',
  'message_template_quality_update',
]);

// event_kind naming mirrors the Meta field name 1:1, minus the common prefix,
// so the worker dispatcher (webhook-processing.ts) reads as a direct map.
const TEMPLATE_EVENT_KIND: Record<string, string> = {
  message_template_status_update: 'template_status',
  template_category_update: 'template_category',
  template_correct_category_detection: 'template_category_misuse',
  message_template_quality_update: 'template_quality',
};

function normalizeTemplateHealthRows(raw: RawPostData): WebhookInboxInsert[] {
  const rows: WebhookInboxInsert[] = [];
  for (const entry of raw.entry ?? []) {
    const entryTime = entry.time;
    for (const change of entry.changes ?? []) {
      if (!TEMPLATE_HEALTH_FIELDS.has(change.field)) continue;
      const templateId = change.value.message_template_id;
      if (templateId == null) continue;
      const kind = TEMPLATE_EVENT_KIND[change.field];
      rows.push({
        provider: 'whatsapp',
        event_kind: kind,
        // Keyed by (template, delivery time): a genuine Meta retry of the
        // SAME delivery repeats `time` (→ no-op via ON CONFLICT); a later,
        // real state change (re-approval after a fix, a new quality dip)
        // carries a new `time` and is kept.
        dedupe_key: `wa-tmpl:${kind}:${templateId}:${entryTime ?? 'na'}`,
        message_id: null,
        context_message_id: null,
        phone_number_id: null,
        event_at: tsToIso(entryTime != null ? String(entryTime) : undefined),
        payload: change.value as unknown as WebhookInboxInsert['payload'],
      });
    }
  }
  return rows;
}

// Every OTHER change in a verified delivery — any subscribed field the two
// normalizers above do not model (account_update, business_username_updates,
// phone_number_quality_update, user_preferences, calls, security, …), a
// template-health change without a template id, or a `messages` change that
// carries neither `messages` nor `statuses` (e.g. an `errors` block) — is
// persisted generically under the Meta field name. Nothing Meta signs and
// delivers is allowed to vanish: it stays inspectable in /admin/webhooks and the
// worker, which has no handler for these kinds, marks it processed untouched.
// The dedupe key hashes the change value so a Meta retry of the SAME delivery
// is a DB no-op while two distinct events sharing an entry `time` both persist.
function normalizeOtherFieldRows(raw: RawPostData): WebhookInboxInsert[] {
  const rows: WebhookInboxInsert[] = [];
  for (const entry of raw.entry ?? []) {
    const entryTime = entry.time;
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      let kind: string;
      if (change.field === 'messages') {
        if ('messages' in value || 'statuses' in value) continue; // typed path above
        kind = 'messages_other';
      } else if (
        TEMPLATE_HEALTH_FIELDS.has(change.field) &&
        value.message_template_id != null
      ) {
        continue; // template-health path above
      } else {
        kind = change.field;
      }
      const metadata = value.metadata as { phone_number_id?: unknown } | undefined;
      const phoneNumberId =
        typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : null;
      const digest = createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex')
        .slice(0, 16);
      rows.push({
        provider: 'whatsapp',
        event_kind: kind,
        dedupe_key: `wa-field:${kind}:${entry.id ?? 'na'}:${entryTime ?? 'na'}:${digest}`,
        message_id: null,
        context_message_id: null,
        phone_number_id: phoneNumberId,
        event_at: tsToIso(entryTime != null ? String(entryTime) : undefined),
        payload: value as unknown as WebhookInboxInsert['payload'],
      });
    }
  }
  return rows;
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

      // Meta's App Dashboard "Test" button replays one fixed sample (entry.id
      // "0", phone_number_id "123456123", wamid "ABGGFlA5Fpa") on every click.
      // Under the production key every click after the first would be a silent
      // DB no-op, so sandbox deliveries get a per-request suffix — each test
      // scenario (username adopted, phone unavailable, …) stays inspectable.
      // Real WABA deliveries never carry these ids and keep the exact key.
      const sandbox = entry.id === '0' || phoneNumberId === '123456123';
      const testSuffix = sandbox ? `:test:${Date.now()}` : '';

      // The value-level contacts[] block is where Meta puts the sender's
      // profile name, wa_id and — with the BSUID/usernames rollout — user_id
      // and username. It is not part of the message/status object, so it is
      // carried on the row under keys that cannot collide with a message field
      // (`contacts` is itself a message type: a shared contact card).
      const contactBlock = (value as unknown as { contacts?: unknown }).contacts;
      const contact =
        Array.isArray(contactBlock) &&
        contactBlock.length > 0 &&
        typeof contactBlock[0] === 'object' &&
        contactBlock[0] !== null
          ? (contactBlock[0] as Record<string, unknown>)
          : null;

      if ('messages' in value) {
        for (const message of value.messages) {
          if (!message?.id) continue;
          rows.push({
            provider: 'whatsapp',
            event_kind: 'message',
            dedupe_key: `wa-msg:${message.id}${testSuffix}`,
            message_id: message.id,
            context_message_id: message.context?.id ?? null,
            phone_number_id: phoneNumberId,
            event_at: tsToIso(message.timestamp),
            payload: {
              ...(message as unknown as Record<string, unknown>),
              ...(contact ? { sender_contact: contact } : {}),
            } as unknown as WebhookInboxInsert['payload'],
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
            dedupe_key: `wa-status:${status.id}:${status.status}${testSuffix}`,
            message_id: status.id,
            context_message_id: null,
            phone_number_id: phoneNumberId,
            event_at: tsToIso(status.timestamp),
            payload: {
              ...(status as unknown as Record<string, unknown>),
              ...(contact ? { recipient_contact: contact } : {}),
            } as unknown as WebhookInboxInsert['payload'],
          });
        }
      }
    }
  }
  rows.push(...normalizeTemplateHealthRows(data as unknown as RawPostData));
  rows.push(...normalizeOtherFieldRows(data as unknown as RawPostData));
  return rows;
}

// A rejected delivery writes nothing (fail-closed) but must not be invisible:
// an ids-only ops alert (reason + byte length — never the body, a phone or the
// signature) so a secret mismatch or a broken sender shows up in Slack instead
// of as a silent gap in /admin/webhooks. sendSlackAlert is fail-safe, deduped
// and rate-limited, so a retry storm cannot flood the channel.
async function alertRejectedDelivery(
  reason: 'invalid_signature' | 'malformed_body',
  bytes: number,
): Promise<void> {
  await sendSlackAlert({
    level: 'warn',
    category: 'send_health',
    source: 'whatsapp-webhook',
    title:
      reason === 'invalid_signature'
        ? 'WhatsApp webhook נדחה — חתימה לא תקינה'
        : 'WhatsApp webhook נדחה — גוף לא תקין',
    detail:
      reason === 'invalid_signature'
        ? 'X-Hub-Signature-256 לא תואם ל-app secret שב-/admin/channels. שום דבר לא נכתב. אם זו שליחה שלנו — לבדוק את ה-secret; אם לא — מקור זר.'
        : 'הבקשה חתומה נכון אבל הגוף אינו JSON תקין. שום דבר לא נכתב.',
    fields: { reason, bytes },
  });
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
    v: GRAPH_API_VERSION,
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
    await alertRejectedDelivery('invalid_signature', raw.length);
    return new NextResponse('invalid signature', { status: 401 });
  }

  let data: PostData;
  try {
    data = JSON.parse(raw) as PostData;
  } catch {
    await alertRejectedDelivery('malformed_body', raw.length);
    return new NextResponse('bad request', { status: 400 });
  }

  // The verified envelope, verbatim, so the admin can always see what Meta
  // actually sent next to what we normalized out of it. Stored before the
  // events so each row can point at it; a null id (store failure / duplicate
  // race) never blocks the events themselves.
  const deliveryId = await insertWebhookDelivery({
    provider: 'whatsapp',
    raw,
    body: data as unknown as Parameters<typeof insertWebhookDelivery>[0]['body'],
  });

  const rows = normalizeWebhookRows(data).map((row) => ({
    ...row,
    delivery_id: deliveryId,
  }));
  if (rows.length > 0) {
    await insertWebhookEvents(rows);
  }
  return new NextResponse('ok', { status: 200 });
}
