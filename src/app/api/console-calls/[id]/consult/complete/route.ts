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

// POST /api/console-calls/{id}/consult/complete   body: {}
//
// The actual warm transfer: completes whichever consult is currently
// privately bridged with the operator (consult_start must have reached
// CallEvents.Connected on the target — the scenario's own consult_complete
// guard no-ops otherwise) by dropping the original operator and bridging the
// customer directly to the target. No target in the body, same reasoning as
// .../consult/cancel — the scenario acts on its own live consult state.
//
// console_calls bookkeeping (consult_agent_id cleared, transferred_to_agent_id
// set) is written from the scenario's own consult_completed report, which
// carries the target vox_username directly (no dependency on consult_started
// having already landed) — see /api/voximplant/console/event.

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
    return json({ error: 'לא ניתן להשלים העברה על שיחה מסוג זה' }, 409);
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
    command: 'consult_complete',
    request_id: requestId,
    payload: {},
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return json({ error: 'בקשת ההשלמה לא נמסרה לשיחה' }, 502);
  }

  await recordConsoleConsultAudit({
    fromAgentId: ctx.userId,
    consoleCallId: callId,
    eventId: call.eventId,
    requestId,
    phase: 'complete',
  });

  // Delivered; NOT confirmed. The scenario's own consult_completed report is
  // the truth — never this 202 (same discipline as blind transfer).
  return json({ completing: true, request_id: requestId }, 202);
}
