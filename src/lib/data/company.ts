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

// "033301505" / "03-330-1505" / "+972 3 3301505" → "+97233301505" for
// machine-readable surfaces (schema.org telephone). Anything that doesn't look
// like an Israeli number resolves to '' so callers omit the field instead of
// publishing a malformed value.
export function toE164Israel(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith('0') && digits.length >= 9) return `+972${digits.slice(1)}`;
  return '';
}

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
