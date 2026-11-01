'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { refresh, revalidatePath } from 'next/cache';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import {
  createStaffAssignment,
  findAccountByEmail,
  voidStaffAssignment,
  type ConfirmedOption,
} from '@/lib/data/admin/coupon-assignments';
import { actionClient, returnUserError } from '@/lib/safe-action';
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

// Read from the form as it is (an empty field stays '', not undefined), so an empty email still
// answers with the schema's Hebrew message.
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

export const createAssignmentAction = actionClient
  .inputSchema(zfd.formData(assignSchema))
  .stateAction(async ({ parsedInput }) => {
    let target: string | undefined;
    try {
      // The account is re-resolved and re-validated on the server at confirm time (spec §8).
      const account = await findAccountByEmail(parsedInput.email);
      if (account) {
        const result = await createStaffAssignment({
          userId: account.id,
          offerId: parsedInput.offer_id,
          idempotencyKey: parsedInput.idempotency_key,
          confirmedOptions: parsedInput.confirmed_terms,
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
      }
    } catch (err) {
      unstable_rethrow(err);
      // The offer or its prices may have moved since the page loaded: refresh the router in this same
      // round trip so the preview shows the CURRENT terms the next confirmation will send (spec §8).
      refresh();
      throw err;
    }
    // No account under that email: nothing on the server moved, so no refresh.
    if (!target) returnUserError('לא נמצא חשבון עם האימייל הזה. ההטבה ניתנת לחשבון קיים בלבד.');

    revalidatePath('/admin/assignments');
    redirect(target);
  });

const voidSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: 'נדרשת סיבת ביטול' })
    .max(500, { error: 'סיבת הביטול ארוכה מדי (עד 500 תווים)' }),
});

// Bound: the assignment id, and the list's query string ('' when the list had no filters).
export const voidAssignmentAction = actionClient
  .inputSchema(zfd.formData(voidSchema))
  .bindArgsSchemas([z.uuid(), z.string()])
  .stateAction(async ({ parsedInput: { reason }, bindArgsParsedInputs: [assignmentId, listSearch] }) => {
    let result: Awaited<ReturnType<typeof voidStaffAssignment>>;
    try {
      result = await voidStaffAssignment(assignmentId, reason);
    } catch (err) {
      unstable_rethrow(err);
      refresh(); // the assignment may have changed under the open dialog — re-read the details
      throw err;
    }
    let refusal: string | null = null;
    if (result.outcome === 'refused') {
      if (!Object.hasOwn(VOID_REFUSALS, result.reason)) {
        refresh();
        returnUserError('הביטול נדחה. המצב השתנה — רעננו את העמוד.');
      }
      refusal = result.reason;
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
  });
