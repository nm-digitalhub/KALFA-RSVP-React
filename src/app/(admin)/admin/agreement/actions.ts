'use server';

import { revalidatePath } from 'next/cache';

import {
  updateAgreement,
  approveAgreement,
  revertAgreementToTemplate,
} from '@/lib/data/admin/agreements';
import { agreementEditSchema, agreementApproveSchema } from '@/lib/validation/admin';
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
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await updateAgreement({
      version: parsed.data.version,
      bodyHtml: parsed.data.body_html ?? null,
    });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
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
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await approveAgreement(parsed.data.version);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'אישור החוזה נכשל') };
  }
  revalidatePath('/admin/agreement');
  return { notice: 'החוזה אושר — תג הטיוטה הוסר' };
}

export async function revertAgreementAction(
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await revertAgreementToTemplate();
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'שחזור התבנית נכשל') };
  }
  revalidatePath('/admin/agreement');
  return { notice: 'שוחזרה תבנית ברירת המחדל (כטיוטה)' };
}
