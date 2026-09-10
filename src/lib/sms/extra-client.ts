import 'server-only';

import { ISRAEL_TIME_ZONE } from '@/lib/date';

// The read-only half of the ExtrA (exm.co.il) API: verify the key, and turn a
// rejected send into something an operator can act on.
//
// Everything here is derived from the vendor's own OpenAPI document, pinned at
// docs/extra/openapi-extra-v1.json. `sender.ts` implements the one operation that
// sends; this file implements the one that asks questions. Two of the spec's ten.
//
// ⚠️ getAuthKey ECHOES THE API KEY BACK. `key` is a REQUIRED property of its 200
// response — "The API key this request authenticated with." So the response is
// destructured field by field and `key` is dropped on the floor; it is never spread
// into a return value, never interpolated into a thrown message, never logged. That
// single hazard is why this wrapper exists instead of an inline fetch, and a test
// asserts a key placed in a mocked response reaches no string in the result.
//
// ⚠️ BUSINESS FAILURES COME BACK HTTP 200. Only a missing or invalid Bearer token
// gives 401; everything else is `200` with `success:false` and an `errors[]` array.
// Checking `res.ok` alone reports a rejected send as a success.

const EXTRA_API_BASE = 'https://www.exm.co.il/api/v1';

export interface ExtraKeyOk {
  ok: true;
  /** null = a legacy/unscoped key, which "may do everything the account may". */
  scopes: Record<string, unknown> | null;
  /** Y-m-d, as the API returns them. Not parsed into a Date — see daysUntil(). */
  createdAt: string | null;
  expireAt: string | null;
  /** Whole days from today to expiry; negative once expired. null when unknown. */
  daysToExpiry: number | null;
  /** The ACCOUNT's own address — not a customer's, so not personal data here. */
  accountEmail: string | null;
}

export type ExtraKeyFailure =
  /** 401 — the Bearer token is missing, malformed or revoked. */
  | 'key_invalid'
  /** Reachable, but the answer was not the documented shape. */
  | 'unexpected_response'
  /** Network, timeout, or a non-200/401 status. */
  | 'unreachable';

export interface ExtraKeyError {
  ok: false;
  kind: ExtraKeyFailure;
  /** Hebrew, safe to render. NEVER carries the key or a raw provider body. */
  message: string;
}

export type ExtraKeyHealth = ExtraKeyOk | ExtraKeyError;

const KEY_MESSAGES: Record<ExtraKeyFailure, string> = {
  key_invalid: 'מפתח ה-API של ExtrA אינו תקף',
  unexpected_response: 'ExtrA החזירה תגובה בפורמט לא מוכר',
  unreachable: 'לא ניתן להגיע ל-ExtrA',
};

/**
 * Whole days from today to a Y-m-d expiry date, both read as CALENDAR DATES in
 * Asia/Jerusalem.
 *
 * Three decisions, each of which was wrong on the first attempt:
 *
 *  1. Date-only arithmetic. The API gives a date with no time; subtracting it from
 *     `Date.now()` would make "expires today" read as a fraction and floor to -1 for
 *     most of the day.
 *  2. Asia/Jerusalem explicitly, NOT the process's local zone. ExtrA is an Israeli
 *     provider and its dates are Israeli calendar dates. The first version used
 *     `now.getFullYear()/getMonth()/getDate()`, which is the SERVER's zone — correct
 *     only by luck on a machine set to Israel time, and silently off by a day on one
 *     that is not. The worker and the app need not share a timezone with the vendor.
 *  3. null for anything unparseable, never a number. An expiry we cannot read must
 *     not become "expires soon" OR "expires never" — both are claims.
 */
export function daysUntil(ymd: string | null | undefined, now: Date = new Date()): number | null {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);

  // `en-CA` renders as Y-m-d, which is the format we already have on the other side.
  const todayInIsrael = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [ty, tm, td] = todayInIsrael.split('-').map(Number);
  const today = Date.UTC(ty, tm - 1, td);

  return Math.round((target - today) / 86_400_000);
}

/**
 * `GET /auth/key/` — the spec's own suggested connectivity check: "Call with no
 * parameters to verify that your Bearer token is valid and see what it may do."
 *
 * Nothing is sent, nothing is charged, and no customer data is touched.
 */
