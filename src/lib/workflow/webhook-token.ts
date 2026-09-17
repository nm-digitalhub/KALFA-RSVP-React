// The webhook trigger's credential, and the one place that decides its shape.
//
// ⚠️ THE DIAGRAM STORES A HASH, NEVER THE TOKEN. It used to store the value, and
// the field's own label already called it a password — so a workflow's stored
// JSON was a live credential, and the editor's Export menu put it in a copyable
// box. Scrubbing that on the way out works, but it is a rule someone has to
// remember; a hash is safe because there is nothing to remember.
//
// This is the model n8n reaches by a different route: there, a node references a
// credential by id and the value lives in its own encrypted table, so a workflow
// export carries nothing secret BY CONSTRUCTION — `copyNodes` stringifies straight
// to the clipboard with no scrubbing at all. The SDK gives us no credential
// registry to reference (measured: the whole `.d.ts` mentions `credential`,
// `secret` and `vault` exactly once, as an ICON name), so the indirection has to
// be ours. Hashing is the cheapest one that needs no second table.
//
// ONE IMPLEMENTATION, BOTH SIDES. `crypto.subtle` exists in the browser and in
// Node 20+, so the editor that writes the hash and the route that checks it run
// the same code. Two implementations of "the same" digest is exactly the seam
// where an upgrade silently stops matching.

/** Length in bytes of a generated token. 32 from a CSPRNG is not guessable. */
const TOKEN_BYTES = 32;

/**
 * A fresh token, for the operator to keep.
 *
 * Returned ONCE and never recoverable: only its hash is stored, which is the
 * point. An operator who loses it regenerates — the same thing any system does
 * with a password, and what the field's warning already implied.
 */
export function generateWebhookToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // base64url: URL-safe without escaping, because this value becomes a path
  // segment in `/api/workflows/hook/<token>`.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The stored form of a token: lowercase hex sha256.
 *
 * Not salted, and deliberately: the input is 32 bytes of CSPRNG output, so there
 * is no dictionary to stretch against, and the check has to be a plain equality
 * on a value the route computes per request. A KDF here would buy nothing and
 * cost every inbound call.
 */
export async function hashWebhookToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The address a generated token produces, shown once beside it. */
export function webhookUrlFor(origin: string, token: string): string {
  return new URL(`/api/workflows/hook/${encodeURIComponent(token)}`, origin).href;
}

/**
 * Whether two stored hashes are the same, without leaking how far they matched.
 *
 * Both are 64 hex characters by construction, but the comparison still runs in
 * constant time over the full length: the caller controls one side, and an
 * early-exit `===` reports the matching prefix through timing. `timingSafeEqual`
 * is not used because it is Node-only and this module runs in both places —
 * the XOR-accumulate below has the same property and no import.
 */
export function webhookHashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
