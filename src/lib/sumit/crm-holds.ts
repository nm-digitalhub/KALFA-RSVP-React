import 'server-only';

// Read-only SUMIT CRM access to the "תפיסות מסגרת" (frame holds) folder.
// SUMIT exposes no API to release a hold or to be notified when one is
// released — release only ever happens manually in their dashboard. This is
// the read side that lets our own reconciler (src/lib/data/
// sumit-hold-reconcile.ts) discover a manual release after the fact.
//
// Endpoint + shape verified live 2026-08-30 (scripts/sumit-crm-list-holds.ts):
// crm/data/listentities on folder 1076735289, ordered by Billing_Date desc.
// Billing_Status was confirmed empirically, not just from an old comment: a
// hold this session manually released in the dashboard came back as 3 with a
// Billing_Date matching that campaign's authorized_at to the second.
const SUMIT_CRM_LIST_URL = 'https://api.sumit.co.il/crm/data/listentities/';
const HOLDS_FOLDER_ID = '1076735289';

// 2 (charged) is intentionally not modeled as a named export here — the
// reconciler ignores it by design (see queues.ts's sumitHoldReconcile
// comment): charging always goes through closeCampaignAndCharge, never
// discovered after the fact from SUMIT.
export const SUMIT_HOLD_STATUS_OPEN = 1;
export const SUMIT_HOLD_STATUS_RELEASED = 3;

export interface SumitHoldEntity {
  entityId: number;
  // Correlates to campaigns.hold_order_document_id. null for older holds
  // (pre-2026-08-30, when PreventDocumentCreation was still set) that never
  // got an Order document at all.
  orderDocumentId: number | null;
  billingStatus: number | null;
  amount: number | null;
  date: string | null;
}

export interface ListSumitHoldsParams {
  companyId: number;
  apiKey: string;
  // One page, newest-first, is deliberate: callers cross-reference against a
  // handful of open holds in our own DB at any given time, not the full
  // history. Raise this only if that stops being true.
  pageSize?: number;
}

interface RawEntity {
  ID?: number;
  Billing_OrderDocument?: Array<{ ID?: number }>;
  Billing_Status?: number[];
  Billing_Amount?: number[];
  Billing_Date?: string[];
}

export async function listSumitHolds(p: ListSumitHoldsParams): Promise<SumitHoldEntity[]> {
  const res = await fetch(SUMIT_CRM_LIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Credentials: { CompanyID: p.companyId, APIKey: p.apiKey },
      Folder: HOLDS_FOLDER_ID,
      Order: { Property: 'Billing_Date', Descending: true },
      Paging: { StartIndex: 0, PageSize: p.pageSize ?? 100 },
      LoadProperties: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`SUMIT CRM listentities failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { Data?: { Entities?: RawEntity[] } };
  const entities = json.Data?.Entities ?? [];
  return entities.map((e) => ({
    entityId: typeof e.ID === 'number' ? e.ID : Number(e.ID),
    orderDocumentId: e.Billing_OrderDocument?.[0]?.ID ?? null,
    billingStatus: e.Billing_Status?.[0] ?? null,
    amount: e.Billing_Amount?.[0] ?? null,
    date: e.Billing_Date?.[0] ?? null,
  }));
}
