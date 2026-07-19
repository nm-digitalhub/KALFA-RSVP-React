import { createHash, timingSafeEqual } from 'node:crypto';

// Constant-time comparison of a PRESENTED secret against a STORED SHA-256 hex
// digest (plan §8: raw callback tokens are never persisted — only their hash).
//
// Hashing the presented value first solves timingSafeEqual's length-mismatch
// throw (both sides become fixed 32-byte digests) AND means a DB leak exposes
// only hashes. This is for high-entropy random tokens — NOT passwords (no KDF
// needed: 128-bit random tokens are not brute-forceable through SHA-256).

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

// True only when `presented` hashes to `expectedSha256Hex`. Malformed/empty
// expected hashes are ALWAYS false (fail closed) — but we still burn a hash of
// the presented value first so the reject path does not return early/faster.
export function safeTokenEqual(presented: string, expectedSha256Hex: string | null | undefined): boolean {
  const presentedDigest = createHash('sha256').update(presented, 'utf8').digest();
  if (!expectedSha256Hex || !SHA256_HEX_RE.test(expectedSha256Hex)) return false;
  const expectedDigest = Buffer.from(expectedSha256Hex, 'hex');
  if (expectedDigest.length !== presentedDigest.length) return false;
  return timingSafeEqual(presentedDigest, expectedDigest);
}
