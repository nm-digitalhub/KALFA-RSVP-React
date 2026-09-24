import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  WHATSAPP_FAILURE_CODES,
  getWhatsAppDeliverySummary,
} from '@/lib/owner-agent/cores/whatsapp-delivery';
import {
  count,
  countsByKey,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 7 (plan §5). Decision 9.10 (recommended default, assumed): WhatsApp
// delivery counts sit under view_webhooks, the permission of the
// /admin/webhooks inspector that shows the same delivery states row by row.
export const WHATSAPP_DELIVERY_SUMMARY_ID = 'whatsapp_delivery_summary';
export const WHATSAPP_DELIVERY_SUMMARY_PERMISSION = 'view_webhooks' satisfies OwnerAgentPermission;

// The Meta error codes are object KEYS from the core's fixed catalogue; every
// value is a count. No code is read out of a row.
export const whatsappDeliverySummaryOutput = z.object({
  outbound: z.object({
    total: count,
    unacknowledged: count,
    sent: count,
    delivered: count,
    read: count,
    failed: count,
    otherStatus: count,
  }),
  inbound: count,
  failedByCode: countsByKey([...WHATSAPP_FAILURE_CODES, 'other'] as const),
});

export const whatsappDeliverySummaryTool = createTool({
  id: WHATSAPP_DELIVERY_SUMMARY_ID,
  description:
    'מסירת הודעות וואטסאפ. outbound = הודעות שנשלחו בטווח, לפי סטטוס המסירה האחרון שדווח (unacknowledged = עוד לא הגיע סטטוס). inbound = הודעות שהתקבלו בטווח. failedByCode = כשלונות לפי קוד השגיאה של Meta (other = כל קוד אחר או בלי קוד).',
  strict: true,
  inputSchema: rangeInputSchema,
  outputSchema: whatsappDeliverySummaryOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      whatsappDeliverySummaryOutput,
      await getWhatsAppDeliverySummary(createAdminClient(), range),
      WHATSAPP_DELIVERY_SUMMARY_ID,
    ),
});
