import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_AGREEMENT_DOC, type AgreementDoc } from '@/lib/agreements/template';

// The ACTIVE agreement document (version + status + optional custom body),
// read via the service-role client. Falls back to the vetted in-code default
// when no active row exists (e.g. pre-migration). The body is not secret — it
// is the contract shown to the customer through the server render path — so a
// service-role read here (behind server-only) is appropriate; customers never
// query the admin-only table directly.
export async function getActiveAgreementDoc(): Promise<AgreementDoc> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('agreement_documents')
    .select('version, body_html, status')
    .eq('is_active', true)
    .maybeSingle();
  if (!data) {
    return DEFAULT_AGREEMENT_DOC;
  }
  return {
    version: data.version,
    status: data.status,
    bodyHtml: data.body_html,
  };
}
