import { NextResponse } from 'next/server';

import { requireConsoleAgent } from '@/lib/auth/console-agent';
import { findTransferTargets } from '@/lib/data/console-calls';
import { rateLimit } from '@/lib/security/rate-limit';

// GET /api/agents/transfer-targets   ->   { targets: [{ agent_id, display_name }] }
//
// The picker behind the native console's transfer / consult / conference
// buttons: which colleagues can this agent hand a live call to right now.
//
// A read-only LIST endpoint, and nothing more — naming a target here grants
// nothing. Each of the three actions is its own POST
// (/api/console-calls/{id}/transfer|consult|conference), each re-resolves the
// chosen agent through resolveTransferTarget server-side, and each checks
// manage_voice again. This route existing does not widen what any of them will
// do; it only stops the app having to guess at agent ids.
//
// Auth = requireConsoleAgent (Bearer Supabase-JWT + the staff-gated
// is_console_agent), the same gate /api/agents/status and /api/agents/shift use
// and the same one the app already sends a token for. Deliberately NOT also
// gated on manage_voice, even though the three action routes are: this returns
// colleague display names to a console agent, which is not privileged
// information on the call floor, and gating it would leave the buttons visible
// but permanently empty for an agent who can in fact be transferred TO but not
// FROM. The actions remain gated where the authority actually matters.
//
// PII: display names of staff, never guests. No phone numbers, no vox usernames
// (the app has no use for one — the routes resolve it themselves), no call data.
//
// Rate-limited per agent, like /api/agents/shift: an agent opens the picker a
// handful of times per call, and a tight cap costs a real client nothing while
// bounding a wedged client that polls it.

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

  if (!rateLimit(`agent-transfer-targets:${ctx.userId}`, RATE).allowed) {
    return json({ error: 'rate_limited' }, 429);
  }

  try {
    const targets = await findTransferTargets(ctx.userId);
    return json(
      {
        targets: targets.map((t) => ({ agent_id: t.agentId, display_name: t.displayName })),
      },
      200,
    );
  } catch {
    // An empty list and a failed lookup are NOT the same thing, and the app
    // renders them differently — "no colleague is available right now" is a
    // normal state an agent must be able to trust, so a query failure must not
    // impersonate it. 503 lets the picker say the list could not be loaded.
    return json({ error: 'unavailable' }, 503);
  }
}
