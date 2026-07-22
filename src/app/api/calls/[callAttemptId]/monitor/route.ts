import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { getCallAttemptById, TERMINAL_STATUSES } from '@/lib/data/call-attempts';
import {
  attachableVoxUsername,
  createRequestedLeg,
  monitorEnabled,
} from '@/lib/data/console-monitor';
import { attachModeSchema, type CommandEnvelope } from '@/lib/validation/agent-console';
import { pickSessionUrl, postCommandToSession } from '@/lib/voximplant/session-command';

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
// GATED behind app_settings.monitor_enabled, which stays OFF until the RSVPAgent
// scenario carries the conference handler AND that change is verified on a live
// call. Until then this returns 503, NOT a 202 that creates a leg the scenario
// can never answer — the console must never show "listening" while the human is
// silently absent. This is the same honesty the whole console layer is built on.
//
// Auth mirrors the other live-call routes: requireConsoleAgent (Bearer + staff)
// plus manage_voice at the route. The human's identity is read from the SESSION,
// never the body — an agent can only ever attach their OWN leg.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const uuidSchema = z.string().uuid();
const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ callAttemptId: string }> },
) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { ctx } = auth;

  if (!(await callerHasPlatformPermission(ctx.supabase, 'manage_voice'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  // Feature gate FIRST — before touching the call or creating a leg. When off the
  // answer is an honest "not available yet", not a leg that never connects.
  if (!(await monitorEnabled())) {
    return json({ error: 'האזנה לשיחה חיה עדיין אינה פעילה' }, 503);
  }

  const { callAttemptId } = await params;
  if (!uuidSchema.safeParse(callAttemptId).success) {
    return json({ error: 'מזהה שיחה לא תקין' }, 400);
  }

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

  let attempt;
  try {
    attempt = await getCallAttemptById(callAttemptId);
  } catch {
    return json({ error: 'טעינת השיחה נכשלה' }, 500);
  }
  if (!attempt) return json({ error: 'שיחה לא נמצאה' }, 404);

  if (TERMINAL.has(attempt.status)) return json({ error: 'השיחה אינה פעילה' }, 409);
  const sessionUrl = pickSessionUrl(
    attempt.media_session_access_secure_url,
    attempt.media_session_access_url,
  );
  if (!sessionUrl) return json({ error: 'השיחה אינה פעילה' }, 409);

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
