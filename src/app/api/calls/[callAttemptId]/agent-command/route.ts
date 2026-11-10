import { randomUUID } from 'node:crypto';

import { loadLiveCallAttempt } from '@/lib/console-calls/live-call-attempt';
import { invalidCallIdResponse } from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import { recordConsoleAgentCommand } from '@/lib/data/console-agent-commands';
import { noStoreJson as json } from '@/lib/http/no-store-json';
import { readJsonBody } from '@/lib/http/read-json-body';
import {
  agentCommandBodySchema,
  type AgentCommandResult,
  type CommandEnvelope,
} from '@/lib/validation/agent-console';
import { postCommandToSession } from '@/lib/voximplant/session-command';

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

const MAX_BODY_CHARS = 8 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ callAttemptId: string }> },
) {
  // Console-agent membership, then the authority to issue AI commands (manage_voice) —
  // route-level only, never folded into is_console_agent().
  const auth = await requireManageVoiceAgent(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { callAttemptId } = await params;
  const badId = invalidCallIdResponse(callAttemptId);
  if (badId) return badId;

  const read = await readJsonBody(request, { maxSize: MAX_BODY_CHARS, measure: 'string-length' });
  if (!read.ok) return read.response;

  const result = agentCommandBodySchema.safeParse(read.value);
  if (!result.success) return json({ error: 'פקודה לא תקינה' }, 400);
  const body = result.data;

  // media_session_access_(secure_)url is server-only (never RLS-exposed). Read it
  // via the service-role DAL; authorization was already established above.
  // A managing handle is live only for the call's duration. Terminal attempts and
  // rows with no usable handle are rejected (mirrors the app's 409 branch).
  const live = await loadLiveCallAttempt(callAttemptId);
  if (!live.ok) return live.response;
  const { attempt, sessionUrl } = live;

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

  // Audit BOTH outcomes. A command that failed to reach the session still tells
  // us a staff member tried to change a live call and what they tried to say —
  // which is exactly what an intervention trail is for. `delivered` carries the
  // difference; it is not a success-only log.
  try {
    await recordConsoleAgentCommand({
      agentId: ctx.userId,
      callAttemptId: attempt.id,
      eventId: attempt.event_id ?? null,
      command: body.command,
      text: 'text' in body ? body.text : null,
      requestId: request_id,
      delivered: delivery.delivered,
      applied: 'pending',
    });
  } catch (err) {
    // Never blocks the call path: by now the command has already reached the
    // live session (or definitively not). Losing the row is bad and must be
    // visible; failing the request for it would be worse and would misreport.
    console.error(
      `[agent-command] AUDIT WRITE FAILED (attempt=${attempt.id} command=${body.command}): ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }

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
