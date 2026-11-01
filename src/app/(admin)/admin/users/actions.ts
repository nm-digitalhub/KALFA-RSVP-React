'use server';

import { revalidatePath } from 'next/cache';
import { zfd } from 'zod-form-data';

import {
  setUserSuspended,
  grantBillingCredit,
  voidBillingCredit,
  getUserDetail,
} from '@/lib/data/admin/users';
import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  adminUserIdSchema,
  adminUserViewSchema,
  grantCreditSchema,
  voidCreditSchema,
} from '@/lib/validation/admin';

// The admin data layer only throws Error with our own safe Hebrew messages
// (last-staff / no-self-lockout / not-found / generic) — never raw DB detail —
// and the action client passes those through to the admin unchanged.

// Revalidate the whole /admin/users subtree (list + the open detail page).
function revalidateUsers(): void {
  revalidatePath('/admin/users', 'layout');
}

export const suspendUserAction = actionClient
  .inputSchema(zfd.formData(adminUserIdSchema))
  .stateAction(async ({ parsedInput: { user_id } }) => {
    await setUserSuspended(user_id, true);
    revalidateUsers();
    return { notice: 'המשתמש הושהה' };
  });

export const reactivateUserAction = actionClient
  .inputSchema(zfd.formData(adminUserIdSchema))
  .stateAction(async ({ parsedInput: { user_id } }) => {
    await setUserSuspended(user_id, false);
    revalidateUsers();
    return { notice: 'המשתמש שוחזר' };
  });

// The fields reach the schema as posted: an empty campaign_id is the event-level
// credit, an empty amount or reason gets the schema's own message.
export const grantCreditAction = actionClient
  .inputSchema(zfd.formData(grantCreditSchema))
  .stateAction(async ({ parsedInput }) => {
    await grantBillingCredit({
      eventId: parsedInput.event_id,
      campaignId: parsedInput.campaign_id || null,
      amount: parsedInput.amount,
      reason: parsedInput.reason,
      ownerId: parsedInput.user_id,
    });
    revalidateUsers();
    return { notice: 'ההטבה ניתנה' };
  });

// Break-glass view of ANOTHER user's full detail. The reason is validated here
// and re-enforced by getUserDetail, which writes the audit row (subject_type
// 'user') BEFORE returning any PII — fail-closed. The self-view path never
// calls this action (the page renders the detail directly with no reason).
export const viewUserDetailAction = actionClient
  .inputSchema(adminUserViewSchema)
  .action(async ({ parsedInput: { user_id, reason } }) => {
    const user = await getUserDetail(user_id, reason);
    if (!user) {
      return returnUserError('המשתמש לא נמצא');
    }
    return user;
  });

// Void (soft-reverse) a granted credit. The data layer re-checks ownership and
// blocks voiding a credit already consumed by a settled charge; append-only is
// preserved (the row is kept, only stamped voided).
export const voidCreditAction = actionClient
  .inputSchema(voidCreditSchema)
  .action(async ({ parsedInput }) => {
    await voidBillingCredit({
      creditId: parsedInput.credit_id,
      reason: parsedInput.reason,
      ownerId: parsedInput.user_id,
    });
    revalidateUsers();
    return { notice: 'הזיכוי בוטל' };
  });
