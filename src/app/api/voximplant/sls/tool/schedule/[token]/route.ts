import { NextResponse } from 'next/server';

import { processSalesScheduleCallback } from '@/lib/data/sales-voice-processing';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxRequestRescheduleSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/schedule/{token}
//
// The sales-closing agent's `schedule_callback` tool — reused tool_id,
// sales-scoped route. Same mechanism as mtg/tool/reschedule
// (rescheduleCallbackRequest) — synchronous, the agent's own script already
// falls back to a plain apology if this returns ok:false (§1's error-
// handling section).

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

  const guard = await guardSalesToolRequest(req, token, {
    scope: 'vox-sls-schedule',
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

  const parsed = voxRequestRescheduleSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  let ok = false;
  try {
    ({ ok } = await processSalesScheduleCallback(attemptId, parsed.data));
  } catch {
    ok = false;
  }

  return NextResponse.json({ ok }, { status: 200, headers: NO_STORE });
}
