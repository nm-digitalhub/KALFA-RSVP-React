import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  LIVE_CUSTOMER_CALL_KINDS,
  recordConsoleConsultAudit,
} from '@/lib/data/console-calls';
import { consoleEmptyActionBodySchema } from '@/lib/validation/console-calls';
import {
  pickSessionUrl,
  postCommandToSession,
  type SessionCommandEnvelope,
} from '@/lib/voximplant/session-command';

// POST /api/console-calls/{id}/consult/cancel   body: {}
//
// Abandons whichever consult attempt (dialing or already privately bridged
// with the operator) is currently live for this call and re-bridges
// operator<->customer. No target in the body — the scenario's own
// consult_cancel branch acts on whatever consult it already has in flight
// for THIS session; the route's job is only to deliver the command to the
// right live session (same "deliver, never resolve business state" split as
// transfer/route.ts).
//
// A cancel posted when there is no consult in flight is a safe, honestly
// logged no-op on the scenario side (its own guard) — this route does not
// pre-check console_calls.consult_agent_id for that reason (best-known state
// there can already be stale by the time this arrives; the scenario is
// authoritative).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256;
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
    parsedJson = raw.length > 0 ? JSON.parse(raw) : {};
  } catch {
    return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  }
  if (!consoleEmptyActionBodySchema.safeParse(parsedJson).success) {
    return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  }

  const call = await getConsoleCallById(callId);
  if (!call) return json({ error: 'שיחה לא נמצאה' }, 404);
  if (!LIVE_CUSTOMER_CALL_KINDS.has(call.kind)) {
    return json({ error: 'לא ניתן לבטל התייעצות על שיחה מסוג זה' }, 409);
  }
  if (call.status !== 'connected') {
    return json({ error: 'השיחה אינה מחוברת כעת' }, 409);
  }

  const sessionUrls = await getConsoleCallSessionUrls(callId);
  const sessionUrl = pickSessionUrl(
    sessionUrls?.secureSessionUrl ?? null,
    sessionUrls?.sessionUrl ?? null,
  );
  if (!sessionUrl) return json({ error: 'השיחה אינה זמינה כעת' }, 409);

  const requestId = randomUUID();
  const envelope: SessionCommandEnvelope = {
    command: 'consult_cancel',
    request_id: requestId,
    payload: {},
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return json({ error: 'בקשת הביטול לא נמסרה לשיחה' }, 502);
  }

  await recordConsoleConsultAudit({
    fromAgentId: ctx.userId,
    consoleCallId: callId,
    eventId: call.eventId,
    requestId,
    phase: 'cancel',
  });

  return json({ cancelling: true, request_id: requestId }, 202);
}
