#!/usr/bin/env node
// Fails the owner-agent MCP build if the bundle carries esbuild's
// `import.meta` shim, looks truncated, or has swallowed the GA4 SDK. Same
// structure as scripts/check-fleet-agent-bundle.mjs — copied deliberately,
// not reinvented.
//
// Why this exists: the runner (src/lib/owner-agent/runner.ts) never builds
// anything. It points `claude -p` at dist/owner-agent-mcp.cjs and the CLI
// spawns it as a stdio MCP server — headless, with nobody watching its
// stderr. A bundle that cannot load shows up only as `mcp_unavailable` on an
// owner's question. `tsc`, ESLint and the test suite never load dist/*.cjs.
//
// Why not a require() load test: requiring it starts the server, which reads
// stdin for JSON-RPC and never returns. The byte-level checks here are the
// side-effect-free part; the stage-6a verification drove the built file over
// stdio with the SDK's own client instead.
//
// The path is an argument so the same check runs on a scratch build:
//   node scripts/check-owner-agent-mcp-bundle.mjs <file>
//
// Node only, no dependency. Run via `npm run owner-agent:mcp:build`.

import { readFileSync, statSync } from 'node:fs';

const BUNDLE = process.argv[2] ?? 'dist/owner-agent-mcp.cjs';

// The exact string esbuild emits for the CJS import.meta stub — the same
// constant as check-worker-bundle.mjs and check-fleet-agent-bundle.mjs.
const SHIM = 'var import_meta = {}';

// Measured 2026-09-24: 2,731,644 bytes (zod, ajv, the MCP SDK, supabase-js,
// the Mastra tool and schema modules). Far below the floor is a truncated or
// failed build, not a small one.
const MIN_BYTES = 1_000_000;

// A ceiling, not just a floor. ga4-client.ts is the one file that imports
// @google-analytics/data, and its gRPC require chain must stay out of every
// esbuild bundle (protos.js alone is 4,684,376 bytes — see
// check-fleet-agent-bundle.mjs). The build marks it --external; dropping that
// flag would push this bundle past the ceiling.
const MAX_BYTES = 6_000_000;

// The proof that GA4 really is external: the bundle requires it by name at
// run time instead of carrying it.
const GA4_EXTERNAL = 'require("@google-analytics/data")';

let size;
try {
  size = statSync(BUNDLE).size;
} catch {
  console.error(`check-owner-agent-mcp-bundle: ${BUNDLE} not found — the build did not produce an artifact`);
  process.exit(1);
}

if (size < MIN_BYTES) {
  console.error(
    `check-owner-agent-mcp-bundle: ${BUNDLE} is ${size} bytes, below the ${MIN_BYTES} floor — truncated build`,
  );
  process.exit(1);
}

if (size > MAX_BYTES) {
  console.error(
    `check-owner-agent-mcp-bundle: ${BUNDLE} is ${size} bytes, above the ${MAX_BYTES} ceiling — ` +
      'most likely @google-analytics/data was bundled instead of kept --external.',
  );
  process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');

if (source.includes(SHIM)) {
  const line = source.slice(0, source.indexOf(SHIM)).split('\n').length;
  console.error(
    [
      `check-owner-agent-mcp-bundle: ${BUNDLE}:${line} contains esbuild's import.meta stub.`,
      '',
      '  The server would throw the moment the CLI spawns it. Something in its',
      '  graph now uses `import.meta` (usually createRequire(import.meta.url)),',
      '  which has no CommonJS form. Use __filename/__dirname, or mark the',
      '  offending dependency --external so it is required at run time.',
    ].join('\n'),
  );
  process.exit(1);
}

if (!source.includes(GA4_EXTERNAL)) {
  console.error(
    `check-owner-agent-mcp-bundle: ${BUNDLE} does not require @google-analytics/data at run time — ` +
      'it was bundled or dropped; keep it --external (see ga4-client.ts).',
  );
  process.exit(1);
}

console.log(
  `check-owner-agent-mcp-bundle: ${BUNDLE} ok (${(size / 1024 / 1024).toFixed(1)}MB, no import.meta stub, GA4 external)`,
);
