import { McpServer } from '@modelcontextprotocol/server';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'kalfa-owner-mcp',
    version: '1.0.0',
  });

  server.registerTool(
    'get_campaigns_summary',
    {
      description: 'Fetch real-time marketing campaign data and conversions from Kalfa.me',
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: 'Campaign data mock output. Integrate your service here.',
        },
      ],
    })
  );

  server.registerTool(
    'generate_owner_report',
    {
      description: 'Trigger business report compilation for the system owner',
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: 'Report generated successfully. Integrate your service here.',
        },
      ],
    })
  );

  return server;
}
