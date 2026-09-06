import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { archiveGraphClient, archiveIdentity, graphConfigured } from '@/lib/microsoft/graph-client';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { archiveSiteRef, resolveLibraryTarget, sha256Hex } from '@/lib/data/agreement-archive';
import { listArchiveFiles } from '@/lib/data/archive-maintenance';

// Monthly independent backup of everything the archive depends on
// (docs/sharepoint-contracts-archive-plan-2026-09-06.md §11).
//
// Two sources, one destination:
//   - SharePoint: Contracts, Contracts-Working, Customer-Agreements.
//     Supplier contracts live ONLY there, and SharePoint's only safety net is
//     a 93-day recycle bin.
//   - Supabase id-documents: the signed agreement PDFs and signature images.
//     Owner instruction 2026-09-06 — back these up too, don't assume the
//     system of record is safe by being the system of record.
//
// The destination is a content-addressed store in the private archive-backup
// bucket: `objects/<sha[0:2]>/<sha>` holds each distinct file exactly once,
// and `manifests/<date>.json` records what that snapshot contained. So a
// monthly run only uploads what changed, an unchanged file is never rewritten,
// and no run can clobber an earlier snapshot's bytes. Restoring = read a
// manifest, fetch each object by its hash.
//
// It never deletes anything, in either source or destination.

export const BACKUP_BUCKET = 'archive-backup';
export const SOURCE_BUCKET = 'id-documents';
export const BACKED_UP_LIBRARIES = ['Contracts', 'Contracts-Working', 'Customer-Agreements'] as const;

const MAX_BYTES_PER_FILE = 50 * 1024 * 1024;
const MAX_FILES_PER_RUN = 2000;

type AdminClient = ReturnType<typeof createAdminClient>;

export type BackupEntry = {
  /** "sharepoint/Contracts/01-Vendors/Meta/…pdf" or "supabase/id-documents/…pdf" */
  source: string;
  size: number;
  sha256: string;
};

export type BackupResult = {
  scanned: number;
  uploaded: number;
  deduped: number;
  skippedLarge: number;
  errors: number;
  bytesUploaded: number;
  manifestPath: string | null;
};

/** `objects/ab/abcdef…` — two-character shard so no directory grows unbounded. */
export function objectPath(sha: string): string {
  return `objects/${sha.slice(0, 2)}/${sha}`;
}

/** One manifest per run; a second run on the same day overwrites that day's snapshot. */
export function manifestPath(nowMs: number): string {
  return `manifests/${new Date(nowMs).toISOString().slice(0, 10)}.json`;
}

