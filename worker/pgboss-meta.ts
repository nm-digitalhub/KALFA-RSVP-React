// Worker-ONLY adapter over pg-boss's own storage (§F.5 / §12.9.3). Reads a job's
// retry state directly from `<schema>.job` via the worker's OWN pg connection
// (the same SUPABASE_DB_* session-pooler creds pg-boss uses) — NOT PostgREST,
// NOT createAdminClient. Used to decide, on a `definitely_not_sent` send, whether
// a retry attempt remains (retry_count < retry_limit → release + throw) or the
// step is exhausted (retry_count = retry_limit → resolve provider_failure).
//
// Never imported by the Next app: it lives under worker/ and pulls in `pg`, kept
// out of the browser/server bundle. Bundled into dist/worker.cjs by esbuild.

import { Pool } from 'pg';

// A pg-boss schema is a Postgres identifier. It is interpolated into the query
// text (schema-qualified table names cannot be bind parameters), so it MUST be a
// validated identifier — a fixed const ('pgboss') in production, or a
// per-run isolated test schema matching this pattern. name + id stay bind params.
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT || 5432),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME || 'postgres',
      ssl: { rejectUnauthorized: false },
      application_name: 'kalfa-worker-meta',
      max: 2,
    });
  }
  return pool;
}

export type JobRetryMeta = { state: string; retryCount: number; retryLimit: number };

export async function getJobRetryMeta(args: {
  schema: string;
  queueName: string;
  jobId: string;
}): Promise<JobRetryMeta | null> {
  const { schema, queueName, jobId } = args;
  if (!IDENT_RE.test(schema)) {
    throw new Error(`invalid pgboss schema identifier: ${schema}`);
  }
  const res = await getPool().query(
    `select state, retry_count, retry_limit from ${schema}.job where name = $1 and id = $2`,
    [queueName, jobId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    state: String(row.state),
    retryCount: Number(row.retry_count),
    retryLimit: Number(row.retry_limit),
  };
}

export async function closeJobMetaPool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
