#!/usr/bin/env node
// pm2 entry point for kalfa-worker — NOT part of the esbuild bundle.
//
// Runs the bundle-integrity gate (scripts/check-worker-bundle.mjs) BEFORE
// loading dist/worker.cjs, so a stale/broken bundle is refused here too, not
// only when `npm run worker:build` happens to run. `npm run deploy` restarts
// by app name (`pm2 restart kalfa-worker`), which reuses whatever is already
// on disk without rebuilding; `pm2 resurrect` and a server reboot do the same.
// Pointing pm2 at this wrapper instead of dist/worker.cjs directly means the
// gate runs on EVERY one of those paths, closing the gap documented in
// scripts/check-worker-bundle.mjs's own header comment (2026-07-29/30: source
// was already fixed, but a stale bundle kept crash-looping for two days
// because nothing re-checked it between rebuilds).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const check = spawnSync(process.execPath, [join(root, 'scripts/check-worker-bundle.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (check.status !== 0) {
  process.exit(check.status ?? 1);
}

await import(join(root, 'dist/worker.cjs'));
