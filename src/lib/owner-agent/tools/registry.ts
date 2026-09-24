import 'server-only';

import {
  BILLING_SUMMARY_PERMISSION,
  billingSummaryTool,
} from '@/lib/owner-agent/tools/billing-summary';
import {
  CAMPAIGNS_STATUS_SUMMARY_PERMISSION,
  campaignsStatusSummaryTool,
} from '@/lib/owner-agent/tools/campaigns-status-summary';
import {
  EVENTS_PIPELINE_PERMISSION,
  eventsPipelineTool,
} from '@/lib/owner-agent/tools/events-pipeline';
import {
  INQUIRIES_SUMMARY_PERMISSION,
  inquiriesSummaryTool,
} from '@/lib/owner-agent/tools/inquiries-summary';
import { RSVP_TOTALS_PERMISSION, rsvpTotalsTool } from '@/lib/owner-agent/tools/rsvp-totals';
import type { OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import { SYSTEM_HEALTH_PERMISSION, systemHealthTool } from '@/lib/owner-agent/tools/system-health';
import {
  VOICE_CALLS_SUMMARY_PERMISSION,
  voiceCallsSummaryTool,
} from '@/lib/owner-agent/tools/voice-calls-summary';
import {
  WEB_TRAFFIC_SUMMARY_PERMISSION,
  webTrafficSummaryTool,
} from '@/lib/owner-agent/tools/web-traffic-summary';
import {
  WHATSAPP_DELIVERY_SUMMARY_PERMISSION,
  whatsappDeliverySummaryTool,
} from '@/lib/owner-agent/tools/whatsapp-delivery-summary';

// The owner agent's complete tool set (plan §5): nine read-only tools, each
// paired with the ONE platform permission a staff member must hold for the
// tool to be offered at all. Order follows the §5 table.
//
// Nothing here is wired to anything that runs (stage 5). Stage 6 builds the
// Agent with a dynamic tool set (plan §3.2):
//
//   tools: ({ requestContext }) => toolsForPermissions(<grants resolved
//     server-side with has_platform_permission_for_user, put in requestContext
//     by the consumer — never by the model>)
//
// A tool whose permission is not granted is not in the returned object, so the
// model never sees it. No tool takes a user or permission parameter.
export const OWNER_AGENT_TOOLS = [
  { tool: inquiriesSummaryTool, permission: INQUIRIES_SUMMARY_PERMISSION },
  { tool: campaignsStatusSummaryTool, permission: CAMPAIGNS_STATUS_SUMMARY_PERMISSION },
  { tool: billingSummaryTool, permission: BILLING_SUMMARY_PERMISSION },
  { tool: voiceCallsSummaryTool, permission: VOICE_CALLS_SUMMARY_PERMISSION },
  { tool: eventsPipelineTool, permission: EVENTS_PIPELINE_PERMISSION },
  { tool: rsvpTotalsTool, permission: RSVP_TOTALS_PERMISSION },
  { tool: whatsappDeliverySummaryTool, permission: WHATSAPP_DELIVERY_SUMMARY_PERMISSION },
  { tool: webTrafficSummaryTool, permission: WEB_TRAFFIC_SUMMARY_PERMISSION },
  { tool: systemHealthTool, permission: SYSTEM_HEALTH_PERMISSION },
] as const satisfies ReadonlyArray<{ tool: { id: string }; permission: OwnerAgentPermission }>;

export type OwnerAgentTool = (typeof OWNER_AGENT_TOOLS)[number]['tool'];
export type OwnerAgentToolId = OwnerAgentTool['id'];

// Pure: no model, no I/O. Returns a FRESH object keyed by tool id (the
// `tools: { [tool.id]: tool }` shape Mastra's Agent takes) holding only the
// tools whose permission is in `granted`. Unknown keys in `granted` grant
// nothing; an empty set yields no tools.
export function toolsForPermissions(
  granted: ReadonlySet<string>,
): Partial<Record<OwnerAgentToolId, OwnerAgentTool>> {
  const out: Partial<Record<OwnerAgentToolId, OwnerAgentTool>> = {};
  for (const { tool, permission } of OWNER_AGENT_TOOLS) {
    if (granted.has(permission)) out[tool.id] = tool;
  }
  return out;
}
