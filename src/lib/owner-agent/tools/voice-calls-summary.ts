import 'server-only';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getVoiceCallsSummary } from '@/lib/owner-agent/cores/voice-calls';
import {
  READ_ONLY_TOOL_MCP,
  count,
  fraction,
  parseToolOutput,
  rangeInputSchema,
  type OwnerAgentPermission,
} from '@/lib/owner-agent/tools/shared';

// Tool 4 (plan §5). With range '7d' these are the /admin/voice 7-day tiles,
// which read the same core.
export const VOICE_CALLS_SUMMARY_ID = 'voice_calls_summary';
export const VOICE_CALLS_SUMMARY_PERMISSION = 'manage_voice' satisfies OwnerAgentPermission;

export const voiceCallsSummaryOutput = z.object({
  activeNow: count,
  attempts: count,
  completed: count,
  answerRate: fraction.nullable(),
});

export const voiceCallsSummaryTool = createTool({
  id: VOICE_CALLS_SUMMARY_ID,
  description:
    'שיחות AI לאורחים. activeNow = שיחות פעילות עכשיו (לא תלוי בטווח); attempts, completed ו-answerRate הם בטווח. answerRate הוא שבר בין 0 ל-1, או null כשאין בטווח שיחה שהסתיימה.',
  strict: true,
  mcp: READ_ONLY_TOOL_MCP,
  inputSchema: rangeInputSchema,
  outputSchema: voiceCallsSummaryOutput,
  execute: async ({ range }) =>
    parseToolOutput(
      voiceCallsSummaryOutput,
      await getVoiceCallsSummary(createAdminClient(), range),
      VOICE_CALLS_SUMMARY_ID,
    ),
});
