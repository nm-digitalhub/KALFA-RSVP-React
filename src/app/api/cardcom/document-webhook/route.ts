import { type NextRequest, NextResponse } from 'next/server';

import {
  CARDCOM_DOCUMENT_KIND,
  CARDCOM_PROVIDER,
  documentDedupeKey,
  parseCardcomReport,
  readDocumentReportSecret,
  secretMatches,
  withoutSecret,
} from '@/lib/data/cardcom-document-intake';
import { insertWebhookDelivery, insertWebhookEvents } from '@/lib/data/webhooks';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

// CardCom's document report: every document the terminal issues (support.cardcom.solutions, article 360007138014). This
// route only checks and stores, like every other provider webhook (persist-then-process): the report goes to
// webhook_deliveries as received (minus the secret) and to webhook_inbox as one 'cardcom_document' event, and the worker
// decides what it means (cardcom-document-processing.ts). Nothing here logs the body: it holds an ID number, names and phones.
//
// What it answers (CardCom retries up to 7 times in 24 hours while it does not get HTTP 200):
//   200  stored, or already stored (a repeated report is recognised by document type and number);
//   400  not a document report (no document number and type);
//   401  the secret is missing or wrong (or none is saved yet in /admin/integrations/cardcom);
//   413 / 429  too large, or an address that is flooding the route;
//   500  it could not be stored right now — CardCom posts again.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A report with document lines and card data is a few KB; this leaves room for long documents.
const MAX_BODY_BYTES = 64_000;
const RATE = { limit: 120, windowMs: 60_000 } as const;

const respond = (status: number) =>
  new NextResponse(status === 200 ? 'ok' : null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  const ip = getClientIp((name) => request.headers.get(name));
  if (!rateLimit(`cardcom-document-webhook:${ip}`, RATE).allowed) return respond(429);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return respond(413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return respond(413);

  const fields = parseCardcomReport(text, new URL(request.url).searchParams);
  if (!secretMatches(fields, await readDocumentReportSecret())) return respond(401);

  const dedupeKey = documentDedupeKey(fields);
  if (!dedupeKey) return respond(400);

  const stored = withoutSecret(fields);
  try {
    // The delivery copy is diagnostic: a failure to keep it must not cost the event (insertWebhookDelivery returns null).
    const deliveryId = await insertWebhookDelivery({
      provider: CARDCOM_PROVIDER,
      raw: JSON.stringify(stored),
      body: stored,
    });
    await insertWebhookEvents([
      {
        provider: CARDCOM_PROVIDER,
        event_kind: CARDCOM_DOCUMENT_KIND,
        dedupe_key: dedupeKey,
        payload: stored,
        delivery_id: deliveryId,
      },
    ]);
    return respond(200);
  } catch {
    console.error('[cardcom-document-webhook] could not store the report', { dedupeKey });
    return respond(500);
  }
}
