import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

// The owner agent's conversation history (plan §3.6, decided in 6b): the CLI's
// own sessions, continued with `--resume` when the same staff member's last
// exchange was recent. This file remembers, per staff member, which session
// that was:
//
//   <repo>/.fleet-logs/owner-agent/sessions.json   (0600, .fleet-logs/ is gitignored)
//   { "version": 1, "sessions": { "<staffUserId>": { sessionId, lastAt, permissions } } }
//
// Ids, a timestamp and permission KEYS only — never a question, an answer or a
// phone. The transcript itself is the CLI's session file (retention.ts).
//
// ⚠️ A SESSION IS RESUMED ONLY UNDER THE SAME PERMISSION SET. A resumed session
// replays its history, including earlier tool results. If a permission was
// revoked within the window, resuming would put numbers the staff member may
// no longer see back in front of the model — so the fingerprint of the
// resolved set is stored with the session and must match.
//
// Every read-modify-write runs on one in-process chain: the reply handler and
// the daily retention can run in the same process at the same time, and two
// interleaved rewrites of one JSON file would lose an entry.

export const RESUME_WINDOW_MS = 60 * 60 * 1000;

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const entrySchema = z.object({
  sessionId: z.string().regex(SESSION_ID),
  lastAt: z.number().int().nonnegative(),
  permissions: z.string(),
});
const fileSchema = z.object({
  version: z.literal(1),
  sessions: z.record(z.string(), entrySchema),
});
type SessionFile = z.infer<typeof fileSchema>;

export function sessionsFilePath(repoDir: string): string {
  return path.join(repoDir, '.fleet-logs/owner-agent/sessions.json');
}

/** Canonical form of a permission set: sorted, unique, comma-joined. */
export function permissionFingerprint(permissions: readonly string[]): string {
  return [...new Set(permissions)].sort().join(',');
}

export interface SessionMemory {
  /** The session to resume, or undefined for a fresh one. */
  resumable(staffUserId: string, nowMs: number, permissions: readonly string[]): Promise<string | undefined>;
  remember(staffUserId: string, sessionId: string, nowMs: number, permissions: readonly string[]): Promise<void>;
  forget(staffUserId: string): Promise<void>;
  /** Drop every entry whose session `isGone` reports; returns how many. */
  prune(isGone: (sessionId: string) => Promise<boolean>): Promise<number>;
}

export function createSessionMemory(file: string): SessionMemory {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const load = async (): Promise<SessionFile> => {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      return { version: 1, sessions: {} };
    }
    try {
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      // A corrupt or foreign file means no session is resumed — the next
      // answer starts fresh and rewrites it. Never a reason to fail an answer.
      return parsed.success ? parsed.data : { version: 1, sessions: {} };
    } catch {
      return { version: 1, sessions: {} };
    }
  };

  const save = async (data: SessionFile): Promise<void> => {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    // 0600 from the moment the file exists; rename keeps the mode and makes
    // the swap atomic, so a crash never leaves half a file.
    await writeFile(tmp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
    await rename(tmp, file);
  };

  return {
    resumable: (staffUserId, nowMs, permissions) =>
      serial(async () => {
        const entry = (await load()).sessions[staffUserId];
        if (!entry) return undefined;
        if (nowMs - entry.lastAt > RESUME_WINDOW_MS || nowMs < entry.lastAt) return undefined;
        if (entry.permissions !== permissionFingerprint(permissions)) return undefined;
        return entry.sessionId;
      }),

    remember: (staffUserId, sessionId, nowMs, permissions) =>
      serial(async () => {
        if (!SESSION_ID.test(sessionId)) return;
        const data = await load();
        data.sessions[staffUserId] = {
          sessionId,
          lastAt: nowMs,
          permissions: permissionFingerprint(permissions),
        };
        await save(data);
      }),

    forget: (staffUserId) =>
      serial(async () => {
        const data = await load();
        if (!(staffUserId in data.sessions)) return;
        delete data.sessions[staffUserId];
        await save(data);
      }),

    prune: (isGone) =>
      serial(async () => {
        const data = await load();
        let removed = 0;
        for (const [staffUserId, entry] of Object.entries(data.sessions)) {
          if (await isGone(entry.sessionId)) {
            delete data.sessions[staffUserId];
            removed += 1;
          }
        }
        if (removed > 0) await save(data);
        return removed;
      }),
  };
}
