import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig, type WhatsAppChannel } from '@/lib/data/outreach-config';
import { sendWhatsAppText } from '@/lib/whatsapp/client';
import {
  importSender,
  waMeUrl,
  type WhatsAppSender,
} from '@/lib/whatsapp/channel-routing';
import { decodeCsvBuffer, parseCsv, sniffSpreadsheetBinary } from '@/lib/csv';
import { normalizePhone, repairIsraeliLocalPhone } from '@/lib/phone';
import { importRowSchema } from '@/lib/validation/guests';
import { guestImportHeaderKey } from '@/lib/data/guest-import-shared';
import { ISRAELI_PHONE_RE } from '@/lib/constants';
import { WhatsAppAPI } from 'whatsapp-api-js';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import type { Enums, Json } from '@/lib/supabase/types';
type EventType = Enums<'event_type'>;

// The minimum an owner's active event needs for import routing + the reply
// label. `name` is the owner's free-text title (may be empty → type label).
export type ImportEvent = { id: string; name: string | null; event_type: EventType };

// WhatsApp guest-import channel: a VERIFIED owner sends the business number a
// CSV document or shared contact cards → the worker parses them into PENDING
// guest_import_staging rows and replies with a review link. Guests are
// created ONLY when confirmed in the app. Unmapped senders are ignored
// entirely (no download, no reply — nothing leaks about the system).
//
// Two-number split: when a number holds the `whatsapp_import_sender` role,
// webhook-processing.ts sends ONLY rows that arrived there to
// stageWhatsAppImport, and rows that arrived on the RSVP number to
// replyImportPointer.
//
// REPLIES LEAVE FROM THE NUMBER THAT RECEIVED THE LIST — always, whatever the
// roles say. That was the intent of this paragraph from the start; it was not
// what the code did. With the role unassigned, `importSender` fell back to the
// RSVP number, so a list sent to any THIRD business number was staged correctly
// and then answered from a number the owner had never written to — no open
// 24-hour window, refused by Meta, and discarded by `safeReply`. Measured live
// 2026-09-13. The receiving number is now passed in explicitly.

type InboxRow = {
  payload: Json | null;
  phone_number_id: string | null;
};

// The two import-bearing inbound shapes, with the sender already normalized.
type ImportPayload = {
  type: 'document' | 'contacts';
  from: string; // E.164
  document?: { id?: string; filename?: string };
  id?: string; // inbound wamid
};

// Narrow a persisted inbound payload to an import; null for every other message
// type, or when the sender phone does not normalize. Shared by the staging path
// and the pointer path so both agree on what "a list" is.
function readImportPayload(payload: Json | null): ImportPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as {
    id?: string;
    type?: string;
    from?: string;
    document?: { id?: string; filename?: string };
  };
  if (p.type !== 'document' && p.type !== 'contacts') return null;
  const from = typeof p.from === 'string' ? normalizePhone(p.from) : null;
  if (!from) return null;
  return {
    type: p.type,
    from,
    document: p.document,
    id: typeof p.id === 'string' && p.id ? p.id : undefined,
  };
}

export type StagedRow = {
  full_name: string;
  phone: string | null;
  expected_count: number | null;
  group: string;
};

const MAX_DOC_BYTES = 1_000_000; // same cap as the screen upload

type EventRow = {
  id: string;
  name: string | null;
  event_type: EventType;
  created_at: string;
};

