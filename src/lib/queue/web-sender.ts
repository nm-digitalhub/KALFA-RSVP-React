import 'server-only';

import { PgBoss, type ConstructorOptions } from 'pg-boss';

import { reportPgBossError } from '@/lib/alerts/pg-boss-alert';

// The web tier's SEND-ONLY pg-boss connection.
//
// One shared copy: a second hand-written copy of a connection whose flags are
// this load-bearing is exactly the kind of thing that drifts.
//
// Same connection as the worker (worker/main.ts) but with supervise + schedule
// OFF, so a request never runs maintenance or fires cron — it only calls
// .send(). Module singleton: connect once per server process.

// The options of that one connection, as a function of the environment so a test
// can read them (and point them at a local database) without opening anything.
export function webSenderOptions(env: Record<string, string | undefined> = process.env): ConstructorOptions {
  return {
    host: env.SUPABASE_DB_HOST,
    port: Number(env.SUPABASE_DB_PORT || 5432),
    user: env.SUPABASE_DB_USER,
    password: env.SUPABASE_DB_PASSWORD,
    database: env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    schema: 'pgboss',
    application_name: 'kalfa-web-sender',
    // One connection, not two: this process only ever calls .send(), one INSERT
    // per call, and the role's session-mode pooler slots are shared with the
    // worker and the owner agent (budgets.test.ts holds the arithmetic). The cost
    // is that sends are serialised — one per round trip to the pooler, ~130 ms
    // measured, so about 7 a second; pg-pool queues the rest instead of failing.
    max: 1,
    // Bounds a NEW connection (TCP + TLS + startup) and the wait for the free
    // slot to 20 s — the worker's and the owner agent's pools use the same
    // value. Without it a call can wait indefinitely. It does NOT bound a read
    // on a connection that has already died (that surfaces as `read ETIMEDOUT`,
    // minutes later, from the kernel).
    connectionTimeoutMillis: 20_000,
    supervise: false,
    schedule: false,
    // The load-bearing flag. pg-boss defaults migrate to TRUE, and start()
    // branches on it: migrate -> contractor.start() (creates the schema if
    // absent, migrates it if older), otherwise contractor.check() (verifies
    // only, and THROWS on a missing or mismatched schema).
    //
    // Without this the web tier would attempt a pg-boss schema migration on
    // every cold start, racing the worker that owns it. With it, a deployment
    // whose web bundle expects a different schema version fails loudly at
    // boss.start() instead of sending jobs against a schema it does not match.
    //
    // createSchema (also defaulting to true) is deliberately NOT set: it is
    // only read inside contractor.create(), which check() never reaches. Adding
    // it would document the wrong mechanism — the gate is migrate.
    migrate: false,
  };
}

// Builds and starts one sender. A start that fails (the schema check above, or a
// connection that never completes) must not leave its half-open pool behind.
export async function createWebJobSender(options: ConstructorOptions): Promise<PgBoss> {
  const boss = new PgBoss(options);
  // pg-boss emits `error` for the failures of its own background work, and an
  // `error` event nobody listens to is thrown — as an uncaught exception in the
  // Next server (`Error: Unhandled error.` in kalfa-beta's error log, 2026-10-13).
  // The message goes to the log as before; the alert carries the class only.
  boss.on('error', (e: Error) => {
    console.error('[web-sender] pg-boss error:', e.message);
    void reportPgBossError(e, 'kalfa-web-sender');
  });
  try {
    await boss.start();
  } catch (err) {
    // The start error is what the caller needs; a failure to tidy up after it
    // must not replace it.
    await boss.stop({ graceful: false }).catch(() => undefined);
    throw err;
  }
  return boss;
}

// The PROMISE is cached, not the finished instance: two requests arriving while
// the first start() is still in flight must share it. Caching only the result
// let each of them build its own PgBoss, and the one that lost the race kept its
// pool and timers for the life of the process.
let sender: Promise<PgBoss> | null = null;

export function getWebJobSender(): Promise<PgBoss> {
  sender ??= createWebJobSender(webSenderOptions()).catch((err: unknown) => {
    sender = null; // the next call tries again
    throw err;
  });
  return sender;
}
