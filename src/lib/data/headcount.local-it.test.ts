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

// TS-INTEGRATION — headcount flow (finding 2: overlapping operations) and E3 (recovery
// after a partial failure). The REAL processWebhookEvent / requestHeadcount /
// handleHeadcountReply run against Supabase local through PostgREST (each request on
// its own PostgREST connection). Substituted ONLY at the external-provider boundary:
//   - sendWhatsAppText (Meta Graph send) → records the message, returns a scripted
//     DeliveryOutcome, and can be held on a gate to force an interleaving;
//   - getWhatsAppConfig (provider credentials read from app_settings) → a fake config,
//     because enabling the real one would mean writing non-fixture app_settings. It is
//     also the deterministic interleaving point inside handleHeadcountReply (it runs
//     between the guest SELECT and the guest UPDATE).
// Interleavings use gates/barriers that wait for the other party to ARRIVE at a code
// point — no random sleeps. A barrier has a bounded fallback (BARRIER_MS) so a
// correctly serialized implementation releases instead of hanging; the arrival count
// is then part of the assertion.

const provider = vi.hoisted(() => ({
  sends: [] as Array<{ to: string; body: string }>,
  // Return value / delay of sendWhatsAppText; default: accepted.
  onSend: null as null | ((p: { to: string; body: string }) => Promise<unknown>),
  // Awaited inside getWhatsAppConfig (between handleHeadcountReply's SELECT and UPDATE).
  onConfig: null as null | (() => Promise<void>),
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
    getWhatsAppConfig: vi.fn(async () => {
      if (provider.onConfig) await provider.onConfig();
      return { phoneNumberId: 'it-fake-phone', wabaId: null, accessToken: 'it-fake-token', appSecret: null, verifyToken: null };
    }),
  };
});

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;
const BARRIER_MS = 3_000;

type Row = Parameters<typeof import('@/lib/data/webhook-processing').processWebhookEvent>[0];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
// Releases when `n` parties arrived (or after BARRIER_MS); reports how many arrived.
function barrier(n: number) {
  let arrived = 0;
  const all = deferred();
  const fallback = new Promise<void>((r) => setTimeout(r, BARRIER_MS).unref());
  return {
    arrive: async () => {
      if (++arrived >= n) all.resolve();
      await Promise.race([all.promise, fallback]);
    },
    get arrived() {
      return arrived;
    },
  };
}