// profiles.phone (verified) → user → EVERY ACTIVE event that user may MANAGE:
// their own, or a shared-org event where their role holds guests.create
// (phase-3 model — so an org member like a co-managing brother can send lists
// too). Returned newest-first, de-duplicated by id.
//
// Historically this returned only the NEWEST active event and the caller
// staged there blindly. That silently misrouted a file to the wrong event when
// the sender managed more than one active event (incident 2026-07-06: a brit
// guest list landed on a newer wedding event). The caller now decides: exactly
// one → stage; more than one → ask which, never guess.
// Exported (only) so the composite-key regression test below can drive it
// directly — it is not part of the module's public contract.
export async function resolveOwnerActiveEvents(
  senderE164: string,
): Promise<ImportEvent[]> {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, phone')
    .not('phone', 'is', null);
  const sender = (profiles ?? []).find(
    (p) => normalizePhone(p.phone) === senderE164,
  );
  if (!sender) return [];

  const { data: owned } = await admin
    .from('events')
    .select('id, name, event_type, created_at')
    .eq('owner_id', sender.id)
    .eq('status', 'active');

  const { data: memberships } = await admin
    .from('organization_members')
    .select('organization_id, role_id')
    .eq('user_id', sender.id);
  let shared: EventRow[] = [];
  if (memberships && memberships.length > 0) {
    // Permissions are now per-(organization_id, role_id) — a role name/id no
    // longer means the same thing across orgs (an owner may customize one
    // org's matrix without touching another's). `.in('organization_id', ...)`
    // + `.in('role_id', ...)` is a Cartesian PRE-FILTER only (Postgres/
    // PostgREST has no tuple-IN); the composite key below reconstitutes the
    // exact (organization_id, role_id) pair before trusting a row. Using a
    // bare role_id set here would reintroduce the incident-2026-07-06 misroute
    // class this file's own history already fixed once.
    const { data: allowedTuples } = await admin
      .from('organization_role_permissions')
      .select('organization_id, role_id, permission_definitions!inner(resource, action)')
      .in('organization_id', memberships.map((m) => m.organization_id))
      .in('role_id', memberships.map((m) => m.role_id))
      .eq('permission_definitions.resource', 'guests')
      .eq('permission_definitions.action', 'create');
    const okTuples = new Set(
      (allowedTuples ?? []).map((r) => `${r.organization_id}:${r.role_id}`),
    );
    const orgIds = memberships
      .filter((m) => okTuples.has(`${m.organization_id}:${m.role_id}`))
      .map((m) => m.organization_id);
    if (orgIds.length > 0) {
      const { data } = await admin
        .from('events')
        .select('id, name, event_type, created_at')
        .in('org_id', orgIds)
        .eq('status', 'active');
      shared = (data ?? []) as EventRow[];
    }
  }

  // De-dupe (an org event the sender also owns appears in both lists), then
  // sort newest-first for a stable, predictable order in the reply.
  const byId = new Map<string, EventRow>();
  for (const e of [...((owned ?? []) as EventRow[]), ...shared]) byId.set(e.id, e);
  return [...byId.values()]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map(({ id, name, event_type }) => ({ id, name, event_type }));
}

// Human-readable event label for a WhatsApp reply: the owner's title when set,
// otherwise the Hebrew type label ("ברית"/"חתונה"/…).
export function eventImportLabel(e: ImportEvent): string {
  const named = e.name?.trim();
  return named && named.length > 0 ? named : EVENT_TYPE_LABELS[e.event_type];
}

function importScreenUrl(
  origin: string,
  eventId: string,
  screen: 'whatsapp' | 'csv',
): string {
  const base = `${origin}/app/events/${eventId}/guests/import`;
  return screen === 'whatsapp' ? `${base}/whatsapp` : base;
}

// Reply for the unambiguous case: the list was staged under the single active
// event — NAME it (so a wrong routing is visible immediately) and link to its
// review screen.
export function buildSingleEventReply(
  e: ImportEvent,
  rowCount: number,
  errorCount: number,
  origin: string,
): string {
  const errs = errorCount ? ` (${errorCount} עם שגיאות)` : '';
  return (
    `נקלטו ${rowCount} שורות${errs} לאירוע «${eventImportLabel(e)}».\n` +
    `לסקירה ואישור הייבוא:\n${importScreenUrl(origin, e.id, 'whatsapp')}`
  );
}

