import type { MCPToolProperties } from '@mastra/core/tools';
import { z } from 'zod';

import { OWNER_AGENT_RANGES } from '@/lib/owner-agent/range';

// Shared pieces of the owner agent's nine read-only Mastra tools (plan §5,
// stage 5). Nothing here runs a model or is wired to anything that runs: stage
// 6 builds the Agent and hands it toolsForPermissions() (./registry.ts).

// The six platform permission keys the §5 table assigns to the tools. All six
// exist in public.platform_permission_definitions (measured 2026-09-24, keys
// only). A later stage resolves the staff member's grants server-side
// (has_platform_permission_for_user, plan §3.2) and offers only the tools whose
// key is granted. The model never sees or chooses a permission.
export const OWNER_AGENT_PERMISSIONS = [
  'view_customer_data',
  'manage_billing',
  'view_billing',
  'manage_voice',
  'view_events',
  'view_webhooks',
] as const;
export type OwnerAgentPermission = (typeof OWNER_AGENT_PERMISSIONS)[number];

// THE input of every tool: one range literal and nothing else (plan §5: "no
// free input, only a range enum"). strictObject rejects any extra key, so the
// model cannot smuggle an id, a name or free text into a call. Every tool takes
// it, including the ones whose fields are mostly current state: each core has
// at least one range-bound field, and one shared shape keeps the contract
// uniform (the descriptions say which fields ignore the range).
export const rangeInputSchema = z.strictObject({
  range: z
    .enum(OWNER_AGENT_RANGES)
    .describe('today = מחצות היום בשעון ישראל; 7d / 30d = 7 או 30 ימים אחורה עד עכשיו'),
});

// Building blocks for the output schemas. Outputs are numbers (and, in one
// place, a state enum) only — never a name, email, phone, message text, event
// name, URL, token or payload.
export const count = z.number().int().nonnegative();
export const fraction = z.number().min(0).max(1);
// A sum of money in shekels: not an integer (agorot), never negative. zod 4's
// z.number() already rejects NaN and ±Infinity.
export const money = z.number().nonnegative();

// A fixed-key object of counts, built from the SAME readonly list the core
// builds its record from (an enum's Constants, a code catalogue), so the output
// keys cannot drift from the core's. Deliberately z.object, not z.record: the
// keys are a closed set, and a record would also accept keys nobody listed.
export function countsByKey<const K extends string>(keys: readonly K[]) {
  const shape = Object.fromEntries(keys.map((k) => [k, count])) as Record<K, typeof count>;
  return z.object(shape);
}

// Validate a core's result against the tool's output schema BEFORE it leaves
// execute(). Two reasons:
//   - zod's default object mode STRIPS unknown keys, so a field a core adds
//     later (say, a name) is dropped here instead of reaching the model;
//   - a mismatch throws a bare code. Mastra's own output validation would
//     instead return "Tool output validation failed … Returned output: <the
//     output>" to the model, i.e. echo the values. Our parse runs first, so a
//     value never travels inside an error message.
// Output schemas are therefore never .strict(): strip is the safe mode here.
// MCP tool annotations (spec 2025-03-26 "Tool annotations"), the same on all
// nine tools: each only reads (head counts and aggregate RPCs), changes
// nothing, and returns the same thing for the same arguments at one instant.
// openWorldHint is false as decided for all nine (web_traffic_summary does
// call GA4, but a fixed report of our own property, not an open domain).
// mcp/server.ts hands them to tools/list; they are hints to the client, not a
// wall — the walls are the runner's and the server's.
export const READ_ONLY_TOOL_MCP = {
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const satisfies MCPToolProperties;

export function parseToolOutput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  toolId: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${toolId}_output_invalid`);
  return parsed.data;
}
