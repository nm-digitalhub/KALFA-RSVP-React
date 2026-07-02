'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { updateAppSettings } from '@/lib/data/admin/settings';
import { appSettingsSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

export async function updateSettingsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = appSettingsSchema.safeParse({
    // A checkbox is present ('on') only when checked; absent means off.
    payments_enabled: formData.get('payments_enabled') === 'on',
    sumit_company_id: formData.get('sumit_company_id') ?? '',
    sumit_api_public_key: formData.get('sumit_api_public_key') ?? '',
    sumit_api_key: formData.get('sumit_api_key') ?? '',
    sms_enabled: formData.get('sms_enabled') === 'on',
    extra_sms_sender: formData.get('extra_sms_sender') ?? '',
    extra_sms_token: formData.get('extra_sms_token') ?? '',
    email_enabled: formData.get('email_enabled') === 'on',
    smtp_host: formData.get('smtp_host') ?? '',
    smtp_port: formData.get('smtp_port') ?? '',
    smtp_secure: formData.get('smtp_secure') === 'on',
    smtp_user: formData.get('smtp_user') ?? '',
    smtp_password: formData.get('smtp_password') ?? '',
    smtp_from: formData.get('smtp_from') ?? '',
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateAppSettings(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון ההגדרות נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/settings');
  return { notice: 'ההגדרות נשמרו' };
}
