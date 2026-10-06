import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Per-person canonical SUMIT customer anchor (plans/sumit-customer-id-
// reconciliation.md, Phase A). sumit_customers is server-only (RLS on, zero
// client grants) — every read/write here MUST use the admin client; there is
// no owner-scoped path for this table by design.

// One query for both readers below. createAdminClient() stays OUTSIDE any
// try/catch on purpose: a missing service-role key must fail loudly, not look
// like "this account has no customer yet".
async function selectCustomerNumber(userId: string) {
  const admin = createAdminClient();
  return admin
    .from('sumit_customers')
    .select('sumit_customer_id')
    .eq('user_id', userId)
    .maybeSingle();
}

// The paying account's known SUMIT customer number, if any. Read before
// placing a hold or a package charge so the request can send Customer:{ID} and
// dedupe instead of creating a new SUMIT customer.
export async function getSumitCustomerId(userId: string): Promise<number | null> {
  const { data, error } = await selectCustomerNumber(userId);
  if (error) return null; // best-effort: falls back to the one-time create path
  return data ? Number(data.sumit_customer_id) : null;
}

// The same number, for DISPLAY: the profile screen shows it to the account's own
// holder (the admin user page uses the best-effort getSumitCustomerId). Unlike
// getSumitCustomerId, a read failure is thrown, so a screen can say
// "unavailable" instead of showing "no number yet" for a customer who has one.
//
// This is deliberately NOT a column on `profiles`. That table grants the
// `authenticated` role INSERT/UPDATE/DELETE and carries an ALL policy on the
// owner's own row, so any column added to it is writable by its owner — a user
// could point their account at someone else's SUMIT customer. Supabase's own
// guidance for this is a dedicated table with RLS rather than column-level
// privileges ("an advanced feature... we do not recommend"; restricted roles lose
// `select *`). The number stays in this server-only table and reaches a screen
// through this reader, after the caller has verified whose account it is.
export async function readSumitCustomerNumber(userId: string): Promise<number | null> {
  const { data, error } = await selectCustomerNumber(userId);
  if (error) throw new Error('טעינת מספר הלקוח נכשלה');
  return data ? Number(data.sumit_customer_id) : null;
}

// Insert-if-absent only — never overwrites an existing anchor. If a row
// already exists with a DIFFERENT id, SUMIT returned a customer other than
// the one we sent Customer:{ID} for, which should be impossible; alert
// instead of silently drifting the anchor. The primary key on user_id makes two
// concurrent first-holds for the same user race-safe (one wins, the other's
// insert is rejected, and both then observe the SAME stored id).
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