// Reply for the ambiguous case: the sender manages more than one active event,
// so we NEVER guess. Nothing is staged; we list each active event with its own
// import screen and ask the owner to upload the file on the correct one.
export function buildAmbiguousEventReply(
  events: ImportEvent[],
  origin: string,
): string {
  const lines = events
    .map((e) => `• ${eventImportLabel(e)}: ${importScreenUrl(origin, e.id, 'csv')}`)
    .join('\n');
  return (
    'קיבלנו קובץ עם רשימת מוזמנים 📄\n' +
    'יש לך כמה אירועים פעילים, אז לא ברור לאיזה לשייך את הרשימה. ' +
    'פתחו את מסך הייבוא באירוע הנכון והעלו שם את הקובץ:\n' +
    lines
  );
}

// Pointer for a list that reached the RSVP number once the split is live: names
// the import number (resolved from the role — never hardcoded) with its deep
// link. null when no display number is known; there is nothing useful to say.
export function buildImportPointerReply(displayNumber: string | null): string | null {
  if (!displayNumber) return null;
  const link = waMeUrl(displayNumber);
  return (
    `רשימות מוזמנים מתקבלות במספר הייבוא של KALFA: ${displayNumber}\n` +
    (link ? `${link}\n` : '') +
    'שלחו לשם את הקובץ או את אנשי הקשר, ותקבלו משם קישור לסקירה ולאישור.'
  );
}

// Parse CSV bytes into staged rows using the SAME rules as the screen import
// (header aliases, phone repair, schema validation). Duplicate policing stays
// at CONFIRM time — the review screen shows conflicts before anything lands.
export function parseCsvToStagedRows(bytes: Uint8Array): {
  rows: StagedRow[];
  errors: Array<{ row: number; message: string }>;
} | { error: string } {
  if (sniffSpreadsheetBinary(bytes)) {
    return { error: 'קובץ Excel אינו נתמך — יש לשמור כ־CSV UTF-8 ולשלוח שוב.' };
  }
  const grid = parseCsv(decodeCsvBuffer(bytes));
  if (grid.length < 2) return { error: 'הקובץ ריק או חסר שורות נתונים.' };
  const col: Record<string, number> = { full_name: -1, phone: -1, group: -1, expected_count: -1 };
  grid[0].forEach((cell, i) => {
    const key = guestImportHeaderKey(cell);
    if (key && col[key] === -1) col[key] = i;
  });
  if (col.full_name === -1) return { error: 'לא נמצאה עמודת שם בכותרת הקובץ.' };

  const rows: StagedRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  grid.slice(1).forEach((cells, idx) => {
    const rowNum = idx + 1;
    if (cells.every((c) => c.trim() === '')) return;
    const rawPhone = (col.phone === -1 ? '' : cells[col.phone] ?? '').trim();
    const phone =
      rawPhone !== '' && !ISRAELI_PHONE_RE.test(rawPhone)
        ? repairIsraeliLocalPhone(rawPhone) ?? rawPhone
        : rawPhone;
    const rawCount = (col.expected_count === -1 ? '' : cells[col.expected_count] ?? '').trim();
    const parsed = importRowSchema.safeParse({
      full_name: cells[col.full_name] ?? '',
      phone,
      group: col.group === -1 ? '' : cells[col.group] ?? '',
      ...(rawCount === '' ? {} : { expected_count: rawCount }),
    });
    if (!parsed.success) {
      errors.push({ row: rowNum, message: parsed.error.issues[0]?.message ?? 'שורה לא תקינה' });
      return;
    }
    rows.push({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      expected_count: parsed.data.expected_count ?? null,
      group: parsed.data.group?.trim() ?? '',
    });
  });
  return { rows, errors };
}

