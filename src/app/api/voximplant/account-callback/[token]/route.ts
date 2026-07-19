import { NextResponse } from 'next/server';

import {
  getAccountCallbackTokenHash,
  runVerifiedBalancePull,
  stampBalanceCallbackReceived,
} from '@/lib/data/voximplant-account-callback';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual } from '@/lib/security/token-compare';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { normalizeAccountCallbackEnvelope } from '@/lib/validation/vox-payloads';

// POST /api/voximplant/account-callback/{token}
//
// Voximplant account-level webhook (MinBalanceCallback et al). The payload is an
// UNTRUSTED POKE: the provider's MD5 hash can't be verified without the legacy
// api_key we don't hold, so identity is OUR opaque URL token (stored as a
// SHA-256 hash). On any authenticated poke we pull the verified balance
// ourselves and alert from that — the body is never trusted for a decision.
//
// The route is DARK until an admin wires it: with no stored token hash every
// request is a generic 404. Mirrors the cb route's fail-closed posture.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE = { limit: 20, windowMs: 5 * 60 * 1000 } as const;
// A separate, tight limiter on the verified PULL so a callback flood cannot turn
// into a GetAccountInfo flood (per-process; resets on redeploy — documented).
const PULL_RATE = { limit: 2, windowMs: 60 * 1000 } as const;
const MAX_BODY_BYTES = 64 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Rate limit FAIL-CLOSED.
  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!rateLimit(`vox-acct-cb:${fp}:${ip}`, RATE).allowed) return bad(429);

  // 2. Body size cap (Content-Length hint, then hard cap after read).
  const declaredLen = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) return bad(413);

  // 3. Token shape + constant-time hash compare. A DB error, an absent stored
  //    hash (unwired), or a mismatch all look identical: a generic 404.
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    return bad(404);
  }
  let storedHash: string | null;
  try {
    storedHash = await getAccountCallbackTokenHash();
  } catch {
    return bad(404);
  }
  if (!safeTokenEqual(token, storedHash)) return bad(404);

  // 4. Read the (untrusted) body. A parse failure does NOT change the outcome —
  //    the payload is only a poke; identity is the verified token above.
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return bad(413);
  let envelope: unknown = null;
  try {
    envelope = JSON.parse(raw);
  } catch {
    /* ignore — poke still triggers the verified pull below */
  }
  // Normalized only for telemetry (unknown callback types are counted, ignored).
  normalizeAccountCallbackEnvelope(envelope);

  // 5. Stamp receipt (best-effort) + verified pull (rate-limited so a flood of
  //    pokes cannot become a flood of GetAccountInfo calls). Both never throw.
  await stampBalanceCallbackReceived();
  if (rateLimit('vox-acct-cb:pull', PULL_RATE).allowed) {
    await runVerifiedBalancePull();
  }

  // 6. Always 200 past the gates — Voximplant's retry behavior is undocumented
  //    and the callback carries no trusted data, so a non-2xx buys nothing and
  //    risks retry storms.
  return new NextResponse('ok', { status: 200, headers: NO_STORE });
}
