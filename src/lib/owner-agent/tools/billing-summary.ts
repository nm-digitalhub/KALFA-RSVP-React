import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getBillingSummary } from '@/lib/owner-agent/cores/billing';
import {
  count,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 3 (plan §5). COUNTS ONLY for now. The money sums (charged amount,
// credit applied/granted) need public.owner_agent_billing_sums, in
// supabase/migrations/20260924061630_owner_agent_read_aggregates.sql, which is
// created but NOT applied (PostgREST aggregates are off on this project). When
// it is applied and types regenerated, the core gains the sum fields and this
// output schema gains them too. The description tells the model there are no
// amounts, so it does not invent one. Until then the tool is WITHHELD: it sits
// in registry.ts OWNER_AGENT_TOOLS_PENDING_MIGRATION, which
// toolsForPermissions() never offers.
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
});

export const billingSummaryTool = createTool({
  id: BILLING_SUMMARY_ID,
  description:
    'חיוב, ספירות בלבד. אין כאן סכומי כסף (עדיין לא זמינים), אל תמציא סכום. chargedInRange, nothingToChargeInRange, creditsGrantedInRange ו-creditsVoidedInRange הם בטווח; השאר מצב נוכחי (חיובים ממתינים, שנכשלו, בבדיקה, מסגרות שאושרו וממתינות לחיוב, זיכויים פעילים).',
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
