'use server';

import { revalidatePath } from 'next/cache';

import { parseCsv } from '@/lib/csv';
import { logActivity } from '@/lib/data/activity';
import { importRowSchema } from '@/lib/validation/guests';
import {
  listGroups,
  createGroup,
  bulkInsertGuests,
  type BulkGuestInput,
} from '@/lib/data/guests';
import { buildContactsForEvent } from '@/lib/data/contacts';
import { CSV_MAX_ROWS, CSV_MAX_BYTES } from '@/lib/constants';

// A single row that failed validation, reported back to the user in Hebrew.
export interface ImportRowError {
  /** 1-based row number as it appears in the file (header excluded). */
  row: number;
  message: string;
}

// Result of an import attempt. `null` is the untouched initial state.
export type ImportState =
  | {
      error?: string;
      imported?: number;
      failed?: ImportRowError[];
      done?: boolean;
    }
  | null;

function isNextControlFlow(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('digest' in err)) return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_REDIRECT') ||
      digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'))
  );
}

// Map a header cell to a known column key. Accepts a small set of Hebrew and
// English aliases so common spreadsheet exports work without configuration.
function headerKey(raw: string): 'full_name' | 'phone' | 'group' | null {
  const h = raw.trim().toLowerCase();
  if (['name', 'full_name', 'שם', 'שם מלא'].includes(h)) return 'full_name';
  if (['phone', 'mobile', 'טלפון', 'נייד', 'מספר'].includes(h)) return 'phone';
  if (['group', 'קבוצה'].includes(h)) return 'group';
  return null;
}

// A validated row awaiting group resolution: the guest payload plus the raw
// group name (kept alongside, NOT in module state, so concurrent imports never
// interfere).
interface PendingGuest {
  guest: BulkGuestInput;
  groupName: string;
}

/**
 * Import guests from an uploaded CSV file under an owned event.
 *
 * Limits are enforced cheapest-first: raw byte size BEFORE decoding, then row
 * count AFTER splitting. Each data row is validated independently; valid rows
 * are inserted in a single statement (partial success), and invalid rows are
 * reported per-row in Hebrew. Group names are resolved with a single fetch of
 * the event's groups (plus at most one create per genuinely-new name) — no
 * per-row query.
 */
export async function importGuestsAction(
  eventId: string,
  _prevState: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'נא לבחור קובץ CSV.' };
  }

  // Cheapest guard first: reject oversized uploads before reading the bytes.
  if (file.size > CSV_MAX_BYTES) {
    return {
      error: `הקובץ גדול מדי (מעל ${Math.floor(CSV_MAX_BYTES / 1000)}KB).`,
    };
  }

  let text: string;
  try {
    const buf = await file.arrayBuffer();
    // Belt-and-braces: re-check the decoded byte length.
    if (buf.byteLength > CSV_MAX_BYTES) {
      return { error: 'הקובץ גדול מדי.' };
    }
    text = new TextDecoder('utf-8').decode(buf);
  } catch {
    return { error: 'קריאת הקובץ נכשלה.' };
  }

  const grid = parseCsv(text);
  if (grid.length < 2) {
    return { error: 'הקובץ ריק או חסר שורות נתונים.' };
  }

  // First row is the header. Map columns by name.
  const header = grid[0];
  const colIndex: Record<'full_name' | 'phone' | 'group', number> = {
    full_name: -1,
    phone: -1,
    group: -1,
  };
  header.forEach((cell, i) => {
    const key = headerKey(cell);
    if (key && colIndex[key] === -1) colIndex[key] = i;
  });

  if (colIndex.full_name === -1) {
    return { error: 'לא נמצאה עמודת שם (name / שם) בכותרת הקובץ.' };
  }

  const dataRows = grid.slice(1);
  if (dataRows.length > CSV_MAX_ROWS) {
    return {
      error: `יותר מדי שורות (מעל ${CSV_MAX_ROWS}). פצלו את הקובץ.`,
    };
  }

  // Single fetch of existing groups -> name(lowercased) -> id map.
  let groupByName: Map<string, string>;
  try {
    const groups = await listGroups(eventId);
    groupByName = new Map(
      groups.map((g) => [g.name.trim().toLowerCase(), g.id]),
    );
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'טעינת הקבוצות נכשלה.' };
  }

  const pending: PendingGuest[] = [];
  const failed: ImportRowError[] = [];
  const newGroupNames = new Set<string>();

  dataRows.forEach((cells, idx) => {
    const rowNum = idx + 1; // 1-based, header excluded.

    // Skip a completely blank line.
    if (cells.every((c) => c.trim() === '')) return;

    const candidate = {
      full_name: cells[colIndex.full_name] ?? '',
      phone: colIndex.phone === -1 ? '' : cells[colIndex.phone] ?? '',
      group: colIndex.group === -1 ? '' : cells[colIndex.group] ?? '',
    };

    const parsed = importRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      failed.push({ row: rowNum, message: first?.message ?? 'שורה לא תקינה' });
      return;
    }

    const groupName = parsed.data.group?.trim() ?? '';
    if (groupName !== '' && !groupByName.has(groupName.toLowerCase())) {
      newGroupNames.add(groupName);
    }

    pending.push({
      groupName,
      guest: {
        full_name: parsed.data.full_name,
        phone: parsed.data.phone ? parsed.data.phone : null,
        expected_count: parsed.data.expected_count ?? null,
        group_id: null, // resolved below
      },
    });
  });

  // Create any genuinely-new groups (one insert each), bounded by the number of
  // distinct new names, not rows.
  try {
    for (const name of newGroupNames) {
      const created = await createGroup(eventId, { name });
      groupByName.set(name.toLowerCase(), created.id);
    }
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'יצירת קבוצות מהקובץ נכשלה.' };
  }

  // Resolve group_id for each pending row from the (now-complete) map, then
  // collapse to the insert payload.
  const valid: BulkGuestInput[] = pending.map(({ guest, groupName }) => ({
    ...guest,
    group_id:
      groupName === '' ? null : groupByName.get(groupName.toLowerCase()) ?? null,
  }));

  if (valid.length === 0) {
    return { done: true, imported: 0, failed };
  }

  let imported: number;
  try {
    imported = await bulkInsertGuests(eventId, valid);
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'ייבוא המוזמנים נכשל.', failed };
  }

  // Materialize the contacts table (billing source-of-truth) from the imported
  // guests — the bulk path, so a one-time whole-event rebuild is appropriate.
  // Best-effort: the guests are already committed; a failure must not report the
  // import as failed (contacts reconcile on the next mutation / campaign build).
  try {
    await buildContactsForEvent(eventId);
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    // Derived secondary effect — never blocks a completed import, but log (no
    // PII) so a failed contacts rebuild is auditable and reconcilable.
    console.error(
      `[contacts] post-import contacts rebuild failed (event=${eventId}): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
  }

  await logActivity({
    eventId,
    action: 'guests.imported',
    meta: {
      importedCount: imported,
      failedCount: failed.length,
      newGroupCount: newGroupNames.size,
    },
  });

  revalidatePath(`/app/events/${eventId}/guests`);
  return { done: true, imported, failed };
}
