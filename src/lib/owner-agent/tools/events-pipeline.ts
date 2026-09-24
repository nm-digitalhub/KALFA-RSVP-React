import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { Constants } from '@/lib/supabase/types';
import { getEventsPipelineSummary } from '@/lib/owner-agent/cores/events';
import {
  count,
  countsByKey,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 5 (plan §5). Decision 9.7 (recommended default, assumed): answers
// contain NO event names — counts only; the core never selects a name. Date
// boundaries are Israel midnights from the event-date helpers (see the core).
export const EVENTS_PIPELINE_ID = 'events_pipeline';
export const EVENTS_PIPELINE_PERMISSION = 'view_events' satisfies OwnerAgentPermission;

// Keys come from the generated enum constants, the same values the core's
// Record<Enums<…>, number> is typed over.
export const eventsPipelineOutput = z.object({
  byStatus: countsByKey(Constants.public.Enums.event_status),
  activeByType: countsByKey(Constants.public.Enums.event_type),
  activePastDay: count,
  activeWithoutDate: count,
  activeUpcomingInWindow: count,
  createdInRange: count,
});

export const eventsPipelineTool = createTool({
  id: EVENTS_PIPELINE_ID,
  description:
    'אירועים, ספירות בלבד, בלי שמות. byStatus, activeByType, activePastDay (פעילים שהיום שלהם עבר ועדיין לא נסגרו) ו-activeWithoutDate הם המצב הנוכחי. activeUpcomingInWindow = אירועים פעילים בימים הקרובים (today = היום בלבד, 7d = 7 ימים כולל היום, 30d = 30). createdInRange = נוצרו בטווח, אחורה.',
  strict: true,
  inputSchema: rangeInputSchema,
  outputSchema: eventsPipelineOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      eventsPipelineOutput,
      await getEventsPipelineSummary(createAdminClient(), range),
      EVENTS_PIPELINE_ID,
    ),
});
