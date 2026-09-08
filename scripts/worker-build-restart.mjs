#!/usr/bin/env node
// Deploy step for the pg-boss worker: rebuild dist/worker.cjs and restart
// pm2 `kalfa-worker` ONLY when the bundle actually changed.
//
// Why: `npm run deploy` used to run `worker:build && pm2 restart kalfa-worker`
// unconditionally. MEASURED 2026-09-08: 410 worker stops since 31.7 (~10.5 a
// day, 22 on a busy deploy day), each ~14s without a worker (12–14s of that is
// the startup handshake against the Supabase pooler), while most deploys touch
// only the web tier and leave the bundle byte-identical — esbuild's output is
// deterministic (two builds of the same tree → the same sha256).
//
// Contract:
//   - `npm run worker:build` still writes dist/worker.cjs and runs the
//     integrity gate (scripts/check-worker-bundle.mjs) — this script does not
//     duplicate either; it only hashes the artifact before and after.
//   - Restart when the hash differs, when there was no previous artifact, or
//     when pm2 reports kalfa-worker as not online (a stopped/errored worker
//     must come back on deploy regardless of the bundle).
//   - A changed `.env.local` does NOT trigger a restart here (env is read at
//     process start). That was already true of the old `pm2 restart` when the
//     bundle was unchanged in spirit; make it explicit: `pm2 restart
//     kalfa-worker` by hand after an env-only change.
//   - Exit code is that of the build or of pm2, so `npm run deploy`'s `&&`
//     chain stops on failure exactly as before.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const BUNDLE = 'dist/worker.cjs';
const APP = 'kalfa-worker';

function sha256(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function pm2Online(app) {
  const r = spawnSync('pm2', ['jlist'], { encoding: 'utf8' });
  if (r.status !== 0) return false;
  try {
    const list = JSON.parse(r.stdout);
    const proc = list.find((p) => p.name === app);
    return proc?.pm2_env?.status === 'online';
  } catch {
    return false;
  }
}

const before = sha256(BUNDLE);
// Same env guard the deploy script used for this step: the nested npm run must
// not inherit the outer npm's global-ignore-file setting.
run('npm', ['run', 'worker:build'], { env: { ...process.env, npm_config_global_ignore_file: undefined } });
const after = sha256(BUNDLE);

if (after === null) {
  console.error(`worker-build-restart: ${BUNDLE} missing after build`);
  process.exit(1);
}

const online = pm2Online(APP);
if (before === after && online) {
  console.log(`worker-build-restart: ${BUNDLE} unchanged (${after.slice(0, 12)}) and ${APP} online — no restart`);
  process.exit(0);
}

console.log(
  before === after
    ? `worker-build-restart: ${APP} is not online — restarting`
    : `worker-build-restart: ${BUNDLE} changed (${(before ?? 'none').slice(0, 12)} → ${after.slice(0, 12)}) — restarting ${APP}`,
);
run('pm2', ['restart', APP]);
