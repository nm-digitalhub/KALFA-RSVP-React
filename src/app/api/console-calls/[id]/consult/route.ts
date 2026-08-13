import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  LIVE_CUSTOMER_CALL_KINDS,
  recordConsoleConsultAudit,
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
  const { to_agent_id: toAgentId } = parsed.data;

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

  const target = await resolveTransferTarget(toAgentId, ctx.userId);
  if (!target.ok) {
    const messages: Record<typeof target.reason, string> = {
      self: 'לא ניתן להתייעץ עם עצמך',
      not_found: 'הנציג המבוקש לא נמצא',
      not_provisioned: 'לנציג המבוקש אין זהות טלפוניה במוקד',
      not_ready: 'הנציג המבוקש אינו זמין כעת',
    };
    return json({ error: messages[target.reason] }, 409);
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
    payload: { vox_username: target.voxUsername },
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return json({ error: 'בקשת ההתייעצות לא נמסרה לשיחה' }, 502);
  }

  await recordConsoleConsultAudit({
    fromAgentId: ctx.userId,
    toAgentId,
    consoleCallId: callId,
    eventId: call.eventId,
    requestId,
    phase: 'start',
  });

  // Delivered; NOT confirmed. The scenario reports consult_started ->
  // consult_failed asynchronously via the event route — that (console_calls
  // realtime) is what the panel must watch, never this 202.
  return json({ consulting: true, request_id: requestId, to_agent_id: toAgentId }, 202);
}