/** Every object under a Supabase storage prefix, walked recursively (list() is one level). */
export async function listSupabaseObjects(
  admin: AdminClient,
  bucket: string,
  prefix = '',
): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(`storage list failed at "${prefix}"`);
    const rows = data ?? [];
    for (const row of rows) {
      const path = prefix ? `${prefix}/${row.name}` : row.name;
      // Supabase marks a folder by returning no id/metadata for the row.
      const isFolder = !row.id;
      if (isFolder) out.push(...(await listSupabaseObjects(admin, bucket, path)));
      else out.push({ path, size: (row.metadata as { size?: number } | null)?.size ?? 0 });
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

async function alreadyStored(admin: AdminClient, sha: string): Promise<boolean> {
  const path = objectPath(sha);
  const slash = path.lastIndexOf('/');
  const { data } = await admin.storage
    .from(BACKUP_BUCKET)
    .list(path.slice(0, slash), { limit: 1, search: path.slice(slash + 1) });
  return (data ?? []).length > 0;
}

async function storeObject(admin: AdminClient, sha: string, bytes: Uint8Array): Promise<void> {
  const { error } = await admin.storage.from(BACKUP_BUCKET).upload(objectPath(sha), bytes, {
    contentType: 'application/octet-stream',
    upsert: false, // content-addressed: the same hash is always the same bytes
  });
  // A concurrent run may have stored it between the check and the write.
  if (error && !/exists/i.test(error.message)) throw new Error(`backup upload failed: ${error.message}`);
}

async function graphBytes(driveId: string, itemId: string): Promise<Uint8Array> {
  const buf = (await archiveGraphClient()
    .api(`/drives/${driveId}/items/${itemId}/content`)
    .responseType('arraybuffer' as never)
    .get()) as ArrayBuffer;
  return new Uint8Array(buf);
}

export async function runArchiveBackupSweep(nowMs: number = Date.now()): Promise<BackupResult> {
  const result: BackupResult = {
    scanned: 0,
    uploaded: 0,
    deduped: 0,
    skippedLarge: 0,
    errors: 0,
    bytesUploaded: 0,
    manifestPath: null,
  };
  const admin = createAdminClient();
  const entries: BackupEntry[] = [];

  const take = async (source: string, size: number, read: () => Promise<Uint8Array>) => {
    if (result.scanned >= MAX_FILES_PER_RUN) return;
    result.scanned++;
    if (size > MAX_BYTES_PER_FILE) {
      result.skippedLarge++;
      return;
    }
    try {
      const bytes = await read();
      const sha = sha256Hex(bytes);
      if (await alreadyStored(admin, sha)) {
        result.deduped++;
      } else {
        await storeObject(admin, sha, bytes);
        result.uploaded++;
        result.bytesUploaded += bytes.byteLength;
      }
      entries.push({ source, size: bytes.byteLength, sha256: sha });
    } catch (err) {
      result.errors++;
      console.error('[archive-backup] file failed', {
        source,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // ── Source 1: the SharePoint libraries ────────────────────────────────────
  if (graphConfigured() && archiveSiteRef()) {
    for (const library of BACKED_UP_LIBRARIES) {
      try {
        const target = await resolveLibraryTarget(library);
        const files = await listArchiveFiles(target.driveId);
        for (const file of files) {
          await take(`sharepoint/${library}/${file.path}`, file.size, () => graphBytes(target.driveId, file.id));
        }
      } catch (err) {
        result.errors++;
        console.error('[archive-backup] library unreadable', {
          library,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    console.warn('[archive-backup] SharePoint not configured; backing up Supabase only');
  }

  // ── Source 2: the signed PDFs and signatures already in Supabase ──────────
  try {
    const objects = await listSupabaseObjects(admin, SOURCE_BUCKET);
    for (const obj of objects) {
      await take(`supabase/${SOURCE_BUCKET}/${obj.path}`, obj.size, async () => {
        const { data, error } = await admin.storage.from(SOURCE_BUCKET).download(obj.path);
        if (error || !data) throw new Error('source download failed');
        return new Uint8Array(await data.arrayBuffer());
      });
    }
  } catch (err) {
    result.errors++;
    console.error('[archive-backup] source bucket unreadable', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── The snapshot ──────────────────────────────────────────────────────────
  if (entries.length > 0) {
    const manifest = {
      takenAt: new Date(nowMs).toISOString(),
      identity: archiveIdentity(),
      counts: { files: entries.length, uploaded: result.uploaded, deduped: result.deduped },
      // Sorted so two snapshots of the same content produce identical files.
      entries: entries.sort((a, b) => a.source.localeCompare(b.source)),
    };
    const path = manifestPath(nowMs);
    const { error } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(path, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), {
        contentType: 'application/json',
        upsert: true, // re-running on the same day replaces that day's snapshot
      });
    if (error) {
      result.errors++;
      console.error('[archive-backup] manifest write failed', { error: error.message });
    } else result.manifestPath = path;
  }

  console.log('[archive-backup] sweep', result);

  const failed = result.errors > 0 || (result.scanned > 0 && !result.manifestPath);
  void sendSlackAlert({
    level: failed ? 'error' : 'info',
    category: 'security',
    source: 'archive-backup',
    title: failed ? 'גיבוי הארכיון — כשלים' : 'גיבוי הארכיון החודשי',
    detail: [
      `נסרקו ${result.scanned} · הועלו ${result.uploaded} · כבר קיימים ${result.deduped} · ${(result.bytesUploaded / 1048576).toFixed(1)}MB`,
      result.manifestPath ? `מניפסט: ${result.manifestPath}` : 'לא נכתב מניפסט',
      result.skippedLarge ? `דולגו (מעל 50MB): ${result.skippedLarge}` : null,
      result.errors ? `שגיאות: ${result.errors}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join('\n'),
    fields: {
      scanned: result.scanned,
      uploaded: result.uploaded,
      deduped: result.deduped,
      mb: Number((result.bytesUploaded / 1048576).toFixed(1)),
      errors: result.errors,
    },
  });
  return result;
}
