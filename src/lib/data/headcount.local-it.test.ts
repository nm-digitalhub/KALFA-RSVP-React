import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import {
  type Fixture,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';

// TS-INTEGRATION — headcount flow (finding 2) and E3 (recovery after a partial
// failure). The REAL processWebhookEvent / requestHeadcount / handleHeadcountReply run
// against Supabase local through PostgREST. Substituted ONLY at the external-provider
// boundary:
//   - sendWhatsAppText (Meta Graph send) → records the message and returns a scripted
//     DeliveryOutcome;
//   - getWhatsAppConfig (provider credentials read from app_settings) → a fake config,
//     because enabling the real one would mean writing non-fixture app_settings.
// No overlapping-operation scenarios here: requestHeadcount and handleHeadcountReply
// run only inside the webhook drain, and one kalfa-worker walks its rows one at a time
// (pg-boss localConcurrency 1; an overrunning handler blocks the next fetch). Two
// headcount operations on one guest cannot run at once.

const provider = vi.hoisted(() => ({
  sends: [] as Array<{ to: string; body: string }>,
  // Return value of sendWhatsAppText; default: accepted.
  onSend: null as null | ((p: { to: string; body: string }) => Promise<unknown>),
}));

vi.mock('@/lib/whatsapp/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/whatsapp/client')>();
  return {
    ...real,
    sendWhatsAppText: vi.fn(async (_cfg: unknown, p: { to: string; body: string }) => {
      provider.sends.push(p);
      if (provider.onSend) return provider.onSend(p);
      return { kind: 'accepted', providerId: `wamid.fake.${provider.sends.length}` };
    }),
  };
});
vi.mock('@/lib/data/outreach-config', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/data/outreach-config')>();
  return {
    ...real,
    getWhatsAppConfig: vi.fn(async () => ({
      phoneNumberId: 'it-fake-phone',
      wabaId: null,
      accessToken: 'it-fake-token',
      appSecret: null,
      verifyToken: null,
    })),
  };
});

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;

type Row = Parameters<typeof import('@/lib/data/webhook-processing').processWebhookEvent>[0];

