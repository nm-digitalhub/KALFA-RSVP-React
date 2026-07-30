#!/usr/bin/env node
// Fails the fleet-agent build if the bundle carries esbuild's `import.meta`
// shim, or if it looks truncated. Same reasoning as scripts/check-worker-
// bundle.mjs — copied structure deliberately, not reinvented.
//
// Why this exists: scheduler.mjs, run-context.sh, and main-inbox.sh all read
// dist/fleet-agent-cli.cjs directly off disk, with no build step of their
// own — `npm run fleet:agent` (build+run in one) is only ever invoked
// interactively. `npm run deploy` did not rebuild this artifact at all until
// this change; before that, the compiled file only ever advanced as a
// side-effect of someone running `npm run fleet:agent` by hand. Nothing else
// catches a broken bundle: `tsc --noEmit` is happy (the TypeScript is
// valid), ESLint is happy, the test suite never loads dist/*.cjs, and no gate
// in the deploy chain asks whether the artifact it just wrote can actually be
// loaded.
//
// fleet-agent-cli.ts does not use `import.meta` today — it uses
// `createRequire(__filename)` (see fleet-agent-cli.ts:127) for the same
// reason worker/main.ts had to be fixed to. This check exists so a FUTURE
// change that reintroduces it fails loudly at build time, not silently in a
// headless fleet run at 3am.
//
// Why not a require() load test, the thorough alternative: unlike the worker
// (require()-ing it starts pg-boss and subscribes to live queues — verified
// the hard way, see check-worker-bundle.mjs), this bundle ends with
// `main().catch(...)` at module scope. Requiring it with no argv reaches the
// CLI's own `default:` switch case, which calls `fail('usage: ...')` — and
// that calls `process.exit(1)`, killing the CHECKING process itself before it
// can report anything. A byte-level check is not just simpler here, it is the
// only way to check this artifact without side effects.
//
// Node only, no dependency. Run via `npm run fleet-agent:build`.

import { readFileSync, statSync } from 'node:fs';

const BUNDLE = 'dist/fleet-agent-cli.cjs';

// The exact string esbuild emits for the CJS import.meta stub — same
// constant as check-worker-bundle.mjs, reproduced against esbuild's own
// output rather than guessed from an error message.
const SHIM = 'var import_meta = {}';

// A bundle far below this is a truncated or failed build, not a small one:
// the real artifact is ~2.3MB (2,333,201 bytes, measured 2026-08-01). Catches
// a disk-full or interrupted esbuild that still exited 0.
const MIN_BYTES = 1_000_000;

let size;
try {
  size = statSync(BUNDLE).size;
} catch {
  console.error(`check-fleet-agent-bundle: ${BUNDLE} not found — the build did not produce an artifact`);
  process.exit(1);
}

if (size < MIN_BYTES) {
  console.error(
    `check-fleet-agent-bundle: ${BUNDLE} is ${size} bytes, below the ${MIN_BYTES} floor — truncated build`,
  );
  process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');
if (source.includes(SHIM)) {
  const line = source.slice(0, source.indexOf(SHIM)).split('\n').length;
  console.error(
    [
      `check-fleet-agent-bundle: ${BUNDLE}:${line} contains esbuild's import.meta stub.`,
      '',
      '  This artifact will throw ERR_INVALID_ARG_VALUE the moment scheduler.mjs,',
      '  run-context.sh, or main-inbox.sh next invoke it — headless, unattended,',
      '  no one watching. Something in the fleet-agent-cli graph now uses',
      '  `import.meta` (usually createRequire(import.meta.url)), which has no',
      '  CommonJS form.',
      '',
      '  Fix at the source: in a CJS bundle use `__filename` / `__dirname`',
      '  (see fleet-agent-cli.ts:127 for the existing precedent), or mark the',
      '  offending dependency --external so it is required at runtime instead',
      '  of inlined.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  `check-fleet-agent-bundle: ${BUNDLE} ok (${(size / 1024 / 1024).toFixed(1)}MB, no import.meta stub)`,
);
