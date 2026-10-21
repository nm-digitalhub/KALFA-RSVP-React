// Runs once in the Vitest main process, before any integration file loads.
//   1. Refuses the run unless every target is Supabase local (resolveLocalTestDb).
//   2. Proves the database on that URL is a Supabase stack and the API answers.
//   3. Sweeps residue a killed earlier run left behind (tag-scoped).
//   4. Fingerprints every table; teardown re-fingerprints and FAILS the run if any
//      table differs — residue or mutation that per-file cleanup did not catch.
import { Pool } from 'pg';

import { resolveLocalTestDb } from '@/lib/outreach/test-db-guard';

import { dbFingerprint, fingerprintDiff, sweepLeftovers } from './local-integration';

export default async function setup(): Promise<() => Promise<void>> {
  const env = resolveLocalTestDb();
  const pool = new Pool({ connectionString: env.dbUrl, max: 2, application_name: 'kalfa-it-setup' });
  try {
    const r = await pool.query(
      `select current_database() db, exists (select 1 from pg_roles where rolname = 'supabase_admin') supabase_roles,
              (select count(*) from supabase_migrations.schema_migrations)::int migrations`,
    );
    if (r.rows[0].db !== 'postgres' || !r.rows[0].supabase_roles) {
      throw new Error('REFUSING integration run: target is not a Supabase local database');
    }
    const api = await fetch(`${env.supabaseUrl}/rest/v1/`, { headers: { apikey: env.serviceKey } });
    if (!api.ok) throw new Error(`REFUSING integration run: local API answered ${api.status}`);
    const swept = await sweepLeftovers(pool);
    const before = await dbFingerprint(pool);
    console.log(
      `[integration] local DB ok (migrations=${r.rows[0].migrations}); swept ${swept} leftover owner(s); ${before.size} tables fingerprinted`,
    );
    return async () => {
      try {
        const changed = fingerprintDiff(before, await dbFingerprint(pool));
        if (changed.length > 0) throw new Error(`[integration] database differs after the run: ${changed.join(', ')}`);
        console.log('[integration] fingerprint unchanged after the run');
      } finally {
        await pool.end();
      }
    };
  } catch (e) {
    await pool.end();
    throw e;
  }
}
