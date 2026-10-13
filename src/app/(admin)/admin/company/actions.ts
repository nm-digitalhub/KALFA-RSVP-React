'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { updateCompanySettings } from '@/lib/data/admin/settings';
import { companySettingsSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

export async function updateCompanyAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = companySettingsSchema.safeParse({
    company_legal_name: formData.get('company_legal_name') ?? '',
    company_legal_id: formData.get('company_legal_id') ?? '',
    company_legal_address: formData.get('company_legal_address') ?? '',
    company_contact_phone: formData.get('company_contact_phone') ?? '',
    company_contact_email: formData.get('company_contact_email') ?? '',
    privacy_url: formData.get('privacy_url') ?? '',
    terms_url: formData.get('terms_url') ?? '',
    warranty_text: formData.get('warranty_text') ?? '',
    company_instagram_url: formData.get('company_instagram_url') ?? '',
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    await updateCompanySettings(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון פרטי החברה נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/company');
  return { notice: 'פרטי החברה נשמרו' };
}
