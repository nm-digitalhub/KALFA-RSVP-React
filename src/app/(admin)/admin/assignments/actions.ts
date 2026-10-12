'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createStaffAssignment,
  findAccountByEmail,
  voidStaffAssignment,
} from '@/lib/data/admin/coupon-assignments';
import type { FormState } from '@/lib/validation/result';

// The staff assignment actions (task 7.3). Thin wrappers: validate, call the gated data layer,
// surface its own safe Hebrew messages. The browser sends an email and an offer id — never a
// price, a value or a package; everything money-shaped is computed and frozen server-side.

const assignSchema = z.object({
  email: z.string().trim().min(1, { error: 'נא להזין אימייל' }).max(320),
  offer_id: z.uuid({ error: 'נא לבחור הצעה' }),
  idempotency_key: z.string().min(1).max(120),
});

export async function createAssignmentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = assignSchema.safeParse({
    email: formData.get('email'),
    offer_id: formData.get('offer_id'),
    idempotency_key: formData.get('idempotency_key'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'נא לבדוק את הטופס' };
  }

  try {
    const account = await findAccountByEmail(parsed.data.email);
    if (!account) {
      return { error: 'לא נמצא חשבון עם האימייל הזה. ההטבה ניתנת לחשבון קיים בלבד.' };
    }
    await createStaffAssignment({
      userId: account.id,
      offerId: parsed.data.offer_id,
      idempotencyKey: parsed.data.idempotency_key,
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'הקצאת ההטבה נכשלה. נסו שוב.' };
  }

  revalidatePath('/admin/assignments');
  redirect('/admin/assignments');
}

const VOID_REFUSALS: Record<string, string> = {
  held_by_payment: 'ההטבה מוחזקת על ידי תשלום פתוח — לא ניתן לבטל עד שהתשלום יוכרע.',
  held_by_approved_terms: 'ההטבה קשורה לתנאים מאושרים — היא משולמת בתוקפה או פגה (אין ביטול).',
  already_ended: 'ההטבה כבר הסתיימה — אין מה לבטל.',
};

export async function voidAssignmentAction(
  assignmentId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _prevState;
  void _formData;
  try {
    const result = await voidStaffAssignment(assignmentId);
    if (result.outcome === 'refused') {
      return { error: VOID_REFUSALS[result.reason] ?? 'הביטול נדחה.' };
    }
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'ביטול ההטבה נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/assignments');
  return { notice: 'ההטבה בוטלה' };
}
