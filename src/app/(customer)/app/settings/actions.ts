'use server';

import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { returnValidationErrors } from 'next-safe-action';

import { requireUser } from '@/lib/auth/dal';
import { verifiedPhoneOf } from '@/lib/auth/verified-phone';
import { isMarketingConsentEnabled, recordConsent } from '@/lib/data/marketing-consent';
import { enqueueMarketingContactSync } from '@/lib/data/marketing-contact-sync';
import { socketClientIp } from '@/lib/security/client-ip';
import { logActivity } from '@/lib/data/activity';
import { normalizePhone } from '@/lib/phone';
import { updateProfile } from '@/lib/data/profiles';
import { updateUserSettings } from '@/lib/data/user-settings';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/url';
import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  emailChangeSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from '@/lib/validation/schemas';

// Phone-number ownership, proved by Supabase Auth itself.
//
// Auth mints the code, sets its TTL and verifies it; this flow has no OTP of
// its own. Our only part is DELIVERY — the send_sms Auth Hook (supabase/
// functions/sms-hook) hands the code to ExtrA. (Agreement signing is a
// different flow with its own OTP — src/lib/data/otp.ts.)
//
// The proof lives in auth.users.phone / phone_confirmed_at, read through
// src/lib/auth/verified-phone.ts. profiles.phone is only the display value the
// owner sees — copied from the signup form unchecked, then replaced by each
// proved number below — and nothing reads it as proof: even the WhatsApp import,
// which finds candidates by it, checks the proved phone (whatsapp-import.ts
// resolveVerifiedSender).

// The number as typed, normalized to E.164 (normalizePhone). One the normalizer cannot read is refused under the
// field, before anything else runs.
const phoneField = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const phone = normalizePhone(value ?? '');
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'מספר טלפון לא תקין' });
      return z.NEVER;
    }
    return phone;
  });

// Show the proved number in the profile's display field, so the screen and
// every place that prints profiles.phone show the number that was proved.
//
// A direct column write, NOT updateProfile(): that helper writes the display
// name only (the profile form), never the phone.
async function syncDisplayPhone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  phone: string,
): Promise<void> {
  const { id: userId } = await requireUser();
  const { error } = await supabase.from('profiles').update({ phone }).eq('id', userId);

  // The user is not told this failed — auth.users already holds the proof. It
  // is logged so a display field that did not follow can be traced.
  if (error) {
    console.error('[settings] display phone sync failed', {
      code: error.code,
      message: error.message,
    });
  }
}

// Step 1 — ask Auth to change the phone, which makes it send the code.
// updateUser (not signInWithOtp) because this is an ALREADY-AUTHENTICATED user
// proving a number, never a login: the cookie client carries their session and
// Auth refuses the call without one.
export const requestPhoneChangeAction = actionClient
  .inputSchema(zfd.formData({ phone: phoneField }))
  .stateAction(async ({ parsedInput: { phone } }) => {
    const supabase = await createClient();

    // Asking Auth to "change" the phone to the one it already holds is a NO-OP:
    // GoTrue starts a phone change only when the number differs. It returns
    // success and sends nothing, so the old code answered "a code was sent" for
    // an SMS that was never dispatched — a promise the user cannot act on.
    // Measured 2026-09-02: phone_change_sent_at never moved and no SMS arrived.
    const { data: authData } = await supabase.auth.getUser();
    if (verifiedPhoneOf(authData.user) === phone) {
      // Also brings back a display field that drifted from the proved number.
      await syncDisplayPhone(supabase, phone);
      revalidatePath('/app/settings');
      return { notice: 'המספר הזה כבר מאומת. לא נשלח קוד.' };
    }

    const { error } = await supabase.auth.updateUser({ phone });
    if (error) {
      // Generic message to the user, FULL detail to the server log — the same
      // split the SMS and SUMIT layers already use. Without the log a failure
      // here is undiagnosable (measured: the first live attempt returned only
      // the generic string and the cause had to be found in the Auth config).
      // No phone number: it is PII and the log is not the place for it.
      console.error('[settings] phone change rejected by Auth', {
        status: error.status,
        code: error.code,
        message: error.message,
      });
      returnUserError('שליחת קוד האימות נכשלה. בדקו את המספר ונסו שוב.');
    }
    return { notice: 'קוד אימות נשלח בהודעת SMS למספר שהוזן.' };
  });

// Step 2 — verify. type MUST be 'phone_change', never 'sms': 'sms' is the
// LOGIN flow, and using it here would both fail (no pending login challenge)
// and, if it ever succeeded, mint a session from a profile edit.
const verifyPhoneChangeSchema = zfd.formData({
  phone: phoneField,
  otp_code: z
    .string()
    .optional()
    .transform((value) => (value ?? '').trim())
    .pipe(z.string().regex(/^\d{6}$/, { error: 'יש להזין קוד בן 6 ספרות' })),
});

export const verifyPhoneChangeAction = actionClient
  .inputSchema(verifyPhoneChangeSchema)
  .stateAction(async ({ parsedInput: { phone, otp_code: token } }) => {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'phone_change',
    });
    if (error) {
      console.error('[settings] phone OTP verification failed', {
        status: error.status,
        code: error.code,
        message: error.message,
      });
      returnValidationErrors(verifyPhoneChangeSchema, { otp_code: { _errors: ['הקוד שגוי או פג תוקפו'] } });
    }

    await syncDisplayPhone(supabase, phone);

    await logActivity({ action: 'profile.phone_verified' });
    revalidatePath('/app/settings');
    return { notice: 'הטלפון אומת.' };
  });

