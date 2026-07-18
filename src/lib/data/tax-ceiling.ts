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

// Fire-and-forget after every successful close-charge: sum the calendar year's
// actually-charged revenue (charge_status='charged' — the only rows that count
// as turnover) and alert when it approaches the ceiling. Charges are rare, so
// re-alerting on every post-threshold charge is intentional, not noise.
// Fail-safe: a monitoring failure must never affect the charge that fired it.
// (Year boundary uses server UTC; the ±2h Israel offset around Jan 1 is
// immaterial for an early-warning threshold.)
export async function checkOsekPaturCeilingAfterCharge(): Promise<void> {
  try {
    const admin = createAdminClient();
    const yearStart = `${new Date().getUTCFullYear()}-01-01T00:00:00Z`;
    const { data, error } = await admin
      .from('campaigns')
      .select('final_charge_amount')
      .eq('charge_status', 'charged')
      .gte('charged_at', yearStart);
    if (error || !data) return;
    const total = data.reduce(
      (sum, r) => sum + Number(r.final_charge_amount ?? 0),
      0,
    );
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
