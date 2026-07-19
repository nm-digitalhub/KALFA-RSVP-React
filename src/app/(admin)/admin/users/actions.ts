'use server';

import { revalidatePath } from 'next/cache';

import {
  setPlatformAdmin,
  setUserSuspended,
  grantBillingCredit,
} from '@/lib/data/admin/users';
import {
  adminUserIdSchema,
  grantCreditSchema,
} from '@/lib/validation/admin';
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

// The admin data layer only throws Error with our own safe Hebrew messages
// (last-admin / no-self-lockout / not-found / generic) — never raw DB detail —
// so surfacing err.message is safe; anything else falls back to a generic.
function safeMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// Revalidate the whole /admin/users subtree (list + the open detail page).
function revalidateUsers(): void {
  revalidatePath('/admin/users', 'layout');
}

export async function grantAdminAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = adminUserIdSchema.safeParse({ user_id: formData.get('user_id') });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await setPlatformAdmin(parsed.data.user_id, true);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'הפעולה נכשלה') };
  }
  revalidateUsers();
  return { notice: 'הוענקה הרשאת מנהל מערכת' };
}

export async function revokeAdminAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = adminUserIdSchema.safeParse({ user_id: formData.get('user_id') });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await setPlatformAdmin(parsed.data.user_id, false);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'הפעולה נכשלה') };
  }
  revalidateUsers();
  return { notice: 'הרשאת מנהל המערכת נשללה' };
}

export async function suspendUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = adminUserIdSchema.safeParse({ user_id: formData.get('user_id') });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await setUserSuspended(parsed.data.user_id, true);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'הפעולה נכשלה') };
  }
  revalidateUsers();
  return { notice: 'המשתמש הושהה' };
}

export async function reactivateUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = adminUserIdSchema.safeParse({ user_id: formData.get('user_id') });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await setUserSuspended(parsed.data.user_id, false);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'הפעולה נכשלה') };
  }
  revalidateUsers();
  return { notice: 'המשתמש שוחזר' };
}

export async function grantCreditAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = grantCreditSchema.safeParse({
    event_id: formData.get('event_id'),
    campaign_id: formData.get('campaign_id') ?? '',
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await grantBillingCredit({
      eventId: parsed.data.event_id,
      campaignId: parsed.data.campaign_id || null,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
    });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'מתן ההטבה נכשל') };
  }
  revalidateUsers();
  return { notice: 'ההטבה ניתנה' };
}
