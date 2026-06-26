import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Company / legal details for embedding in the signed agreement. NOT secret —
// these are disclosed in the agreement itself (§14ג). Read server-side (the
// agreement is built/displayed in the owner's context, not admin). Admins edit
// them via /admin/company (getCompanySettings/updateCompanySettings).
export type CompanyLegal = {
  name: string;
  id: string;
  address: string;
  contactPhone: string;
  contactEmail: string;
  privacyUrl: string;
  termsUrl: string;
  warrantyText: string;
};

export async function getCompanyLegal(): Promise<CompanyLegal> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select(
      'company_legal_name, company_legal_id, company_legal_address, company_contact_phone, company_contact_email, privacy_url, terms_url, warranty_text',
    )
    .eq('id', true)
    .maybeSingle();
  if (error) throw new Error('טעינת פרטי החברה נכשלה');
  return {
    name: data?.company_legal_name ?? '',
    id: data?.company_legal_id ?? '',
    address: data?.company_legal_address ?? '',
    contactPhone: data?.company_contact_phone ?? '',
    contactEmail: data?.company_contact_email ?? '',
    privacyUrl: data?.privacy_url ?? '',
    termsUrl: data?.terms_url ?? '',
    warrantyText: data?.warranty_text ?? '',
  };
}
