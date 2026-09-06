'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  GA_FLAG_COOKIE_MAX_AGE_SECONDS,
  GA_FLAG_COOKIE_NAME,
} from '@/lib/analytics/ga-event-contracts';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isExistingUserSignup } from '@/lib/auth/signup-helpers';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '@/lib/validation/schemas';
import { getAppUrl } from '@/lib/url';
import type { FormState } from '@/lib/validation/result';

// The login form needs one thing the shared FormState cannot express: WHICH
// address is awaiting confirmation, so the form can offer to resend to it
// without asking the user to retype it (React resets the inputs after a form
// action). Kept local rather than widening FormState for every other form.
export type LoginState = (NonNullable<FormState> & { unconfirmedEmail?: string }) | null;

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
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
    // The generic message is deliberate anti-enumeration: a wrong password and
    // an address that was never registered must look identical. `email_not_confirmed`
    // is the one safe exception — GoTrue returns it only once the password has
    // ALREADY matched. Verified against the live project: an unconfirmed account
    // probed with a WRONG password answers invalid_credentials, exactly like an
    // address that does not exist. So naming this case tells nothing to anyone
    // who is not already holding valid credentials, and it is the difference
    // between a signed-up customer retyping a correct password forever and
    // being told to go check their inbox.
    if (error.code === 'email_not_confirmed') {
      return {
        error:
          'החשבון עדיין לא אומת. שלחנו לכם מייל אישור בעת ההרשמה — בדקו את תיבת הדואר, וגם את תיקיית הספאם.',
        unconfirmedEmail: parsed.data.email,
      };
    }
    return { error: 'אימייל או סיסמה שגויים' };
  }

  redirect('/app');
}

// Offered by the login form after an `email_not_confirmed` failure (see above),
// but callable on its own — so it stays enumeration-safe by construction: the
// SAME notice comes back whether the address is unknown, already confirmed, or
// genuinely re-sent. auth.resend() is not enumeration-safe on its own (it
// answers 422 for an already-confirmed user), which is exactly why its outcome
// is never reflected back to the caller.
//
// emailRedirectTo becomes {{ .RedirectTo }} in the confirmation template, the
// same contract the recovery email uses: the link host comes from OUR
// APP_ORIGIN and /auth/confirm stays the authority that verifies the OTP.
export async function resendConfirmationEmail(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  await supabase.auth.resend({
    type: 'signup',
    email: parsed.data.email,
    options: { emailRedirectTo: await getAppUrl('/auth/confirm') },
  });

  return {
    notice:
      'אם קיים חשבון שטרם אומת עם כתובת זו, נשלח אליו מייל אישור חדש. בדקו את תיבת הדואר (וגם את תיקיית הספאם).',
  };
}

// `salesRef` is BOUND (signup.bind(null, ref) in signup-form.tsx), not a form
// field: bound closure variables are encrypted by Next before reaching the
// client, so a viewer cannot retype the token as another lead's attempt id.
// It is still validated and re-verified below — encryption proves the value
// was not edited in transit, never that it should be trusted.
export async function signup(
  salesRef: string | undefined,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
    ref: salesRef ?? '',
    terms_accepted: formData.get('terms_accepted'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { email, password, full_name, phone, ref } = parsed.data;

  // Sales-closing-agent conversion tracking: re-verify the ref actually
  // resolves to a real sales_call_attempts row BEFORE it ever reaches
  // auth.signUp's metadata — never trust the query param on its own. A
  // stale/forged/malformed ref silently degrades to "no attribution"; it
  // must never be able to fail the signup itself (see the migration's own
  // comment on why handle_new_user() also has no FK to violate).
  let salesReferralAttemptId: string | undefined;
  if (ref) {
    try {
      const admin = createAdminClient();
      const { data: attempt } = await admin
        .from('sales_call_attempts')
        .select('id')
        .eq('id', ref)
        .maybeSingle();
      // "The row exists" is NOT enough on its own: an attempt id travels in a
      // WhatsApp link and a URL, so anyone holding one could otherwise pin
      // their signup onto a lead they never were. One attempt is one lead, so
      // it may be claimed exactly ONCE — a second profile carrying the same id
      // would silently double-count that call in the conversion metric
      // (signup_completed_at, which agreements.ts stamps per attempt).
      // Already-claimed degrades to "no attribution", never a signup failure,
      // exactly like a malformed ref.
      if (attempt) {
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('sales_referral_attempt_id', attempt.id);
        if (!count) salesReferralAttemptId = attempt.id;
      }
    } catch {
      // Unreadable -> no attribution, never blocks signup.
    }
  }

  const supabase = await createClient();
  // full_name/phone/terms_accepted go into auth user_metadata; the
  // handle_new_user() trigger copies them into the profiles row on insert
  // (no separate write needed). terms_accepted is only ever sent here,
  // already validated 'on' by the schema above — the trigger stamps
  // terms_accepted_at from its mere presence, never unconditionally (see the
  // migration's own comment on why: an admin-created user via
  // auth.admin.createUser() must never be recorded as having consented).
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Becomes {{ .RedirectTo }} in the confirmation email template, so the
      // link's host comes from our own APP_ORIGIN and lands on /auth/confirm
      // (which verifies the OTP on POST) rather than on GoTrue's SiteURL.
      emailRedirectTo: await getAppUrl('/auth/confirm'),
      data: {
        full_name,
        phone: phone ?? '',
        terms_accepted: true,
        ...(salesReferralAttemptId
          ? { sales_referral_attempt_id: salesReferralAttemptId }
          : {}),
      },
    },
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

  // Analytics flag (phase-1 events plan): a one-shot, short-lived cookie the
  // destination page's GaFlagListener consumes exactly once to queue the
  // `sign_up` event — a redirecting action has no in-place send point. Not
  // httpOnly by design (client JS must read it); carries an event name only.
  (await cookies()).set(GA_FLAG_COOKIE_NAME, 'sign_up', {
    maxAge: GA_FLAG_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
  });

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
