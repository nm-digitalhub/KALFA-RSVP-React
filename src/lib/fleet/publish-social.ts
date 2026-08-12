// Pure logic for the `publish-social` verb (plans/fleet-social-publishing-capability-plan.md
// §4, stage 2 in §7). Everything here is deliberately free of filesystem/DB/network access
// so it can be unit-tested directly; fleet-agent-cli.ts wires these functions to the actual
// Supabase reads/writes and the .fleet-logs/ file I/O.
//
// Four independent safety checks gate the (not-yet-implemented) Meta call, per plan §4.5:
//   1. validatePublishRequestRow + validatePublishPayload — an OWNER'S approving verdict for
//      role='social-manager', kind='approval', payload.action='publish_social', AND
//      payload.platform matching the platform actually being invoked. The platform check is
//      not literally listed in §4.5 item 1's four fields, but it is the same kind of
//      deviation that item 1 exists to catch: §4.3's ledger key is (request_id, platform),
//      §5's --request-key embeds the platform, and the owner-visible title is
//      "🔴 פרסום בפועל: <platform> — ..." — three independent places treat platform as part
//      of what was actually approved. Publishing to an unapproved platform for an otherwise-
//      valid request-id is exactly the class of mistake check #1 is meant to reject.
//   2. sha256Hex + comparison against payload.attachments[i].sha256 (hash-pinning) — content
//      the owner approved must be byte-identical to what's about to be sent.
//   3. scanGroundingClaims / validateGrounding — a mechanical (not exhaustive) scan for
//      price/promise language that requires payload.facts_source.
//   4. checkReviewApproved — the batch's REVIEW.md must mechanically show brand-director's
//      "סטטוס: מוכנה-לאישור".

import { createHash } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';

import { z } from 'zod';

export const PLATFORMS = ['instagram', 'facebook'] as const;
export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

// Instagram has no text-only feed post (verified live against Meta's docs, plan §0/§4.1);
// Facebook supports caption-only, which is exactly what makes the staged rollout in §7
// (facebook-text -> facebook-photo -> instagram) possible without two parallel code paths.
export function validatePlatformImageRequirement(platform: Platform, hasImage: boolean): string | null {
  if (platform === 'instagram' && !hasImage) {
    return '--platform instagram requires --image-path — there is no text-only Instagram feed post';
  }
  return null;
}

export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

const attachmentSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1),
  mime: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a 64-char lowercase hex sha256 digest'),
});
export type SocialAttachment = z.infer<typeof attachmentSchema>;

// Convention from plan §4.5 item 2 / §5: attachment 0 is always the caption, attachment 1
// (when present) is the image — the order social-manager's `--attach <caption> --attach
// <image>` invocation produces, not re-sorted here.
const publishSocialPayloadSchema = z.object({
  action: z.literal('publish_social'),
  platform: z.enum(PLATFORMS),
  facts_source: z.string().optional(),
  attachments: z.array(attachmentSchema).min(1),
});
export type PublishSocialPayload = z.infer<typeof publishSocialPayloadSchema>;

export type PayloadValidationResult =
  | { ok: true; payload: PublishSocialPayload }
  | { ok: false; reason: string };

export function validatePublishPayload(rawPayload: unknown, expectedPlatform: Platform): PayloadValidationResult {
  const parsed = publishSocialPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    // A payload missing sha256 on an attachment predates the hash-pinning extension to
    // cmdRequest's --attach handling — that request can never be hash-verified and must be
    // re-filed, not just re-approved. Worth a specific message: a generic "invalid payload"
    // here would send someone chasing the wrong fix.
    if (path.includes('sha256')) {
      return {
        ok: false,
        reason: `payload.${path} is missing or invalid — this request was filed before attachment hash-pinning was added and cannot be verified; it must be re-filed`,
      };
    }
    return {
      ok: false,
      reason: `payload is not a valid publish_social payload (${path}: ${issue?.message ?? 'invalid'})`,
    };
  }
  if (parsed.data.platform !== expectedPlatform) {
    return {
      ok: false,
      reason: `--platform ${expectedPlatform} does not match the approved payload.platform "${parsed.data.platform}" — the owner approved a different platform for this request`,
    };
  }
  return { ok: true, payload: parsed.data };
}

