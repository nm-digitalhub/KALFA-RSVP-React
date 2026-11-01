'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { returnValidationErrors } from 'next-safe-action';
import { zfd } from 'zod-form-data';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { updateExtraSmsConfig } from '@/lib/data/admin/settings';
import { normalizePhone } from '@/lib/phone';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { rateLimit } from '@/lib/security/rate-limit';
import { mapSmsErrors } from '@/lib/sms/extra-client';
import { createExtraSmsSender, readSmsSettings, SmsSendError } from '@/lib/sms/sender';
import { extraSmsSchema } from '@/lib/validation/admin';

const PATH = '/admin/integrations/extra-sms';
const INDEX = '/admin/integrations';

// An unticked checkbox is absent from the post and reads as off; an absent text
// field reads as '' and an absent cap as 0 — both fail closed.
const extraSmsForm = zfd.formData({
  sms_enabled: zfd.checkbox(),
  extra_sms_sender: extraSmsSchema.shape.extra_sms_sender.prefault(''),
  extra_sms_token: extraSmsSchema.shape.extra_sms_token.prefault(''),
  callback_intake_sms_enabled: zfd.checkbox(),
  callback_intake_sms_daily_cap: extraSmsSchema.shape.callback_intake_sms_daily_cap.prefault(0),
});

export const updateExtraSmsAction = actionClient
  .inputSchema(extraSmsForm)
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateExtraSmsConfig(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון הגדרות ה-SMS נכשל. נסו שוב.');
    }
    // The index card prints `configured`/`enabled` for the very columns just written.
    revalidatePath(PATH);
    revalidatePath(INDEX);
    return { notice: 'הגדרות ה-SMS נשמרו' };
  });

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

// The destination is read and checked here, in the body, exactly as before (blank, then not a dialable number), so the
// input schema takes it as posted. `extra_sms_sender` is never posted by the test form; it is declared so a sender fault
// from the provider can be returned on that field.
const testSmsForm = zfd.formData({
  test_destination: z.unknown().optional(),
  extra_sms_sender: z.unknown().optional(),
});

export const sendExtraTestSmsAction = actionClient
  // The gate runs before anything else, the input included (use() runs before validation); its staff id keys the
  // rate limit below.
  .use(async ({ next }) => {
    const staff = await requirePlatformPermission('manage_settings');
    return next({ ctx: { staff } });
  })
  .inputSchema(testSmsForm)
  .stateAction(async ({ parsedInput, ctx: { staff } }) => {
    const raw = String(parsedInput.test_destination ?? '').trim();
    if (!raw) {
      return returnValidationErrors(testSmsForm, { test_destination: { _errors: ['מספר יעד חובה'] } });
    }
    const destination = normalizePhone(raw);
    if (!destination) {
      return returnValidationErrors(testSmsForm, { test_destination: { _errors: ['מספר הטלפון אינו תקין'] } });
    }

    const gate = (await rateLimit(`extra-test-sms:${staff.id}`, {
      limit: TEST_SMS_LIMIT,
      windowMs: TEST_SMS_WINDOW_MS,
    }));
    if (!gate.allowed) {
      const minutes = Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 60_000));
      return returnUserError(`הגעתם למגבלת ${TEST_SMS_LIMIT} הודעות בדיקה בשעה. נסו שוב בעוד ${minutes} דקות.`);
    }

    const settings = await readSmsSettings();
    if (settings.kind !== 'ok') {
      return returnUserError('פרטי ExtrA אינם מוגדרים — שמרו טוקן ושולח לפני בדיקה.');
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
        // The sender's fault lands on its field; the rest stays the form-level message.
        return returnValidationErrors(testSmsForm, {
          ...(rest.length ? { _errors: [rest.map((e) => e.message).join(' · ')] } : {}),
          extra_sms_sender: { _errors: [senderFault.message] },
        });
      }
      return returnUserError(
        rest.length
          ? rest.map((e) => e.message).join(' · ')
          : 'שליחת הודעת הבדיקה נכשלה.',
      );
    }

    void logActivity({ action: 'admin.extra.test_sms', meta: { ok: true, codes: [] } });
    return { notice: 'הודעת בדיקה נשלחה. אם היא לא הגיעה תוך דקה — השולח כנראה אינו מאומת.' };
  });

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
