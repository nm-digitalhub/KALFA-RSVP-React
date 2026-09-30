import 'server-only';

import { isDefinitelyNotSentError, sendWithMetaRetry, type DeliveryOutcome } from '@/lib/whatsapp/client';

import type { GraphSendResponse, OwnerAgentInteractive, OwnerAgentWhatsApp } from './adapter';

// Owner-agent senders over the adapter (plan §4.1, §4.3, §4.5, §9.2). Every one
// returns our DeliveryOutcome, never throws, and keeps the at-most-once rule of
// client.ts: ONLY a Meta error code in DEFINITELY_NOT_SENT_CODES (or a local
// check that stopped us before any request) is `definitely_not_sent`.
// Everything else — a throw, a timeout, a 2xx without a message id, a code not
// on the list (130429 throttling, …) — is `unknown`, and the caller never
// resends on unknown.
//
// The adapter throws WhatsAppApiError on a non-2xx (dist:2146-2154) where
// whatsapp-api-js returns the error body — hence the mapping here instead of
// client.ts:classifyResponse. Matched by name + numeric errorCode, not
// instanceof: `chat`/`@chat-adapter/shared` also exist as a transitive copy
// under @mastra/core, and a second copy's class would fail instanceof.
//
// Reasons are fixed strings and numbers only. Never e.message: the adapter's
// message carries Meta's summary text (dist:407-409).
//
// `to` is always the caller's — the gate's verified recipient. The adapter's
// recipient() state lookup is bypassed (adapter.ts).

const DEFAULT_SEND_TIMEOUT_MS = 15_000;
const TYPING_TIMEOUT_MS = 5_000;

// Cloud API limits (plan §4.3 + §8.6, verified against Meta 27.9). Counted in
// code points, so an emoji is one character.
export const WA_LIMITS = {
  textBody: 4096,
  buttonsMax: 3,
  buttonTitle: 20,
  buttonId: 256,
  buttonBody: 1024,
  headerText: 60,
  footerText: 60,
  listBody: 4096,
  listButtonText: 20,
  listSectionsMax: 10,
  listSectionTitle: 24,
  listRowsTotal: 10,
  listRowTitle: 24,
  listRowDescription: 72,
  listRowId: 200,
} as const;

// With or without '+', 7-15 digits. Never a BSUID shape ("XX.…"), so the
// adapter can only ever put it in `to`.
const RECIPIENT_RE = /^\+?[1-9][0-9]{6,14}$/;
const WAMID_RE = /^[A-Za-z0-9._=+/:-]{1,1024}$/;

function chars(s: string): number {
  return [...s].length;
}

function notSent(reason: string): DeliveryOutcome {
  return { kind: 'definitely_not_sent', reason };
}

interface GraphErrorLike {
  name?: unknown;
  errorCode?: unknown;
  status?: unknown;
  /** The parsed body; Meta's `error.is_transient` lives there (adapter keeps it verbatim). */
  raw?: unknown;
}

// Exported for the tests; the send functions are the API.
export function classifyAdapterThrow(e: unknown): DeliveryOutcome {
  const err = (typeof e === 'object' && e !== null ? e : {}) as GraphErrorLike;
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (err.name === 'WhatsAppApiError' && typeof err.errorCode === 'number') {
    const providerCode = String(err.errorCode);
    const raw = (typeof err.raw === 'object' && err.raw !== null ? err.raw : {}) as {
      error?: { is_transient?: unknown } | null;
    };
    return isDefinitelyNotSentError({ code: err.errorCode, isTransient: raw.error?.is_transient })
      ? { kind: 'definitely_not_sent', reason: 'provider_rejected', providerStatus: status, providerCode }
      : { kind: 'unknown', reason: 'provider_error', providerStatus: status, providerCode, retryable: true };
  }
  if (err.name === 'WhatsAppApiError') {
    return { kind: 'unknown', reason: 'provider_error', providerStatus: status };
  }
  return { kind: 'unknown', reason: 'send_threw' };
}

class SendTimeout extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SendTimeout('deadline')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

// A request that may already have left: timeout ⇒ unknown, never retried.
async function attemptOnce(work: () => Promise<string | null | undefined>, timeoutMs: number): Promise<DeliveryOutcome> {
  try {
    const providerId = await withDeadline(work(), timeoutMs);
    return providerId
      ? { kind: 'accepted', providerId }
      : { kind: 'unknown', reason: 'missing_message_id' };
  } catch (e) {
    if (e instanceof SendTimeout) return { kind: 'unknown', reason: 'timeout' };
    return classifyAdapterThrow(e);
  }
}

