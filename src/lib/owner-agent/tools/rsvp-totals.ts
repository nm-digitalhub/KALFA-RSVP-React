import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getRsvpTotals } from '@/lib/owner-agent/cores/rsvp';
import {
  count,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 6 (plan §5). Guest ROWS, not people. The people sums (a row may stand
// for a family) need public.owner_agent_rsvp_people_totals, in
// supabase/migrations/20260924061630_owner_agent_read_aggregates.sql, created
// but NOT applied. When it is, the core and this schema gain two number
// fields. Until then the description says rows, so the model does not present
// them as a head count, and the tool is WITHHELD: it sits in registry.ts
// OWNER_AGENT_TOOLS_PENDING_MIGRATION, which toolsForPermissions() never
// offers. No event names (decision 9.7, assumed default).
export const RSVP_TOTALS_ID = 'rsvp_totals';
export const RSVP_TOTALS_PERMISSION = 'view_events' satisfies OwnerAgentPermission;

export const rsvpTotalsOutput = z.object({
  activeEvents: count,
  guestRows: count,
  attending: count,
  declined: count,
  maybe: count,
  pending: count,
  responsesInRange: count,
});

export const rsvpTotalsTool = createTool({
  id: RSVP_TOTALS_ID,
  description:
    'אישורי הגעה באירועים פעילים. activeEvents, guestRows ו-attending/declined/maybe/pending הם המצב הנוכחי וסופרים שורות אורחים, לא אנשים (מספר האנשים עוד לא זמין). responsesInRange = תשובות RSVP שנקלטו בטווח.',
  strict: true,
  inputSchema: rangeInputSchema,
  outputSchema: rsvpTotalsOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      rsvpTotalsOutput,
      await getRsvpTotals(createAdminClient(), range),
      RSVP_TOTALS_ID,
    ),
});
