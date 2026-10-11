import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getBillingSummary } from '@/lib/owner-agent/cores/billing';
import {
  READ_ONLY_TOOL_MCP,
  count,
  money,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 3 (plan §5): counts AND money sums. The sums come from
// public.owner_agent_billing_sums (supabase/migrations/
// 20260924061630_owner_agent_read_aggregates.sql, recreated with _until in
// 20260927011338_owner_agent_capabilities.sql) through the core, in shekels;
// `money` below admits a non-integer, never a negative or NaN. Offered under
// view_billing (registry.ts OWNER_AGENT_TOOLS).
export const BILLING_SUMMARY_ID = 'billing_summary';
export const BILLING_SUMMARY_PERMISSION = 'view_billing' satisfies OwnerAgentPermission;

export const billingSummaryOutput = z.object({
  paymentsInRange: count,
  refundsInRange: count,
  paymentsFailedInRange: count,
  operationsPending: count,
  operationsInReview: count,
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
    'חיוב: ספירות וסכומים בשקלים, מיומן התשלומים, בלי כסף בדיקה. בטווח: paymentsInRange ו-chargedAmountIls (תשלומים שנגבו, נטו מהחזרים), refundsInRange (החזרים), paymentsFailedInRange (תשלומים שנדחו), creditAppliedAmountIls (זיכוי שנוצל בתשלומים), creditsGrantedInRange ו-creditGrantedAmountIls (זיכויים שניתנו ולא בוטלו), creditsVoidedInRange. מצב נוכחי: operationsPending (תשלומים והחזרים שתוצאתם עוד לא ידועה), operationsInReview (דורשים בדיקה ידנית), creditsActive ו-creditUnvoidedAmountIls (כל הזיכויים שלא בוטלו).',
  strict: true,
  mcp: READ_ONLY_TOOL_MCP,
  inputSchema: rangeInputSchema,
  outputSchema: billingSummaryOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      billingSummaryOutput,
      await getBillingSummary(createAdminClient(), range),
      BILLING_SUMMARY_ID,
    ),
});
