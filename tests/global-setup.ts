import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { assertLocalTargets } from '@/lib/outreach/test-db-guard';
import { setUpLocalPgBoss } from '@/lib/testing/local-pgboss';

// Runs once before the E2E suite, whoever starts it (`npm run test:e2e`, or the Playwright agents through the
// playwright-test MCP server). Same rule as scripts/integration/run-local.sh: the credentials come ONLY from the
// running local stack (`supabase status`), never from .env/.env.local, and anything but Supabase local on
// 127.0.0.1:54322 / http://127.0.0.1:54321 is refused. The values reach the tests through process.env, the way the
// Playwright docs pass data from global setup (test-global-setup-teardown), under the names resolveLocalTestDb() reads.
// It also gives the local database pg-boss's schema and the app's queues, so the jobs the app sends (a recorded
// payment queues the package's start) are written as in production; no worker runs, so they stay queued.
export default async function globalSetup(): Promise<void> {
  const supabase = existsSync('./node_modules/.bin/supabase') ? './node_modules/.bin/supabase' : 'supabase';
  let status: string;
  try {
    status = execFileSync(supabase, ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('[STOP] local Supabase stack is not running (supabase status)');
  }
  const value = (name: string) => status.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, 'm'))?.[1] ?? '';
  const dbUrl = value('DB_URL');
  const supabaseUrl = value('API_URL');
  const serviceKey = value('SERVICE_ROLE_KEY');
  if (!dbUrl || !supabaseUrl || !serviceKey) throw new Error('[STOP] local DB_URL / API_URL / SERVICE_ROLE_KEY not found');
  assertLocalTargets(dbUrl, supabaseUrl);

  process.env.OUTREACH_DB_IT = '1';
  process.env.OUTREACH_TEST_DB_URL = dbUrl;
  process.env.OUTREACH_TEST_SUPABASE_URL = supabaseUrl;
  process.env.OUTREACH_TEST_SERVICE_ROLE_KEY = serviceKey;
  process.env.OUTREACH_TEST_ANON_KEY = value('ANON_KEY');

  await setUpLocalPgBoss(dbUrl);
}
