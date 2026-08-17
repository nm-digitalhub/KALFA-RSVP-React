import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  LIVE_CUSTOMER_CALL_KINDS,
  recordConsoleConferenceAudit,
  resolveExternalDialTarget,
  resolveTransferTarget,
} from '@/lib/data/console-calls';
import { consoleConferenceBodySchema } from '@/lib/validation/console-calls';
import {
  pickSessionUrl,
  postCommandToSession,
  type SessionCommandEnvelope,
} from '@/lib/voximplant/session-command';

// POST /api/console-calls/{id}/conference   body: { to_agent_id: uuid }
//
// 3-way conference (plan stage 2). Mirrors transfer/route.ts and
// consult/route.ts: { id } is a live manual-outbound or inbound-customer
// console_calls row; the browser names the TARGET AGENT only, resolved
// server-side via the same resolveTransferTarget() every other live-call
// action here uses, then posted as
// {command:'conference_add', request_id, payload:{vox_username}} —
// ConsoleDial.voxengine.js / ConsoleInbound.voxengine.js's `conference_add`
// branch (verbatim).
//
// Unlike consult, the customer is NOT put on hold while the target is dialed
// — the existing operator<->customer bridge stays live through the ring, and
// only once the target answers does the scenario create the mixer
// (VoxEngine.createConference) and rewire customer+operator+target into it
// (RSVPAgent's supervisor-conference primitives, same as the plan's
// monitor/takeover topology). V1 supports exactly one additional
// participant (3-way total, matching this task's scope) — no queued/stacked
// conference_add while one is already dialing or live.
//
// console_calls.conference_agent_ids bookkeeping is EVENT-driven
// (conference_joined/conference_ended, see /api/voximplant/console/event) —
// this route only validates, resolves, and delivers. 2xx here means
// DELIVERED, never "joined".

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const uuidSchema = z.string().uuid();

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { ctx } = auth;

  if (!(await callerHasPlatformPermission(ctx.supabase, 'manage_voice'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  const { id: callId } = await params;
  if (!uuidSchema.safeParse(callId).success) {
    return json({ error: 'מזהה שיחה לא תקין' }, 400);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json({ error: 'בקשה גדולה מדי' }, 413);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  }
  const parsed = consoleConferenceBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  const body = parsed.data;

  const call = await getConsoleCallById(callId);
  if (!call) return json({ error: 'שיחה לא נמצאה' }, 404);
  if (!LIVE_CUSTOMER_CALL_KINDS.has(call.kind)) {
    return json({ error: 'לא ניתן לצרף לשיחה מסוג זה' }, 409);
  }
  if (call.status !== 'connected') {
    return json({ error: 'השיחה אינה מחוברת כעת' }, 409);
  }

  // Two kinds of target, two authorities — see consult/route.ts for the same
  // split and the reasoning behind resolveExternalDialTarget's gate order.
  let payload: { vox_username: string } | { phone: string };
  if ('to_agent_id' in body) {
    const target = await resolveTransferTarget(body.to_agent_id, ctx.userId);
    if (!target.ok) {
      const messages: Record<typeof target.reason, string> = {
        self: 'לא ניתן לצרף את עצמך',
        not_found: 'הנציג המבוקש לא נמצא',
        not_provisioned: 'לנציג המבוקש אין זהות טלפוניה במוקד',
        not_ready: 'הנציג המבוקש אינו זמין כעת',
      };
      return json({ error: messages[target.reason] }, 409);
    }
    payload = { vox_username: target.voxUsername };
  } else {
    const external = await resolveExternalDialTarget(body.to_phone, ctx.userId);
    if (!external.ok) {
      const messages: Record<typeof external.reason, string> = {
        invalid: 'מספר הטלפון אינו תקין',
        not_allowed_country: 'ניתן לחייג למספרים ישראליים בלבד',
        dnc: 'המספר מופיע ברשימת החסומים',
        rate_limited: 'בוצעו יותר מדי חיוגים החוצה. נסו שוב בעוד זמן מה.',
      };
      return json({ error: messages[external.reason] }, external.reason === 'rate_limited' ? 429 : 409);
    }
    payload = { phone: external.phone };
  }

  const sessionUrls = await getConsoleCallSessionUrls(callId);
  const sessionUrl = pickSessionUrl(
    sessionUrls?.secureSessionUrl ?? null,
    sessionUrls?.sessionUrl ?? null,
  );
  if (!sessionUrl) return json({ error: 'השיחה אינה זמינה לצירוף כעת' }, 409);

  const requestId = randomUUID();
  const envelope: SessionCommandEnvelope = {
    command: 'conference_add',
    request_id: requestId,
    payload,
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return json({ error: 'בקשת הצירוף לא נמסרה לשיחה' }, 502);
  }

  await recordConsoleConferenceAudit({
    fromAgentId: ctx.userId,
    ...('to_agent_id' in body ? { toAgentId: body.to_agent_id } : { externalTarget: true }),
    consoleCallId: callId,
    eventId: call.eventId,
    requestId,
  });

  // Delivered; NOT confirmed. The scenario's own conference_joined /
  // conference_failed report is the truth the panel must watch.
  //
  // The phone number is never echoed back — the response names the KIND of target
  // accepted, so a response body cannot become a second copy of a dialable number.
  return json(
    {
      conferencing: true,
      request_id: requestId,
      target: 'vox_username' in payload ? 'agent' : 'external',
      ...('to_agent_id' in body ? { to_agent_id: body.to_agent_id } : {}),
    },
    202,
  );
}
