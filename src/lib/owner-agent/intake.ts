import 'server-only';

import { createHash } from 'node:crypto';

import { sendSlackAlert } from '@/lib/alerts/slack';
import type { WebhookInboxInsert } from '@/lib/data/webhooks';
import { israelMidnightIso } from '@/lib/owner-agent/range';
import { normalizePhone } from '@/lib/phone';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES, type OwnerAgentReplyJob } from '@/lib/queue/queues';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

// The owner WhatsApp agent's side of the shared WhatsApp webhook
// (plans/owner-whatsapp-agent-plan.md §2.2–§2.3, §3.1, §3.7 — stage 4).
//
// THE INVARIANT this module exists to keep: guest traffic does not change. A
// message is diverted here only when BOTH hold —
//   1. the change's value.metadata.phone_number_id equals
//      app_settings.owner_agent_phone_number_id, and
//   2. its `from` is EXACTLY the E.164 of an ENABLED owner_agent_allowlist row.
// Every status, template-health event, other field, message on another number
// and message from anyone else stays on today's path, untouched. The route
// (src/app/api/webhooks/whatsapp/route.ts) calls in at three points:
//   getOwnerAgentRouting()      — beside the two existing app_settings reads;
//   planOwnerAgentDiversion()   — pure: which messages go to the agent;
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
// logActivity is not used: it needs a user session (activity.ts:34), and the
// dependency rules keep this directory away from the session DAL. The audit
// trail for this surface is owner_agent_audit.
//
// NO CONSUMER YET. The job enqueued here is read by stage 6; until then it waits
// in QUEUES.ownerAgentReply. No reply is sent to anyone from this module.

type AdminClient = ReturnType<typeof createAdminClient>;

/** One enabled allow-list row, as the router needs it. The e164 never leaves the server. */
export interface OwnerAgentAllowlistEntry {
  entryId: string;
  e164: string;
  staffUserId: string;
}

/** The routing configuration for one POST. null (from the reader) = divert nothing. */
export interface OwnerAgentRouting {
  /** Meta phone_number_id of the number the agent answers on. */
  phoneNumberId: string;
  /** owner_agent_enabled — the kill switch. Off still diverts (§2.2), then gates. */
  enabled: boolean;
  dailyCap: number;
  /** ENABLED rows only, keyed by their exact E.164. */
  allowlist: ReadonlyMap<string, OwnerAgentAllowlistEntry>;
}

/** A diverted message: ids, the matched row, and the text when it is a text message. */
export interface OwnerAgentMessage {
  wamid: string;
  phoneNumberId: string;
  entry: OwnerAgentAllowlistEntry;
  type: string | null;
  /** text.body for a `text` message, else null. */
  text: string | null;
}

export interface OwnerAgentDiversion {
  /** The chosen number the diverted messages arrived on; null when nothing is diverted. */
  phoneNumberId: string | null;
  messages: readonly OwnerAgentMessage[];
  wamids: ReadonlySet<string>;
}

export const NO_DIVERSION: OwnerAgentDiversion = Object.freeze({
  phoneNumberId: null,
  messages: Object.freeze([]) as readonly OwnerAgentMessage[],
  wamids: new Set<string>() as ReadonlySet<string>,
});

// Per staff member, per process — a first line only (rate-limit.ts:1-8). The
// daily cap below counts real rows and is the durable bound.
export const OWNER_AGENT_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

const ALERT_SOURCE = 'owner-agent';
const SETTINGS_COLUMNS = 'owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap';

// ─── 1. The routing read ──────────────────────────────────────────────────────

/**
 * One read of app_settings (the three owner-agent columns only, never `*`) and,
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
      .select('id, e164, staff_user_id')
      .eq('enabled', true);
    if (listError) return await routingReadFailed(step, listError.code);

    const allowlist = new Map<string, OwnerAgentAllowlistEntry>();
    for (const row of rows ?? []) {
      allowlist.set(row.e164, { entryId: row.id, e164: row.e164, staffUserId: row.staff_user_id });
    }
    // No enabled row: nothing can match, so do not make the caller read and verify
    // a body for nothing (the outreach-off branch).
    if (allowlist.size === 0) return null;

    return {
      phoneNumberId,
      enabled: settings.owner_agent_enabled === true,
      dailyCap: settings.owner_agent_daily_cap,
      allowlist,
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
 */
export function planOwnerAgentDiversion(
  data: unknown,
  routing: OwnerAgentRouting | null,
): OwnerAgentDiversion {
  if (!routing || !isRecord(data) || !Array.isArray(data.entry)) return NO_DIVERSION;

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
        const matched = matchAllowlistedSender(message.from, routing.allowlist);
        if (!matched || wamids.has(message.id)) continue;
        const type = typeof message.type === 'string' ? message.type : null;
        const textBlock = isRecord(message.text) ? message.text : null;
        const text = type === 'text' && typeof textBlock?.body === 'string' ? textBlock.body : null;
        wamids.add(message.id);
        messages.push({
          wamid: message.id,
          phoneNumberId: routing.phoneNumberId,
          entry: matched,
          type,
          text,
        });
      }
    }
  }
  if (messages.length === 0) return NO_DIVERSION;
  return { phoneNumberId: routing.phoneNumberId, messages, wamids };
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
  | 'audit';

