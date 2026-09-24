import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getInquiriesSummary } from '@/lib/owner-agent/cores/inquiries';
import {
  count,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 1 (plan §5). Same numbers as the admin sidebar badges and the /admin
// dashboard cards, through the shared core.
export const INQUIRIES_SUMMARY_ID = 'inquiries_summary';
export const INQUIRIES_SUMMARY_PERMISSION = 'view_customer_data' satisfies OwnerAgentPermission;

export const inquiriesSummaryOutput = z.object({
  openContacts: count,
  newCallbacks: count,
  contactsReceived: count,
  callbacksReceived: count,
});

export const inquiriesSummaryTool = createTool({
  id: INQUIRIES_SUMMARY_ID,
  description:
    'פניות לקוחות, ספירות בלבד. openContacts ו-newCallbacks הם המצב הנוכחי ולא תלויים בטווח; contactsReceived ו-callbacksReceived התקבלו בתוך הטווח. בלי שמות, אימיילים או תוכן.',
  strict: true,
  inputSchema: rangeInputSchema,
  outputSchema: inquiriesSummaryOutput,
  // The service-role client is created here, server-side — never taken from
  // the input (the input is the range literal and nothing else).
  execute: async ({ range }) =>
    parseToolOutput(
      inquiriesSummaryOutput,
      await getInquiriesSummary(createAdminClient(), range),
      INQUIRIES_SUMMARY_ID,
    ),
});
