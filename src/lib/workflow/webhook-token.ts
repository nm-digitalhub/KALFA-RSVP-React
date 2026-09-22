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
 * Length in bytes of the PUBLIC endpoint id.
 *
 * Shorter than the secret on purpose: this value proves nothing and grants
 * nothing, so it needs only to not collide. 16 bytes of CSPRNG is ~2^128 of
 * space against a handful of webhooks. It is still generated rather than
 * derived from the workflow or node id — a derived id would leak which workflow
 * a third party is calling, and node ids are SHARED between workflows created
 * from the same template (MEASURED: templates ship literal ids like
 * `tmpl-custdoc-trigger`), so deriving would collide outright.
 */
const ENDPOINT_BYTES = 16;

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  // base64url: URL-safe without escaping, because both of these become path or
  // header values.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * A fresh PUBLIC endpoint id — the part of the address that may be shown,
 * copied, and kept forever.
 *
 * ⚠️ THIS IS THE HALF THAT MAKES THE ADDRESS RECOVERABLE. The old design put the
 * secret in the path, so the address WAS the credential and could never be shown
 * twice; the owner's report ("אין לי אפשרות לדעת מה כתובת ה-webhook?") is the
 * direct consequence. Splitting the two means the address is stable and public
 * while the secret rotates independently — so rotating no longer breaks the
 * caller, and the secret stops being written into every access log that records
 * a URL. See plans/webhook-address-vs-secret.md.
 */
export function generateWebhookEndpointId(): string {
  return randomBase64Url(ENDPOINT_BYTES);
}

/**
 * A fresh token, for the operator to keep.
 *
 * Returned ONCE and never recoverable: only its hash is stored, which is the
 * point. An operator who loses it regenerates — the same thing any system does
 * with a password, and what the field's warning already implied.
 */
export function generateWebhookToken(): string {
  return randomBase64Url(TOKEN_BYTES);
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

/**
 * The address of a webhook trigger.
 *
 * ⚠️ TAKES THE PUBLIC ENDPOINT ID, NEVER THE SECRET. It used to take the token,
 * which is what made the URL unshowable — and what put a live credential into
 * every access log, proxy record and Referer header that stores a path. The
 * secret now travels in `x-kalfa-webhook-secret`, so this string is safe to
 * display, copy and keep.
 */
export function webhookUrlFor(origin: string, endpointId: string): string {
  return new URL(`/api/workflows/hook/${encodeURIComponent(endpointId)}`, origin).href;
}

/** The header an inbound call proves itself with. */
export const WEBHOOK_SECRET_HEADER = 'x-kalfa-webhook-secret';

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
