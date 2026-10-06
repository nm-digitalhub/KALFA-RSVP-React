import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// A table-aware Supabase double: each table resolves to its own `{ data, error }`, and every
// query records the table it was issued against so a test can assert a read did NOT happen.
type Result = { data: unknown; error: { message: string } | null };
const results: Record<string, Result> = {};
const queried: string[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      queried.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: async () => results[table] ?? { data: null, error: null },
      };
      return builder;
    },
  }),
}));

import { checkContactSeat } from './contact-quota';

const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  queried.length = 0;
});

describe('checkContactSeat', () => {
  it('a campaign that does not exist → allowed (the package model does not apply)', async () => {
    results.campaigns = { data: null, error: null };
    expect(await checkContactSeat(CAMPAIGN, CONTACT)).toEqual({ allowed: true });
  });

  it('no quota → allowed, and the seat table is never read (campaigns today)', async () => {
    results.campaigns = { data: { contact_quota: null }, error: null };
    expect(await checkContactSeat(CAMPAIGN, CONTACT)).toEqual({ allowed: true });
    expect(queried).toEqual(['campaigns']);
  });

  it('a quota and a seat → allowed', async () => {
    results.campaigns = { data: { contact_quota: 100 }, error: null };
    results.campaign_authorized_contacts = { data: { contact_id: CONTACT }, error: null };
    expect(await checkContactSeat(CAMPAIGN, CONTACT)).toEqual({ allowed: true });
    expect(queried).toEqual(['campaigns', 'campaign_authorized_contacts']);
  });

  it('a quota and no seat → waiting_for_quota', async () => {
    results.campaigns = { data: { contact_quota: 100 }, error: null };
    results.campaign_authorized_contacts = { data: null, error: null };
    expect(await checkContactSeat(CAMPAIGN, CONTACT)).toEqual({
      allowed: false,
      reason: 'waiting_for_quota',
    });
  });

  it('a quota of ZERO is still a quota: nobody holds a seat', async () => {
    results.campaigns = { data: { contact_quota: 0 }, error: null };
    results.campaign_authorized_contacts = { data: null, error: null };
    expect(await checkContactSeat(CAMPAIGN, CONTACT)).toEqual({
      allowed: false,
      reason: 'waiting_for_quota',
    });
  });

  it('a read error on the campaign throws — never silently allows or refuses', async () => {
    results.campaigns = { data: null, error: { message: 'boom' } };
    await expect(checkContactSeat(CAMPAIGN, CONTACT)).rejects.toThrow('בדיקת מכסת אנשי הקשר נכשלה');
  });

  it('a read error on the seat table throws', async () => {
    results.campaigns = { data: { contact_quota: 100 }, error: null };
    results.campaign_authorized_contacts = { data: null, error: { message: 'boom' } };
    await expect(checkContactSeat(CAMPAIGN, CONTACT)).rejects.toThrow('בדיקת מכסת אנשי הקשר נכשלה');
  });
});
