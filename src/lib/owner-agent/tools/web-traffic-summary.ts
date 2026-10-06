import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { getWebTrafficSummary } from '@/lib/owner-agent/cores/web-traffic';
import type { SectionState } from '@/lib/analytics/ga4-types';
import {
  READ_ONLY_TOOL_MCP,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 8 (plan §5). The /admin/analytics overview KPIs through the same GA4
// loader, so the numbers match the page. No Supabase client: the source is the
// GA4 Data API. view_customer_data, like the page. No revenue (money is
// view_billing) and no demographics (the plan excludes them).
export const WEB_TRAFFIC_SUMMARY_ID = 'web_traffic_summary';
export const WEB_TRAFFIC_SUMMARY_PERMISSION = 'view_customer_data' satisfies OwnerAgentPermission;

// The one string-typed field in any owner-agent tool output: a closed enum of
// section states, never free text. `satisfies` pins the list to SectionState.
export const WEB_TRAFFIC_STATES = [
  'ok',
  'stale',
  'quota_exhausted',
  'error',
  'not_configured',
] as const satisfies readonly SectionState[];

const metric = z.number().nonnegative().nullable();

export const webTrafficSummaryOutput = z.object({
  state: z.enum(WEB_TRAFFIC_STATES),
  activeUsers: metric,
  newUsers: metric,
  sessions: metric,
  pageViews: metric,
  engagementRate: metric,
  averageSessionDurationSec: metric,
  previousActiveUsers: metric,
  previousSessions: metric,
});

export const webTrafficSummaryTool = createTool({
  id: WEB_TRAFFIC_SUMMARY_ID,
  description:
    'תנועה באתר מ-Google Analytics, כמו בדף האנליטיקה בניהול. הטווח הוא ימים קלנדריים של GA4 (7d = שבעה ימים עד היום), לא חלון מתגלגל. previousActiveUsers ו-previousSessions = התקופה הקודמת באותו אורך. engagementRate הוא שבר בין 0 ל-1. כש-state אינו ok או stale, כל המספרים null.',
  strict: true,
  mcp: READ_ONLY_TOOL_MCP,
  inputSchema: rangeInputSchema,
  outputSchema: webTrafficSummaryOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      webTrafficSummaryOutput,
      await getWebTrafficSummary(range),
      WEB_TRAFFIC_SUMMARY_ID,
    ),
});
