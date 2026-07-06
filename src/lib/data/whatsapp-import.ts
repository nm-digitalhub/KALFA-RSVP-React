import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { sendWhatsAppText } from '@/lib/whatsapp/client';
import { decodeCsvBuffer, parseCsv, sniffSpreadsheetBinary } from '@/lib/csv';
import { normalizePhone, repairIsraeliLocalPhone } from '@/lib/phone';
import { importRowSchema } from '@/lib/validation/guests';
import { guestImportHeaderKey } from '@/lib/data/guest-import-shared';
import { ISRAELI_PHONE_RE } from '@/lib/constants';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import type { Database, Json } from '@/lib/supabase/types';

type EventType = Database['public']['Enums']['event_type'];

// The minimum an owner's active event needs for import routing + the reply
// label. `name` is the owner's free-text title (may be empty → type label).
export type ImportEvent = { id: string; name: string | null; event_type: EventType };

// WhatsApp guest-import channel: a VERIFIED owner sends the business number a
// CSV document or shared contact cards → the worker parses them into PENDING
// guest_import_staging rows and replies with a review link. Guests are
// created ONLY when confirmed in the app. Unmapped senders are ignored
// entirely (no download, no reply — nothing leaks about the system).

type InboxRow = {
  payload: Json | null;
};

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
async function resolveOwnerActiveEvents(
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
    const { data: allowedRoles } = await admin
      .from('role_permissions')
      .select('role_id, permission_definitions!inner(resource, action)')
      .in('role_id', memberships.map((m) => m.role_id))
      .eq('permission_definitions.resource', 'guests')
      .eq('permission_definitions.action', 'create');
    const okRoles = new Set((allowedRoles ?? []).map((r) => r.role_id));
    const orgIds = memberships
      .filter((m) => okRoles.has(m.role_id))
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
    const phones = (c as { phones?: Array<{ phone?: unknown }> }).phones;
    const rawPhone = Array.isArray(phones) && typeof phones[0]?.phone === 'string' ? phones[0].phone : '';
    if (typeof name !== 'string' || name.trim() === '') continue;
    const local = rawPhone ? repairIsraeliLocalPhone(rawPhone) ?? rawPhone : '';
    rows.push({
      full_name: name.trim().slice(0, 200),
      phone: local || null,
      expected_count: null,
      group: '',
    });
  }
  return rows;
}

async function downloadDocument(
  mediaId: string,
  accessToken: string,
): Promise<Uint8Array | null> {
  try {
    const meta = (await (
      await fetch(`https://graph.facebook.com/v23.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    ).json()) as { url?: string; file_size?: number };
    if (!meta.url || (meta.file_size ?? 0) > MAX_DOC_BYTES) return null;
    const res = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength <= MAX_DOC_BYTES ? buf : null;
  } catch {
    return null;
  }
}

// Entry point from the webhook processor. Returns true when the inbound was
// CONSUMED as an import (mapped owner + document/contacts) — the caller then
// skips the campaign/billing path entirely.
export async function stageWhatsAppImport(row: InboxRow): Promise<boolean> {
  const payload = row.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as { type?: string; from?: string; document?: { id?: string; filename?: string } };
  if (p.type !== 'document' && p.type !== 'contacts') return false;

  const sender = typeof p.from === 'string' ? normalizePhone(p.from) : null;
  if (!sender) return false;
  const events = await resolveOwnerActiveEvents(sender);
  if (events.length === 0) return false; // stranger → silently not-an-import

  const config = await getWhatsAppConfig();
  if (!config) return true; // consumed (owner intent) but channel off

  // Worker context has no request — getAppUrl's header path throws there (live
  // incident 2026-07-05: 'Invalid URL' left the inbox row retrying). Defensive:
  // tolerate an inline comment/whitespace in the env value (live incident: the
  // reply carried the comment inside the link).
  const origin =
    process.env.APP_ORIGIN?.split(/[\s#]/)[0]?.trim() || 'https://beta.kalfa.me';

  // More than one active event the sender may manage: NEVER guess which one
  // (misroute incident 2026-07-06 — a brit guest list landed on a newer active
  // event because "newest wins"). Stage nothing; ask the owner to upload the
  // file on the correct event's import screen.
  if (events.length > 1) {
    await safeReply(config, sender, buildAmbiguousEventReply(events, origin));
    return true;
  }

  const ownerEvent = events[0];

  let staged: StagedRow[] = [];
  let errors: Array<{ row: number; message: string }> = [];
  let fileName: string | null = null;

  if (p.type === 'document') {
    fileName = p.document?.filename ?? null;
    const mediaId = p.document?.id;
    const bytes = mediaId ? await downloadDocument(mediaId, config.accessToken) : null;
    if (!bytes) {
      await safeReply(config, sender, 'לא הצלחנו לקרוא את הקובץ (עד 1MB, CSV בלבד). נסו לשלוח שוב.');
      return true;
    }
    const parsed = parseCsvToStagedRows(bytes);
    if ('error' in parsed) {
      await safeReply(config, sender, parsed.error);
      return true;
    }
    staged = parsed.rows;
    errors = parsed.errors;
  } else {
    staged = contactsToStagedRows(payload);
    if (staged.length === 0) return true;
  }

  const admin = createAdminClient();
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
  });
  if (error) {
    await safeReply(config, sender, 'קליטת הרשימה נכשלה — נסו שוב בעוד רגע.');
    return true;
  }

  await safeReply(
    config,
    sender,
    buildSingleEventReply(ownerEvent, staged.length, errors.length, origin),
  );
  return true;
}

async function safeReply(
  config: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  to: string,
  body: string,
): Promise<void> {
  try {
    await sendWhatsAppText(config, { to, body });
  } catch {
    /* replies are best-effort */
  }
}
