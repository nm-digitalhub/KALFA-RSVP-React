'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { isExistingUserSignup } from '@/lib/auth/signup-helpers';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '@/lib/validation/schemas';
import { getAppUrl } from '@/lib/url';
import type { FormState } from '@/lib/validation/result';

export async function login(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: 'אימייל או סיסמה שגויים' };
  }

  redirect('/app');
}

export async function signup(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { email, password, full_name, phone } = parsed.data;

  const supabase = await createClient();
  // full_name/phone go into auth user_metadata; the handle_new_user() trigger
  // copies them into the profiles row on insert (no separate write needed).
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, phone: phone ?? '' } },
  });

  if (error) {
    return { error: 'ההרשמה נכשלה. נסו שוב מאוחר יותר.' };
  }

  // With email confirmation enabled, signUp does not return an error for an
  // already-registered email (Supabase obfuscates it to prevent enumeration).
  // Instead it returns a user with an empty `identities` array and no session,
  // and sends no email. Detect that case and block it with a clear message.
  if (isExistingUserSignup(data)) {
    return { error: 'כתובת המייל כבר רשומה. אנא היכנסו לחשבון הקיים.' };
  }

  // Genuine new signup: email confirmation is required, so there is no session
  // yet. Send the user to a dedicated success page (rather than an inline
  // notice) that explains the email-confirmation step.
  if (!data.session) {
    redirect('/auth/signup/success');
  }

  redirect('/app');
}

// Step 1 of the reset flow: an UNAUTHENTICATED user requests a recovery email.
// resetPasswordForEmail is enumeration-safe (no error whether or not the address
// exists), so the response is identical either way.
//
// `redirectTo` becomes {{ .RedirectTo }} in the recovery email template. We point
// it at OUR trusted /auth/confirm URL (getAppUrl → APP_ORIGIN), so the email
// link's host comes from our own config, NOT from Supabase's SiteURL. The
// template then builds exactly:
//   {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password
// = https://<app>/auth/confirm?token_hash=…&type=recovery&next=/auth/reset-password
// /auth/confirm remains the authority: it verifies the OTP (type=recovery), writes
// the session cookies, and redirects to the validated next (/auth/reset-password).
export async function requestPasswordReset(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  // {{ .RedirectTo }} = our trusted /auth/confirm URL (see contract above).
  const redirectTo = await getAppUrl('/auth/confirm');
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo,
  });
  if (error) {
    return { error: 'שליחת קישור האיפוס נכשלה. נסו שוב מאוחר יותר.' };
  }

  // Privacy-safe: the same confirmation regardless of whether the email is
  // registered (never reveal account existence).
  return {
    notice:
      'אם קיים חשבון עם כתובת זו, נשלח אליו קישור לאיפוס הסיסמה. בדקו את תיבת הדואר (וגם בתיקיית הספאם).',
  };
}

// Step 2 of the reset flow. updateUser changes the CURRENT session user's
// password, so a valid authenticated session must already exist. In the reset
// flow that session is normally created when the recovery link is verified at
// /auth/confirm (verifyOtp type=recovery) — a normal Supabase session, not a
// special "recovery-only" one. The getUser() check below only proves a valid
// session EXISTS; it does not (and cannot) prove the session came from a recovery
// link — which is fine, since any authenticated user may change their own password.
export async function updatePassword(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  // getUser() asks the Auth server whether a valid session exists (it does not
  // reveal how that session was created). No valid session → no user to update
  // (recovery link not followed, expired, or already used).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'קישור האיפוס אינו תקף או שפג תוקפו. בקשו קישור חדש.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: 'עדכון הסיסמה נכשל. נסו שוב.' };
  }

  redirect('/app');
}
