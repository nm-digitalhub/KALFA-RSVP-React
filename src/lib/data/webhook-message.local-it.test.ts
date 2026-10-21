import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

// Framework boundary only: the public RSVP server action reads request headers
// (rate-limit key). Nothing in the RSVP / webhook logic is mocked.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '127.0.0.1' }),
}));

import {
  type Fixture,
  type FixtureOptions,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';

// TS-INTEGRATION: the REAL processWebhookEvent (interactions → billing → RSVP → headcount)
// against Supabase local through PostgREST. Nothing in the call path is mocked; the only
// substitutions are the target (local stack) and the egress guard installed by
// setupFiles (any non-local connection attempt fails the test).
//
// Fixtures are committed (PostgREST works on its own connections) and removed by
// FixtureScope.cleanup(), which verifies zero residue after COMMIT.
const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;

type Row = Parameters<typeof import('@/lib/data/webhook-processing').processWebhookEvent>[0];

describe.skipIf(!RUN)('processWebhookEvent (message) — real code, local DB', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let processWebhook: (row: Row) => Promise<void>;
  let submitRsvp: typeof import('@/lib/data/rsvp').submitRsvp;
  let submitRsvpAction: typeof import('@/app/(public)/r/[token]/actions').submitRsvpAction;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'webhook-message', 6);
    scope = new FixtureScope(pool);
    const wp = await import('@/lib/data/webhook-processing');
    processWebhook = (row) => wp.processWebhookEvent(row, wp.createWebhookBatchContext());
    submitRsvp = (await import('@/lib/data/rsvp')).submitRsvp;
    submitRsvpAction = (await import('@/app/(public)/r/[token]/actions')).submitRsvpAction;
    // Precondition the assertions below rely on: no WhatsApp channel configured
    // locally, so no code path can even attempt a provider send.
    const s = await pool.query(`select coalesce(whatsapp_access_token,'') = '' as off from public.app_settings`);
    expect(s.rows.every((r) => r.off)).toBe(true);
  });
  afterAll(async () => {
    try {
      await scope.cleanup();
    } finally {
      await pool.end();
    }
  });

  const processRow = (row: Row) => scope.track(processWebhook(row));
  const fixture = (o?: FixtureOptions) => scope.create(o);
  const from = (f: Fixture) => f.phone.replace('+', '');
  const button = (f: Fixture, payload: string) => ({ type: 'button', from: from(f), button: { payload, text: payload } });
  const text = (f: Fixture, body: string) => ({ type: 'text', from: from(f), text: { body } });
  const inbox = (f: Fixture, payload: Record<string, unknown>, messageId = `wamid.${f.tag}.${randomUUID().slice(0, 6)}`) =>
    scope.insertInbox(f, { messageId, payload, contextId: f.outboundWamid }) as Promise<Row>;
  const billed = async (f: Fixture) =>
    (await pool.query(`select count(*)::int n from public.billed_results where event_id = $1`, [f.eventId])).rows[0].n as number;
  const inbound = async (f: Fixture) =>
    (await pool.query(
      `select provider_id, billing_outcome from public.contact_interactions where event_id = $1 and direction = 'in'`,
      [f.eventId],
    )).rows;
  const guest = async (f: Fixture) =>
    (await pool.query(
      `select status, confirmed_adults, confirmed_kids, meal_pref, rsvp_note, show_in_guest_list,
              confirmed_headcount, headcount_answered_at, headcount_requested_at
         from public.guests where id = $1`,
      [f.guestId],
    )).rows[0];
  // A prior attempt that crashed right after insertInteraction (before billing / RSVP).
  const simulateCrashAfterInsert = (f: Fixture, messageId: string) =>
    pool.query(
      `insert into public.contact_interactions (channel, direction, kind, provider_id, context_message_id, contact_id, event_id, campaign_id, billable)
       values ('whatsapp','in','message',$1,$2,$3,$4,$5,true)`,
      [messageId, f.outboundWamid, f.contactId, f.eventId, f.campaignId],
    );

  // ── billing ─────────────────────────────────────────────────────────────────

  it('a reply to a known outbound bills once, records the verdict, and marks the contact reached', async () => {
    const f = await fixture();
    await processRow(await inbox(f, text(f, 'תודה')));
    expect(await billed(f)).toBe(1);
    expect((await inbound(f)).map((r) => r.billing_outcome)).toEqual(['billed']);
    const c = await pool.query(`select op_status from public.contacts where id = $1`, [f.contactId]);
    expect(c.rows[0].op_status).toBe('reached_billed');
  });

  it('a redelivered inbox row (same message id) creates no second interaction and no second charge', async () => {
    const f = await fixture();
    const row = await inbox(f, text(f, 'תודה'));
    await processRow(row);
    await processRow(row);
    expect(await billed(f)).toBe(1);
    expect(await inbound(f)).toHaveLength(1);
  });

  it('two workers processing the same row concurrently still charge exactly once', async () => {
    const f = await fixture();
    const row = await inbox(f, button(f, 'rsvp_declined'));
    await Promise.all([processRow(row), processRow(row), processRow(row)]);
    expect(await billed(f)).toBe(1);
    expect(await inbound(f)).toHaveLength(1);
    expect((await guest(f)).status).toBe('declined');
  });

  it('recovery: a crash after the interaction insert is billed on the retry (billing is not gated on fresh)', async () => {
    const f = await fixture();
    const messageId = `wamid.${f.tag}.crash`;
    await simulateCrashAfterInsert(f, messageId);
    expect(await billed(f)).toBe(0);
    await processRow(await inbox(f, text(f, 'תודה'), messageId));
    expect(await billed(f)).toBe(1);
    expect((await inbound(f)).map((r) => r.billing_outcome)).toEqual(['billed']);
  });

  it('a contact outside the authorized set is not charged; the refusal is recorded on the interaction', async () => {
    const f = await fixture({ authorized: false });
    await processRow(await inbox(f, text(f, 'תודה')));
    expect(await billed(f)).toBe(0);
    expect((await inbound(f)).map((r) => r.billing_outcome)).toEqual(['not_authorized']);
  });

  it('a removal reply bills the reach first, then sets removal_requested', async () => {
    const f = await fixture();
    await processRow(await inbox(f, text(f, 'הסר')));
    expect(await billed(f)).toBe(1);
    const c = await pool.query(`select removal_requested from public.contacts where id = $1`, [f.contactId]);
    expect(c.rows[0].removal_requested).toBe(true);
  });

  it('fail-closed: a reply to an unknown message from an unknown number writes nothing and charges nothing', async () => {
    const f = await fixture();
    const row = (await scope.insertInbox(f, {
      messageId: `wamid.${f.tag}.stranger`,
      payload: { type: 'text', from: `97258${randomUUID().replace(/\D/g, '').slice(0, 7)}`, text: { body: 'מי זה?' } },
      contextId: `wamid.${f.tag}.never-sent`,
    })) as Row;
    await processRow(row);
    expect(await billed(f)).toBe(0);
    expect(await inbound(f)).toHaveLength(0);
  });

  // ── RSVP ────────────────────────────────────────────────────────────────────

  it('an RSVP button records the status, one audit response row, and the WhatsApp activity marker', async () => {
    const f = await fixture();
    await processRow(await inbox(f, button(f, 'rsvp_declined')));
    expect((await guest(f)).status).toBe('declined');
    const r = await pool.query(`select count(*)::int n from public.rsvp_responses where guest_id = $1`, [f.guestId]);
    expect(r.rows[0].n).toBe(1);
    const a = await pool.query(
      `select count(*)::int n from public.activity_log where event_id = $1 and action = 'rsvp.from_whatsapp'`,
      [f.eventId],
    );
    expect(a.rows[0].n).toBe(1);
  });

  // FINDING #1 (reproduced). submitRsvp is called from the bot with only
  // status/adults/kids; the RPC's last-write-wins projection then writes '' / false
  // over everything the guest filled on the web page. Expected to FAIL until the
  // product decision + fix land; `it.fails` turns green-on-failure so the suite
  // stays runnable, and flips red the moment the behaviour is fixed (then drop `.fails`).
  it.fails('KNOWN BUG #1: a WhatsApp "attending" press keeps the meal, note and list opt-in the guest gave on the web page', async () => {
    const f = await fixture();
    const web = await submitRsvp(f.rsvpToken, {
      status: 'attending', adults: 2, kids: 1, meal_pref: 'veg', note: 'allergic to nuts', answers: {}, show_in_guest_list: true,
    });
    expect(web.ok).toBe(true);
    await processRow(await inbox(f, button(f, 'rsvp_attending')));
    expect(await guest(f)).toMatchObject({ meal_pref: 'veg', rsvp_note: 'allergic to nuts', show_in_guest_list: true });
  });

  it('characterization of finding #1: the same press today wipes meal/note/opt-in and resets 2+1 to 1+0', async () => {
    const f = await fixture();
    await submitRsvp(f.rsvpToken, {
      status: 'attending', adults: 2, kids: 1, meal_pref: 'veg', note: 'allergic to nuts', answers: {}, show_in_guest_list: true,
    });
    await processRow(await inbox(f, button(f, 'rsvp_attending')));
    expect(await guest(f)).toMatchObject({
      status: 'attending', confirmed_adults: 1, confirmed_kids: 0, meal_pref: null, rsvp_note: null, show_in_guest_list: false,
    });
  });

  // ── finding #1, extended: every entry point that can overwrite a web answer ──
  // The web answer is given through the REAL page server action (submitRsvpAction:
  // rate limit → Zod → submit_rsvp → headcount mirror), the same code a browser runs.
  const WEB_ANSWER = {
    status: 'attending', adults: '2', kids: '1', meal_pref: 'veg', note: 'allergic to nuts',
    show_in_guest_list: 'on', call_consent: 'on',
  } as const;
  const webSubmit = async (f: Fixture, fields: Record<string, string> = WEB_ANSWER) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const res = await scope.track(submitRsvpAction(f.rsvpToken, {} as never, fd));
    expect(res, JSON.stringify(res)).toMatchObject({ notice: expect.any(String) });
  };
  const WEB_STATE = {
    status: 'attending', confirmed_adults: 2, confirmed_kids: 1, meal_pref: 'veg', rsvp_note: 'allergic to nuts',
    show_in_guest_list: true, confirmed_headcount: 3,
  };
  const pressAt = (f: Fixture, payload: string, tsSeconds: number, messageId?: string) =>
    inbox(f, { ...button(f, payload), timestamp: String(tsSeconds) }, messageId);
  const consent = async (f: Fixture) =>
    (await pool.query(`select call_consent_at from public.contacts where id = $1`, [f.contactId])).rows[0].call_consent_at;
  const responses = async (f: Fixture) =>
    (await pool.query(`select count(*)::int n from public.rsvp_responses where guest_id = $1`, [f.guestId])).rows[0].n as number;

  it('baseline: the real page action stores counts, meal, note, opt-in, consent and mirrors the headcount', async () => {
    const f = await fixture();
    await webSubmit(f);
    const g = await guest(f);
    expect(g).toMatchObject(WEB_STATE);
    expect(g.headcount_answered_at).not.toBeNull();
    expect(await consent(f)).not.toBeNull();
  });

  it.fails('KNOWN BUG #1 (page action → WhatsApp press): the press keeps every detail of the web answer', async () => {
    const f = await fixture();
    await webSubmit(f);
    await processRow(await inbox(f, button(f, 'rsvp_attending')));
    expect(await guest(f)).toMatchObject(WEB_STATE);
  });

  it('characterization #1 (page action → press): counts → 1+0, meal/note → null, opt-in → false, headcount reset; consent survives', async () => {
    const f = await fixture();
    await webSubmit(f);
    await processRow(await inbox(f, button(f, 'rsvp_attending')));
    const g = await guest(f);
    expect(g).toMatchObject({
      status: 'attending', confirmed_adults: 1, confirmed_kids: 0, meal_pref: null, rsvp_note: null,
      show_in_guest_list: false, confirmed_headcount: 0, headcount_answered_at: null, headcount_requested_at: null,
    });
    // call_consent is monotonic in submit_rsvp (coalesce(call_consent_at, now())) — not wiped.
    expect(await consent(f)).not.toBeNull();
    expect(await responses(f)).toBe(2); // web + bot: the overwrite is an audited second answer
  });

  it.fails('KNOWN BUG #1 (duplicate): a redelivered OLD press processed after a newer web answer does not overwrite it', async () => {
    const f = await fixture();
    const press = await inbox(f, button(f, 'rsvp_attending'));
    await processRow(press);
    await webSubmit(f);
    await processRow(press); // Meta redelivery / worker retry of the same row
    expect(await guest(f)).toMatchObject(WEB_STATE);
  });

  it('characterization #1 (duplicate): the replay of the same message id re-applies 1+0 over the newer web answer', async () => {
    const f = await fixture();
    const press = await inbox(f, button(f, 'rsvp_attending'));
    await processRow(press);
    await webSubmit(f);
    await processRow(press);
    expect(await guest(f)).toMatchObject({ confirmed_adults: 1, confirmed_kids: 0, meal_pref: null, show_in_guest_list: false });
    expect(await billed(f)).toBe(1); // billing stays idempotent
    expect(await inbound(f)).toHaveLength(1);
  });

  it.fails('KNOWN BUG #1 (late event): a press sent BEFORE the web answer but processed after it does not win', async () => {
    const f = await fixture();
    const sentAt = Math.floor(Date.now() / 1000) - 3600; // pressed an hour ago
    await webSubmit(f); // answered on the page since then
    await processRow(await pressAt(f, 'rsvp_declined', sentAt));
    expect(await guest(f)).toMatchObject(WEB_STATE);
  });

  it('characterization #1 (late event): the older "declined" press flips a newer attending answer to declined, 0+0', async () => {
    const f = await fixture();
    await webSubmit(f);
    await processRow(await pressAt(f, 'rsvp_declined', Math.floor(Date.now() / 1000) - 3600));
    expect(await guest(f)).toMatchObject({ status: 'declined', confirmed_adults: 0, confirmed_kids: 0, meal_pref: null, rsvp_note: null });
  });

  // Another channel: the Voximplant DTMF result through the real dispatcher
  // (event_kind 'call_result' → processCallResult → submitRsvp with 1/0 defaults).
  const callAttempt = async (f: Fixture) => {
    const id = randomUUID();
    await scope.track(
      pool.query(
        `insert into public.call_attempts (id, campaign_id, contact_id, event_id, guest_id, access_token, token_expires_at, touchpoint_index, status)
         values ($1, $2, $3, $4, $5, $6, now() + interval '1 hour', 0, 'in_progress')`,
        [id, f.campaignId, f.contactId, f.eventId, f.guestId, `tok-${f.tag}-${id.slice(0, 6)}`],
      ),
    );
    return id;
  };
  const callResult = (f: Fixture, attemptId: string, digit: '1' | '2') =>
    scope.insertInbox(f, {
      messageId: attemptId,
      eventKind: 'call_result',
      payload: { call_status: 'completed', rsvp_digit: digit, rsvp_method: 'dtmf', call_duration: 30 },
    }) as Promise<Row>;

  it.fails('KNOWN BUG #1 (other channel): a DTMF "1" after a web answer keeps the web details', async () => {
    const f = await fixture();
    await webSubmit(f);
    await processRow(await callResult(f, await callAttempt(f), '1'));
    expect(await guest(f)).toMatchObject(WEB_STATE);
  });

  it('characterization #1 (other channel): the DTMF "1" path overwrites the web answer exactly like the WhatsApp press', async () => {
    const f = await fixture();
    await webSubmit(f);
    const attemptId = await callAttempt(f);
    await processRow(await callResult(f, attemptId, '1'));
    const a = await pool.query(`select status from public.call_attempts where id = $1`, [attemptId]);
    expect(a.rows[0].status).toBe('completed'); // the real voice path ran to the RSVP step
    expect(await guest(f)).toMatchObject({ confirmed_adults: 1, confirmed_kids: 0, meal_pref: null, rsvp_note: null, show_in_guest_list: false });
  });

  it('pressing the SAME answer twice (two presses, distinct message ids) is idempotent: one RSVP row, one charge', async () => {
    const f = await fixture();
    await processRow(await inbox(f, button(f, 'rsvp_declined')));
    await processRow(await inbox(f, button(f, 'rsvp_declined')));
    expect(await responses(f)).toBe(1);
    expect(await billed(f)).toBe(1);
    expect(await inbound(f)).toHaveLength(2);
  });

  it('characterization (open decision): with a REQUIRED custom question, a WhatsApp "attending" press is dropped silently — billed, no RSVP', async () => {
    const f = await fixture();
    await scope.track(
      pool.query(
        `insert into public.event_questions (event_id, q_key, label, required) values ($1, 'diet', 'Diet', true)`,
        [f.eventId],
      ),
    );
    await processRow(await inbox(f, button(f, 'rsvp_attending')));
    expect((await guest(f)).status).not.toBe('attending'); // submit_rsvp → missing_required
    expect(await responses(f)).toBe(0);
    expect(await billed(f)).toBe(1);
  });

  // ── headcount ───────────────────────────────────────────────────────────────

  const awaitHeadcount = (f: Fixture) =>
    pool.query(
      `update public.guests set status = 'attending', headcount_requested_at = now(), headcount_answered_at = null, headcount_attempts = 1
        where id = $1`,
      [f.guestId],
    );

  it('a numeric reply from a guest who was asked stores the headcount as the canonical adults/kids pair', async () => {
    const f = await fixture();
    await awaitHeadcount(f);
    await processRow(await inbox(f, text(f, ' 3 ')));
    const g = await guest(f);
    expect(g).toMatchObject({ confirmed_headcount: 3, confirmed_adults: 3, confirmed_kids: 0 });
    expect(g.headcount_answered_at).not.toBeNull();
  });

  it('a numeric reply after the guest already answered on the web page does not overwrite it', async () => {
    const f = await fixture();
    await pool.query(
      `update public.guests set status = 'attending', confirmed_adults = 2, confirmed_kids = 2, confirmed_headcount = 4,
              headcount_requested_at = now(), headcount_answered_at = now() where id = $1`,
      [f.guestId],
    );
    await processRow(await inbox(f, text(f, '7')));
    expect(await guest(f)).toMatchObject({ confirmed_headcount: 4, confirmed_adults: 2, confirmed_kids: 2 });
  });

  // FINDING E3 (reproduced). The headcount branch is gated on `fresh`: when the first
  // delivery crashed after insertInteraction, the retry sees fresh=false and drops the
  // guest's number for good (the billing branch right above is NOT gated and recovers).
  it.fails('KNOWN BUG E3: a retried numeric reply (first attempt crashed after the insert) still records the headcount', async () => {
    const f = await fixture();
    await awaitHeadcount(f);
    const messageId = `wamid.${f.tag}.hc-crash`;
    await simulateCrashAfterInsert(f, messageId);
    await processRow(await inbox(f, text(f, '3'), messageId));
    expect((await guest(f)).confirmed_headcount).toBe(3);
  });
});
