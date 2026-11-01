'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import {
  PaymentReviewError,
  probePaymentReview,
  resolvePaymentReview,
  resolvePaymentReviewSchema,
} from '@/lib/data/admin/payment-review';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Server Actions for /admin/payments — payment operations waiting for a person (see payment-review.ts). The data layer
// owns the permission check, the audit row and the compare-and-set; these only turn a form into typed input and an
// outcome into a message. A message is shown as written ONLY when the data layer marked it safe (PaymentReviewError);
// anything else is a generic line, so a database or provider detail never reaches the screen.

export const probePaymentReviewAction = actionClient
  .inputSchema(zfd.formData({ operationId: z.uuid({ error: 'מזהה הפעולה אינו תקין.' }) }))
  .stateAction(async ({ parsedInput: { operationId } }) => {
    try {
      return { probe: await probePaymentReview(operationId) };
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(err instanceof PaymentReviewError ? err.message : 'הבדיקה נכשלה. נסו שוב.');
    }
  });

// '' and whitespace mean "not given" (optional field); text that is not a number becomes NaN so the schema rejects it
// with its own message instead of it being silently dropped.
function optionalNumber(value: unknown): number | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return undefined;
  return Number(text);
}

// The form, turned into the shape resolvePaymentReviewSchema reads: a number not given is left out entirely.
const asSent = z.unknown().optional();
const resolveForm = zfd.formData(
  z
    .object({ operationId: asSent, outcome: asSent, documentNumber: asSent, amount: asSent, note: asSent })
    .transform((form) => {
      const documentNumber = optionalNumber(form.documentNumber);
      const amount = optionalNumber(form.amount);
      return {
        operationId: form.operationId,
        outcome: form.outcome,
        ...(documentNumber !== undefined ? { documentNumber } : {}),
        ...(amount !== undefined ? { amount } : {}),
        note: form.note,
      };
    })
    .pipe(resolvePaymentReviewSchema),
);

export const resolvePaymentReviewAction = actionClient
  .inputSchema(resolveForm)
  .stateAction(async ({ parsedInput }) => {
    try {
      await resolvePaymentReview(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(err instanceof PaymentReviewError ? err.message : 'ההכרעה נכשלה. נסו שוב.');
    }

    revalidatePath('/admin/payments');
    return {
      notice:
        parsedInput.outcome === 'succeeded'
          ? 'הגבייה אושרה והפעולה נסגרה.'
          : 'הפעולה סומנה ככושלת ונסגרה.',
    };
  });