export const SOCIAL_MANAGER_ROLE = 'social-manager';
export const PUBLISH_APPROVAL_KIND = 'approval';
export const PUBLISH_APPROVED_STATUS = 'approved';

export type PublishRequestRow = { role: string; kind: string; status: string } | null | undefined;

export function validatePublishRequestRow(row: PublishRequestRow): string | null {
  if (!row) return 'request-id not found';
  if (row.role !== SOCIAL_MANAGER_ROLE) {
    return `request-id belongs to role "${row.role}", not "${SOCIAL_MANAGER_ROLE}"`;
  }
  if (row.kind !== PUBLISH_APPROVAL_KIND) {
    return `request-id has kind "${row.kind}", not "${PUBLISH_APPROVAL_KIND}"`;
  }
  if (row.status !== PUBLISH_APPROVED_STATUS) {
    return `request-id status is "${row.status}", not "${PUBLISH_APPROVED_STATUS}" — no approving owner verdict yet`;
  }
  return null;
}

// Mechanical, best-effort net for constraint 6 (plan §4.5 item 3) — it catches known
// patterns, it does not replace brand-director's editorial grounding review.
const CURRENCY_PATTERN = /₪/;
const PERCENT_PATTERN = /\d+%/;
const FREE_WORDS = ['חינם', 'בחינם'] as const;
const SUPERLATIVE_WORDS = ['הכי', 'תמיד', 'בטוח'] as const;

// Hebrew has no \w-based regex \b — Hebrew letters aren't in \w, so \bהכי\b
// never matches anything. A plain .includes() check therefore used to treat
// "הכי" as a hit inside "הכיתוב" ("the caption") or "הכיסאות" ("the chairs"),
// which are unrelated words that merely contain the superlative "הכי" ("most")
// as a substring — a false positive measured live (2026-08-12 fleet run).
// Fixed by checking, by hand, that the characters immediately before and
// after the match are not themselves Hebrew letters — the closest hand-rolled
// equivalent to a word boundary this alphabet has. Trade-off, by design: a
// term with a proclitic prefix glued directly on ("והכי", "שתמיד") is no
// longer caught either, since the preceding character is a Hebrew letter too.
// Acceptable for a mechanical, best-effort net that does not replace
// brand-director's editorial review (see the comment above).
const HEBREW_LETTER = /[א-ת]/;

function includesHebrewWord(text: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at === -1) return false;
    const before = at > 0 ? text[at - 1] : '';
    const after = at + word.length < text.length ? text[at + word.length] : '';
    if (!HEBREW_LETTER.test(before) && !HEBREW_LETTER.test(after)) return true;
    from = at + 1;
  }
}

export function scanGroundingClaims(caption: string): string[] {
  const matches: string[] = [];
  if (CURRENCY_PATTERN.test(caption)) matches.push('currency (₪)');
  if (PERCENT_PATTERN.test(caption)) matches.push('percent (N%)');
  for (const word of FREE_WORDS) {
    if (includesHebrewWord(caption, word)) matches.push(`free-claim ("${word}")`);
  }
  for (const word of SUPERLATIVE_WORDS) {
    if (includesHebrewWord(caption, word)) matches.push(`superlative ("${word}")`);
  }
  return matches;
}

export function validateGrounding(caption: string, factsSource: string | undefined): string | null {
  const matches = scanGroundingClaims(caption);
  if (matches.length === 0) return null;
  if (factsSource && factsSource.trim().length > 0) return null;
  return `caption contains a price/promise pattern (${matches.join(', ')}) but payload.facts_source is empty — a data source is required for grounded claims`;
}

const REVIEW_APPROVED_LINE = 'סטטוס: מוכנה-לאישור';

export function checkReviewApproved(content: string): boolean {
  const firstLine =
    content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  return firstLine.includes(REVIEW_APPROVED_LINE);
}

// Both derived from the caption attachment's stored (repo-relative) path — "הנתיב נגזר
// מ-payload" (plan §4.5 item 4 / §6 recommendation), not from the CLI's --caption-file
// argument, so the derivation follows what the owner actually approved.
export function deriveReviewMdPath(captionAttachmentPath: string): string {
  return join(dirname(captionAttachmentPath), 'REVIEW.md');
}

