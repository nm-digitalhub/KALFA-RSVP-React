// Integration-test DB guard. The outreach integration tests may run ONLY against
// a SEPARATE test / local database — NEVER the production project. They require an
// explicit test-only trio and hard-FAIL if any of it collides with the live
// project (the .env.local production connection or the production project ref).
//
//   OUTREACH_TEST_DB_URL           — pg connection string of the test DB
//   OUTREACH_TEST_SUPABASE_URL     — the test project's Supabase URL
//   OUTREACH_TEST_SERVICE_ROLE_KEY — the test project's service_role key
//
// Allowed environments: Supabase local (`supabase start`) or a dedicated test DB.

const PROD_PROJECT_REF = 'cklpaxihpyjbhymqtduv';

export interface TestDbConfig {
  dbUrl: string;
  supabaseUrl: string;
  serviceKey: string;
}

// Returns the validated test config, or THROWS if the trio is missing OR points
// at production. Call it ONLY when integration is opted-in (OUTREACH_DB_IT=1), so
// a run that intends integration but is misconfigured FAILS LOUDLY (fail-fast) —
// never silently skips, never touches prod.
export function resolveTestDb(): TestDbConfig {
  const dbUrl = process.env.OUTREACH_TEST_DB_URL ?? '';
  const supabaseUrl = process.env.OUTREACH_TEST_SUPABASE_URL ?? '';
  const serviceKey = process.env.OUTREACH_TEST_SERVICE_ROLE_KEY ?? '';
  if (!dbUrl || !supabaseUrl || !serviceKey) {
    throw new Error(
      'integration DB not configured — set OUTREACH_TEST_DB_URL / OUTREACH_TEST_SUPABASE_URL / OUTREACH_TEST_SERVICE_ROLE_KEY (a test/local DB, never prod).',
    );
  }

  const prodSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const prodDbHost = process.env.SUPABASE_DB_HOST ?? '';
  const refuse = (why: string): never => {
    throw new Error(
      `REFUSING to run integration tests against the production database: ${why}. ` +
        'Use Supabase local (`supabase start`) or a dedicated test DB.',
    );
  };

  if (prodSupabaseUrl && supabaseUrl === prodSupabaseUrl) {
    refuse('OUTREACH_TEST_SUPABASE_URL equals .env.local NEXT_PUBLIC_SUPABASE_URL');
  }
  if (prodDbHost && dbUrl.includes(prodDbHost)) {
    refuse('OUTREACH_TEST_DB_URL contains the .env.local SUPABASE_DB_HOST');
  }
  if (`${dbUrl} ${supabaseUrl}`.includes(PROD_PROJECT_REF)) {
    refuse(`references the production project ref ${PROD_PROJECT_REF}`);
  }

  return { dbUrl, supabaseUrl, serviceKey };
}
