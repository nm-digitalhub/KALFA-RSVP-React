import 'server-only';

import { requirePlatformOwner, requirePlatformPermission } from '@/lib/auth/dal';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { createAdminClient } from '@/lib/supabase/admin';
import { addWabaPhoneNumber } from '@/lib/whatsapp/add-waba-phone-number';
import {
  META_RATE_LIMIT_CODE,
  deregisterPhoneNumber,
  metaErrorCode,
  metaErrorSubcode,
  registerPhoneNumber,
  requestVerificationCode,
  verifyPhoneNumberCode,
} from '@/lib/whatsapp/phone-numbers';
import type { AddNumberInput } from '@/lib/validation/whatsapp-numbers';
import type { codeMethodSchema } from '@/lib/validation/whatsapp-numbers';
import type { z } from 'zod';

// The Meta phone-number lifecycle: add → request code → verify → register /
// deregister. Every function here CHANGES STATE AT META, which is what separates
// this module from provider-numbers.ts (that one owns our own table).
//
// ⚠️ REGISTER AND DEREGISTER SPEND A BUDGET THAT CANNOT BE TOPPED UP.
// Meta allows 10 of them per business number per 72-hour moving window; the 11th
// returns 133016 and the number is BLOCKED for 72 hours. Retrying is the one
// response that makes it worse, so the guard has to hold BEFORE the call, and it
// has to survive a redeploy — see reserveRegistrationBudget.

export const CODE_ACTION = 'admin.integrations.number_code_requested';
export const VERIFY_ACTION = 'admin.integrations.number_verified';
export const ADD_ACTION = 'admin.integrations.number_added';

/**
 * One row per register/deregister ATTEMPT. This action name is the durable budget
 * counter, so it is deliberately not shared with the outcome rows above.
 */
export const ATTEMPT_ACTION = 'admin.integrations.number_registration_attempt';

/**
 * OUR ceiling, deliberately below Meta's 10.
 *
 * The headroom is not caution for its own sake: if this guard is ever wrong — a row
 * that failed to write, an attempt made from WhatsApp Manager instead of from here —
 * the remaining five are what let the owner recover the number by hand instead of
 * discovering the block only once it has already happened.
 */
export const REGISTRATION_BUDGET = 5;
export const REGISTRATION_WINDOW_HOURS = 72;

/** A full page of attempts in 72h is itself the anomaly. See reserveRegistrationBudget. */
const ATTEMPT_SCAN_LIMIT = 200;

export interface RegistrationBudget {
  used: number;
  remaining: number;
  /** When the oldest attempt in the window falls out of it, or null when unused. */
  oldestAt: string | null;
}

