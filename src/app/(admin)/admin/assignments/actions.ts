'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { refresh, revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createStaffAssignment,
  findAccountByEmail,
  voidStaffAssignment,
  type ConfirmedOption,
} from '@/lib/data/admin/coupon-assignments';
import type { FormState } from '@/lib/validation/result';
import { detailSearch } from './list-params';
import { VOID_REFUSALS, VOID_REFUSED_NOTICE_PREFIX } from './void-refusals';

// The staff assignment actions (task 7.3). Thin wrappers: validate, call the gated data layer,
// surface its own safe Hebrew messages. The browser sends an email and an offer id — never a
// price, a value or a package; everything money-shaped is computed and frozen server-side.

const confirmedTermsSchema = z
  .array(
    z.object({
      packageId: z.uuid(),
      listPrice: z.number().finite().nonnegative(),
      discountAmount: z.number().finite().nonnegative(),
      finalPrice: z.number().finite().positive(),
    }),
  )
  .min(1)
  .max(50);

const assignSchema = z.object({
  email: z.string().trim().min(1, { error: 'נא להזין אימייל' }).max(320).pipe(z.email({ error: 'כתובת אימייל לא תקינה' })),
  offer_id: z.uuid({ error: 'נא לבחור הצעה' }),
  idempotency_key: z.string().min(1).max(120),
  // The preview the staff member CONFIRMED — compared server-side, never trusted as prices.
  confirmed_terms: z
    .string()
    .min(2)
    .transform((raw, ctx) => {
      try {
        return confirmedTermsSchema.parse(JSON.parse(raw)) as ConfirmedOption[];
      } catch {
        ctx.addIssue({ code: 'custom', message: 'נא לבחור הצעה ולאשר את התצוגה' });
        return z.NEVER;
      }
    }),
});

export async function createAssignmentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = assignSchema.safeParse({
    email: formData.get('email'),
    offer_id: formData.get('offer_id'),
    idempotency_key: formData.get('idempotency_key'),
    confirmed_terms: formData.get('confirmed_terms'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'נא לבדוק את הטופס' };
  }

  let target: string;
  try {
    // The account is re-resolved and re-validated on the server at confirm time (spec §8).
    const account = await findAccountByEmail(parsed.data.email);
    if (!account) {
      return { error: 'לא נמצא חשבון עם האימייל הזה. ההטבה ניתנת לחשבון קיים בלבד.' };
    }
    const result = await createStaffAssignment({
      userId: account.id,
      offerId: parsed.data.offer_id,
      idempotencyKey: parsed.data.idempotency_key,
      confirmedOptions: parsed.data.confirmed_terms,
    });
    // Navigate to the assignment the flow should SHOW (the kept one on a duplicate),
    // with an honest notice — never a celebration for a row that is not usable.
    const notice =
      result.outcome === 'existing'
        ? 'existing'
        : result.duplicateVoided === 'new'
          ? 'duplicate_kept'
          : 'created';
    target = `/admin/assignments/${result.keptAssignmentId}?notice=${notice}`;
  } catch (err) {
    unstable_rethrow(err);
    // The offer or its prices may have moved since the page loaded: refresh the router in this same
    // round trip so the preview shows the CURRENT terms the next confirmation will send (spec §8).
    refresh();
    return { error: err instanceof Error ? err.message : 'הקצאת ההטבה נכשלה. נסו שוב.' };
  }

  revalidatePath('/admin/assignments');
  redirect(target);
}

const voidSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: 'נדרשת סיבת ביטול' })
    .max(500, { error: 'סיבת הביטול ארוכה מדי (עד 500 תווים)' }),
});

export async function voidAssignmentAction(
  assignmentId: string,
  listSearch: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  void _prevState;
  const parsed = voidSchema.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'נדרשת סיבת ביטול' };
  }
  let refusal: string | null = null;
  try {
    const result = await voidStaffAssignment(assignmentId, parsed.data.reason);
    if (result.outcome === 'refused') {
      if (!Object.hasOwn(VOID_REFUSALS, result.reason)) {
        refresh();
        return { error: 'הביטול נדחה. המצב השתנה — רעננו את העמוד.' };
      }
      refusal = result.reason;
    }
  } catch (err) {
    unstable_rethrow(err);
    refresh(); // the assignment may have changed under the open dialog — re-read the details
    return { error: err instanceof Error ? err.message : 'ביטול ההטבה נכשל. נסו שוב.' };
  }

  // Both outcomes are answered on the detail page, which re-reads the live state (spec §9):
  // the dialog may no longer exist there, and the list filters it was opened from are kept.
  revalidatePath(`/admin/assignments/${assignmentId}`);
  if (refusal) {
    redirect(
      `/admin/assignments/${assignmentId}${detailSearch(listSearch, `${VOID_REFUSED_NOTICE_PREFIX}${refusal}`)}`,
    );
  }
  revalidatePath('/admin/assignments');
  redirect(`/admin/assignments/${assignmentId}${detailSearch(listSearch, 'voided')}`);
}
