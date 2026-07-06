import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { sendWhatsAppText } from '@/lib/whatsapp/client';
import { decodeCsvBuffer, parseCsv, sniffSpreadsheetBinary } from '@/lib/csv';
import { normalizePhone, repairIsraeliLocalPhone } from '@/lib/phone';
import { importRowSchema } from '@/lib/validation/guests';
import { guestImportHeaderKey } from '@/lib/data/guest-import-shared';
import { ISRAELI_PHONE_RE } from '@/lib/constants';
import type { Json } from '@/lib/supabase/types';

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

// profiles.phone (verified) → user → the single ACTIVE event that user may
// MANAGE: their own, or a shared-org event where their role holds
// guests.create (phase-3 model — so an org member like a co-managing brother
// can send lists too). Newest active event wins when several qualify.
async function resolveOwnerActiveEvent(
  senderE164: string,
): Promise<{ eventId: string } | null> {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, phone')
    .not('phone', 'is', null);
  const sender = (profiles ?? []).find(
    (p) => normalizePhone(p.phone) === senderE164,
  );
  if (!sender) return null;

  const { data: owned } = await admin
    .from('events')
    .select('id, created_at')
    .eq('owner_id', sender.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: memberships } = await admin
    .from('organization_members')
    .select('organization_id, role_id')
    .eq('user_id', sender.id);
  let shared: Array<{ id: string; created_at: string }> = [];
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
        .select('id, created_at')
        .in('org_id', orgIds)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);
      shared = data ?? [];
    }
  }

  const candidates = [...(owned ?? []), ...shared].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  return candidates.length > 0 ? { eventId: candidates[0].id } : null;
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
  const ownerEvent = await resolveOwnerActiveEvent(sender);
  if (!ownerEvent) return false; // stranger → silently not-an-import

  const config = await getWhatsAppConfig();
  if (!config) return true; // consumed (owner intent) but channel off

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
    .eq('event_id', ownerEvent.eventId)
    .eq('sender_phone', sender)
    .eq('status', 'pending');
  const stagedJson = JSON.stringify(staged);
  const isDupe = (dupes ?? []).some((d) => JSON.stringify(d.rows) === stagedJson);
  const { error } = isDupe
    ? { error: null }
    : await admin.from('guest_import_staging').insert({
    event_id: ownerEvent.eventId,
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

  // Worker context has no request — getAppUrl's header path throws there
  // (live incident 2026-07-05: 'Invalid URL' left the inbox row retrying).
  // Defensive: tolerate an inline comment/whitespace in the env value
  // (live incident: the reply carried the comment inside the link).
  const origin =
    process.env.APP_ORIGIN?.split(/[\s#]/)[0]?.trim() || 'https://beta.kalfa.me';
  const link = `${origin}/app/events/${ownerEvent.eventId}/guests/import/whatsapp`;
  await safeReply(
    config,
    sender,
    `נקלטו ${staged.length} שורות${errors.length ? ` (${errors.length} עם שגיאות)` : ''}.\nלסקירה ואישור הייבוא:\n${link}`,
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
