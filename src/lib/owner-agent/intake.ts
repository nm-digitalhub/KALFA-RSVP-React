import 'server-only';

import { createHash } from 'node:crypto';

import { sendSlackAlert } from '@/lib/alerts/slack';
import type { WebhookInboxInsert } from '@/lib/data/webhooks';
import { isApprovalKind, overrideReasonCode, type ApprovalKind } from '@/lib/owner-agent/approval';
import { israelMidnightIso } from '@/lib/owner-agent/range';
import { normalizePhone } from '@/lib/phone';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES, type OwnerAgentReplyJob } from '@/lib/queue/queues';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

// The owner WhatsApp agent's side of the shared WhatsApp webhook
// (plans/owner-whatsapp-agent-plan.md §2.2–§2.3, §3.1, §3.7; "plan §4.x" below is
// plans/owner-agent-chat-sdk-capabilities-plan.md).
//
// THE INVARIANT this module exists to keep: guest traffic does not change. A
// message is diverted here only when BOTH hold —
//   1. the change's value.metadata.phone_number_id equals
//      app_settings.owner_agent_phone_number_id, and
//   2. its `from` is EXACTLY the E.164 of an ENABLED owner_agent_allowlist row —
//      or, for a message that carries NO `from` at all, its `from_user_id` is the
//      BSUID bound to such a row (bound from a signed message that carried both,
//      and still bound to the row's current phone; see §4 below).
// Every status, template-health event, other field, message on another number
// and message from anyone else stays on today's path, untouched. The route
// (src/app/api/webhooks/whatsapp/route.ts) calls in at these points:
//   getOwnerAgentRouting()      — beside the two existing app_settings reads;
//   planOwnerAgentDiversion()   — pure: which messages go to the agent;
//   withoutDivertedRows()       — the webhook_inbox rows minus those messages;
//   handleOwnerAgentRevocations() — clears the binding of a rotated BSUID (§4 below);
//   handleOwnerAgentMessages()  — the gate, the intake row, the enqueue, the
//                                 audit; only after the guests are persisted.
//
// FAILURE SHAPE. Nothing here can change the route's HTTP answer:
//   * a failed routing read returns null — no diversion, today's path — and
//     sends one ids-only alert;
//   * a failure while handling a diverted message sends one ids-only alert and
//     returns normally; the route still answers 200 and the staff member asks
//     again. (Never 503: on a shared route that would make Meta re-send guest
//     events too — §2.3.)
//
// PRIVACY. No phone, no message text, no payload and no error message leaves
// this module in a log, an alert or an audit row. Alerts and audit rows carry
// ids and codes only; `error.code` is used, never `error.message` (a PostgREST
// check violation quotes the failing row, which here holds the question).
// logActivity is not used: it needs a user session (activity.ts, requireUser), and the
// dependency rules keep this directory away from the session DAL. The audit
// trail for this surface is owner_agent_audit.
//
// The job enqueued here is read by the reply consumer (consumer/main.ts, on
// QUEUES.ownerAgentReply). No reply is sent to anyone from this module.

type AdminClient = ReturnType<typeof createAdminClient>;

/** One enabled allow-list row, as the router needs it. The e164 never leaves the server. */
export interface OwnerAgentAllowlistEntry {
  entryId: string;
  e164: string;
  /** null only for an external_override row (not platform staff). */
  staffUserId: string | null;
  /** Which gate applies (approval.ts). */
  approvalKind: ApprovalKind;
  /** The bound business-scoped user id (from_user_id), or null. Never logged. */
  bsuid: string | null;
  /** The phone the BSUID was bound from; a BSUID-only message needs it to equal e164. */
  boundFromE164: string | null;
}

/** The routing configuration for one POST. null (from the reader) = divert nothing. */
export interface OwnerAgentRouting {
  /** Meta phone_number_id of the number the agent answers on. */
  phoneNumberId: string;
  /** owner_agent_enabled — the kill switch. Off still diverts (§2.2), then gates. */
  enabled: boolean;
  dailyCap: number;
  /** owner_agent_burst_ms: delay before the reply job starts (0 = immediately). */
  burstMs: number;
  /** ENABLED rows only, keyed by their exact E.164. */
  allowlist: ReadonlyMap<string, OwnerAgentAllowlistEntry>;
  /** The ENABLED rows that have a bound BSUID, keyed by it. */
  bsuids: ReadonlyMap<string, OwnerAgentAllowlistEntry>;
}

/** A media attachment's Meta fields. The media itself is downloaded after the gate, never here. */
export interface OwnerAgentMedia {
  /** Meta media id (digits only — checked). */
  id: string;
  mime: string | null;
  sha256: string | null;
  /** document.filename, else null. */
  filename: string | null;
  /** audio.voice (a voice note), else null. */
  voice: boolean | null;
}

/**
 * Why a diverted message cannot become an intake row, decided purely from its
 * shape: a type the agent does not answer, or a value the intake CHECKs would
 * reject. Gated with this code — never a DB error.
 */
export type OwnerAgentPayloadError = 'unsupported_type' | 'invalid_payload';

