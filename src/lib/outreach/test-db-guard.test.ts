import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertLocalTargets, resolveLocalTestDb, resolveTestDb } from './test-db-guard';

// Regression tests for the integration-suite target guards. resolveTestDb() is the
// existing prod guard (accepts a hosted test project); resolveLocalTestDb() is the
// stricter guard of the local-only suite (loopback 54322/54321 only).

const LOCAL_DB = 'postgresql://postgres:x@127.0.0.1:54322/postgres';
const LOCAL_API = 'http://127.0.0.1:54321';
const HOSTED_DB = 'postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const HOSTED_API = 'https://abcdefghijklmnopqrst.supabase.co';
const PROD_REF = 'cklpaxihpyjbhymqtduv';

function setEnv(v: Record<string, string>) {
  for (const [k, val] of Object.entries(v)) vi.stubEnv(k, val);
}

beforeEach(() => {
  // Start every case from a known-empty state, whatever the shell exported.
  setEnv({
    OUTREACH_DB_IT: '',
    OUTREACH_TEST_DB_URL: '',
    OUTREACH_TEST_SUPABASE_URL: '',
    OUTREACH_TEST_SERVICE_ROLE_KEY: '',
    OUTREACH_TEST_ANON_KEY: '',
    NEXT_PUBLIC_SUPABASE_URL: '',
    SUPABASE_DB_HOST: '',
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('resolveTestDb (existing prod guard)', () => {
  it('throws when the trio is incomplete', () => {
    setEnv({ OUTREACH_TEST_DB_URL: LOCAL_DB, OUTREACH_TEST_SUPABASE_URL: LOCAL_API });
    expect(() => resolveTestDb()).toThrow(/not configured/);
  });

  it('refuses the production Supabase URL, the production DB host and the production ref', () => {
    const trio = { OUTREACH_TEST_DB_URL: HOSTED_DB, OUTREACH_TEST_SUPABASE_URL: HOSTED_API, OUTREACH_TEST_SERVICE_ROLE_KEY: 'k' };
    setEnv({ ...trio, NEXT_PUBLIC_SUPABASE_URL: HOSTED_API });
    expect(() => resolveTestDb()).toThrow(/production/);
    setEnv({ ...trio, NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_DB_HOST: 'pooler.supabase.com' });
    expect(() => resolveTestDb()).toThrow(/production/);
    setEnv({ ...trio, SUPABASE_DB_HOST: '', OUTREACH_TEST_SUPABASE_URL: `https://${PROD_REF}.supabase.co` });
    expect(() => resolveTestDb()).toThrow(/production/);
  });

  it('accepts a hosted non-production project (why the local suite needs a stricter guard)', () => {
    setEnv({ OUTREACH_TEST_DB_URL: HOSTED_DB, OUTREACH_TEST_SUPABASE_URL: HOSTED_API, OUTREACH_TEST_SERVICE_ROLE_KEY: 'k' });
    expect(resolveTestDb().supabaseUrl).toBe(HOSTED_API);
  });
});

describe('assertLocalTargets', () => {
  it('accepts Supabase local on loopback', () => {
    expect(() => assertLocalTargets(LOCAL_DB, LOCAL_API)).not.toThrow();
    expect(() => assertLocalTargets(LOCAL_DB.replace('127.0.0.1', 'localhost'), 'http://localhost:54321/')).not.toThrow();
  });

  it.each([
    ['a hosted pooler DB', HOSTED_DB, LOCAL_API],
    ['a remote host on the local DB port', 'postgresql://postgres:x@10.0.0.5:54322/postgres', LOCAL_API],
    ['a hostname that merely starts with 127', 'postgresql://postgres:x@127.0.0.1.evil.example:54322/postgres', LOCAL_API],
    ['loopback DB on the container port', 'postgresql://postgres:x@127.0.0.1:5432/postgres', LOCAL_API],
    ['a non-postgres DB scheme', 'mysql://root:x@127.0.0.1:54322/postgres', LOCAL_API],
    ['a hosted API', LOCAL_DB, HOSTED_API],
    ['https on loopback', LOCAL_DB, 'https://127.0.0.1:54321'],
    ['the API on another loopback port', LOCAL_DB, 'http://127.0.0.1:8000'],
    ['an API URL with a path (proxy)', LOCAL_DB, 'http://127.0.0.1:54321/proxy/https://x.supabase.co'],
    ['an unparsable DB URL', 'not a url', LOCAL_API],
    ['an empty API URL', LOCAL_DB, ''],
  ])('refuses %s', (_label, db, api) => {
    expect(() => assertLocalTargets(db, api)).toThrow(/REFUSING integration run/);
  });
});

describe('resolveLocalTestDb (local-only suite entry)', () => {
  const local = { OUTREACH_TEST_DB_URL: LOCAL_DB, OUTREACH_TEST_SUPABASE_URL: LOCAL_API, OUTREACH_TEST_SERVICE_ROLE_KEY: 'k' };

  it('requires the explicit OUTREACH_DB_IT=1 opt-in', () => {
    setEnv(local);
    expect(() => resolveLocalTestDb()).toThrow(/OUTREACH_DB_IT=1/);
  });

  it('accepts the local trio', () => {
    setEnv({ ...local, OUTREACH_DB_IT: '1', OUTREACH_TEST_ANON_KEY: 'a' });
    expect(resolveLocalTestDb()).toMatchObject({ dbUrl: LOCAL_DB, supabaseUrl: LOCAL_API, anonKey: 'a' });
  });

  it('refuses a hosted non-production project that resolveTestDb accepts', () => {
    setEnv({ OUTREACH_DB_IT: '1', OUTREACH_TEST_DB_URL: HOSTED_DB, OUTREACH_TEST_SUPABASE_URL: HOSTED_API, OUTREACH_TEST_SERVICE_ROLE_KEY: 'k' });
    expect(() => resolveLocalTestDb()).toThrow(/REFUSING integration run: DB must be Supabase local/);
  });

  it('still applies the prod guard first (prod ref in an otherwise local-shaped URL)', () => {
    setEnv({ ...local, OUTREACH_DB_IT: '1', OUTREACH_TEST_DB_URL: `postgresql://postgres:x@127.0.0.1:54322/${PROD_REF}` });
    expect(() => resolveLocalTestDb()).toThrow(/production/);
  });

  it('refuses when the local DB is right but the API points elsewhere', () => {
    setEnv({ ...local, OUTREACH_DB_IT: '1', OUTREACH_TEST_SUPABASE_URL: HOSTED_API });
    expect(() => resolveLocalTestDb()).toThrow(/API must be/);
  });
});
