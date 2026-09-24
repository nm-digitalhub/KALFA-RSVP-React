import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { MAX_REPLY_PARTS } from './reply-text';
import {
  OWNER_AGENT_DB_POOL_MAX,
  OWNER_AGENT_MAX_TURNS,
  OWNER_AGENT_MODEL,
  OWNER_AGENT_PM2_KILL_TIMEOUT_MS,
  OWNER_AGENT_REPLY_EXPIRE_SECONDS,
  OWNER_AGENT_REPLY_MAX_MS,
  OWNER_AGENT_REPLY_QUEUE_POLICY,
  OWNER_AGENT_RESUME_FAIL_FAST_MS,
  OWNER_AGENT_RUN_KILL_AFTER_MS,
  OWNER_AGENT_RUN_TIMEOUT_MS,
  OWNER_AGENT_STOP_TIMEOUT_MS,
} from './budgets';

// The budget chain, asserted rather than trusted (budgets.ts header):
// one answer < job expiry < graceful stop < pm2 kill_timeout.

const require = createRequire(import.meta.url);
type Ecosystem = { apps: Array<{ name: string; kill_timeout?: number; script?: string; node_args?: string; env?: Record<string, string> }> };
const ROOT = path.join(import.meta.dirname, '../../../..');
const load = (file: string) => require(path.join(ROOT, file)) as Ecosystem;
const dedicated = load('ecosystem.owner-agent.config.cjs');
const app = dedicated.apps.find((a) => a.name === 'kalfa-owner-agent');

describe('the free-read budgets (free-read plan §3.5), pinned', () => {
  it('180s run, 12 turns, 5 reply parts; 15 + 180 + 10 + 50 = 255 < 300 < 310 < 330', () => {
    expect(OWNER_AGENT_RUN_TIMEOUT_MS).toBe(180_000);
    expect(OWNER_AGENT_MAX_TURNS).toBe(12);
    expect(OWNER_AGENT_MODEL).toBe('sonnet');
    expect(MAX_REPLY_PARTS).toBe(5);
    expect(OWNER_AGENT_REPLY_MAX_MS).toBe(255_000);
    expect(OWNER_AGENT_REPLY_EXPIRE_SECONDS).toBe(300);
    expect(OWNER_AGENT_STOP_TIMEOUT_MS).toBe(310_000);
    expect(OWNER_AGENT_PM2_KILL_TIMEOUT_MS).toBe(330_000);
  });
});

describe('the owner-agent budget chain', () => {
  it('one answer fits inside the job expiry', () => {
    expect(OWNER_AGENT_REPLY_MAX_MS).toBe(
      OWNER_AGENT_RESUME_FAIL_FAST_MS + OWNER_AGENT_RUN_TIMEOUT_MS + OWNER_AGENT_RUN_KILL_AFTER_MS + 50_000,
    );
    expect(OWNER_AGENT_REPLY_MAX_MS).toBeLessThan(OWNER_AGENT_REPLY_EXPIRE_SECONDS * 1000);
  });

  it('the queue policy carries that expiry', () => {
    expect(OWNER_AGENT_REPLY_QUEUE_POLICY.expireInSeconds).toBe(OWNER_AGENT_REPLY_EXPIRE_SECONDS);
  });

  it('a graceful stop outlasts the expiry', () => {
    expect(OWNER_AGENT_STOP_TIMEOUT_MS).toBeGreaterThan(OWNER_AGENT_REPLY_EXPIRE_SECONDS * 1000);
  });

  it('pm2 waits longer than the graceful stop — and the ecosystem entry says so', () => {
    expect(OWNER_AGENT_PM2_KILL_TIMEOUT_MS).toBeGreaterThan(OWNER_AGENT_STOP_TIMEOUT_MS);
    expect(app?.kill_timeout).toBe(OWNER_AGENT_PM2_KILL_TIMEOUT_MS);
  });

  it('the pm2 entry runs the bundle with its env file and Mastra telemetry off', () => {
    expect(app).toMatchObject({
      script: 'dist/owner-agent.cjs',
      node_args: '--env-file=.env.local',
      env: expect.objectContaining({ MASTRA_TELEMETRY_DISABLED: 'true', TZ: 'Asia/Jerusalem' }),
    });
  });
});

// Review 2026-09-24 (A): the consumer's first start must be impossible through
// a GENERIC start — the clean-restart recipe and the relocation wizard's I7
// both run `pm2 start ecosystem.config.cjs` with no --only.
describe('no generic pm2 start can start kalfa-owner-agent', () => {
  it('ecosystem.config.cjs does not define it', () => {
    const names = load('ecosystem.config.cjs').apps.map((a) => a.name);
    expect(names).toContain('kalfa-worker'); // the file loaded is the real one
    expect(names).not.toContain('kalfa-owner-agent');
  });

  it('its own file defines it and nothing else', () => {
    expect(dedicated.apps.map((a) => a.name)).toEqual(['kalfa-owner-agent']);
  });

  it('no other ecosystem file at the repository root defines it', () => {
    const files = readdirSync(ROOT).filter((f) => /^ecosystem.*\.c?js$/.test(f));
    expect(files).toContain('ecosystem.config.cjs');
    for (const file of files) {
      if (file === 'ecosystem.owner-agent.config.cjs') continue;
      expect(load(file).apps.map((a) => a.name), file).not.toContain('kalfa-owner-agent');
    }
  });
});

// Review 2026-09-24 (B): the role's ~15 session-mode slots are shared. The
// other pools are read from their own files, so a change there re-runs this.
describe('session-mode connection slots', () => {
  const poolMax = (file: string, pattern: RegExp) => {
    const m = pattern.exec(readFileSync(path.join(ROOT, file), 'utf8'));
    if (!m) throw new Error(`pool size not found in ${file}`);
    return Number(m[1]);
  };

  it('worker 8 + job-meta 2 + web sender 2 + this process leave at least one slot of 15', () => {
    const worker = poolMax('worker/main.ts', /application_name: 'kalfa-worker',[\s\S]*?\bmax: (\d+),/);
    const meta = poolMax('worker/pgboss-meta.ts', /\bmax: (\d+),/);
    const web = poolMax('src/lib/queue/web-sender.ts', /\bmax: (\d+),/);
    expect([worker, meta, web]).toEqual([8, 2, 2]);
    expect(OWNER_AGENT_DB_POOL_MAX).toBe(2);
    expect(worker + meta + web + OWNER_AGENT_DB_POOL_MAX).toBeLessThanOrEqual(14);
  });

  it('the consumer uses that constant, not a literal', () => {
    const main = readFileSync(path.join(import.meta.dirname, 'main.ts'), 'utf8');
    expect(main).toMatch(/max: OWNER_AGENT_DB_POOL_MAX,/);
  });
});
