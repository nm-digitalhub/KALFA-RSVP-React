import { NextResponse } from 'next/server';

import { requireConsoleAgent } from '@/lib/auth/console-agent';
import { findRecentConsoleCalls } from '@/lib/data/console-calls';
import { rateLimit } from '@/lib/security/rate-limit';

// GET /api/agents/call-history  ->  { calls: [...] }
//
// The console's own call history, for the native app.
//
// It replaces what that screen was reading, which was the wrong table: the app built
// its history from `console_call_feed`, keyed on `call_attempts` — the AI campaign
// calls. An agent opening "היסטוריה" saw the robot's work rather than their own
// conversations, and every row rendered as "אורח" with a blank phone, because that
// feed carries no PII by design and never did.
//
// These rows carry the caller's NAME and NUMBER. Same reasoning as
// /api/agents/callbacks: an agent reviewing their own calls has to know who each one
// was with, and for a caller who has never been a customer the number is the only
// identity that exists. Staff-only either way — requireConsoleAgent gates on the
// same staff-checked is_console_agent every other agent route uses.
//
// `event_id` + `contact_id` are returned ONLY as a pair, and only so the app knows
// whether a dial button is offerable at all. Dialling still goes through
// /api/console-calls/dial-intent's `guest_service` shape, which re-resolves the
// contact server-side and runs the full consent chain — DNC, opt-out, quiet hours,
// Shabbat, caps, balance. A call with no contact provenance gets no button, because
// there is no approved path to that number: dial-intent has no shape that accepts a
// raw phone, and that exclusion is the enforcement of a consent ruling rather than
// an omission to work around.

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

  if (!rateLimit(`agent-call-history:${ctx.userId}`, RATE).allowed) {
    return json({ error: 'rate_limited' }, 429);
  }

  try {
    const calls = await findRecentConsoleCalls();
    return json(
      {
        calls: calls.map((c) => ({
          id: c.id,
          direction: c.direction,
          status: c.status,
          name: c.name,
          phone: c.phone,
          started_at: c.startedAt,
          duration_sec: c.durationSec,
          answered: c.answered,
          event_id: c.eventId,
          contact_id: c.contactId,
        })),
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
