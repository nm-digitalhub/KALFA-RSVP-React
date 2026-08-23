/**
 * Relocation wizard — privileged-command runner and file-mutation primitives.
 *
 * This module is the ONLY door the execution layer uses to touch the system:
 * every command goes through execFile (argv arrays, never a shell string),
 * elevation is `sudo -n` and happens only when the caller asks AND we are not
 * already root (design §2 writer identity — the wizard itself runs as the
 * app/vhost user; the engine refuses uid 0).
 *
 * Two safety properties callers rely on:
 * - `assertExecuteLatch()` — mutating functions across the execution layer
 *   refuse to run unless RELOCATE_EXECUTE === "1", which the CLI sets only on
 *   a real (non-dry-run) run. A stray import or a test can never mutate.
 * - Secret hygiene: error/report text renders argv through
 *   `describeCommand()`, which elides the indices the caller marked in
 *   `redactArgs`. Raw stdout/stderr are RETURNED to the caller (steps need
 *   them for verification) but never thrown inside Error messages.
 */
import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";

export class ExecuteLatchError extends Error {
  constructor(what: string) {
    super(
      `${what} refused: RELOCATE_EXECUTE is not "1" — system mutations run only inside a real (non-dry-run) wizard run.`,
    );
  }
}

/** The hard second latch (beyond plan-only apply()): the CLI sets
 * RELOCATE_EXECUTE=1 only when the operator approved a real run. */
export function assertExecuteLatch(what: string): void {
  if (process.env.RELOCATE_EXECUTE !== "1") throw new ExecuteLatchError(what);
}

/** Same elevation rule as preflight: sudo only exists as a concept when we are
 * NOT already root. */
function sudoAvailable(): boolean {
  return typeof process.getuid === "function" && process.getuid() !== 0;
}

export interface RunCommandOptions {
  cmd: string;
  args: string[];
  /** Elevate with `sudo -n` (only applied when not already root). */
  sudo?: boolean;
  timeoutMs?: number;
  cwd?: string;
  /** Written to the child's stdin, then stdin is closed. */
  input?: string;
  /** Indices into `args` whose VALUES must never appear in rendered text. */
  redactArgs?: number[];
  /** Streaming observer for long commands (deploy) — receives raw chunks. */
  onOutput?: (chunk: string) => void;
}

export interface RunCommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** Redaction-safe rendering of what ran — safe for state/logs/errors. */
  command: string;
}

/** The exact argv that will run — sudo -n prepended only when requested and
 * meaningful. Pure; exported for tests. */
export function buildArgv(opts: Pick<RunCommandOptions, "cmd" | "args" | "sudo">): {
  file: string;
  args: string[];
} {
  if (opts.sudo && sudoAvailable()) {
    return { file: "sudo", args: ["-n", opts.cmd, ...opts.args] };
  }
  return { file: opts.cmd, args: [...opts.args] };
}

/** Redaction-safe one-line rendering of the command. Pure; exported for tests. */
export function describeCommand(
  opts: Pick<RunCommandOptions, "cmd" | "args" | "sudo" | "redactArgs">,
): string {
  const redact = new Set(opts.redactArgs ?? []);
  const shown = opts.args.map((a, i) => (redact.has(i) ? "<redacted>" : a));
  const prefix = opts.sudo && sudoAvailable() ? "sudo -n " : "";
  return `${prefix}${opts.cmd} ${shown.join(" ")}`.trimEnd();
}

export function runCommand(opts: RunCommandOptions): Promise<RunCommandResult> {
  const { file, args } = buildArgv(opts);
  const command = describeCommand(opts);
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        timeout: opts.timeoutMs ?? 60_000,
        cwd: opts.cwd,
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const code = err
          ? ((err as NodeJS.ErrnoException & { code?: number | string }).code as
              | number
              | null
              | undefined)
          : 0;
        resolve({
          ok: !err,
          code: typeof code === "number" ? code : err ? null : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          command,
        });
      },
    );
    if (opts.onOutput) {
      child.stdout?.on("data", (chunk: Buffer | string) => opts.onOutput?.(String(chunk)));
      child.stderr?.on("data", (chunk: Buffer | string) => opts.onOutput?.(String(chunk)));
    }
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
}

/** Timestamp suffix matching the repo's existing convention
 * (beta-proxy.conf.bak-20260701-…). */
export function backupStamp(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** Timestamped sibling copy of an existing file. Throws when the target does
 * not exist — a caller expecting to back up a missing file has a logic bug
 * the engine must see, not silently skip. */
export function backupFile(path: string): { path: string; backupPath: string } {
  if (!existsSync(path)) {
    throw new Error(`cannot back up ${path}: file does not exist`);
  }
  const backupPath = `${path}.bak-${backupStamp()}`;
  copyFileSync(path, backupPath);
  return { path, backupPath };
}

/** Atomic write (temp + rename on the same directory) with a backup of any
 * existing file first. Preserves the existing file's mode unless overridden;
 * new files default to 0600. Returns the backup record for the engine's
 * rollback ledger (null when the file did not exist before). */
export function writeFileWithBackup(
  path: string,
  content: string,
  opts?: { mode?: number },
): { backup: { path: string; backupPath: string } | null } {
  let backup: { path: string; backupPath: string } | null = null;
  let mode = opts?.mode;
  if (existsSync(path)) {
    backup = backupFile(path);
    if (mode === undefined) mode = statSync(path).mode & 0o777;
  }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, { mode: mode ?? 0o600 });
  renameSync(tmp, path);
  return { backup };
}
