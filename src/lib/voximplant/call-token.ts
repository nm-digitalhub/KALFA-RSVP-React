import { createHmac, timingSafeEqual } from 'node:crypto';

// Per-call, per-purpose, HMAC-signed bearer tokens for the Voximplant ctx/cb
// endpoints. Stateless (no DB token storage) — the token binds a single
// call_attempt_id + a purpose + an expiry, all under an HMAC signed with the
// per-install callback secret. The endpoint verifies the signature in constant
// time, checks the purpose + expiry, then loads the attempt by id from the DB
// (the server-side source of truth). The token is NOT authorization on its own —
// it names WHICH attempt; the DB row is still re-checked. Runtime-agnostic (pure
// node:crypto) so it is unit-testable without a server context.
//
// Requirements met: distinct token per purpose (ctx vs cb), bound to
// call_attempt_id, self-expiring, signed (not a guessable UUID), constant-time
// compare, rejects missing/malformed/expired/wrong-purpose tokens.

export type CallTokenPurpose = 'ctx' | 'cb';

const MAX_TOKEN_LEN = 1024; // generous cap; a real token is ~120 chars

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

// Mint a token: `${payloadB64url}.${hmacB64url}` where payload = {aid,p,exp}.
export function signCallToken(
  secret: string,
  claims: { callAttemptId: string; purpose: CallTokenPurpose; expiresAtSec: number },
): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        aid: claims.callAttemptId,
        p: claims.purpose,
        exp: claims.expiresAtSec,
      }),
    ),
  );
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export type VerifyResult =
  | { ok: true; callAttemptId: string; expiresAtSec: number }
  | {
      ok: false;
      reason: 'no_secret' | 'malformed' | 'bad_signature' | 'wrong_purpose' | 'expired';
    };

// Verify a token for an EXPECTED purpose at time `nowSec`. Returns the bound
// call_attempt_id on success. Every failure is a distinct reason for internal
// logging only — the HTTP layer must collapse all of them to a generic error.
export function verifyCallToken(
  secret: string | null | undefined,
  token: string | null | undefined,
  expectedPurpose: CallTokenPurpose,
  nowSec: number,
): VerifyResult {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LEN) {
    return { ok: false, reason: 'malformed' };
  }
  const dot = token.indexOf('.');
  if (dot <= 0 || dot >= token.length - 1) return { ok: false, reason: 'malformed' };
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  // Constant-time signature check (length-guarded — timingSafeEqual throws on
  // unequal lengths). Compare the recomputed HMAC to the presented signature.
  const expectedSig = b64url(createHmac('sha256', secret).update(payloadPart).digest());
  const presented = Buffer.from(sigPart);
  const expected = Buffer.from(expectedSig);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'malformed' };
  const c = claims as { aid?: unknown; p?: unknown; exp?: unknown };
  if (
    typeof c.aid !== 'string' ||
    c.aid.length === 0 ||
    (c.p !== 'ctx' && c.p !== 'cb') ||
    typeof c.exp !== 'number' ||
    !Number.isFinite(c.exp)
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (c.p !== expectedPurpose) return { ok: false, reason: 'wrong_purpose' };
  if (c.exp <= nowSec) return { ok: false, reason: 'expired' };
  return { ok: true, callAttemptId: c.aid, expiresAtSec: c.exp };
}
