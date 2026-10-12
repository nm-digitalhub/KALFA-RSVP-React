import { NextResponse } from 'next/server';

import { applyAgentDiscount } from '@/lib/data/agent-benefits';
import { getSalesRequestForAttempt } from '@/lib/data/sales-call-attempts';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { normalizePhone } from '@/lib/phone';
import { voxSalesDiscountSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/discount/{token}
//
// The sales agent's `apply_discount_tier` tool (personal-coupons task 6.2, D9/D14/D16/D23). The
// agent reports the customer's objection — NOTHING else is read from the caller — and the server
// decides everything from the staff-managed offers table: which offer the objection is allowed to
// answer, the frozen per-package prices, and whether the phone's existing benefit is returned
// as-is (D16) or replaced under the escalation rules (D23). The assignment is durably recorded
// BEFORE the answer promises it; when nothing can be assigned or written, the answer is the
// defined no-offer shape and the agent promises nothing.
//
// The VoxEngine bridge's result mapper (scenario 920396) understands exactly:
//   { offer: {...}, options: [>=1] }  → the benefit, quoted to the caller
//   { offer: null, options: [] }      → no offer
// and keeps accepting the legacy { tier, amount_or_pct } during the deploy window; an HTTP
// failure maps to its "not configured" result, so a broken server never invents a discount.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

const NO_OFFER = { offer: null, options: [] as never[] };

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
  const { attemptId, raw } = guard;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad(400);
  }

  const parsed = voxSalesDiscountSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  // The benefit targets the CALLBACK REQUEST'S phone (the number the call was made to) — resolved
  // from the attempt row, never from the body. An unnormalizable phone cannot hold an assignment
  // (coupon_assignments.phone_e164 is E.164-checked), so the answer is no offer, not an error the
  // agent would read as a tool failure.
  const request = await getSalesRequestForAttempt(attemptId);
  const phoneE164 = request ? normalizePhone(request.phone) : null;
  if (!phoneE164) {
    return NextResponse.json(NO_OFFER, { status: 200, headers: NO_STORE });
  }

  let answer;
  try {
    answer = await applyAgentDiscount({
      callAttemptId: attemptId,
      phoneE164,
      objectionReason: parsed.data.objection_reason,
    });
  } catch (err) {
    // Nothing was promised: the module answers no_offer for every expected failure, so a throw is
    // a bug — logged without the body (it carries conversation content).
    console.error('[sls-discount] unexpected failure', {
      attemptId,
      kind: err instanceof Error ? err.name : typeof err,
    });
    return NextResponse.json(NO_OFFER, { status: 200, headers: NO_STORE });
  }

  if (answer.status === 'no_offer') {
    return NextResponse.json(NO_OFFER, { status: 200, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      offer: answer.offer,
      options: answer.options,
      expires_at: answer.expiresAt,
    },
    { status: 200, headers: NO_STORE },
  );
}