describe.skipIf(!RUN)('headcount flow — finding 2 (races) and E3 (partial failure), real code', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let processWebhook: (row: Row) => Promise<void>;
  let hc: typeof import('@/lib/data/headcount');
  let submitRsvp: typeof import('@/lib/data/rsvp').submitRsvp;
  let submitRsvpAction: typeof import('@/app/(public)/r/[token]/actions').submitRsvpAction;

  beforeAll(async () => {
    vi.doMock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '127.0.0.1' }) }));
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'headcount', 8);
    scope = new FixtureScope(pool);
    const wp = await import('@/lib/data/webhook-processing');
    processWebhook = (row) => wp.processWebhookEvent(row, wp.createWebhookBatchContext());
    hc = await import('@/lib/data/headcount');
    submitRsvp = (await import('@/lib/data/rsvp')).submitRsvp;
    submitRsvpAction = (await import('@/app/(public)/r/[token]/actions')).submitRsvpAction;
  });
  afterEach(() => {
    provider.sends.length = 0;
    provider.onSend = null;
    provider.onConfig = null;
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

  // ═══ sanity: the happy path the races below deviate from ═══════════════════════
  describe('baseline (sequential, provider accepts)', () => {
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

  // ═══ finding 2 — overlapping operations ════════════════════════════════════════
  describe('finding 2: overlapping headcount operations', () => {
    it.fails('KNOWN BUG 2a: two overlapping requestHeadcount calls send the question once', async () => {
      const f = await scope.create();
      const b = barrier(2);
      provider.onSend = async () => {
        await b.arrive(); // both callers passed the answered_at check before either sent
        return { kind: 'accepted', providerId: `wamid.fake.${randomUUID()}` };
      };
      await Promise.all([scope.track(hc.requestHeadcount(f.guestId, f.contactId)), scope.track(hc.requestHeadcount(f.guestId, f.contactId))]);
      expect(questions()).toHaveLength(1);
    });

    it('characterization 2a: both overlapping callers reach the provider — two questions', async () => {
      const f = await scope.create();
      const b = barrier(2);
      provider.onSend = async () => {
        await b.arrive();
        return { kind: 'accepted', providerId: `wamid.fake.${randomUUID()}` };
      };
      await Promise.all([scope.track(hc.requestHeadcount(f.guestId, f.contactId)), scope.track(hc.requestHeadcount(f.guestId, f.contactId))]);
      expect(b.arrived).toBe(2);
      expect(questions()).toHaveLength(2);
    });

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

    it.fails('KNOWN BUG 2b: a reply that arrives while the question send is still in flight is not lost', async () => {
      const f = await scope.create();
      const sending = deferred();
      const release = deferred();
      provider.onSend = async () => {
        sending.resolve();
        await release.promise; // provider call not yet returned → no request marker yet
        return { kind: 'accepted', providerId: `wamid.fake.${randomUUID()}` };
      };
      const ask = scope.track(hc.requestHeadcount(f.guestId, f.contactId));
      await sending.promise;
      provider.onSend = null;
      await processRow(await text(f, '3'));
      release.resolve();
      await ask;
      expect((await guest(f)).confirmed_headcount).toBe(3);
    });

    it('characterization 2b: the in-flight reply is ignored, then the marker is written — the guest stays "awaiting" forever', async () => {
      const f = await scope.create();
      const sending = deferred();
      const release = deferred();
      provider.onSend = async () => {
        sending.resolve();
        await release.promise;
        return { kind: 'accepted', providerId: `wamid.fake.${randomUUID()}` };
      };
      const ask = scope.track(hc.requestHeadcount(f.guestId, f.contactId));
      await sending.promise;
      provider.onSend = null;
      await processRow(await text(f, '3'));
      release.resolve();
      await ask;
      const g = await guest(f);
      expect(g).toMatchObject({ confirmed_headcount: 0, headcount_answered_at: null });
      expect(g.headcount_requested_at).not.toBeNull();
      expect(acks()).toHaveLength(0);
    });

    it.fails('KNOWN BUG 2c: two overlapping numeric replies record one answer and send one ack', async () => {
      const f = await scope.create();
      await asked(f);
      const b = barrier(2);
      provider.onConfig = () => b.arrive(); // both replies passed the "awaiting" SELECT
      await Promise.all([processRow(await text(f, '3')), processRow(await text(f, '5'))]);
      expect(acks()).toHaveLength(1);
    });

    it('characterization 2c: both overlapping replies pass the SELECT and both UPDATE — last write wins, two acks', async () => {
      const f = await scope.create();
      await asked(f);
      const b = barrier(2);
      provider.onConfig = () => b.arrive();
      const [r3, r5] = [await text(f, '3'), await text(f, '5')];
      await Promise.all([processRow(r3), processRow(r5)]);
      expect(b.arrived).toBe(2);
      expect(acks()).toHaveLength(2);
      expect([3, 5]).toContain((await guest(f)).confirmed_headcount);
      expect(await billed(f)).toBe(1);
    });

    it.fails('KNOWN BUG 2d: a web-page answer committed while a WhatsApp reply is in flight is not overwritten', async () => {
      const f = await scope.create();
      await asked(f);
      const reached = deferred();
      const release = deferred();
      provider.onConfig = async () => {
        reached.resolve();
        await release.promise;
      };
      const bot = processRow(await text(f, '7'));
      await reached.promise; // the bot already selected the guest as "awaiting"
      provider.onConfig = null;
      const fd = new FormData();
      for (const [k, v] of Object.entries({ status: 'attending', adults: '2', kids: '1' })) fd.set(k, v);
      expect(await submitRsvpAction(f.rsvpToken, {} as never, fd)).toMatchObject({ notice: expect.any(String) });
      release.resolve();
      await bot;
      expect(await guest(f)).toMatchObject({ confirmed_adults: 2, confirmed_kids: 1, confirmed_headcount: 3 });
    });

    it('characterization 2d: the in-flight bot UPDATE (no answered_at guard) replaces the web 2+1 with 7+0', async () => {
      const f = await scope.create();
      await asked(f);
      const reached = deferred();
      const release = deferred();
      provider.onConfig = async () => {
        reached.resolve();
        await release.promise;
      };
      const bot = processRow(await text(f, '7'));
      await reached.promise;
      provider.onConfig = null;
      const fd = new FormData();
      for (const [k, v] of Object.entries({ status: 'attending', adults: '2', kids: '1' })) fd.set(k, v);
      await submitRsvpAction(f.rsvpToken, {} as never, fd);
      expect(await guest(f)).toMatchObject({ confirmed_adults: 2, confirmed_kids: 1, confirmed_headcount: 3 });
      release.resolve();
      await bot;
      expect(await guest(f)).toMatchObject({ confirmed_adults: 7, confirmed_kids: 0, confirmed_headcount: 7 });
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

    it.fails('KNOWN BUG 2f: two overlapping "0" replies count two attempts (or re-ask once)', async () => {
      const f = await scope.create();
      await asked(f, 1);
      const b = barrier(2);
      provider.onConfig = () => b.arrive();
      await Promise.all([processRow(await text(f, '0')), processRow(await text(f, '0'))]);
      const g = await guest(f);
      expect(questions().length === 1 || g.headcount_attempts === 3).toBe(true);
    });

    it('characterization 2f: overlapping "0" replies — two re-asks sent, attempts written as 2 (lost update)', async () => {
      const f = await scope.create();
      await asked(f, 1);
      const b = barrier(2);
      provider.onConfig = () => b.arrive();
      await Promise.all([processRow(await text(f, '0')), processRow(await text(f, '0'))]);
      expect(questions()).toHaveLength(2);
      expect((await guest(f)).headcount_attempts).toBe(2);
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

    it.fails('KNOWN BUG E3b: two concurrent retries of a crashed numeric reply record the headcount', async () => {
      const f = await scope.create();
      await asked(f);
      const id = `wamid.${f.tag}.hc-crash2`;
      await crashedAfterInsert(f, id);
      const row = await text(f, '4', id);
      await Promise.all([processRow(row), processRow(row)]);
      expect((await guest(f)).confirmed_headcount).toBe(4);
    });

    it('characterization E3b: concurrent retries — billed exactly once, headcount dropped by both (fresh=false)', async () => {
      const f = await scope.create();
      await asked(f);
      const id = `wamid.${f.tag}.hc-crash2`;
      await crashedAfterInsert(f, id);
      const row = await text(f, '4', id);
      await Promise.all([processRow(row), processRow(row)]);
      expect(await billed(f)).toBe(1);
      expect(await guest(f)).toMatchObject({ confirmed_headcount: 0, headcount_answered_at: null });
      expect(acks()).toHaveLength(0);
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