// Includes the caption attachment's own basename (extension stripped), not
// just <batch>/<platform> — two posts in the same batch targeting the same
// platform (post-1 and post-2, both --platform facebook) otherwise derive the
// IDENTICAL path, so the second publish-social run silently overwrites the
// first post's dry-run artifact (measured live, 2026-08-12 fleet run: only
// one post visible afterward under a shared publish-payload-<platform>.json).
export function deriveDryRunArtifactPath(captionAttachmentPath: string, platform: Platform): string {
  const captionBase = basename(captionAttachmentPath, extname(captionAttachmentPath));
  return join(dirname(captionAttachmentPath), `publish-payload-${platform}-${captionBase}.json`);
}

// State machine (plan §4.4): the observed status of a conflicting fleet_social_posts row
// decides whether this call is a benign no-op or a retry-eligible claim. 'dry_run' is
// treated exactly like 'failed' ("אותו מעבר CAS כמו failed", no dry-run-vs-live distinction
// in the plan's own wording) — deliberately: re-running --dry-run while iterating on the
// pipeline before real credentials exist is the entire point of stage 2, so a prior
// dry-run success must not block a later one.
export type ExistingRowDecision = 'noop' | 'retry';

export function decideExistingRow(status: string): ExistingRowDecision {
  if (status === 'published' || status === 'publishing') return 'noop';
  if (status === 'failed' || status === 'dry_run') return 'retry';
  throw new Error(`unexpected fleet_social_posts.status: "${status}"`);
}

// Pure request-body builders — used to both populate the --dry-run artifact and, in a
// future stage, the real fetch() call (plan §4.6). No network/credential access here: Meta
// endpoint host paths are written with the literal env-var-name placeholder, never a real
// page/account id or token.
export interface FacebookFeedRequest {
  method: 'POST';
  endpoint: string;
  body: { message: string };
}

export function buildFacebookFeedRequest(caption: string): FacebookFeedRequest {
  return {
    method: 'POST',
    endpoint: 'https://graph.facebook.com/v26.0/{META_FACEBOOK_PAGE_ID}/feed',
    body: { message: caption },
  };
}

export interface FacebookPhotoRequest {
  method: 'POST';
  endpoint: string;
  multipart: { message: string; source: string };
}

export function buildFacebookPhotoRequest(caption: string, imageAttachmentPath: string): FacebookPhotoRequest {
  return {
    method: 'POST',
    endpoint: 'https://graph.facebook.com/v26.0/{META_FACEBOOK_PAGE_ID}/photos',
    multipart: { message: caption, source: `<binary bytes of ${imageAttachmentPath}>` },
  };
}

export interface InstagramPublishPlan {
  steps: [
    {
      step: 'create_container';
      method: 'POST';
      endpoint: string;
      body: { image_url: string | null; caption: string; note: string };
    },
    { step: 'poll_status'; method: 'GET'; endpoint: string; note: string },
    { step: 'publish'; method: 'POST'; endpoint: string; body: { creation_id: string } },
  ];
}

// Host is graph.instagram.com, not graph.facebook.com — Route B, "Instagram API
// with Instagram Login" (plans/social-publish-live-stage-plan.md addendum א׳,
// decided 2026-08-12: Standard Access needs no App Review for KALFA's own
// account, unlike the classic Facebook-Login surface Facebook publishing still
// uses). v25.0 verified live 2026-08-12 against TWO independent sources — ctx7
// (/websites/developers_facebook_instagram-platform) AND a direct WebFetch of
// developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-
// login/{get-started,content-publishing} — both agree on host+version for this
// specific surface (distinct from the v26.0 already confirmed for
// graph.facebook.com). cmdPublishSocial's live path (fleet-agent-cli.ts) derives
// its actual create_container/media_publish requests from THIS SAME plan (endpoint
// + body, minus the dry-run-only `note`) — one source of truth, so the dry-run
// artifact is a provable preview of the real call, not just a look-alike.
// Exported so the ig-token-refresh cron (src/lib/data/instagram-token-refresh.ts)
// verifies a freshly-refreshed token against the SAME host+version this file's
// publish path uses, instead of a second literal that could drift out of sync.
export const IG_LOGIN_GRAPH_API_BASE = 'https://graph.instagram.com/v25.0';

