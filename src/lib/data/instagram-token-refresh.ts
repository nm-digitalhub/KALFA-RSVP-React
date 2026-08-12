import 'server-only';

import { chmodSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  IG_LOGIN_GRAPH_API_BASE,
  classifyGraphApiError,
  extractStringId,
  formatGraphApiError,
  type GraphApiErrorBody,
  type GraphApiErrorKind,
} from '@/lib/fleet/publish-social';

// Instagram long-lived access-token self-refresh cron (worker/main.ts, weekly).
// Meta lets a long-lived Instagram User Access Token that is ≥24h old (and not
// yet expired) refresh itself with NO human OAuth step:
//   GET https://graph.instagram.com/refresh_access_token
//     ?grant_type=ig_refresh_token&access_token=<token>
// which returns a fresh token valid for another 60 days (verified live
// 2026-08-12 via ctx7 /websites/developers_facebook_instagram-platform — see
// this file's tests for the exact response shape cited). Without this, the
// token minted today (~09:40, Instagram Login flow) silently expires in 60
// days and publish-social (fleet-agent-cli.ts) starts failing every call.
//
// STATE LIVES IN .env.local, NOT app_settings. publish-social's live path
// reads META_IG_ACCESS_TOKEN from a FRESH process on every invocation
// (`node --env-file=.env.local dist/fleet-agent-cli.cjs …` — see
// .claude/fleet/bin/{scheduler.mjs,run-context.sh,main-inbox.sh}), never from
// this long-lived worker's own process.env, so rewriting the file is both
// necessary (the worker's own env is stale the moment it started) and
// sufficient (every consumer re-reads the file per-invocation). app_settings
// has no column for this and adding one is a schema change outside this
// session's DB-write-free scope — .env.local is the only place ALL consumers
// actually read, so splitting expiry tracking into a DB row nothing reads
// would be worse, not just out of scope. If admin-dashboard visibility of the
// expiry is later wanted, a migration can add app_settings.meta_ig_token_expires_at
// and this module's write can be pointed there instead.
//
// VERIFY-THEN-WRITE, not the reverse: the refreshed token is checked against
// GET /me BEFORE it is written to .env.local. A refresh that returns something
// unusable must never overwrite a token that was still working — Meta does not
// revoke the OLD token on refresh, so declining to write on a bad verify simply
// leaves the previously-working credential in place.
//
// NEVER throws — every branch alerts (or silently no-ops for a benign/transient
// outcome) and returns; worker/main.ts's guardedWorker wrapper is defense-in-
// depth only, matching every other cron in this file's family
// (voximplant-balance.ts, elevenlabs-quota.ts, vox-log-export.ts). The token
// itself is NEVER logged or put in a Slack field — only counts/ids/days.

const TOKEN_KEY = 'META_IG_ACCESS_TOKEN';
const EXPIRES_AT_KEY = 'META_IG_ACCESS_TOKEN_EXPIRES_AT';

const REFRESH_ENDPOINT = 'https://graph.instagram.com/refresh_access_token';
const VERIFY_ENDPOINT = `${IG_LOGIN_GRAPH_API_BASE}/me`;
const FETCH_TIMEOUT_MS = 10_000;

const DAY_MS = 86_400_000;
// The "second protection" layer (plan item 2): alert when fewer than this many
// days remain before expiry no matter WHY (a real credential problem the
// weekly per-failure alert already covers, silently missed alerts, etc.) — a
// last-resort net independent of whether any single refresh attempt succeeded.
const EXPIRY_WARNING_DAYS = 14;

const RECOVERY_HINT =
  'נדרש OAuth מחודש — קישור ההרשאה אצל team-lead; כ-5 דקות עבודה';

// ── env-file parsing / rewriting (pure — no IO) ─────────────────────────────

const ENV_LINE_RE = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

// Mirrors worker/main.ts's own loadEnv() quote-stripping so a value written by
// one and read by the other agree on the same convention.
function unquote(raw: string): string {
  const v = raw.trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  return v;
}

export function readEnvVar(content: string, key: string): string | null {
  for (const line of content.split('\n')) {
    const m = line.match(ENV_LINE_RE);
    if (m && m[1] === key) return unquote(m[2]);
  }
  return null;
}

