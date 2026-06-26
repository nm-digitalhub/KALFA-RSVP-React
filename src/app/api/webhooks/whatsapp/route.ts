import { createHmac, timingSafeEqual } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import { classifyInbound, type WhatsAppWebhookValue } from '@/lib/whatsapp/inbound';
import {
  insertInteraction,
  resolveInboundContact,
} from '@/lib/data/interactions';
import { recordReached } from '@/lib/data/billing';

// Meta WhatsApp inbound webhook. Server-to-server: the HMAC signature IS the
// auth (no session/CSRF). Fail-closed — disabled or unsigned ⇒ nothing is
// written. The signature is verified BEFORE the body is trusted. Never log the
// raw body, phone, or app secret.

// Verify Meta's x-hub-signature-256 = 'sha256=' + HMAC_SHA256(rawBody, appSecret).
function verifySignature(
  raw: string,
  signature: string | null,
  appSecret: string,
): boolean {
  if (!signature) return false;
  const expected =
    'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type WebhookPayload = {
  entry?: Array<{ changes?: Array<{ value?: WhatsAppWebhookValue }> }>;
};

// GET: Meta's subscription verification challenge.
export async function GET(request: NextRequest) {
  const [enabled, config] = await Promise.all([
    getOutreachEnabled(),
    getWhatsAppConfig(),
  ]);
  if (!enabled || !config?.verifyToken) {
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

// POST: a signed inbound event. For each fresh billable human message →
// resolve → dedupe-insert → recordReached (the locked-txn RPC). Statuses
// (delivered/read) are non-billable and not yet mapped to op_status here.
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
  if (!verifySignature(raw, request.headers.get('x-hub-signature-256'), config.appSecret)) {
    return new NextResponse('invalid signature', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      const { billableMessages } = classifyInbound(value);
      for (const msg of billableMessages) {
        const resolved = await resolveInboundContact(msg.from);
        if (!resolved) continue;
        // Dedupe first (UNIQUE(channel, provider_id)) so a Meta retry can't
        // double-bill; recordReached is also idempotent at the DB.
        const fresh = await insertInteraction({
          event_id: resolved.eventId,
          campaign_id: resolved.campaignId,
          contact_id: resolved.contactId,
          channel: 'whatsapp',
          direction: 'in',
          kind: 'message',
          provider_id: msg.providerId,
          billable: true,
        });
        if (!fresh) continue;
        await recordReached({
          eventId: resolved.eventId,
          campaignId: resolved.campaignId,
          contactId: resolved.contactId,
          channel: 'whatsapp',
          attemptId: msg.providerId,
          evidence: 'whatsapp_inbound_message',
          providerRef: msg.providerId,
        });
      }
    }
  }

  return new NextResponse('ok', { status: 200 });
}
