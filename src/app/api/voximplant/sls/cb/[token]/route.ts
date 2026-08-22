import { NextResponse } from 'next/server';

import {
  recordSalesDispatchConcluded,
  setSalesAttemptElConversationId,
  claimSalesOutcome,
} from '@/lib/data/sales-call-attempts';
import { applyCallOutcome } from '@/lib/data/callback-scheduling';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxSalesCallbackSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/cb/{token}
//
// The sales-closing scenario's OWN terminal-lifecycle report — mirrors
// mtg/cb/[token] for the dispatch_status='concluded' bookkeeping, PLUS one
// thing mtg/cb does not do: this is also the sole legitimate writer of
// call_outcome='no_answer' (sales-call-dispatch.ts's file header, write-path
// 1) — the moment Voximplant reports the call never carried a real
// conversation (no_answer/no_response/failed). A 'completed' call_status
// means telephony connected; that call's OUTCOME is owned entirely by the
// agent's own send_signup_link/log_outcome tool calls, never by this route.
//
// Deliberately SYNCHRONOUS, no webhook_inbox queue — same reasoning as
// mtg/cb: a lost report only delays 'concluded' / a missed no_answer close,
// and voximplant-reconcile.ts already alerts on a pre-terminal row stuck
// past its window.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

const NO_CONVERSATION_STATUSES = new Set(['no_answer', 'no_response', 'failed']);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardSalesToolRequest(req, token, {
    scope: 'vox-sls-cb',
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

  const parsed = voxSalesCallbackSchema.safeParse(json);
  if (!parsed.success) return bad(400);
  const body = parsed.data;

  try {
    await recordSalesDispatchConcluded(
      attemptId,
      body.error_reason ?? body.call_status,
      body.call_duration ?? null,
    );
  } catch {
    return bad(500);
  }

  if (typeof body.el_conversation_id === 'string' && body.el_conversation_id.length > 0) {
    try {
      await setSalesAttemptElConversationId(attemptId, body.el_conversation_id);
    } catch {
      /* best-effort */
    }
  }

  if (NO_CONVERSATION_STATUSES.has(body.call_status)) {
    try {
      const claimed = await claimSalesOutcome(attemptId);
      if (claimed) {
        await applyCallOutcome(claimed.callbackRequestId, 'no_answer');
      }
    } catch {
      // Never fail the callback over the outcome write — dispatch_status is
      // already recorded above; a missed no_answer close is caught by the
      // existing 3-attempt cap on the next scheduling pass.
    }
  }

  return new NextResponse('ok', { status: 200, headers: NO_STORE });
}
