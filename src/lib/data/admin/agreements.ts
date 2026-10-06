import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { getActiveAgreementDoc } from '@/lib/data/agreements-doc';
import {
  PACKAGE_AGREEMENT_VERSION,
  defaultBodyAsTemplate,
  findUnknownTokens,
  isPackageAgreementVersion,
  missingPackageTokens,
  perResultTokensIn,
  type AgreementDoc,
  type AgreementModel,
} from '@/lib/agreements/template';

// Admin management of the agreement (contract) documents — one per pricing model. All behind
// requirePlatformPermission + service-role; every change is audited. Editing a contract
// returns it to DRAFT (so a changed contract must be re-approved before its
// draft marker disappears, and a draft package contract is never offered to a customer).
//
// 'per_result' is the single ACTIVE pay-per-result document. 'package' is the single package document: it has NO in-code
// text, so its body is required, and is_active has no meaning for it (it is offered only while approved).

export interface AdminAgreement extends AgreementDoc {
  model: AgreementModel;
  approvedAt: string | null;
}

// Which row a model's operations act on.
function rowOf(model: AgreementModel): { model: AgreementModel; is_active?: boolean } {
  return model === 'package' ? { model } : { model, is_active: true };
}

const hasBody = (bodyHtml: string | null | undefined): bodyHtml is string =>
  bodyHtml != null && bodyHtml.trim() !== '';

// The shape rules of each model, checked before the database's own constraint so the admin gets a clear message.
function assertShape(model: AgreementModel, version: string, bodyHtml: string | null) {
  if (model === 'package') {
    if (!isPackageAgreementVersion(version)) {
      throw new Error(`גרסת חוזה החבילה חייבת להיות ${PACKAGE_AGREEMENT_VERSION} (או draft-${PACKAGE_AGREEMENT_VERSION})`);
    }
    if (!hasBody(bodyHtml)) {
      throw new Error('נוסח חוזה החבילה חייב להיות מלא — אין לו נוסח ברירת מחדל בקוד');
    }
  } else if (isPackageAgreementVersion(version)) {
    throw new Error('גרסה זו שמורה לחוזה החבילה');
  }
}

export async function getAgreementForAdmin(model: AgreementModel = 'per_result'): Promise<AdminAgreement> {
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { data } = await admin
    .from('agreement_documents')
    .select('version, body_html, status, approved_at')
    .match(rowOf(model))
    .maybeSingle();
  if (!data) {
    if (model === 'package') {
      // Before the migration is applied there is no package document: show an empty draft, never another model's text.
      return { model, version: `draft-${PACKAGE_AGREEMENT_VERSION}`, status: 'draft', bodyHtml: '', approvedAt: null };
    }
    const fallback = await getActiveAgreementDoc();
    return { ...fallback, model, approvedAt: null };
  }
  return {
    model,
    version: data.version,
    status: data.status,
    bodyHtml: data.body_html,
    approvedAt: data.approved_at,
  };
}

// The live default of the pay-per-result contract, written back as a template ({{tokens}}) — what the editor loads when
// the admin asks to edit the current text instead of starting from a blank body.
export async function getAgreementStarterBody(): Promise<string> {
  await requirePlatformPermission('manage_settings');
  const doc = await getActiveAgreementDoc();
  return defaultBodyAsTemplate(doc.version);
}

// Save edits. Any change re-opens the document as a DRAFT (approval is required
// again). For the pay-per-result model bodyHtml null → the vetted in-code default template;
// the package model has no default, so its body is required.
export async function updateAgreement(input: {
  model?: AgreementModel;
  version: string;
  bodyHtml: string | null;
}): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const model = input.model ?? 'per_result';
  const body = hasBody(input.bodyHtml) ? input.bodyHtml : null;
  assertShape(model, input.version, body);
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
    .match(rowOf(model));
  if (error) throw new Error('שמירת החוזה נכשלה');
  await logActivity({
    action: 'admin.agreement.updated',
    meta: { model, version: input.version, customBody: body != null },
  });
}

// Approve the document: status → approved (the renderer drops the draft
// marker) and the (possibly renamed, draft-free) version is recorded. The body is read back and checked, so a contract
// is never approved with a token that would reach the customer as literal {{braces}}, nor a package contract that does
// not state its price and quota.
export async function approveAgreement(version: string, model: AgreementModel = 'per_result'): Promise<void> {
  const actor = await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { data: current } = await admin
    .from('agreement_documents')
    .select('body_html')
    .match(rowOf(model))
    .maybeSingle();
  const body = current?.body_html ?? null;
  assertShape(model, version, body);
  if (hasBody(body)) {
    const configKeys = Object.keys(await getAgreementConfigTokens());
    const unknown = findUnknownTokens(body, configKeys);
    if (unknown.length > 0) {
      throw new Error(`בנוסח יש תחליפים שאינם מוכרים: ${unknown.map((t) => `{{${t}}}`).join(' ')}`);
    }
  }
  if (model === 'package') {
    const missing = missingPackageTokens(body ?? '');
    if (missing.length > 0) {
      throw new Error(`נוסח חוזה החבילה חייב לכלול את התחליפים: ${missing.map((t) => `{{${t}}}`).join(' ')}`);
    }
  }
  if (model === 'package') {
    const quoted = perResultTokensIn(body ?? '');
    if (quoted.length > 0) {
      throw new Error(`נוסח חוזה החבילה אינו יכול לצטט נתוני חיוב לפי תוצאה: ${quoted.map((t) => `{{${t}}}`).join(' ')}`);
    }
  }
  const { error } = await admin
    .from('agreement_documents')
    .update({
      status: 'approved',
      version,
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
    })
    .match(rowOf(model));
  if (error) throw new Error('אישור החוזה נכשל');
  await logActivity({ action: 'admin.agreement.approved', meta: { model, version } });
}

// Discard a custom body and return to the vetted in-code default (as a draft).
// Pay-per-result only: the package contract has no in-code default to return to.
export async function revertAgreementToTemplate(): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const { error } = await admin
    .from('agreement_documents')
    .update({ body_html: null, status: 'draft', approved_by: null, approved_at: null })
    .match(rowOf('per_result'));
  if (error) throw new Error('שחזור התבנית נכשל');
  await logActivity({ action: 'admin.agreement.reverted', meta: {} });
}
