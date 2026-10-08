import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';
import type { WebhookInboxRow } from '@/lib/data/webhooks';

// One CardCom document report, read back from webhook_inbox by the worker (the route only stored it).
//
// A document that belongs to a payment we recorded — its number is on a CardCom row of the payment ledger — needs nothing
// more: the ledger already holds it. A document with no such payment (one issued by hand in CardCom, a refund made in
// CardCom's own screens, a charge typed into the terminal) is reported to staff (owner 8.10.2026: an alert only, nothing is
// stored beyond the report itself). The alert carries ids and amounts only, never the customer's or the card's details.
//
// A thrown error leaves the row unprocessed, so the worker tries again; every other outcome is final.

type ReportFields = Record<string, unknown>;

const text = (fields: ReportFields, name: string): string | null => {
  const value = fields[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

const integer = (value: string | null): number | null =>
  value !== null && /^\d{1,9}$/.test(value) ? Number(value) : null;

export async function processCardcomDocumentRow(row: WebhookInboxRow): Promise<void> {
  const fields: ReportFields =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? (row.payload as ReportFields) : {};

  const documentNumber = integer(text(fields, 'DocNumber') ?? text(fields, 'ExtReadInvoiceHead_InvoiceNumber'));
  const documentType = text(fields, 'DocType') ?? text(fields, 'ExtReadInvoiceHead_InvoiceType');
  const terminal = integer(text(fields, 'ExtReadInvoiceHead_TerminalNumber'));

  if (documentNumber !== null) {
    const admin = createAdminClient();
    let query = admin
      .from('payment_operations')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'cardcom')
      .eq('provider_document_number', documentNumber);
    if (terminal !== null) query = query.eq('provider_terminal', terminal);
    const { count, error } = await query;
    if (error) throw new Error('בדיקת מסמך CardCom מול ספר התשלומים נכשלה');
    if ((count ?? 0) > 0) return;
  }

  // The number is in the title on purpose: the alert module suppresses repeats by title, and two different documents
  // must not hide each other.
  void sendSlackAlert({
    level: 'warn',
    category: 'campaign_billing',
    source: 'cardcom-document-webhook',
    title: `CardCom הפיקה מסמך שאין לו תשלום אצלנו (סוג ${documentType ?? '?'}, מספר ${documentNumber ?? '?'})`,
    fields: {
      document_type: documentType ?? '',
      document_number: documentNumber === null ? '' : String(documentNumber),
      terminal: terminal === null ? '' : String(terminal),
      total: text(fields, 'ExtReadInvoiceHead_TotalIncludeVAT') ?? '',
      created_by_user: text(fields, 'InvoiceCreatorUserID') ?? '',
      bill_location: text(fields, 'BillLocation') ?? '',
      inbox_id: row.id,
    },
  });
}
