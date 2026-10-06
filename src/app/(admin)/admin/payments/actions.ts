'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import {
  PaymentReviewError,
  probePaymentReview,
  resolvePaymentReview,
  resolvePaymentReviewSchema,
  type PaymentReviewProbe,
} from '@/lib/data/admin/payment-review';
import type { FormState } from '@/lib/validation/result';

// Server Actions for /admin/payments — payment operations waiting for a person (see payment-review.ts). The data layer
// owns the permission check, the audit row and the compare-and-set; these only turn a form into typed input and an
// outcome into a message. A message is shown as written ONLY when the data layer marked it safe (PaymentReviewError);
// anything else is a generic line, so a database or provider detail never reaches the screen.

export type ProbeState = { error?: string; probe?: PaymentReviewProbe } | null;

export async function probePaymentReviewAction(_prev: ProbeState, formData: FormData): Promise<ProbeState> {
  const id = z.uuid().safeParse(formData.get('operationId'));
  if (!id.success) return { error: 'מזהה הפעולה אינו תקין.' };
  try {
    return { probe: await probePaymentReview(id.data) };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof PaymentReviewError ? err.message : 'הבדיקה נכשלה. נסו שוב.' };
  }
}

// '' and whitespace mean "not given" (optional field); text that is not a number becomes NaN so the schema rejects it
// with its own message instead of it being silently dropped.
function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return undefined;
  return Number(text);
}

export async function resolvePaymentReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const documentNumber = optionalNumber(formData.get('documentNumber'));
  const amount = optionalNumber(formData.get('amount'));
  const parsed = resolvePaymentReviewSchema.safeParse({
    operationId: formData.get('operationId'),
    outcome: formData.get('outcome'),
    ...(documentNumber !== undefined ? { documentNumber } : {}),
    ...(amount !== undefined ? { amount } : {}),
    note: formData.get('note'),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  try {
    await resolvePaymentReview(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof PaymentReviewError ? err.message : 'ההכרעה נכשלה. נסו שוב.' };
  }

  revalidatePath('/admin/payments');
  return {
    notice:
      parsed.data.outcome === 'succeeded'
        ? 'הגבייה אושרה והפעולה נסגרה.'
        : 'הפעולה סומנה ככושלת ונסגרה.',
  };
}
