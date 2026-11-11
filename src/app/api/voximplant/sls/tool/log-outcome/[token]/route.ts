import { claimSalesOutcome } from '@/lib/data/sales-call-attempts';
import { applyCallOutcome } from '@/lib/data/callback-scheduling';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { emptyNoStore, jsonNoStore } from '@/lib/voximplant/no-store-response';
import { readToolRequest } from '@/lib/voximplant/tool-route';
import { voxSalesLogOutcomeSchema } from '@/lib/validation/voximplant';
import type { CallOutcome } from '@/lib/validation/admin';

// POST /api/voximplant/sls/tool/log-outcome/{token}
//
// The sales-closing agent's `log_outcome` tool — writes a NON-success
// outcome (script draft §3's architectural-fix note: 'completed' and
// 'no_answer' are server-computed elsewhere, never agent-asserted). Claims
// sales_call_attempts.outcome_recorded_at atomically before writing, same
// one-shot guard (claimSalesOutcome) every sales outcome-write path shares.
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

const MAX_BODY_BYTES = 2 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const input = await readToolRequest(req, token, {
    guard: guardSalesToolRequest,
    scope: 'vox-sls-log-outcome',
    maxBodyBytes: MAX_BODY_BYTES,
    schema: voxSalesLogOutcomeSchema,
  });
  if (!input.ok) return input.response;
  const { attemptId } = input;

  let claimed;
  try {
    claimed = await claimSalesOutcome(attemptId);
  } catch {
    return emptyNoStore(500);
  }
  // Already claimed (send_signup_link already wrote 'completed', or a
  // duplicate log_outcome call in the same conversation) — not an error,
  // just a no-op, matching every other claim-guarded tool in this codebase.
  if (!claimed) {
    return jsonNoStore({ ok: false, already_recorded: true });
  }

  const outcome: CallOutcome =
    input.data.outcome === 'escalated_to_human' ? 'needs_followup' : input.data.outcome;

  try {
    await applyCallOutcome(claimed.callbackRequestId, outcome);
  } catch {
    return emptyNoStore(500);
  }

  return jsonNoStore({ ok: true });
}
