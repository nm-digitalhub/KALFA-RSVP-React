// Probe implementations for kalfa-ops-agent. Every external command runs via
// execFile with a FIXED argument list — never a shell string, never
// user-supplied input (this process takes no request body/query, only a
// fixed set of GET routes). See ops/agent.mjs for the HTTP wrapper.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 5_000;
const HOME = process.env.HOME ?? os.homedir();

async function run(cmd, args) {
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

async function readText(path) {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return null;
  }
}

// --- /probe/processes --------------------------------------------------

export async function probeProcesses(repoRoot) {
  // ecosystem.config.cjs is a plain CJS file (`module.exports = {...}`) — a
  // dynamic import() from ESM resolves module.exports as the default export,
  // no interop package needed. Node caches ESM imports per module URL for the
  // process lifetime, so a config edit needs a sidecar restart to be picked
  // up — the same requirement PM2 itself already imposes to apply the file.
  const [stdout, ecosystemModule] = await Promise.all([
    run('pm2', ['jlist']),
    import(join(repoRoot, 'ecosystem.config.cjs')),
  ]);
  const config = ecosystemModule.default;

  const declaredNames = new Set((config.apps ?? []).map((app) => app.name));

  const now = Date.now();
  const raw = JSON.parse(stdout);
  const pm2 = raw.map((p) => ({
    name: p.name,
    status: p.pm2_env?.status ?? 'unknown',
    restarts: p.pm2_env?.restart_time ?? 0,
    unstable: p.pm2_env?.unstable_restarts ?? 0,
    memMB: p.monit?.memory ? Math.round(p.monit.memory / 1048576) : null,
    cpu: p.monit?.cpu ?? null,
    uptimeSec: p.pm2_env?.pm_uptime ? Math.round((now - p.pm2_env.pm_uptime) / 1000) : null,
    cwd: p.pm2_env?.pm_cwd ?? null,
    script: p.pm2_env?.pm_exec_path ?? null,
  }));

  const runningNames = new Set(pm2.map((p) => p.name));
  const undeclared = pm2.filter((p) => !declaredNames.has(p.name)).map((p) => p.name);
  const missing = [...declaredNames].filter((name) => !runningNames.has(name));

  return { pm2, declared: [...declaredNames], undeclared, missing };
}

// --- /probe/system -------------------------------------------------------

async function dirSizeBytes(path) {
  if (!existsSync(path)) return null;
  try {
    const out = await run('du', ['-sb', path]);
    return Number(out.split('\t')[0]) || null;
  } catch {
    return null;
  }
}

function parseMeminfo(text) {
  const get = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const totalKb = get('MemTotal');
  const availKb = get('MemAvailable');
  const swapTotalKb = get('SwapTotal');
  const swapFreeKb = get('SwapFree');
  return {
    totalMB: totalKb ? Math.round(totalKb / 1024) : null,
    availMB: availKb ? Math.round(availKb / 1024) : null,
    pct: totalKb && availKb ? Math.round(((totalKb - availKb) / totalKb) * 100) : null,
    swapUsedMB:
      swapTotalKb != null && swapFreeKb != null ? Math.round((swapTotalKb - swapFreeKb) / 1024) : null,
  };
}

export async function probeSystem(repoRoot) {
  const [dfOut, meminfoText, drafts, pm2Logs] = await Promise.all([
    run('df', ['-PT', '/']),
    readText('/proc/meminfo'),
    dirSizeBytes(join(repoRoot, '.fleet-logs', 'drafts')),
    dirSizeBytes(join(HOME, '.pm2', 'logs')),
  ]);

  const dfLine = dfOut.trim().split('\n')[1]?.trim().split(/\s+/) ?? [];
  const [fsName, type, sizeKb, usedKb, availKb, pctStr] = dfLine;
  const disk = fsName
    ? {
        fs: fsName,
        type,
        sizeGB: Math.round(Number(sizeKb) / 1048576),
        usedGB: Math.round(Number(usedKb) / 1048576),
        availGB: Math.round(Number(availKb) / 1048576),
        pct: Number(pctStr?.replace('%', '')) || null,
      }
    : null;

  const mem = meminfoText ? parseMeminfo(meminfoText) : null;

  return {
    disk,
    mem,
    load: os.loadavg(),
    uptimeSec: Math.round(os.uptime()),
    nodeVersion: process.version,
    puppeteerCache: {
      chrome: existsSync(join(HOME, '.cache', 'puppeteer', 'chrome')),
      headlessShell: existsSync(join(HOME, '.cache', 'puppeteer', 'chrome-headless-shell')),
    },
    logsDirBytes: { fleetDrafts: drafts, pm2Logs },
  };
}

// --- /probe/deploy ---------------------------------------------------------

async function countLocalMigrations(repoRoot) {
  try {
    const files = await readdir(join(repoRoot, 'supabase', 'migrations'));
    return files.filter((f) => f.endsWith('.sql')).length;
  } catch {
    return null;
  }
}

export async function probeDeploy(repoRoot) {
  const [deployId, buildId, gitHead, gitOriginMain, counts, statusOut, localMigrationsCount] = await Promise.all([
    readText(join(repoRoot, '.deploy-id')),
    readText(join(repoRoot, '.next', 'BUILD_ID')),
    run('git', ['-C', repoRoot, 'rev-parse', 'HEAD']).then((s) => s.trim()).catch(() => null),
    run('git', ['-C', repoRoot, 'rev-parse', 'origin/main']).then((s) => s.trim()).catch(() => null),
    // Read-only, LOCAL refs only — deliberately never `git fetch` here (this
    // probe runs on every debug-page load; fetching on every load would spam
    // the remote and mutate local refs as a side effect of a read-only page).
    run('git', ['-C', repoRoot, 'rev-list', '--left-right', '--count', 'origin/main...HEAD'])
      .then((s) => s.trim().split(/\s+/).map(Number))
      .catch(() => [null, null]),
    run('git', ['-C', repoRoot, 'status', '--porcelain']).catch(() => ''),
    countLocalMigrations(repoRoot),
  ]);

  const [behind, ahead] = counts;
  const dirtyFiles = statusOut ? statusOut.split('\n').filter(Boolean).length : 0;

  // NOTE: localMigrationsCount is a FILE count only — it does not confirm the
  // linked Supabase project has applied all of them. That full cross-check
  // already exists (`supabase migration list --linked`, run from
  // scripts/kalfa-preflight.sh) and is deliberately NOT duplicated here: it
  // needs the Supabase CLI + network + an access token reachable from this
  // sidecar, which is out of scope for a lightweight read-only probe.
  return { deployId, buildId, gitHead, gitOriginMain, ahead, behind, dirtyFiles, localMigrationsCount };
}

// --- /probe/http -------------------------------------------------------

async function timedFetch(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(EXEC_TIMEOUT_MS),
      redirect: 'manual',
    });
    return { code: res.status, ms: Date.now() - start };
  } catch {
    return { code: null, ms: Date.now() - start };
  }
}

export async function probeHttp() {
  const [origin, edge] = await Promise.all([
    timedFetch('http://127.0.0.1:3002/'),
    timedFetch('https://beta.kalfa.me/'),
  ]);
  return { origin, edge };
}
