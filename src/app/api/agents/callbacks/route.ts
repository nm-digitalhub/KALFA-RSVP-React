import { NextResponse } from 'next/server';

import { requireConsoleAgent } from '@/lib/auth/console-agent';
import { findPendingCallbacks } from '@/lib/data/console-calls';
import { rateLimit } from '@/lib/security/rate-limit';

// GET /api/agents/callbacks  ->  { callbacks: [{ id, full_name, phone, topic, created_at }] }
//
// The missed-call queue, for the native console. Every unanswered inbound call
// records one of these (recordMissedCallCallback), and until now they were visible
// only in the web admin — an agent holding the phone that rang had no way to see
// what they had missed, let alone return it.
//
// CARRIES THE PHONE NUMBER, deliberately, and it is the one read in this app that
// hands an agent a full number rather than a masked hint. An agent about to return a
// call has to see who they are ringing, including someone who has never been a
// customer and has no name attached — which is precisely the case a masked number
// makes useless. The owner asked for exactly that: "חשוב לזכור להציג את המספר ממנו
// הלקוח חייג גם אם מדובר במספר טלפון של אדם שאינו לקוח שלנו עדיין".
//
// The number is for DISPLAY only and is never the thing dialled. To return a call
// the app posts the callback's ID to /api/console-calls/dial-intent, which re-reads
// the number server-side and runs the full consent chain (DNC, opt-out, quiet hours,
// Shabbat, caps, balance) before minting a one-time dial token. So this endpoint
// widens what an agent can SEE, never what they can dial — a number pasted back from
// here would still have to pass every gate, and dial-intent has no shape that
// accepts a raw phone at all.
//
// Auth = requireConsoleAgent (Bearer + the staff-gated is_console_agent), the same
// gate /api/agents/status, /shift and /transfer-targets use. Deliberately NOT also
// gated on manage_voice: seeing who is waiting for a call back is call-floor
// information, and the authority that matters lives on the dial itself, which
// dial-intent already enforces.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const RATE = { limit: 60, windowMs: 60_000 } as const;

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
    const callbacks = await findPendingCallbacks();
    return json(
      {
        callbacks: callbacks.map((c) => ({
          id: c.id,
          full_name: c.fullName,
          phone: c.phone,
          topic: c.topic,
          created_at: c.createdAt,
        })),
      },
      200,
    );
  } catch {
    // An empty queue and a failed read are different facts and the app renders them
    // differently — "nobody is waiting" is a state an agent acts on by relaxing, and
    // a failed request that impersonates it is the one outcome worth avoiding here.
    return json({ error: 'unavailable' }, 503);
  }
}
