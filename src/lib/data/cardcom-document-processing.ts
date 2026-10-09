import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { documentTypeOfReportNumber, refundDocumentFor } from '@/lib/cardcom/document-types';
import { createAdminClient } from '@/lib/supabase/admin';
import type { WebhookInboxRow } from '@/lib/data/webhooks';

// One CardCom document report, read back from webhook_inbox by the worker (the route only stored it).
//
// A document that belongs to a payment we recorded — a CardCom row of the payment ledger with its number, its TYPE and its
// terminal — needs nothing more: the ledger already holds it. The type matters: CardCom numbers every document type on its own
// (receipt 6 and credit receipt 6 are two documents), so a number alone could take a document we never issued for one of
// ours. The report gives the type as a number, named through CardCom's documented list (cardcom/document-types.ts); the
// ledger keeps it in the generated column provider_document_type. A CardCom refund row recorded before that column was
// written by the refund (9.10.2026 17:40) has none: its type is the credit counterpart of its purchase's — the same mapping
// the refund itself used. A document with no such payment (one issued by hand in CardCom, a refund made in
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

// Is there a CardCom row of the payment ledger with this document number, type and terminal? Rows of that number are read
// (there are at most a few: one per document type), and each one's type is its generated column — or, for a refund recorded
// without one, the credit counterpart of its purchase's type. Throws when the ledger cannot be read (the worker retries).
async function isOurDocument(documentNumber: number, typeName: string, terminal: number | null): Promise<boolean> {
  const admin = createAdminClient();
  let query = admin
    .from('payment_operations')
    .select('id, kind, provider_document_type, parent_operation_id')
    .eq('provider', 'cardcom')
    .eq('provider_document_number', documentNumber);
  if (terminal !== null) query = query.eq('provider_terminal', terminal);
  const { data: rows, error } = await query;
  if (error) throw new Error('בדיקת מסמך CardCom מול ספר התשלומים נכשלה');
  if ((rows ?? []).some((r) => r.provider_document_type === typeName)) return true;

  const parentIds = (rows ?? []).flatMap((r) =>
    r.provider_document_type === null && r.kind === 'refund' && r.parent_operation_id ? [r.parent_operation_id] : [],
  );
  if (parentIds.length === 0) return false;
  const { data: parents, error: parentError } = await admin
    .from('payment_operations')
    .select('provider_document_type')
    .in('id', parentIds);
  if (parentError) throw new Error('בדיקת מסמך CardCom מול ספר התשלומים נכשלה');
  return (parents ?? []).some((p) => refundDocumentFor(p.provider_document_type)?.answered === typeName);
}

export async function processCardcomDocumentRow(row: WebhookInboxRow): Promise<void> {
  const fields: ReportFields =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? (row.payload as ReportFields) : {};

  const documentNumber = integer(text(fields, 'DocNumber') ?? text(fields, 'ExtReadInvoiceHead.InvoiceNumber'));
  const documentType = text(fields, 'DocType') ?? text(fields, 'ExtReadInvoiceHead.InvoiceType');
  const typeName = documentTypeOfReportNumber(documentType);
  const terminal = integer(text(fields, 'ExtReadInvoiceHead.TerminalNumber'));

  // Only a report whose number AND type we can read can be ours; anything else is reported.
  if (documentNumber !== null && typeName !== null && (await isOurDocument(documentNumber, typeName, terminal))) return;

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
      total: text(fields, 'ExtReadInvoiceHead.TotalIncludeVAT') ?? '',
      created_by_user: text(fields, 'InvoiceCreatorUserID') ?? '',
      bill_location: text(fields, 'BillLocation') ?? '',
      inbox_id: row.id,
    },
  });
}
