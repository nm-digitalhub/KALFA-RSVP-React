import 'server-only';

import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { downloadLegalDoc } from '@/lib/storage/legal-docs';
import { graphClient, graphConfigured } from '@/lib/microsoft/graph-client';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { ISRAEL_TIME_ZONE } from '@/lib/date';

// Daily archive of signed customer agreements to SharePoint
// (docs/sharepoint-contracts-archive-plan-2026-09-06.md §6, owner decisions
// 2026-09-06): a pg-boss cron tick (worker/main.ts) calls
// runAgreementArchiveSweep() once a night. It reads signed_agreements rows not
// yet exported, verifies each stored PDF against the row's content_hash,
// uploads the PDF as-is (the hashed original — never converted) to the
// Customer-Agreements library under the signing year, writes the archive
// metadata (Contract content type) and marks the row.
//
// Supabase stays the SYSTEM OF RECORD: the evidentiary pack (OTP, verified
// phone, IP, user-agent, hash, signature image) lives there and must outlive
// the SharePoint copy. This job copies; it never deletes.
//
// Owner ruling 2026-09-06: the customer's details (name, verified phone) and the
// signing evidence go INTO the archive metadata — the copy exists for legal
// defence and is useless without them. The FILE NAME stays id-based (URLs and
// logs carry it); the personal data sits in list columns only.
//
// Idempotency: the row is selected on sharepoint_exported_at IS NULL and marked
// only after upload + metadata succeed; the upload itself uses
// conflictBehavior=fail, so a re-run after a crash finds the file already there
// and adopts it only when its recorded hash matches.

export const ARCHIVE_LIBRARY = 'Customer-Agreements';
export const RETENTION_YEARS = 7;
const BATCH_SIZE = 25;

type AdminClient = ReturnType<typeof createAdminClient>;

// Read lazily (see graph-client.ts for why: the worker loads .env.local after
// imports are evaluated).
function env(name: string): string {
  return process.env[name] ?? '';
}

/**
 * The SharePoint site holding the archive, as a Graph site reference, e.g.
 * "kalfarsvp.sharepoint.com:/sites/KALFARSVP". A deployment decision, like
 * MS_GRAPH_PRIMARY_MAILBOX. Empty = the sweep is a no-op.
 */
export function archiveSiteRef(): string {
  return env('SHAREPOINT_ARCHIVE_SITE');
}