// The profile form posts the display name only. The phone is proved through Supabase Auth and written to
// profiles.phone by syncDisplayPhone above; this action never touches it.
export const updateProfileAction = actionClient
  .inputSchema(zfd.formData(updateProfileSchema))
  .stateAction(async ({ parsedInput: { full_name } }) => {
    try {
      await updateProfile({ full_name: full_name ? full_name : null });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת הפרטים נכשלה. נסו שוב.');
    }

    revalidatePath('/app/settings');
    return { notice: 'הפרטים נשמרו' };
  });

export const updateSettingsAction = actionClient
  .inputSchema(zfd.formData(updateSettingsSchema))
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateUserSettings(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת ההעדפות נכשלה. נסו שוב.');
    }

    revalidatePath('/app/settings');
    return { notice: 'ההעדפות נשמרו' };
  });

// Request an email-address change. Double opt-in: Supabase sends a confirmation
// link to the NEW address (and, with secure email change, the old one too); the
// address only changes AFTER the user clicks it. We never change it directly.
//
// The request itself; a refusal comes back as its message. It stays out of the action's try because returnUserError
// throws, and that catch would replace the refusal with its own message.
async function requestEmailChange(email: string): Promise<string | undefined> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email && user.email.toLowerCase() === email.toLowerCase()) {
    return 'הכתובת החדשה זהה לכתובת הנוכחית.';
  }

  // Route the confirmation through OUR /auth/confirm interstitial (the same
  // token_hash flow as recovery/magic-link). {{ .RedirectTo }} becomes our
  // trusted /auth/confirm URL; the email_change template appends
  // token_hash+type=email_change+next=/app/settings.
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: await getAppUrl('/auth/confirm') },
  );
  if (error) {
    return 'שליחת אישור המייל נכשלה. נסו שוב מאוחר יותר.';
  }
}

export const requestEmailChangeAction = actionClient
  .inputSchema(zfd.formData({ new_email: emailChangeSchema.shape.email }))
  .stateAction(async ({ parsedInput: { new_email } }) => {
    let refusal: string | undefined;
    try {
      refusal = await requestEmailChange(new_email);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שליחת אישור המייל נכשלה. נסו שוב.');
    }
    if (refusal) returnUserError(refusal);

    await logActivity({
      action: 'profile.email_change_requested',
      meta: { source: 'settings.account' },
    });

    return {
      notice:
        'נשלח קישור אישור לכתובת החדשה. כתובת המייל תתחלף רק לאחר שתאשרו דרך הקישור (וגם תאשרו בכתובת הנוכחית אם נדרש).',
    };
  });

// The reset request; a refusal comes back as its message (kept out of the action's try, as above).
async function requestPasswordReset(): Promise<string | undefined> {
  const user = await requireUser();
  if (!user.email) {
    return 'לא נמצאה כתובת אימייל לחשבון.';
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(user.email);
  if (error) {
    return 'שליחת קישור איפוס הסיסמה נכשלה. נסו שוב.';
  }

  await logActivity({
    action: 'password.reset_requested',
    meta: {
      source: 'settings.security',
    },
  });
}

// The form posts no fields; its (empty) FormData is the input.
export const sendPasswordResetAction = actionClient
  .inputSchema(zfd.formData({}))
  .stateAction(async () => {
    let refusal: string | undefined;
    try {
      refusal = await requestPasswordReset();
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שליחת קישור איפוס הסיסמה נכשלה. נסו שוב.');
    }
    if (refusal) returnUserError(refusal);

    return { notice: 'נשלח קישור איפוס סיסמה לאימייל שלכם.' };
  });

// Marketing-email consent from settings (openspec change marketing-email-consent, spec marketing-consent).
//
// Only the choice comes from the form; the user is the verified session user, and the wording recorded with a grant
// is the server's (recordConsent). Saving without a change writes nothing. The Resend contact follows through a
// queued job, so a Resend outage never fails this action; a grant carries `resubscribe`, the only job allowed to turn
// a contact Resend holds as unsubscribed back on.
//
// The session user, the feature switch and the account's email are checked BEFORE the choice is read, as they always
// were: a pre-validation middleware (`use()` runs ahead of the input schema) hands the user to the body.
export const updateMarketingConsentAction = actionClient
  .use(async ({ next }) => {
    const user = await requireUser();
    if (!(await isMarketingConsentEnabled())) returnUserError('האפשרות אינה זמינה כרגע.');
    if (!user.email) returnUserError('לחשבון אין כתובת אימייל.');
    return next({ ctx: { userId: user.id, email: user.email } });
  })
  .inputSchema(zfd.formData({ marketing_opt_in: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { marketing_opt_in: wantsMarketing }, ctx: { userId, email } }) => {
    const requestHeaders = await headers();
    let result;
    try {
      result = await recordConsent({
        userId,
        email,
        action: wantsMarketing ? 'grant' : 'withdraw',
        source: 'settings',
        ip: socketClientIp((name) => requestHeaders.get(name)),
        userAgent: requestHeaders.get('user-agent'),
      });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת ההעדפה נכשלה. נסו שוב.');
    }

    if (result === 'recorded') {
      try {
        await enqueueMarketingContactSync({ userId, ...(wantsMarketing ? { resubscribe: true } : {}) });
      } catch (err) {
        // Recorded; the daily reconcile brings Resend in line.
        console.error('[settings] marketing contact sync was not queued', {
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    revalidatePath('/app/settings');
    return { notice: wantsMarketing ? 'נרשמתם לעדכונים בדוא״ל.' : 'הוסרתם מעדכונים בדוא״ל.' };
  });