/** A diverted message: ids, the matched row, and what it carries. */
export interface OwnerAgentMessage {
  wamid: string;
  phoneNumberId: string;
  entry: OwnerAgentAllowlistEntry;
  /** How the sender was identified: its `from` phone, or a bound BSUID (no `from`). */
  matchedBy: 'phone' | 'bsuid';
  type: string | null;
  /** text.body for a `text` message, else null. */
  text: string | null;
  /** image/document caption (stored as message_text), else null. */
  caption: string | null;
  media: OwnerAgentMedia | null;
  /** interactive button_reply/list_reply id+title, or a template button's payload+text. */
  interactive: { id: string; title: string | null } | null;
  location: { lat: number; lng: number; name: string | null; address: string | null } | null;
  /** A reaction's target wamid and emoji ('' / null = the reaction was removed). Never stored. */
  reaction: { messageId: string | null; emoji: string | null } | null;
  /** context.id — the wamid this message replies to. */
  contextWamid: string | null;
  /** from_user_id when it is a well-formed (non-parent) BSUID, else null. */
  fromUserId: string | null;
  payloadError: OwnerAgentPayloadError | null;
}

/**
 * A BSUID that Meta reported as rotated (user_id_update, or a system message
 * user_changed_user_id). Rotation revokes a binding; it never moves it. Which
 * row (if any) holds it is resolved at handling time against ALL allow-list
 * rows — a disabled row's binding is revoked too.
 */
export interface OwnerAgentBsuidRevocation {
  /** The value to clear wherever it is bound (CAS on it). */
  bsuid: string;
  reason: 'user_id_update' | 'user_changed_user_id';
  /** The system message's wamid; null for a user_id_update field. */
  wamid: string | null;
}

export interface OwnerAgentDiversion {
  /** The chosen number the diverted messages arrived on; null when nothing is diverted. */
  phoneNumberId: string | null;
  messages: readonly OwnerAgentMessage[];
  wamids: ReadonlySet<string>;
  /** Observed only: the events stay on the guest path exactly as today. */
  revocations: readonly OwnerAgentBsuidRevocation[];
}

export const NO_DIVERSION: OwnerAgentDiversion = Object.freeze({
  phoneNumberId: null,
  messages: Object.freeze([]) as readonly OwnerAgentMessage[],
  wamids: new Set<string>() as ReadonlySet<string>,
  revocations: Object.freeze([]) as readonly OwnerAgentBsuidRevocation[],
});

// Per allow-list row, per process — a first line only (rate-limit.ts:1-8). The
// daily cap below counts real rows and is the durable bound.
export const OWNER_AGENT_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

const ALERT_SOURCE = 'owner-agent';
const SETTINGS_COLUMNS =
  'owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap, owner_agent_burst_ms';

// ─── 1. The routing read ──────────────────────────────────────────────────────

/**
 * One read of app_settings (the four owner-agent columns only, never `*`) and,
 * only when a number is chosen, one read of the ENABLED allow-list rows.
 *
 * Returns null — divert nothing, today's path — when no number is chosen, when no
 * row is enabled, and on ANY error. An error also sends one ids-only alert, so a
 * broken read is visible instead of looking like an agent that never answers.
 * Never throws.
 */
export async function getOwnerAgentRouting(): Promise<OwnerAgentRouting | null> {
  let step: 'routing_settings' | 'routing_allowlist' = 'routing_settings';
  try {
    const admin = createAdminClient();
    const { data: settings, error } = await admin
      .from('app_settings')
      .select(SETTINGS_COLUMNS)
      .eq('id', true)
      .maybeSingle();
    if (error) return await routingReadFailed(step, error.code);

    const phoneNumberId = settings?.owner_agent_phone_number_id ?? null;
    if (!settings || !phoneNumberId) return null;

    step = 'routing_allowlist';
    const { data: rows, error: listError } = await admin
      .from('owner_agent_allowlist')
      .select('id, e164, staff_user_id, approval_kind, bsuid, bound_from_e164')
      .eq('enabled', true);
    if (listError) return await routingReadFailed(step, listError.code);

    const allowlist = new Map<string, OwnerAgentAllowlistEntry>();
    const bsuids = new Map<string, OwnerAgentAllowlistEntry>();
    for (const row of rows ?? []) {
      // An unknown kind (a value this code does not know) is never routed: fail closed.
      if (!isApprovalKind(row.approval_kind)) continue;
      const entry: OwnerAgentAllowlistEntry = {
        entryId: row.id,
        e164: row.e164,
        staffUserId: row.staff_user_id,
        approvalKind: row.approval_kind,
        bsuid: row.bsuid,
        boundFromE164: row.bound_from_e164,
      };
      allowlist.set(row.e164, entry);
      if (row.bsuid) bsuids.set(row.bsuid, entry);
    }
    // No enabled row: nothing can match, so do not make the caller read and verify
    // a body for nothing (the outreach-off branch).
    if (allowlist.size === 0) return null;

    return {
      phoneNumberId,
      enabled: settings.owner_agent_enabled === true,
      dailyCap: settings.owner_agent_daily_cap,
      burstMs:
        typeof settings.owner_agent_burst_ms === 'number' && settings.owner_agent_burst_ms > 0
          ? settings.owner_agent_burst_ms
          : 0,
      allowlist,
      bsuids,
    };
  } catch {
    return routingReadFailed(step, 'exception');
  }
}

