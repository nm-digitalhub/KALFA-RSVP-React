import 'server-only';

import { standardSchemaToJSONSchema } from '@mastra/core/schema';
import { isValidationError } from '@mastra/core/tools';
import { Server, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';

import { parsePermissionsEnv } from '@/lib/owner-agent/mcp/permissions';
import { toolsForPermissions, type OwnerAgentTool } from '@/lib/owner-agent/tools/registry';

type McpToolErrorCode = 'unknown_tool' | 'invalid_input' | 'tool_failed';
type ExecuteWithoutAgent = (input: unknown) => Promise<unknown>;

function toolError(code: McpToolErrorCode): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code }) }] };
}

function toMcpTool(tool: OwnerAgentTool): Tool {
  if (!tool.inputSchema) throw new Error('owner_agent_tool_without_input_schema');
  const inputSchema = ToolSchema.shape.inputSchema.safeParse(
    standardSchemaToJSONSchema(tool.inputSchema, { io: 'input' }),
  );
  if (!inputSchema.success) throw new Error('owner_agent_tool_input_schema_invalid');

  const annotations = ToolSchema.shape.annotations.safeParse(tool.mcp?.annotations);
  if (!annotations.success) throw new Error('owner_agent_tool_annotations_invalid');

  return {
    name: tool.id,
    description: tool.description,
    inputSchema: inputSchema.data as Tool['inputSchema'],
    ...(annotations.data ? { annotations: annotations.data } : {}),
  };
}

export function createMcpServer(
  granted: ReadonlySet<string> = parsePermissionsEnv(process.env.KALFA_MCP_PERMISSIONS),
): Server {
  const tools = toolsForPermissions(granted);
  const listed = Object.values(tools).map(toMcpTool);
  const server = new Server(
    { name: 'kalfa-owner-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler('tools/list', () => ({ tools: listed }));

  server.setRequestHandler('tools/call', async (request) => {
    const name = request.params.name;
    const tool = Object.hasOwn(tools, name) ? tools[name as keyof typeof tools] : undefined;
    if (!tool) return toolError('unknown_tool');

    if (!tool.inputSchema || !tool.execute) {
      return toolError('tool_failed');
    }

    const checked = await tool.inputSchema['~standard'].validate(request.params.arguments ?? {});
    if (checked.issues) return toolError('invalid_input');

    try {
      const output = await (tool.execute as ExecuteWithoutAgent)(checked.value);
      if (output === undefined || isValidationError(output)) return toolError('tool_failed');
      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    } catch {
      console.error(`[owner-http-mcp] tool_failed ${tool.id}`);
      return toolError('tool_failed');
    }
  });

  return server;
}
