import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getActiveAgreementDoc } from '@/lib/data/agreements-doc';
import type { AgreementDoc } from '@/lib/agreements/template';

// Admin management of the active agreement (contract) document. All behind
// requireAdmin + service-role; every change is audited. Editing the contract
// returns it to DRAFT (so a changed contract must be re-approved before its
// draft marker disappears).

export interface AdminAgreement extends AgreementDoc {
  approvedAt: string | null;
}

export async function getAgreementForAdmin(): Promise<AdminAgreement> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from('agreement_documents')
    .select('version, body_html, status, approved_at')
    .eq('is_active', true)
    .maybeSingle();
  if (!data) {
    const fallback = await getActiveAgreementDoc();
    return { ...fallback, approvedAt: null };
  }
  return {
    version: data.version,
    status: data.status,
    bodyHtml: data.body_html,
    approvedAt: data.approved_at,
  };
}

// Save edits. Any change re-opens the document as a DRAFT (approval is required
// again). bodyHtml null → revert to the vetted in-code default template.
export async function updateAgreement(input: {
  version: string;
  bodyHtml: string | null;
}): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  const body = input.bodyHtml && input.bodyHtml.trim() !== '' ? input.bodyHtml : null;
  const { error } = await admin
    .from('agreement_documents')
    .update({
      version: input.version,
      body_html: body,
      status: 'draft',
      approved_by: null,
      approved_at: null,
    })
    .eq('is_active', true);
  if (error) throw new Error('שמירת החוזה נכשלה');
  await logActivity({
    action: 'admin.agreement.updated',
    meta: { version: input.version, customBody: body != null },
  });
}

// Approve the active document: status → approved (the renderer drops the draft
// marker) and the (possibly renamed, draft-free) version is recorded.
export async function approveAgreement(version: string): Promise<void> {
  const actor = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from('agreement_documents')
    .update({
      status: 'approved',
      version,
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
    })
    .eq('is_active', true);
  if (error) throw new Error('אישור החוזה נכשל');
  await logActivity({ action: 'admin.agreement.approved', meta: { version } });
}

// Discard a custom body and return to the vetted in-code default (as a draft).
export async function revertAgreementToTemplate(): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from('agreement_documents')
    .update({ body_html: null, status: 'draft', approved_by: null, approved_at: null })
    .eq('is_active', true);
  if (error) throw new Error('שחזור התבנית נכשל');
  await logActivity({ action: 'admin.agreement.reverted', meta: {} });
}