async function routingReadFailed(step: string, code: string | undefined): Promise<null> {
  await sendSlackAlert({
    level: 'error',
    category: 'errors',
    source: ALERT_SOURCE,
    title: 'סוכן הבעלים — קריאת הניתוב נכשלה',
    detail:
      'לא הוסטה אף הודעה: כל התעבורה ממשיכה במסלול הרגיל של היום. הודעות של אנשי צוות מהרשימה לא יגיעו לסוכן עד שהקריאה תצליח.',
    fields: { step, code: code ?? 'unknown' },
  });
  return null;
}

// ─── 2. Which messages are diverted (pure) ────────────────────────────────────

// Meta's wa_id: the full international number without "+".
const WA_ID_RE = /^[1-9][0-9]{6,14}$/;

/**
 * The allow-list row this sender IS, or null.
 *
 * Exact identity, not "normalizes to": `'+' + from` must already be the valid
 * E.164 (normalizePhone returns it unchanged) and must be the row's key.
 *   - normalizePhone(from) without "+" defaults to IL and turns a foreign wa_id
 *     into an Israeli number: 508412345 (+508, Saint-Pierre) → +972508412345
 *     (plan §2.2, 5ד).
 *   - even with "+", normalizePhone strips a trunk zero, so 9720501234567 →
 *     +972501234567 (measured). Requiring the input to come back unchanged
 *     closes that too. Stricter only ever means "not diverted" — today's path.
 */
export function matchAllowlistedSender(
  from: unknown,
  allowlist: ReadonlyMap<string, OwnerAgentAllowlistEntry>,
): OwnerAgentAllowlistEntry | null {
  if (typeof from !== 'string' || !WA_ID_RE.test(from)) return null;
  const candidate = `+${from}`;
  if (normalizePhone(candidate) !== candidate) return null;
  return allowlist.get(candidate) ?? null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// A business-scoped user id: ISO country code, ".", up to 128 alphanumerics.
// The parent form (XX.ENT.…) is NOT an identity here (plan §4.7) — it never
// binds, never diverts and never revokes.
const BSUID_RE = /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/;

function bsuidOrNull(v: unknown): string | null {
  return typeof v === 'string' && BSUID_RE.test(v) ? v : null;
}

/**
 * The enabled row a message WITHOUT a `from` belongs to, by its bound BSUID, or
 * null. Only while the binding still points at the row's current phone: an
 * allow-list row whose phone changed after binding keeps no BSUID identity.
 */
export function matchBoundBsuid(
  fromUserId: unknown,
  bsuids: ReadonlyMap<string, OwnerAgentAllowlistEntry>,
): OwnerAgentAllowlistEntry | null {
  const bsuid = bsuidOrNull(fromUserId);
  if (!bsuid) return null;
  const entry = bsuids.get(bsuid);
  if (!entry || entry.bsuid !== bsuid || entry.boundFromE164 !== entry.e164) return null;
  return entry;
}

// The message types the gate admits (plan §4.2). Anything else — video, sticker,
// contacts, system, unknown, a future type — is unsupported_type. A reaction is
// handled before the type gate (audit only).
const ADMITTED_TYPES = new Set(['text', 'image', 'document', 'audio', 'location', 'interactive', 'button']);
const INTERACTIVE_REPLIES = new Set(['button_reply', 'list_reply']);

// The owner_agent_intake CHECKs (20260927011338), mirrored so that a value Meta
// sends in a shape they would reject is gated as invalid_payload, not a DB error.
const MEDIA_ID_RE = /^[0-9]{1,32}$/;
const MEDIA_SHA256_RE = /^[A-Za-z0-9+/=_-]{1,128}$/;

// char_length() counts code points; String#length counts UTF-16 units.
function codePoints(s: string): number {
  return [...s].length;
}

type Content = Pick<
  OwnerAgentMessage,
  'text' | 'caption' | 'media' | 'interactive' | 'location' | 'reaction' | 'contextWamid' | 'payloadError'
>;

/** What one message carries, validated against the intake CHECKs. Pure and total. */
function extractContent(message: Record<string, unknown>, type: string | null): Content {
  let invalid = false;
  // Optional free text: absent / null / '' → null; anything else must be a string within max.
  const optional = (v: unknown, max: number): string | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || codePoints(v) > max) {
      invalid = true;
      return null;
    }
    return v;
  };
  const block = (key: string): Record<string, unknown> | null => {
    const b = message[key];
    if (isRecord(b)) return b;
    invalid = true;
    return null;
  };

  const content: Content = {
    text: null,
    caption: null,
    media: null,
    interactive: null,
    location: null,
    reaction: null,
    contextWamid: null,
    payloadError: null,
  };
  const context = isRecord(message.context) ? message.context : null;
  content.contextWamid = optional(context?.id, 512);

  if (type === 'reaction') {
    const r = isRecord(message.reaction) ? message.reaction : null;
    content.reaction = {
      messageId: typeof r?.message_id === 'string' ? r.message_id : null,
      emoji: typeof r?.emoji === 'string' ? r.emoji : null,
    };
    return content; // never stored, so never invalid
  }
  if (type === null || !ADMITTED_TYPES.has(type)) {
    content.payloadError = 'unsupported_type';
    return content;
  }

  if (type === 'text') {
    const t = block('text');
    if (t && typeof t.body === 'string') content.text = t.body;
    else invalid = true;
  } else if (type === 'image' || type === 'document' || type === 'audio') {
    const m = block(type);
    if (m) {
      if (typeof m.id !== 'string' || !MEDIA_ID_RE.test(m.id)) invalid = true;
      const mime = optional(m.mime_type, 255);
      if (mime !== null && codePoints(mime) < 3) invalid = true;
      const sha256 = optional(m.sha256, 128);
      if (sha256 !== null && !MEDIA_SHA256_RE.test(sha256)) invalid = true;
      let voice: boolean | null = null;
      if (type === 'audio' && m.voice !== undefined && m.voice !== null) {
        if (typeof m.voice === 'boolean') voice = m.voice;
        else invalid = true;
      }
      content.media = {
        id: typeof m.id === 'string' ? m.id : '',
        mime,
        sha256,
        filename: type === 'document' ? optional(m.filename, 255) : null,
        voice,
      };
      // No length cap here: an over-long caption is text_length, like a text body.
      if (type !== 'audio' && m.caption !== undefined && m.caption !== null && m.caption !== '') {
        if (typeof m.caption === 'string') content.caption = m.caption;
        else invalid = true;
      }
    }
  } else if (type === 'location') {
    const l = block('location');
    if (l) {
      const { latitude: lat, longitude: lng } = l;
      if (
        typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180
      ) {
        invalid = true;
      } else {
        const name = optional(l.name, 1024);
        const address = optional(l.address, 1024);
        content.location = { lat, lng, name, address };
        const label = locationLabel(content.location);
        if (label !== null && codePoints(label) > 1024) invalid = true;
      }
    }
  } else if (type === 'interactive') {
    const i = block('interactive');
    if (i) {
      const kind = typeof i.type === 'string' ? i.type : null;
      // Flows (nfm_reply), call permission replies, … are not answered.
      if (kind === null || !INTERACTIVE_REPLIES.has(kind)) {
        return { ...content, payloadError: 'unsupported_type' };
      }
      const reply = isRecord(i[kind]) ? (i[kind] as Record<string, unknown>) : null;
      const id = optional(reply?.id, 1024);
      const title = optional(reply?.title, 256);
      if (id === null) invalid = true;
      else content.interactive = { id, title };
    }
  } else {
    // 'button': a template quick-reply tap.
    const b = block('button');
    if (b) {
      const id = optional(b.payload, 1024);
      const title = optional(b.text, 256);
      if (id === null) invalid = true;
      else content.interactive = { id, title };
    }
  }

  if (invalid) content.payloadError = 'invalid_payload';
  return content;
}

