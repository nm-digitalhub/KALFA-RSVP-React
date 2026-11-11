import { processMeetingEscalate } from '@/lib/data/callback-voice-processing';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { jsonNoStore } from '@/lib/voximplant/no-store-response';
import { okOrFalse, readToolRequest } from '@/lib/voximplant/tool-route';
import { voxMeetingEscalateSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/mtg/tool/escalate/{token}
//
// The meeting-booking agent's `escalate_to_queue` tool (plan §4): a
// wrong-person pickup, a substantive question, an unclear reschedule, a bad
// line, or any other case the deterministic gateway can't resolve. Writes
// into contact_messages/console_queues through insertContactMessage (the
// request-free core createContactMessage wraps) — the SAME mechanism the
// public contact/callback forms already use (§4: "לא ערוץ חדש", "לא ל-Slack
// ישירות") — never a bespoke channel. No queue: this is a synchronous insert,
// matching how the public forms themselves write (they are not queued either).

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardMeetingToolRequest,
    scope: 'vox-mtg-escalate',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxMeetingEscalateSchema,
  });
  if (!input.ok) return input.response;

  const ok = await okOrFalse(() => processMeetingEscalate(input.attemptId, input.data));

  return jsonNoStore({ ok });
}