/**
 * The usable phone on one shared contact card.
 *
 * ⚠️ `wa_id` FIRST, AND THAT ORDERING IS THE FIX.
 *
 * MEASURED on a live card, 2026-09-13. Meta sends BOTH:
 *
 *     "phones": [{ "type": "אחר",
 *                  "phone": "+33 7 56 98 23 70",   ← a DISPLAY string
 *                  "wa_id": "33756982370" }]       ← the canonical number
 *
 * This read `phone` and ran `repairIsraeliLocalPhone` over it — a function that
 * only understands ISRAELI local formats. For the French number above it
 * returned null, so the code fell back to the raw display string and staged
 * `+33 7 56 98 23 70`, spaces and all.
 *
 * That is not a cosmetic defect. `guests_event_phone_key` is a unique index on
 * the stored value, so a spaced number does not collide with the same person's
 * normalised one — the same guest gets created twice — and `findImportMatches`
 * compares phones, so the review screen would not have offered the merge either.
 *
 * ⚠️ THE OUTPUT IS THE HOUSE FORMAT, NOT E.164, and that was nearly the second
 * bug. MEASURED in `guests` on 2026-09-13: 41 of 44 stored phones are the LOCAL
 * `0…` form and only 3 are E.164. Canonicalising everything to `+972…` would have
 * made every Israeli contact card fail to match those 41 rows — recreating the
 * duplicate-guest problem this function exists to close, from the other side.
 *
 * So an Israeli number comes back as `0…` (`repairIsraeliLocalPhone`, which
 * normalises through libphonenumber and converts back), and a foreign one comes
 * back as E.164 — there is no local form for a French number in an Israeli
 * address book. Either way the separators are gone, which is the actual defect.
 *
 * `wa_id` is E.164 WITHOUT the leading '+', hence the prefix before parsing.
 *
 * An unparseable value is kept VERBATIM rather than dropped: losing the guest is
 * worse than staging something a human can see and correct on the review screen.
 */
function contactCardPhone(contact: unknown): string | null {
  const phones = (contact as { phones?: Array<{ phone?: unknown; wa_id?: unknown }> }).phones;
  const first = Array.isArray(phones) ? phones[0] : undefined;

  const waId = typeof first?.wa_id === 'string' ? first.wa_id.trim() : '';
  const display = typeof first?.phone === 'string' ? first.phone.trim() : '';

  // `wa_id` first: it is the canonical number, while `phone` is a display string
  // that carries whatever spacing the sender's address book used.
  for (const candidate of [waId === '' ? '' : `+${waId.replace(/^\+/, '')}`, display]) {
    if (candidate === '') continue;
    const israeli = repairIsraeliLocalPhone(candidate);
    if (israeli) return israeli;
    const e164 = normalizePhone(candidate);
    if (e164) return e164;
  }

  return display !== '' ? display : null;
}

// Shared contact cards → staged rows (formatted_name + first phone).
export function contactsToStagedRows(payload: Json | null): StagedRow[] {
  const contacts =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { contacts?: unknown }).contacts
      : null;
  if (!Array.isArray(contacts)) return [];
  const rows: StagedRow[] = [];
  for (const c of contacts) {
    if (!c || typeof c !== 'object') continue;
    const name = (c as { name?: { formatted_name?: unknown } }).name?.formatted_name;
    if (typeof name !== 'string' || name.trim() === '') continue;
    rows.push({
      full_name: name.trim().slice(0, 200),
      phone: contactCardPhone(c),
      expected_count: null,
      group: '',
    });
  }
  return rows;
}

// How long a single media call may take. The worker drains up to 50 rows in one
// tick, so a media endpoint that accepts the connection and then stalls would
// otherwise hold the whole drain open. Enforced by an AbortSignal injected
// through the SDK's fetch ponyfill — a real socket abort, not a Promise.race
// that leaves the request running.
const MEDIA_TIMEOUT_MS = 15_000;