// Rewrite/append KEY=VALUE lines, preserving every OTHER line byte-for-byte
// (order, blank lines, comments, quoting on lines we don't touch) and the
// file's trailing-newline convention. A key already present is replaced in
// place (unquoted — the values written here, an access token and an ISO
// timestamp, never contain characters that require quoting); a key absent
// from the file is appended at the end.
export function rewriteEnvVars(content: string, updates: Record<string, string>): string {
  const remaining = new Map(Object.entries(updates));
  const hadTrailingNewline = content.endsWith('\n');
  const lines = content === '' ? [] : content.split('\n');
  if (hadTrailingNewline) lines.pop(); // drop split()'s trailing empty element

  const out = lines.map((line) => {
    const m = line.match(ENV_LINE_RE);
    if (m && remaining.has(m[1])) {
      const value = remaining.get(m[1]) as string;
      remaining.delete(m[1]);
      return `${m[1]}=${value}`;
    }
    return line;
  });
  const appended = remaining.size > 0;
  for (const [key, value] of remaining) out.push(`${key}=${value}`);

  return out.join('\n') + (hadTrailingNewline || appended ? '\n' : '');
}

// ── Meta response parsing (pure — no IO) ────────────────────────────────────

export interface ParsedRefreshSuccess {
  accessToken: string;
  expiresInSeconds: number;
}

// Meta documents access_token as a String and expires_in as an Integer
// (verified live via ctx7, /websites/developers_facebook_instagram-platform,
// 2026-08-12 — response example `{"access_token":"c3oxd...","token_type":
// "bearer","expires_in":5183944}`). Checked with `typeof`, never coerced via
// Number()/String() — the same discipline publish-social.ts's extractStringId
// documents for id-shaped fields (a live incident there: coercing an
// unexpected shape silently accepted it instead of surfacing it as
// unparseable). Applied here to the numeric field this endpoint promises: an
// unexpected shape must fail loudly (→ 'invalid response' alert), not get
// coerced into something that looks plausible.
export function parseRefreshSuccessBody(json: unknown): ParsedRefreshSuccess | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) return null;
  if (typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
    return null;
  }
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
}

// GET /me's documented response shape is ambiguous between two ctx7 sources —
// one shows a flat object (`{"user_id":"…","username":"…"}`, "translates to
// GET /{user-id}"), another shows it wrapped (`{"data":[{"user_id":"…"}]}`).
// Accept either rather than guess which is live-accurate. `id`/`user_id` are
// both checked (Graph API's generic single-object convention uses `id`; this
// endpoint's own docs use `user_id`) — extractStringId only ever accepts a
// String, so a numeric id (which the field never should be, but see
// publish-social.ts's precision-loss lesson) is correctly treated as absent.
export function parseVerifyResponseId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const flat = extractStringId(json, 'user_id') ?? extractStringId(json, 'id');
  if (flat) return flat;
  const data = (json as { data?: unknown }).data;
  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === 'object') {
    return extractStringId(data[0], 'user_id') ?? extractStringId(data[0], 'id');
  }
  return null;
}

// The exact wording Meta returns for "token is younger than 24h" is NOT in the
// live docs (checked via both ctx7 and a direct WebFetch of the
// refresh_access_token reference page, 2026-08-12 — neither documents the
// error body for this specific case) and could not be verified against a real
// call (the token this job manages was minted ~09:40 today, so any real
// refresh attempt today WOULD hit this path — but a live Graph API call is out
// of scope for this session). This is therefore a best-effort heuristic, not a
// verified match: it matches on Meta's own stated numeric threshold ("24
// hours") appearing in the error message, which is more actual than a
// specific string is documented as. It is DELIBERATELY conservative — every
// wording this does NOT catch falls through to classifyGraphApiError() and
// gets alerted as a real failure (never silently skipped), so a missed match
// costs one avoidable Slack alert (dedup'd after the first), while a WRONG
// match would cost silent, unnoticed token decay. The first real occurrence
// (this cron's own first live run) teaches the exact wording; formatGraphApiError's
// full detail is included in that fallback alert specifically so it does.
const TOO_YOUNG_RE = /24\s*hours?/i;

export type RefreshFailureKind = 'too_young' | GraphApiErrorKind;