/** Kill-switch — false (and the sweep a no-op) unless an admin explicitly arms it. */
export async function getAgreementArchiveEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('agreement_archive_enabled')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return data.agreement_archive_enabled === true;
  } catch {
    return false;
  }
}

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** Calendar date in Israel for a timestamp, as YYYY-MM-DD (timeZone-pinned, never a UTC slice). */
export function israelDateOnly(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Retention end for a customer agreement: 31 December of the anchor's Israel
 * calendar year + RETENTION_YEARS (plan §5 — anchored to the event's tax
 * year; the signing date is the fallback when the event has no date).
 */
export function retentionUntil(anchorIso: string): string | null {
  const day = israelDateOnly(anchorIso);
  if (!day) return null;
  return `${Number(day.slice(0, 4)) + RETENTION_YEARS}-12-31`;
}

const NON_ASCII_SAFE = /[^A-Za-z0-9.-]+/g;

/**
 * Plan §2: `YYYY-MM-DD_CA_<campaign-id-8>_v<agreement_version>_<sha256-8>.pdf`.
 * ASCII only, ids not names — the name travels through URLs and logs.
 */
export function archiveFileName(input: {
  signedAt: string;
  campaignId: string;
  agreementVersion: string;
  contentHash: string;
}): string | null {
  const day = israelDateOnly(input.signedAt);
  if (!day) return null;
  const version =
    input.agreementVersion.replace(NON_ASCII_SAFE, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return `${day}_CA_${input.campaignId.slice(0, 8)}_v${version}_${input.contentHash.slice(0, 8)}.pdf`;
}

export type ArchiveRow = {
  id: string;
  campaign_id: string;
  event_id: string;
  signer_user_id: string;
  agreement_version: string;
  content_hash: string;
  pdf_ref: string | null;
  signed_at: string;
  verified_phone: string | null;
  otp_verified_at: string | null;
  ip: string | null;
  user_agent: string | null;
  signature_ref: string | null;
  id_document_ref: string | null;
};

export type ArchiveContext = {
  eventName: string | null;
  eventDate: string | null;
  eventVenue: string | null;
  signerName: string | null;
  signerEmail: string | null;
  signerPhone: string | null;
  nowMs: number;
};

/**
 * The `Contract` content-type columns for the archived copy (plan §3/§6).
 * Keys are SharePoint internal column names. Dates go out as UTC midnight of
 * the Israel calendar day, which the date-only columns display unchanged.
 */
export function archiveFields(row: ArchiveRow, ctx: ArchiveContext): Record<string, string> {
  const campaign8 = row.campaign_id.slice(0, 8);
  const signedDay = israelDateOnly(row.signed_at);
  const eventDay = ctx.eventDate ? israelDateOnly(ctx.eventDate) : null;
  const retention = retentionUntil(ctx.eventDate ?? row.signed_at);
  const eventMs = ctx.eventDate ? Date.parse(ctx.eventDate) : NaN;
  const eventPassed = !Number.isNaN(eventMs) && eventMs < ctx.nowMs;

  // The COMPLETE evidence pack next to the PDF, one key per line. Owner ruling
  // 2026-09-06 ("אל תשמיט שום פרט, כולל PII"): every fact the system holds
  // about the signing goes into the archive — identity, contact details,
  // channel evidence, storage refs, event context. Nothing is filtered out.
  const notes = [
    `signed_agreements.id=${row.id}`,
    `agreement_version=${row.agreement_version}`,
    `signed_at=${row.signed_at}`,
    `content_hash=${row.content_hash}`,
    `pdf_ref=${row.pdf_ref ?? ''}`,
    `signature_ref=${row.signature_ref ?? ''}`,
    `id_document_ref=${row.id_document_ref ?? ''}`,
    `campaign_id=${row.campaign_id}`,
    `event_id=${row.event_id}`,
    `event_name=${ctx.eventName ?? ''}`,
    `event_date=${ctx.eventDate ?? ''}`,
    `event_venue=${ctx.eventVenue ?? ''}`,
    `signer_user_id=${row.signer_user_id}`,
    `signer_name=${ctx.signerName ?? ''}`,
    `signer_email=${ctx.signerEmail ?? ''}`,
    `signer_profile_phone=${ctx.signerPhone ?? ''}`,
    `verified_phone=${row.verified_phone ?? ''}`,
    `otp_verified_at=${row.otp_verified_at ?? ''}`,
    `ip=${row.ip ?? ''}`,
    `user_agent=${row.user_agent ?? ''}`,
  ].join('\n');

  const fields: Record<string, string> = {
    Title: ctx.signerName ? `הסכם לקוח ${campaign8} · ${ctx.signerName}` : `הסכם לקוח ${campaign8}`,
    Counterparty: ctx.signerName ?? '',
    ContractType: 'Customer-Agreement',
    Status: eventPassed ? 'Expired' : 'Active',
    ExternalRef: row.campaign_id,
    SHA256: row.content_hash,
    DataClass: 'Personal-Data',
    ArchiveNotes: notes,
  };
  if (signedDay) fields.EffectiveDate = `${signedDay}T00:00:00Z`;
  if (eventDay) fields.ExpiryDate = `${eventDay}T00:00:00Z`;
  if (retention) fields.RetentionUntil = `${retention}T00:00:00Z`;
  return fields;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Fail-closed narrowing of a select('*') row: a malformed row is skipped, never
// exported half-described.
function narrowRow(raw: Record<string, unknown>): ArchiveRow | null {
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : null);
  const id = str('id');
  const campaignId = str('campaign_id');
  const eventId = str('event_id');
  const signerUserId = str('signer_user_id');
  const version = str('agreement_version');
  const hash = str('content_hash');
  const signedAt = str('signed_at');
  if (!id || !campaignId || !eventId || !signerUserId || !version || !hash || !signedAt) return null;
  return {
    id,
    campaign_id: campaignId,
    event_id: eventId,
    signer_user_id: signerUserId,
    agreement_version: version,
    content_hash: hash,
    pdf_ref: str('pdf_ref'),
    signed_at: signedAt,
    verified_phone: str('verified_phone'),
    otp_verified_at: str('otp_verified_at'),
    ip: str('ip'),
    user_agent: str('user_agent'),
    signature_ref: str('signature_ref'),
    id_document_ref: str('id_document_ref'),
  };
}

// ── Graph ───────────────────────────────────────────────────────────────────

function graphStatus(err: unknown): number {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    return Number((err as { statusCode?: unknown }).statusCode);
  }
  return NaN;
}

type ArchiveTarget = {
  driveId: string;
  /** Logical column name (as in archiveFields) → the library's internal field name. */
  fieldNames: Map<string, string>;
};

let cachedTarget: ArchiveTarget | null = null;

/**
 * SharePoint escapes characters it dislikes in a LIST column's internal name
 * as `_xHHHH_` (the site column `SHA256` became `_x0053_HA256` on the library,
 * verified 2026-09-06 — the first sweep failed on "Field 'SHA256' is not
 * recognized"). Decode so logical names can be matched against what the
 * library actually exposes.
 */
export function decodeInternalName(name: string): string {
  return name.replace(/_x([0-9a-fA-F]{4})_/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/** Map every logical key in `fields` to the library's internal field name (unknown keys pass through). */
export function translateFields(
  fields: Record<string, string>,
  fieldNames: Map<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) out[fieldNames.get(key) ?? key] = value;
  return out;
}

/** The drive behind ARCHIVE_LIBRARY on the archive site plus its field-name map. Resolved once per process. */
async function resolveArchiveTarget(): Promise<ArchiveTarget> {
  if (cachedTarget) return cachedTarget;
  const g = graphClient();
  const site = (await g.api(`/sites/${archiveSiteRef()}?$select=id`).get()) as { id: string };
  const lists = (await g.api(`/sites/${site.id}/lists?$select=id,displayName&$top=200`).get()) as {
    value: Array<{ id: string; displayName: string }>;
  };
  const list = lists.value.find((l) => l.displayName === ARCHIVE_LIBRARY);
  if (!list) throw new Error('archive_library_missing');
  const drive = (await g.api(`/sites/${site.id}/lists/${list.id}/drive?$select=id`).get()) as {
    id: string;
  };
  const columns = (await g
    .api(`/sites/${site.id}/lists/${list.id}/columns?$select=name,readOnly&$top=200`)
    .get()) as { value: Array<{ name: string; readOnly?: boolean }> };
  const fieldNames = new Map<string, string>();
  for (const c of columns.value) {
    if (c.readOnly) continue;
    fieldNames.set(c.name, c.name);
    fieldNames.set(decodeInternalName(c.name), c.name);
  }
  cachedTarget = { driveId: drive.id, fieldNames };
  return cachedTarget;
}

async function ensureYearFolder(driveId: string, year: string): Promise<void> {
  const g = graphClient();
  try {
    await g.api(`/drives/${driveId}/root:/${year}?$select=id`).get();
    return;
  } catch (err) {
    if (graphStatus(err) !== 404) throw err;
  }
  await g
    .api(`/drives/${driveId}/root/children`)
    .post({ name: year, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
}

type ExistingItem = {
  id: string;
  size?: number;
  listItem?: { fields?: Record<string, unknown> };
};

/**
 * Upload with conflictBehavior=fail. A 409 means a previous run uploaded this
 * exact name (it embeds the hash prefix) and crashed before marking the row:
 * adopt the existing file when its recorded SHA256 matches, or when it has no
 * metadata yet but the same byte size (metadata is written right after).
 */
async function uploadPdf(
  target: ArchiveTarget,
  year: string,
  name: string,
  bytes: Uint8Array,
  hash: string,
): Promise<{ id: string; existed: boolean }> {
  const g = graphClient();
  const { driveId } = target;
  const path = `/drives/${driveId}/root:/${year}/${name}:/content?@microsoft.graph.conflictBehavior=fail`;
  try {
    const item = (await g.api(path).put(Buffer.from(bytes))) as { id: string };
    return { id: item.id, existed: false };
  } catch (err) {
    if (graphStatus(err) !== 409) throw err;
  }
  const existing = (await g
    .api(`/drives/${driveId}/root:/${year}/${name}?$select=id,size&$expand=listItem($expand=fields)`)
    .get()) as ExistingItem;
  const shaField = target.fieldNames.get('SHA256') ?? 'SHA256';
  const recorded = existing.listItem?.fields?.[shaField];
  if (recorded === hash) return { id: existing.id, existed: true };
  if (!recorded && existing.size === bytes.byteLength) return { id: existing.id, existed: true };
  throw new Error('archive_conflict_hash_mismatch');
}

// ── The sweep ───────────────────────────────────────────────────────────────

export type ArchiveSweepResult = { exported: number; skipped: number; failed: number };

export async function runAgreementArchiveSweep(nowMs: number = Date.now()): Promise<ArchiveSweepResult> {
  const result: ArchiveSweepResult = { exported: 0, skipped: 0, failed: 0 };
  if (!graphConfigured() || !archiveSiteRef()) {
    console.warn('[agreement-archive] not configured (MS_GRAPH_* / SHAREPOINT_ARCHIVE_SITE); sweep skipped');
    return result;
  }

  const admin: AdminClient = createAdminClient();
  const { data: rows, error } = await admin
    .from('signed_agreements')
    .select('*')
    .is('sharepoint_exported_at', null)
    .order('signed_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error('קריאת ההסכמים לארכיון נכשלה');
  const pending = ((rows ?? []) as Record<string, unknown>[])
    .map(narrowRow)
    .filter((r): r is ArchiveRow => r !== null);
  if (pending.length === 0) return result;

  // ONE batched read per table for the whole batch, never one per row.
  const eventIds = Array.from(new Set(pending.map((r) => r.event_id)));
  const signerIds = Array.from(new Set(pending.map((r) => r.signer_user_id)));
  const { data: events } = await admin
    .from('events')
    .select('id, name, event_date, venue_name')
    .in('id', eventIds);
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, phone, phone_verified_e164')
    .in('id', signerIds);
  const eventById = new Map(
    (events ?? []).map(
      (e) => [e.id, { name: e.name, event_date: e.event_date, venue: e.venue_name }] as const,
    ),
  );
  const signerById = new Map(
    (profiles ?? []).map(
      (p) => [p.id, { name: p.full_name, phone: p.phone_verified_e164 ?? p.phone }] as const,
    ),
  );
  // The sign-in email lives in auth.users, not profiles — one admin read per
  // distinct signer (≤ BATCH_SIZE). A failed lookup leaves the field empty
  // rather than failing the export; the row itself still carries the user id.
  const signerEmailById = new Map<string, string | null>();
  for (const id of signerIds) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      signerEmailById.set(id, data.user?.email ?? null);
    } catch {
      signerEmailById.set(id, null);
    }
  }

  const target = await resolveArchiveTarget();
  const { driveId } = target;
  const failures: string[] = [];

  for (const row of pending) {
    try {
      if (!row.pdf_ref) {
        // Nothing stored to archive (legacy row). Counted, not marked — visible
        // in the summary until resolved by hand.
        result.skipped++;
        continue;
      }
      const bytes = await downloadLegalDoc(row.pdf_ref);
      const hash = sha256Hex(bytes);
      if (hash !== row.content_hash) {
        // Fixity failure on the SOURCE — never archive a file that does not
        // match its evidentiary hash. ids only in the alert.
        result.failed++;
        failures.push(row.id);
        void sendSlackAlert({
          level: 'error',
          category: 'errors',
          source: 'agreement-archive',
          title: 'הסכם חתום לא תואם ל-hash הראייתי',
          detail: 'הקובץ ב-storage אינו תואם ל-content_hash — לא יוצא לארכיון. נדרשת בדיקה ידנית.',
          fields: { agreement: row.id, campaign: row.campaign_id },
        });
        continue;
      }
      const ev = eventById.get(row.event_id);
      const signer = signerById.get(row.signer_user_id);
      const ctx: ArchiveContext = {
        eventName: ev?.name ?? null,
        eventDate: ev?.event_date ?? null,
        eventVenue: ev?.venue ?? null,
        signerName: signer?.name ?? null,
        signerEmail: signerEmailById.get(row.signer_user_id) ?? null,
        signerPhone: signer?.phone ?? null,
        nowMs,
      };
      const name = archiveFileName({
        signedAt: row.signed_at,
        campaignId: row.campaign_id,
        agreementVersion: row.agreement_version,
        contentHash: row.content_hash,
      });
      const signedDay = israelDateOnly(row.signed_at);
      if (!name || !signedDay) throw new Error('archive_bad_signed_at');
      const year = signedDay.slice(0, 4);

      await ensureYearFolder(driveId, year);
      const item = await uploadPdf(target, year, name, bytes, hash);
      await graphClient()
        .api(`/drives/${driveId}/items/${item.id}/listItem/fields`)
        .patch(translateFields(archiveFields(row, ctx), target.fieldNames));

      const { error: markErr } = await admin
        .from('signed_agreements')
        .update({
          sharepoint_exported_at: new Date(nowMs).toISOString(),
          sharepoint_item_id: item.id,
        })
        .eq('id', row.id)
        .is('sharepoint_exported_at', null);
      if (markErr) throw new Error('סימון הייצוא נכשל');
      result.exported++;
    } catch (err) {
      result.failed++;
      failures.push(row.id);
      // ids only — never the bytes, the name or the phone.
      console.error('[agreement-archive] export failed', {
        agreementId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log('[agreement-archive] sweep', { ...result, batch: pending.length });
  if (result.failed > 0) {
    void sendSlackAlert({
      level: 'error',
      category: 'errors',
      source: 'agreement-archive',
      title: 'ייצוא הסכמים לארכיון SharePoint — כשלים',
      detail: `יוצאו ${result.exported} · דולגו ${result.skipped} · כשלו ${result.failed}`,
      fields: { exported: result.exported, skipped: result.skipped, failed: result.failed, ids: failures.join(',') },
    });
  }
  return result;
}
