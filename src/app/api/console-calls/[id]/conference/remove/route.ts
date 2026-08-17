import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  LIVE_CUSTOMER_CALL_KINDS,
  recordConsoleConferenceAudit,
} from '@/lib/data/console-calls';
import { consoleEmptyActionBodySchema } from '@/lib/validation/console-calls';
import {
  pickSessionUrl,
  postCommandToSession,
  type SessionCommandEnvelope,
} from '@/lib/voximplant/session-command';

// POST /api/console-calls/{id}/conference/remove   body: {}
//
// Drops the third participant from a live conference and collapses the call back
// to operator<->customer.
//
// Closes a gap that shipped with conference_add: a participant could be joined and
// never removed, so an agent who conferenced the wrong number was stuck with them
// on the line until the entire call ended. Found while investigating an unrelated
// report on 17.8 and fixed on the owner's instruction.
//
// No target in the body, exactly like consult/cancel: a conference here has at most
// ONE additional participant (the scenario's own single conferenceTarget), so there
// is nothing to name. The scenario acts on whatever it currently has — still
// dialing, or already mixed — and picks the right teardown for each; the route's
// job is only to deliver the command to the right live session, never to decide
// business state it cannot see.
//
// A remove posted when no conference is in flight is a safe, honestly logged no-op
// on the scenario side (its own guard). This route deliberately does NOT pre-check
// console_calls for a conference row for the same reason consult/cancel does not:
// the best-known state here can already be stale by the time the command lands, and
// the scenario is authoritative.
//
// Auth mirrors every other live-call console route: requireConsoleAgent (Bearer +
// staff) + manage_voice.

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
    return json({ error: 'לא ניתן להסיר משתתף בשיחה מסוג זה' }, 409);
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
    command: 'conference_remove',
    request_id: requestId,
    payload: {},
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return json({ error: 'בקשת ההסרה לא נמסרה לשיחה' }, 502);
  }

  // No toAgentId and no externalTarget: this removes whoever is currently in the
  // conference, which this route never resolved and therefore cannot name. The
  // auditable fact is that THIS agent removed the participant from THIS call.
  await recordConsoleConferenceAudit({
    fromAgentId: ctx.userId,
    consoleCallId: callId,
    eventId: call.eventId,
    requestId,
  });

  // Delivered; NOT confirmed. The scenario's own conference_ended report is the
  // truth the panel watches.
  return json({ removing: true, request_id: requestId }, 202);
}
