import { deliverParameterlessCallCommand } from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import { recordConsoleConferenceAudit } from '@/lib/data/console-calls';

// POST /api/console-calls/{id}/conference/remove   body: {}
//
// Drops the third participant from a live conference and collapses the call back
// to operator<->customer.
//
// No target in the body, exactly like consult/cancel: a conference here has at most
// ONE additional participant (the scenario's own single conferenceTarget), so there
// is nothing to name. The scenario acts on whatever it currently has — still
// dialing, or already mixed — and picks the right teardown for each; the route's
// job is only to deliver the command to the right live session, never to decide
// business state it cannot see.
//
// A remove posted when no conference is in flight is a safe, honestly logged no-op
// on the scenario side (its own guard). This route deliberately does NOT pre-check
// console_calls for a conference row for the same reason consult/cancel does not:
// the best-known state here can already be stale by the time the command lands, and
// the scenario is authoritative.
//
// Auth mirrors every other live-call console route: requireConsoleAgent (Bearer +
// staff) + manage_voice.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManageVoiceAgent(request);
  if (!auth.ok) return auth.response;

  // A 202 here is delivered, NOT confirmed. The scenario's own conference_ended report (or
  // conference_failed, when the participant was still dialing) is the truth the
  // panel watches.
  const { id: callId } = await params;
  return deliverParameterlessCallCommand(request, callId, auth.ctx.userId, {
    command: 'conference_remove',
    wrongKindError: 'לא ניתן להסיר משתתף בשיחה מסוג זה',
    undeliveredError: 'בקשת ההסרה לא נמסרה לשיחה',
    // No toAgentId and no externalTarget: this removes whoever is currently in the
    // conference, which this route never resolved and therefore cannot name. The
    // auditable fact is that THIS agent removed the participant from THIS call.
    audit: recordConsoleConferenceAudit,
    acceptedFlag: 'removing',
  });
}
