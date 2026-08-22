import { NextResponse } from 'next/server';

import { processSalesEscalate } from '@/lib/data/sales-voice-processing';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxSalesEscalateSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/escalate/{token}
//
// The sales-closing agent's `escalate_to_human` tool (script draft §3):
// checks/transfers to a live rep if one is reachable, and is HONEST when
// none is — `transferred` is only ever true for a REAL bridged leg (same
// discipline as save_rsvp's "queued" false-promise fix; see the memory
// note). v1 has no live-transfer mechanism wired for this token surface
// (same non-goal as the meeting-booking plan's escalate_to_queue), so this
// always returns `transferred: false` and instead raises the SAME
// contact_messages/Slack queue notify_owner uses — never silently
// pretending a handoff happened.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardSalesToolRequest(req, token, {
    scope: 'vox-sls-escalate',
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

  const parsed = voxSalesEscalateSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  let ok = false;
  try {
    ({ ok } = await processSalesEscalate(attemptId, parsed.data));
  } catch {
    ok = false;
  }

  // No live-transfer path in v1 — see file header. `ok` reflects whether the
  // queue notification itself succeeded; `transferred` is always false.
  return NextResponse.json({ transferred: false, notified: ok }, { status: 200, headers: NO_STORE });
}