// classifyGraphApiError (code-based, documented) runs FIRST and wins whenever
// it recognizes the error as a rate limit — Meta's rate-limit messages
// routinely contain their OWN "24 hours" phrasing ("try again in 24 hours",
// "limit will reset in 24 hours"), which would otherwise false-positive
// against the text heuristic below and go SILENT instead of alerting. The
// too_young heuristic only gets a vote when the code-based classification did
// NOT already recognize the failure as something else specific.
export function classifyRefreshFailure(body: GraphApiErrorBody | null): RefreshFailureKind {
  const graphKind = classifyGraphApiError(body);
  if (graphKind === 'rate_limit') return graphKind;
  const message = body?.error?.message;
  if (typeof message === 'string' && TOO_YOUNG_RE.test(message)) return 'too_young';
  return graphKind;
}

// ── date math (pure) ────────────────────────────────────────────────────────

export function computeExpiresAtIso(expiresInSeconds: number, nowMs: number): string {
  return new Date(nowMs + expiresInSeconds * 1000).toISOString();
}

// Whole days remaining until `iso`, floored (a value that has already passed
// is negative, not clamped to 0 — callers compare against a threshold, not
// display it raw). null for an unparseable/absent timestamp — "unknown" is
// deliberately NOT "urgent"; a caller with no data must stay silent rather
// than alert on every first-ever run.
export function daysUntil(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - nowMs) / DAY_MS);
}

// ── env-file IO (atomic write, mode-preserving) ─────────────────────────────

// Reads the ORIGINAL file's permission bits so the rewritten file keeps them.
// .env.local holds live secrets (600, owner-only — verified live 2026-08-12);
// a plain writeFileSync()+rename would silently widen that to the process
// umask default (typically 644), and no gate in this repo would catch it. A
// stat failure (file vanished under us) falls back to 600 — the safe default
// for a secrets file, never the permissive one.
function currentMode(path: string): number {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return 0o600;
  }
}