export async function getAuthKey(token: string, now: Date = new Date()): Promise<ExtraKeyHealth> {
  let res: Response;
  try {
    res = await fetch(`${EXTRA_API_BASE}/auth/key/`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
  } catch {
    // Never surface the thrown message: a fetch failure can echo the request, and
    // the request is where the key is.
    return { ok: false, kind: 'unreachable', message: KEY_MESSAGES.unreachable };
  }

  if (res.status === 401) {
    return { ok: false, kind: 'key_invalid', message: KEY_MESSAGES.key_invalid };
  }
  if (!res.ok) {
    return { ok: false, kind: 'unreachable', message: KEY_MESSAGES.unreachable };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: 'unexpected_response', message: KEY_MESSAGES.unexpected_response };
  }

  const row = (body ?? {}) as {
    success?: boolean;
    // `key` is declared here ONLY so the destructuring below is explicit about
    // dropping it. It is never read.
    key?: string;
    scopes?: Record<string, unknown> | null;
    times?: { created?: string; expire?: string };
    user?: { id?: string; email_address?: string };
  };
  if (row.success !== true) {
    return { ok: false, kind: 'unexpected_response', message: KEY_MESSAGES.unexpected_response };
  }

  const expireAt = typeof row.times?.expire === 'string' ? row.times.expire : null;
  return {
    ok: true,
    scopes: row.scopes ?? null,
    createdAt: typeof row.times?.created === 'string' ? row.times.created : null,
    expireAt,
    daysToExpiry: daysUntil(expireAt, now),
    accountEmail: typeof row.user?.email_address === 'string' ? row.user.email_address : null,
    // NOTE the absence of `key`. Adding it here would leak the credential into every
    // caller, the page props and the logs. See the file header.
  };
}

// ─── SMS ERROR MAPPING ───────────────────────────────────────────────────────
//
// Straight from the spec's own table. The codes are the stable part; the vendor's
// `description` text is not, and is never shown to an operator.

export interface ExtraSmsError {
  code: number;
  /** Hebrew, actionable — says what to DO, not what the provider called it. */
  message: string;
  /**
   * Which admin field is at fault, when one is. 1215/7521 are the sender's
   * problem and belong on the `extra_sms_sender` input rather than in a banner
   * the operator has to translate into an action.
   */
  field?: 'extra_sms_sender';
}

const SMS_ERROR_MESSAGES: Record<number, { message: string; field?: 'extra_sms_sender' }> = {
  7321: { message: 'תוכן ההודעה חסר' },
  7526: { message: 'מספר היעד חסר או אינו תקין' },
  7520: { message: 'מספר היעד אינו מספר ישראלי שניתן לשלוח אליו SMS' },
  7462: { message: 'מספר היעד הוא טלפון כשר ואינו יכול לקבל הודעות' },
  9404: { message: 'חיוב: אין כרטיס אשראי בחשבון ExtrA — לא ניתן לשלוח' },
  1214: { message: 'חיוב: אין פרופיל חיוב API-SMS בחשבון — פנו לתמיכת ExtrA' },
  1215: {
    message: 'השולח אינו verified ID מאומת בחשבון — הוסיפו אותו ב-/my/verified-ids/ עם הרשאת sms_sender',
    field: 'extra_sms_sender',
  },
  7521: {
    message: 'השולח נדחה אצל ספק ה-SMS — ודאו שהוא מאומת ב-/my/verified-ids/',
    field: 'extra_sms_sender',
  },
  7404: { message: 'שגיאה לא מתועדת אצל ספק ה-SMS' },
};

/**
 * Map EVERY error in the response, not just the first.
 *
 * The spec is explicit that the pre-send validation codes "may arrive several at
 * once in one response". Reading `errors[0]` would report "no credit card on file"
 * while silently dropping "sender is not verified" — and send the operator to fix
 * the wrong thing, twice.
 *
 * An unrecognised code is reported with its number rather than swallowed: the spec
 * already carries a catch-all (7404) whose real code is buried in a description we
 * deliberately do not display, so unknown codes WILL occur.
 */
export function mapSmsErrors(errors: unknown): ExtraSmsError[] {
  if (!Array.isArray(errors)) return [];
  const out: ExtraSmsError[] = [];
  for (const raw of errors) {
    const code = Number((raw as { code?: unknown })?.code);
    if (!Number.isFinite(code)) continue;
    const known = SMS_ERROR_MESSAGES[code];
    out.push(
      known
        ? { code, message: known.message, ...(known.field ? { field: known.field } : {}) }
        : { code, message: `שגיאת ExtrA ${code}` },
    );
  }
  return out;
}

export { EXTRA_API_BASE };
