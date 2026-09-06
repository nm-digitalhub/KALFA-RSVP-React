import 'server-only';

import { archiveGraphClient, archiveIdentity, graphConfigured } from '@/lib/microsoft/graph-client';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  archiveSiteRef,
  resolveLibraryTarget,
  sha256Hex,
  translateFields,
  type ArchiveTarget,
} from '@/lib/data/agreement-archive';

// Weekly maintenance of the SharePoint contracts archive
// (docs/sharepoint-contracts-archive-plan-2026-09-06.md §7–§8, automated
// 2026-09-06 at the owner's request). One pg-boss tick (worker/main.ts,
// Sunday 04:10 Asia/Jerusalem) walks the Contracts and Customer-Agreements
// libraries through Graph and:
//
//   1. fixity — recomputes SHA-256 of every file that has a recorded hash and
//      reports mismatches (never "fixes" a mismatch: a changed record is an
//      incident, see plan §8);
//   2. intake help — a Contracts file uploaded by hand without a hash gets its
//      SHA-256 computed and written (the human intake step the rules ask for,
//      done by the machine);
//   3. status upkeep — Status 'Active' with an ExpiryDate in the past becomes
//      'Expired' (display-level truth; no file is touched);
//   4. disposition + expiry watch — lists items whose RetentionUntil passed
//      without a legal hold, and active contracts expiring within 90 days.
//
// It never deletes, never moves and never rewrites a file. Slack gets one
// summary per run; file NAMES are id-based by the naming rule, so the report
// carries no personal data. Gated by the same switch as the nightly export
// (app_settings.agreement_archive_enabled).

export const MAINTAINED_LIBRARIES = ['Contracts', 'Customer-Agreements'] as const;
export type MaintainedLibrary = (typeof MAINTAINED_LIBRARIES)[number];

const MAX_FILES_PER_RUN = 300;
const MAX_BYTES_PER_FILE = 25 * 1024 * 1024;
const DAY_MS = 86_400_000;
export const EXPIRING_WINDOW_MS = 90 * DAY_MS;

export type ArchiveFile = {
  id: string;
  name: string;
  /** Library-relative path, e.g. "01-Vendors/Meta/2026-07-15_Meta_Terms_v1_signed.pdf". */
  path: string;
  size: number;
  fields: Record<string, unknown>;
};

