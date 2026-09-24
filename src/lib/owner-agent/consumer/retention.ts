import 'server-only';

import { lstat, readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { OwnerAgentPaths } from '@/lib/owner-agent/runner';

import type { SessionMemory } from './sessions';
import type { ReplyStore } from './store';

// Retention for the owner agent (plan §8 stage 8; decision 9.8, approved
// 2026-09-24): the question text in owner_agent_intake is kept 7 days, the
// agent's conversation history — the CLI's own session files — 14 days. Audit
// rows stay (ids and codes; intake_id is ON DELETE SET NULL).
//
// ⚠️ WHERE THE CLI KEEPS A SESSION — MEASURED in the installed 2.1.281 binary,
// not guessed:
//   transcript = join(projectsDir, projectDirName(originalCwd), `${sessionId}.jsonl`)
//   projectsDir = join(CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
//   projectDirName(cwd) = cwd.replace(/[^a-zA-Z0-9]/g, '-')  (`function k`), and
//     past 200 characters a hash suffix is added (`function uC`, lee=200) —
//     unless CLAUDE_CONFIG_DIR and CLAUDE_CODE_PROJECT_DIR_NAME override it.
// The runner sets HOME to the repo's parent and sets neither variable
// (runner.ts buildCliEnv, pinned by retention.test.ts), so for the dedicated
// cwd the directory is
//   /var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta--fleet-logs-owner-agent-cwd/
// The same rule names the directories already there: /var/www/vhosts/kalfa.me/beta
// is -var-www-vhosts-kalfa-me-beta (the fleet's and the owner's interactive
// sessions). A session is `<uuid>.jsonl` plus, sometimes, a `<uuid>/`
// directory (tool-results, subagents) that can hold tool output too.
//
// ⚠️ SCOPE IS THE WHOLE POINT. Every other directory under ~/.claude/projects
// belongs to the fleet or to interactive sessions. So:
//   - the directory is computed from the runner's own paths (ownerAgentPaths),
//     never searched for, and a name the hash rule would change is refused;
//   - the directory itself must be a real directory, not a symlink;
//   - inside it, only entries named exactly `<uuid>.jsonl` (a regular file)
//     or `<uuid>` (a directory) are considered; symlinks are skipped, and
//     anything else — `memory/`, a stray file — is left alone;
//   - a session goes as a unit, when its NEWEST part is older than 14 days.

export const INTAKE_TEXT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

// The CLI's own limit before it switches to a hashed name (2.1.281, lee=200).
const MAX_PLAIN_PROJECT_DIR_NAME = 200;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SESSION_FILE = new RegExp(`^(${UUID})\\.jsonl$`);
const SESSION_DIR = new RegExp(`^(${UUID})$`);

/** The CLI's project directory name for a working directory (see the header). */
export function claudeProjectDirName(cwd: string): string {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  // Past the limit the CLI appends a hash this module does not reproduce;
  // refusing is the only answer that cannot point at someone else's directory.
  if (name.length > MAX_PLAIN_PROJECT_DIR_NAME) throw new Error('owner_agent_project_dir_name_too_long');
  return name;
}

/** Where the CLI keeps the owner agent's sessions: $HOME/.claude/projects/<name of the dedicated cwd>. */
export function claudeProjectDir(paths: OwnerAgentPaths): string {
  return path.join(paths.hostDir, '.claude', 'projects', claudeProjectDirName(paths.cwd));
}

export interface RetentionDeps {
  store: Pick<ReplyStore, 'deleteIntakeReceivedBefore'>;
  sessions: Pick<SessionMemory, 'prune'>;
  paths: OwnerAgentPaths;
  now: () => number;
  log: (line: string) => void;
}

export interface RetentionResult {
  intakeDeleted: number;
  sessionsDeleted: number;
  stateEntriesRemoved: number;
}

export async function runOwnerAgentRetention(deps: RetentionDeps): Promise<RetentionResult> {
  const nowMs = deps.now();
  const intakeDeleted = await deps.store.deleteIntakeReceivedBefore(
    new Date(nowMs - INTAKE_TEXT_RETENTION_MS).toISOString(),
  );

  const dir = claudeProjectDir(deps.paths);
  const sessionsDeleted = await deleteOldSessions(dir, nowMs - SESSION_RETENTION_MS, deps.log);
  // A remembered session whose transcript is gone can no longer be resumed.
  const stateEntriesRemoved = await deps.sessions.prune(async (sessionId) => {
    try {
      await lstat(path.join(dir, `${sessionId}.jsonl`));
      return false;
    } catch {
      return true;
    }
  });

  deps.log(
    `[owner-agent] retention intake=${intakeDeleted} sessions=${sessionsDeleted} state=${stateEntriesRemoved}`,
  );
  return { intakeDeleted, sessionsDeleted, stateEntriesRemoved };
}

async function deleteOldSessions(dir: string, cutoffMs: number, log: (line: string) => void): Promise<number> {
  let root;
  try {
    root = await lstat(dir);
  } catch {
    return 0; // no session yet
  }
  if (root.isSymbolicLink() || !root.isDirectory()) {
    log('[owner-agent] retention project_dir_refused');
    return 0;
  }

  // Newest mtime per session id, over its .jsonl and its directory.
  const sessions = new Map<string, { newest: number; file: boolean; folder: boolean }>();
  for (const name of await readdir(dir)) {
    const asFile = SESSION_FILE.exec(name);
    const asDir = asFile ? null : SESSION_DIR.exec(name);
    const id = asFile?.[1] ?? asDir?.[1];
    if (!id) continue;
    const st = await lstat(path.join(dir, name));
    if (st.isSymbolicLink()) continue;
    if (asFile && !st.isFile()) continue;
    if (asDir && !st.isDirectory()) continue;
    const s = sessions.get(id) ?? { newest: 0, file: false, folder: false };
    s.newest = Math.max(s.newest, st.mtimeMs);
    if (asFile) s.file = true;
    else s.folder = true;
    sessions.set(id, s);
  }

  let deleted = 0;
  for (const [id, s] of sessions) {
    if (s.newest >= cutoffMs) continue;
    if (s.file) await unlink(path.join(dir, `${id}.jsonl`));
    // rm does not follow symlinks inside the tree; the directory itself was
    // lstat'ed above as a real directory.
    if (s.folder) await rm(path.join(dir, id), { recursive: true });
    deleted += 1;
  }
  return deleted;
}
