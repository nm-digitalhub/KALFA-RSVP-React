import { processMeetingConfirm } from '@/lib/data/callback-voice-processing';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { jsonNoStore } from '@/lib/voximplant/no-store-response';
import { okOrFalse, readToolRequest } from '@/lib/voximplant/tool-route';
import { voxConfirmMeetingSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/mtg/tool/confirm/{token}
//
// The meeting-booking agent's `confirm_meeting` tool (plan §4): the lead
// confirmed the already-scheduled appointment still works for them. Log only
// — "לא נוגע ביומן" — writes confirmation_call_status='confirmed' and nothing
// else. No queue: this is a single idempotent column write with no external
// side effect, so a synchronous call is both simpler and sufficient (see
// callback-voice-processing.ts's module comment for the full reasoning).

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
    scope: 'vox-mtg-confirm',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxConfirmMeetingSchema,
    emptyBodyAsObject: true,
  });
  if (!input.ok) return input.response;

  const ok = await okOrFalse(() => processMeetingConfirm(input.attemptId));

  return jsonNoStore({ ok });
}
