import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import {
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';

// The worker's top-up against the real local stack (package-outreach-admission-safety, task 3.1 and design D2): the
// real link repair and the real fill_authorized_set, with RECONCILE_AUTHORIZED_SET_ENABLED off. A package campaign
// whose list is empty, a linked guest, a guest whose contact link failed and a guest with no valid phone: one tick
// links the second and admits both, in order of addition, within the quota; the third stays as it is.

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;

describe.skipIf(!RUN)('topUpPackageList — the arm tick repairs a missed admission (real database)', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let topUpPackageList: typeof import('@/lib/data/authorized-topup').topUpPackageList;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    vi.stubEnv('RECONCILE_AUTHORIZED_SET_ENABLED', 'false');
    pool = newPool(ENV!, 'arm-topup');
    scope = new FixtureScope(pool);
    ({ topUpPackageList } = await import('@/lib/data/authorized-topup'));
  });

  afterAll(async () => {
    try {
      await scope.cleanup();
    } finally {
      await pool.end();
      vi.unstubAllEnvs();
    }
  });

  it('links the unlinked guest and admits by order of addition up to the quota, with the switch off', async () => {
    const f = await scope.create({ authorized: false, noOutbound: true });
    await pool.query(`update public.campaigns set contact_quota = 2 where id = $1`, [f.campaignId]);
    const digits = String(Date.now()).slice(-7);
    const unlinkedPhone = `+97252${digits}`;
    const unlinked = randomUUID();
    const noPhone = randomUUID();
    await pool.query(
      `insert into public.guests (id, event_id, full_name, phone) values ($1, $3, 'IT unlinked', $4), ($2, $3, 'IT no phone', 'not a phone')`,
      [unlinked, noPhone, f.eventId, unlinkedPhone],
    );

    await topUpPackageList(f.eventId, f.campaignId);

    const guests = await pool.query(
      `select g.id, g.contact_id, c.normalized_phone from public.guests g left join public.contacts c on c.id = g.contact_id
        where g.id = any($1::uuid[])`,
      [[unlinked, noPhone]],
    );
    const byId = new Map(guests.rows.map((r) => [r.id as string, r]));
    expect(byId.get(unlinked)?.normalized_phone).toBe(unlinkedPhone);
    expect(byId.get(noPhone)?.contact_id).toBeNull();

    const list = await pool.query(
      `select a.contact_id from public.campaign_authorized_contacts a
         join public.guests g on g.contact_id = a.contact_id and g.event_id = a.event_id
        where a.campaign_id = $1 order by g.seq`,
      [f.campaignId],
    );
    expect(list.rows.map((r) => r.contact_id)).toEqual([f.contactId, byId.get(unlinked)?.contact_id]);

    const audit = await pool.query(
      `select contact_id, action, reason, actor from public.campaign_authorized_set_audit where campaign_id = $1 order by at, contact_id`,
      [f.campaignId],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows.every((r) => r.action === 'in' && r.reason === 'snapshot' && r.actor === 'arm_topup')).toBe(true);

    // A second tick changes nothing: the list is full and every phone is linked.
    await topUpPackageList(f.eventId, f.campaignId);
    const again = await pool.query(`select count(*)::int as n from public.campaign_authorized_contacts where campaign_id = $1`, [f.campaignId]);
    expect(again.rows[0].n).toBe(2);
  });
});
