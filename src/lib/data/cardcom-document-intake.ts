import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';

// CardCom's document report (support.cardcom.solutions, article 360007138014): every document the terminal issues is POSTed
// to /api/cardcom/document-webhook as Name=Value pairs. With "הוסף את פרטי המסמך ב-POST" on, the post carries the whole
// document and the card data (owner 8.10.2026: stored as received, ID included).
//
// The post is NOT signed. What proves it is CardCom's is the secret we put in the terminal's "מחרוזת תוספת לפנייה"
// (secret=...), which CardCom appends to every report; it is kept in Vault (cardcom:document_report_secret). The secret is
// removed from what is stored. Nothing here logs a value: the report holds names, phones, e-mails and an ID number.

export const CARDCOM_DOCUMENT_KIND = 'cardcom_document';
export const CARDCOM_PROVIDER = 'cardcom';
const SECRET_PARAM = 'secret';

/** Every Name=Value pair of the report. CardCom's own URL query is merged in, the body wins on a repeated name. */
export function parseCardcomReport(body: string, query: URLSearchParams): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, value] of query) fields[name] = value;
  for (const [name, value] of new URLSearchParams(body)) fields[name] = value;
  return fields;
}

/** The report without the shared secret: what is stored. */
export function withoutSecret(fields: Record<string, string>): Record<string, string> {
  const { [SECRET_PARAM]: _secret, ...rest } = fields;
  return rest;
}

/** Constant-time comparison of the posted secret with the stored one. No stored secret means every report is refused. */
export function secretMatches(fields: Record<string, string>, stored: string | null): boolean {
  const posted = fields[SECRET_PARAM];
  if (!stored || typeof posted !== 'string' || posted === '') return false;
  const a = Buffer.from(posted);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The key CardCom's guide asks duplicates to be recognised by: the document's number, qualified by its type (numbers run per
 * type, so a receipt and a refund can share one). Null when the report names no document.
 */
export function documentDedupeKey(fields: Record<string, string>): string | null {
  const number = fields.DocNumber || fields.ExtReadInvoiceHead_InvoiceNumber || '';
  const type = fields.DocType || fields.ExtReadInvoiceHead_InvoiceType || '';
  if (!/^\d{1,18}$/.test(number) || !/^\d{1,6}$/.test(type)) return null;
  return `${type}:${number}`;
}

/** The stored secret, or null when none is saved or it cannot be read (the route then refuses the report). */
export async function readDocumentReportSecret(): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient().rpc('cardcom_document_report_secret');
    if (error || typeof data !== 'string' || data === '') return null;
    return data;
  } catch {
    return null;
  }
}
