import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

const READ_FAILED = 'שליפת הזיכויים נכשלה';

const cents = (n: number) => Math.round(n * 100);

// How much of the customer's credit each campaign has already used up — the number every credit guard subtracts
// (what is still available, whether a credit can be voided, the balance an admin sees): the credit of the campaign's
// succeeded collects in the payment ledger. A campaign with no ledger row has used none. (The old
// campaigns.credit_applied column held the same figures for the two pay-per-result campaigns, whose charge rows carry
// them; it is retired.)
//
// Server-only, through the admin client (the ledger has no grant for the browser). THROWS when the ledger cannot be
// read: a guard that silently counted zero would let a credit that was already spent be voided or spent again.
export async function creditConsumedByCampaign(
  admin: AdminClient,
  campaignIds: readonly string[],
): Promise<Map<string, number>> {
  const consumed = new Map<string, number>();
  if (campaignIds.length === 0) return consumed;

  const { data, error } = await admin
    .from('payment_operations')
    .select('campaign_id, outcome, credit_applied, payment_operation_kinds!inner(effect)')
    .in('campaign_id', [...campaignIds]);
  if (error) throw new Error(READ_FAILED);

  const usedCents = new Map<string, number>();
  for (const row of data ?? []) {
    const counts = row.outcome === 'succeeded' && row.payment_operation_kinds?.effect === 'collect';
    if (counts) usedCents.set(row.campaign_id, (usedCents.get(row.campaign_id) ?? 0) + cents(Number(row.credit_applied)));
  }

  for (const id of campaignIds) consumed.set(id, (usedCents.get(id) ?? 0) / 100);
  return consumed;
}
