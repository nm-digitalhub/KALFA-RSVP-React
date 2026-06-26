'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { updateProfile } from '@/lib/data/profiles';
import { updateUserSettings } from '@/lib/data/user-settings';
import { createClient } from '@/lib/supabase/server';
import {
  emailChangeSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from '@/lib/validation/schemas';
import type { FormState } from '@/lib/validation/result';

function isNextRedirect(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
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
    if (isNextRedirect(err)) throw err;
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
    if (isNextRedirect(err)) throw err;
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

    const { error } = await supabase.auth.updateUser({
      email: parsed.data.email,
    });
    if (error) {
      return { error: 'שליחת אישור המייל נכשלה. נסו שוב מאוחר יותר.' };
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
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
    if (isNextRedirect(err)) throw err;
    return { error: 'שליחת קישור איפוס הסיסמה נכשלה. נסו שוב.' };
  }

  return { notice: 'נשלח קישור איפוס סיסמה לאימייל שלכם.' };
}