// imageUrl defaults to null (dry-run, no resolved URL yet — plan §4.6/§7 stage 6
// history). The live path (plan social-publish-live-stage-plan.md §2.5/§3.7)
// passes a short-lived Supabase Storage signed URL for the private
// social-publish-assets bucket.
export function buildInstagramPublishPlan(
  caption: string,
  imageUrl: string | null = null,
): InstagramPublishPlan {
  return {
    steps: [
      {
        step: 'create_container',
        method: 'POST',
        endpoint: `${IG_LOGIN_GRAPH_API_BASE}/{META_INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
        body: {
          image_url: imageUrl,
          caption,
          note: imageUrl
            ? 'image_url is a short-lived Supabase Storage signed URL (plan §2.5/§4.6, social-publish-assets bucket, private) — stripped before the real Meta call, dry-run-only annotation'
            : 'image_url requires the social-publish-assets bucket (plan §4.6, §7 stage 6) — not yet migrated',
        },
      },
      {
        step: 'poll_status',
        method: 'GET',
        endpoint: `${IG_LOGIN_GRAPH_API_BASE}/{container-id}?fields=status_code`,
        note: 'poll until status_code=FINISHED',
      },
      {
        step: 'publish',
        method: 'POST',
        endpoint: `${IG_LOGIN_GRAPH_API_BASE}/{META_INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
        body: { creation_id: '{container-id}' },
      },
    ],
  };
}

export type DryRunArtifact =
  | { platform: 'facebook'; hasImage: boolean; request: FacebookFeedRequest | FacebookPhotoRequest }
  | { platform: 'instagram'; hasImage: true; request: InstagramPublishPlan };

export function buildDryRunArtifact(
  platform: Platform,
  caption: string,
  imageAttachmentPath: string | null,
): DryRunArtifact {
  if (platform === 'instagram') {
    return { platform, hasImage: true, request: buildInstagramPublishPlan(caption) };
  }
  return {
    platform,
    hasImage: imageAttachmentPath !== null,
    request: imageAttachmentPath
      ? buildFacebookPhotoRequest(caption, imageAttachmentPath)
      : buildFacebookFeedRequest(caption),
  };
}

// ── Live-path support (plans/social-publish-live-stage-plan.md §3-§4) ──────
// Everything below stays pure — no fetch/DB access — per this file's own
// header comment. cmdPublishSocial (fleet-agent-cli.ts) is the only caller
// that ever sees a real network response or credential.

// Meta Graph API error shape — verified live 2026-08-12 against TWO
// independent sources (ctx7 `/websites/developers_facebook_graph-api` docs
// command AND a direct WebFetch of developers.facebook.com/docs/graph-api/
// guides/error-handling/ — both returned the identical shape):
// { error: { message, type, code, error_subcode, error_user_title,
// error_user_msg, fbtrace_id } }. Classifies for LOGGING/audit only — this
// does NOT decide whether to retry (that stays attempt-count-gated in
// cmdPublishSocial, see isRetryCeilingReached below).
export type GraphApiErrorKind = 'rate_limit' | 'auth' | 'declined' | 'unknown';

// Rate-limit family, verified-live 2026-08-12:
//   4, 17, 341, 368, 506 — developers.facebook.com/docs/graph-api/guides/
//     error-handling/ (WebFetch), Meta's own "transient, wait and retry" list.
//   32 AND 80001 — ctx7 docs on /websites/developers_facebook_graph-api,
//     Source: developers.facebook.com/docs/graph-api/overview/rate-limiting —
//     32 = "Page calls (User access token) limit reached"; 80001 = "Page
//     calls (Page/System User token) limit reached". Route B (addendum א׳)
//     means BOTH are live-relevant here, not just 80001: Facebook publishing
//     still uses a Page access token (80001), but Instagram publishing (Route
//     B, graph.instagram.com) uses an Instagram USER access token — 32 is the
//     one that applies to it. 80000/80004 (Ads Insights/Management BUC
//     limits) are documented alongside 80001 but are out of scope — this flow
//     never calls Ads endpoints.
//   613 — community cross-check only (not independently confirmed by ctx7 or
//     a direct WebFetch in this pass) — RE-VERIFY at implementation, kept
//     here as a plausible-but-unconfirmed entry, not asserted as fact.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 80001, 341, 368, 506, 613]);
// 190 (OAuthException, "access token has expired") — WebFetch + ctx7, both
// 2026-08-12. 102 ("API Session" — invalid/expired token or login status) —
// ctx7 only (Source: developers.facebook.com/docs/graph-api/guides/
// error-handling/), not independently cross-checked via WebFetch in this
// pass; kept as a second auth code since ctx7 quotes it from the same
// official page as 190.
const AUTH_ERROR_CODES = new Set([190, 102]);

export interface GraphApiErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export function classifyGraphApiError(body: GraphApiErrorBody | null): GraphApiErrorKind {
  const code = body?.error?.code;
  if (typeof code === 'number' && AUTH_ERROR_CODES.has(code)) return 'auth';
  if (typeof code === 'number' && RATE_LIMIT_CODES.has(code)) return 'rate_limit';
  if (body?.error) return 'declined';
  return 'unknown';
}

export function formatGraphApiError(body: GraphApiErrorBody | null, httpStatus: number): string {
  const err = body?.error;
  if (!err) return `Meta Graph API returned HTTP ${httpStatus} with no parseable error body`;
  const parts = [`code=${err.code ?? '?'}`];
  if (err.error_subcode) parts.push(`subcode=${err.error_subcode}`);
  if (err.type) parts.push(`type=${err.type}`);
  if (err.fbtrace_id) parts.push(`fbtrace_id=${err.fbtrace_id}`);
  return `Meta Graph API error [${classifyGraphApiError(body)}] (HTTP ${httpStatus}): ${err.message ?? 'no message'} [${parts.join(' ')}]`;
}

// Instagram container status polling (plan §4.6 step 2) — BOUNDED, never an
// infinite loop. Pure decision function: given the status_code Meta returned
// and how many polls have already happened, decide the next action. The
// actual wait/sleep loop lives in cmdPublishSocial (needs real timers); this
// stays testable without them.
export type ContainerPollDecision =
  | { action: 'publish' }
  | { action: 'wait' }
  | { action: 'fail'; reason: string };

// ~10 polls * 3s spacing = ~30s bounded wait, matching plan §4.6/§0's own
// estimate ("כמה שניות עד ~מספר עשרות שניות"). Tune at implementation if
// empirical FINISHED latency differs.
export const IG_CONTAINER_POLL_MAX_ATTEMPTS = 10;

export function decideContainerPoll(
  statusCode: string,
  attemptsSoFar: number,
): ContainerPollDecision {
  if (statusCode === 'FINISHED') return { action: 'publish' };
  if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
    return { action: 'fail', reason: `Instagram container status_code=${statusCode}` };
  }
  if (attemptsSoFar >= IG_CONTAINER_POLL_MAX_ATTEMPTS) {
    return {
      action: 'fail',
      reason: `Instagram container did not reach FINISHED within ${IG_CONTAINER_POLL_MAX_ATTEMPTS} polls (last status_code=${statusCode})`,
    };
  }
  return { action: 'wait' };
}

