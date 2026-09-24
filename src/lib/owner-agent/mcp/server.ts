import 'server-only';

import { standardSchemaToJSONSchema } from '@mastra/core/schema';
import { isValidationError } from '@mastra/core/tools';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { OWNER_AGENT_MCP_SERVER } from '@/lib/owner-agent/mcp/names';
import { toolsForPermissions, type OwnerAgentTool } from '@/lib/owner-agent/tools/registry';

// The owner agent's tools as a stdio MCP server (plan §8 stage 6a). `claude -p`
// spawns it (../runner.ts) and it is the ONLY source of tools in that session:
// the runner turns every built-in off with `--tools ""`.
//
// ⚠️ WHAT THE SERVER OFFERS IS DECIDED BEFORE THE MODEL SPEAKS. The permission
// set arrives in the process environment from the runner, which got it from
// the caller, which resolved it server-side (has_platform_permission_for_user,
// plan §3.2). It is read once, at construction, and filtered through the same
// toolsForPermissions() the stage-5 tests pin. A tool whose permission is not
// granted is not registered: it is absent from tools/list and a tools/call for
// it fails exactly like a name that never existed. No tool takes a user,
// permission or free-text argument, so nothing the model sends can widen this.
//
// ⚠️ THE LOW-LEVEL `Server`, NOT `McpServer`, AND THAT IS THE POINT. The SDK
// marks `Server` "@deprecated … Only use Server for advanced use cases"
// (1.30.0 server/index.d.ts:71). This is one: McpServer answers an unknown
// tool with "Tool <name> not found" and a bad argument with
// "Input validation error: … <zod issue text>" (1.30.0 server/mcp.js:104,178),
// and neither text is ours to shape. Here every failure is one of three bare
// codes, so no error the model sees — and may repeat to the owner — carries a
// stack, SQL, a provider message or a value.
//
// ⚠️ STDOUT IS THE PROTOCOL. Nothing in this module prints. The entry
// (./main.ts) redirects console.log to stderr before loading it, and stderr
// carries codes only, because the CLI may keep an MCP server's stderr in its
// own logs.

export type OwnerAgentMcpErrorCode = 'unknown_tool' | 'invalid_input' | 'tool_failed';

// Mastra types `execute` as (input, context), where the context is what an
// Agent supplies (tracing, request context, suspend/resume). The MCP server is
// not an Agent and has none of those. The stage-5 contract tests call every
// tool exactly this way — `tool.execute(input)`, no context — and pin its
// results (tools/tools.test.ts, `run`). The input reaching this call has
// already passed the tool's own schema (see the CallTool handler).
type ExecuteWithoutAgent = (input: unknown) => Promise<unknown>;

// Comma-separated keys, exactly as the runner writes them. No trimming and no
// case folding, for the same reason toolsForPermissions() does neither: only
// the exact key counts (registry.test.ts). Unset or empty means no tools —
// fail closed, never "all".
export function parsePermissionsEnv(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(raw.split(',').filter((key) => key.length > 0));
}

// The tool as tools/list presents it. The JSON Schema is produced the way
// Mastra produces a tool-parameter schema: standardSchemaToJSONSchema with
// io 'input' ("Use for tool parameters", @mastra/schema-compat
// standard-schema.d.ts), default target draft-07 — the same target the MCP
// SDK's own zod-4 branch uses (1.30.0 server/zod-json-schema-compat.js).
function toMcpTool(tool: OwnerAgentTool): Tool {
  if (!tool.inputSchema) throw new Error('owner_agent_tool_without_input_schema');
  const json = standardSchemaToJSONSchema(tool.inputSchema, { io: 'input' });
  // Checked against the SDK's OWN tool schema rather than cast to it: MCP
  // requires an object at the root with object-valued properties. Every
  // owner-agent tool takes strictObject({ range }), so a failure here is a
  // programming error, caught at startup rather than handed to the model.
  const inputSchema = ToolSchema.shape.inputSchema.safeParse(json);
  if (!inputSchema.success) throw new Error('owner_agent_tool_input_schema_invalid');
  return { name: tool.id, description: tool.description, inputSchema: inputSchema.data };
}

function codeOnly(code: OwnerAgentMcpErrorCode): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code }) }] };
}

export function createOwnerAgentMcpServer(granted: ReadonlySet<string>): Server {
  const tools = toolsForPermissions(granted);
  // Built once: a list is a pure function of the grant set, and building it
  // here makes a broken schema fail the process at startup.
  const listed = Object.values(tools).map(toMcpTool);

  const server = new Server(
    { name: OWNER_AGENT_MCP_SERVER, version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listed }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    // Object.hasOwn, not `tools[name]`: `constructor`, `toString` and
    // `__proto__` are reachable on any plain object and are not tools.
    const tool = Object.hasOwn(tools, name) ? tools[name as keyof typeof tools] : undefined;
    if (!tool) return codeOnly('unknown_tool');
    if (!tool.inputSchema || !tool.execute) return codeOnly('tool_failed');

    // The tool's own schema, before its execute ever runs: a rejected
    // argument never reaches a core or creates a client. (Mastra validates
    // again inside execute; that second check is kept, not relied on.)
    const checked = await tool.inputSchema['~standard'].validate(request.params.arguments ?? {});
    if (checked.issues) return codeOnly('invalid_input');

    try {
      const output = await (tool.execute as ExecuteWithoutAgent)(checked.value);
      // The core's result has already been through parseToolOutput (strip
      // unknown keys, throw a bare code on a wrong type) inside execute.
      // Mastra RETURNS a validation failure rather than throwing it, so it is
      // checked here, or it would be serialized as a successful result.
      // `undefined` would mean a tool that returned nothing — not a result.
      if (output === undefined || isValidationError(output)) return codeOnly('tool_failed');
      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    } catch {
      // The thrown error may carry SQL or a provider message; none of it
      // leaves. The tool id is ours, not the model's, so it is safe to log.
      console.error(`[owner-agent-mcp] tool_failed ${tool.id}`);
      return codeOnly('tool_failed');
    }
  });

  return server;
}
