'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { parseCsv, decodeCsvBuffer, sniffSpreadsheetBinary } from '@/lib/csv';
import { ISRAELI_PHONE_RE } from '@/lib/constants';
import { logActivity } from '@/lib/data/activity';
import { normalizePhone, repairIsraeliLocalPhone } from '@/lib/phone';
import { importRowSchema } from '@/lib/validation/guests';
import { guestImportHeaderKey as headerKey } from '@/lib/data/guest-import-shared';
import {
  listGroups,
  createGroup,
  bulkInsertGuests,
  type BulkGuestInput,
} from '@/lib/data/guests';
import { buildContactsForEvent } from '@/lib/data/contacts';
import { createAdminClient } from '@/lib/supabase/admin';
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
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Belt-and-braces: re-check the decoded byte length.
    if (bytes.byteLength > CSV_MAX_BYTES) {
      return { error: 'הקובץ גדול מדי.' };
    }
    // A real Excel workbook can never parse as CSV — name the fix precisely
    // instead of failing later with a confusing "missing name column".
    const binary = sniffSpreadsheetBinary(bytes);
    if (binary) {
      return {
        error:
          'הקובץ שהועלה הוא קובץ Excel‏ (' +
          binary +
          ') ולא CSV. פתחו אותו באקסל ושמרו בשם בפורמט "CSV UTF-8", או השתמשו בתבנית המוכנה להורדה.',
      };
    }
    // UTF-8 first; Hebrew-Excel ANSI (Windows-1255) files fall back and load
    // correctly instead of importing garbled names.
    text = decodeCsvBuffer(bytes);
  } catch {
    return { error: 'קריאת הקובץ נכשלה.' };
  }

  const grid = parseCsv(text);
  if (grid.length < 2) {
    return { error: 'הקובץ ריק או חסר שורות נתונים.' };
  }

  // First row is the header. Map columns by name.
  const header = grid[0];
  const colIndex: Record<
    'full_name' | 'phone' | 'group' | 'expected_count',
    number
  > = {
    full_name: -1,
    phone: -1,
    group: -1,
    expected_count: -1,
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
    unstable_rethrow(err);
    return { error: 'טעינת הקבוצות נכשלה.' };
  }

  const pending: PendingGuest[] = [];
  const failed: ImportRowError[] = [];
  const newGroupNames = new Set<string>();

  // One guest per phone (unique index guests_event_phone_key): duplicates —
  // inside the file or against existing guests — become per-row errors here,
  // so the single-statement bulk insert below can never trip the index.
  const { data: existingRows } = await createAdminClient()
    .from('guests')
    .select('full_name, phone')
    .eq('event_id', eventId)
    .not('phone', 'is', null);
  const existingByPhone = new Map<string, string>();
  for (const g of existingRows ?? []) {
    const np = normalizePhone(g.phone);
    if (np && !existingByPhone.has(np)) existingByPhone.set(np, g.full_name);
  }
  const seenInFile = new Map<string, number>();

  dataRows.forEach((cells, idx) => {
    const rowNum = idx + 1; // 1-based, header excluded.

    // Skip a completely blank line.
    if (cells.every((c) => c.trim() === '')) return;

    // Excel repair: a numeric phone cell loses its leading 0 (0501… → 501…).
    // When the raw value fails the local-format check but still parses as a
    // valid Israeli number, substitute the canonical 0-form; anything truly
    // invalid keeps failing the schema below with the per-row Hebrew error.
    const rawPhone = (
      colIndex.phone === -1 ? '' : cells[colIndex.phone] ?? ''
    ).trim();
    const phone =
      rawPhone !== '' && !ISRAELI_PHONE_RE.test(rawPhone)
        ? repairIsraeliLocalPhone(rawPhone) ?? rawPhone
        : rawPhone;

    const rawCount = (
      colIndex.expected_count === -1
        ? ''
        : cells[colIndex.expected_count] ?? ''
    ).trim();

    const candidate = {
      full_name: cells[colIndex.full_name] ?? '',
      phone,
      group: colIndex.group === -1 ? '' : cells[colIndex.group] ?? '',
      // An empty count cell must be ABSENT, not '' — z.coerce would turn ''
      // into 0 and every phone-less family row would import as "0 מוזמנים".
      ...(rawCount === '' ? {} : { expected_count: rawCount }),
    };

    const parsed = importRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      failed.push({ row: rowNum, message: first?.message ?? 'שורה לא תקינה' });
      return;
    }

    const np = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
    if (np) {
      const existingName = existingByPhone.get(np);
      if (existingName) {
        failed.push({
          row: rowNum,
          message: `מספר הטלפון כבר קיים אצל "${existingName}"`,
        });
        return;
      }
      const firstRow = seenInFile.get(np);
      if (firstRow) {
        failed.push({
          row: rowNum,
          message: `מספר הטלפון כפול בקובץ (מופיע כבר בשורה ${firstRow})`,
        });
        return;
      }
      seenInFile.set(np, rowNum);
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
    unstable_rethrow(err);
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
    unstable_rethrow(err);
    return { error: 'ייבוא המוזמנים נכשל.', failed };
  }

  // Materialize the contacts table (billing source-of-truth) from the imported
  // guests — the bulk path, so a one-time whole-event rebuild is appropriate.
  // Best-effort: the guests are already committed; a failure must not report the
  // import as failed (contacts reconcile on the next mutation / campaign build).
  try {
    await buildContactsForEvent(eventId);
  } catch (err) {
    unstable_rethrow(err);
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
