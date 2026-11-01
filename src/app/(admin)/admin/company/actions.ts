'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { zfd } from 'zod-form-data';

import { updateCompanySettings } from '@/lib/data/admin/settings';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { companySettingsSchema } from '@/lib/validation/admin';

// Every field is a free string, blank allowed: a field missing from the form counts as blank ('').
const company = companySettingsSchema.shape;

export const updateCompanyAction = actionClient
  .inputSchema(
    zfd.formData({
      company_legal_name: company.company_legal_name.prefault(''),
      company_legal_id: company.company_legal_id.prefault(''),
      company_legal_address: company.company_legal_address.prefault(''),
      company_contact_phone: company.company_contact_phone.prefault(''),
      company_contact_email: company.company_contact_email.prefault(''),
      privacy_url: company.privacy_url.prefault(''),
      terms_url: company.terms_url.prefault(''),
      warranty_text: company.warranty_text.prefault(''),
      company_instagram_url: company.company_instagram_url.prefault(''),
    }),
  )
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateCompanySettings(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון פרטי החברה נכשל. נסו שוב.');
    }

    revalidatePath('/admin/company');
    return { notice: 'פרטי החברה נשמרו' };
  });
