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

// The owner agent's tool set (plan §5): all nine read-only tools, each paired
// with the ONE platform permission a staff member must hold for the tool to be
// offered at all. Order follows the §5 table.
//
// The set is built per run from the staff member's permissions, resolved
// server-side with has_platform_permission_for_user — never by the model. The
// stdio MCP server (../mcp/server.ts) registers only toolsForPermissions(<that
// set>), and the runner allows only those ids. No tool takes a user or
// permission parameter.
//
// billing_summary and rsvp_totals were withheld until their sums could be read
// without loading rows: public.owner_agent_billing_sums(_since) and
// public.owner_agent_rsvp_people_totals() (supabase/migrations/
// 20260924061630_owner_agent_read_aggregates.sql) are applied and typed, so
// both are offered like the other seven. Adding a tool here also means adding
// its id to .claude/fleet/settings/owner-agent.settings.json, which
// src/lib/owner-agent/owner-agent-settings.test.ts pins to this list.
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
// tools of OWNER_AGENT_TOOLS whose permission is in `granted`. Unknown keys in
// `granted` grant nothing; an empty set yields no tools.
export function toolsForPermissions(
  granted: ReadonlySet<string>,
): Partial<Record<OwnerAgentToolId, OwnerAgentTool>> {
  const out: Partial<Record<OwnerAgentToolId, OwnerAgentTool>> = {};
  for (const { tool, permission } of OWNER_AGENT_TOOLS) {
    if (granted.has(permission)) out[tool.id] = tool;
  }
  return out;
}
