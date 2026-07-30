#!/usr/bin/env node
// Fails the worker build if the bundle carries esbuild's `import.meta` shim.
//
// Why this exists: `worker/main.ts` is bundled to CommonJS. When ANY module in
// that graph reaches for `import.meta`, esbuild cannot express it in CJS, so it
// emits a stub —
//
//     var import_meta = {};
//     var req = (0, import_node_module.createRequire)(import_meta.url);
//
// — and `import_meta.url` is `undefined`. `createRequire(undefined)` throws
// ERR_INVALID_ARG_VALUE *during module load*, before any of the worker's own
// code runs. pm2 then restarts into a crash loop.
//
// The reason a check is needed at all is that NOTHING else catches it:
// `tsc --noEmit` is happy (the TypeScript is valid), ESLint is happy, the test
// suite never loads the bundle, and `npm run deploy` restarts pm2 without
// asking whether the artifact it just wrote can be loaded. Every gate passes on
// a dead artifact. This happened on 2026-07-29 and surfaced only because
// ops-monitor read the pm2 error log — three days after `worker/main.ts:449`
// had already been fixed in source, while a stale bundle stayed on disk.
//
// A load test would be the thorough check, but `require()`-ing this bundle
// STARTS the worker (main() runs at module load), which means connecting to
// pg-boss and subscribing to live queues. Verified the hard way: doing that
// briefly ran a second worker against production. A byte-level check on the
// artifact costs nothing and cannot have side effects.
//
// Node only, no dependency. Run via `npm run worker:build`.

import { readFileSync, statSync } from 'node:fs';

const BUNDLE = 'dist/worker.cjs';

// The exact string esbuild emits for the CJS stub, reproduced 2026-07-29
// against esbuild's own output rather than guessed from the error message.
const SHIM = 'var import_meta = {}';

// A bundle far below this is a truncated or failed build, not a small one:
// the real artifact is ~3.4MB. Catches a disk-full or interrupted esbuild that
// still exited 0.
const MIN_BYTES = 500_000;

let size;
try {
  size = statSync(BUNDLE).size;
} catch {
  console.error(`check-worker-bundle: ${BUNDLE} not found — the build did not produce an artifact`);
  process.exit(1);
}

if (size < MIN_BYTES) {
  console.error(
    `check-worker-bundle: ${BUNDLE} is ${size} bytes, below the ${MIN_BYTES} floor — truncated build`,
  );
  process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');
if (source.includes(SHIM)) {
  const line = source.slice(0, source.indexOf(SHIM)).split('\n').length;
  console.error(
    [
      `check-worker-bundle: ${BUNDLE}:${line} contains esbuild's import.meta stub.`,
      '',
      "  This artifact will throw ERR_INVALID_ARG_VALUE at load and pm2 will",
      '  restart it in a loop. Something in the worker graph uses `import.meta`',
      '  (usually `createRequire(import.meta.url)`), which has no CommonJS form.',
      '',
      '  Fix at the source: in a CJS bundle use `__filename` / `__dirname`, or',
      '  mark the offending dependency --external so it is required at runtime',
      '  instead of inlined. See worker/main.ts:449 for the precedent.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`check-worker-bundle: ${BUNDLE} ok (${(size / 1024 / 1024).toFixed(1)}MB, no import.meta stub)`);
