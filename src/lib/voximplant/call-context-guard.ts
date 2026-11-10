import 'server-only';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

// Shared request guard for the call-context endpoints a Voximplant scenario
// GETs once at call start (/api/voximplant/ctx/{token} and
// /api/voximplant/{mtg,sls}/ctx/{token}): fail-closed rate limit → token shape
// → opaque per-call access-token lookup → expiry. The token in the path is the
// ONLY authorization. Each route passes its own lookup, so the table it
// authorizes against stays named in the route file, and then applies its own
// freshness rules to the returned row.
//
// Every refusal past the rate limit is the SAME generic 404 — unknown token,
// malformed token, expired token and a DB error must be indistinguishable.

const RATE = { limit: 12, windowMs: 5 * 60 * 1000 } as const;

const HEX32 = /^[0-9a-f]{32}$/;

/**
 * `opaque` — non-empty, at most 256 characters (the RSVP surface).
 * `hex32`  — exactly 32 lowercase hex characters, so a malformed candidate is
 *            rejected before any DB call (the meeting and sales surfaces, whose
 *            tokens are always randomBytes(16).toString('hex')).
 */
export type CallContextTokenShape = 'opaque' | 'hex32';

export type CallContextGuardResult<T> = { ok: true; ctx: T } | { ok: false; status: 429 | 404 };

function hasShape(token: unknown, shape: CallContextTokenShape): token is string {
  if (typeof token !== 'string') return false;
  return shape === 'hex32' ? HEX32.test(token) : token.length > 0 && token.length <= 256;
}

export async function guardCallContextRequest<T extends { attempt: { token_expires_at: string } }>(
  req: Request,
  token: string,
  opts: {
    scope: string;
    tokenShape: CallContextTokenShape;
    lookup: (token: string) => Promise<T | null>;
  },
): Promise<CallContextGuardResult<T>> {
  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!(await rateLimit(`${opts.scope}:${fp}:${ip}`, RATE)).allowed) {
    return { ok: false, status: 429 };
  }

  if (!hasShape(token, opts.tokenShape)) return { ok: false, status: 404 };

  let ctx: T | null;
  try {
    ctx = await opts.lookup(token);
  } catch {
    // A real DB error must not reveal itself as anything but the generic 404.
    return { ok: false, status: 404 };
  }
  if (!ctx) return { ok: false, status: 404 };

  // The row's token_expires_at is the sole expiry source (the bearer is an
  // opaque access token, not a self-describing JWT).
  if (Date.parse(ctx.attempt.token_expires_at) <= Date.now()) return { ok: false, status: 404 };

  return { ok: true, ctx };
}
