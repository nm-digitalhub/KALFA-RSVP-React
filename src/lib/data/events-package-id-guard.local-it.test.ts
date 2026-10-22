// events.package_id is server-managed (migration 20261022124922_block_client_writes_events_package_id), executed live
// against the LOCAL stack through PostgREST as real signed-in users.
//
// What it proves:
//   - UPDATE: the owner can no longer change package_id of their own event (permission denied), and the value is
//     unchanged; the owner can still update an ordinary column (name), so the edit path is not broken;
//   - INSERT: a user creating their own event with package_id set is refused; the same insert without package_id
//     still succeeds.
// Fixtures: auth users from FixtureScope (it-<tag>), events inserted for them; afterAll deletes the events, then the
// scope cleanup removes the users and asserts nothing is left.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { type AuthUser, FixtureScope, newPool, requireLocalIntegrationEnv } from '@/lib/testing/local-integration';

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV = RUN ? requireLocalIntegrationEnv() : null;

describe.skipIf(!RUN)('events.package_id is not client-writable (local)', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let owner: AuthUser;
  let creator: AuthUser;
  let eventId = '';
  let packageId = '';
  const created: string[] = [];
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  beforeAll(async () => {
    if (!RUN || !ENV) return;
    pool = newPool(ENV, 'events-package-id-guard');
    scope = new FixtureScope(pool);
    owner = await scope.createAuthUser(ENV);
    creator = await scope.createAuthUser(ENV);
    eventId = randomUUID();
    await pool.query(
      `insert into public.events (id, owner_id, name, event_type, event_date) values ($1, $2, $3, 'wedding', $4)`,
      [eventId, owner.id, owner.tag, inDays(20)],
    );
    created.push(eventId);
    const pkg = await pool.query(`select id from public.packages order by created_at limit 1`);
    packageId = pkg.rows[0].id;
  });

  afterAll(async () => {
    if (!RUN) return;
    try {
      if (created.length) await pool.query(`delete from public.events where id = any($1::uuid[])`, [created]);
      await scope.cleanup();
      const left = await pool.query(`select count(*)::int n from public.events where id = any($1::uuid[])`, [created]);
      expect(left.rows[0].n).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('owner UPDATE of package_id is refused and the value is unchanged', async () => {
    const { data, error } = await owner.client
      .from('events')
      .update({ package_id: packageId })
      .eq('id', eventId)
      .select('id');
    expect(error?.code, JSON.stringify({ data, error })).toBe('42501');
    const row = await pool.query(`select package_id from public.events where id = $1`, [eventId]);
    expect(row.rows[0].package_id).toBeNull();
  });

  it('owner UPDATE of an ordinary column still works (control)', async () => {
    const { data, error } = await owner.client
      .from('events')
      .update({ name: `${owner.tag}-renamed` })
      .eq('id', eventId)
      .select('id');
    expect(error, JSON.stringify(error)).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('client INSERT with package_id is refused', async () => {
    const id = randomUUID();
    created.push(id); // tracked even if the guard is missing and the insert succeeds
    const { error } = await creator.client
      .from('events')
      .insert({ id, owner_id: creator.id, name: creator.tag, event_type: 'wedding', event_date: inDays(25), package_id: packageId });
    expect(error?.code, JSON.stringify(error)).toBe('42501');
    const row = await pool.query(`select count(*)::int n from public.events where id = $1`, [id]);
    expect(row.rows[0].n).toBe(0);
  });

  it('client INSERT without package_id still works (control)', async () => {
    const id = randomUUID();
    const { error } = await creator.client
      .from('events')
      .insert({ id, owner_id: creator.id, name: creator.tag, event_type: 'wedding', event_date: inDays(25) });
    created.push(id);
    expect(error, JSON.stringify(error)).toBeNull();
    const row = await pool.query(`select package_id from public.events where id = $1`, [id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].package_id).toBeNull();
  });
});
