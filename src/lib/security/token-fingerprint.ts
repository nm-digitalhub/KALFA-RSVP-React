import { createHash } from 'node:crypto';

// Short, non-reversible fingerprint of a bearer token for rate-limit bucket
// keys and (if ever needed) logging. A raw token must never be embedded in a
// key or log line — in-memory keys can surface in diagnostics, and the token
// is a live credential. 16 hex chars (64 bits) is ample for bucket uniqueness.
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}
