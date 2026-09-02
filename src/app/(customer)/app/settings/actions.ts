'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { normalizePhone } from '@/lib/phone';
import { updateProfile } from '@/lib/data/profiles';
import { updateUserSettings } from '@/lib/data/user-settings';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/url';
import {
  emailChangeSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from '@/lib/validation/schemas';
import type { FormState } from '@/lib/validation/result';

// Phone-number ownership, proved by Supabase Auth itself.
//
// NO OTP mechanism of our own: Auth mints the code, sets its TTL and verifies
// it. Our only part is DELIVERY — the send_sms Auth Hook (supabase/functions/
// sms-hook) hands the code to ExtrA, the provider the rest of the product
// already uses, because Auth's built-in senders do not include it.
//
// The truth therefore lives in auth.users.phone / phone_confirmed_at, not in a
// column of ours. profiles.phone stays what it always was — the display value
// the owner typed.

// Auth stores the phone as bare digits ("972501234567"); normalizePhone
// returns E.164 with the plus ("+972501234567"). Every comparison against
// auth.users MUST go through this or it silently never matches.
function bareDigits(e164: string): string {
  return e164.replace(/^\+/, '');
}

// Copy the proved number onto the profile. Two columns, not one flag: the
// product asks "is the CURRENT phone verified?" as
// normalizePhone(phone) === phone_verified_e164, so editing `phone` un-verifies
// it by construction (see the migration's comment).
//
// A direct column write, NOT updateProfile(): that helper upserts the whole row
// and would blank full_name, which these actions never receive.
async function mirrorVerifiedPhone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  phone: string,
  verifiedAt: string,
): Promise<void> {
  const { id: userId } = await requireUser();
  const { error } = await supabase
    .from('profiles')
    .update({
      phone,
      phone_verified_e164: phone,
      phone_verified_at: verifiedAt,
    })
    .eq('id', userId);

  // The USER is never told the mirror failed — auth.users already records the
  // verification and that is the authority. But it is logged: an earlier
  // version wrote only `phone`, so phone_verified_at stayed null forever and
  // the "מאומת" badge could never appear, with nothing anywhere to show why
  // (measured 2026-09-02).
  if (error) {
    console.error('[settings] verified-phone mirror write failed', {
      code: error.code,
      message: error.message,
    });
  }
}

// Step 1 — ask Auth to change the phone, which makes it send the code.
// updateUser (not signInWithOtp) because this is an ALREADY-AUTHENTICATED user
// proving a number, never a login: the cookie client carries their session and
// Auth refuses the call without one.
export async function requestPhoneChangeAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  if (!phone) return { fieldErrors: { phone: ['מספר טלפון לא תקין'] } };

  const supabase = await createClient();

  // Asking Auth to "change" the phone to the one it already holds is a NO-OP:
  // GoTrue starts a phone change only when the number differs. It returns
  // success and sends nothing, so the old code answered "a code was sent" for
  // an SMS that was never dispatched — a promise the user cannot act on.
  // Measured 2026-09-02: phone_change_sent_at never moved and no SMS arrived.
  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData.user;
  if (
    authUser?.phone_confirmed_at &&
    authUser.phone === bareDigits(phone)
  ) {
    // Also reconciles a profile whose mirror is missing or stale.
    await mirrorVerifiedPhone(supabase, phone, authUser.phone_confirmed_at);
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
    return { error: 'שליחת קוד האימות נכשלה. בדקו את המספר ונסו שוב.' };
  }
  return { notice: 'קוד אימות נשלח בהודעת SMS למספר שהוזן.' };
}

// Step 2 — verify. type MUST be 'phone_change', never 'sms': 'sms' is the
// LOGIN flow, and using it here would both fail (no pending login challenge)
// and, if it ever succeeded, mint a session from a profile edit.
export async function verifyPhoneChangeAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  if (!phone) return { fieldErrors: { phone: ['מספר טלפון לא תקין'] } };

  const token = String(formData.get('otp_code') ?? '').trim();
  if (!/^\d{6}$/.test(token)) {
    return { fieldErrors: { otp_code: ['יש להזין קוד בן 6 ספרות'] } };
  }

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
    return { fieldErrors: { otp_code: ['הקוד שגוי או פג תוקפו'] } };
  }

  await mirrorVerifiedPhone(supabase, phone, new Date().toISOString());

  await logActivity({ action: 'profile.phone_verified' });
  revalidatePath('/app/settings');
  return { notice: 'הטלפון אומת.' };
}

export async function updateProfileAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateProfileSchema.safeParse({
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { full_name, phone } = parsed.data;

  try {
    await updateProfile({
      full_name: full_name ? full_name : null,
      phone: phone ? phone : null,
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שמירת הפרטים נכשלה. נסו שוב.' };
  }

  revalidatePath('/app/settings');
  return { notice: 'הפרטים נשמרו' };
}

export async function updateSettingsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateSettingsSchema.safeParse({
    event_updates: formData.get('event_updates'),
    reminder_updates: formData.get('reminder_updates'),
    billing_updates: formData.get('billing_updates'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateUserSettings(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שמירת ההעדפות נכשלה. נסו שוב.' };
  }

  revalidatePath('/app/settings');
  return { notice: 'ההעדפות נשמרו' };
}

// Request an email-address change. Double opt-in: Supabase sends a confirmation
// link to the NEW address (and, with secure email change, the old one too); the
// address only changes AFTER the user clicks it. We never change it directly.
export async function requestEmailChangeAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailChangeSchema.safeParse({
    email: formData.get('new_email'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email && user.email.toLowerCase() === parsed.data.email.toLowerCase()) {
      return { error: 'הכתובת החדשה זהה לכתובת הנוכחית.' };
    }

    // Route the confirmation through OUR /auth/confirm interstitial (the same
    // token_hash flow as recovery/magic-link). {{ .RedirectTo }} becomes our
    // trusted /auth/confirm URL; the email_change template appends
    // token_hash+type=email_change+next=/app/settings.
    const { error } = await supabase.auth.updateUser(
      { email: parsed.data.email },
      { emailRedirectTo: await getAppUrl('/auth/confirm') },
    );
    if (error) {
      return { error: 'שליחת אישור המייל נכשלה. נסו שוב מאוחר יותר.' };
    }
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שליחת אישור המייל נכשלה. נסו שוב.' };
  }

  await logActivity({
    action: 'profile.email_change_requested',
    meta: { source: 'settings.account' },
  });

  return {
    notice:
      'נשלח קישור אישור לכתובת החדשה. כתובת המייל תתחלף רק לאחר שתאשרו דרך הקישור (וגם תאשרו בכתובת הנוכחית אם נדרש).',
  };
}

export async function sendPasswordResetAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _prevState;
  void _formData;

  try {
    const user = await requireUser();
    if (!user.email) {
      return { error: 'לא נמצאה כתובת אימייל לחשבון.' };
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(user.email);
    if (error) {
      return { error: 'שליחת קישור איפוס הסיסמה נכשלה. נסו שוב.' };
    }

    await logActivity({
      action: 'password.reset_requested',
      meta: {
        source: 'settings.security',
      },
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שליחת קישור איפוס הסיסמה נכשלה. נסו שוב.' };
  }

  return { notice: 'נשלח קישור איפוס סיסמה לאימייל שלכם.' };
}
