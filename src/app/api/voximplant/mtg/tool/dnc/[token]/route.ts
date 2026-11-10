import { processMeetingOptOut } from '@/lib/data/callback-voice-processing';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { emptyNoStore, jsonNoStore } from '@/lib/voximplant/no-store-response';
import { persistVoxInboxEvent } from '@/lib/voximplant/tool-inbox';
import { okOrFalse, readToolRequest } from '@/lib/voximplant/tool-route';
import { voxMeetingOptOutSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/mtg/tool/dnc/{token}
//
// The meeting-booking agent's `mark_opt_out` tool (plan §4, legally
// critical): the lead asked not to be called again. Upserts into
// call_dnc_list (§4's correction: not a new column). PERSIST-THEN-PROCESS,
// unlike this table's other 3 tools: a lost opt-out is a real spam-law
// exposure, not merely a lost log entry, so it gets a durable-retry backstop —
// via event_kind='mtg_dnc', its OWN drain case, so this can never touch
// call_attempts/RSVP/billing processing code (plan §7's isolation requirement).

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
    scope: 'vox-mtg-dnc',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxMeetingOptOutSchema,
    emptyBodyAsObject: true,
  });
  if (!input.ok) return input.response;
  const { attemptId } = input;

  // One opt-out per attempt is enough — a repeat in the same call is a no-op
  // (same reasoning as the RSVP surface's agent-tool/dnc route).
  try {
    await persistVoxInboxEvent({
      eventKind: 'mtg_dnc',
      dedupeKey: `vox-mtg-dnc:${attemptId}`,
      attemptId,
      payload: input.data,
    });
  } catch {
    return emptyNoStore(500);
  }

  const ok = await okOrFalse(() => processMeetingOptOut(attemptId));

  return jsonNoStore({ ok });
}
