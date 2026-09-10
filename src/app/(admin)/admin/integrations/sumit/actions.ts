'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { updateSumitCredentials } from '@/lib/data/admin/settings';
import { sumitCredentialsSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Thin by design: validate, hand off, revalidate. The gate lives in
// updateSumitCredentials (requirePlatformPermission('manage_settings')).
//
// Deliberately NOT here: payments_enabled, close_charge_enabled, campaign_holds_enabled
// and billing_exposure_gate. Those are the money switches and they stay in
// /admin/settings (plan D8). This page holds the CONNECTION; deciding whether to charge
// is a different question from being able to.
export async function updateSumitCredentialsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = sumitCredentialsSchema.safeParse({
    sumit_company_id: formData.get('sumit_company_id') ?? '',
    sumit_api_public_key: formData.get('sumit_api_public_key') ?? '',
    sumit_api_key: formData.get('sumit_api_key') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await updateSumitCredentials(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון פרטי SUMIT נכשל. נסו שוב.' };
  }
  revalidatePath('/admin/integrations/sumit');
  revalidatePath('/admin/integrations');
  return { notice: 'פרטי SUMIT נשמרו' };
}
