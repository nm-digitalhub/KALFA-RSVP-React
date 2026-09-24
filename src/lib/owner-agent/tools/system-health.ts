import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getSystemHealthSummary } from '@/lib/owner-agent/cores/system-health';
import {
  count,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 9 (plan §5). A READ of webhook_inbox only. It does NOT run
// runWhatsAppHealthCheck (a live Graph probe that can send alerts). Decision
// 9.10 (recommended default, assumed): webhook health sits under view_webhooks,
// like /admin/webhooks.
export const SYSTEM_HEALTH_ID = 'system_health';
export const SYSTEM_HEALTH_PERMISSION = 'view_webhooks' satisfies OwnerAgentPermission;

const minutes = count.nullable();

export const systemHealthOutput = z.object({
  unprocessed: count,
  withLastError: count,
  erroringNow: count,
  deadLettered: count,
  minutesSinceLastReceived: minutes,
  minutesSinceLastProcessed: minutes,
  oldestPendingMinutes: minutes,
  receivedInRange: count,
});

export const systemHealthTool = createTool({
  id: SYSTEM_HEALTH_ID,
  description:
    'בריאות קליטת ה-webhooks (קריאה בלבד, בלי בדיקה חיה מול Meta). unprocessed, withLastError, erroringNow, deadLettered, הדקות מאז הקליטה והעיבוד האחרונים ו-oldestPendingMinutes הם המצב הנוכחי (null = אין נתון או אין מה שממתין). receivedInRange = נקלטו בטווח.',
  strict: true,
  inputSchema: rangeInputSchema,
  outputSchema: systemHealthOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      systemHealthOutput,
      await getSystemHealthSummary(createAdminClient(), range),
      SYSTEM_HEALTH_ID,
    ),
});
