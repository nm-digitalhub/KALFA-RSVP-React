import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { KnownBlock, MrkdwnElement, PlainTextElement } from '@slack/types';
import {
  ErrorCode,
  IncomingWebhook,
  type IncomingWebhookHTTPError,
  type IncomingWebhookSendArguments,
  type RetryOptions,
} from '@slack/webhook';

import { rateLimit } from '@/lib/security/rate-limit';

// Central, fail-safe, PII-safe Slack notifier for internal ops alerting.
//
// CALLERS MUST PASS NON-PII ONLY. This module alerts an internal ops channel
// about operational faults (provider outages, worker/job failures, unhandled
// server errors). Do NOT pass guest names, phone numbers, RSVP content, tokens,
// or message bodies. Use ids (campaign_id / contact_id / event_id) and provider
// error codes. A light redaction pass below is DEFENSE-IN-DEPTH, not a licence
// to pass personal data.
//
// FAIL-SAFE: sendSlackAlert NEVER throws into the caller and NEVER blocks it for
// long — a missing/empty webhook URL is a silent no-op, any send failure is
// swallowed (logged without secrets), and the send is bounded by a short
// timeout so a hung request cannot stall the caller.
//
// Importable by BOTH the Next.js server and the esbuild worker bundle: the
// worker aliases `server-only` to an empty stub (see worker/main.ts header), so
// the `server-only` import matches repo convention and is inert there.

export type SlackAlertLevel = 'error' | 'warn' | 'info';

export interface SlackAlertInput {
  level: SlackAlertLevel;
  title: string;
  detail?: string;
  source?: string;
  fields?: Record<string, string | number>;
  // When true, the message pings the channel (@here). Left OFF everywhere for
  // now; Phase 3's admin UI will drive it per alert category. The code path
  // exists and is typed so wiring it later is additive.
  mention?: boolean;
}

// Hard bound on the send so a slow/hung Slack request never stalls the caller.
const SEND_TIMEOUT_MS = 3_000;

// Short retry for TRANSIENT failures (5xx / network blip) — deliberately tiny so
// all attempts finish WELL inside the SEND_TIMEOUT_MS outer race. The library's
// bundled policies (fiveRetriesInFiveMinutes / tenRetriesInAboutThirtyMinutes)
// run for minutes and would be wasteful under a fault storm; the 3s cap in
// trySend stays the hard bound regardless.
const RETRY_CONFIG: RetryOptions = { retries: 2, factor: 2, minTimeout: 250, maxTimeout: 1_000 };

// Slack attachment left-border color per level (KALFA/Slack brand hues).
function levelColor(level: SlackAlertLevel): string {
  if (level === 'error') return '#E01E5A';
  if (level === 'warn') return '#ECB22E';
  return '#36C5F0';
}

// Per-key dedup: an identical (level|title|source) alert within this window is
// suppressed (counted, not sent); the next send after the window carries a
// "(+N suppressed)" note with the previous window's suppressed count.
const DEDUP_WINDOW_MS = 60_000;

// Global cap: at most this many alerts per minute across ALL keys, so a broad
// fault storm can never flood the channel (or the network). Reuses the shared
// per-process fixed-window limiter (src/lib/security/rate-limit).
const GLOBAL_MAX_PER_MIN = 30;
const GLOBAL_RATE_KEY = 'slack-alert:global';

interface DedupState {
  windowStart: number;
  suppressed: number;
}

// Per-process, in-memory. The web and worker run as SEPARATE processes, so each
// keeps its own dedup/rate state — acceptable for best-effort ops alerting.
const dedup = new Map<string, DedupState>();

// Dedup keys embed variable text (title/source), so without pruning the map
// would grow unbounded in a long-lived process. Opportunistically drop entries
// whose window has fully expired once the map crosses this small threshold
// (mirrors pruneExpired in src/lib/security/rate-limit.ts). Kept
// O(1)-amortized: the sweep only runs when the map has grown past the bound.
const DEDUP_PRUNE_THRESHOLD = 256;

function pruneExpiredDedup(now: number): void {
  for (const [key, state] of dedup) {
    if (now - state.windowStart >= DEDUP_WINDOW_MS) dedup.delete(key);
  }
}

// --- PII redaction (defense-in-depth) --------------------------------------

// Israeli phone-like sequences: optional +972 or a leading 0, then 8-9 more
// digits with optional space/dot/hyphen separators. Masks numbers a caller
// accidentally embedded in a title/detail/field. The `(?<![\w-])` / `(?![\w-])`
// boundaries require the sequence to stand alone (not be a segment of a longer
// hyphen-joined token), so UUIDs like `...-8000-000000000000` are NOT masked.
const IL_PHONE_RE = /(?<![\w-])(?:\+?972[-\s.]?|0)(?:\d[-\s.]?){7,9}\d(?![\w-])/g;

