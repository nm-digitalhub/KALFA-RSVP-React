import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

const READ_FAILED = 'שליפת הזיכויים נכשלה';

const cents = (n: number) => Math.round(n * 100);

// How much of the customer's credit each campaign has already used up — the number every credit guard subtracts
// (what is still available, whether a credit can be voided, the balance an admin sees).
//
// Two places can say so, and exactly ONE is asked per campaign: the payment ledger when the campaign has ANY ledger row
// (the credit of its succeeded collects), the old campaigns.credit_applied column otherwise. Asking both would count
// the two historical campaigns twice, since they are recorded in both; it is the same rule public.owner_agent_billing_
// sums applies to revenue. Once the old path is retired and the column dropped, only the ledger branch remains.
//
// Server-only, through the admin client (the ledger has no grant for the browser). THROWS when the ledger cannot be
// read: a guard that silently counted zero would let a credit that was already spent be voided or spent again.
export async function creditConsumedByCampaign(
  admin: AdminClient,
  campaigns: ReadonlyArray<{ id: string; credit_applied: number | string | null }>,
): Promise<Map<string, number>> {
  const consumed = new Map<string, number>();
  if (campaigns.length === 0) return consumed;

  const { data, error } = await admin
    .from('payment_operations')
    .select('campaign_id, outcome, credit_applied, payment_operation_kinds!inner(effect)')
    .in('campaign_id', campaigns.map((c) => c.id));
  if (error) throw new Error(READ_FAILED);

  const fromLedger = new Map<string, number>();
  for (const row of data ?? []) {
    const used = fromLedger.get(row.campaign_id) ?? 0;
    const counts = row.outcome === 'succeeded' && row.payment_operation_kinds?.effect === 'collect';
    fromLedger.set(row.campaign_id, counts ? used + cents(Number(row.credit_applied)) : used);
  }

  for (const c of campaigns) {
    const ledger = fromLedger.get(c.id);
    consumed.set(c.id, ledger !== undefined ? ledger / 100 : Number(c.credit_applied ?? 0));
  }
  return consumed;
}