// owner_agent_intake.location_label: the place name and address, when Meta sent them.
function locationLabel(location: NonNullable<OwnerAgentMessage['location']>): string | null {
  const parts = [location.name, location.address].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** A system message that reports a rotated BSUID — observed, never diverted. */
function isUserIdChange(message: Record<string, unknown>): boolean {
  return message.type === 'system' && isRecord(message.system) && message.system.type === 'user_changed_user_id';
}

/**
 * Every BSUID that this delivery reports as rotated, on ANY number (a BSUID is
 * business-scoped, not number-scoped). Revoking is the fail-safe direction, so
 * every structured candidate counts: user_id.previous/current of a
 * user_id_update entry; from_user_id and system.user_id of a
 * user_changed_user_id message. system.body is never parsed — the sender's
 * profile name is inside it. Whether a candidate is bound is not known here
 * (the routing map holds enabled rows only); handleOwnerAgentRevocations asks.
 */
function collectRevocations(entries: readonly unknown[]): OwnerAgentBsuidRevocation[] {
  const revocations: OwnerAgentBsuidRevocation[] = [];
  const seen = new Set<string>();
  const add = (candidate: unknown, reason: OwnerAgentBsuidRevocation['reason'], wamid: string | null) => {
    const bsuid = bsuidOrNull(candidate);
    if (!bsuid || seen.has(bsuid)) return;
    seen.add(bsuid);
    revocations.push({ bsuid, reason, wamid });
  };
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      if (change.field === 'user_id_update') {
        // The adapter reads an array under value.user_id_update; Meta's reference
        // shows the entry itself as the value. Both are read.
        const updates = Array.isArray(value.user_id_update) ? value.user_id_update : [value];
        for (const update of updates) {
          if (!isRecord(update) || !isRecord(update.user_id)) continue;
          add(update.user_id.previous, 'user_id_update', null);
          add(update.user_id.current, 'user_id_update', null);
        }
      } else if (change.field === 'messages' && Array.isArray(value.messages)) {
        for (const message of value.messages) {
          if (!isRecord(message) || !isUserIdChange(message)) continue;
          const wamid = typeof message.id === 'string' && message.id !== '' ? message.id : null;
          add(message.from_user_id, 'user_changed_user_id', wamid);
          add((message.system as Record<string, unknown>).user_id, 'user_changed_user_id', wamid);
        }
      }
    }
  }
  return revocations;
}

