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
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);

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
  // yet. Tell the user to confirm rather than redirecting into a protected area
  // (which the proxy would bounce back to login with no feedback).
  if (!data.session) {
    return {
      notice: 'נשלח אליכם אימייל לאישור החשבון. אנא אשרו ולאחר מכן התחברו.',
    };
  }

  redirect('/app');
}
