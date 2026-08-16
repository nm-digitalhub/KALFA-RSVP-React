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
//
// It ALSO loads .env.local, and doing it HERE rather than inside the bundle is
// the whole point. main.ts calls its own loadEnv() from the module body, but a
// module body runs only after every import it depends on has already been
// evaluated — so any module that read process.env at its top level captured an
// empty string. That is not hypothetical: the Graph calendar sync failed
// silently in this process every 10 minutes, reporting auth_failed, while the
// exact same code worked under `node --env-file=`. Loading before the dynamic
// import below means no module anywhere has to remember to be careful.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Node's own loader (>=20.12) — not a hand-rolled parser. It leaves variables
// already present in the real environment untouched, which is what lets pm2's
// explicit env (NODE_ENV, TZ) win over the file.
try {
  process.loadEnvFile(join(root, '.env.local'));
} catch {
  // Absent or unreadable .env.local is legitimate: a deployment may inject
  // everything through the process environment instead.
}

const check = spawnSync(process.execPath, [join(root, 'scripts/check-worker-bundle.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (check.status !== 0) {
  process.exit(check.status ?? 1);
}

await import(join(root, 'dist/worker.cjs'));
