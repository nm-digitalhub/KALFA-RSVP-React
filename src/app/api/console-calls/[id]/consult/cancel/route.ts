import { deliverParameterlessCallCommand } from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import { recordConsoleConsultAudit } from '@/lib/data/console-calls';

// POST /api/console-calls/{id}/consult/cancel   body: {}
//
// Abandons whichever consult attempt (dialing or already privately bridged
// with the operator) is currently live for this call and re-bridges
// operator<->customer. No target in the body — the scenario's own
// consult_cancel branch acts on whatever consult it already has in flight
// for THIS session; the route's job is only to deliver the command to the
// right live session (same "deliver, never resolve business state" split as
// transfer/route.ts).
//
// A cancel posted when there is no consult in flight is a safe, honestly
// logged no-op on the scenario side (its own guard) — this route does not
// pre-check console_calls.consult_agent_id for that reason (best-known state
// there can already be stale by the time this arrives; the scenario is
// authoritative).

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManageVoiceAgent(request);
  if (!auth.ok) return auth.response;

  const { id: callId } = await params;
  return deliverParameterlessCallCommand(request, callId, auth.ctx.userId, {
    command: 'consult_cancel',
    wrongKindError: 'לא ניתן לבטל התייעצות על שיחה מסוג זה',
    undeliveredError: 'בקשת הביטול לא נמסרה לשיחה',
    audit: (entry) => recordConsoleConsultAudit({ ...entry, phase: 'cancel' }),
    acceptedFlag: 'cancelling',
  });
}