class OwnerAgentDbError extends Error {
  constructor(
    readonly step: HandleStep,
    readonly code: string,
  ) {
    super('owner-agent db error');
  }
}

function wamidSha256(wamid: string): string {
  return createHash('sha256').update(wamid).digest('hex');
}

/**
 * The §3.1 route gate, then the intake row and the enqueue, for each diverted
 * message — in this order:
 *   kill_switch_off → not_staff → phone_unverified → rate_limited → daily_cap →
 *   non_text (and text_length) → intake insert ON CONFLICT (wamid) DO NOTHING →
 *   enqueue deterministicJobId(wamid) (only when the row was created).
 * Each message ends with exactly one owner_agent_audit row: gated/<code>,
 * duplicate, intake_queued, or failed/<code>.
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
  const staffUserId = message.entry.staffUserId;
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

    // 2. Still platform staff (session-free twin, service_role only).
    const { data: isStaff, error: staffError } = await admin.rpc('is_platform_staff_for_user', {
      _user_id: staffUserId,
    });
    if (staffError) throw new OwnerAgentDbError(step, staffError.code ?? 'unknown');
    if (isStaff !== true) return await gated('not_staff');

    // 3. The row's phone is that staff member's VERIFIED phone — a foreign number
    //    cannot be mapped onto a staff identity by editing the allow-list alone.
    step = 'gate_phone';
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('phone_verified_e164')
      .eq('id', staffUserId)
      .maybeSingle();
    if (profileError) throw new OwnerAgentDbError(step, profileError.code ?? 'unknown');
    if (!profile || profile.phone_verified_e164 !== message.entry.e164) {
      return await gated('phone_unverified');
    }

    // 4. Per-process rate limit (first line).
    if (!rateLimit(`owner-agent:${staffUserId}`, OWNER_AGENT_RATE_LIMIT).allowed) {
      return await gated('rate_limited');
    }

    // 5. The daily cap, counted from real intake rows since midnight in Israel.
    step = 'gate_daily_cap';
    const { count, error: countError } = await admin
      .from('owner_agent_intake')
      .select('id', { count: 'exact', head: true })
      .eq('staff_user_id', staffUserId)
      .gte('received_at', israelMidnightIso(nowMs));
    if (countError) throw new OwnerAgentDbError(step, countError.code ?? 'unknown');
    // A missing count must not read as "0 used today".
    if (count === null || count === undefined) throw new OwnerAgentDbError(step, 'no_count');
    if (count >= routing.dailyCap) return await gated('daily_cap');

    // 6. Text only. A fixed "text only" reply for media is stage 6's (it needs the
    //    consumer); here the message ends with its audit row.
    if (message.text === null) return await gated('non_text');
    if (message.text.length === 0 || message.text.length > 4096) return await gated('text_length');

    // The gate passed: the intake row. A Meta retry of the same message is a no-op.
    step = 'intake';
    const { data: inserted, error: insertError } = await admin
      .from('owner_agent_intake')
      .upsert(
        {
          wamid: message.wamid,
          phone_number_id: message.phoneNumberId,
          staff_user_id: staffUserId,
          message_text: message.text,
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
      await boss.send(QUEUES.ownerAgentReply, job, { id: deterministicJobId(message.wamid) });
    } catch {
      throw new OwnerAgentDbError(step, 'send_failed');
    }

    await audit('intake_queued', null, intakeId);
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

// An audit row: stage 'route', ids and codes only. A failed insert is alerted
// (ids only) and does not throw — the message has already been decided.
async function writeAudit(
  admin: AdminClient,
  message: OwnerAgentMessage,
  outcome: string,
  reasonCode: string | null,
  intakeId: string | null,
): Promise<void> {
  const ok = await writeAuditQuietly(admin, message, outcome, reasonCode, intakeId);
  if (!ok) {
    await alertHandlingFailure({
      step: 'audit',
      code: outcome,
      audit: 'failed',
      entry: message.entry.entryId,
    });
  }
}

async function writeAuditQuietly(
  admin: AdminClient,
  message: OwnerAgentMessage,
  outcome: string,
  reasonCode: string | null,
  intakeId: string | null,
): Promise<boolean> {
  try {
    const { error } = await admin.from('owner_agent_audit').insert({
      stage: 'route',
      outcome,
      reason_code: reasonCode,
      staff_user_id: message.entry.staffUserId,
      intake_id: intakeId,
      wamid_sha256: wamidSha256(message.wamid),
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
