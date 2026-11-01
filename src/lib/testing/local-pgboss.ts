import { PgBoss } from 'pg-boss';

import { assertLocalDbUrl, testDbSsl } from '@/lib/outreach/test-db-guard';
import { ensureQueues } from '@/lib/queue/queue-setup';

// pg-boss on the LOCAL Supabase database (`supabase start`): the schema and the app's queues, the same ones the
// worker creates in production on every start. The web tier only sends, with migrate off (web-sender.ts), and the
// pg-boss docs require a queue to exist before anything is sent to it, so without this a send made by the local app —
// the package activation a test payment queues — fails with "pg-boss is not installed" or "Queue … does not exist".
// Used by `npm run pgboss:local-setup` and the E2E global setup (tests/global-setup.ts).
//
// Refuses any database but Supabase local on 127.0.0.1:54322 (assertLocalDbUrl). Running it again changes nothing:
// start() creates the schema only when it is missing, and ensureQueues() creates only the missing queues.
export async function setUpLocalPgBoss(dbUrl: string): Promise<number> {
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
  boss.on('error', (err: Error) => console.error('[local-pgboss] pg-boss error:', err.message));
  try {
    await boss.start();
    await ensureQueues(boss);
    return (await boss.getQueues()).length;
  } finally {
    await boss.stop({ graceful: false });
  }
}
