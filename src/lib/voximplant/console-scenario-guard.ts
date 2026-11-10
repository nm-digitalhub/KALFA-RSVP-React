import type { z } from 'zod';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';

// Shared request guard for the endpoints the console VoxEngine scenarios POST
// to (/api/voximplant/console/*): per-IP flood guard → body-size caps → JSON →
// the route's own Zod schema → the shared scenario secret.
//
// The order is load-bearing and identical on every route: nothing is parsed
// before the size caps, and the secret (which travels IN the body) is compared
// only after the body proved well-formed — in constant time, against the
// SHA-256 of KALFA_CONSOLE_SECRET. Fail-closed if the secret is unset — never
// an open gate.
//
// The guard decides only the status. Each route owns its refusal BODY (the
// scenario parses `{ ok: false }`, `{ accept: false }`, `{ ring_order: [] }` …)
// and may remap a status by `reason` — route-inbound-retry answers a
// rate-limit trip with 200, which is that route's contract, not this guard's.

export type ConsoleScenarioRefusal =
  | { reason: 'rate_limited'; status: 429 }
  | { reason: 'body_too_large'; status: 413 }
  | { reason: 'invalid_body'; status: 400 }
  | { reason: 'secret_unset'; status: 503 }
  | { reason: 'secret_mismatch'; status: 401 };

export type ConsoleScenarioGuardResult<T> =
  | { ok: true; data: T }
  | ({ ok: false } & ConsoleScenarioRefusal);

export async function guardConsoleScenarioRequest<T extends { secret: string }>(
  request: Request,
  opts: {
    /** Rate-limit key prefix; the client IP is appended. */
    scope: string;
    /**
     * Coarse per-IP flood guard only (NOT a security control — Voximplant's
     * scenarios call from a small, shared, provider-side IP range).
     */
    rate: { limit: number; windowMs: number };
    maxBodyBytes: number;
    schema: z.ZodType<T>;
  },
): Promise<ConsoleScenarioGuardResult<T>> {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!(await rateLimit(`${opts.scope}:${ip}`, opts.rate)).allowed) {
    return { ok: false, reason: 'rate_limited', status: 429 };
  }

  // Content-Length hint first, then the hard cap after the read.
  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > opts.maxBodyBytes) {
    return { ok: false, reason: 'body_too_large', status: 413 };
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > opts.maxBodyBytes) {
    return { ok: false, reason: 'body_too_large', status: 413 };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_body', status: 400 };
  }
  const parsed = opts.schema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false, reason: 'invalid_body', status: 400 };

  const expected = process.env.KALFA_CONSOLE_SECRET;
  if (!expected) return { ok: false, reason: 'secret_unset', status: 503 };
  if (!safeTokenEqual(parsed.data.secret, sha256Hex(expected))) {
    return { ok: false, reason: 'secret_mismatch', status: 401 };
  }

  return { ok: true, data: parsed.data };
}
