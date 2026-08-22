import { NextResponse } from 'next/server';

import { processMeetingEscalate } from '@/lib/data/callback-voice-processing';
import { guardMeetingToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxMeetingEscalateSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/mtg/tool/escalate/{token}
//
// The meeting-booking agent's `escalate_to_queue` tool (plan §4): a
// wrong-person pickup, a substantive question, an unclear reschedule, a bad
// line, or any other case the deterministic gateway can't resolve. Writes
// into contact_messages/console_queues through createContactMessage — the
// SAME mechanism the public contact/callback forms already use (§4: "לא ערוץ
// חדש", "לא ל-Slack ישירות") — never a bespoke channel. No queue: this is a
// synchronous insert, matching how the public forms themselves write (they
// are not queued either).

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
    scope: 'vox-mtg-escalate',
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

  const parsed = voxMeetingEscalateSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  let ok = false;
  try {
    ({ ok } = await processMeetingEscalate(attemptId, parsed.data));
  } catch {
    ok = false;
  }

  return NextResponse.json({ ok }, { status: 200, headers: NO_STORE });
}
