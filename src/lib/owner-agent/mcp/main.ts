// Entry of dist/owner-agent-mcp.cjs (npm run owner-agent:mcp:build): the
// stdio MCP server `claude -p` spawns for the owner agent. The runner
// (../runner.ts) launches it as
//
//   <node> --env-file=<repo>/.env.local <repo>/dist/owner-agent-mcp.cjs
//
// with OWNER_AGENT_PERMISSIONS in its environment. The Supabase and GA4
// credentials come from --env-file, the same way the fleet CLI gets them, so
// no secret travels through the CLI's argv, its environment or the MCP config.

import { OWNER_AGENT_PERMISSIONS_ENV } from '@/lib/owner-agent/mcp/names';

// ⚠️ FIRST, BEFORE ANYTHING ELSE IS LOADED. stdout is the JSON-RPC channel: a
// single console.log from any module (a library warning, a debug line) would
// corrupt the stream and the CLI would drop the server. The server and its
// dependencies are loaded by the dynamic import below, which esbuild keeps
// lazy, so this redirect is in place before any of their code runs.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

// Whether the CLI hands its own environment to a stdio server is not
// something this repo verified (the 2.1.281 config schema has an `env` field,
// nothing says what it is merged with). If it does, the model's credential
// has no business in the data process.
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

async function main(): Promise<void> {
  const [{ createOwnerAgentMcpServer, parsePermissionsEnv }, { StdioServerTransport }] =
    await Promise.all([
      import('@/lib/owner-agent/mcp/server'),
      import('@modelcontextprotocol/sdk/server/stdio.js'),
    ]);

  const server = createOwnerAgentMcpServer(
    parsePermissionsEnv(process.env[OWNER_AGENT_PERMISSIONS_ENV]),
  );

  // The SDK's stdio transport does not watch for end of input (1.30.0
  // server/stdio.js listens for 'data' and 'error' only). When the CLI exits
  // — a normal end, or the runner's timeout — our stdin closes, and without
  // this the process would linger on whatever handles a client left open.
  process.stdin.once('end', () => process.exit(0));
  process.stdin.once('close', () => process.exit(0));

  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  // A code, not the error: a startup failure can carry a connection string.
  console.error('[owner-agent-mcp] startup_failed');
  process.exit(1);
});
