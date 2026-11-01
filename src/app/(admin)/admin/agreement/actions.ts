'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { zfd } from 'zod-form-data';

import { updateAgreement, approveAgreement } from '@/lib/data/admin/agreements';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { agreementEditSchema, agreementApproveSchema } from '@/lib/validation/admin';

// The data layer throws its Hebrew messages as Errors, and the action client passes those through. A rejection that
// is not an Error with a message keeps this action's own fallback text.
function failWith(err: unknown, fallback: string): never {
  unstable_rethrow(err);
  if (err instanceof Error && err.message) throw err;
  return returnUserError(fallback);
}

// The fields reach the schemas as posted (an empty version included), so the schemas' own Hebrew messages answer.
export const saveAgreementAction = actionClient
  .inputSchema(zfd.formData(agreementEditSchema))
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateAgreement({
        version: parsedInput.version,
        bodyHtml: parsedInput.body_html ?? null,
      });
    } catch (err) {
      failWith(err, 'שמירת החוזה נכשלה');
    }
    revalidatePath('/admin/agreement');
    return { notice: 'החוזה נשמר (כטיוטה — נדרש אישור מחדש)' };
  });

export const approveAgreementAction = actionClient
  .inputSchema(zfd.formData(agreementApproveSchema))
  .stateAction(async ({ parsedInput }) => {
    try {
      await approveAgreement(parsedInput.version);
    } catch (err) {
      failWith(err, 'אישור החוזה נכשל');
    }
    revalidatePath('/admin/agreement');
    return { notice: 'החוזה אושר — תג הטיוטה הוסר' };
  });
