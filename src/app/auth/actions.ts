'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { isExistingUserSignup } from '@/lib/auth/signup-helpers';
import { loginSchema, signupSchema } from '@/lib/validation/schemas';
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
