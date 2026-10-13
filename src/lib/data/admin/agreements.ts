import 'server-only';

import { findAgreementPdfCompatibilityIssues } from '@/lib/agreements/pdf-html';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import {
  PACKAGE_AGREEMENT_VERSION,
  findUnknownTokens,
  isPackageAgreementVersion,
  missingPackageTokens,
  type AgreementDoc,
} from '@/lib/agreements/template';

// Admin management of the package contract document. All behind requirePlatformPermission + service-role; every change
// is audited. Editing the contract returns it to DRAFT, so a changed contract must be re-approved before its draft
// marker disappears, and a draft is never offered to a customer.
//
// The contract has NO in-code text, so its body is required. agreement_documents also holds the earlier pay-per-result
// row (model 'per_result'); it is history and nothing here reads or writes it.

export interface AdminAgreement extends AgreementDoc {
  approvedAt: string | null;
}

// The row every operation acts on.
const PACKAGE_ROW = { model: 'package' } as const;

const hasBody = (bodyHtml: string | null | undefined): bodyHtml is string =>
  bodyHtml != null && bodyHtml.trim() !== '';

// The shape rules, checked before the database's own constraint so the admin gets a clear message.
function assertShape(version: string, bodyHtml: string | null) {
  if (!isPackageAgreementVersion(version)) {
    throw new Error(`גרסת חוזה החבילה חייבת להיות ${PACKAGE_AGREEMENT_VERSION} (או draft-${PACKAGE_AGREEMENT_VERSION})`);
  }
  if (!hasBody(bodyHtml)) {
    throw new Error('נוסח חוזה החבילה חייב להיות מלא — אין לו נוסח ברירת מחדל בקוד');
  }
}

export async function getAgreementForAdmin(): Promise<AdminAgreement> {
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { data } = await admin
    .from('agreement_documents')
    .select('version, body_html, status, approved_at')
    .match(PACKAGE_ROW)
    .maybeSingle();
  if (!data) {
    // No package document yet: show an empty draft.
    return { version: `draft-${PACKAGE_AGREEMENT_VERSION}`, status: 'draft', bodyHtml: '', approvedAt: null };
  }
  return {
    version: data.version,
    status: data.status,
    bodyHtml: data.body_html,
    approvedAt: data.approved_at,
  };
}

// Save edits. Any change re-opens the document as a DRAFT (approval is required again).
export async function updateAgreement(input: { version: string; bodyHtml: string | null }): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const body = hasBody(input.bodyHtml) ? input.bodyHtml : null;
  assertShape(input.version, body);
  const admin = createAdminClient();
  const { error } = await admin
    .from('agreement_documents')
    .update({
      version: input.version,
      body_html: body,
      status: 'draft',
      approved_by: null,
      approved_at: null,
    })
    .match(PACKAGE_ROW);
  if (error) throw new Error('שמירת החוזה נכשלה');
  await logActivity({
    action: 'admin.agreement.updated',
    meta: { model: PACKAGE_ROW.model, version: input.version },
  });
}

// Approve the document: status → approved (the renderer drops the draft marker) and the (possibly renamed, draft-free)
// version is recorded. The body is read back and checked, so the contract is never approved with a token that would
// reach the customer as literal {{braces}}, nor without stating its price and quota.
export async function approveAgreement(version: string): Promise<void> {
  const actor = await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { data: current } = await admin
    .from('agreement_documents')
    .select('body_html')
    .match(PACKAGE_ROW)
    .maybeSingle();
  const body = current?.body_html ?? null;
  assertShape(version, body);
  const configKeys = Object.keys(await getAgreementConfigTokens());
  const unknown = findUnknownTokens(body ?? '', configKeys);
  if (unknown.length > 0) {
    throw new Error(`בנוסח יש תחליפים שאינם מוכרים: ${unknown.map((t) => `{{${t}}}`).join(' ')}`);
  }
  const missing = missingPackageTokens(body ?? '');
  if (missing.length > 0) {
    throw new Error(`נוסח חוזה החבילה חייב לכלול את התחליפים: ${missing.map((t) => `{{${t}}}`).join(' ')}`);
  }
  const pdfIssues = findAgreementPdfCompatibilityIssues(body ?? '');
  if (pdfIssues.length > 0) {
    throw new Error(`לא ניתן לאשר את החוזה משום שחלק מהנוסח אינו ניתן לייצוג ב-PDF: ${pdfIssues.join('; ')}`);
  }
  const { error } = await admin
    .from('agreement_documents')
    .update({
      status: 'approved',
      version,
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
    })
    .match(PACKAGE_ROW);
  if (error) throw new Error('אישור החוזה נכשל');
  await logActivity({ action: 'admin.agreement.approved', meta: { model: PACKAGE_ROW.model, version } });
}
