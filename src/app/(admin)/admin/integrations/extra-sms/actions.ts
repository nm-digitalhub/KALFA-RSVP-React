'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { updateExtraSmsConfig } from '@/lib/data/admin/settings';
import { normalizePhone } from '@/lib/phone';
import { rateLimit } from '@/lib/security/rate-limit';
import { mapSmsErrors } from '@/lib/sms/extra-client';
import { createExtraSmsSender, readSmsSettings, SmsSendError } from '@/lib/sms/sender';
import { extraSmsSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

const PATH = '/admin/integrations/extra-sms';
const INDEX = '/admin/integrations';

export async function updateExtraSmsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = extraSmsSchema.safeParse({
    sms_enabled: formData.get('sms_enabled') === 'on',
    extra_sms_sender: formData.get('extra_sms_sender') ?? '',
    extra_sms_token: formData.get('extra_sms_token') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await updateExtraSmsConfig(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון הגדרות ה-SMS נכשל. נסו שוב.' };
  }
  // The index card prints `configured`/`enabled` for the very columns just written.
  revalidatePath(PATH);
  revalidatePath(INDEX);
  return { notice: 'הגדרות ה-SMS נשמרו' };
}

// ─── THE TEST SEND ───────────────────────────────────────────────────────────
//
// ⚠️ THIS SPENDS MONEY AND REACHES A REAL HANDSET. It is the only action in the
// integrations tree that does, which is why it carries three guards the others do
// not need:
//
//  1. A rate limit keyed on the STAFF USER ID, resolved server-side from the session
//     by requirePlatformPermission. Never from the form — a browser-supplied id would
//     let one admin spend another's quota, and let anyone reset their own by editing
//     a hidden field.
//  2. The destination is normalised through the same libphonenumber path the guest
//     list uses, so "05x" and "+9725x" and a pasted number with spaces all resolve to
//     one E.164 value, and anything that is not a dialable number is refused before a
//     request is made rather than after ExtrA charges for it.
//  3. logActivity records the outcome and the provider codes — never the destination.
//     Knowing a test was run and what it returned is the audit value; the number the
//     admin typed is personal data and does not belong in the log.
//
// The message deliberately carries no event, guest, or account detail: a wrong digit
// sends it to a stranger, and a stranger should learn nothing from it.
const TEST_MESSAGE = 'בדיקת חיבור SMS ממערכת KALFA. אין צורך להשיב.';

const TEST_SMS_LIMIT = 3;
const TEST_SMS_WINDOW_MS = 60 * 60 * 1000;

export async function sendExtraTestSmsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePlatformPermission('manage_settings');

  const raw = String(formData.get('test_destination') ?? '').trim();
  if (!raw) {
    return { fieldErrors: { test_destination: ['מספר יעד חובה'] } };
  }
  const destination = normalizePhone(raw);
  if (!destination) {
    return { fieldErrors: { test_destination: ['מספר הטלפון אינו תקין'] } };
  }

  const gate = rateLimit(`extra-test-sms:${staff.id}`, {
    limit: TEST_SMS_LIMIT,
    windowMs: TEST_SMS_WINDOW_MS,
  });
  if (!gate.allowed) {
    const minutes = Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 60_000));
    return { error: `הגעתם למגבלת ${TEST_SMS_LIMIT} הודעות בדיקה בשעה. נסו שוב בעוד ${minutes} דקות.` };
  }

  const settings = await readSmsSettings();
  if (settings.kind !== 'ok') {
    return { error: 'פרטי ExtrA אינם מוגדרים — שמרו טוקן ושולח לפני בדיקה.' };
  }

  // Deliberately NOT getSmsSender(): that refuses while `sms_enabled` is off, and a
  // test send is exactly what someone does BEFORE switching the channel on. The
  // credentials are what the test exercises; the switch governs product traffic.
  const sender = createExtraSmsSender({ token: settings.token, sender: settings.sender });

  try {
    await sender.send({ to: destination, text: TEST_MESSAGE });
  } catch (err) {
    unstable_rethrow(err);

    // sender.ts throws with the provider's errors[] appended as JSON. Re-read them
    // through the mapper so the operator gets an action instead of a code — and so a
    // response carrying BOTH "no credit card" and "sender not verified" reports both.
    const mapped = err instanceof SmsSendError ? mapSmsErrors(extractErrors(err.message)) : [];
    void logActivity({
      action: 'admin.extra.test_sms',
      meta: { ok: false, codes: mapped.map((e) => e.code) },
    });

    const senderFault = mapped.find((e) => e.field === 'extra_sms_sender');
    const rest = mapped.filter((e) => e.field !== 'extra_sms_sender');
    if (senderFault) {
      return {
        fieldErrors: { extra_sms_sender: [senderFault.message] },
        ...(rest.length ? { error: rest.map((e) => e.message).join(' · ') } : {}),
      };
    }
    return {
      error: rest.length
        ? rest.map((e) => e.message).join(' · ')
        : 'שליחת הודעת הבדיקה נכשלה.',
    };
  }

  void logActivity({ action: 'admin.extra.test_sms', meta: { ok: true, codes: [] } });
  return { notice: 'הודעת בדיקה נשלחה. אם היא לא הגיעה תוך דקה — השולח כנראה אינו מאומת.' };
}

/**
 * Pull the provider's `errors[]` back out of the message sender.ts threw.
 *
 * A seam, not a design: `createExtraSmsSender` stringifies the array into its error
 * message rather than carrying it structurally. Parsing it back is ugly, and the
 * alternative — widening SmsSendError — would touch the OTP and cancellation send
 * paths for the benefit of one admin button. Returns [] on anything unexpected, so a
 * change to that message shape degrades the detail rather than throwing here.
 */
function extractErrors(message: string): unknown {
  const start = message.indexOf('[');
  const end = message.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    return JSON.parse(message.slice(start, end + 1));
  } catch {
    return [];
  }
}