export type FileDecision = {
  fillHash: boolean;
  verifyHash: boolean;
  missingHash: boolean;
  markExpired: boolean;
  due: boolean;
  expiring: boolean;
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function dateMs(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/** Read a logical column off the item fields, whatever the library's internal name is. */
export function fieldValue(fields: Record<string, unknown>, target: ArchiveTarget, logical: string): unknown {
  return fields[target.fieldNames.get(logical) ?? logical];
}

/** Pure: what the sweep should do with one file. */
export function decideForFile(
  fields: Record<string, unknown>,
  target: ArchiveTarget,
  library: MaintainedLibrary,
  nowMs: number,
): FileDecision {
  const sha = str(fieldValue(fields, target, 'SHA256'));
  const status = str(fieldValue(fields, target, 'Status'));
  const expiry = dateMs(fieldValue(fields, target, 'ExpiryDate'));
  const retention = dateMs(fieldValue(fields, target, 'RetentionUntil'));
  const hold = fieldValue(fields, target, 'LegalHold') === true;
  const active = status === 'Active';
  return {
    // Hand-uploaded contracts get their hash computed; on Customer-Agreements
    // the nightly export writes it, so a missing one there is an anomaly.
    fillHash: !sha && library === 'Contracts',
    missingHash: !sha && library !== 'Contracts',
    verifyHash: sha !== null,
    markExpired: active && expiry !== null && expiry < nowMs,
    due: retention !== null && retention <= nowMs && !hold,
    expiring: active && expiry !== null && expiry >= nowMs && expiry - nowMs <= EXPIRING_WINDOW_MS,
  };
}

type DriveChild = {
  id: string;
  name: string;
  size?: number;
  folder?: unknown;
  file?: unknown;
  listItem?: { fields?: Record<string, unknown> };
};

/** Every file under the drive root (recursive), with its list-item fields. Names starting with "_" are archive notes, not records. */
export async function listArchiveFiles(driveId: string, path = ''): Promise<ArchiveFile[]> {
  const g = archiveGraphClient();
  const base = path ? `/drives/${driveId}/root:/${encodeURI(path)}:/children` : `/drives/${driveId}/root/children`;
  const out: ArchiveFile[] = [];
  let next: string | null = `${base}?$select=id,name,size,folder,file&$expand=listItem($expand=fields)&$top=200`;
  while (next) {
    const page = (await g.api(next).get()) as { value: DriveChild[]; '@odata.nextLink'?: string };
    for (const c of page.value) {
      const childPath = path ? `${path}/${c.name}` : c.name;
      if (c.folder) {
        out.push(...(await listArchiveFiles(driveId, childPath)));
        continue;
      }
      if (!c.file || c.name.startsWith('_')) continue;
      out.push({ id: c.id, name: c.name, path: childPath, size: c.size ?? 0, fields: c.listItem?.fields ?? {} });
    }
    next = page['@odata.nextLink'] ?? null;
  }
  return out;
}

async function downloadBytes(driveId: string, itemId: string): Promise<Uint8Array> {
  const buf = (await archiveGraphClient()
    .api(`/drives/${driveId}/items/${itemId}/content`)
    .responseType('arraybuffer' as never)
    .get()) as ArrayBuffer;
  return new Uint8Array(buf);
}

export type MaintenanceResult = {
  scanned: number;
  hashesFilled: number;
  hashesVerified: number;
  mismatches: string[];
  missingHashes: string[];
  expiredMarked: number;
  due: string[];
  expiring: string[];
  skippedLarge: number;
  errors: number;
};

const empty = (): MaintenanceResult => ({
  scanned: 0,
  hashesFilled: 0,
  hashesVerified: 0,
  mismatches: [],
  missingHashes: [],
  expiredMarked: 0,
  due: [],
  expiring: [],
  skippedLarge: 0,
  errors: 0,
});

export async function runArchiveMaintenanceSweep(nowMs: number = Date.now()): Promise<MaintenanceResult> {
  const result = empty();
  if (!graphConfigured() || !archiveSiteRef()) {
    console.warn('[archive-maintenance] not configured (MS_GRAPH_* / SHAREPOINT_ARCHIVE_SITE); sweep skipped');
    return result;
  }

  for (const library of MAINTAINED_LIBRARIES) {
    let target: ArchiveTarget;
    let files: ArchiveFile[];
    try {
      target = await resolveLibraryTarget(library);
      files = await listArchiveFiles(target.driveId);
    } catch (err) {
      result.errors++;
      console.error('[archive-maintenance] library unreadable', {
        library,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (const file of files) {
      if (result.scanned >= MAX_FILES_PER_RUN) break;
      result.scanned++;
      const label = `${library}/${file.path}`;
      try {
        const d = decideForFile(file.fields, target, library, nowMs);
        if (d.missingHash) result.missingHashes.push(label);
        if (d.fillHash || d.verifyHash) {
          if (file.size > MAX_BYTES_PER_FILE) {
            result.skippedLarge++;
          } else {
            const hash = sha256Hex(await downloadBytes(target.driveId, file.id));
            if (d.fillHash) {
              await archiveGraphClient()
                .api(`/drives/${target.driveId}/items/${file.id}/listItem/fields`)
                .patch(translateFields({ SHA256: hash }, target.fieldNames));
              result.hashesFilled++;
            } else {
              result.hashesVerified++;
              const recorded = str(fieldValue(file.fields, target, 'SHA256'));
              if (recorded !== hash) result.mismatches.push(label);
            }
          }
        }
        if (d.markExpired) {
          await archiveGraphClient()
            .api(`/drives/${target.driveId}/items/${file.id}/listItem/fields`)
            .patch(translateFields({ Status: 'Expired' }, target.fieldNames));
          result.expiredMarked++;
        }
        if (d.due) result.due.push(label);
        if (d.expiring) result.expiring.push(label);
      } catch (err) {
        result.errors++;
        console.error('[archive-maintenance] file failed', {
          file: label,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  console.log('[archive-maintenance] sweep', {
    identity: archiveIdentity(),
    ...result,
    mismatches: result.mismatches.length,
    missingHashes: result.missingHashes.length,
    due: result.due.length,
    expiring: result.expiring.length,
  });

  const failed = result.mismatches.length > 0 || result.errors > 0;
  const top = (xs: string[]) => xs.slice(0, 10).join('\n') + (xs.length > 10 ? `\n… +${xs.length - 10}` : '');
  void sendSlackAlert({
    level: failed ? 'error' : 'info',
    category: 'security',
    source: 'archive-maintenance',
    title: failed ? 'בדיקת שלמות הארכיון — נמצאו בעיות' : 'בדיקת ארכיון שבועית',
    detail: [
      `נסרקו ${result.scanned} · אומתו ${result.hashesVerified} · hash הושלם ${result.hashesFilled} · סומנו Expired ${result.expiredMarked}`,
      result.mismatches.length ? `אי-התאמת SHA-256 (${result.mismatches.length}):\n${top(result.mismatches)}` : null,
      result.missingHashes.length ? `ללא hash בהסכמי לקוחות (${result.missingHashes.length}):\n${top(result.missingHashes)}` : null,
      result.due.length ? `לביעור — תאריך השימור עבר (${result.due.length}):\n${top(result.due)}` : null,
      result.expiring.length ? `מסתיימים ב-90 יום (${result.expiring.length}):\n${top(result.expiring)}` : null,
      result.skippedLarge ? `דולגו (מעל 25MB): ${result.skippedLarge}` : null,
      result.errors ? `שגיאות: ${result.errors}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join('\n'),
    fields: {
      scanned: result.scanned,
      verified: result.hashesVerified,
      filled: result.hashesFilled,
      mismatches: result.mismatches.length,
      due: result.due.length,
      expiring: result.expiring.length,
      errors: result.errors,
    },
  });
  return result;
}