// Download an inbound CSV, through the SDK rather than a hand-rolled fetch.
//
// Two things this buys beyond the raw fetch it replaces:
//   - `retrieveMedia(id, phoneID)` SCOPES the lookup to the business number the
//     message arrived at. Meta rejects a media id that belongs to a different
//     number on the same WABA, so a forged or replayed media id from the wrong
//     line cannot be read through our token (3.9 §13). `phoneID` is optional in
//     the SDK; passing null would restore the unscoped behaviour, so the caller
//     always passes the row's phone_number_id.
//   - the URL is fetched via `fetchMedia`, which carries the Authorization
//     header the CDN link requires — we never re-implement the auth.
//
// The 1MB cap is checked TWICE: against the size Meta reports, and against the
// bytes actually received (a lying or absent file_size must not get us to
// buffer an arbitrary body). `file_size` is a STRING on the SDK's success
// branch, and `url` exists only there — hence the `'url' in meta` narrowing and
// the numeric coercion.
async function downloadDocument(
  mediaId: string,
  accessToken: string,
  phoneNumberId: string | null,
): Promise<Uint8Array | null> {
  try {
    const api = new WhatsAppAPI({
      token: accessToken,
      secure: false,
      v: GRAPH_API_VERSION,
      ponyfill: {
        fetch: (input: string | URL | Request, init?: RequestInit) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) }),
      },
    });

    const meta = await api.retrieveMedia(mediaId, phoneNumberId ?? undefined);
    if (!('url' in meta)) return null;
    const reported = Number(meta.file_size);
    if (Number.isFinite(reported) && reported > MAX_DOC_BYTES) return null;

    const res = await api.fetchMedia(meta.url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength <= MAX_DOC_BYTES ? buf : null;
  } catch {
    return null;
  }
}