// Write `content` to `path` atomically: a per-run temp file (pid+timestamp —
// collision-proof even without the singleton queue policy) is written, chmod'd
// to match the original file's mode, then renamed into place. Mirrors
// writeReportAtomic's write→rename→cleanup-on-failure shape
// (src/lib/voximplant/cli-support.ts) — no `force`-refusal concept here
// because overwriting IS the point.
function writeEnvFileAtomic(path: string, content: string, mode: number): void {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}-${Date.now()}.partial`);
  try {
    writeFileSync(tmp, content, 'utf8');
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw e;
  }
}

// ── Meta HTTP (thin — classification stays in the pure functions above) ────

interface GraphFetchResult {
  ok: boolean;
  status: number;
  json: unknown;
}

// Bounded, never throws — a transport failure (DNS/timeout/network) resolves
// to null, distinct from an HTTP-level error response (which still has a
// status + parseable body). Mirrors elevenFetch (elevenlabs-status.ts) /
// getAccountInfo's fail-safe shape, adapted to also carry the failure body so
// callers can classify it rather than only knowing "it failed".
async function graphFetch(url: string): Promise<GraphFetchResult | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return null;
  }
}

function isErrorBody(json: unknown): json is GraphApiErrorBody {
  return !!json && typeof json === 'object' && 'error' in json;
}

// ── orchestration ────────────────────────────────────────────────────────────

export async function runInstagramTokenRefresh(nowMs: number = Date.now()): Promise<void> {
  const envPath = join(process.cwd(), '.env.local');

  let content: string;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch (e) {
    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'instagram-token-refresh',
      title: 'רענון טוקן אינסטגרם — קריאת .env.local נכשלה',
      detail: e instanceof Error ? e.message : 'unknown error',
    });
    return;
  }

  const currentToken = readEnvVar(content, TOKEN_KEY);
  // The best-known expiry going into this run — used by the "second
  // protection" check below when this run's own refresh does not update it.
  let effectiveExpiresAtIso = readEnvVar(content, EXPIRES_AT_KEY);

  if (!currentToken) {
    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'instagram-token-refresh',
      title: 'רענון טוקן אינסטגרם — META_IG_ACCESS_TOKEN חסר',
      detail: `.env.local אינו מכיל ${TOKEN_KEY} — הרענון לא בוצע. ${RECOVERY_HINT}`,
    });
    return;
  }

  const refreshUrl = `${REFRESH_ENDPOINT}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(currentToken)}`;
  const refreshResult = await graphFetch(refreshUrl);

  if (!refreshResult) {
    // Transport failure only (DNS/timeout/network) — transient by nature; next
    // week's tick retries. NOT an alert on its own (would be indistinguishable
    // from a real outage on every blip); the "second protection" check below
    // still runs against the previously-known expiry.
    console.warn('[ig-token-refresh] refresh request failed (transport) — will retry next scheduled run');
  } else if (!refreshResult.ok || isErrorBody(refreshResult.json)) {
    const body = isErrorBody(refreshResult.json) ? refreshResult.json : null;
    const kind = classifyRefreshFailure(body);
    if (kind === 'too_young') {
      // Benign, expected on the very first run (token minted ~09:40 today) —
      // log and skip, no alert.
      console.log('[ig-token-refresh] refresh skipped — token is younger than 24h');
    } else {
      void sendSlackAlert({
        level: 'warn',
        category: 'send_health',
        source: 'instagram-token-refresh',
        title: 'רענון טוקן אינסטגרם נכשל',
        detail: `${formatGraphApiError(body, refreshResult.status)} — ${RECOVERY_HINT}`,
        fields: { httpStatus: refreshResult.status, kind },
      });
    }
  } else {
    const parsed = parseRefreshSuccessBody(refreshResult.json);
    if (!parsed) {
      void sendSlackAlert({
        level: 'error',
        category: 'send_health',
        source: 'instagram-token-refresh',
        title: 'רענון טוקן אינסטגרם — תגובה לא תקינה',
        detail: `תגובת ההצלחה חסרה access_token/expires_in תקינים — לא בוצע שינוי ב-.env.local. ${RECOVERY_HINT}`,
      });
    } else {
      // VERIFY before WRITE: confirm the new token actually works before it
      // ever reaches .env.local. The old token is untouched by Meta's own
      // refresh call, so declining to write here leaves a working credential
      // in place rather than risking one that only LOOKS refreshed.
      const verifyUrl = `${VERIFY_ENDPOINT}?fields=user_id,username&access_token=${encodeURIComponent(parsed.accessToken)}`;
      const verifyResult = await graphFetch(verifyUrl);
      const verifiedId = verifyResult?.ok ? parseVerifyResponseId(verifyResult.json) : null;

      if (!verifiedId) {
        void sendSlackAlert({
          level: 'warn',
          category: 'send_health',
          source: 'instagram-token-refresh',
          title: 'רענון טוקן אינסטגרם — אימות נכשל',
          detail: 'הרענון החזיר טוקן חדש, אך האימות מול /me נכשל — הטוקן הקודם נשאר ב-.env.local ללא שינוי (עדיין בתוקף).',
        });
      } else {
        const newExpiresAtIso = computeExpiresAtIso(parsed.expiresInSeconds, nowMs);
        try {
          const mode = currentMode(envPath);
          const updated = rewriteEnvVars(content, {
            [TOKEN_KEY]: parsed.accessToken,
            [EXPIRES_AT_KEY]: newExpiresAtIso,
          });
          writeEnvFileAtomic(envPath, updated, mode);
          effectiveExpiresAtIso = newExpiresAtIso;
          console.log(
            `[ig-token-refresh] refreshed successfully — expires in ${daysUntil(newExpiresAtIso, nowMs) ?? '?'} days`,
          );
        } catch (e) {
          void sendSlackAlert({
            level: 'error',
            category: 'send_health',
            source: 'instagram-token-refresh',
            title: 'רענון טוקן אינסטגרם — כתיבת .env.local נכשלה',
            detail: `${e instanceof Error ? e.message : 'unknown error'} — הרענון הצליח מול Meta אך לא נשמר. ${RECOVERY_HINT}`,
          });
        }
      }
    }
  }

  // Second protection, unconditional (plan item 2): whatever happened above,
  // warn when the best-known expiry is under the threshold — catches
  // repeated silent-ish failures that each individually alerted but where
  // nobody acted, BEFORE the token actually dies. Silent when unknown (no
  // prior successful refresh/verify AND this run didn't produce one — e.g. a
  // first-ever run that also hit 'too_young').
  const daysLeft = daysUntil(effectiveExpiresAtIso, nowMs);
  if (daysLeft !== null && daysLeft < EXPIRY_WARNING_DAYS) {
    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'instagram-token-refresh',
      title: 'טוקן אינסטגרם מתקרב לתפוגה',
      detail: `נותרו ${daysLeft} ימים בלבד עד לתפוגת הטוקן, למרות ניסיונות הרענון. ${RECOVERY_HINT}`,
      fields: { daysLeft },
    });
  }
}