function windowStart(): string {
  return new Date(Date.now() - REGISTRATION_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

async function readAttempts(phoneNumberId: string): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('activity_log')
    .select('created_at, meta')
    .eq('action', ATTEMPT_ACTION)
    .gte('created_at', windowStart())
    .order('created_at', { ascending: true })
    .limit(ATTEMPT_SCAN_LIMIT);

  if (error) {
    // FAIL CLOSED. An unreadable counter is not an empty counter, and the cost of
    // guessing "empty" is a 72-hour block on a number that may be sending invitations.
    throw new Error('לא ניתן לאמת את מכסת הרישום מול היומן — הפעולה נעצרה');
  }

  const rows = data ?? [];
  if (rows.length >= ATTEMPT_SCAN_LIMIT) {
    throw new Error('נרשמו יותר מדי ניסיונות רישום ב-72 השעות האחרונות — הפעולה נעצרה');
  }

  // Filtered here rather than in the query: the id lives inside a jsonb column, and
  // a handful of rows per window makes a JSON path filter cost more in fragility
  // than it saves in bytes.
  return rows
    .filter((r) => {
      const meta = r.meta as { phoneNumberId?: unknown } | null;
      return typeof meta?.phoneNumberId === 'string' && meta.phoneNumberId === phoneNumberId;
    })
    .map((r) => r.created_at);
}

/**
 * How much of the register/deregister budget this number has left. Read-only —
 * for showing the admin the number BEFORE they commit to spending it.
 */
export async function getRegistrationBudget(
  phoneNumberId: string,
): Promise<RegistrationBudget> {
  await requirePlatformPermission('manage_settings');
  const attempts = await readAttempts(phoneNumberId);
  return {
    used: attempts.length,
    remaining: Math.max(0, REGISTRATION_BUDGET - attempts.length),
    oldestAt: attempts[0] ?? null,
  };
}

/**
 * Claim one unit of the budget, or refuse.
 *
 * WRITTEN BEFORE THE GRAPH CALL, ON PURPOSE. If the row were written after, a crash
 * or a timeout mid-call would leave a request Meta has already counted and we have
 * not — the exact drift that walks a number into a block it looks entitled to avoid.
 * Over-counting a failed attempt is the safe direction of that error.
 *
 * This write is FATAL, unlike logActivity's best-effort audit rows: here the row is
 * not a record of the budget, it IS the budget.
 */
async function reserveRegistrationBudget(
  phoneNumberId: string,
  operation: 'register' | 'deregister',
  userId: string,
): Promise<void> {
  const attempts = await readAttempts(phoneNumberId);

  if (attempts.length >= REGISTRATION_BUDGET) {
    throw new Error(
      `נוצלה מכסת הרישום (${REGISTRATION_BUDGET} פעולות ב-${REGISTRATION_WINDOW_HOURS} שעות). ` +
        'Meta חוסמת מספר שחורג מהמכסה שלה למשך 72 שעות — יש להמתין.',
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('activity_log').insert({
    user_id: userId,
    action: ATTEMPT_ACTION,
    // phoneNumberId is a Meta OBJECT id, not a phone number, and no PIN or token
    // appears here. The row is read back as a counter, so the shape is load-bearing.
    meta: { phoneNumberId, operation },
  });

  if (error) {
    throw new Error('לא ניתן לרשום את ניסיון הרישום ביומן — הפעולה נעצרה');
  }
}

/**
 * Meta's error codes, mapped to something an admin can act on.
 *
 * THE CODE IS ALWAYS APPENDED. Meta's error BODY is what must never be shown — it
 * echoes request context and has carried credentials — but the numeric code is not
 * sensitive, and it is the only thing that distinguishes "this number is already on
 * another WhatsApp account" from "the token expired". Without it the admin gets a
 * sentence that is true of every possible failure and useful for none of them.
 */
function describeMetaError(err: unknown): string {
  const code = metaErrorCode(err);

  const known: Record<number, string> = {
    [META_RATE_LIMIT_CODE]:
      'Meta חסמה את המספר לאחר 10 פעולות רישום ב-72 שעות. יש להמתין 72 שעות — ניסיון נוסף מאריך את החסימה.',
    // 136024 alone stays unnamed — see the subcode table below, which is where the
    // meaning actually lives for this one.
    // 100 covers a genuinely invalid field AND a field Meta has retired, and it blames
    // the object rather than the field — the same trap the read path documents.
    100: 'Meta דחתה את הבקשה כלא תקינה — בדרך כלל מספר שכבר רשום בחשבון WhatsApp אחר, או שם עסק שאינו עומד בכללים.',
    190: 'הטוקן של Meta פג או נשלל. יש לחדש אותו בעמוד החיבור.',
    200: 'לטוקן חסרות הרשאות לפעולה הזו (נדרש whatsapp_business_management).',
    133005: 'ה-PIN שגוי. אם למספר כבר יש אימות דו-שלבי, יש להזין את ה-PIN הקיים.',
  };

  const subcode = metaErrorSubcode(err);

  /**
   * SUBCODES OUTRANK CODES. Meta's own error-code page does not list 136024 at all,
   * but it does document subcode 2388091 — under PHONE MIGRATION errors, saying the
   * number cannot receive or verify a registration code because it is not being
   * migrated, and to use the standard register-and-verify path instead.
   *
   * MEASURED 2026-09-11: that is what a freshly added French line returned on
   * request_code. Read together with the constraint already in the plan — a number
   * already in use with WhatsApp cannot be registered unless the account is deleted
   * first — the actionable reading is that the line still carries a WhatsApp account.
   * The number was created on the WABA; Meta simply will not send a code to it.
   *
   * This is an INFERENCE from the doc plus the observed state, not a statement Meta
   * made. The message says so, because sending someone to delete a WhatsApp account
   * is not a step to take on a guess presented as fact.
   */
  const knownSubcodes: Record<number, string> = {
    2388091:
      'Meta מסרבת לשלוח קוד למספר הזה. לפי התיעוד תת-הקוד הזה שייך לשגיאות מיגרציה, ומשמעותו שהמספר אינו כשיר לקבל קוד רישום. הסיבה השכיחה: על המספר עדיין רשום חשבון WhatsApp (אישי או עסקי) — יש למחוק אותו מתוך האפליקציה (הגדרות ← חשבון ← מחיקת החשבון), להמתין כמה דקות ולנסות שוב. אם המספר נקי, ייתכן שנדרש מסלול מיגרציה נפרד שאינו ממומש כאן.',
  };

  const base =
    (subcode !== null ? knownSubcodes[subcode] : undefined) ??
    (code !== null ? known[code] : undefined);

  // The code alone is often ambiguous; the subcode is what separates two failures
  // that share it. Both are numbers — safe to show, unlike Meta's message body.
  const parts: string[] = [];
  if (code !== null) parts.push(`קוד Meta ${code}`);
  if (subcode !== null) parts.push(`תת-קוד ${subcode}`);
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';

  return `${base ?? 'Meta סירבה לבצע את הפעולה ולא מסרה סיבה שאנחנו מזהים.'}${suffix}`;
}

async function metaCredentials(): Promise<{ wabaId: string; accessToken: string }> {
  const cfg = await getWhatsAppConfig();
  if (!cfg?.wabaId || !cfg.accessToken) {
    throw new Error('חסרים פרטי חיבור ל-Meta (WABA ID או טוקן)');
  }
  return { wabaId: cfg.wabaId, accessToken: cfg.accessToken };
}

/**
 * Add a number to the WABA. Does NOT verify it and does NOT register it — the new
 * number cannot send anything until both of those happen.
 *
 * Delegates the request shape to add-waba-phone-number.ts, which is typed against
 * Meta's OpenAPI spec: `phone_number` is E.164 WITHOUT the plus and WITH the country
 * code, and `verified_name` is 2–75 characters.
 *
 * Adding costs nothing against the register budget.
 */
export async function addNumber(input: AddNumberInput): Promise<string> {
  await requirePlatformPermission('manage_settings');
  const creds = await metaCredentials();

  try {
    const { id } = await addWabaPhoneNumber(creds, {
      cc: input.cc,
      phone_number: input.phoneNumber,
      verified_name: input.verifiedName,
    });
    return id;
  } catch (err) {
    // THIS USED TO PROPAGATE UNMAPPED, and the action turned every failure into one
    // generic sentence. Worse, nothing was recorded: a failed add left no trace on the
    // server at all, so "it said it failed" was the entire diagnostic surface.
    // The code is safe to alert on; the body is not, and never leaves the client.
    void sendSlackAlert({
      level: 'warn',
      category: 'security',
      title: 'הוספת מספר WhatsApp נכשלה',
      source: 'admin/integrations/numbers',
      fields: { cc: input.cc, code: metaErrorCode(err) ?? 'unknown' },
    });
    throw new Error(describeMetaError(err));
  }
}

/**
 * Ask Meta to send a verification code to the physical handset.
 *
 * THIS REACHES A REAL PHONE. It is not a connectivity check, and the language is
 * `en_US` — see the note in phone-numbers.ts.
 */
export async function requestCode(
  phoneNumberId: string,
  codeMethod: z.infer<typeof codeMethodSchema>,
): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const { accessToken } = await metaCredentials();

  try {
    await requestVerificationCode(phoneNumberId, accessToken, codeMethod);
  } catch (err) {
    throw new Error(describeMetaError(err));
  }
}

/** Submit the code the owner received. Proves ownership; does not register. */
export async function verifyCode(phoneNumberId: string, code: string): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const { accessToken } = await metaCredentials();

  try {
    await verifyPhoneNumberCode(phoneNumberId, accessToken, code);
  } catch (err) {
    throw new Error(describeMetaError(err));
  }
}

/**
 * Register the number for the Cloud API. OWNER ONLY.
 *
 * The gate is requirePlatformOwner rather than a permission because this spends a
 * budget that no one can refill and can block a number that is actively sending.
 *
 * ⚠️ `pin` NEVER LEAVES THIS CALL. It is not returned, not logged, not put in an
 * error, and not stored — Meta requires the existing PIN to change the PIN or delete
 * the number, so keeping a copy would be keeping a key to both.
 */
export async function registerNumber(phoneNumberId: string, pin: string): Promise<void> {
  const owner = await requirePlatformOwner();
  const { accessToken } = await metaCredentials();

  await reserveRegistrationBudget(phoneNumberId, 'register', owner.id);

  try {
    await registerPhoneNumber(phoneNumberId, accessToken, pin);
  } catch (err) {
    void sendSlackAlert({
      level: 'warn',
      category: 'security',
      title: 'רישום מספר WhatsApp נכשל',
      source: 'admin/integrations/numbers',
      fields: { phoneNumberId, code: metaErrorCode(err) ?? 'unknown' },
    });
    throw new Error(describeMetaError(err));
  }

  void sendSlackAlert({
    level: 'info',
    category: 'security',
    title: 'מספר WhatsApp נרשם ל-Cloud API',
    source: 'admin/integrations/numbers',
    fields: { phoneNumberId, by: owner.id },
  });
}

/**
 * Deregister the number. SENDING STOPS IMMEDIATELY. OWNER ONLY.
 *
 * Spends from the SAME budget as register, so a register/deregister cycle burns it
 * twice as fast.
 */
export async function deregisterNumber(phoneNumberId: string): Promise<void> {
  const owner = await requirePlatformOwner();
  const { accessToken } = await metaCredentials();

  await reserveRegistrationBudget(phoneNumberId, 'deregister', owner.id);

  try {
    await deregisterPhoneNumber(phoneNumberId, accessToken);
  } catch (err) {
    throw new Error(describeMetaError(err));
  }

  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    title: 'מספר WhatsApp הוסר מה-Cloud API — שליחה דרכו נפסקה',
    source: 'admin/integrations/numbers',
    fields: { phoneNumberId, by: owner.id },
  });
}
