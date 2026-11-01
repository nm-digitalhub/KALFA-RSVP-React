// Prepares the LOCAL Supabase database (`supabase start`) for pg-boss: the schema and the app's queues, the same
// ones the worker creates in production on every start (src/lib/testing/local-pgboss.ts says why). A development
// tool: never deployed. The E2E suite runs the same setup in its global setup.
//
//   npm run pgboss:local-setup
//
// It refuses any database but Supabase local on 127.0.0.1:54322 and loads no .env file.
import { setUpLocalPgBoss } from '@/lib/testing/local-pgboss';

async function main(): Promise<void> {
  const dbUrl = process.env.LOCAL_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const queues = await setUpLocalPgBoss(dbUrl);
  console.log(`[pgboss-local-setup] schema "pgboss" ready, ${queues} queues`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
