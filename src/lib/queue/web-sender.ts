import 'server-only';

import { PgBoss } from 'pg-boss';

// The web tier's SEND-ONLY pg-boss connection.
//
// Extracted 2026-09-01 from the outreach-call route, which held the only copy,
// when a second caller (the admin calendar actions) needed to enqueue too.
// Everything below is that original, with its reasoning intact — the point of
// the move is that a second hand-written copy of a connection whose flags are
// this load-bearing is exactly the kind of thing that drifts.
//
// Same connection as the worker (worker/main.ts) but with supervise + schedule
// OFF, so a request never runs maintenance or fires cron — it only calls
// .send(). Module singleton: connect once per server process.

let sender: PgBoss | null = null;

export async function getWebJobSender(): Promise<PgBoss> {
  if (sender) return sender;
  const boss = new PgBoss({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    schema: 'pgboss',
    application_name: 'kalfa-web-sender',
    max: 2,
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
  });
  await boss.start();
  sender = boss;
  return boss;
}