// Meta's documented retry (client.ts sendWithMetaRetry) for an error Meta marks
// `is_transient`, inside the call's own timeout: every attempt and every wait
// share `timeoutMs`, so a retried call never takes longer than one call could.
async function attempt(work: () => Promise<string | null | undefined>, timeoutMs: number): Promise<DeliveryOutcome> {
  const start = Date.now();
  return sendWithMetaRetry(
    () => attemptOnce(work, Math.max(1, timeoutMs - (Date.now() - start))),
    { budgetMs: timeoutMs },
  );
}

function idOf(res: GraphSendResponse | null | undefined): string | null {
  return res?.messages?.[0]?.id ?? null;
}

interface SendBase {
  to: string;
  replyToWamid?: string;
  timeoutMs?: number;
}

function checkBase(p: SendBase): string | null {
  if (!RECIPIENT_RE.test(p.to)) return 'invalid_recipient';
  if (p.replyToWamid !== undefined && !WAMID_RE.test(p.replyToWamid)) return 'invalid_context';
  return null;
}

export async function sendOwnerAgentText(
  wa: OwnerAgentWhatsApp,
  p: SendBase & { body: string },
): Promise<DeliveryOutcome> {
  const bad = checkBase(p);
  if (bad) return notSent(bad);
  if (p.body.trim() === '' || chars(p.body) > WA_LIMITS.textBody) return notSent('invalid_body');
  return attempt(() => wa.sendTextTo(p.to, p.body, p.replyToWamid), p.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);
}

export interface OwnerAgentButton {
  id: string;
  title: string;
}

interface InteractiveCommon extends SendBase {
  body: string;
  header?: string;
  footer?: string;
}

function checkHeaderFooter(p: InteractiveCommon): boolean {
  if (p.header !== undefined && (p.header.trim() === '' || chars(p.header) > WA_LIMITS.headerText)) return false;
  if (p.footer !== undefined && (p.footer.trim() === '' || chars(p.footer) > WA_LIMITS.footerText)) return false;
  return true;
}

function frame(p: InteractiveCommon): Pick<OwnerAgentInteractive, 'body' | 'header' | 'footer'> {
  return {
    body: { text: p.body },
    ...(p.header !== undefined ? { header: { type: 'text' as const, text: p.header } } : {}),
    ...(p.footer !== undefined ? { footer: { text: p.footer } } : {}),
  };
}

function uniqueIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

export async function sendOwnerAgentButtons(
  wa: OwnerAgentWhatsApp,
  p: InteractiveCommon & { buttons: readonly OwnerAgentButton[] },
): Promise<DeliveryOutcome> {
  const bad = checkBase(p);
  if (bad) return notSent(bad);
  const ok =
    p.body.trim() !== '' &&
    chars(p.body) <= WA_LIMITS.buttonBody &&
    checkHeaderFooter(p) &&
    p.buttons.length >= 1 &&
    p.buttons.length <= WA_LIMITS.buttonsMax &&
    uniqueIds(p.buttons.map((b) => b.id)) &&
    // Meta also requires the button titles to be unique within one message
    // (interactive reply buttons reference, read 2026-09-30).
    uniqueIds(p.buttons.map((b) => b.title.trim())) &&
    p.buttons.every(
      (b) =>
        b.id !== '' &&
        chars(b.id) <= WA_LIMITS.buttonId &&
        b.title.trim() !== '' &&
        chars(b.title) <= WA_LIMITS.buttonTitle,
    );
  if (!ok) return notSent('invalid_interactive');
  const interactive: OwnerAgentInteractive = {
    ...frame(p),
    type: 'button',
    action: { buttons: p.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
  };
  return attempt(
    () => wa.sendInteractiveTo(p.to, interactive, p.replyToWamid),
    p.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS,
  );
}

export interface OwnerAgentListRow {
  id: string;
  title: string;
  description?: string;
}

export interface OwnerAgentListSection {
  title: string;
  rows: readonly OwnerAgentListRow[];
}

export async function sendOwnerAgentList(
  wa: OwnerAgentWhatsApp,
  p: InteractiveCommon & { buttonText: string; sections: readonly OwnerAgentListSection[] },
): Promise<DeliveryOutcome> {
  const bad = checkBase(p);
  if (bad) return notSent(bad);
  const rows = p.sections.flatMap((s) => s.rows);
  const ok =
    p.body.trim() !== '' &&
    chars(p.body) <= WA_LIMITS.listBody &&
    checkHeaderFooter(p) &&
    p.buttonText.trim() !== '' &&
    chars(p.buttonText) <= WA_LIMITS.listButtonText &&
    p.sections.length >= 1 &&
    p.sections.length <= WA_LIMITS.listSectionsMax &&
    p.sections.every(
      (s) => s.rows.length >= 1 && s.title.trim() !== '' && chars(s.title) <= WA_LIMITS.listSectionTitle,
    ) &&
    rows.length <= WA_LIMITS.listRowsTotal &&
    uniqueIds(rows.map((r) => r.id)) &&
    rows.every(
      (r) =>
        r.id !== '' &&
        chars(r.id) <= WA_LIMITS.listRowId &&
        r.title.trim() !== '' &&
        chars(r.title) <= WA_LIMITS.listRowTitle &&
        (r.description === undefined || chars(r.description) <= WA_LIMITS.listRowDescription),
    );
  if (!ok) return notSent('invalid_interactive');
  const interactive: OwnerAgentInteractive = {
    ...frame(p),
    type: 'list',
    action: {
      button: p.buttonText,
      sections: p.sections.map((s) => ({
        title: s.title,
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description !== undefined ? { description: r.description } : {}),
        })),
      })),
    },
  };
  return attempt(
    () => wa.sendInteractiveTo(p.to, interactive, p.replyToWamid),
    p.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS,
  );
}