describe.skipIf(!RUN)('headcount flow — finding 2 and E3 (partial failure), real code', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let processWebhook: (row: Row) => Promise<void>;
  let hc: typeof import('@/lib/data/headcount');
  let submitRsvp: typeof import('@/lib/data/rsvp').submitRsvp;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'headcount', 8);
    scope = new FixtureScope(pool);
    const wp = await import('@/lib/data/webhook-processing');
    processWebhook = (row) => wp.processWebhookEvent(row, wp.createWebhookBatchContext());
    hc = await import('@/lib/data/headcount');
    submitRsvp = (await import('@/lib/data/rsvp')).submitRsvp;
  });
  afterEach(() => {
    provider.sends.length = 0;
    provider.onSend = null;
  });
  afterAll(async () => {
    try {
      await scope.cleanup();
    } finally {
      await pool.end();
    }
  });

  const processRow = (row: Row) => scope.track(processWebhook(row));
  const from = (f: Fixture) => f.phone.replace('+', '');
  const inbox = (f: Fixture, payload: Record<string, unknown>, messageId = `wamid.${f.tag}.${randomUUID().slice(0, 6)}`) =>
    scope.insertInbox(f, { messageId, payload, contextId: f.outboundWamid }) as Promise<Row>;
  const press = (f: Fixture, id: string, messageId?: string) =>
    inbox(f, { type: 'button', from: from(f), button: { payload: id, text: id } }, messageId);
  const text = (f: Fixture, body: string, messageId?: string) => inbox(f, { type: 'text', from: from(f), text: { body } }, messageId);
  const questions = () => provider.sends.filter((s) => s.body.includes('כמה תגיעו'));
  const acks = () => provider.sends.filter((s) => s.body === 'נרשם! מחכים לכם בשמחה 🎉');
  const guest = async (f: Fixture) =>
    (await pool.query(
      `select status, confirmed_adults, confirmed_kids, confirmed_headcount, headcount_attempts,
              headcount_requested_at, headcount_answered_at
         from public.guests where id = $1`,
      [f.guestId],
    )).rows[0];
  const billed = async (f: Fixture) =>
    (await pool.query(`select count(*)::int n from public.billed_results where event_id = $1`, [f.eventId])).rows[0].n as number;
  const asked = (f: Fixture, attempts = 1) =>
    pool.query(
      `update public.guests set status = 'attending', confirmed_adults = 1, confirmed_kids = 0,
              headcount_requested_at = now(), headcount_answered_at = null, headcount_attempts = $2 where id = $1`,
      [f.guestId, attempts],
    );
  // A first delivery that crashed right after insertInteraction (UNIQUE(channel, provider_id)).
  const crashedAfterInsert = (f: Fixture, messageId: string) =>
    pool.query(
      `insert into public.contact_interactions (channel, direction, kind, provider_id, context_message_id, contact_id, event_id, campaign_id, billable)
       values ('whatsapp','in','message',$1,$2,$3,$4,$5,true)`,
      [messageId, f.outboundWamid, f.contactId, f.eventId, f.campaignId],
    );

  // ═══ sanity: the happy path the findings below deviate from ════════════════════
  describe('baseline (provider accepts)', () => {
    it('attending press → one question + request marker; numeric reply → stored once + one ack', async () => {
      const f = await scope.create();
      await processRow(await press(f, 'rsvp_attending'));
      expect(questions()).toHaveLength(1);
      expect((await guest(f)).headcount_requested_at).not.toBeNull();
      await processRow(await text(f, '3'));
      expect(await guest(f)).toMatchObject({ confirmed_headcount: 3, confirmed_adults: 3, confirmed_kids: 0 });
      expect(acks()).toHaveLength(1);
    });

    it('"0" re-asks until HEADCOUNT_MAX_ATTEMPTS, then stops asking', async () => {
      const f = await scope.create();
      await asked(f, 1);
      for (let i = 0; i < 4; i++) await processRow(await text(f, '0'));
      expect(questions()).toHaveLength(hc.HEADCOUNT_MAX_ATTEMPTS - 1);
      expect((await guest(f)).headcount_attempts).toBe(hc.HEADCOUNT_MAX_ATTEMPTS);
    });
  });

  // ═══ finding 2 — headcount question and reply ══════════════════════════════════
  describe('finding 2: headcount question and reply', () => {
    it.fails('KNOWN BUG 2a\': a second "attending" press (no race needed) does not ask the question again', async () => {
      const f = await scope.create();
      await processRow(await press(f, 'rsvp_attending'));
      await processRow(await press(f, 'rsvp_attending'));
      expect(questions()).toHaveLength(1);
    });

    it('characterization 2a\': requestHeadcount only checks answered_at — every fresh attending press re-asks and resets attempts to 1', async () => {
      const f = await scope.create();
      await processRow(await press(f, 'rsvp_attending'));
      await asked(f, 2); // pretend one "0" round already happened
      await processRow(await press(f, 'rsvp_attending'));
      expect(questions()).toHaveLength(2);
      expect((await guest(f)).headcount_attempts).toBe(1);
      expect(await billed(f)).toBe(1);
    });

    it.fails('KNOWN BUG 2e: a question the provider timed out on (outcome unknown) still accepts the guest\'s answer', async () => {
      const f = await scope.create();
      provider.onSend = async () => ({ kind: 'unknown', reason: 'timeout' });
      await scope.track(hc.requestHeadcount(f.guestId, f.contactId));
      provider.onSend = null;
      await processRow(await text(f, '3'));
      expect((await guest(f)).confirmed_headcount).toBe(3);
    });

    it('characterization 2e: unknown send outcome → no request marker → the reply to a possibly-delivered question is dropped', async () => {
      const f = await scope.create();
      provider.onSend = async () => ({ kind: 'unknown', reason: 'timeout' });
      await scope.track(hc.requestHeadcount(f.guestId, f.contactId));
      provider.onSend = null;
      expect(questions()).toHaveLength(1);
      expect((await guest(f)).headcount_requested_at).toBeNull();
      await processRow(await text(f, '3'));
      expect((await guest(f)).confirmed_headcount).toBe(0);
    });
  });

  // ═══ E3 — partial failure, then retry ══════════════════════════════════════════
  describe('E3: partial failure and retry', () => {
    it.fails('KNOWN BUG E3a: an "attending" press whose first delivery crashed after the insert still triggers the question on retry', async () => {
      const f = await scope.create();
      const id = `wamid.${f.tag}.att-crash`;
      await crashedAfterInsert(f, id);
      await processRow(await press(f, 'rsvp_attending', id));
      expect(questions()).toHaveLength(1);
    });

    it('characterization E3a: the retry records the RSVP and bills, but never asks the headcount question', async () => {
      const f = await scope.create();
      const id = `wamid.${f.tag}.att-crash`;
      await crashedAfterInsert(f, id);
      await processRow(await press(f, 'rsvp_attending', id));
      expect((await guest(f)).status).toBe('attending');
      expect(await billed(f)).toBe(1);
      expect(questions()).toHaveLength(0);
      expect((await guest(f)).headcount_requested_at).toBeNull();
    });

    it('E3c (failure after the answer is saved, before the ack): the answer survives; the retry never re-sends the ack', async () => {
      const f = await scope.create();
      await asked(f);
      provider.onSend = async (p) => {
        if (p.body === hc.HEADCOUNT_ACK) throw new Error('fetch failed (ambiguous: provider timeout)');
        return { kind: 'accepted', providerId: 'x' };
      };
      const row = await text(f, '3');
      await expect(processRow(row)).rejects.toThrow(/fetch failed/); // the worker would mark the row failed
      expect((await guest(f)).confirmed_headcount).toBe(3);
      provider.onSend = null;
      await processRow(row); // the worker's retry of the same row
      expect(acks()).toHaveLength(1); // only the failed attempt; no re-send on retry
      expect(await billed(f)).toBe(1);
    });

    it('E3d (crash between submit_rsvp and the WhatsApp source marker): the retry sees unchanged:true — marker lost, RSVP and billing intact', async () => {
      const f = await scope.create();
      const id = `wamid.${f.tag}.mark-crash`;
      await crashedAfterInsert(f, id);
      // what the crashed first attempt had already done: the bot's submit_rsvp call
      expect((await submitRsvp(f.rsvpToken, { status: 'declined', adults: 0, kids: 0 })).ok).toBe(true);
      await processRow(await press(f, 'rsvp_declined', id));
      const marker = await pool.query(
        `select count(*)::int n from public.activity_log where event_id = $1 and action = 'rsvp.from_whatsapp'`,
        [f.eventId],
      );
      expect(marker.rows[0].n).toBe(0);
      expect((await guest(f)).status).toBe('declined');
      expect(await billed(f)).toBe(1);
    });

    it('E3e: a crash after billing — the retry neither double-bills nor duplicates the interaction', async () => {
      const f = await scope.create();
      const row = await press(f, 'rsvp_declined');
      await processRow(row);
      await Promise.all([processRow(row), processRow(row)]);
      expect(await billed(f)).toBe(1);
      const n = await pool.query(
        `select count(*)::int n from public.contact_interactions where event_id = $1 and direction = 'in'`,
        [f.eventId],
      );
      expect(n.rows[0].n).toBe(1);
    });
  });
});