// Token-like strings: a continuous run of >=24 word chars (letters/digits/_)
// containing BOTH a letter and a digit — matches access tokens / JWT segments.
// Hyphen is excluded from the class so UUIDs (hyphen-separated, <=12-char
// segments) are NOT masked and stay useful for debugging.
const TOKENISH_RE = /(?=[A-Za-z0-9_]*[A-Za-z])(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{24,}/g;

// Email addresses: masks a personal identifier a caller may have embedded in a
// title/detail/field (e.g. a DB constraint message, a Zod error).
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

function redact(value: string): string {
  return value
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(IL_PHONE_RE, '[redacted-phone]')
    .replace(TOKENISH_RE, '[redacted-token]');
}

// --- deploy id (optional environment label) --------------------------------

let deployIdCache: string | null | undefined;

// The deploy writes a fresh id to `.deploy-id` at the repo root before building
// (see next.config.ts / version-skew-protection). Read it best-effort for the
// environment label; absent (dev / verification builds) → simply omitted.
function readDeployId(): string | null {
  if (deployIdCache !== undefined) return deployIdCache;
  try {
    const id = readFileSync(join(process.cwd(), '.deploy-id'), 'utf8').trim();
    deployIdCache = id || null;
  } catch {
    deployIdCache = null;
  }
  return deployIdCache;
}

// --- dedup / rate-limit -----------------------------------------------------

function dedupCheck(key: string, now: number): { send: boolean; suppressedFromPrev: number } {
  // Opportunistic cleanup before we potentially add a fresh entry.
  if (dedup.size >= DEDUP_PRUNE_THRESHOLD) pruneExpiredDedup(now);
  const state = dedup.get(key);
  if (!state || now - state.windowStart >= DEDUP_WINDOW_MS) {
    // First alert for this key, or the previous window has expired: open a fresh
    // window and carry forward how many were suppressed in the previous one.
    const suppressedFromPrev = state ? state.suppressed : 0;
    dedup.set(key, { windowStart: now, suppressed: 0 });
    return { send: true, suppressedFromPrev };
  }
  // Inside the active window: suppress and count.
  state.suppressed += 1;
  return { send: false, suppressedFromPrev: 0 };
}

// --- message composition ----------------------------------------------------

function levelEmoji(level: SlackAlertLevel): string {
  if (level === 'error') return '\u{1F534}'; // 🔴
  if (level === 'warn') return '\u{1F7E0}'; // 🟠
  return '\u{1F535}'; // 🔵
}

function mrkdwn(text: string): MrkdwnElement {
  return { type: 'mrkdwn', text };
}
function plain(text: string): PlainTextElement {
  return { type: 'plain_text', text, emoji: true };
}

// Build the full Slack payload: a plain-text fallback (notifications /
// accessibility / non-block clients) PLUS a Block Kit layout rendered inside a
// per-severity colored attachment. Every user-supplied string is redacted.
function compose(input: SlackAlertInput, suppressedFromPrev: number): IncomingWebhookSendArguments {
  const deployId = readDeployId();
  const env = process.env.NODE_ENV ?? 'unknown';
  const contextText =
    `env: ${env}${deployId ? ` · ${deployId}` : ''} · ${new Date().toISOString()}` +
    (suppressedFromPrev > 0 ? ` · (+${suppressedFromPrev} suppressed)` : '');

  // Plain-text fallback.
  const textLines: string[] = [`${levelEmoji(input.level)} ${redact(input.title)}`];
  if (input.source) textLines.push(`source: ${redact(input.source)}`);
  if (input.detail) textLines.push(redact(input.detail));
  if (input.fields) {
    for (const [k, v] of Object.entries(input.fields)) textLines.push(`${k}: ${redact(String(v))}`);
  }
  textLines.push(contextText);
  const text = textLines.join('\n');

  // Block Kit layout: header + a fields section + a context footer.
  const blocks: KnownBlock[] = [
    // Header text is plain_text; Slack caps it at 150 chars.
    { type: 'header', text: plain(`${levelEmoji(input.level)} ${redact(input.title)}`.slice(0, 150)) },
  ];
  const sectionFields: MrkdwnElement[] = [];
  if (input.source) sectionFields.push(mrkdwn(`*source:*\n${redact(input.source)}`));
  if (input.detail) sectionFields.push(mrkdwn(`*detail:*\n${redact(input.detail)}`));
  if (input.fields) {
    for (const [k, v] of Object.entries(input.fields)) {
      sectionFields.push(mrkdwn(`*${redact(k)}:*\n${redact(String(v))}`));
    }
  }
  // Slack allows at most 10 fields per section block.
  if (sectionFields.length > 0) blocks.push({ type: 'section', fields: sectionFields.slice(0, 10) });
  blocks.push({ type: 'context', elements: [mrkdwn(contextText)] });

  const payload: IncomingWebhookSendArguments = {
    text,
    attachments: [{ color: levelColor(input.level), blocks }],
    unfurl_links: false,
    unfurl_media: false,
  };
  // Config-ready mention path (OFF by default; Phase 3 admin UI will drive it):
  // ping the channel. `link_names` lets Slack resolve the `@here` mention.
  if (input.mention) {
    payload.link_names = true;
    payload.text = `<!here> ${text}`;
  }
  return payload;
}

// Format a send failure for the log — NO secrets/PII. For an HTTP error include
// the typed code + HTTP status (via ErrorCode); for a request error, the code.
function formatSendError(err: unknown): string {
  const base = err instanceof Error ? err.message : 'send failed';
  const code = (err as { code?: unknown }).code;
  if (code === ErrorCode.HTTPError) {
    const status = (err as IncomingWebhookHTTPError & { original?: { response?: { status?: number } } })
      .original?.response?.status;
    return `${base} [code=${ErrorCode.HTTPError}${status !== undefined ? ` status=${status}` : ''}]`;
  }
  if (code === ErrorCode.RequestError) return `${base} [code=${ErrorCode.RequestError}]`;
  return base;
}

// Send the payload, bounded by SEND_TIMEOUT_MS. Resolves either when the send
// completes, when it fails (logged, no secrets), or when the timeout elapses —
// NEVER rejects, and never leaves an unhandled rejection if the timeout wins.
function trySend(webhook: IncomingWebhook, payload: IncomingWebhookSendArguments, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    webhook.send(payload).then(
      () => finish(),
      (err: unknown) => {
        console.error('[slack-alert]', formatSendError(err));
        finish();
      },
    );
  });
}