export async function sendOwnerAgentReaction(
  wa: OwnerAgentWhatsApp,
  p: { to: string; wamid: string; emoji: string; timeoutMs?: number },
): Promise<DeliveryOutcome> {
  if (!RECIPIENT_RE.test(p.to)) return notSent('invalid_recipient');
  if (!WAMID_RE.test(p.wamid)) return notSent('invalid_context');
  const n = chars(p.emoji);
  if (n < 1 || n > 10 || p.emoji.trim() === '') return notSent('invalid_emoji');
  return attempt(async () => idOf(await wa.sendReactionTo(p.to, p.wamid, p.emoji)), p.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);
}

export async function removeOwnerAgentReaction(
  wa: OwnerAgentWhatsApp,
  p: { to: string; wamid: string; timeoutMs?: number },
): Promise<DeliveryOutcome> {
  if (!RECIPIENT_RE.test(p.to)) return notSent('invalid_recipient');
  if (!WAMID_RE.test(p.wamid)) return notSent('invalid_context');
  return attempt(async () => idOf(await wa.sendReactionTo(p.to, p.wamid, '')), p.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);
}

export type TypingResult = { kind: 'ok' } | { kind: 'failed'; code: string };

// "Read" + "typing…" on one inbound wamid (plan §4.1). Never throws and never
// changes the caller's flow: a failure is a code for the audit, nothing more.
// Meta clears the indicator after 25s or with our reply.
export async function markReadWithTyping(
  wa: OwnerAgentWhatsApp,
  wamid: string,
  timeoutMs: number = TYPING_TIMEOUT_MS,
): Promise<TypingResult> {
  if (!WAMID_RE.test(wamid)) return { kind: 'failed', code: 'typing_invalid_wamid' };
  try {
    const res = await withDeadline(wa.markReadWithTyping(wamid), timeoutMs);
    return res?.success === true ? { kind: 'ok' } : { kind: 'failed', code: 'typing_not_acknowledged' };
  } catch (e) {
    if (e instanceof SendTimeout) return { kind: 'failed', code: 'typing_timeout' };
    const outcome = classifyAdapterThrow(e);
    const code = outcome.kind === 'accepted' ? undefined : outcome.providerCode;
    return { kind: 'failed', code: code ? `typing_provider_${code}` : 'typing_threw' };
  }
}

// ── Follow-up button ids ───────────────────────────────────────────────────
// An opaque nonce: `oa:fu:<intakeId>:<n>`. The id carries no text, identity,
// recipient or permission — the consumer resolves it against the intake row
// (owner, not expired, not used, context.id = our wamid). decode checks SHAPE
// only; a well-formed id proves nothing (the staff member's client can send
// any id — the adapter itself turns any string into an action, dist:37-43).

const FOLLOWUP_PREFIX = 'oa:fu:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FOLLOWUP_RE = /^oa:fu:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9])$/;
export const FOLLOWUP_MAX = WA_LIMITS.listRowsTotal; // n ∈ [0, 9]

export class FollowupIdError extends Error {
  constructor() {
    super('invalid_followup_id');
    this.name = 'FollowupIdError';
  }
}

export function encodeFollowupId(intakeId: string, n: number): string {
  const id = intakeId.toLowerCase();
  if (!UUID_RE.test(id) || !Number.isInteger(n) || n < 0 || n >= FOLLOWUP_MAX) throw new FollowupIdError();
  return `${FOLLOWUP_PREFIX}${id}:${n}`;
}

export function decodeFollowupId(raw: string): { intakeId: string; n: number } | null {
  const m = FOLLOWUP_RE.exec(raw);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { intakeId: m[1], n: Number(m[2]) };
}
