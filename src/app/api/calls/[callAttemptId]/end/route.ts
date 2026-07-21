import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { getCallAttemptById, TERMINAL_STATUSES } from '@/lib/data/call-attempts';
import type { CommandEnvelope } from '@/lib/validation/agent-console';
import { pickSessionUrl, postCommandToSession } from '@/lib/voximplant/session-command';

// POST /api/calls/{callAttemptId}/end
//
// A console agent hangs up a live call. Separate from /agent-command on purpose:
// those four commands act on the AI leg, this one ends the conversation with the
// guest. Sharing an enum between them would put "end the call" one typo away from
// "clear the buffer", so ending has its own route, its own authority check, and is
// the only caller allowed to put 'call_end' on the wire.
//
// Auth mirrors /agent-command: requireConsoleAgent (Bearer + staff-gated
// is_console_agent) for the operational axis, has_platform_permission
// ('manage_voice') at the route for the authority to act on a live call.
//
// The scenario handles this through scheduleHangup, the same path every other
// terminal route takes, so CallEvents.Disconnected fires and the attempt row is
// closed by the terminal callback. Anything that ends the call without that
// leaves the row stuck pre-terminal — the state that had to be cleaned by hand on
// 2026-07-21.
//
// 2xx means the hangup was DELIVERED, not that the call has ended: teardown is
// asynchronous and confirmation arrives as the ordinary terminal callback on the
// attempt row. Callers should watch the row, not this response.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const uuidSchema = z.string().uuid();
const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ callAttemptId: string }> },
) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { ctx } = auth;

  if (!(await callerHasPlatformPermission(ctx.supabase, 'manage_voice'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  const { callAttemptId } = await params;
  if (!uuidSchema.safeParse(callAttemptId).success) {
    return json({ error: 'מזהה שיחה לא תקין' }, 400);
  }

  // No body is read: ending a call takes no parameters, so there is nothing to
  // validate and nothing a caller could smuggle in.
  let attempt;
  try {
    attempt = await getCallAttemptById(callAttemptId);
  } catch {
    return json({ error: 'טעינת השיחה נכשלה' }, 500);
  }
  if (!attempt) return json({ error: 'שיחה לא נמצאה' }, 404);

  // Already over, or no usable handle — 409, matching /agent-command and the
  // branch the app already handles. Ending an ended call is not an error worth
  // alarming anyone about, but it is not a success either.
  if (TERMINAL.has(attempt.status)) return json({ error: 'השיחה אינה פעילה' }, 409);
  const sessionUrl = pickSessionUrl(
    attempt.media_session_access_secure_url,
    attempt.media_session_access_url,
  );
  if (!sessionUrl) return json({ error: 'השיחה אינה פעילה' }, 409);

  const request_id = randomUUID();
  const envelope: CommandEnvelope = {
    command: 'call_end',
    request_id,
    call_attempt_id: attempt.id,
    payload: {},
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) return json({ error: 'הפקודה לא נמסרה לשיחה' }, 502);

  // Delivered. The call ends asynchronously and the attempt row closes via the
  // terminal callback — that row, not this response, is the record of the outcome.
  return json({ delivered: true, request_id }, 202);
}
