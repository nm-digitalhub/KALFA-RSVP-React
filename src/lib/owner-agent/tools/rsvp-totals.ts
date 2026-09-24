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

// Tool 6 (plan §5): guest ROWS by RSVP status, and PEOPLE (a row may stand
// for a family) from public.owner_agent_rsvp_people_totals (supabase/migrations/
// 20260924061630_owner_agent_read_aggregates.sql, applied) through the core.
// No event names (decision 9.7: counts only). Offered under view_events
// (registry.ts OWNER_AGENT_TOOLS).
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
  invitedPeople: count,
  attendingPeople: count,
});

export const rsvpTotalsTool = createTool({
  id: RSVP_TOTALS_ID,
  description:
    'אישורי הגעה באירועים פעילים. activeEvents, guestRows ו-attending/declined/maybe/pending הם המצב הנוכחי וסופרים שורות אורחים (שורה יכולה לייצג משפחה). invitedPeople ו-attendingPeople הם מספר האנשים, גם הם מצב נוכחי. responsesInRange = תשובות RSVP שנקלטו בטווח.',
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
