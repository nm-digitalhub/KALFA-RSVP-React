import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { getCallAttemptById, TERMINAL_STATUSES } from '@/lib/data/call-attempts';
import {
  agentCommandBodySchema,
  type AgentCommandResult,
  type CommandEnvelope,
} from '@/lib/validation/agent-console';
import { pickSessionUrl, postCommandToSession } from '@/lib/voximplant/session-command';

// POST /api/calls/{callAttemptId}/agent-command
//
// A console agent issues a live-call AI-management command on an ACTIVE call:
// contextual_update (non-interrupting whisper), user_message (injects a user turn),
// clear_buffer (one-shot barge-in), close_agent (close the AI leg). The body is the
// FLAT shape the deployed app already sends ({command, text?}); call_attempt_id
// comes from the PATH and is resolved + authorized server-side, never trusted from
// the body.
//
// Auth: requireConsoleAgent (Bearer + staff-gated is_console_agent) establishes the
// operational axis; AUTHORITY to command the AI is a separate route-level check —
// has_platform_permission('manage_voice'), deliberately NOT folded into
// is_console_agent().
//
// The command is delivered by resolving the call's server-only media-session handle
// (preferring the HTTPS one) and POSTing a signed envelope to the live VoxEngine
// session. HTTP 2xx here means DELIVERED to the session, never "the AI acted": the
// applied acknowledgement is out-of-band (a later phase), so this route reports
// delivered:true / applied:'pending' and returns 202. The handle is a capability that
// lives only for the call's duration — a terminal attempt (or one with no handle)
// is rejected with 409, which is exactly the state the app's 409 branch expects.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;
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

  // Authority to issue AI commands. Route-level only (never in is_console_agent()).
  if (!(await callerHasPlatformPermission(ctx.supabase, 'manage_voice'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  const { callAttemptId } = await params;
  if (!uuidSchema.safeParse(callAttemptId).success) {
    return json({ error: 'מזהה שיחה לא תקין' }, 400);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'בקשה גדולה מדי' }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  }

  const result = agentCommandBodySchema.safeParse(parsed);
  if (!result.success) return json({ error: 'פקודה לא תקינה' }, 400);
  const body = result.data;

  // media_session_access_(secure_)url is server-only (never RLS-exposed). Read it
  // via the service-role DAL; authorization was already established above.
  let attempt;
  try {
    attempt = await getCallAttemptById(callAttemptId);
  } catch {
    return json({ error: 'טעינת השיחה נכשלה' }, 500);
  }
  if (!attempt) return json({ error: 'שיחה לא נמצאה' }, 404);

  // A managing handle is live only for the call's duration. Reject terminal
  // attempts and rows with no usable handle (mirrors the app's 409 branch).
  if (TERMINAL.has(attempt.status)) return json({ error: 'השיחה אינה פעילה' }, 409);
  const sessionUrl = pickSessionUrl(
    attempt.media_session_access_secure_url,
    attempt.media_session_access_url,
  );
  if (!sessionUrl) return json({ error: 'השיחה אינה פעילה' }, 409);

  const request_id = randomUUID();
  const payload: Record<string, unknown> =
    body.command === 'contextual_update' || body.command === 'user_message'
      ? { text: body.text }
      : {};
  const envelope: CommandEnvelope = {
    command: body.command,
    request_id,
    call_attempt_id: attempt.id,
    payload,
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) return json({ error: 'הפקודה לא נמסרה לשיחה' }, 502);

  // Delivered to the live session; effect NOT confirmed. `pending` is the truthful
  // answer, not a placeholder: the ack is out-of-band and has not arrived, and for
  // contextual_update / user_message it never will — ElevenLabs returns nothing, so
  // "handed to the session" is the ceiling. Reporting applied:false here would tell
  // the console the command failed when it did not.
  const out: AgentCommandResult = {
    delivered: true,
    applied: 'pending',
    command: body.command,
    request_id,
  };
  return json(out, 202);
}
