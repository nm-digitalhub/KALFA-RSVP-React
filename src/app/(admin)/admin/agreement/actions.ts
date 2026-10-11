'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { updateAgreement, approveAgreement } from '@/lib/data/admin/agreements';
import { agreementEditSchema, agreementApproveSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

function safeMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export async function saveAgreementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = agreementEditSchema.safeParse({
    version: formData.get('version'),
    body_html: formData.get('body_html'),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  try {
    await updateAgreement({
      version: parsed.data.version,
      bodyHtml: parsed.data.body_html ?? null,
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'שמירת החוזה נכשלה') };
  }
  revalidatePath('/admin/agreement');
  return { notice: 'החוזה נשמר (כטיוטה — נדרש אישור מחדש)' };
}

export async function approveAgreementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = agreementApproveSchema.safeParse({
    version: formData.get('version'),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  try {
    await approveAgreement(parsed.data.version);
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'אישור החוזה נכשל') };
  }
  revalidatePath('/admin/agreement');
  return { notice: 'החוזה אושר — תג הטיוטה הוסר' };
}
