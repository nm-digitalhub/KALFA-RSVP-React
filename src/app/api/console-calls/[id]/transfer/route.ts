import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  LIVE_CUSTOMER_CALL_KINDS,
  recordConsoleTransferAudit,
  resolveTransferTarget,
} from '@/lib/data/console-calls';
import { consoleTransferBodySchema } from '@/lib/validation/console-calls';
import {
  pickSessionUrl,
  postCommandToSession,
  type SessionCommandEnvelope,
} from '@/lib/voximplant/session-command';

// POST /api/console-calls/{id}/transfer   body: { to_agent_id: uuid }
//
// Blind agent-to-agent transfer (plan stage 7, V1 = scenario-side, no consult).
// { id } is a console_calls row (a live manual-outbound or inbound-customer
// call — NEVER an ai_handoff row or an internal call, which this route does
// not touch at all). The browser names the TARGET AGENT only; the route
// resolves it to a routable vox_username server-side (never trusts a
// Voximplant identity from the client) and posts the SAME
// {command:'transfer', request_id, payload:{vox_username}} envelope
// ConsoleDial.voxengine.js / ConsoleInbound.voxengine.js already dispatch on
// (both scenarios' `transfer` branch, verbatim).
//
// console_calls.transferred_to_agent_id bookkeeping is EVENT-driven — the
// scenario's own transfer_started/transferred/transfer_failed reports
// (POST /api/voximplant/console/event) already own that write. This route
// never touches console_calls itself: it only validates, resolves, and
// delivers. 2xx here means DELIVERED to the live session, never "the
// transfer happened" — the scenario answers that out-of-band via those
// events, which the panel watches, exactly like the AI-command channel.
//
// Auth mirrors every other live-call console route: requireConsoleAgent
// (Bearer + staff) + manage_voice at the route (the call-floor authority,
// not per-agent ownership — same model as /monitor and /agent-command, which
// let any manage_voice holder act on any live call).

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
  const parsed = consoleTransferBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  const { to_agent_id: toAgentId } = parsed.data;

  const call = await getConsoleCallById(callId);
  if (!call) return json({ error: 'שיחה לא נמצאה' }, 404);
  if (!LIVE_CUSTOMER_CALL_KINDS.has(call.kind)) {
    return json({ error: 'לא ניתן להעביר שיחה מסוג זה' }, 409);
  }
  // Only a call with a live bridge (operator + remote both connected) can be
  // transferred — the scenario's own startTransfer() silently no-ops
  // otherwise (no transfer_failed report either), so gating here on the
  // narrower 'connected' state (not the wider LIVE_STATUSES) keeps the
  // 202/404/409 contract honest instead of returning "delivered" for a
  // command the scenario will drop on the floor.
  if (call.status !== 'connected') {
    return json({ error: 'השיחה אינה מחוברת כעת' }, 409);
  }

  const target = await resolveTransferTarget(toAgentId, ctx.userId);
  if (!target.ok) {
    const messages: Record<typeof target.reason, string> = {
      self: 'לא ניתן להעביר שיחה לעצמך',
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
  if (!sessionUrl) return json({ error: 'השיחה אינה זמינה להעברה כעת' }, 409);

  const requestId = randomUUID();
  const envelope: SessionCommandEnvelope = {
    command: 'transfer',
    request_id: requestId,
    payload: { vox_username: target.voxUsername },
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return json({ error: 'בקשת ההעברה לא נמסרה לשיחה' }, 502);
  }

  // Best-effort — never blocks the response. The console_calls row itself
  // (via the event-driven transferred_to_agent_id) remains the primary durable
  // record; this is the "who initiated" trail the consent-matrix audit
  // established a precedent for (recordConsoleDialAudit).
  await recordConsoleTransferAudit({
    fromAgentId: ctx.userId,
    toAgentId,
    consoleCallId: callId,
    eventId: call.eventId,
    requestId,
  });

  // Delivered; NOT confirmed. The scenario reports transfer_started ->
  // transferred | transfer_failed asynchronously via the event route, which
  // is what the panel must watch (console_calls realtime) — never this 202.
  return json({ transferring: true, request_id: requestId, to_agent_id: toAgentId }, 202);
}
