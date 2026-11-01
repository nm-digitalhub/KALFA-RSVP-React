// Prepares the LOCAL Supabase database (`supabase start`) for pg-boss: the schema and the app's queues, the same
// ones the worker creates in production on every start. A development tool: never run by CI, never deployed.
//
//   npm run pgboss:local-setup
//
// Why it exists: the web tier only sends jobs, with migrate off (src/lib/queue/web-sender.ts), and the pg-boss docs
// require a queue to exist before anything is sent to it ("Queue <name> does not exist" otherwise). In production the
// worker creates both; locally no worker runs — it loads the production keys from .env.local — so a send made by the
// local app (the package activation after a test payment) failed until this had run.
//
// It refuses any database but Supabase local on 127.0.0.1:54322 (assertLocalDbUrl) and loads no .env file. Running
// it again changes nothing: start() creates the schema only when it is missing, and ensureQueues() creates only the
// missing queues.
import { PgBoss } from 'pg-boss';

import { assertLocalDbUrl, testDbSsl } from '@/lib/outreach/test-db-guard';
import { ensureQueues } from '@/lib/queue/queue-setup';

async function main(): Promise<void> {
  const dbUrl = process.env.LOCAL_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  assertLocalDbUrl(dbUrl);

  // migrate stays on (the default): this instance owns the local schema, as the worker owns production's.
  const boss = new PgBoss({
    connectionString: dbUrl,
    ssl: testDbSsl(dbUrl),
    schema: 'pgboss',
    application_name: 'kalfa-pgboss-local-setup',
    supervise: false,
    schedule: false,
  });
  boss.on('error', (err: Error) => console.error('[pgboss-local-setup] pg-boss error:', err.message));

  try {
    await boss.start();
    await ensureQueues(boss);
    const queues = await boss.getQueues();
    console.log(`[pgboss-local-setup] schema "pgboss" ready, ${queues.length} queues`);
  } finally {
    await boss.stop({ graceful: false });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