/**
 * Split a verified delivery into the messages that go to the agent. PURE and
 * TOTAL: it reads the parsed body (any JSON value at all) without mutating it and
 * never throws, so a body the route cannot normalize still fails exactly where
 * and how it fails today.
 *
 * Only `messages`-field changes on the chosen number are looked at, and only the
 * `messages` array in them — statuses never divert, including the statuses of
 * the agent's own replies. Per message, not per delivery: one POST can carry
 * several senders (§2.2).
 *
 * A message is the row's when its `from` IS the row's phone
 * (matchAllowlistedSender), or — only when it has no `from` at all — when its
 * from_user_id is the row's bound BSUID (matchBoundBsuid). A `from` that does not
 * match is guest traffic whatever its from_user_id says. A BSUID this same
 * delivery reports as rotated identifies no one, and a user_changed_user_id
 * system message is never diverted: both are only collected as revocations.
 */
export function planOwnerAgentDiversion(
  data: unknown,
  routing: OwnerAgentRouting | null,
): OwnerAgentDiversion {
  if (!routing || !isRecord(data) || !Array.isArray(data.entry)) return NO_DIVERSION;

  const revocations = collectRevocations(data.entry);
  const revoked = new Set(revocations.map((r) => r.bsuid));

  const messages: OwnerAgentMessage[] = [];
  const wamids = new Set<string>();
  for (const entry of data.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== 'messages' || !isRecord(change.value)) continue;
      const value = change.value;
      const metadata = isRecord(value.metadata) ? value.metadata : null;
      if (metadata?.phone_number_id !== routing.phoneNumberId) continue;
      if (!Array.isArray(value.messages)) continue;
      for (const message of value.messages) {
        if (!isRecord(message) || typeof message.id !== 'string' || message.id === '') continue;
        if (isUserIdChange(message) || wamids.has(message.id)) continue;
        let matched = matchAllowlistedSender(message.from, routing.allowlist);
        let matchedBy: OwnerAgentMessage['matchedBy'] = 'phone';
        if (!matched && message.from === undefined && !revoked.has(String(message.from_user_id))) {
          matched = matchBoundBsuid(message.from_user_id, routing.bsuids);
          matchedBy = 'bsuid';
        }
        if (!matched) continue;
        const type = typeof message.type === 'string' ? message.type : null;
        wamids.add(message.id);
        messages.push({
          wamid: message.id,
          phoneNumberId: routing.phoneNumberId,
          entry: matched,
          matchedBy,
          type,
          ...extractContent(message, type),
          fromUserId: bsuidOrNull(message.from_user_id),
        });
      }
    }
  }
  if (messages.length === 0) {
    return revocations.length === 0 ? NO_DIVERSION : { ...NO_DIVERSION, revocations };
  }
  return { phoneNumberId: routing.phoneNumberId, messages, wamids, revocations };
}

/**
 * The normalized webhook_inbox rows minus the diverted messages. A row is removed
 * only if it is a `message` row, on the chosen number, whose wamid was diverted —
 * every other row (statuses, template-health, other fields, other messages) is
 * returned as the same object, in the same order.
 */
export function withoutDivertedRows<Row extends Pick<WebhookInboxInsert, 'event_kind' | 'message_id' | 'phone_number_id'>>(
  rows: readonly Row[],
  diversion: OwnerAgentDiversion,
): Row[] {
  if (diversion.messages.length === 0) return [...rows];
  return rows.filter(
    (row) =>
      !(
        row.event_kind === 'message' &&
        typeof row.message_id === 'string' &&
        row.phone_number_id === diversion.phoneNumberId &&
        diversion.wamids.has(row.message_id)
      ),
  );
}

// ─── 3. Handling a diverted message ───────────────────────────────────────────

// Where a failure happened, for the ids-only alert.
type HandleStep =
  | 'client'
  | 'gate_staff'
  | 'gate_phone'
  | 'gate_daily_cap'
  | 'intake'
  | 'enqueue'
  | 'audit'
  | 'bind'
  | 'revoke';

class OwnerAgentDbError extends Error {
  constructor(
    readonly step: HandleStep,
    readonly code: string,
  ) {
    super('owner-agent db error');
  }
}

// Exported for the reply consumer (consumer/store.ts), so both stages hash a
// wamid the same way and their audit rows correlate.
export function wamidSha256(wamid: string): string {
  return createHash('sha256').update(wamid).digest('hex');
}

// Skin tones and the emoji variation selector, so 👍🏽 and 👍️ count as 👍.
const EMOJI_MODIFIERS = /[\u{1F3FB}-\u{1F3FF}\u{FE0F}]/gu;

/** The audit reason for a reaction (plan §4.5). The emoji itself is never stored. */
export function reactionReason(emoji: string | null): string {
  if (emoji === null || emoji === '') return 'reaction_removed';
  const bare = emoji.replace(EMOJI_MODIFIERS, '');
  if (bare === '\u{1F44D}') return 'feedback_up';
  if (bare === '\u{1F44E}') return 'feedback_down';
  return 'reaction_other';
}

/**
 * The §3.1 route gate, then the intake row and the enqueue, for each diverted
 * message — in this order:
 *   kill_switch_off → not_staff (not for external_override) → phone_unverified
 *   (verified_staff only) → [BSUID bind] → [reaction: audit only, stop] →
 *   rate_limited → daily_cap → unsupported_type / invalid_payload → text_length →
 *   intake insert ON CONFLICT (wamid) DO NOTHING →
 *   enqueue deterministicJobId(wamid) (only when the row was created).
 * Each message ends with exactly one decision audit row: gated/<code>,
 * reaction_received/<code>, duplicate, intake_queued, or failed/<code>. A
 * message that also bound the sender's BSUID adds one bsuid_bound row; one whose
 * from_user_id disagrees with the existing binding adds one bsuid_mismatch row.
 *
 * Never throws. A DB or queue failure sends one ids-only alert.
 */
