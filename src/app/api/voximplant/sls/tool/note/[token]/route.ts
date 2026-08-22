import { NextResponse } from 'next/server';

import { processSalesNotifyOwner } from '@/lib/data/sales-voice-processing';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxNotifyOwnerSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/note/{token}
//
// The sales-closing agent's `notify_owner` tool — reused tool_id, sales-
// scoped route. Synchronous only (unlike the DNC tool, a lost note is a
// missed follow-up, not a spam-law exposure) — same discipline as
// callback-voice-processing.ts's processMeetingEscalate.

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
    scope: 'vox-sls-note',
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

  const parsed = voxNotifyOwnerSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  let ok = false;
  try {
    ({ ok } = await processSalesNotifyOwner(attemptId, parsed.data));
  } catch {
    ok = false;
  }

  return NextResponse.json({ ok }, { status: 200, headers: NO_STORE });
}
