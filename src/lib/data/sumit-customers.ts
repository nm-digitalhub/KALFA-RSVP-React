import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Per-person canonical SUMIT customer anchor (plans/sumit-customer-id-
// reconciliation.md, Phase A). sumit_customers is server-only (RLS on, zero
// client grants) — every read/write here MUST use the admin client; there is
// no owner-scoped path for this table by design.

// The paying account's known SUMIT customer number, if any. Read before
// placing a hold so the request can send Customer:{ID} and dedupe instead of
// creating a new SUMIT customer.
export async function getSumitCustomerId(userId: string): Promise<number | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sumit_customers')
    .select('sumit_customer_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null; // best-effort: falls back to the one-time create path
  return data ? Number(data.sumit_customer_id) : null;
}

// Insert-if-absent only — never overwrites an existing anchor. If a row
// already exists with a DIFFERENT id, SUMIT returned a customer other than
// the one we sent Customer:{ID} for, which should be impossible; alert
// instead of silently drifting the anchor. `on conflict do nothing` makes two
// concurrent first-holds for the same user race-safe (one wins, the other's
// insert is a no-op, and both then observe the SAME stored id).
export async function recordSumitCustomerId(args: {
  userId: string;
  sumitCustomerId: number;
  campaignId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('sumit_customers').insert({
    user_id: args.userId,
    sumit_customer_id: args.sumitCustomerId,
    first_seen_campaign_id: args.campaignId,
  });
  if (!error) return; // inserted — this IS the anchor now

  const { data: existing } = await admin
    .from('sumit_customers')
    .select('sumit_customer_id')
    .eq('user_id', args.userId)
    .maybeSingle();
  if (!existing) return; // insert failed for an unrelated reason; best-effort
  if (Number(existing.sumit_customer_id) !== args.sumitCustomerId) {
    void sendSlackAlert({
      level: 'error',
      category: 'campaign_billing',
      source: 'sumit-customers',
      title: 'SUMIT החזיר לקוח שונה מהמעוגן — נדרשת בדיקה',
      fields: {
        user_id: args.userId,
        anchored_customer_id: String(existing.sumit_customer_id),
        returned_customer_id: String(args.sumitCustomerId),
        campaign_id: args.campaignId,
      },
    });
  }
}
