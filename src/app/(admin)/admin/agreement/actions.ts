'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import {
  getAgreementStarterBody,
  updateAgreement,
  approveAgreement,
  revertAgreementToTemplate,
} from '@/lib/data/admin/agreements';
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
    model: formData.get('model') ?? undefined,
    version: formData.get('version'),
    body_html: formData.get('body_html'),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  try {
    await updateAgreement({
      model: parsed.data.model,
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
    model: formData.get('model') ?? undefined,
    version: formData.get('version'),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  try {
    await approveAgreement(parsed.data.version, parsed.data.model);
  } catch (err) {
    unstable_rethrow(err);
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
    unstable_rethrow(err);
    return { error: safeMessage(err, 'שחזור התבנית נכשל') };
  }
  revalidatePath('/admin/agreement');
  return { notice: 'שוחזרה תבנית ברירת המחדל (כטיוטה)' };
}

// The live pay-per-result text as an editable template ({{tokens}}), so the admin can start a custom body from what
// customers see today instead of a blank page. Read-only: nothing is saved until the admin saves the form.
export async function loadAgreementStarterAction(): Promise<{ body: string } | { error: string }> {
  try {
    return { body: await getAgreementStarterBody() };
  } catch (err) {
    unstable_rethrow(err);
    return { error: safeMessage(err, 'טעינת הנוסח הנוכחי נכשלה') };
  }
}
