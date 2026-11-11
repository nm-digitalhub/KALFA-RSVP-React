import { randomUUID } from 'node:crypto';

import { loadLiveCallAttempt } from '@/lib/console-calls/live-call-attempt';
import { invalidCallIdResponse } from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import { noStoreJson } from '@/lib/http/no-store-json';
import type { CommandEnvelope } from '@/lib/validation/agent-console';
import { postCommandToSession } from '@/lib/voximplant/session-command';

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ callAttemptId: string }> },
) {
  const auth = await requireManageVoiceAgent(request);
  if (!auth.ok) return auth.response;

  const { callAttemptId } = await params;
  const badId = invalidCallIdResponse(callAttemptId);
  if (badId) return badId;

  // No body is read: ending a call takes no parameters, so there is nothing to
  // validate and nothing a caller could smuggle in.
  //
  // Already over, or no usable handle — 409, matching /agent-command and the
  // branch the app already handles. Ending an ended call is not an error worth
  // alarming anyone about, but it is not a success either.
  const live = await loadLiveCallAttempt(callAttemptId);
  if (!live.ok) return live.response;
  const { attempt, sessionUrl } = live;

  const request_id = randomUUID();
  const envelope: CommandEnvelope = {
    command: 'call_end',
    request_id,
    call_attempt_id: attempt.id,
    payload: {},
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) return noStoreJson({ error: 'הפקודה לא נמסרה לשיחה' }, 502);

  // Delivered. The call ends asynchronously and the attempt row closes via the
  // terminal callback — that row, not this response, is the record of the outcome.
  return noStoreJson({ delivered: true, request_id }, 202);
}
