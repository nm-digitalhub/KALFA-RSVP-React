/**
 * The single Meta Graph API version this system talks WhatsApp over.
 *
 * Do not hard-code a Graph version anywhere else, and never ride a third-party
 * library's own default: `whatsapp-api-js` ships DEFAULT_API_VERSION and
 * `@kapso/whatsapp-cloud-api` defaults to v23.0, so a dependency bump would
 * silently move the version every message goes out on. Both are passed this
 * constant explicitly instead.
 *
 * This closes gap G5. Before it, the version was pinned in SIX places that had
 * drifted apart — v21 in two relocation modules, v23 in four more, and a
 * seventh value coming from the SDK. Every one of them now imports this.
 *
 * v25.0 is MEASURED, not assumed (2026-09-08): reads of phone numbers and
 * templates return identical results on v24.0 and v25.0 for WABA
 * 990921550130385, and four real invites were delivered and read on v25.0 from
 * both business numbers.
 *
 * Deliberately a bare constant with no imports and no `server-only` marker, so
 * the tsx-run relocation CLI can import it as safely as the Next runtime and
 * the pg-boss worker bundle.
 *
 * NOT the version for `src/lib/fleet/publish-social.ts`. That module posts to
 * FACEBOOK PAGE and Instagram endpoints — a different product surface with its
 * own separately verified versions (v26.0 for the page feed/photos, v25.0 for
 * Instagram login). Folding those into this constant would tie WhatsApp's
 * proven version to a surface it was never tested against.
 */
export const GRAPH_API_VERSION = 'v25.0' as const;
