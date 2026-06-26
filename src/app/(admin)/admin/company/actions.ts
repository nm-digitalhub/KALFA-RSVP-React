'use server';

import { revalidatePath } from 'next/cache';

import { updateCompanySettings } from '@/lib/data/admin/settings';
import { companySettingsSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

function isNextControlFlow(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    ((err as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
      (err as { digest: string }).digest === 'NEXT_NOT_FOUND')
  );
}

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
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateCompanySettings(parsed.data);
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'עדכון פרטי החברה נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/company');
  return { notice: 'פרטי החברה נשמרו' };
}
