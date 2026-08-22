import { NextResponse } from 'next/server';

import { claimSalesOutcome } from '@/lib/data/sales-call-attempts';
import { applyCallOutcome } from '@/lib/data/callback-scheduling';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxSalesLogOutcomeSchema } from '@/lib/validation/voximplant';
import type { CallOutcome } from '@/lib/validation/admin';

// POST /api/voximplant/sls/tool/log-outcome/{token}
//
// The sales-closing agent's `log_outcome` tool — writes a NON-success
// outcome (script draft §3's architectural-fix note: 'completed' and
// 'no_answer' are server-computed elsewhere, never agent-asserted). Claims
// sales_call_attempts.outcome_recorded_at atomically before writing, same
// one-shot guard every one of the 4 legitimate write paths shares (file
// header of sales-call-attempts.ts).
//
// 'escalated_to_human' is a real, distinct value the AGENT can pass (the
// tool schema accepts it), but it is NOT one of callback_requests'
// call_outcome CHECK-constraint values (verified live against
// pg_constraint, 2026-08-22) — mapping it to 'closed' would wrongly stop
// the request from ever being followed up again, so it is translated to
// 'needs_followup' here, the value it actually behaves like (re-enters
// scheduling, does not auto-close). The distinction between "generic
// follow-up" and "specifically asked for a human" lives in the agent's own
// transcript and this route's discount_tier_applied-shaped extensibility,
// not as a second call_outcome enum value.

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
    scope: 'vox-sls-log-outcome',
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

  const parsed = voxSalesLogOutcomeSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  let claimed;
  try {
    claimed = await claimSalesOutcome(attemptId);
  } catch {
    return bad(500);
  }
  // Already claimed (send_signup_link already wrote 'completed', or a
  // duplicate log_outcome call in the same conversation) — not an error,
  // just a no-op, matching every other claim-guarded tool in this codebase.
  if (!claimed) {
    return NextResponse.json({ ok: false, already_recorded: true }, { status: 200, headers: NO_STORE });
  }

  const outcome: CallOutcome =
    parsed.data.outcome === 'escalated_to_human' ? 'needs_followup' : parsed.data.outcome;

  try {
    await applyCallOutcome(claimed.callbackRequestId, outcome);
  } catch {
    return bad(500);
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
