// Names shared by the stdio MCP server (./server.ts), the runner that spawns
// it (../runner.ts) and the settings file that permits its tools
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

// The inverse, for reading tool names back out of the CLI's trace: our own
// tools come back as their bare registry id; anything else is returned
// unchanged, so a name from outside the namespace stays visible in an audit
// row instead of being silently dropped.
export function toolIdFromMcpName(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}
