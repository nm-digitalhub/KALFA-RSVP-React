import { z } from 'zod';

import { parseSendPolicy, type SendPolicy } from '@/lib/outreach/send-policy';

// The HTML form ⇄ SendPolicy boundary, kept OUT of the Server Action so it can be
// tested as a pure function. Closes the writer half of gap G9: the column exists,
// is populated, and until now could only be edited with SQL.
//
// WHY A SEPARATE LAYER AT ALL. `parseSendPolicy` already validates — it is the
// single definition of the safety ceilings and stays that way. What it cannot do
// is speak HTML: a form posts strings, `spreadSpanMs` is entered in MINUTES
// because nobody reasons in 5,400,000, and `preferredTimeByDaysBefore` is an
// open-ended record that has to survive a round trip through fixed input names.
// This module does exactly that translation and then hands the result to
// parseSendPolicy, so the ceilings are enforced in ONE place and this file can
// never quietly widen them.
//
// FIELD NAMES ARE POLICY PATHS. `weekday.0.start` is both the input's `name` and
// the Zod path, so an issue maps back onto the control that produced it with no
// lookup table. The two names that cannot match (`spreadSpanMinutes` is not
// `spreadSpanMs`; a preferred row is indexed, the policy key is the days-before
// number) are remapped explicitly below.

export const WEEKDAY_LABELS = [
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שבת',
] as const;

/** Days the form renders. Saturday (6) is not one of them — see below. */
export const EDITABLE_WEEKDAYS = [0, 1, 2, 3, 4, 5] as const;

export type SendPolicyFormResult =
  | { ok: true; policy: SendPolicy }
  | { ok: false; fieldErrors: Record<string, string[]> };

const MAX_DAYS_BEFORE = 365;

function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
}

// A whole number typed into a text/number input. Returns null on anything else so
// the caller can attach the message to the field rather than throwing.
function intOrNull(raw: string): number | null {
  if (raw === '' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function add(
  errors: Record<string, string[]>,
  field: string,
  message: string,
): void {
  (errors[field] ??= []).push(message);
}

/**
 * Read the preferred-time rows. Each row is a pair of inputs
 * (`preferred.<i>.days` + `preferred.<i>.time`); a row with both blank is the
 * empty "add another" row and is skipped.
 *
 * WHY ROWS AND NOT THREE FIXED FIELDS. The plan sketched three (7/3/1 days), which
 * are the keys the live value happens to carry today. Rendering exactly three
 * would mean a policy holding a fourth key silently LOSES it on the next save —
 * the schedule is per-event and a touchpoint may sit at any days_before, so that
 * is not a hypothetical. Rows preserve whatever is stored and let an admin add
 * one; clearing the time removes the key, and `defaultPreferred` covers every
 * days_before with no row of its own.
 */
function readPreferredRows(
  fd: FormData,
  errors: Record<string, string[]>,
): { record: Record<string, string>; rowByKey: Map<string, number> } {
  const indices = new Set<number>();
  for (const key of fd.keys()) {
    const m = /^preferred\.(\d+)\.(days|time)$/.exec(key);
    if (m) indices.add(Number(m[1]));
  }

  const record: Record<string, string> = {};
  const rowByKey = new Map<string, number>();

  for (const i of [...indices].sort((a, b) => a - b)) {
    const days = str(fd, `preferred.${i}.days`);
    const time = str(fd, `preferred.${i}.time`);
    if (days === '' && time === '') continue; // the blank row
    if (days === '') {
      add(errors, `preferred.${i}.days`, 'חסר מספר ימים לפני האירוע');
      continue;
    }
    if (time === '') {
      // Deliberately not an error: clearing the time is how a row is REMOVED.
      continue;
    }
    const n = intOrNull(days);
    if (n === null || n > MAX_DAYS_BEFORE) {
      add(errors, `preferred.${i}.days`, `מספר ימים חייב להיות שלם בין 0 ל-${MAX_DAYS_BEFORE}`);
      continue;
    }
    const key = String(n);
    if (key in record) {
      add(errors, `preferred.${i}.days`, 'אותו מספר ימים מופיע פעמיים');
      continue;
    }
    record[key] = time;
    rowByKey.set(key, i);
  }

  return { record, rowByKey };
}

/**
 * Map a policy path back onto the input that produced it, for the two shapes where
 * the names cannot be identical.
 */
function toFieldName(path: (string | number)[], rowByKey: Map<string, number>): string {
  const joined = path.join('.');
  if (joined === 'spreadSpanMs') return 'spreadSpanMinutes';
  if (path[0] === 'preferredTimeByDaysBefore' && path.length === 2) {
    const row = rowByKey.get(String(path[1]));
    return row === undefined ? '_root' : `preferred.${row}.time`;
  }
  return joined || '_root';
}

export function sendPolicyFromFormData(fd: FormData): SendPolicyFormResult {
  const errors: Record<string, string[]> = {};

  const weekday = EDITABLE_WEEKDAYS.map((d) => ({
    start: str(fd, `weekday.${d}.start`),
    end: str(fd, `weekday.${d}.end`),
  }));

  const motzashPlusMin = intOrNull(str(fd, 'motzashPlusMin'));
  if (motzashPlusMin === null) {
    add(errors, 'motzashPlusMin', 'מספר דקות שלם');
  }

  const spreadSpanMinutes = intOrNull(str(fd, 'spreadSpanMinutes'));
  if (spreadSpanMinutes === null) {
    add(errors, 'spreadSpanMinutes', 'מספר דקות שלם');
  }

  const { record, rowByKey } = readPreferredRows(fd, errors);

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  const raw = {
    // SHABBAT IS NOT READ FROM THE FORM. The form renders no Saturday inputs, and
    // this line ignores them even if a crafted POST supplies them. parseSendPolicy
    // rejects a non-null Saturday as well — two independent refusals, because
    // opening Shabbat sends must take a code change, never a field.
    weekday: [...weekday, null],
    hardCap: str(fd, 'hardCap'),
    motzashPlusMin,
    preferredTimeByDaysBefore: record,
    defaultPreferred: str(fd, 'defaultPreferred'),
    spreadSpanMs: (spreadSpanMinutes as number) * 60_000,
    // Not editable in v1: the zmanim layer is pinned to one location and the
    // schema is a literal, so offering a control would promise a choice the
    // calendar code cannot honour.
    location: 'jerusalem' as const,
  };

  try {
    return { ok: true, policy: parseSendPolicy(raw) };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const mapped: Record<string, string[]> = {};
      for (const issue of err.issues) {
        add(mapped, toFieldName(issue.path as (string | number)[], rowByKey), issue.message);
      }
      return { ok: false, fieldErrors: mapped };
    }
    // The guardrails throw plain Errors with a Hebrew message naming the ceiling
    // that was crossed. They are whole-policy statements ("חלון שליחה חורג מהגבול
    // הקשיח"), not field statements, so they belong at the top of the form.
    return {
      ok: false,
      fieldErrors: {
        _root: [err instanceof Error ? err.message : 'מדיניות השליחה נדחתה'],
      },
    };
  }
}
