import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getBillingSummary } from '@/lib/owner-agent/cores/billing';
import {
  count,
  money,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 3 (plan §5): counts AND money sums. The sums come from
// public.owner_agent_billing_sums (supabase/migrations/
// 20260924061630_owner_agent_read_aggregates.sql, applied) through the core,
// in shekels; `money` below admits a non-integer, never a negative or NaN.
// Offered under view_billing (registry.ts OWNER_AGENT_TOOLS).
export const BILLING_SUMMARY_ID = 'billing_summary';
export const BILLING_SUMMARY_PERMISSION = 'view_billing' satisfies OwnerAgentPermission;

export const billingSummaryOutput = z.object({
  chargedInRange: count,
  nothingToChargeInRange: count,
  chargesPending: count,
  chargesFailed: count,
  chargesInReview: count,
  holdsAwaitingCharge: count,
  creditsActive: count,
  creditsGrantedInRange: count,
  creditsVoidedInRange: count,
  chargedAmountIls: money,
  creditAppliedAmountIls: money,
  creditGrantedAmountIls: money,
  creditUnvoidedAmountIls: money,
});

export const billingSummaryTool = createTool({
  id: BILLING_SUMMARY_ID,
  description:
    'חיוב: ספירות וסכומים בשקלים. בטווח: chargedInRange ו-chargedAmountIls (חיובים סופיים שנגבו), nothingToChargeInRange, creditAppliedAmountIls (זיכוי שנוצל בחיובים), creditsGrantedInRange ו-creditGrantedAmountIls (זיכויים שניתנו ולא בוטלו), creditsVoidedInRange. מצב נוכחי: chargesPending, chargesFailed, chargesInReview, holdsAwaitingCharge (מסגרות שאושרו וממתינות לחיוב), creditsActive ו-creditUnvoidedAmountIls (כל הזיכויים שלא בוטלו).',
  strict: true,
  inputSchema: rangeInputSchema,
  outputSchema: billingSummaryOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      billingSummaryOutput,
      await getBillingSummary(createAdminClient(), range),
      BILLING_SUMMARY_ID,
    ),
});
