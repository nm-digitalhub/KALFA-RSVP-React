import { NextResponse } from 'next/server';

import { requireConsoleAgent } from '@/lib/auth/console-agent';
import { fetchVoxCallHistory } from '@/lib/data/vox-call-history';
import { rateLimit } from '@/lib/security/rate-limit';

// GET /api/agents/callbacks  ->  { callbacks: [{ id, full_name, phone, attempts, created_at }] }
//
// The missed-call queue, FROM VOXIMPLANT.
//
// Three versions of this list have now existed and the reasons matter:
//
//   1. `callback_requests` — mixed "call me now" requests with follow-ups, kept
//      rows open indefinitely, and on 17.8 was serving fourteen four-day-old rows
//      as though they were today's missed calls.
//   2. `console_calls` — our own table, where `answered_at` is set when the
//      SCENARIO answers (disclosure line, hold music), so every call the system
//      took and no agent ever did counted as answered. It found 12 missed calls in
//      a week where 157 existed.
//   3. Voximplant — which reports each LEG with `successful` and a SIP code, so
//      "agents were rung and nobody picked up" is read rather than inferred.
//
// `id` IS A VOXIMPLANT SESSION ID, and that is what makes the "חזור" button work.
// Version 2 returned a console_calls id into a dial path that resolved against
// `callback_requests` — 200 of 200 sampled ids were absent from that table, so
// every return refused, and the app reported it as a permissions problem. The
// dial side now reads the number back from Voximplant's record of the same
// session, so the list and the dial finally name the same thing.
//
// 'missed' here means AGENTS WERE RUNG AND NOBODY ANSWERED — deliberately not the
// whole not-answered set. Over the measured week that set also held 1,073 calls
// where we answered and the caller hung up before anyone was rung, and 671 the
// platform refused outright. Those are real events but they are not a queue of
// people waiting for a call back, and burying 157 under 1,744 is how a task list
// stops being read.
//
// CARRIES THE PHONE NUMBER, deliberately. An agent about to return a call has to
// see who they are ringing, including someone who has never been a customer and
// has no name attached — which is precisely the case a masked number makes
// useless. The owner asked for exactly that. Staff-gated by requireConsoleAgent;
// numbers are never logged.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const RATE = { limit: 60, windowMs: 60_000 } as const;

/** How far back the queue looks. */
const WINDOW_DAYS = 7;
/** Rows returned after de-duplication by number. */
const MAX_ROWS = 25;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { ctx } = auth;

  if (!rateLimit(`agent-callbacks:${ctx.userId}`, RATE).allowed) {
    return json({ error: 'rate_limited' }, 429);
  }

  try {
    const result = await fetchVoxCallHistory({
      days: WINDOW_DAYS,
      direction: 'inbound',
      outcome: 'missed',
      // Deliberately over-fetched relative to MAX_ROWS: the list is de-duplicated
      // by number below, and four attempts from one person must collapse to one
      // row without pushing three other people off the queue.
      limit: 200,
    });

    // Newest-first from the fetch, so the FIRST row per number is the one kept and
    // every later one only increments the count. Four tries is one person to ring
    // back, and the fact they tried four times still shows.
    const byPhone = new Map<
      string,
      { id: string; full_name: string | null; phone: string; attempts: number; created_at: string | null }
    >();
    for (const row of result.rows) {
      if (!row.phone) continue; // withheld CLI — nothing to ring back
      const seen = byPhone.get(row.phone);
      if (seen) {
        seen.attempts += 1;
        continue;
      }
      byPhone.set(row.phone, {
        id: row.id,
        full_name: row.name,
        phone: row.phone,
        attempts: 1,
        created_at: row.startedAt,
      });
    }

    return json({ callbacks: [...byPhone.values()].slice(0, MAX_ROWS) }, 200);
  } catch {
    // An empty queue and a failed read are different facts and the app renders them
    // differently — "nobody is waiting" is a state an agent acts on by relaxing, and
    // a failed request that impersonates it is the one outcome worth avoiding here.
    return json({ error: 'unavailable' }, 503);
  }
}
