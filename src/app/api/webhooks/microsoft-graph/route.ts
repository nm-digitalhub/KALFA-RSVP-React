import { type NextRequest, NextResponse } from 'next/server';

import { insertWebhookEvents } from '@/lib/data/webhooks';
import { type GraphNotification, graphNotificationRows } from '@/lib/microsoft/notifications';
import { webhookClientState } from '@/lib/microsoft/subscriptions';

// Microsoft Graph change notifications — persist-then-process, the same shape
// as the WhatsApp webhook. Server-to-server: the `clientState` we set when
// creating the subscription IS the auth (no session, no CSRF).
//
// This route does the minimum: answer Graph's validation handshake, check
// clientState, normalize every notification in the (batched) delivery, insert
// durably, return fast. A notification carries only a RESOURCE ID and never
// content, so the worker is what actually reads the message or the calendar —
// which is also what keeps the mailbox credential out of the request path.
// Mail, calendar and lifecycle notifications all arrive here; telling them
// apart is graphNotificationRows' job (src/lib/microsoft/notifications.ts).
//
// Never log the payload, the sender, or the client state.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Graph validates a notification URL by POSTing to it with a `validationToken`
 * query parameter and requiring that exact string back as text/plain within 10
 * seconds. It is sent BEFORE any subscription exists, so this must run before
 * any auth check — there is nothing yet to authenticate against. A calendar
 * subscription's lifecycle URL is this same route, and is validated the same way.
 */
function validationResponse(request: NextRequest): NextResponse | null {
  const token = request.nextUrl.searchParams.get('validationToken');
  if (token === null) return null;
  return new NextResponse(token, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: NextRequest) {
  const validation = validationResponse(request);
  if (validation) return validation;

  let expected: string;
  try {
    expected = webhookClientState();
  } catch {
    // Not configured — accept and discard rather than 5xx, so a half-configured
    // deployment cannot make Graph retry in a loop. Nothing is written.
    return new NextResponse('ok', { status: 202 });
  }

  let body: { value?: GraphNotification[] };
  try {
    body = (await request.json()) as { value?: GraphNotification[] };
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }

  const rows = graphNotificationRows(body.value ?? [], expected);

  if (rows.length > 0) {
    await insertWebhookEvents(rows);
  }
  // 202: accepted for processing. Graph only needs a 2xx within 3 seconds.
  return new NextResponse('ok', { status: 202 });
}
