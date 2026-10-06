#!/usr/bin/env node
// Fails the owner-agent consumer build (dist/owner-agent.cjs, pm2
// kalfa-owner-agent) if the bundle carries esbuild's `import.meta` shim, looks
// truncated, or has swallowed the GA4 SDK. The consumer twin of
// scripts/check-owner-agent-mcp-bundle.mjs and scripts/check-worker-bundle.mjs
// — same checks, its own bounds.
//
// Why: pm2 runs this file directly (`node --env-file=.env.local
// dist/owner-agent.cjs`); tsc, ESLint and the tests never load it. A broken
// bundle would crash-loop silently, and every staff question would wait in the
// queue until the 24h window closed. scripts/owner-agent-build-restart.mjs
// runs this on the TEMP file, before it replaces the live one.
//
// Not a require() load test: requiring it starts pg-boss and subscribes to
// live queues (the worker check's measured reason, check-worker-bundle.mjs).
//
//   node scripts/check-owner-agent-bundle.mjs <file>
//
// Node only, no dependency. Run via `npm run owner-agent:build`.

import { readFileSync, statSync } from 'node:fs';

const BUNDLE = process.argv[2] ?? 'dist/owner-agent.cjs';

const SHIM = 'var import_meta = {}';

// Measured 2026-09-24: 3,742,116 bytes (pg-boss, pg, supabase-js, zod, the
// runner (without the MCP SDK), the Mastra tool modules the registry pulls in, the
// WhatsApp client). Far below the floor is a truncated build.
const MIN_BYTES = 1_500_000;

// The GA4 SDK's gRPC chain alone is ~4.7MB (protos.js); the build marks it
// --external. Bundling it would cross this ceiling.
const MAX_BYTES = 7_000_000;

const GA4_EXTERNAL = 'require("@google-analytics/data")';

let size;
try {
  size = statSync(BUNDLE).size;
} catch {
  console.error(`check-owner-agent-bundle: ${BUNDLE} not found — the build did not produce an artifact`);
  process.exit(1);
}

if (size < MIN_BYTES) {
  console.error(`check-owner-agent-bundle: ${BUNDLE} is ${size} bytes, below the ${MIN_BYTES} floor — truncated build`);
  process.exit(1);
}

if (size > MAX_BYTES) {
  console.error(
    `check-owner-agent-bundle: ${BUNDLE} is ${size} bytes, above the ${MAX_BYTES} ceiling — ` +
      'most likely @google-analytics/data was bundled instead of kept --external.',
  );
  process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');

if (source.includes(SHIM)) {
  const line = source.slice(0, source.indexOf(SHIM)).split('\n').length;
  console.error(
    [
      `check-owner-agent-bundle: ${BUNDLE}:${line} contains esbuild's import.meta stub.`,
      '',
      '  pm2 would crash-loop this process. Something in its graph now uses',
      '  `import.meta` (usually createRequire(import.meta.url)), which has no',
      '  CommonJS form. Use __filename/__dirname, or mark the offending',
      '  dependency --external so it is required at run time.',
    ].join('\n'),
  );
  process.exit(1);
}

if (!source.includes(GA4_EXTERNAL)) {
  console.error(
    `check-owner-agent-bundle: ${BUNDLE} does not require @google-analytics/data at run time — ` +
      'it was bundled or dropped; keep it --external (see ga4-client.ts).',
  );
  process.exit(1);
}

console.log(
  `check-owner-agent-bundle: ${BUNDLE} ok (${(size / 1024 / 1024).toFixed(1)}MB, no import.meta stub, GA4 external)`,
);
