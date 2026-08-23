/**
 * Relocation wizard — the pm2 process matrix as functions (plan Stage D.1).
 *
 * Hard rules encoded from ecosystem.config.cjs's own documentation:
 * - NEVER `pm2 restart --update-env` — the 2026-07-06 incident copied the
 *   deploying shell's environment into production. A test pins its absence.
 * - kalfa-fleet carries a deliberate INLINE APP_ORIGIN, so after the
 *   ecosystem rewrite it needs the documented clean cycle: delete → start
 *   from a SCRUBBED shell (env -i …) → pm2 save (otherwise a reboot
 *   resurrects the old definition from the stale dump).
 * - kalfa-beta / kalfa-worker / kalfa-ops-agent read .env.local fresh at boot
 *   — a plain restart is all they need.
 *
 * Every mutating function sits behind the RELOCATE_EXECUTE latch.
 */
import { assertExecuteLatch, runCommand, type RunCommandResult } from "./exec";

/** Processes that pick up .env.local at boot — plain restart suffices. */
export const PM2_APP_PROCESSES = ["kalfa-beta", "kalfa-worker", "kalfa-ops-agent"] as const;
export const PM2_FLEET_PROCESS = "kalfa-fleet";
export const SCRUBBED_PATH = "/usr/local/bin:/usr/bin:/bin";

/** Pure argv builders — exported so tests can pin their exact shape (and pin
 * that --update-env never appears anywhere in this module). */
export function restartAppArgv(): string[] {
  return ["pm2", "restart", ...PM2_APP_PROCESSES];
}

export function cleanRestartFleetPlan(home: string, user: string): string[][] {
  return [
    ["pm2", "delete", PM2_FLEET_PROCESS],
    [
      "env",
      "-i",
      `HOME=${home}`,
      `USER=${user}`,
      `PATH=${SCRUBBED_PATH}`,
      "pm2",
      "start",
      "ecosystem.config.cjs",
      "--only",
      PM2_FLEET_PROCESS,
    ],
    ["pm2", "save"],
  ];
}

export function deployArgv(): string[] {
  return ["npm", "run", "deploy"];
}

/** Plain restart of the .env.local-at-boot processes (never --update-env). */
export async function restartApp(): Promise<RunCommandResult> {
  assertExecuteLatch("pm2 restartApp");
  const [cmd, ...args] = restartAppArgv();
  return runCommand({ cmd, args, timeoutMs: 120_000 });
}

/** The documented one-time clean cycle for kalfa-fleet. Runs from the repo
 * root (ecosystem.config.cjs lives there). Stops at the first failing step —
 * a deleted-but-not-restarted fleet must surface loudly, not be papered over
 * by a pm2 save of the broken state. */
export async function cleanRestartFleet(opts: {
  repoRoot: string;
  home: string;
  user: string;
}): Promise<RunCommandResult[]> {
  assertExecuteLatch("pm2 cleanRestartFleet");
  const results: RunCommandResult[] = [];
  for (const [cmd, ...args] of cleanRestartFleetPlan(opts.home, opts.user)) {
    const res = await runCommand({ cmd, args, cwd: opts.repoRoot, timeoutMs: 120_000 });
    results.push(res);
    if (!res.ok) break;
  }
  return results;
}

/** Parse `pm2 env <id>` output (KEY: value lines) into a record. Values stay
 * in-process — callers compare, they do not log. Pure; exported for tests. */
export function parsePm2Env(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*): (.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Resolve a process name to its pm_id from `pm2 jlist` JSON. Pure. */
export function findPm2Id(jlistJson: string, name: string): number | null {
  try {
    const list = JSON.parse(jlistJson) as { name?: string; pm_id?: number }[];
    const proc = list.find((p) => p.name === name);
    return typeof proc?.pm_id === "number" ? proc.pm_id : null;
  } catch {
    return null;
  }
}

/** Effective environment of a RUNNING pm2 process — the Stage H check that
 * kalfa-fleet actually carries the new origin (a plain restart would not).
 * Read-only: no latch. */
export async function pm2Env(name: string): Promise<Record<string, string> | null> {
  const jlist = await runCommand({ cmd: "pm2", args: ["jlist"], timeoutMs: 30_000 });
  if (!jlist.ok) return null;
  const id = findPm2Id(jlist.stdout, name);
  if (id === null) return null;
  const env = await runCommand({ cmd: "pm2", args: ["env", String(id)], timeoutMs: 30_000 });
  return env.ok ? parsePm2Env(env.stdout) : null;
}

/** `npm run deploy` — the staged build + restart pipeline (rebuild REQUIRED on
 * an origin change: llms.txt/robots/sitemap/static metadata bake it). Long
 * timeout; output streams to the caller for live rendering. */
export async function deploy(
  repoRoot: string,
  onOutput?: (chunk: string) => void,
): Promise<RunCommandResult> {
  assertExecuteLatch("npm run deploy");
  const [cmd, ...args] = deployArgv();
  return runCommand({ cmd, args, cwd: repoRoot, timeoutMs: 15 * 60_000, onOutput });
}
