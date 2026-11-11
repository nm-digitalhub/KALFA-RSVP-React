import { deliverParameterlessCallCommand } from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import { recordConsoleConsultAudit } from '@/lib/data/console-calls';

// POST /api/console-calls/{id}/consult/complete   body: {}
//
// The actual warm transfer: completes whichever consult is currently
// privately bridged with the operator (consult_start must have reached
// CallEvents.Connected on the target — the scenario's own consult_complete
// guard no-ops otherwise) by dropping the original operator and bridging the
// customer directly to the target. No target in the body, same reasoning as
// .../consult/cancel — the scenario acts on its own live consult state.
//
// console_calls bookkeeping (consult_agent_id cleared, transferred_to_agent_id
// set) is written from the scenario's own consult_completed report, which
// carries the target vox_username directly (no dependency on consult_started
// having already landed) — see /api/voximplant/console/event.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManageVoiceAgent(request);
  if (!auth.ok) return auth.response;

  // A 202 here is delivered, NOT confirmed. The scenario's own consult_completed report is
  // the truth — never this response (same discipline as blind transfer).
  const { id: callId } = await params;
  return deliverParameterlessCallCommand(request, callId, auth.ctx.userId, {
    command: 'consult_complete',
    wrongKindError: 'לא ניתן להשלים העברה על שיחה מסוג זה',
    undeliveredError: 'בקשת ההשלמה לא נמסרה לשיחה',
    audit: (entry) => recordConsoleConsultAudit({ ...entry, phase: 'complete' }),
    acceptedFlag: 'completing',
  });
}
