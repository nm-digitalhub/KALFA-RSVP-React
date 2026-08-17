import { NextResponse } from 'next/server';

import { requireConsoleAgent } from '@/lib/auth/console-agent';
import { fetchVoxCallHistory } from '@/lib/data/vox-call-history';
import { rateLimit } from '@/lib/security/rate-limit';

// GET /api/agents/call-history?days=7&outcome=missed&direction=inbound
//
// The call log for the native app, READ FROM VOXIMPLANT rather than from our own
// tables.
//
// It used to read `console_calls`, and that was the defect: `answered_at` on that
// table is set when the SCENARIO answers — the disclosure line and the hold music —
// not when a human picks up. Every call the system answered and no agent ever did
// was filed as answered. Over one measured week that turned 157 genuinely missed
// calls into 12. Voximplant reports each leg of a session separately, including
// every agent we rang and whether they connected, so the outcome is looked up
// instead of inferred.
//
// Queried live, not synced. A filtered pull is fast enough for a screen — measured
// through this module on 2026-08-17: today 0.98s, today+missed 1.3s, a week of
// missed calls 3.2s. A mirror table would buy latency at the price of a sync lag,
// which is the wrong trade while the volume is this size. See
// plans/voximplant-authoritative-call-history-plan.md for when that flips.
//
// PII: `phone` is the caller's number and it is deliberately present. On a business
// line most callers have no name on file, and the number is the only identity they
// have — the owner asked for exactly that. `name` comes from `profiles` ONLY, the
// CUSTOMER axis, and never from `guests`: a guest belongs to a customer's event,
// and reading a name off an unrelated invite list is what once labelled the owner's
// own phone with a stranger's name from a brit. Staff-gated by requireConsoleAgent,
// the same gate every other agent route uses. Numbers are never logged.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const RATE = { limit: 60, windowMs: 60_000 } as const;

/** Matches the app's HistoryRange values; 90 is the outer bound we will serve. */
const MAX_DAYS = 90;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { ctx } = auth;

  if (!rateLimit(`agent-call-history:${ctx.userId}`, RATE).allowed) {
    return json({ error: 'rate_limited' }, 429);
  }

  // Validated here rather than trusted. An unrecognised value becomes "unfiltered"
  // instead of reaching the query, so a malformed request can neither widen what is
  // returned nor shape an upstream error.
  const url = new URL(request.url);
  const rawDays = Number(url.searchParams.get('days'));
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, MAX_DAYS) : 7;
  const dir = url.searchParams.get('direction');
  const out = url.searchParams.get('outcome');

  try {
    const result = await fetchVoxCallHistory({
      days,
      direction: dir === 'inbound' || dir === 'outbound' ? dir : undefined,
      outcome: out === 'answered' || out === 'missed' ? out : undefined,
    });

    return json(
      {
        calls: result.rows.map((r) => ({
          id: r.id,
          direction: r.inbound ? 'inbound' : 'outbound',
          // The four outcomes Voximplant supports, not the two our table could
          // express. `answered` stays alongside them so an older build keeps
          // rendering rather than showing every row as missed.
          outcome: r.outcome,
          answered: r.answered,
          name: r.name,
          phone: r.phone,
          started_at: r.startedAt,
          duration_sec: r.durationSec,
          talk_sec: r.talkSec,
          agent_legs_tried: r.agentLegsTried,
          end_code: r.endCode,
          end_details: r.endDetails,
          has_recording: r.hasRecording,
        })),
        // Reported, never hidden. The page cap can stop a deep scan before the
        // window ends, and a short list that does not say so is how a call log
        // stops being believed.
        truncated: result.truncated,
      },
      200,
    );
  } catch {
    // An empty history and a failed read are different facts; the app renders them
    // differently, and a failure that impersonates "no calls yet" would quietly tell
    // an agent their floor was idle.
    return json({ error: 'unavailable' }, 503);
  }
}
