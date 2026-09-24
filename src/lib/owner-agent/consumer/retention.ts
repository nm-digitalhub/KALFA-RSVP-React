import 'server-only';

import { lstat, readdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { SlackAlertInput } from '@/lib/alerts/slack';
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
//
// ⚠️ A CHANGED PATH MUST NOT FAIL SILENTLY (review 2026-09-24). If a CLI
// upgrade moved the sessions, this directory would simply be empty: nothing to
// delete, and every remembered session "gone". So before the state file is
// touched, each session it remembers is checked: one that is neither in the
// directory nor deleted by this very run means the measured path no longer
// holds. Then ONE ids-only alert (session_path_missing) goes out and the state
// is left exactly as it is — the transcripts are somewhere this job cannot see,
// and 14-day retention of them is not happening until the path is re-measured.

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
  sessions: Pick<SessionMemory, 'prune' | 'remembered'>;
  paths: OwnerAgentPaths;
  now: () => number;
  log: (line: string) => void;
  alert: (input: SlackAlertInput) => Promise<unknown>;
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
  const deleted = await deleteOldSessions(dir, nowMs - SESSION_RETENTION_MS, deps.log);
  const sessionsDeleted = deleted.size;

  // Every remembered session must be accounted for: still in the directory, or
  // deleted just now. Anything else means the measured path no longer holds.
  let missing = 0;
  const remembered = await deps.sessions.remembered();
  for (const sessionId of remembered) {
    if (deleted.has(sessionId)) continue;
    if (!(await exists(path.join(dir, `${sessionId}.jsonl`)))) missing += 1;
  }

  let stateEntriesRemoved = 0;
  if (missing > 0) {
    deps.log(`[owner-agent] retention session_path_missing missing=${missing} remembered=${remembered.length}`);
    await deps.alert({
      level: 'error',
      category: 'errors',
      source: 'owner-agent',
      title: 'סוכן הבעלים — קבצי הסשן לא נמצאו בנתיב שנמדד',
      detail:
        'סשנים שהסוכן זוכר חסרים בתיקיית הפרויקט של ה-CLI, ולא נמחקו על ידי ה-retention. כנראה שהנתיב השתנה (למשל אחרי עדכון CLI). מחיקת השיחות אחרי 14 יום לא מתבצעת עד שהנתיב יימדד מחדש; קובץ המצב נשאר כמו שהוא.',
      fields: { code: 'session_path_missing', missing, remembered: remembered.length },
    });
  } else {
    // Only what this run deleted leaves the state file.
    stateEntriesRemoved = await deps.sessions.prune(async (sessionId) => deleted.has(sessionId));
  }

  deps.log(
    `[owner-agent] retention intake=${intakeDeleted} sessions=${sessionsDeleted} state=${stateEntriesRemoved}`,
  );
  return { intakeDeleted, sessionsDeleted, stateEntriesRemoved };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// The ids of the sessions deleted.
async function deleteOldSessions(dir: string, cutoffMs: number, log: (line: string) => void): Promise<Set<string>> {
  const deleted = new Set<string>();
  let root;
  try {
    root = await lstat(dir);
  } catch {
    return deleted; // no session yet — or, if sessions are remembered, a moved path (see the header)
  }
  if (root.isSymbolicLink() || !root.isDirectory()) {
    log('[owner-agent] retention project_dir_refused');
    return deleted;
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

  for (const [id, s] of sessions) {
    if (s.newest >= cutoffMs) continue;
    if (s.file) await unlink(path.join(dir, `${id}.jsonl`));
    // rm does not follow symlinks inside the tree; the directory itself was
    // lstat'ed above as a real directory.
    if (s.folder) await rm(path.join(dir, id), { recursive: true });
    deleted.add(id);
  }
  return deleted;
}
