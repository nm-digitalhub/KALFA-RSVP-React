import 'server-only';

import { createHash } from 'node:crypto';

import { getCallAttemptByAccessToken } from '@/lib/data/call-attempts';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

// Shared request guard for the ElevenLabs agent-tool endpoints
// (/api/voximplant/agent-tool/*/{token}). One canonical implementation of the
// cb-route auth model: fail-closed rate limit → body-size caps → opaque per-call
// access-token resolution (identity = the resolved call_attempts row, NEVER the
// body) → expiry check → capped body read. Each route then only parses its own
// schema and persists/processes.

const RATE = { limit: 30, windowMs: 5 * 60 * 1000 } as const;

export type AgentToolGuardResult =
  | { ok: true; attemptId: string; raw: string }
  | { ok: false; status: number };

function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export async function guardAgentToolRequest(
  req: Request,
  token: string,
  opts: { scope: string; maxBodyBytes: number },
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
    ref = await getCallAttemptByAccessToken(token);
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
