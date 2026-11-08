import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';

import {
  type Fixture,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
} from '@/lib/testing/local-integration';

// TS-INTEGRATION — submit_rsvp with one "how many are coming" count (migration
// 20261108080252_rsvp_single_headcount), against Supabase local. SQL-level on purpose:
// the application code moves to `_headcount` only after the migration is pushed and the
// generated types know the parameter, so these tests pin the database contract that
// code will rely on, plus the old call shape that production keeps sending meanwhile.

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;

type RsvpResult = { ok: boolean; status?: string; reason?: string; unchanged?: boolean };

describe.skipIf(!RUN)('submit_rsvp — one count instead of adults + kids', () => {
  let pool: Pool;
  let scope: FixtureScope;

  beforeAll(() => {
    pool = newPool(ENV!, 'rsvp-single-headcount', 4);
    scope = new FixtureScope(pool);
  });
  afterAll(async () => {
    try {
      await scope.cleanup();
    } finally {
      await pool.end();
    }
  });

  // The new shape: the guest gave one count.
  const answer = async (f: Fixture, status: string, headcount: number): Promise<RsvpResult> =>
    (await pool.query(`select public.submit_rsvp(_token => $1, _status => $2, _headcount => $3) r`, [
      f.rsvpToken,
      status,
      headcount,
    ])).rows[0].r as RsvpResult;

  // The shape production sends until the code moves: adults + kids, meal and note positional.
  const answerOldShape = async (f: Fixture, status: string, adults: number, kids: number): Promise<RsvpResult> =>
    (await pool.query(
      `select public.submit_rsvp(_token => $1, _status => $2, _adults => $3, _kids => $4, _meal => null, _note => null) r`,
      [f.rsvpToken, status, adults, kids],
    )).rows[0].r as RsvpResult;

  const guest = async (f: Fixture) =>
    (await pool.query(
      `select status::text, confirmed_headcount, confirmed_adults, confirmed_kids, headcount_answered_at
         from public.guests where id = $1`,
      [f.guestId],
    )).rows[0];

  const lastResponse = async (f: Fixture) =>
    (await pool.query(
      `select adults, kids, headcount from public.rsvp_responses where guest_id = $1 order by created_at desc limit 1`,
      [f.guestId],
    )).rows[0];

  const responseCount = async (f: Fixture) =>
    (await pool.query(`select count(*)::int n from public.rsvp_responses where guest_id = $1`, [f.guestId])).rows[0].n as number;

  it('a family of 15 is stored as 15: no ceiling of 10, and the count is final for the WhatsApp question', async () => {
    const f = await scope.create({ expectedCount: null });
    expect(await answer(f, 'attending', 15)).toMatchObject({ ok: true, status: 'attending' });

    const g = await guest(f);
    expect(g).toMatchObject({ status: 'attending', confirmed_headcount: 15, confirmed_adults: 15, confirmed_kids: 0 });
    expect(g.headcount_answered_at).not.toBeNull();
    expect(await lastResponse(f)).toMatchObject({ headcount: 15, adults: 15, kids: 0 });

    const totals = (await pool.query(`select public.guest_totals($1) t`, [f.eventId])).rows[0].t;
    expect(totals.attending_people).toBe(15);
  });

  it('the count may not exceed the number the host invited', async () => {
    const f = await scope.create({ expectedCount: 4 });
    expect(await answer(f, 'attending', 5)).toEqual({ ok: false, reason: 'invalid_count' });
    expect(await answer(f, 'attending', 0)).toEqual({ ok: false, reason: 'invalid_count' });
    expect(await responseCount(f)).toBe(0);
    expect((await guest(f)).status).toBe('pending');
  });

  it('the old adults + kids shape behaves as before: the count is reset and the WhatsApp question stays open', async () => {
    const f = await scope.create();
    expect(await answerOldShape(f, 'attending', 1, 0)).toMatchObject({ ok: true });

    const g = await guest(f);
    expect(g).toMatchObject({ confirmed_headcount: 0, confirmed_adults: 1, confirmed_kids: 0 });
    expect(g.headcount_answered_at).toBeNull();
    expect(await lastResponse(f)).toMatchObject({ adults: 1, kids: 0, headcount: null });
  });

  it('a repeated identical answer is unchanged, but a count changed in between by the WhatsApp answer is not', async () => {
    const f = await scope.create();
    expect(await answer(f, 'attending', 3)).toMatchObject({ ok: true });
    expect(await answer(f, 'attending', 3)).toMatchObject({ ok: true, unchanged: true });
    expect(await responseCount(f)).toBe(1);

    // The WhatsApp headcount answer writes the guest row and no response row.
    await pool.query(`update public.guests set confirmed_headcount = 2, confirmed_adults = 2 where id = $1`, [f.guestId]);
    const again = await answer(f, 'attending', 3);
    expect(again.unchanged).toBeUndefined();
    expect((await guest(f)).confirmed_headcount).toBe(3);
    expect(await responseCount(f)).toBe(2);
  });

  it('declining after attending clears the count and the answered stamp', async () => {
    const f = await scope.create();
    await answer(f, 'attending', 3);
    expect(await answer(f, 'declined', 0)).toMatchObject({ ok: true, status: 'declined' });

    const g = await guest(f);
    expect(g).toMatchObject({ status: 'declined', confirmed_headcount: 0, confirmed_adults: 0, confirmed_kids: 0 });
    expect(g.headcount_answered_at).toBeNull();
    expect(await lastResponse(f)).toMatchObject({ headcount: 0 });
  });
});
