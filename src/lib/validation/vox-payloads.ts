import { z } from 'zod';

// Pure normalizers for EXTERNAL Voximplant payloads (plan §4). Policy:
//   - our own inputs (admin forms, cb bodies) use strictObject elsewhere;
//   - EXTERNAL provider responses use LOOSE schemas + a pure normalizer, so a
//     provider-side field addition/rename degrades a value to null/'unknown'
//     instead of crashing a page or a cron;
//   - no raw external JSON ever crosses the DAL toward the UI. Content-bearing
//     fields (custom_data / result_data / audit detail) are reduced to
//     METADATA ONLY ({ present, bytes }) — never truncated content.
// Every normalizer must stay IO-free and total: any input → a typed value.

// ---------------------------------------------------------------------------
// Shared coercers (Voximplant sometimes returns numbers as strings)
// ---------------------------------------------------------------------------

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// "YYYY-MM-DD HH:MM:SS" (Management API form, UTC) or ISO → ISO string, else null.
function asIsoDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)
    ? `${s.replace(' ', 'T')}Z`
    : s;
  const t = Date.parse(candidate);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Voximplant habitually types "list of X" callback fields as the scalar element
// type, so a list may arrive as a real array OR a delimiter-joined string. Count
// either (never the elements themselves); null when neither, so the caller omits
// the *_count field. Keeps the count enrichment reliable regardless of the wire
// shape (verified: expiring_callerid.callerids is doc-typed `string`,
// expired_agreement.document_ids `number`).
function countMaybeList(v: unknown): number | null {
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'string' && v.trim() !== '') return v.split(',').filter((s) => s.trim() !== '').length;
  return null;
}

// Metadata-only view of a content-bearing external field. The CONTENT never
// leaves this function — only its presence and byte size.
export interface PayloadMeta {
  present: boolean;
  bytes: number;
}
export function payloadMeta(v: unknown): PayloadMeta {
  if (v === null || v === undefined || v === '') return { present: false, bytes: 0 };
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return { present: true, bytes: Buffer.byteLength(s ?? '', 'utf8') };
}

// ---------------------------------------------------------------------------
// A1 — GetCallLists / GetCallListDetails
// ---------------------------------------------------------------------------

const looseRecord = z.looseObject({});

export type CallListStatus = 'in_progress' | 'completed' | 'canceled' | 'unknown';

export interface NormalizedCallList {
  listId: number | null;
  name: string | null;
  ruleId: number | null;
  priority: number | null;
  maxSimultaneous: number | null;
  numAttempts: number | null;
  intervalSeconds: number | null;
  submittedAt: string | null;
  completedAt: string | null;
  status: CallListStatus;
}

const CALL_LIST_STATUS_MAP: Record<string, CallListStatus> = {
  'in progress': 'in_progress',
  completed: 'completed',
  canceled: 'canceled',
  cancelled: 'canceled',
};

export function normalizeCallList(raw: unknown): NormalizedCallList {
  const p = looseRecord.safeParse(raw);
  const o: Record<string, unknown> = p.success ? p.data : {};
  const statusRaw = asString(o.status)?.toLowerCase() ?? '';
  return {
    listId: asNumber(o.list_id),
    name: asString(o.list_name),
    ruleId: asNumber(o.rule_id),
    priority: asNumber(o.priority),
    maxSimultaneous: asNumber(o.max_simultaneous),
    numAttempts: asNumber(o.num_attempts),
    intervalSeconds: asNumber(o.interval_seconds),
    submittedAt: asIsoDate(o.dt_submit),
    completedAt: asIsoDate(o.dt_complete),
    status: CALL_LIST_STATUS_MAP[statusRaw] ?? 'unknown',
  };
}

// Task status enum per httpapi/calllists docs: 0=New 1=In progress 2=Processed
// 3=Error 4=Canceled. Anything else → 'unknown'.
export type CallListTaskStatus =
  | 'new'
  | 'in_progress'
  | 'processed'
  | 'error'
  | 'canceled'
  | 'unknown';

export const VOX_CALL_LIST_TASK_STATUS: Record<number, CallListTaskStatus> = {
  0: 'new',
  1: 'in_progress',
  2: 'processed',
  3: 'error',
  4: 'canceled',
};

export interface NormalizedCallListTask {
  taskId: number | null;
  taskUuid: string | null;
  status: CallListTaskStatus;
  attemptsLeft: number | null;
  lastAttemptAt: string | null;
  startExecutionAt: string | null;
  finishExecutionAt: string | null;
  // METADATA ONLY — the content of custom_data/result_data is guest PII and
  // never leaves the normalizer (plan §4).
  customData: PayloadMeta;
  resultData: PayloadMeta;
}

