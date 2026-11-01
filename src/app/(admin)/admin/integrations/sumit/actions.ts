'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { zfd } from 'zod-form-data';

import { updateSumitCredentials } from '@/lib/data/admin/settings';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { sumitCredentialsSchema } from '@/lib/validation/admin';

// Thin by design: validate, hand off, revalidate. The gate lives in
// updateSumitCredentials (requirePlatformPermission('manage_settings')).
//
// Deliberately NOT here: payments_enabled and billing_exposure_gate. Those are
// the money switches and they stay in
// /admin/settings (plan D8). This page holds the CONNECTION; deciding whether to charge
// is a different question from being able to.
//
// An absent field reads as '' (as posted, never null), and the result carries
// only the notice: nothing typed here is sent back to the browser.
const sumitCredentialsForm = zfd.formData({
  sumit_company_id: sumitCredentialsSchema.shape.sumit_company_id.prefault(''),
  sumit_api_public_key: sumitCredentialsSchema.shape.sumit_api_public_key.prefault(''),
  sumit_api_key: sumitCredentialsSchema.shape.sumit_api_key.prefault(''),
});

export const updateSumitCredentialsAction = actionClient
  .inputSchema(sumitCredentialsForm)
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateSumitCredentials(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון פרטי SUMIT נכשל. נסו שוב.');
    }
    revalidatePath('/admin/integrations/sumit');
    revalidatePath('/admin/integrations');
    return { notice: 'פרטי SUMIT נשמרו' };
  });
