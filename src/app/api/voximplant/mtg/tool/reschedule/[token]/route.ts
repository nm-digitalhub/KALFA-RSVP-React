import { processMeetingReschedule } from '@/lib/data/callback-voice-processing';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { jsonNoStore } from '@/lib/voximplant/no-store-response';
import { okOrFalse, readToolRequest } from '@/lib/voximplant/tool-route';
import { voxRequestRescheduleSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/mtg/tool/reschedule/{token}
//
// The meeting-booking agent's `request_reschedule` tool (plan §4 + the
// critical note in §3): wraps the EXISTING rescheduleCallbackRequest, never a
// new function. When callback_iso is missing/invalid/past, this deliberately
// does NOT touch the calendar — the agent never voices a time the system
// hasn't confirmed; its own script is expected to fall through to
// escalate_to_queue on ok:false. No queue here either: a synchronous
// ok/fail is what lets the agent give a truthful answer DURING the call, and
// a silent later retry could land after the caller already got told a
// different outcome (or was separately escalated) — worse than a clean
// synchronous failure.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardMeetingToolRequest,
    scope: 'vox-mtg-reschedule',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxRequestRescheduleSchema,
  });
  if (!input.ok) return input.response;

  const ok = await okOrFalse(() => processMeetingReschedule(input.attemptId, input.data));

  return jsonNoStore({ ok });
}