// §3.6 retry ceiling (plan social-publish-live-stage-plan.md §3.6/§9.2): after
// PUBLISH_RETRY_CEILING failed attempts, cmdPublishSocial refuses to re-claim
// the row for another live attempt — social-manager has no direct SQL access
// to fleet_social_posts (plan §3 point 9), so it cannot know attempt_count
// itself unless publish-social enforces (not just reports) this.
export const PUBLISH_RETRY_CEILING = 2;

export function isRetryCeilingReached(attemptCount: number): boolean {
  return attemptCount >= PUBLISH_RETRY_CEILING;
}

// Critical lesson from a live incident (2026-08-12): a Graph API id field
// read via `Number(...)` (or a JSON schema typed `number`) silently loses
// precision — Instagram container/media ids are commonly 17-digit numbers,
// well past Number.MAX_SAFE_INTEGER's ~15-16 reliable digits. Meta's own
// convention is to always return id-shaped fields as JSON STRINGS specifically
// to avoid this (verified live: ctx7's sample container-create response is
// `{"id": "<IG_CONTAINER_ID>"}`, a quoted string, not a bare number) — so a
// `typeof value === 'number'` here means either the API contract changed or
// something upstream already coerced the value. Either way, treat it as
// absent rather than trust a precision-lossy read. Callers MUST use this (or
// an equivalent explicit string check) instead of `(json as {id?:string})?.id`
// casts, which only assert the type at compile time and would silently accept
// a runtime `number` too.
export function extractStringId(json: unknown, field: string): string | null {
  if (!json || typeof json !== 'object') return null;
  const value = (json as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