export function normalizeCallListTask(raw: unknown): NormalizedCallListTask {
  const p = looseRecord.safeParse(raw);
  const o: Record<string, unknown> = p.success ? p.data : {};
  const statusId = asNumber(o.status_id);
  const statusFromText = asString(o.status)?.toLowerCase().replace(' ', '_') ?? '';
  const status: CallListTaskStatus =
    (statusId !== null ? VOX_CALL_LIST_TASK_STATUS[statusId] : undefined) ??
    (['new', 'in_progress', 'processed', 'error', 'canceled'].includes(statusFromText)
      ? (statusFromText as CallListTaskStatus)
      : 'unknown');
  return {
    taskId: asNumber(o.task_id),
    taskUuid: asString(o.task_uuid),
    status,
    attemptsLeft: asNumber(o.attempts_left),
    lastAttemptAt: asIsoDate(o.last_attempt),
    startExecutionAt: asIsoDate(o.start_execution_time),
    finishExecutionAt: asIsoDate(o.finish_execution_time),
    customData: payloadMeta(o.custom_data),
    resultData: payloadMeta(o.result_data),
  };
}

// ---------------------------------------------------------------------------
// A3 — GetAuditLog
// ---------------------------------------------------------------------------

// Plan §4: NO detail field AT ALL (not even partial). IP is masked to /24.
export interface NormalizedAuditEntry {
  at: string | null;
  command: string | null;
  actorType: 'account' | 'subuser' | 'key' | 'unknown';
  ipMasked: string | null;
}

export function maskIp(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(s.trim());
  if (m) return `${m[1]}.${m[2]}.${m[3]}.xxx`;
  // IPv6 / anything else: keep only the first two groups.
  if (s.includes(':')) {
    const groups = s.split(':');
    return `${groups[0]}:${groups[1] ?? ''}:…`;
  }
  return null;
}

export function normalizeAuditEntry(raw: unknown): NormalizedAuditEntry {
  const p = looseRecord.safeParse(raw);
  const o: Record<string, unknown> = p.success ? p.data : {};
  // AuditLogInfoType is not enumerated in the research corpus — probe the
  // plausible field names defensively (confirmed live at stage-1 smoke).
  const actorRaw = (
    asString(o.account_email) ? 'account'
    : asString(o.subuser_login) ? 'subuser'
    : asNumber(o.key_id) !== null || asString(o.key_id) ? 'key'
    : 'unknown'
  ) as NormalizedAuditEntry['actorType'];
  return {
    at: asIsoDate(o.requested ?? o.timestamp ?? o.audit_log_time),
    command: asString(o.cmd_name ?? o.command ?? o.cmd),
    actorType: actorRaw,
    ipMasked: maskIp(o.ip),
  };
}

// ---------------------------------------------------------------------------
// A2 — GetMediaResources → IP allowlist extraction
// ---------------------------------------------------------------------------

const IPV4_OCTET_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Lenient IPv6: hex groups + ':' with at least one ':'; full validation is not
// needed for an allowlist DISPLAY (firewall entry is copied by a human).
const IPV6_LENIENT_RE = /^[0-9a-fA-F:]+$/;

function isValidIpv4(s: string): boolean {
  const m = IPV4_OCTET_RE.exec(s);
  if (!m) return false;
  return m.slice(1).every((oct) => Number(oct) <= 255);
}

// Recursively walk ANY JSON shape (the getMediaResources response shape is
// undocumented) and collect every string that looks like an IP address.
export function extractIpStrings(raw: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      const s = v.trim();
      if (isValidIpv4(s)) found.add(s);
      else if (s.includes(':') && s.length >= 3 && IPV6_LENIENT_RE.test(s)) found.add(s);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === 'object') {
      for (const item of Object.values(v)) walk(item);
    }
  };
  walk(raw);
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// B5 — AccountCallback envelope
// ---------------------------------------------------------------------------

// The envelope is UNTRUSTED (hash verification requires the legacy api_key we
// do not hold). The route treats any authenticated POST as a poke and pulls
// verified data itself; this normalizer only enriches telemetry. Parse failure
// therefore returns an EMPTY event list — never an error.
//
// Per the AccountCallback contract (verified live via getDoc), the envelope
// item's `type` string EQUALS the name of the single populated data property
// (e.g. `expiring_agreement` → item.expiring_agreement). `detail` lifts only the
// NON-PII operational scalars/counts from that property (days-to-expiry, shortfall
// amounts, array lengths) so an alert can carry context — it NEVER carries the
// caller-ID numbers, card PANs, certificate bodies, or SMS content.
export interface NormalizedAccountCallbackEvent {
  type: string;
  callbackId: string | null;
  detail: Record<string, string | number>;
}
export interface NormalizedAccountCallbacks {
  events: NormalizedAccountCallbackEvent[];
  unknownShapes: number;
}

