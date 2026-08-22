import { NextResponse } from 'next/server';

import {
  recordCallbackDispatchConcluded,
  setCallbackAttemptElConversationId,
} from '@/lib/data/callback-request-attempts';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardMeetingToolRequest(req, token, {
    scope: 'vox-mtg-cb',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return bad(guard.status);
  const { attemptId, raw } = guard;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad(400);
  }

  const parsed = voxMeetingCallbackSchema.safeParse(json);
  if (!parsed.success) return bad(400);
  const body = parsed.data;

  try {
    await recordCallbackDispatchConcluded(
      attemptId,
      body.error_reason ?? body.call_status,
      body.call_duration ?? null,
    );
  } catch {
    return bad(500);
  }

  if (typeof body.el_conversation_id === 'string' && body.el_conversation_id.length > 0) {
    try {
      await setCallbackAttemptElConversationId(attemptId, body.el_conversation_id);
    } catch {
      /* best-effort — never leak DB detail; dispatch_status is already recorded */
    }
  }

  return new NextResponse('ok', { status: 200, headers: NO_STORE });
}
