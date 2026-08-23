/**
 * Relocation wizard — state-file IO.
 *
 * The wizard CLI is the ONLY writer of `.relocation-state.json` (contract in
 * ./state.ts). Writes are atomic (temp file + rename on the same directory),
 * mode 0600, and every successful save first preserves the previous version as
 * `.relocation-state.json.bak`. Readers (the /admin data layer) treat every
 * failure here as a soft state, never a crash.
 *
 * Node-only module (fs/path) — imported by scripts/relocate/, never by app
 * request code.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  RELOCATE_DIR,
  RELOCATION_STATE_BACKUP_FILE,
  RELOCATION_STATE_FILE,
  parseRelocationState,
  type RelocationState,
} from "./state";

export type LoadStateResult =
  | { ok: true; state: RelocationState }
  | { ok: false; reason: "not-found" | "unreadable" | "invalid-schema" | "unsupported-version" };

export function statePath(repoRoot: string): string {
  return join(repoRoot, RELOCATION_STATE_FILE);
}

export function relocateDir(repoRoot: string): string {
  return join(repoRoot, RELOCATE_DIR);
}

export function ensureRelocateDir(repoRoot: string): string {
  const dir = relocateDir(repoRoot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function loadState(repoRoot: string): LoadStateResult {
  const file = statePath(repoRoot);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === "ENOENT" ? "not-found" : "unreadable" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const parsed = parseRelocationState(json);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return { ok: true, state: parsed.state };
}

/**
 * Persist a new version of the state: bumps `serial`, stamps `updatedAt`,
 * backs up the previous file, then atomically replaces it. Mutates and returns
 * the same object so callers keep a single in-memory instance.
 */
export function saveState(repoRoot: string, state: RelocationState): RelocationState {
  const file = statePath(repoRoot);
  state.serial += 1;
  state.updatedAt = new Date().toISOString();

  if (existsSync(file)) {
    copyFileSync(file, join(repoRoot, RELOCATION_STATE_BACKUP_FILE));
  }

  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  return state;
}

/** Remove a stale temp file left by a crashed writer (best effort). */
export function cleanupTempFiles(repoRoot: string): void {
  const tmp = `${statePath(repoRoot)}.tmp-${process.pid}`;
  try {
    rmSync(tmp, { force: true });
  } catch {
    /* best effort */
  }
}