export async function handleOwnerAgentMessages(
  messages: readonly OwnerAgentMessage[],
  routing: OwnerAgentRouting,
): Promise<void> {
  if (messages.length === 0) return;
  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    await alertHandlingFailure({ step: 'client', code: 'exception', audit: 'failed', messages: messages.length });
    return;
  }
  const nowMs = Date.now();
  for (const message of messages) {
    await handleOne(admin, message, routing, nowMs);
  }
}

async function handleOne(
  admin: AdminClient,
  message: OwnerAgentMessage,
  routing: OwnerAgentRouting,
  nowMs: number,
): Promise<void> {
  const { staffUserId, entryId, approvalKind } = message.entry;
  const audit = (outcome: string, reasonCode: string | null, intakeId: string | null = null) =>
    writeAudit(admin, message, outcome, reasonCode, intakeId);
  const gated = async (reasonCode: string) => {
    await audit('gated', reasonCode);
  };

  let step: HandleStep = 'gate_staff';
  let intakeId: string | null = null;
  try {
    // 1. The kill switch. Off still diverted the message (§2.2); it only ends here.
    if (!routing.enabled) return await gated('kill_switch_off');

    // 2–3. Identity, by how the owner approved this row (approval.ts):
    //   verified_staff            — still platform staff AND the row phone is their
    //                               VERIFIED phone (the original binding);
    //   staff_unverified_override — still platform staff; the owner approved the
    //                               unverified phone by hand, so no phone check;
    //   external_override         — not staff; the owner approved the person by hand.
    // A message matched by its bound BSUID runs exactly these checks against the
    // row's phone: the binding stands in for `from`, never for the gate.
    if (approvalKind !== 'external_override') {
      // 2. Still platform staff (session-free twin, service_role only).
      if (!staffUserId) return await gated('not_staff');
      const { data: isStaff, error: staffError } = await admin.rpc('is_platform_staff_for_user', {
        _user_id: staffUserId,
      });
      if (staffError) throw new OwnerAgentDbError(step, staffError.code ?? 'unknown');
      if (isStaff !== true) return await gated('not_staff');
    }
    if (approvalKind === 'verified_staff') {
      // 3. The row's phone is that staff member's VERIFIED phone — a foreign number
      //    cannot be mapped onto a staff identity by editing the allow-list alone.
      step = 'gate_phone';
      if (!staffUserId) return await gated('not_staff');
      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('phone_verified_e164')
        .eq('id', staffUserId)
        .maybeSingle();
      if (profileError) throw new OwnerAgentDbError(step, profileError.code ?? 'unknown');
      if (!profile || profile.phone_verified_e164 !== message.entry.e164) {
        return await gated('phone_unverified');
      }
    }

    // The identity gate passed on a phone match: bind the BSUID, or flag a
    // mismatch with the existing binding (plan §4.7). Never fails the message.
    await reconcileBsuid(admin, message);

    // A reaction is feedback on an answer: one audit row and nothing else — no
    // intake, no run, and neither the rate limit nor the daily cap is spent (M6).
    if (message.type === 'reaction') {
      return await audit('reaction_received', reactionReason(message.reaction?.emoji ?? null));
    }

    // 4. Per-process rate limit (first line), per allow-list row.
    if (!rateLimit(`owner-agent:${entryId}`, OWNER_AGENT_RATE_LIMIT).allowed) {
      return await gated('rate_limited');
    }

    // 5. The daily cap, counted from real intake rows of this allow-list row since
    //    midnight in Israel.
    step = 'gate_daily_cap';
    const { count, error: countError } = await admin
      .from('owner_agent_intake')
      .select('id', { count: 'exact', head: true })
      .eq('allowlist_entry_id', entryId)
      .gte('received_at', israelMidnightIso(nowMs));
    if (countError) throw new OwnerAgentDbError(step, countError.code ?? 'unknown');
    // A missing count must not read as "0 used today".
    if (count === null || count === undefined) throw new OwnerAgentDbError(step, 'no_count');
    if (count >= routing.dailyCap) return await gated('daily_cap');

    // 6. The types the agent answers (plan §4.2), in a shape the intake CHECKs
    //    accept. A caption is the message text, with a text body's limits.
    if (message.payloadError) return await gated(message.payloadError);
    if (message.type === null) return await gated('unsupported_type');
    const messageText = message.text ?? message.caption;
    if (messageText !== null && (messageText.length === 0 || messageText.length > 4096)) {
      return await gated('text_length');
    }

    // The gate passed: the intake row. A Meta retry of the same message is a no-op.
    step = 'intake';
    const { media, interactive, location } = message;
    const { data: inserted, error: insertError } = await admin
      .from('owner_agent_intake')
      .upsert(
        {
          wamid: message.wamid,
          phone_number_id: message.phoneNumberId,
          staff_user_id: staffUserId,
          allowlist_entry_id: entryId,
          message_type: message.type,
          message_text: messageText,
          media_id: media?.id ?? null,
          media_mime: media?.mime ?? null,
          media_sha256_b64: media?.sha256 ?? null,
          media_filename: media?.filename ?? null,
          media_voice: media?.voice ?? null,
          interactive_id: interactive?.id ?? null,
          interactive_title: interactive?.title ?? null,
          location_lat: location?.lat ?? null,
          location_lng: location?.lng ?? null,
          location_label: location ? locationLabel(location) : null,
          reply_to_wamid: message.contextWamid,
        },
        { onConflict: 'wamid', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle();
    if (insertError) throw new OwnerAgentDbError(step, insertError.code ?? 'unknown');
    if (!inserted) return await audit('duplicate', null);
    intakeId = inserted.id;

    // Only a newly created row is enqueued. The payload is the row id only.
    step = 'enqueue';
    const job: OwnerAgentReplyJob = { intakeId };
    try {
      const boss = await getWebJobSender();
      // A burst window delays the start so the consumer can coalesce a burst
      // into one turn. pg-boss reads a numeric startAfter as SECONDS (12.33.5:
      // attorney.js stringifies it, plans.js CASTs it to interval). With 0 the
      // options are exactly today's.
      await boss.send(QUEUES.ownerAgentReply, job, {
        id: deterministicJobId(message.wamid),
        ...(routing.burstMs > 0 ? { startAfter: routing.burstMs / 1000 } : {}),
      });
    } catch {
      throw new OwnerAgentDbError(step, 'send_failed');
    }

    // A pass that only a manual approval allowed is marked as such (owner
    // requirement: every override pass is logged).
    await audit('intake_queued', overrideReasonCode(approvalKind), intakeId);
  } catch (error) {
    const failure =
      error instanceof OwnerAgentDbError ? error : new OwnerAgentDbError(step, 'exception');
    const reason = failure.step === 'enqueue' ? 'enqueue_failed' : 'db_error';
    const audited = await writeAuditQuietly(admin, message, 'failed', reason, intakeId);
    await alertHandlingFailure({
      step: failure.step,
      code: failure.code,
      audit: audited ? 'written' : 'failed',
      entry: message.entry.entryId,
    });
  }
}

// ─── 4. BSUID binding and revocation (plan §4.7) ──────────────────────────────
//
// Bind: ONLY from one signed message whose `from` passed the full phone match
// AND the identity gate (for verified_staff: the verified phone), and which also
// carried a well-formed, non-parent from_user_id. Compare-and-set on
// `bsuid is null`, so a row is bound once; a changed binding needs a revocation
// first. Never from a message without `from`; parent_user_id is never an identity.
// A phone-matched message whose from_user_id differs from the existing binding
// neither rebinds nor revokes: it is flagged (bsuid_mismatch, ids-only alert) and
// continues on the phone match.
//
// Revoke: a rotation (user_id_update, or a user_changed_user_id system message)
// that names a bound BSUID clears the binding — a changed BSUID means a changed
// phone, and the verified phone is no longer proven. CAS on the old value, so a
// Meta retry is a no-op. The event itself stays on the guest path untouched.

async function reconcileBsuid(admin: AdminClient, message: OwnerAgentMessage): Promise<void> {
  const { entry, fromUserId } = message;
  if (message.matchedBy !== 'phone' || !fromUserId) return;
  if (entry.bsuid !== null) {
    if (entry.bsuid !== fromUserId) {
      await writeAudit(admin, message, 'bsuid_mismatch', null, null);
      await alertBsuid('warn', 'mismatch', { entry: entry.entryId });
    }
    return;
  }
  try {
    const { data, error } = await admin
      .from('owner_agent_allowlist')
      .update({ bsuid: fromUserId, bsuid_bound_at: new Date().toISOString(), bound_from_e164: entry.e164 })
      .eq('id', entry.entryId)
      .is('bsuid', null)
      .select('id');
    if (error) {
      // 23505: this BSUID is already bound to another row. Alerted, not retried.
      await alertBsuid('error', 'bind', { step: 'bind', code: error.code ?? 'unknown', entry: entry.entryId });
      return;
    }
    if (data && data.length > 0) await writeAudit(admin, message, 'bsuid_bound', null, null);
  } catch {
    await alertBsuid('error', 'bind', { step: 'bind', code: 'exception', entry: entry.entryId });
  }
}

/**
 * Revoke each rotated binding, wherever it is — enabled or disabled row. One
 * small read (only when the delivery reported a rotation) finds the rows that
 * hold a rotated BSUID; each cleared row gets one bsuid_revoked audit row and one
 * ids-only alert. Never throws.
 */
export async function handleOwnerAgentRevocations(
  revocations: readonly OwnerAgentBsuidRevocation[],
): Promise<void> {
  if (revocations.length === 0) return;
  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    await alertBsuid('error', 'revoke', { step: 'client', code: 'exception' });
    return;
  }
  let holders: Array<{ id: string; staff_user_id: string | null; bsuid: string | null }>;
  try {
    const { data, error } = await admin
      .from('owner_agent_allowlist')
      .select('id, staff_user_id, bsuid')
      .in(
        'bsuid',
        revocations.map((r) => r.bsuid),
      );
    if (error) throw new OwnerAgentDbError('revoke', error.code ?? 'unknown');
    holders = data ?? [];
  } catch (error) {
    const code = error instanceof OwnerAgentDbError ? error.code : 'exception';
    await alertBsuid('error', 'revoke', { step: 'revoke_read', code });
    return;
  }
  for (const revocation of revocations) {
    const holder = holders.find((h) => h.bsuid === revocation.bsuid);
    if (!holder) continue; // not bound to anyone (a guest's rotation)
    const { bsuid, reason } = revocation;
    const target: AuditTarget = {
      entry: { entryId: holder.id, staffUserId: holder.staff_user_id },
      wamid: revocation.wamid,
    };
    const entry = target.entry;
    try {
      const { data, error } = await admin
        .from('owner_agent_allowlist')
        .update({ bsuid: null, parent_bsuid: null, bsuid_bound_at: null, bound_from_e164: null })
        .eq('id', entry.entryId)
        .eq('bsuid', bsuid)
        .select('id');
      if (error) throw new OwnerAgentDbError('revoke', error.code ?? 'unknown');
      if (!data || data.length === 0) continue; // already revoked (a retry)
      await writeAudit(admin, target, 'bsuid_revoked', reason, null);
      await alertBsuid('warn', 'revoked', { entry: entry.entryId, reason });
    } catch (error) {
      const code = error instanceof OwnerAgentDbError ? error.code : 'exception';
      const audited = await writeAuditQuietly(admin, target, 'failed', 'db_error', null);
      await alertBsuid('error', 'revoke', {
        step: 'revoke',
        code,
        audit: audited ? 'written' : 'failed',
        entry: entry.entryId,
      });
    }
  }
}

async function alertBsuid(
  level: 'warn' | 'error',
  kind: 'bind' | 'mismatch' | 'revoke' | 'revoked',
  fields: Record<string, string | number>,
): Promise<void> {
  const text = {
    bind: {
      title: 'סוכן הבעלים — קישור מזהה WhatsApp נכשל',
      detail:
        'ההודעה עצמה טופלה כרגיל לפי מספר הטלפון. הודעה עתידית בלי מספר טלפון מאותו איש צוות לא תזוהה עד שהקישור יצליח.',
    },
    mismatch: {
      title: 'סוכן הבעלים — מזהה WhatsApp לא תואם לקישור',
      detail:
        'הודעה מהטלפון של איש צוות מקושר הגיעה עם מזהה עסקי אחר מזה שקושר. ההודעה טופלה לפי הטלפון; הקישור לא שונה ולא בוטל. ייתכן שהחלפת מזהה לא דווחה — יש לבדוק את השורה.',
    },
    revoke: {
      title: 'סוכן הבעלים — ביטול קישור מזהה WhatsApp נכשל',
      detail:
        'Meta דיווחה על החלפת מזהה של איש צוות מקושר, והקישור הישן לא בוטל. יש לבדוק את השורה ברשימת ההיתר.',
    },
    revoked: {
      title: 'סוכן הבעלים — קישור מזהה WhatsApp בוטל',
      detail:
        'Meta דיווחה שהמזהה של איש צוות מקושר הוחלף (כנראה החליף מספר). הקישור בוטל; הודעה הבאה עם מספר הטלפון המאומת תקשר מחדש.',
    },
  }[kind];
  await sendSlackAlert({ level, category: 'errors', source: ALERT_SOURCE, ...text, fields });
}

// ─── 5. Audit ─────────────────────────────────────────────────────────────────

// Who an audit row is about: the allow-list row, and the wamid when there is one.
interface AuditTarget {
  entry: Pick<OwnerAgentAllowlistEntry, 'entryId' | 'staffUserId'>;
  wamid: string | null;
}

// An audit row: stage 'route', ids and codes only. A failed insert is alerted
// (ids only) and does not throw — the message has already been decided.
async function writeAudit(
  admin: AdminClient,
  target: AuditTarget,
  outcome: string,
  reasonCode: string | null,
  intakeId: string | null,
): Promise<void> {
  const ok = await writeAuditQuietly(admin, target, outcome, reasonCode, intakeId);
  if (!ok) {
    await alertHandlingFailure({
      step: 'audit',
      code: outcome,
      audit: 'failed',
      entry: target.entry.entryId,
    });
  }
}

async function writeAuditQuietly(
  admin: AdminClient,
  target: AuditTarget,
  outcome: string,
  reasonCode: string | null,
  intakeId: string | null,
): Promise<boolean> {
  try {
    const { error } = await admin.from('owner_agent_audit').insert({
      stage: 'route',
      outcome,
      reason_code: reasonCode,
      staff_user_id: target.entry.staffUserId,
      allowlist_entry_id: target.entry.entryId,
      intake_id: intakeId,
      wamid_sha256: target.wamid === null ? null : wamidSha256(target.wamid),
    });
    return !error;
  } catch {
    return false;
  }
}

async function alertHandlingFailure(fields: Record<string, string | number>): Promise<void> {
  await sendSlackAlert({
    level: 'error',
    category: 'errors',
    source: ALERT_SOURCE,
    title: 'סוכן הבעלים — טיפול בהודעה מוסטת נכשל',
    detail:
      'הודעה מטלפון שברשימת ההיתר הוסטה לסוכן ולא נקלטה עד הסוף. ה-webhook ענה 200 כרגיל, ותעבורת האורחים לא הושפעה. איש הצוות יכול לשלוח שוב.',
    fields,
  });
}
