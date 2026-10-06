#!/usr/bin/env node
// Deploy step for the owner WhatsApp agent (plans/owner-whatsapp-agent-plan.md
// §8 stage 6b): build BOTH owner-agent bundles, swap them in atomically, and
// restart pm2 `kalfa-owner-agent` the way scripts/worker-build-restart.mjs
// restarts the worker — only when its bundle changed or it is not online.
//
//   dist/owner-agent-mcp.cjs  the stdio MCP server `claude -p` spawns per
//                             question (npm run owner-agent:mcp:build)
//   dist/owner-agent.cjs      the consumer pm2 runs (npm run owner-agent:build)
//
// BUILD TO A TEMP FILE → CHECK → RENAME. Each npm script takes its outfile from
// an env var (OWNER_AGENT_MCP_OUT / OWNER_AGENT_OUT, defaulting to dist/) and
// runs its bundle check on that same file, so the flags live in package.json
// alone. The temp file sits in dist/ itself, so the rename is atomic: a
// question that spawns the MCP server mid-deploy gets the old file or the new
// one, never half of one — which a build straight into dist/ could not promise.
// A failed build or check exits non-zero and fails `npm run deploy`, with the
// live file untouched.
//
// RESTART POLICY (stated, not inherited by accident):
//   - app not registered in pm2 → NOT started. The first start is a go-live
//     decision (the chosen number and the switch decide whom it answers), so
//     this prints the one-time command from ecosystem.owner-agent.config.cjs
//     and exits 0 —
//     a deploy never fails because the agent was not started yet;
//   - registered and online, consumer bundle unchanged → no restart (a changed
//     MCP bundle needs none: the next question spawns the new file);
//   - registered and online, consumer bundle changed → `pm2 restart`;
//   - registered but not online (stopped, errored) → `pm2 restart`, as the
//     worker script does. The process-level off switch is
//     app_settings.owner_agent_enabled in /admin, not `pm2 stop`: a stopped
//     consumer does not stop the route from diverting the owner's messages.
//   Plain `pm2 restart`, never --update-env (ecosystem.config.cjs header).
//
// --no-pm2: build, check and swap only, then print the decision it would take.
// --out-dir=<dir>: build and swap in <dir> instead of dist/. Together they prove
// the script against a scratch directory without touching dist/ or pm2.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const APP = 'kalfa-owner-agent';
const NO_PM2 = process.argv.includes('--no-pm2');
const OUT_DIR = process.argv.find((a) => a.startsWith('--out-dir='))?.slice('--out-dir='.length) || 'dist';
const CONSUMER = join(OUT_DIR, 'owner-agent.cjs');

const BUNDLES = [
  { script: 'owner-agent:mcp:build', outVar: 'OWNER_AGENT_MCP_OUT', file: join(OUT_DIR, 'owner-agent-mcp.cjs') },
  { script: 'owner-agent:build', outVar: 'OWNER_AGENT_OUT', file: CONSUMER },
];

const FIRST_START = [
  `owner-agent-build-restart: ${APP} is not registered in pm2 — NOT started (first start is a go-live step).`,
  '  One-time start, from a scrubbed shell (ecosystem.owner-agent.config.cjs header), with the agent switch OFF:',
  '    env -i HOME="$HOME" USER="$USER" PATH=/usr/local/bin:/usr/bin:/bin \\',
  '      pm2 start ecosystem.owner-agent.config.cjs',
  '    pm2 save',
].join('\n');

function sha256(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}

// Build one bundle into a temp file next to its target, then rename it over the
// target. Returns whether the bytes changed.
function buildAndSwap({ script, outVar, file }) {
  const tmp = `${file}.tmp-${process.pid}`;
  const r = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    // Same guard as the worker step: the nested npm must not inherit the outer
    // npm's global-ignore-file setting.
    env: { ...process.env, npm_config_global_ignore_file: undefined, [outVar]: tmp },
  });
  if (r.status !== 0) {
    rmSync(tmp, { force: true });
    console.error(`owner-agent-build-restart: ${script} failed — ${file} left as it was`);
    process.exit(r.status ?? 1);
  }
  const before = sha256(file);
  const after = sha256(tmp);
  if (after === null) {
    console.error(`owner-agent-build-restart: ${tmp} missing after ${script}`);
    process.exit(1);
  }
  renameSync(tmp, file);
  return before !== after;
}

// 'online' | 'not-online' | 'absent' | 'unknown'
function pm2State(app) {
  const r = spawnSync('pm2', ['jlist'], { encoding: 'utf8' });
  if (r.status !== 0) return 'unknown';
  try {
    const proc = JSON.parse(r.stdout).find((p) => p.name === app);
    if (!proc) return 'absent';
    return proc.pm2_env?.status === 'online' ? 'online' : 'not-online';
  } catch {
    return 'unknown';
  }
}

const changed = BUNDLES.map((b) => ({ file: b.file, changed: buildAndSwap(b) }));
for (const c of changed) {
  console.log(`owner-agent-build-restart: ${c.file} ${c.changed ? 'changed' : 'unchanged'}`);
}
const consumerChanged = changed.find((c) => c.file === CONSUMER)?.changed === true;

if (NO_PM2) {
  console.log(
    `owner-agent-build-restart: --no-pm2 — would ${consumerChanged ? 'restart' : 'not restart'} ${APP} if it is online ` +
      '(restart if it is registered but not online; nothing if it is not registered)',
  );
  process.exit(0);
}

const state = pm2State(APP);
if (state === 'absent') {
  console.log(FIRST_START);
  process.exit(0);
}
if (state === 'unknown') {
  // pm2 itself did not answer. Failing the deploy here would be louder than
  // the problem: the bundles are in place, and the next deploy or a manual
  // `pm2 restart kalfa-owner-agent` picks them up.
  console.error(`owner-agent-build-restart: pm2 jlist failed — ${APP} not restarted; restart it by hand if it runs`);
  process.exit(0);
}
if (state === 'online' && !consumerChanged) {
  console.log(`owner-agent-build-restart: consumer unchanged and ${APP} online — no restart`);
  process.exit(0);
}

console.log(
  state === 'online'
    ? `owner-agent-build-restart: consumer bundle changed — restarting ${APP}`
    : `owner-agent-build-restart: ${APP} is not online — restarting`,
);
const r = spawnSync('pm2', ['restart', APP], { stdio: 'inherit' });
process.exit(r.status ?? 1);
