import { NextResponse } from 'next/server';

import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxSalesDiscountSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/discount/{token}
//
// The sales-closing agent's `apply_discount_tier` tool (script draft §3) —
// returns the owner-approved tier-1 discount (5%, decided 2026-08-22), only
// after an explicit price objection. A server-side constant, not an
// agent_configs value (script draft §3's own note) and not yet an
// admin-editable app_settings column — no admin UI exists to change it
// today, so a DB migration for a single fixed number the owner has already
// approved would be schema churn with no real configurability behind it.
// Bump this constant (or promote it to app_settings, with an admin UI) when
// tier-2 or admin-editability is actually needed.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIER_1_DISCOUNT_PCT = 5;

const MAX_BODY_BYTES = 2 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardSalesToolRequest(req, token, {
    scope: 'vox-sls-discount',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return bad(guard.status);
  const { raw } = guard;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad(400);
  }

  const parsed = voxSalesDiscountSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  // objection_reason is accepted for documentation purposes (the tool
  // schema requires it, and the caller's own log_outcome may reference it
  // via discount_tier_applied) — this route itself has nowhere durable to
  // persist it yet (no per-call notes table for sales_call_attempts), so it
  // is intentionally not written anywhere; the agent's own transcript is
  // the audit trail for what objection triggered the discount.
  void parsed.data.objection_reason;

  return NextResponse.json(
    { tier: 'tier_1', amount_or_pct: TIER_1_DISCOUNT_PCT },
    { status: 200, headers: NO_STORE },
  );
}
