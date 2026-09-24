import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';
import type { createAdminClient } from '@/lib/supabase/admin';
import { buildCliEnv, ownerAgentPaths } from '@/lib/owner-agent/runner';

import {
  INTAKE_TEXT_RETENTION_MS,
  SESSION_RETENTION_MS,
  claudeProjectDir,
  claudeProjectDirName,
  runOwnerAgentRetention,
} from './retention';
import { createSessionMemory } from './sessions';
import { createReplyStore } from './store';

type AdminClient = ReturnType<typeof createAdminClient>;

const NOW = Date.parse('2026-09-24T01:15:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // old session: .jsonl + dir
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // recent session
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // old .jsonl, recently touched dir
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // old dir only
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; // symlink into the sibling
const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; // sibling's own old session
const STAFF_1 = '11111111-1111-4111-8111-111111111111';
const STAFF_2 = '22222222-2222-4222-8222-222222222222';

// ── The measured naming rule ──────────────────────────────────────────────────

describe('the CLI project directory (measured in 2.1.281)', () => {
  it('reproduces the name the CLI gave the directories already on this machine', () => {
    // ~/.claude/projects/-var-www-vhosts-kalfa-me-beta holds the sessions
    // started in /var/www/vhosts/kalfa.me/beta — '.' and '/' both become '-'.
    expect(claudeProjectDirName('/var/www/vhosts/kalfa.me/beta')).toBe('-var-www-vhosts-kalfa-me-beta');
    expect(claudeProjectDirName('/var/www/vhosts/kalfa.me/httpdocs/services/fleet-health-watcher')).toBe(
      '-var-www-vhosts-kalfa-me-httpdocs-services-fleet-health-watcher',
    );
  });

  it("the owner agent's directory, from the runner's own paths", () => {
    const paths = ownerAgentPaths('/var/www/vhosts/kalfa.me/beta');
    expect(claudeProjectDir(paths)).toBe(
      '/var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta--fleet-logs-owner-agent-cwd',
    );
  });

  it('a name the CLI would hash is refused, not guessed', () => {
    expect(() => claudeProjectDirName(`/${'x'.repeat(200)}`)).toThrow('owner_agent_project_dir_name_too_long');
  });

  it('coupling: the runner points the CLI at exactly that HOME and moves nothing', () => {
    const paths = ownerAgentPaths('/var/www/vhosts/kalfa.me/beta');
    const env = buildCliEnv(paths.hostDir, 'tok');
    expect(env.HOME).toBe(paths.hostDir);
    // Either of these would move the session directory away from the one
    // measured above (CLAUDE_CONFIG_DIR replaces ~/.claude; with it,
    // CLAUDE_CODE_PROJECT_DIR_NAME replaces the name).
    expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    expect(env).not.toHaveProperty('CLAUDE_CODE_PROJECT_DIR_NAME');
  });
});

// ── The run ───────────────────────────────────────────────────────────────────

let host: string;
beforeEach(() => {
  host = mkdtempSync(path.join(tmpdir(), 'owner-agent-retention-'));
});
afterEach(() => {
  rmSync(host, { recursive: true, force: true });
});

function touch(p: string, ageMs: number, content = '{}\n') {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  const t = (NOW - ageMs) / 1000;
  utimesSync(p, t, t);
}
function age(p: string, ageMs: number) {
  const t = (NOW - ageMs) / 1000;
  utimesSync(p, t, t);
}

// The fixture places the sessions by the measured rule written out HERE, not
// by claudeProjectDir(): a retention that pointed at the wrong directory must
// fail these tests, not move the fixture along with it.
const measuredName = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

function fixture() {
  const repo = path.join(host, 'beta');
  const paths = ownerAgentPaths(repo);
  const projects = path.join(host, '.claude', 'projects');
  const ours = path.join(projects, measuredName(path.join(repo, '.fleet-logs/owner-agent/cwd')));
  const sibling = path.join(projects, '-var-www-vhosts-kalfa-me-beta'); // the fleet's / interactive sessions

  // Ours.
  touch(path.join(ours, `${A}.jsonl`), 20 * DAY);
  touch(path.join(ours, A, 'tool-results', 'r1.txt'), 20 * DAY);
  age(path.join(ours, A, 'tool-results'), 20 * DAY);
  age(path.join(ours, A), 20 * DAY);
  touch(path.join(ours, `${B}.jsonl`), 1 * DAY);
  touch(path.join(ours, `${C}.jsonl`), 20 * DAY);
  touch(path.join(ours, C, 'subagents', 's.jsonl'), 1 * DAY);
  age(path.join(ours, C), 1 * DAY);
  touch(path.join(ours, D, 'tool-results', 'r.txt'), 20 * DAY);
  age(path.join(ours, D, 'tool-results'), 20 * DAY);
  age(path.join(ours, D), 20 * DAY);
  touch(path.join(ours, 'notes.jsonl'), 30 * DAY); // not a session name
  touch(path.join(ours, 'memory', 'MEMORY.md'), 30 * DAY);
  age(path.join(ours, 'memory'), 30 * DAY);

  // The sibling: must survive whatever happens in ours.
  touch(path.join(sibling, `${F}.jsonl`), 60 * DAY);
  touch(path.join(sibling, F, 'tool-results', 'x.txt'), 60 * DAY);
  age(path.join(sibling, F), 60 * DAY);
  // A symlink from ours into the sibling, named like an old session.
  symlinkSync(path.join(sibling, `${F}.jsonl`), path.join(ours, `${E}.jsonl`));
  symlinkSync(path.join(sibling, F), path.join(ours, E));

  return { repo, paths, ours, sibling };
}

function intakeRow(id: string, ageMs: number, status = 'answered'): TableRow {
  return { id, wamid: `w.${id}`, staff_user_id: STAFF_1, message_text: 'שאלה', status, received_at: iso(NOW - ageMs) };
}

async function run(paths: ReturnType<typeof ownerAgentPaths>, rows: TableRow[], sessionsFile: string) {
  const db = createFakeTableClient({ owner_agent_intake: rows, owner_agent_audit: [{ id: 'audit-1', intake_id: 'old' }] });
  const logs: string[] = [];
  const result = await runOwnerAgentRetention({
    store: createReplyStore(db.client as unknown as AdminClient),
    sessions: createSessionMemory(sessionsFile),
    paths,
    now: () => NOW,
    log: (l) => logs.push(l),
  });
  return { db, logs, result };
}

describe('runOwnerAgentRetention', () => {
  it('deletes intake rows older than 7 days — whatever their status — and nothing else', async () => {
    const { paths } = fixture();
    const { db, result } = await run(
      paths,
      [
        intakeRow('old', INTAKE_TEXT_RETENTION_MS + 60_000),
        intakeRow('old-queued', 9 * DAY, 'queued'),
        intakeRow('edge', INTAKE_TEXT_RETENTION_MS - 60_000),
        intakeRow('new', DAY),
      ],
      path.join(host, 'sessions.json'),
    );
    expect(result.intakeDeleted).toBe(2);
    expect(db.tables.owner_agent_intake.map((r) => r.id)).toEqual(['edge', 'new']);
    // Audit rows are not touched (in the database the FK sets intake_id null).
    expect(db.tables.owner_agent_audit).toHaveLength(1);
    const del = db.ops.find((o) => o.op === 'delete');
    expect(del?.filters).toEqual([['lt', 'received_at', iso(NOW - INTAKE_TEXT_RETENTION_MS)]]);
  });

  it('deletes only whole sessions older than 14 days, only in our directory, never through a symlink', async () => {
    const { paths, ours, sibling } = fixture();
    const { result } = await run(paths, [], path.join(host, 'sessions.json'));

    expect(result.sessionsDeleted).toBe(2); // A and D
    expect(existsSync(path.join(ours, `${A}.jsonl`))).toBe(false);
    expect(existsSync(path.join(ours, A))).toBe(false);
    expect(existsSync(path.join(ours, D))).toBe(false);
    // Recent sessions — including C, whose newest part is recent — stay whole.
    expect(existsSync(path.join(ours, `${B}.jsonl`))).toBe(true);
    expect(existsSync(path.join(ours, `${C}.jsonl`))).toBe(true);
    expect(existsSync(path.join(ours, C, 'subagents', 's.jsonl'))).toBe(true);
    // Not session-shaped: left alone, however old.
    expect(existsSync(path.join(ours, 'notes.jsonl'))).toBe(true);
    expect(existsSync(path.join(ours, 'memory', 'MEMORY.md'))).toBe(true);
    // The symlinks are skipped, and what they point at is untouched.
    expect(existsSync(path.join(ours, `${E}.jsonl`))).toBe(true);
    expect(existsSync(path.join(ours, E))).toBe(true);
    expect(readFileSync(path.join(sibling, `${F}.jsonl`), 'utf8')).toBe('{}\n');
    expect(existsSync(path.join(sibling, F, 'tool-results', 'x.txt'))).toBe(true);
  });

  it('a project directory that is a symlink is refused outright', async () => {
    const repo = path.join(host, 'beta');
    const paths = ownerAgentPaths(repo);
    const ours = claudeProjectDir(paths);
    const elsewhere = path.join(host, 'elsewhere');
    touch(path.join(elsewhere, `${A}.jsonl`), 60 * DAY);
    mkdirSync(path.dirname(ours), { recursive: true });
    symlinkSync(elsewhere, ours);

    const { result, logs } = await run(paths, [], path.join(host, 'sessions.json'));
    expect(result.sessionsDeleted).toBe(0);
    expect(existsSync(path.join(elsewhere, `${A}.jsonl`))).toBe(true);
    expect(logs).toContain('[owner-agent] retention project_dir_refused');
  });

  it('no session directory yet is not an error', async () => {
    const paths = ownerAgentPaths(path.join(host, 'beta'));
    const { result } = await run(paths, [], path.join(host, 'sessions.json'));
    expect(result.sessionsDeleted).toBe(0);
  });

  it('removes remembered sessions whose transcript is gone, and logs counts only', async () => {
    const { paths } = fixture();
    const file = path.join(host, 'sessions.json');
    const memory = createSessionMemory(file);
    await memory.remember(STAFF_1, A, NOW - 20 * DAY, ['view_events']);
    await memory.remember(STAFF_2, B, NOW - DAY, ['view_events']);

    const { result, logs } = await run(paths, [], file);
    expect(result.stateEntriesRemoved).toBe(1);
    const state = JSON.parse(readFileSync(file, 'utf8')) as { sessions: Record<string, unknown> };
    expect(Object.keys(state.sessions)).toEqual([STAFF_2]);
    expect(logs).toEqual(['[owner-agent] retention intake=0 sessions=2 state=1']);
  });

  it('the constants are the owner\'s decision 9.8: 7 and 14 days', () => {
    expect(INTAKE_TEXT_RETENTION_MS).toBe(7 * DAY);
    expect(SESSION_RETENTION_MS).toBe(14 * DAY);
  });
});
