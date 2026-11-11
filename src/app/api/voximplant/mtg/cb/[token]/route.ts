import {
  recordCallbackDispatchConcluded,
  setCallbackAttemptElConversationId,
} from '@/lib/data/callback-request-attempts';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { emptyNoStore, okNoStore } from '@/lib/voximplant/no-store-response';
import { readToolRequest, recordTerminalReport } from '@/lib/voximplant/tool-route';
import { voxMeetingCallbackSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/mtg/cb/{token}
//
// The meeting-booking scenario's OWN terminal-lifecycle report — mirrors the
// RSVP surface's cb/[token], NOT the 4 mtg/tool/* agent-tool routes (those
// are ElevenLabs ClientToolCall relays; this is the Voximplant SCENARIO
// itself reporting "the call session ended", posted exactly once per call
// from CallEvents.Disconnected/Failed or the global timeout path). Moves
// dispatch_status to 'concluded' so the row stops consuming a
// concurrency-cap slot and the stuck-row reconciler never alert-floods it.
//
// Deliberately SYNCHRONOUS, no webhook_inbox queue: unlike RSVP's cb (where
// a lost callback silently loses an RSVP or a billing event), a lost report
// here only delays the row reaching 'concluded' — the existing reconciler
// (voximplant-reconcile.ts) already alerts on a pre-terminal row stuck past
// 15m, which is the correct backstop for exactly this failure mode.

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardMeetingToolRequest,
    scope: 'vox-mtg-cb',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxMeetingCallbackSchema,
  });
  if (!input.ok) return input.response;
  const { attemptId, data: body } = input;

  const recorded = await recordTerminalReport(attemptId, body, {
    recordConcluded: recordCallbackDispatchConcluded,
    setElConversationId: setCallbackAttemptElConversationId,
  });
  if (!recorded) return emptyNoStore(500);

  return okNoStore();
}
