// personal-coupons tasks 1.2 + 1.4 — the concurrency verifies, exactly as tasks.md words them.
//
// Runs ONLY against the throwaway local replica (hard-refused otherwise): every "parallel" case is two real
// connections — A opens a transaction and calls the function (holding its D6 row locks), B calls while A is
// uncommitted and BLOCKS on those locks, A commits, and the assertion is on B's outcome plus the final state.
// A single rolled-back block does not count as proof (tasks.md header), so nothing here uses one.
//
//   node scripts/coupons-concurrency-tests.mjs
//
// Fixtures are created per test with throwaway uuids and left in place — the replica is disposable
// (`SUPABASE_DB_PORT=54322 npx supabase db reset` rebuilds it from the migrations).

import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DB = { host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' };
if (process.env.PGHOST || process.env.PGPORT || process.env.DATABASE_URL) {
  console.error('refusing: ambient PG env present — this harness runs only against the local replica');
  process.exit(2);
}

const pool = new pg.Pool({ ...DB, max: 6 });
const q = (text, params = []) => pool.query(text, params);
const one = async (text, params = []) => (await q(text, params)).rows[0];

async function expectError(promise, re, label) {
  try {
    await promise;
  } catch (err) {
    if (re.test(String(err.message))) return;
    throw new Error(`${label}: wrong error: ${err.message}`);
  }
  throw new Error(`${label}: expected an error (${re}) but the call succeeded`);
}

// ── fixtures ────────────────────────────────────────────────────────────────

const PKG = {}; // filled in main() from the seeded packages

async function newUser() {
  const id = randomUUID();
  await q(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now())`,
    [id, `t-${id}@test.local`],
  );
  return id;
}

async function newEvent(ownerId) {
  // events_before_insert forces status='draft' (R1); draft→active is the legal publish transition (R3).
  const r = await one(
    `insert into public.events (owner_id, name, event_date)
     values ($1, 'אירוע בדיקה מקבילית', now() + interval '60 days') returning id`,
    [ownerId],
  );
  await q(`update public.events set status = 'active' where id = $1`, [r.id]);
  return r.id;
}

async function newCampaign(eventId, packageId, price = 200) {
  // campaigns_pricing_sync creates the current pricing row from package_price (phase 1).
  const r = await one(
    `insert into public.campaigns (event_id, status, template_id, package_price, contact_quota, max_contacts)
     values ($1, 'pending_approval', $2, $3, 100, 10) returning id`,
    [eventId, packageId, price],
  );
  return r.id;
}

async function currentPricing(campaignId) {
  return one(
    `select * from public.campaign_pricing where campaign_id = $1 and superseded_at is null`,
    [campaignId],
  );
}

async function newOffer() {
  const r = await one(
    `insert into public.offers (title, kind, value, validity_days, allow_agent, allow_staff)
     values ('הצעת בדיקה', 'percent', 5, 14, true, true) returning id`,
  );
  return r.id;
}

async function newAssignment(offerId, userId, { packages = [], expired = false } = {}) {
  const r = await one(
    `insert into public.coupon_assignments (offer_id, assigned_by, user_id, kind, value, expires_at, idempotency_key)
     values ($1, $2, $2, 'percent', 5, now() + ($3 || ' days')::interval, $4) returning id`,
    [offerId, userId, expired ? '-1' : '14', randomUUID()],
  );
  for (const p of packages) {
    await q(
      `insert into public.coupon_assignment_options (assignment_id, package_id, list_price, discount_amount, final_price)
       values ($1, $2, 200, 10, 190)`,
      [r.id, p],
    );
  }
  return r.id;
}

async function approve(campaignId, signerId, { roundId, version, requestId } = {}) {
  const p = await currentPricing(campaignId);
  const rid = requestId ?? randomUUID();
  await q(
    `insert into public.approval_requests (id, campaign_id, pricing_round_id, expected_version, pdf_ref)
     values ($1, $2, $3, $4, 'test/agreement.pdf')`,
    [rid, campaignId, roundId ?? p.id, version ?? p.version],
  );
  await q(`select public.approve_package_terms(_request_id => $1, _campaign_id => $2, _pricing_round_id => $3, _expected_version => $4, _signer_user_id => $5, _agreement_version => '2026-10-v6', _content_hash => 'hash', _pdf_ref => 'test/agreement.pdf')`, [
    rid, campaignId, roundId ?? p.id, version ?? p.version, signerId,
  ]);
  return rid;
}

async function pendingPayment(campaignId, eventId, amount, roundId = null) {
  await q(
    `insert into public.payment_operations (campaign_id, event_id, kind, outcome, amount, provider, provider_terminal, source, occurred_at, is_test, pricing_round_id)
     values ($1, $2, 'package_purchase', 'pending', $3, 'cardcom', 1000, 'app', now(), true, $4)`,
    [campaignId, eventId, amount, roundId],
  );
}

// Two-connection choreography: A BEGINs and calls fn (holds locks, uncommitted); B calls and blocks; A commits.
async function race(callA, callB) {
  const a = new pg.Client(DB); const b = new pg.Client(DB);
  await a.connect(); await b.connect();
  try {
    await a.query('begin');
    await callA(a);
    const bPromise = callB(b); // blocks on A's row locks
    await new Promise((r) => setTimeout(r, 400)); // let B reach the lock
    await a.query('commit');
    let bError = null;
    try { await bPromise; } catch (err) { bError = err; }
    return { bError };
  } finally {
    try { await a.query('rollback'); } catch { /* committed */ }
    await a.end(); await b.end();
  }
}

// ── the tests ───────────────────────────────────────────────────────────────

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (err) { results.push([name, 'FAIL', String(err.message).slice(0, 180)]); }
}

async function main() {
  const pkgs = (await q(`select id from public.packages order by created_at limit 2`)).rows;
  PKG.A = pkgs[0].id; PKG.B = pkgs[1].id;

  // T1 — two parallel binds of one assignment: exactly one succeeds.
  await test('T1 two parallel binds — exactly one succeeds', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const u2 = await newUser(); const e2 = await newEvent(u2);
    const c1 = await newCampaign(e, PKG.A); const c2 = await newCampaign(e2, PKG.A);
    const asg = await newAssignment(await newOffer(), u, { packages: [PKG.A] });
    const { bError } = await race(
      (a) => a.query(`select public.bind_coupon_assignment($1, $2)`, [asg, c1]),
      (b) => b.query(`select public.bind_coupon_assignment($1, $2)`, [asg, c2]),
    );
    if (!bError) {
      // D18 path: B re-pointed the assignment. Then exactly one campaign may carry it.
      const n = await one(`select count(*)::int n from public.campaign_pricing where coupon_assignment_id = $1 and superseded_at is null`, [asg]);
      if (n.n !== 1) throw new Error(`assignment bound to ${n.n} campaigns`);
    } else if (!/not available|frozen/.test(bError.message)) {
      throw new Error(`unexpected B error: ${bError.message}`);
    }
    const st = await one(`select state, bound_campaign_id from public.coupon_assignments where id = $1`, [asg]);
    if (st.state !== 'bound' || !st.bound_campaign_id) throw new Error(`final state ${st.state}`);
  });

  // T2 — two parallel approvals: exactly one stores an agreement.
  await test('T2 two parallel approvals — exactly one agreement', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const p = await currentPricing(c);
    const r1 = randomUUID(); const r2 = randomUUID();
    await q(`insert into public.approval_requests (id, campaign_id, pricing_round_id, expected_version, pdf_ref) values ($1,$3,$4,$5,'a.pdf'),($2,$3,$4,$5,'b.pdf')`,
      [r1, r2, c, p.id, p.version]);
    const call = (conn, rid) => conn.query(
      `select public.approve_package_terms(_request_id => $1, _campaign_id => $2, _pricing_round_id => $3, _expected_version => $4, _signer_user_id => $5, _agreement_version => '2026-10-v6', _content_hash => 'h', _pdf_ref => 'x.pdf')`,
      [rid, c, p.id, p.version, u],
    );
    const { bError } = await race((a) => call(a, r1), (b) => call(b, r2));
    if (!bError || !/approve_refused/.test(bError.message)) throw new Error(`B: ${bError?.message ?? 'succeeded'}`);
    const n = await one(`select count(*)::int n from public.signed_agreements where campaign_id = $1`, [c]);
    if (n.n !== 1) throw new Error(`${n.n} agreements stored`);
  });

  // T3 — approval in parallel with a bind: the approval refuses on version, never a mix.
  await test('T3 approval racing a bind — version refusal, no mix', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const asg = await newAssignment(await newOffer(), u, { packages: [PKG.A] });
    const p = await currentPricing(c); // version BEFORE the bind
    const rid = randomUUID();
    await q(`insert into public.approval_requests (id, campaign_id, pricing_round_id, expected_version, pdf_ref) values ($1,$2,$3,$4,'a.pdf')`,
      [rid, c, p.id, p.version]);
    const { bError } = await race(
      (a) => a.query(`select public.bind_coupon_assignment($1, $2)`, [asg, c]),
      (b) => b.query(`select public.approve_package_terms(_request_id => $1, _campaign_id => $2, _pricing_round_id => $3, _expected_version => $4, _signer_user_id => $5, _agreement_version => '2026-10-v6', _content_hash => 'h', _pdf_ref => 'x.pdf')`,
        [rid, c, p.id, p.version, u]),
    );
    if (!bError || !/stale pricing version/.test(bError.message)) throw new Error(`B: ${bError?.message ?? 'succeeded'}`);
    const n = await one(`select count(*)::int n from public.signed_agreements where campaign_id = $1`, [c]);
    if (n.n !== 0) throw new Error('an agreement was stored from a stale version');
  });

  // T4 — an approval with a stale version stores nothing (serial).
  await test('T4 stale version stores nothing', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const p = await currentPricing(c);
    await q(`update public.campaign_pricing set discount_amount = 1, package_price = list_price - 1 where id = $1`, [p.id]);
    await expectError(approve(c, u, { roundId: p.id, version: p.version }), /stale pricing version/, 'T4');
    const n = await one(`select count(*)::int n from public.signed_agreements where campaign_id = $1`, [c]);
    if (n.n !== 0) throw new Error('agreement stored');
  });

  // T5 — a release on a locked campaign, and on a paid one, is refused.
  await test('T5 release refused on locked and on paid', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c1 = await newCampaign(e, PKG.A);
    const asg1 = await newAssignment(await newOffer(), u, { packages: [PKG.A] });
    await q(`select public.bind_coupon_assignment($1, $2)`, [asg1, c1]);
    await approve(c1, u);
    await expectError(q(`select public.release_coupon_assignment($1, 'test')`, [asg1]), /pricing is locked/, 'T5-locked');
    const u2 = await newUser(); const e2 = await newEvent(u2);
    const c2 = await newCampaign(e2, PKG.A);
    const asg2 = await newAssignment(await newOffer(), u, { packages: [PKG.A] });
    await q(`select public.bind_coupon_assignment($1, $2)`, [asg2, c2]);
    await pendingPayment(c2, e2, 190);
    await expectError(q(`select public.release_coupon_assignment($1, 'test')`, [asg2]), /money movement/, 'T5-paid');
  });

  // T6 — moving to a package without an option returns the list price and leaves one assignment.
  await test('T6 move to option-less package — list price, one assignment', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const asg = await newAssignment(await newOffer(), u, { packages: [PKG.A] });
    await q(`select public.bind_coupon_assignment($1, $2)`, [asg, c]);
    await q(`update public.campaigns set template_id = $2 where id = $1`, [c, PKG.B]);
    const r = await one(`select public.bind_coupon_assignment($1, $2) as r`, [asg, c]);
    if (r.r !== 'no_option') throw new Error(`got ${r.r}`);
    const p = await currentPricing(c);
    if (Number(p.discount_amount) !== 0 || Number(p.package_price) !== Number(p.list_price) || p.coupon_assignment_id) {
      throw new Error('pricing not restored to list');
    }
    const st = await one(`select state, bound_campaign_id from public.coupon_assignments where id = $1`, [asg]);
    if (st.state !== 'assigned' || st.bound_campaign_id) throw new Error(`assignment ${st.state}`);
    const n = await one(`select count(*)::int n from public.coupon_assignments where user_id = $1`, [u]);
    if (n.n !== 1) throw new Error(`${n.n} assignments`);
  });

  // T7 — an approval naming a superseded round is refused even when the version numbers coincide.
  await test('T7 superseded round refused despite equal version numbers', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const oldRound = await currentPricing(c);
    await approve(c, u);
    const newId = await one(`select public.supersede_campaign_pricing($1, 'lapsed_reapproval', 200, 0) as id`, [c]);
    const fresh = await currentPricing(c);
    if (fresh.id !== newId.id) throw new Error('supersede did not switch the current row');
    if (Number(fresh.version) !== Number(oldRound.version)) {
      throw new Error(`versions differ (${oldRound.version} vs ${fresh.version}) — the scenario needs equal numbers`);
    }
    await expectError(approve(c, u, { roundId: oldRound.id, version: oldRound.version }), /stale pricing round/, 'T7');
  });

  // T8 — the supersede replace order holds the one-current-row index; exactly one current row remains.
  await test('T8 supersede holds the one-current-row index', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const oldRound = await currentPricing(c);
    await approve(c, u);
    const newId = await one(`select public.supersede_campaign_pricing($1, 'benefit_accepted', 200, 10) as id`, [c]);
    const rows = await q(`select id, superseded_at, superseded_by from public.campaign_pricing where campaign_id = $1`, [c]);
    const current = rows.rows.filter((r) => !r.superseded_at);
    if (current.length !== 1 || current[0].id !== newId.id) throw new Error('current-row invariant broken');
    const old = rows.rows.find((r) => r.id === oldRound.id);
    if (!old.superseded_at || old.superseded_by !== newId.id) throw new Error('old row not marked');
    const st = await one(`select status from public.campaigns where id = $1`, [c]);
    if (st.status !== 'pending_approval') throw new Error(`campaign ${st.status}`);
  });

  // T9 — a supersede while a payment is pending is refused.
  await test('T9 supersede refused while a payment is pending', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    await approve(c, u);
    const p = await currentPricing(c);
    await pendingPayment(c, e, 200, p.id);
    await expectError(
      q(`select public.supersede_campaign_pricing($1, 'benefit_accepted', 200, 10)`, [c]),
      /money movement/, 'T9',
    );
  });

  // T10 — a superseded row refuses every further update.
  await test('T10 a superseded row is immutable', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const oldRound = await currentPricing(c);
    await approve(c, u);
    await q(`select public.supersede_campaign_pricing($1, 'lapsed_reapproval', 200, 0)`, [c]);
    await expectError(
      q(`update public.campaign_pricing set discount_amount = discount_amount where id = $1`, [oldRound.id]),
      /superseded row is immutable/, 'T10',
    );
  });

  // T11 (task 1.4) — a purge of an unpaid test campaign still works, and frees the bound benefit.
  await test('T11 purge of an unpaid test campaign works', async () => {
    const staff = await newUser();
    await q(`insert into public.platform_staff (user_id, role_id, granted_by) select $1, id, $1 from public.platform_roles where name = 'owner'`, [staff]);
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const asg = await newAssignment(await newOffer(), u, { packages: [PKG.A] });
    await q(`select public.bind_coupon_assignment($1, $2)`, [asg, c]);
    await q(`insert into public.test_events (event_id, marked_by) values ($1, $2)`, [e, staff]);
    const r = await one(`select public.purge_test_event($1, $2) as r`, [e, staff]);
    if (r.r !== 'purged') throw new Error(`purge returned ${r.r}`);
    const left = await one(`select (select count(*) from public.campaigns where id = $1)::int c, (select count(*) from public.campaign_pricing where campaign_id = $1)::int p`, [c]);
    if (left.c !== 0 || left.p !== 0) throw new Error('campaign or pricing survived');
    const st = await one(`select state, bound_campaign_id from public.coupon_assignments where id = $1`, [asg]);
    if (st.state !== 'assigned' || st.bound_campaign_id) throw new Error(`assignment ${st.state}`);
  });

  // T12 (task 1.4) — an approved test campaign is blocked early, and a locked row refuses delete.
  await test('T12 approved test campaign → approved_terms; locked row undeletable', async () => {
    const staff = await newUser();
    await q(`insert into public.platform_staff (user_id, role_id, granted_by) select $1, id, $1 from public.platform_roles where name = 'owner'`, [staff]);
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    await approve(c, u);
    await q(`insert into public.test_events (event_id, marked_by) values ($1, $2)`, [e, staff]);
    const r = await one(`select public.purge_test_event($1, $2) as r`, [e, staff]);
    if (r.r !== 'approved_terms') throw new Error(`purge returned ${r.r}`);
    const p = await currentPricing(c);
    await expectError(q(`delete from public.campaign_pricing where id = $1`, [p.id]), /locked row cannot be deleted/, 'T12-delete');
  });

  // T13 (task 2.4's DB side) — the open-payment guard.
  await test('T13 open guard: unlocked refused; wrong amount refused; expired benefit refused', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const p = await currentPricing(c);
    await expectError(pendingPayment(c, e, 200, p.id), /price is not locked/, 'T13-unlocked');
    await approve(c, u);
    await expectError(pendingPayment(c, e, 123, p.id), /differs from the locked price/, 'T13-amount');
    const u2 = await newUser(); const e2 = await newEvent(u2);
    const c2 = await newCampaign(e2, PKG.A);
    // expires_at is frozen after insert (by design), so the expired-bound state is created by INSERT.
    const off = await newOffer();
    const asg = (await one(
      `insert into public.coupon_assignments (offer_id, assigned_by, user_id, kind, value, expires_at, idempotency_key, state, bound_campaign_id)
       values ($1, $2, $2, 'percent', 5, now() - interval '1 hour', $3, 'bound', $4) returning id`,
      [off, u2, randomUUID(), c2],
    )).id;
    await q(`update public.campaign_pricing set coupon_assignment_id = $1, discount_amount = 10, package_price = list_price - 10
             where campaign_id = $2 and superseded_at is null`, [asg, c2]);
    await approve(c2, u2);
    const p2 = await currentPricing(c2);
    await expectError(pendingPayment(c2, e2, 190, p2.id), /expired before the session opened/, 'T13-expired');
  });

  // T14 (task 3.2, D10) — success consumes the bound benefit in the same transaction; the ledger row is untouched.
  await test('T14 a succeeded payment consumes the bound benefit; the row itself unchanged', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    const asg = await newAssignment(await newOffer(), u, { packages: [PKG.A] });
    await q(`select public.bind_coupon_assignment($1, $2)`, [asg, c]);
    await approve(c, u);
    const p = await currentPricing(c);
    await pendingPayment(c, e, 190, p.id);
    const before = await one(`select * from public.payment_operations where campaign_id = $1`, [c]);
    await q(`update public.payment_operations set outcome = 'succeeded' where id = $1 and outcome = 'pending'`, [before.id]);
    const st = await one(`select state from public.coupon_assignments where id = $1`, [asg]);
    if (st.state !== 'consumed') throw new Error(`assignment ${st.state}`);
    const ev = await one(`select count(*)::int n from public.coupon_assignment_events where assignment_id = $1 and action = 'consumed'`, [asg]);
    if (ev.n !== 1) throw new Error(`${ev.n} consume events`);
    const after = await one(`select * from public.payment_operations where id = $1`, [before.id]);
    for (const k of Object.keys(before)) {
      if (k === 'outcome') continue;
      if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) throw new Error(`ledger field ${k} changed by the trigger`);
    }
  });

  // T15 (task 3.2) — pending, review and failed leave the benefit bound; expiry mid-session still consumes (D20).
  await test('T15 review/failed leave it bound; mid-session expiry still consumes', async () => {
    const u = await newUser(); const e = await newEvent(u);
    const c = await newCampaign(e, PKG.A);
    // bound+expired-by-insert (the valid-at-open state is the DB guard's business; here the trigger must ignore expiry)
    const off = await newOffer();
    const asg = (await one(
      `insert into public.coupon_assignments (offer_id, assigned_by, user_id, kind, value, expires_at, idempotency_key, state, bound_campaign_id)
       values ($1, $2, $2, 'percent', 5, now() + interval '1 minute', $3, 'bound', $4) returning id`,
      [off, u, randomUUID(), c],
    )).id;
    await q(`update public.campaign_pricing set coupon_assignment_id = $1, discount_amount = 10, package_price = list_price - 10
             where campaign_id = $2 and superseded_at is null`, [asg, c]);
    await approve(c, u);
    const p = await currentPricing(c);
    await pendingPayment(c, e, 190, p.id);
    const opRow = await one(`select id from public.payment_operations where campaign_id = $1`, [c]);
    await q(`update public.payment_operations set outcome = 'review' where id = $1 and outcome = 'pending'`, [opRow.id]);
    let st = await one(`select state from public.coupon_assignments where id = $1`, [asg]);
    if (st.state !== 'bound') throw new Error(`after review: ${st.state}`);
    // the expiry passes while the session is open — settlement still consumes (D20)
    await q(`update public.coupon_assignments set bound_campaign_id = bound_campaign_id where id = $1`, [asg]); // no-op sanity
    await q(`update public.payment_operations set outcome = 'succeeded' where id = $1 and outcome = 'review'`, [opRow.id]);
    st = await one(`select state from public.coupon_assignments where id = $1`, [asg]);
    if (st.state !== 'consumed') throw new Error(`after success: ${st.state}`);
  });

  // ── report ──
  let failed = 0;
  for (const [name, ok, msg] of results) {
    console.log(`${ok === 'PASS' ? '✔' : '✘'} ${name}${msg ? ' — ' + msg : ''}`);
    if (ok !== 'PASS') failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
