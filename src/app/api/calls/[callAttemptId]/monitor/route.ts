import { loadLiveCallAttempt } from '@/lib/console-calls/live-call-attempt';
import { invalidCallIdResponse } from '@/lib/console-calls/live-call-command';
import { requireManageVoiceAgent } from '@/lib/console-calls/route-auth';
import {
  attachableVoxUsername,
  createRequestedLeg,
  monitorEnabled,
} from '@/lib/data/console-monitor';
import { noStoreJson as json } from '@/lib/http/no-store-json';
import { attachModeSchema, type CommandEnvelope } from '@/lib/validation/agent-console';
import { postCommandToSession } from '@/lib/voximplant/session-command';

// POST /api/calls/{callAttemptId}/monitor   body: { mode: 'monitor' | 'takeover' }
//
// Attach a human agent's audio leg to a LIVE AI call. `monitor` is listen-only
// (the supervisor hears the guest and the AI, neither hears them); `takeover`
// puts the human into the conversation. The scenario realises this with the
// official Voximplant supervisor topology — VoxEngine.createConference as a
// mixer plus a VoxEngine.callUser leg — because a Call receives only ONE audio
// stream, so a listener who must hear both guest and AI cannot be wired with
// plain media routing.
//
// GATED behind app_settings.monitor_enabled, a kill switch that defaults to OFF.
// While it is off this returns 503, NOT a 202 that creates a leg the scenario
// cannot answer — the console must never show "listening" while the human is
// silently absent. This is the same honesty the whole console layer is built on.
//
// Auth mirrors the other live-call routes: requireConsoleAgent (Bearer + staff)
// plus manage_voice at the route. The human's identity is read from the SESSION,
// never the body — an agent can only ever attach their OWN leg.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ callAttemptId: string }> },
) {
  const auth = await requireManageVoiceAgent(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  // Feature gate FIRST — before touching the call or creating a leg. When off the
  // answer is an honest "not available yet", not a leg that never connects.
  if (!(await monitorEnabled())) {
    return json({ error: 'האזנה לשיחה חיה עדיין אינה פעילה' }, 503);
  }

  const { callAttemptId } = await params;
  const badId = invalidCallIdResponse(callAttemptId);
  if (badId) return badId;

  const parsed = attachModeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  const { mode } = parsed.data;

  // The agent must have a provisioned SDK identity, or the scenario has no user
  // to VoxEngine.callUser — 409, same "authorised but no identity" shape the
  // sign-in route uses, so the app stops rather than retrying as an auth failure.
  const voxUsername = await attachableVoxUsername(ctx.userId);
  if (!voxUsername) {
    return json({ error: 'לא הוקצתה זהות למוקד עבור נציג זה' }, 409);
  }

  const live = await loadLiveCallAttempt(callAttemptId);
  if (!live.ok) return live.response;
  const { attempt, sessionUrl } = live;

  // Record the intent BEFORE dialing the leg: the request_id it returns is what
  // correlates the command with the scenario's later status callbacks, and it
  // refuses a second live leg for the same (agent, call) so a double-tap cannot
  // ring the agent twice.
  const leg = await createRequestedLeg(callAttemptId, ctx.userId, mode);
  if ('error' in leg) {
    return json({ error: 'הנציג כבר מחובר לשיחה זו' }, 409);
  }

  const envelope: CommandEnvelope = {
    command: 'attach',
    request_id: leg.requestId,
    call_attempt_id: attempt.id,
    // The scenario needs WHOM to callUser and in WHICH mode. Nothing here is a
    // secret — the vox_username is a public SDK identity, never the password.
    payload: { vox_username: voxUsername, mode },
  };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return json({ error: 'הבקשה לא נמסרה לשיחה' }, 502);
  }

  // Delivered. The leg dials asynchronously; the scenario advances the
  // human_agent_call_legs row (dialing → ringing → connected → disconnected) and
  // the app watches that row / the realtime feed, NOT this response.
  return json(
    { attached: true, leg_id: leg.legId, request_id: leg.requestId, mode },
    202,
  );
}
