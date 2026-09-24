import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCampaignsStatusSummary } from '@/lib/owner-agent/cores/campaigns';
import {
  READ_ONLY_TOOL_MCP,
  count,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 2 (plan §5). needsAttention is the length of the /admin/campaigns list
// by construction (the core owns the filter both use). Decision 9.7 (assumed
// default): no event names — the admin list's eventName and hold-document URL
// are never read.
export const CAMPAIGNS_STATUS_SUMMARY_ID = 'campaigns_status_summary';
export const CAMPAIGNS_STATUS_SUMMARY_PERMISSION = 'manage_billing' satisfies OwnerAgentPermission;

export const campaignsStatusSummaryOutput = z.object({
  active: count,
  paused: count,
  closed: count,
  winddown: count,
  stuckHolds: count,
  needsAttention: count,
  createdInRange: count,
});

export const campaignsStatusSummaryTool = createTool({
  id: CAMPAIGNS_STATUS_SUMMARY_ID,
  description:
    'קמפיינים, ספירות לפי מצב. active, paused, closed, winddown, stuckHolds ו-needsAttention הם המצב הנוכחי (needsAttention = מספר השורות ברשימת הקמפיינים בניהול); createdInRange = נוצרו בטווח. בלי שמות אירועים.',
  strict: true,
  mcp: READ_ONLY_TOOL_MCP,
  inputSchema: rangeInputSchema,
  outputSchema: campaignsStatusSummaryOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      campaignsStatusSummaryOutput,
      await getCampaignsStatusSummary(createAdminClient(), range),
      CAMPAIGNS_STATUS_SUMMARY_ID,
    ),
});
