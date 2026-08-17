import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  LIVE_CUSTOMER_CALL_KINDS,
  recordConsoleConsultAudit,
  resolveExternalDialTarget,
  resolveTransferTarget,
} from '@/lib/data/console-calls';
import { consoleConsultBodySchema } from '@/lib/validation/console-calls';
import {
  pickSessionUrl,
  postCommandToSession,
  type SessionCommandEnvelope,
} from '@/lib/voximplant/session-command';

// POST /api/console-calls/{id}/consult   body: { to_agent_id: uuid }
//
// Consult-before-transfer, step 1 (plan stage 2 — accelerated ahead of the
// plan's own "שלב 2" deferral per this build's brief). Mirrors
// transfer/route.ts almost verbatim: { id } is a live manual-outbound or
// inbound-customer console_calls row (never ai_handoff/internal); the
// browser names the TARGET AGENT only, the route resolves it server-side via
// the SAME resolveTransferTarget() blind transfer already uses (routable =
// provisioned + ready, never self), and posts
// {command:'consult_start', request_id, payload:{vox_username}} —
// ConsoleDial.voxengine.js / ConsoleInbound.voxengine.js's `consult_start`
// branch (verbatim).
//
// Unlike a blind transfer, this does NOT end the call for the original
// operator: the scenario puts the customer on hold (silent — no hold-music
// asset; documented in the scenario) and privately bridges operator<->target
// so the customer hears neither side of the consultation. The operator then
// either POSTs .../consult/cancel (return to the customer) or
// .../consult/complete (the actual warm transfer: drop the operator, bridge
// customer<->target).
//
// console_calls.consult_agent_id bookkeeping is EVENT-driven, exactly like
// transferred_to_agent_id — this route only validates, resolves, and
// delivers. 2xx here means DELIVERED to the live session, never "the
// consultation started" — the scenario's own consult_started/consult_failed
// reports (POST /api/voximplant/console/event) are the truth the panel
// watches (console_calls realtime).
//
// Auth mirrors every other live-call console route: requireConsoleAgent
// (Bearer + staff) + manage_voice (the call-floor authority, not per-agent
// ownership).

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
  const parsed = consoleConsultBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  const body = parsed.data;

  const call = await getConsoleCallById(callId);
  if (!call) return json({ error: 'שיחה לא נמצאה' }, 404);
  if (!LIVE_CUSTOMER_CALL_KINDS.has(call.kind)) {
    return json({ error: 'לא ניתן להתייעץ על שיחה מסוג זה' }, 409);
  }
  // Same reasoning as transfer/route.ts: only a live-bridged call has
  // anything for the scenario's consult_start guard to act on.
  if (call.status !== 'connected') {
    return json({ error: 'השיחה אינה מחוברת כעת' }, 409);
  }

  // Two kinds of target, resolved by two different authorities, and neither
  // trusts the browser with a Voximplant identity or a dialable number: an agent
  // becomes a vox_username via resolveTransferTarget, an outside number is cleared
  // by resolveExternalDialTarget (E.164 + country allowlist + per-agent rate limit
  // + DNC — see its kdoc for the order and why).
  let payload: { vox_username: string } | { phone: string };
  if ('to_agent_id' in body) {
    const target = await resolveTransferTarget(body.to_agent_id, ctx.userId);
    if (!target.ok) {
      const messages: Record<typeof target.reason, string> = {
        self: 'לא ניתן להתייעץ עם עצמך',
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
      // 429 for the rate limit specifically, so a client can tell "wait" from
      // "this will never work"; everything else is a rejected target.
      return json({ error: messages[external.reason] }, external.reason === 'rate_limited' ? 429 : 409);
    }
    payload = { phone: external.phone };
  }

  const sessionUrls = await getConsoleCallSessionUrls(callId);
  const sessionUrl = pickSessionUrl(
    sessionUrls?.secureSessionUrl ?? null,
    sessionUrls?.sessionUrl ?? null,
  );
  if (!sessionUrl) return json({ error: 'השיחה אינה זמינה להתייעצות כעת' }, 409);

  const requestId = randomUUID();
  const envelope: SessionCommandEnvelope = {
    command: 'consult_start',
    request_id: requestId,
    payload,
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return json({ error: 'בקשת ההתייעצות לא נמסרה לשיחה' }, 502);
  }

  await recordConsoleConsultAudit({
    fromAgentId: ctx.userId,
    ...('vox_username' in payload
      ? { toAgentId: 'to_agent_id' in body ? body.to_agent_id : undefined }
      : { externalTarget: true }),
    consoleCallId: callId,
    eventId: call.eventId,
    requestId,
    phase: 'start',
  });

  // Delivered; NOT confirmed. The scenario reports consult_started ->
  // consult_failed asynchronously via the event route — that (console_calls
  // realtime) is what the panel must watch, never this 202.
  // The phone number is NEVER echoed back, even to the agent who typed it — the
  // response says which KIND of target was accepted and nothing more, so a
  // response body cannot become a second copy of a dialable number.
  return json(
    {
      consulting: true,
      request_id: requestId,
      target: 'vox_username' in payload ? 'agent' : 'external',
      ...('to_agent_id' in body ? { to_agent_id: body.to_agent_id } : {}),
    },
    202,
  );
}
