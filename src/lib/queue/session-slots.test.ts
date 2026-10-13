import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// The Supabase session pooler (port 5432) gives the database role a fixed number
// of client slots. EVERY process that holds a session-mode connection draws from
// that one number, so the arithmetic lives here, in one test, instead of being
// repeated in each holder's file. The sizes are READ from the holders' source —
// not copied — so a change in any of them re-runs this.
//
// What counts, and why:
//   permanent  slots held for the life of the process (a pool counts at its max,
//              the worst case; a long-lived client counts 1)
//   transient  slots a process opens for one short task and closes (the callback
//              scheduling lock opens one per sweep tick)
//   headroom   what is left for everything NOT in this file: an operator's psql,
//              a one-off script, a CLI that connects to the pooler.
// Transaction mode (port 6543) is a separate pool and is not counted: the fleet
// SQL door (scripts/fleet-agent-cli.ts) lives there.

const ROOT = path.join(import.meta.dirname, '../../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

// The role's session-mode "Pool Size". NOT read from a file: it is a setting of
// the Supabase project (Dashboard → Database → Settings → Connection pooling).
// Verified 2026-10-13 two independent ways: (1) the pooler's own error text
// quotes it — "(EMAXCONNSESSION) max clients reached in session mode - max
// clients are limited to pool_size: 15" — in all 127 occurrences in the pm2 logs,
// the latest on 2026-09-08; (2) the Management API
// (GET /v1/projects/{ref}/config/database/pooler) reports default_pool_size
// null, i.e. never overridden. If the setting is ever changed, change this too.
const SESSION_POOL_SIZE = 15;

// Slots that must stay free after every permanent holder is at its maximum.
const MIN_HEADROOM = 3;
// Of that headroom, what the transient holders may use at once; the rest is for
// the operator.
const MIN_OPERATOR_RESERVE = 2;

const poolMax = (file: string, pattern: RegExp) => {
  const m = pattern.exec(read(file));
  if (!m) throw new Error(`pool size not found in ${file}`);
  return Number(m[1]);
};
const occurrences = (file: string, text: string) => read(file).split(text).length - 1;

type Holder = { name: string; slots: number; permanent: boolean };

const holders = (): Holder[] => [
  {
    name: 'worker pg-boss pool',
    slots: poolMax('worker/main.ts', /application_name: 'kalfa-worker',[\s\S]*?\bmax: (\d+),/),
    permanent: true,
  },
  {
    // The LISTEN client for callback requests: idle by nature, never closed.
    name: 'worker LISTEN client',
    slots: occurrences('worker/main.ts', "application_name: 'kalfa-worker-listen'"),
    permanent: true,
  },
  {
    name: 'web sender',
    slots: poolMax('src/lib/queue/web-sender.ts', /\bmax: (\d+),/),
    permanent: true,
  },
  {
    name: 'owner agent',
    slots: poolMax('src/lib/owner-agent/consumer/budgets.ts', /export const OWNER_AGENT_DB_POOL_MAX = (\d+);/),
    permanent: true,
  },
  {
    // One client per sweep tick, closed in `finally` (worker/main.ts).
    name: 'worker callback scheduling lock',
    slots: occurrences('worker/main.ts', "application_name: 'kalfa-worker-callback-lock'"),
    permanent: false,
  },
];

const sum = (hs: Holder[]) => hs.reduce((n, h) => n + h.slots, 0);

describe('session-mode connection slots', () => {
  it('reads the sizes it claims: worker 8, LISTEN 1, web sender 1, owner agent 2, callback lock 1', () => {
    expect(holders().map((h) => [h.name, h.slots])).toEqual([
      ['worker pg-boss pool', 8],
      ['worker LISTEN client', 1],
      ['web sender', 1],
      ['owner agent', 2],
      ['worker callback scheduling lock', 1],
    ]);
  });

  it(`permanent holders leave at least ${MIN_HEADROOM} of ${SESSION_POOL_SIZE} slots free`, () => {
    const permanent = sum(holders().filter((h) => h.permanent));
    expect(SESSION_POOL_SIZE - permanent).toBeGreaterThanOrEqual(MIN_HEADROOM);
  });

  it(`the transient holders still leave ${MIN_OPERATOR_RESERVE} slots for an operator`, () => {
    const all = holders();
    const free = SESSION_POOL_SIZE - sum(all.filter((h) => h.permanent));
    const transient = sum(all.filter((h) => !h.permanent));
    expect(free - transient).toBeGreaterThanOrEqual(MIN_OPERATOR_RESERVE);
  });

  // A holder this file does not know about is exactly how the budget silently
  // overflows (the worker's LISTEN client was never in the old arithmetic: 8 + 2
  // + 2 + 2 = 14 left no room for it or for the callback lock, which together
  // would have made 16 of 15). Every non-test source file that reads the
  // database host must be named here, and a new one fails this test until
  // someone decides how many slots it takes.
  it('every source file that opens a database connection is accounted for', () => {
    const walk = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) return walk(rel);
        return /\.tsx?$/.test(e.name) && !/\.(test|integration\.test)\.tsx?$/.test(e.name) ? [rel] : [];
      });
    const readers = [...walk('src'), ...walk('worker')].filter((f) => read(f).includes('SUPABASE_DB_HOST'));

    expect(readers.sort()).toEqual(
      [
        'src/lib/owner-agent/consumer/main.ts', // the owner agent's pool
        'src/lib/queue/web-sender.ts', // the web sender
        'worker/main.ts', // the worker: pool, LISTEN client, callback lock
        // Not holders: a guard that only reads the host to refuse production, and
        // the relocation wizard's one-shot connection probe, run by an operator.
        'src/lib/outreach/test-db-guard.ts',
        'src/lib/relocation/env-validation.ts',
      ].sort(),
    );
  });
});

// The ops dashboard (@pg-boss/dashboard, run by pm2 as kalfa-pgboss-ui) builds its
// pg-boss pool without a max, so pg-pool's default of 10 applies. On the session
// pooler that is up to 10 of the role's 15 slots while it serves pages (idle
// connections close after 10 s) — on top of the 12 permanent holders above. It
// must therefore not be on port 5432. The bind config lives outside the
// repository (named by ecosystem.config.cjs), so this checks it where the file
// exists.
describe('the pg-boss dashboard stays off the session pooler', () => {
  type App = { name: string; node_args?: string };
  const require = createRequire(import.meta.url);
  const app = (require(path.join(ROOT, 'ecosystem.config.cjs')) as { apps: App[] }).apps.find(
    (a) => a.name === 'kalfa-pgboss-ui',
  );
  const envFile = /--env-file=(\S+)/.exec(app?.node_args ?? '')?.[1];

  it.skipIf(!app || !envFile || !existsSync(envFile))(
    'its DATABASE_URL uses the transaction-mode port (6543)',
    () => {
      const line = readFileSync(envFile!, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('DATABASE_URL='));
      // Only the port is compared, so a failure never prints the connection string.
      const port = line ? new URL(line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')).port : null;
      expect({ dashboardPort: port }).toEqual({ dashboardPort: '6543' });
    },
  );
});