/**
 * Post a NON-PII operational alert to the internal ops Slack channel.
 *
 * No-op when `SLACK_ALERT_WEBHOOK_URL` is unset/empty (dev/CI/tests stay
 * silent). Deduplicates identical (level|title|source) alerts within a 60s
 * window and caps total alerts per minute. FAIL-SAFE: never throws, never
 * blocks the caller beyond a short timeout.
 */
export async function sendSlackAlert(input: SlackAlertInput): Promise<void> {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL?.trim();
  if (!url) return; // No webhook configured → silent no-op.

  try {
    const now = Date.now();
    const key = `${input.level}|${input.title}|${input.source ?? ''}`;
    const { send, suppressedFromPrev } = dedupCheck(key, now);
    if (!send) return; // Duplicate within the dedup window → suppressed.

    if (!rateLimit(GLOBAL_RATE_KEY, { limit: GLOBAL_MAX_PER_MIN, windowMs: 60_000 }).allowed) {
      return; // Global per-minute cap reached → drop silently.
    }

    const payload = compose(input, suppressedFromPrev);
    // NOTE: Slack IGNORES username/icon_emoji/icon_url/channel on modern
    // app-based incoming webhooks — the bot's display name + icon are set in the
    // Slack app's Incoming Webhook settings (UI side), NOT here. Only `timeout`
    // and `retryConfig` take effect, so only those are set. Do NOT re-add
    // identity overrides — they would be silently dropped dead code.
    const webhook = new IncomingWebhook(url, { timeout: SEND_TIMEOUT_MS, retryConfig: RETRY_CONFIG });
    await trySend(webhook, payload, SEND_TIMEOUT_MS);
  } catch (err) {
    // FAIL-SAFE: swallow everything; never surface to the caller, never log a
    // secret or PII (only the error message text).
    console.error('[slack-alert]', err instanceof Error ? err.message : 'unexpected failure');
  }
}

/**
 * Test-only: clear the in-memory dedup state so each test starts clean.
 * (The global rate-limit window lives in the shared limiter and is not reset
 * here; GLOBAL_MAX_PER_MIN is high enough that the test suite never trips it.)
 */
export function __resetSlackAlertStateForTests(): void {
  dedup.clear();
  deployIdCache = undefined;
}

/** Test-only: current number of live dedup entries (to assert bounded growth). */
export function __dedupSizeForTests(): number {
  return dedup.size;
}
