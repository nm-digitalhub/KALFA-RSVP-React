/**
 * Relocation wizard — origin rewrites in the two env locations (plan Stage D1).
 *
 * `.env.local` carries TWO origin-bearing keys (verified 2026-08-23):
 * APP_ORIGIN (the single origin knob) and PGBOSS_DASHBOARD_URL (origin +
 * path). `ecosystem.config.cjs` carries a DELIBERATE inline duplicate of
 * APP_ORIGIN for kalfa-fleet (its comment explains why it must stay) — the
 * wizard rewrites BOTH, per plan §3 #3.
 *
 * The pure rewriters preserve every untouched line byte-for-byte, comments
 * included — the env file doubles as documentation and a diff there must show
 * exactly the value swaps and nothing else. Values never appear in errors.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertExecuteLatch, writeFileWithBackup } from "./exec";

export interface EnvRewriteResult {
  content: string;
  /** Keys actually rewritten, in file order. */
  rewritten: string[];
}

/** Swap the origin in `.env.local` content. APP_ORIGIN gets the new origin
 * verbatim; PGBOSS_DASHBOARD_URL keeps its path/query and swaps scheme+host.
 * Anything after the value (inline comment, trailing spaces) is preserved.
 * Pure; exported for tests. */
export function rewriteEnvContent(content: string, newOrigin: string): EnvRewriteResult {
  const rewritten: string[] = [];
  const lines = content.split("\n").map((line) => {
    const appOrigin = line.match(/^(APP_ORIGIN=)([^\s#]*)(.*)$/);
    if (appOrigin) {
      rewritten.push("APP_ORIGIN");
      return `${appOrigin[1]}${newOrigin}${appOrigin[3]}`;
    }
    const pgboss = line.match(/^(PGBOSS_DASHBOARD_URL=)([^\s#]*)(.*)$/);
    if (pgboss?.[2]) {
      try {
        const old = new URL(pgboss[2]);
        rewritten.push("PGBOSS_DASHBOARD_URL");
        return `${pgboss[1]}${newOrigin}${old.pathname}${old.search}${pgboss[3]}`;
      } catch {
        return line; // unparseable value: leave untouched, report by omission
      }
    }
    return line;
  });
  return { content: lines.join("\n"), rewritten };
}

/** Swap the inline kalfa-fleet APP_ORIGIN in `ecosystem.config.cjs`. The
 * match must be EXACTLY one line — zero means the file's shape drifted, more
 * than one means the regex would touch something unintended; both halt the
 * run rather than guess. Pure; exported for tests. */
export function rewriteEcosystemContent(content: string, newOrigin: string): string {
  const re = /^(\s*APP_ORIGIN:\s*')[^']*(',?\s*)$/gm;
  const matches = content.match(re) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `ecosystem.config.cjs: expected exactly one inline APP_ORIGIN line, found ${matches.length} — refusing to rewrite`,
    );
  }
  return content.replace(re, `$1${newOrigin}$2`);
}

export interface FileRewriteOutcome {
  backups: { path: string; backupPath: string }[];
  rewritten: string[];
}

/** Rewrite `.env.local` on disk (backup + atomic replace, mode preserved).
 * APP_ORIGIN must exist — an env file without it is not this app's env file. */
export function rewriteOriginKeys(opts: {
  repoRoot: string;
  newOrigin: string;
}): FileRewriteOutcome {
  assertExecuteLatch("rewriteOriginKeys(.env.local)");
  const path = join(opts.repoRoot, ".env.local");
  const original = readFileSync(path, "utf8");
  const { content, rewritten } = rewriteEnvContent(original, opts.newOrigin);
  if (!rewritten.includes("APP_ORIGIN")) {
    throw new Error(".env.local has no APP_ORIGIN line — refusing to rewrite");
  }
  const { backup } = writeFileWithBackup(path, content);
  return { backups: backup ? [backup] : [], rewritten };
}

/** Rewrite the deliberate inline duplicate in `ecosystem.config.cjs` (plan
 * Stage D1 — reaches the process only via the documented clean restart). */
export function rewriteEcosystemOrigin(opts: {
  repoRoot: string;
  newOrigin: string;
}): FileRewriteOutcome {
  assertExecuteLatch("rewriteEcosystemOrigin(ecosystem.config.cjs)");
  const path = join(opts.repoRoot, "ecosystem.config.cjs");
  const original = readFileSync(path, "utf8");
  const content = rewriteEcosystemContent(original, opts.newOrigin);
  const { backup } = writeFileWithBackup(path, content);
  return { backups: backup ? [backup] : [], rewritten: ["APP_ORIGIN (ecosystem inline)"] };
}
