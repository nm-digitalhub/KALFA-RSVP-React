import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Statutory yearly turnover ceiling for an עוסק פטור (VAT Law §1; indexed
// yearly per §111). VERIFIED-LIVE 2026-07-18 against the statute text on Nevo.
// ⚠️ Update every January when the indexed figure is published — see
// .claude/agents/shared/tax-catalog-israel.md §1 for the verification recipe.
export const OSEK_PATUR_YEARLY_CEILING_ILS = 122_833;

// 80% = open the עוסק-מורשה transition process (טופס 821) BEFORE receiving the
// receipt that crosses the ceiling; 95% = act now.
const WARN_AT = 0.8;
const CRIT_AT = 0.95;

// Fire-and-forget after every successful charge — a final charge on the old
// per-result path (close-charge.ts) and a package purchase (package-purchase.ts):
// sum the calendar year's actually-collected revenue and alert when it
// approaches the ceiling. The sum is owner_agent_billing_sums().charged_amount,
// the one definition of "revenue" that reads both places money is recorded (the
// payment ledger, and the old campaign columns for a campaign that has no ledger
// row) without counting a campaign twice, net of money returned. Charges are
// rare, so re-alerting on every post-threshold charge is intentional, not noise.
// Fail-safe: a monitoring failure must never affect the charge that fired it.
// (Year boundary uses server UTC; the ±2h Israel offset around Jan 1 is
// immaterial for an early-warning threshold.)
export async function checkOsekPaturCeilingAfterCharge(): Promise<void> {
  try {
    const admin = createAdminClient();
    const yearStart = `${new Date().getUTCFullYear()}-01-01T00:00:00Z`;
    const { data, error } = await admin.rpc('owner_agent_billing_sums', { _since: yearStart });
    // A table-returning function answers with an array; this one always yields exactly one row. Anything else is not a
    // sum: say nothing rather than alert on a guess.
    if (error || !Array.isArray(data) || data.length !== 1) return;
    const total = Number(data[0].charged_amount);
    if (!Number.isFinite(total) || total < 0) return;
    const ratio = total / OSEK_PATUR_YEARLY_CEILING_ILS;
    if (ratio < WARN_AT) return;
    await sendSlackAlert({
      level: ratio >= CRIT_AT ? 'error' : 'warn',
      category: 'campaign_billing',
      source: 'tax-ceiling',
      title:
        ratio >= CRIT_AT
          ? 'המחזור השנתי קרוב מאוד לתקרת עוסק פטור — נדרש טיפול מיידי'
          : 'המחזור השנתי חצה 80% מתקרת עוסק פטור',
      fields: {
        yearly_charged: Math.round(total * 100) / 100,
        ceiling: OSEK_PATUR_YEARLY_CEILING_ILS,
        utilization_pct: Math.round(ratio * 1000) / 10,
      },
    });
  } catch {
    // Fail-safe by design: never let monitoring break the charge path.
  }
}
