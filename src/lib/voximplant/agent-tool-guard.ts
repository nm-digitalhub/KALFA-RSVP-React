import 'server-only';

import { getCallAttemptByAccessToken } from '@/lib/data/call-attempts';
import { getCallbackAttemptByAccessToken } from '@/lib/data/callback-request-attempts';
import { getSalesAttemptByAccessToken } from '@/lib/data/sales-call-attempts';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

// Shared request guard for the ElevenLabs agent-tool endpoints
// (/api/voximplant/agent-tool/*/{token} and /api/voximplant/mtg/cb/*/{token}).
// One canonical implementation of the cb-route auth model: fail-closed rate
// limit → body-size caps → opaque per-call access-token resolution (identity =
// the resolved attempt row, NEVER the body) → expiry check → capped body read.
// Each route then only parses its own schema and persists/processes.
//
// Two thin exports, one shared core: guardAgentToolRequest (call_attempts, the
// original RSVP/sales surface) and guardMeetingToolRequest
// (callback_request_attempts, the meeting-booking surface) — kept as SEPARATE
// named functions rather than one generic parameterized export, so a route
// import (`guardAgentToolRequest` vs `guardMeetingToolRequest`) states which
// table it authorizes against just by its name, matching this table's own
// "never stretch one function across both surfaces" precedent
// (getCallAttemptByAccessToken / getCallbackAttemptByAccessToken are
// similarly separate, not a shared generic lookup).

const RATE = { limit: 30, windowMs: 5 * 60 * 1000 } as const;

export type AgentToolGuardResult =
  | { ok: true; attemptId: string; raw: string }
  | { ok: false; status: number };

type AttemptRef = { id: string; token_expires_at: string | null };

async function guardTokenGatedToolRequest(
  req: Request,
  token: string,
  opts: { scope: string; maxBodyBytes: number },
  lookup: (token: string) => Promise<AttemptRef | null>,
): Promise<AgentToolGuardResult> {
  // Rate limit FAIL-CLOSED: a limiter trip rejects the tool call.
  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!rateLimit(`${opts.scope}:${fp}:${ip}`, RATE).allowed) {
    return { ok: false, status: 429 };
  }

  const declaredLen = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > opts.maxBodyBytes) {
    return { ok: false, status: 413 };
  }

  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    return { ok: false, status: 404 };
  }

  let ref;
  try {
    ref = await lookup(token);
  } catch {
    return { ok: false, status: 404 }; // a real DB error must look like the generic 404
  }
  if (!ref) return { ok: false, status: 404 };
  if (!ref.token_expires_at || Date.parse(ref.token_expires_at) <= Date.now()) {
    return { ok: false, status: 404 };
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw) > opts.maxBodyBytes) {
    return { ok: false, status: 413 };
  }

  return { ok: true, attemptId: ref.id, raw };
}

export function guardAgentToolRequest(
  req: Request,
  token: string,
  opts: { scope: string; maxBodyBytes: number },
): Promise<AgentToolGuardResult> {
  return guardTokenGatedToolRequest(req, token, opts, getCallAttemptByAccessToken);
}

export function guardMeetingToolRequest(
  req: Request,
  token: string,
  opts: { scope: string; maxBodyBytes: number },
): Promise<AgentToolGuardResult> {
  return guardTokenGatedToolRequest(req, token, opts, getCallbackAttemptByAccessToken);
}

// guardSalesToolRequest (sales_call_attempts, the sales-closing surface) —
// third named export, same "state which table by the function name" reasoning
// as the other two.
export function guardSalesToolRequest(
  req: Request,
  token: string,
  opts: { scope: string; maxBodyBytes: number },
): Promise<AgentToolGuardResult> {
  return guardTokenGatedToolRequest(req, token, opts, getSalesAttemptByAccessToken);
}
