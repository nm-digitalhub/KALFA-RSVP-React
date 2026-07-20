'use server';

import { revalidatePath } from 'next/cache';

import {
  setPlatformAdmin,
  setUserSuspended,
  grantBillingCredit,
  voidBillingCredit,
  getUserDetail,
  type AdminUserDetail,
} from '@/lib/data/admin/users';
import {
  adminUserIdSchema,
  adminUserViewSchema,
  grantCreditSchema,
  voidCreditSchema,
} from '@/lib/validation/admin';
import type { ActionResult, FormState } from '@/lib/validation/result';

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
    user_id: formData.get('user_id'),
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
      ownerId: parsed.data.user_id,
    });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'מתן ההטבה נכשל') };
  }
  revalidateUsers();
  return { notice: 'ההטבה ניתנה' };
}

// Break-glass view of ANOTHER user's full detail. The reason is validated here
// and re-enforced by getUserDetail, which writes the audit row (subject_type
// 'user') BEFORE returning any PII — fail-closed. The self-view path never
// calls this action (the page renders the detail directly with no reason).
export async function viewUserDetailAction(input: {
  user_id: string;
  reason: string;
}): Promise<ActionResult<AdminUserDetail>> {
  const parsed = adminUserViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'קלט לא תקין' };
  }
  try {
    const user = await getUserDetail(parsed.data.user_id, parsed.data.reason);
    if (!user) {
      return { ok: false, error: 'המשתמש לא נמצא' };
    }
    return { ok: true, data: user };
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { ok: false, error: safeMessage(err, 'הצפייה נכשלה') };
  }
}

// Void (soft-reverse) a granted credit. The data layer re-checks ownership and
// blocks voiding a credit already consumed by a settled charge; append-only is
// preserved (the row is kept, only stamped voided).
export async function voidCreditAction(input: {
  credit_id: string;
  user_id: string;
  reason: string;
}): Promise<FormState> {
  const parsed = voidCreditSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await voidBillingCredit({
      creditId: parsed.data.credit_id,
      reason: parsed.data.reason,
      ownerId: parsed.data.user_id,
    });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'ביטול הזיכוי נכשל') };
  }
  revalidateUsers();
  return { notice: 'הזיכוי בוטל' };
}
