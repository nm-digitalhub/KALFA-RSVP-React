// Names shared by the stdio MCP server (./server.ts), the runner that spawns
// it and the Supabase server beside it (../runner.ts) and the settings file that permits its tools
// (.claude/fleet/settings/owner-agent.settings.json). No imports on purpose:
// the runner reads these without pulling the MCP SDK into its own bundle.

// The key under `mcpServers` in the --mcp-config the runner passes. Claude
// Code names an MCP tool `mcp__<config key>__<tool name>` — the CONFIG KEY,
// not the serverInfo.name the server reports — so this one constant is what
// every permission rule and --allowedTools entry is built from. The server
// reports the same string as its name only to keep the two from reading
// differently in a log.
export const OWNER_AGENT_MCP_SERVER = 'owner_agent';

// The env var the runner sets on the server process: the staff member's
// granted platform permission keys, comma-separated, resolved server-side by
// the caller. The model never sees it and no tool takes it as input.
export const OWNER_AGENT_PERMISSIONS_ENV = 'OWNER_AGENT_PERMISSIONS';

const MCP_TOOL_PREFIX = `mcp__${OWNER_AGENT_MCP_SERVER}__`;

export function mcpToolName(toolId: string): string {
  return `${MCP_TOOL_PREFIX}${toolId}`;
}

// The second server of every run (plans/owner-agent-free-read-plan.md §3.2):
// the official Supabase MCP server in read-only mode, spawned from
// node_modules/@supabase/mcp-server-supabase (pinned 0.13.0). Of the four
// tools it registers with `--read-only --features database` (measured:
// list_tables, list_extensions, list_migrations, execute_sql) exactly these two
// are permitted — by --allowedTools and by the settings file's allow list.
export const SUPABASE_MCP_SERVER = 'supabase';
export const SUPABASE_TOOL_IDS = ['execute_sql', 'list_tables'] as const;

const SUPABASE_TOOL_PREFIX = `mcp__${SUPABASE_MCP_SERVER}__`;

export function supabaseMcpToolName(toolId: (typeof SUPABASE_TOOL_IDS)[number]): string {
  return `${SUPABASE_TOOL_PREFIX}${toolId}`;
}

// The inverse, for reading tool names back out of the CLI's trace: a tool of
// either of our two servers comes back as its bare id (`events_pipeline`,
// `execute_sql`); anything else is returned unchanged, so a name from outside
// both namespaces stays visible in an audit row instead of being silently
// dropped. The two servers' ids do not collide (registry ids are *_summary,
// *_pipeline, *_totals, system_health).
export function toolIdFromMcpName(name: string): string {
  if (name.startsWith(MCP_TOOL_PREFIX)) return name.slice(MCP_TOOL_PREFIX.length);
  if (name.startsWith(SUPABASE_TOOL_PREFIX)) return name.slice(SUPABASE_TOOL_PREFIX.length);
  return name;
}
