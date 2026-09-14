import { NextResponse } from 'next/server';

import {
  recordVoicePurposeConcluded,
  setVoicePurposeElConversationId,
} from '@/lib/data/voice-purpose-attempts';
import { wakeParkedRun } from '@/lib/workflow/wake';
import { guardPurposeToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxPurposeCallbackSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/purpose/{purpose}/cb/{token}
//
// The registry-driven voice surface's terminal report — the twin of
// mtg/cb/[token] and the RSVP surface's cb/[token]. Posted exactly once per
// call by the Voximplant SCENARIO itself (from CallEvents.Disconnected/Failed
// or its global timeout), saying the call session ended and how.
//
// WHY IT DID NOT EXIST. `purpose/<key>/` shipped with `ctx` and no `cb`, so a
// purpose call could FETCH its context but had nowhere to report an outcome.
// `voice_purpose_attempts.finish_reason` was therefore only ever written by the
// dispatcher's own error paths — the column looked wired and was not. A row
// stayed at 'confirmed' forever and no reader could tell a call that was still
// running from one that had ended an hour ago.
//
// It is also where a parked workflow run is WOKEN. `run_id`/`node_id` live on
// the attempt row, so a run that stopped at this call is delivered the moment the
// call ends instead of at a guessed timer — see `wakeParkedRun`.
//
// The `{purpose}` segment is NOT an authorization input. The access token is,
// exactly as on the other surfaces — it resolves to one attempt row and nothing
// else. The segment exists so the URL reads correctly in a scenario and in a
// log, and so that ctx and cb are siblings under one path.
//
// Deliberately SYNCHRONOUS, no webhook_inbox queue: a lost report here delays a
// row reaching 'concluded', it does not lose an RSVP or a billing event. Same
// reasoning as the meeting surface.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ purpose: string; token: string }> },
) {
  const { token } = await params;

  const guard = await guardPurposeToolRequest(req, token, {
    scope: 'vox-purpose-cb',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return bad(guard.status);
  const { attemptId, raw, runId, nodeId } = guard;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad(400);
  }

  const parsed = voxPurposeCallbackSchema.safeParse(json);
  if (!parsed.success) return bad(400);
  const body = parsed.data;

  try {
    // `applied` is intentionally not branched on. False means the row had
    // already left the pre-terminal set — a retried callback, or a dispatch
    // that had already failed — and in both cases the FIRST verdict is the
    // right one and the scenario must still be told 200 so it stops retrying.
    //
    // ⚠️ `call_status` IS PASSED SEPARATELY, NOT COLLAPSED INTO THE REASON.
    //
    // This used to be `body.error_reason ?? body.call_status` — one argument,
    // one column — so whenever the scenario sent both, the normalized verdict
    // was discarded and only the free text survived. The scenarios send both on
    // every failure path they have: `call_status:'failed'` beside
    // `error_reason:'missing_secret' | 'ctx_parse_error' | 'ctx_fetch_error' |
    // 'ctx_fetch_failed_<code>'`.
    //
    // What that cost was a WRONG ANSWER, not a missing field. `toBusinessOutcome`
    // reads the row back, finds `dispatch_status:'concluded'` and a reason it has
    // no mapping for, and falls to its `default: 'completed'` — reasoning that is
    // right for an unmapped success reason and false for an error string. A call
    // that failed before it reached anybody came back to the diagram as a
    // success, and the flow took the success branch.
    await recordVoicePurposeConcluded(
      attemptId,
      body.error_reason ?? body.call_status,
      body.call_duration ?? null,
      body.call_status,
    );
  } catch {
    return bad(500);
  }

  // ⚠️ FIRED EVEN WHEN THE STATUS WRITE DID NOT APPLY, and that is the case it
  // exists for: a retried callback whose first delivery recorded the outcome and
  // then died before waking leaves a run parked on a call that finished. The
  // wake's own gate makes a redundant call a no-op — the RPC matches only a run
  // that is still waiting on THIS attempt — so firing it every time is cheaper
  // than working out whether it is needed.
  //
  // ⚠️ NOT BEST-EFFORT — and it was, which defeated the retry it depends on.
  //
  // Two different things were being conflated. `woke: false` is an ANSWER: the
  // run is not waiting on this event, so there is nothing to wake and 200 is
  // correct. A THROW is a failure of the attempt to find out — a database blip,
  // a pooler timeout — and answering 200 to that tells the scenario its report
  // landed completely when the run is still asleep with no second delivery
  // coming. A 500 is what makes the scenario retry, and the retry is safe:
  // `recordVoicePurposeConcluded` is already idempotent (the second pass reports
  // `applied: false`) and the wake's correlation gate makes a repeat a no-op.
  if (runId && nodeId) {
    try {
      await wakeParkedRun({ runId, nodeId, correlationId: attemptId });
    } catch (e) {
      console.error(
        `[vox-purpose-cb] wake failed for run ${runId}:`,
        e instanceof Error ? e.message : 'unknown',
      );
      return bad(500);
    }
  }

  if (typeof body.el_conversation_id === 'string' && body.el_conversation_id.length > 0) {
    try {
      await setVoicePurposeElConversationId(attemptId, body.el_conversation_id);
    } catch {
      /* best-effort — never leak DB detail; the terminal status is already recorded */
    }
  }

  return new NextResponse('ok', { status: 200, headers: NO_STORE });
}