// Reply-link origin, worker-safe. Worker context has no request, so the origin
// must come from env. Defensive: tolerate an inline comment/whitespace in the
// env value (live incident: the reply carried the comment inside the link).
// Deliberately NO literal fallback — a reply link minted on a stale hardcoded
// origin outlives a domain move silently (relocation plan Phase 0 #1), so an
// unset APP_ORIGIN throws loudly instead.
// Exported (only) so the regression test below can drive it directly.
export function resolveReplyOrigin(): string {
  const origin = process.env.APP_ORIGIN?.split(/[\s#]/)[0]?.trim();
  if (!origin) {
    throw new Error(
      'APP_ORIGIN is required to build WhatsApp import reply links but is not set.',
    );
  }
  return origin;
}

// Entry point from the webhook processor. Returns true when the inbound was
// CONSUMED as an import (mapped owner + document/contacts) — the caller then
// skips the campaign/billing path entirely.
//
// `channel` is passed IN rather than read here: the router already resolved it
// for this batch of rows, and it must stay the single place that decides which
// number handles what. Reading it again here would be a second round-trip per
// message for an answer the caller already holds.
export async function stageWhatsAppImport(
  row: InboxRow,
  channel: WhatsAppChannel | null,
): Promise<boolean> {
  const p = readImportPayload(row.payload);
  if (!p) return false;

  // Belt-and-braces for the split: once an import number exists, a list that
  // arrived on any OTHER number is never staged from here. webhook-processing
  // is the primary gate; this keeps the module safe against a future caller
  // that forgets to route first.
  if (
    channel?.importPhoneNumberId &&
    row.phone_number_id !== channel.importPhoneNumberId
  ) {
    return false;
  }

  const sender = p.from;
  const events = await resolveOwnerActiveEvents(sender);
  if (events.length === 0) return false; // stranger → silently not-an-import

  const config = channel;
  if (!config) return true; // consumed (owner intent) but channel off

  // Replies leave from the number that RECEIVED the list: the import number
  // when the role is assigned, the RSVP number in legacy mode. Same token and
  // app secret either way — one Meta app, one WABA.
  // THE NUMBER THAT RECEIVED THE LIST, not the configured one — see
  // `importSender`. A reply from a number the owner never messaged has no open
  // 24-hour window and is refused by Meta, silently.
  const from = importSender(config, row.phone_number_id);
  const origin = resolveReplyOrigin();

  // More than one active event the sender may manage: NEVER guess which one
  // (misroute incident 2026-07-06 — a brit guest list landed on a newer active
  // event because "newest wins"). Stage nothing; ask the owner to upload the
  // file on the correct event's import screen.
  if (events.length > 1) {
    await safeReply(from, sender, buildAmbiguousEventReply(events, origin));
    return true;
  }

  const ownerEvent = events[0];
  const admin = createAdminClient();

  // Idempotent by inbound wamid: a manual "reprocess" from /admin/webhooks (or a
  // late Meta retry) of a message that ALREADY produced a staged list is a
  // no-op — no second download, no duplicate pending list, no second owner
  // reply. Enforced at the DB too (UNIQUE source_message_id WHERE NOT NULL).
  const wamid = p.id ?? null;
  if (wamid) {
    const { data: already } = await admin
      .from('guest_import_staging')
      .select('id')
      .eq('source_message_id', wamid)
      .maybeSingle();
    if (already) return true;
  }

  let staged: StagedRow[] = [];
  let errors: Array<{ row: number; message: string }> = [];
  let fileName: string | null = null;

  if (p.type === 'document') {
    fileName = p.document?.filename ?? null;
    const mediaId = p.document?.id;
    const bytes = mediaId
      ? await downloadDocument(mediaId, config.accessToken, row.phone_number_id)
      : null;
    if (!bytes) {
      await safeReply(from, sender, 'לא הצלחנו לקרוא את הקובץ (עד 1MB, CSV בלבד). נסו לשלוח שוב.');
      return true;
    }
    const parsed = parseCsvToStagedRows(bytes);
    if ('error' in parsed) {
      await safeReply(from, sender, parsed.error);
      return true;
    }
    staged = parsed.rows;
    errors = parsed.errors;
  } else {
    staged = contactsToStagedRows(row.payload);
    if (staged.length === 0) return true;
  }

  // Retry-safe: identical pending content from the same sender is the same
  // inbox message being retried — reply with the link again, insert nothing.
  const { data: dupes } = await admin
    .from('guest_import_staging')
    .select('id, rows')
    .eq('event_id', ownerEvent.id)
    .eq('sender_phone', sender)
    .eq('status', 'pending');
  const stagedJson = JSON.stringify(staged);
  const isDupe = (dupes ?? []).some((d) => JSON.stringify(d.rows) === stagedJson);
  const { error } = isDupe
    ? { error: null }
    : await admin.from('guest_import_staging').insert({
    event_id: ownerEvent.id,
    source: p.type === 'document' ? 'whatsapp_document' : 'whatsapp_contacts',
    sender_phone: sender,
    file_name: fileName,
    rows: staged as unknown as Json,
    row_count: staged.length,
    error_rows: errors as unknown as Json,
    source_message_id: wamid,
  });
  if (error) {
    await safeReply(from, sender, 'קליטת הרשימה נכשלה — נסו שוב בעוד רגע.');
    return true;
  }

  await safeReply(
    from,
    sender,
    buildSingleEventReply(ownerEvent, staged.length, errors.length, origin),
  );
  return true;
}

// Hard-split companion to stageWhatsAppImport: a VERIFIED owner sent a list to
// the RSVP number after the import number took the role. Nothing is staged; the
// owner gets ONE pointer FROM the RSVP number — a free-form reply inside the
// 24h window the owner just opened by writing to us (no template, no marketing
// content, so no 131049). Strangers get nothing, the same rule as staging.
// Returns true when the inbound was consumed (an import-shaped message from a
// mapped owner) so the caller skips the campaign/billing path.
export async function replyImportPointer(
  row: InboxRow,
  channel: WhatsAppChannel,
): Promise<boolean> {
  const p = readImportPayload(row.payload);
  if (!p) return false;
  const events = await resolveOwnerActiveEvents(p.from);
  if (events.length === 0) return false;
  const body = buildImportPointerReply(channel.importDisplayNumber);
  // `channel` structurally satisfies WhatsAppSender — the pointer deliberately
  // leaves from the RSVP number, the one the owner just wrote to.
  if (body) await safeReply(channel, p.from, body);
  return true;
}

async function safeReply(
  from: WhatsAppSender,
  to: string,
  body: string,
): Promise<void> {
  // Best-effort for the RUN — a refused reply must never fail the staging that
  // already succeeded — but NOT invisible any more.
  //
  // The outcome used to be discarded outright, and that is how a broken reply
  // went unnoticed for as long as it did: the list was staged, the owner was
  // told nothing, and no log, alert or row recorded that anything had failed.
  // The only symptom was a person saying "I didn't get a link".
  // ⚠️ NOTHING BELOW MAY THROW. The list is already staged by the time this
  // runs; a failed reply must cost the owner a link, never the import. The
  // try/catch is the guarantee, and it is not theoretical — adding the alert
  // broke nine existing tests, because reading a field off the outcome throws
  // the moment the send helper answers with anything unexpected. In production
  // that would have turned a refused reply into a failed staging.
  let outcome: Awaited<ReturnType<typeof sendWhatsAppText>> | undefined;
  try {
    outcome = await sendWhatsAppText(from, { to, body });
  } catch {
    outcome = undefined;
  }
  if (outcome?.kind === 'accepted') return;

  try {
    await reportFailedReply(from, outcome);
  } catch {
    // An alert that cannot be sent is not a reason to fail an import either.
  }
}

/**
 * Say that the owner's review link never arrived.
 *
 * The outcome used to be discarded outright, and that is how a broken reply went
 * unnoticed: the list staged, the owner was told nothing, and no log, alert or
 * row recorded a failure. The only symptom was a person saying "I didn't get a
 * link" — which is exactly how the wrong-sender bug surfaced on 2026-09-13.
 */
async function reportFailedReply(
  from: WhatsAppSender,
  outcome: Awaited<ReturnType<typeof sendWhatsAppText>> | undefined,
): Promise<void> {
  const reason =
    outcome === undefined
      ? 'השליחה נכשלה ללא תשובה מהספק'
      : outcome.kind === 'accepted'
        ? ''
        : outcome.reason;
  const code =
    outcome !== undefined && outcome.kind !== 'accepted' && outcome.providerCode
      ? ` (קוד ${outcome.providerCode})`
      : '';

  await sendSlackAlert({
    level: 'warn',
    title: 'תשובת ייבוא לבעל האירוע לא נשלחה',
    // NO recipient phone and NO body: the recipient is a person and the text
    // carries their event's name. The SENDING number and the provider's own
    // code are what a diagnosis actually needs — the sending number is the
    // field that would have named this bug on the first occurrence.
    detail:
      `הרשימה נקלטה אך הקישור לסקירה לא הגיע. מספר שולח: ${from.phoneNumberId}. ` +
      `סיבה: ${reason}${code}`,
    source: 'whatsapp',
    category: 'errors',
  });
}

// ---------------------------------------------------------------------------
// The workflow-facing half
// ---------------------------------------------------------------------------

/**
 * Stage a guest list that arrived on an inbox row, for `action.import_guest_list`.
 *
 * ⚠️ THE SAME WORK `stageWhatsAppImport` DOES, MINUS THE DECIDING.
 *
 * The hard-coded path owns three judgements that belong to it and not to a
 * workflow: which event an owner meant when several are active, whether the
 * sender is an owner at all, and what to reply. This does none of them — the
 * WORKFLOW decides what happens next, which is the entire point of the node. It
 * only reads, parses and stages.
 *
 * IT SHARES THE HARD-CODED PATH'S IDEMPOTENCY RATHER THAN COMPETING WITH IT.
 * Both write `source_message_id`, which is `UNIQUE ... WHERE NOT NULL`, so
 * whichever runs first stages and the other reports `duplicate: true` and hands
 * back the same review link. That is what lets a workflow be built around the
 * import TODAY, while the hard-coded path still runs, without double-staging and
 * without an ordering assumption between two things that run side by side.
 */
export type StageGuestListResult =
  | {
      ok: true;
      /** False when the list was already staged — by the other path, or by a replay. */
      created: boolean;
      /**
       * The parsed rows themselves.
       *
       * OWNER'S RULING 2026-09-13: return them, so the run log records WHAT
       * arrived and a later step can act on it (`{{nodes.<id>.rows}}` — post the
       * list onward, count a group, branch on a name).
       *
       * This is the place that record belongs. `guest_import_staging` is a work
       * queue and is wiped once the owner decides (see the confirm action); a run
       * log is an audit of what the automation did, and it is the one copy that
       * should outlive the decision.
       */
      rows: StagedRow[];
      rowCount: number;
      errorCount: number;
      fileName: string | null;
      source: string;
      reviewUrl: string;
    }
  | { ok: false; reason: 'not_a_list' | 'unreadable_file' | 'bad_file' | 'insert_failed'; message?: string };

export async function stageGuestListFromInbox(args: {
  inboxRowId: string;
  eventId: string;
}): Promise<StageGuestListResult> {
  const admin = createAdminClient();

  const { data: row } = await admin
    .from('webhook_inbox')
    .select('payload, phone_number_id')
    .eq('id', args.inboxRowId)
    .maybeSingle();

  const p = readImportPayload(row?.payload ?? null);
  if (!p) return { ok: false, reason: 'not_a_list' };

  const reviewUrl = importScreenUrl(resolveReplyOrigin(), args.eventId, 'whatsapp');
  const wamid = p.id ?? null;

  // Already staged — by the hard-coded path, or by a replay of this node. The
  // step lease can replay a completed node, so this branch is load-bearing and
  // not merely an optimisation.
  if (wamid) {
    const { data: already } = await admin
      .from('guest_import_staging')
      .select('rows, row_count, error_rows, file_name, source')
      .eq('source_message_id', wamid)
      .maybeSingle();
    if (already) {
      return {
        ok: true,
        created: false,
        // From the STORED row, so a replay reports the list the first attempt
        // staged. EMPTY once the owner has decided — the queue row is wiped
        // then — which is correct: the run that staged it already logged it.
        rows: (Array.isArray(already.rows) ? already.rows : []) as unknown as StagedRow[],
        rowCount: already.row_count,
        errorCount: Array.isArray(already.error_rows) ? already.error_rows.length : 0,
        fileName: already.file_name,
        source: already.source,
        reviewUrl,
      };
    }
  }

  let staged: StagedRow[] = [];
  let errors: Array<{ row: number; message: string }> = [];
  let fileName: string | null = null;

  if (p.type === 'document') {
    fileName = p.document?.filename ?? null;
    const mediaId = p.document?.id;
    const config = await getWhatsAppConfig();
    const bytes =
      mediaId && config
        ? await downloadDocument(mediaId, config.accessToken, row?.phone_number_id ?? null)
        : null;
    // The message names the limit, because "it failed" is useless to an owner
    // holding a spreadsheet.
    if (!bytes) return { ok: false, reason: 'unreadable_file' };
    const parsed = parseCsvToStagedRows(bytes);
    if ('error' in parsed) return { ok: false, reason: 'bad_file', message: parsed.error };
    staged = parsed.rows;
    errors = parsed.errors;
  } else {
    staged = contactsToStagedRows(row?.payload ?? null);
    if (staged.length === 0) return { ok: false, reason: 'not_a_list' };
  }

  const { error } = await admin.from('guest_import_staging').insert({
    event_id: args.eventId,
    source: p.type === 'document' ? 'whatsapp_document' : 'whatsapp_contacts',
    sender_phone: p.from,
    file_name: fileName,
    rows: staged as unknown as Json,
    row_count: staged.length,
    error_rows: errors as unknown as Json,
    source_message_id: wamid,
  });
  // A unique violation here is the other path winning the race between our read
  // above and this insert. It is a SUCCESS — the list is staged — not a failure.
  if (error) {
    if (error.code === '23505') {
      return {
        ok: true,
        created: false,
        rows: staged,
        rowCount: staged.length,
        errorCount: errors.length,
        fileName,
        source: p.type === 'document' ? 'whatsapp_document' : 'whatsapp_contacts',
        reviewUrl,
      };
    }
    return { ok: false, reason: 'insert_failed' };
  }

  return {
    ok: true,
    created: true,
    rows: staged,
    rowCount: staged.length,
    errorCount: errors.length,
    fileName,
    source: p.type === 'document' ? 'whatsapp_document' : 'whatsapp_contacts',
    reviewUrl,
  };
}
