import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  DEFAULT_AGREEMENT_DOC,
  isPackageAgreementVersion,
  missingPackageTokens,
  type AgreementDoc,
} from '@/lib/agreements/template';

// The ACTIVE pay-per-result agreement document (version + status + optional custom body),
// read via the service-role client. Falls back to the vetted in-code default
// when no active row exists (e.g. pre-migration). The body is not secret — it
// is the contract shown to the customer through the server render path — so a
// service-role read here (behind server-only) is appropriate; customers never
// query the admin-only table directly.
//
// The fixed-price package has its OWN contract (getApprovedPackageAgreementDoc): this reader never returns it.
export async function getActiveAgreementDoc(): Promise<AgreementDoc> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('agreement_documents')
    .select('version, body_html, status')
    .eq('model', 'per_result')
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

// The package contract a customer may be offered, or null. There is NO fallback: the package contract has no in-code
// text, and a pay-per-result contract must never stand in for it. It is offered only when the admin has APPROVED it, it
// has a body, it carries the package version, and that body states the price and the quota. A draft is never offered.
export async function getApprovedPackageAgreementDoc(): Promise<AgreementDoc | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('agreement_documents')
    .select('version, body_html, status')
    .eq('model', 'package')
    .maybeSingle();
  if (!data || data.status !== 'approved') return null;
  const body = data.body_html;
  if (body == null || body.trim() === '') return null;
  if (!isPackageAgreementVersion(data.version)) return null;
  if (missingPackageTokens(body).length > 0) return null;
  return { version: data.version, status: data.status, bodyHtml: body };
}
