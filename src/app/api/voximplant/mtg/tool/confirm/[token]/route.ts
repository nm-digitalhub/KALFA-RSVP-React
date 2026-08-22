import { NextResponse } from 'next/server';

import { processMeetingConfirm } from '@/lib/data/callback-voice-processing';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
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

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardMeetingToolRequest(req, token, {
    scope: 'vox-mtg-confirm',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return bad(guard.status);
  const { attemptId, raw } = guard;

  let json: unknown;
  try {
    json = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    return bad(400);
  }

  const parsed = voxConfirmMeetingSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  let ok = false;
  try {
    ({ ok } = await processMeetingConfirm(attemptId));
  } catch {
    ok = false;
  }

  return NextResponse.json({ ok }, { status: 200, headers: NO_STORE });
}