// Lift the metadata-only scalars/counts for the types KALFA acts on. Any other
// type (min_balance — handled by the verified pull — or administrative kinds)
// gets an empty detail; the raw data property is never surfaced.
function extractCallbackDetail(type: string, o: Record<string, unknown>): Record<string, string | number> {
  const data = o[type];
  const rec: Record<string, unknown> =
    data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const d: Record<string, string | number> = {};
  switch (type) {
    case 'expiring_callerid': {
      const exp = asString(rec.expiration_date);
      if (exp) d.expiration_date = exp;
      const n = countMaybeList(rec.callerids); // COUNT only — never the numbers
      if (n !== null) d.callerid_count = n;
      break;
    }
    case 'expiring_agreement': {
      const exp = asString(rec.expiration_date);
      if (exp) d.expiration_date = exp;
      const days = asNumber(rec.until_expiration);
      if (days !== null) d.until_expiration = days;
      break;
    }
    case 'expired_agreement': {
      const n = countMaybeList(rec.document_ids);
      if (n !== null) d.document_count = n;
      break;
    }
    case 'next_charge_alert': {
      const shortfall = asNumber(rec.insufficient_funds_amount);
      if (shortfall !== null) d.insufficient_funds_amount = shortfall;
      const required = asNumber(rec.required_money);
      if (required !== null) d.required_money = required;
      break;
    }
    case 'call_history_report': {
      const id = asNumber(rec.history_report_id);
      if (id !== null) d.history_report_id = id;
      if (typeof rec.success === 'boolean') d.success = String(rec.success);
      break;
    }
    case 'expiring_certificates':
    case 'expired_certificates': {
      const n = countMaybeList(rec.certificates);
      if (n !== null) d.certificate_count = n;
      break;
    }
    case 'sip_registration_fail': {
      const n = countMaybeList(rec.sip_registrations);
      if (n !== null) d.sip_registration_count = n;
      break;
    }
    // js_fail / card_expired / card_expires_in_month / card_payment_failed carry
    // NO payload fields (verified live) — the event itself is the signal.
    // account_is_frozen / account_is_unfrozen / reset_account_password_request
    // likewise carry no non-PII scalars we surface — the event is the signal.
  }
  return d;
}

export function normalizeAccountCallbackEnvelope(raw: unknown): NormalizedAccountCallbacks {
  const p = z.looseObject({ callbacks: z.unknown() }).safeParse(raw);
  if (!p.success || !Array.isArray(p.data.callbacks)) {
    return { events: [], unknownShapes: raw == null ? 0 : 1 };
  }
  const events: NormalizedAccountCallbacks['events'] = [];
  let unknownShapes = 0;
  for (const item of p.data.callbacks) {
    const cb = looseRecord.safeParse(item);
    if (!cb.success) {
      unknownShapes += 1;
      continue;
    }
    const o: Record<string, unknown> = cb.data;
    const type = asString(o.type);
    if (!type) {
      unknownShapes += 1;
      continue;
    }
    const idNum = asNumber(o.callback_id);
    events.push({
      type,
      callbackId: idNum !== null ? String(idNum) : asString(o.callback_id),
      detail: extractCallbackDetail(type, o),
    });
  }
  return { events, unknownShapes };
}

// ---------------------------------------------------------------------------
// GetAccountInfo (verified pull)
// ---------------------------------------------------------------------------

export interface NormalizedAccountInfo {
  balance: number | null; // null = unparseable → caller alerts "unknown balance"
  currency: string | null;
  active: boolean | null;
  callbackUrl: string | null; // echo — may be absent (undocumented; stage-6 OPEN)
  callbackSalt: string | null;
}

export function normalizeAccountInfo(raw: unknown): NormalizedAccountInfo {
  const p = looseRecord.safeParse(raw);
  const outer: Record<string, unknown> = p.success ? p.data : {};
  const inner = looseRecord.safeParse(outer.result);
  const o: Record<string, unknown> = inner.success ? inner.data : outer;
  return {
    balance: asNumber(o.balance),
    currency: asString(o.currency),
    active: typeof o.active === 'boolean' ? o.active : null,
    callbackUrl: asString(o.callback_url),
    callbackSalt: asString(o.callback_salt),
  };
}

// ---------------------------------------------------------------------------
// A4 — GetCallHistory session → log pointer
// ---------------------------------------------------------------------------

// The URL here is still UNTRUSTED — full SSRF validation happens in
// src/lib/voximplant/log-download.ts before any fetch.
export interface NormalizedSessionLogPointer {
  sessionId: number | null;
  logFileUrl: string | null;
}

export function normalizeSessionLogPointer(raw: unknown): NormalizedSessionLogPointer {
  const p = looseRecord.safeParse(raw);
  const o: Record<string, unknown> = p.success ? p.data : {};
  return {
    sessionId: asNumber(o.call_session_history_id),
    logFileUrl: asString(o.log_file_url),
  };
}
