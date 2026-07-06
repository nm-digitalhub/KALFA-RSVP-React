// Standing DB-contract integration check (run: npm run verify:db).
//
// Guards the assumptions application code makes about the LIVE database, so an
// infrastructure upgrade (PostgREST / Supabase CLI / Postgres) that silently
// changes them fails loudly here instead of in production:
//
//   1. Unique-violation errors still carry SQLSTATE 23505 AND the exact
//      constraint name inside message/details — the friendly field errors
//      (phone taken / group name taken) key on those names.
//   2. Quantity CHECK constraints actually reject negative values at the table.
//   3. Business rule: a headcount counts ONLY while the answer that produced
//      it is current — a new submit_rsvp answer resets the WhatsApp headcount.
//   4. guest_totals returns exactly one zero row for an event with no guests.
//   5. over_invited (computed field) flags the business overage per the exact
//      4-condition rule, and guest_totals exposes the derived overage fields.
//
// Uses the service key from .env.local (server-side only). All synthetic rows
// are created under a throwaway guest in the given event and deleted at the
// end, success or failure.

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const EVENT_ID = process.env.VERIFY_EVENT_ID ?? '294d23e1-6be9-4b4f-ad79-4d10f4a6e31b';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local)');
  process.exit(2);
}
const db = createClient(url, key);

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

const token = randomBytes(16).toString('hex');
const phone = `059${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
let guestId = null;
let groupId = null;

try {
  // --- setup: throwaway guest (unique fake phone) -------------------------
  const g = await db
    .from('guests')
    .insert({ event_id: EVENT_ID, full_name: 'בדיקת חוזי DB — למחיקה', phone, rsvp_token: token, expected_count: 2 })
    .select('id')
    .single();
  if (g.error) throw new Error(`setup guest failed: ${g.error.message}`);
  guestId = g.data.id;

  // --- 1a. duplicate phone → 23505 + constraint name in the error ---------
  const dupPhone = await db
    .from('guests')
    .insert({ event_id: EVENT_ID, full_name: 'כפול', phone: `05 9-${phone.slice(3)}` })
    .select('id')
    .single();
  check(
    'phone unique violation carries code 23505 + guests_event_phone_key',
    dupPhone.error?.code === '23505' &&
      `${dupPhone.error?.message ?? ''}${dupPhone.error?.details ?? ''}`.includes('guests_event_phone_key'),
    dupPhone.error ? `code=${dupPhone.error.code}` : 'INSERT UNEXPECTEDLY SUCCEEDED',
  );

  // --- 1b. duplicate group name → 23505 + constraint name -----------------
  const gr = await db
    .from('guest_groups')
    .insert({ event_id: EVENT_ID, name: 'בדיקת חוזים' })
    .select('id')
    .single();
  if (gr.error) throw new Error(`setup group failed: ${gr.error.message}`);
  groupId = gr.data.id;
  const dupGroup = await db
    .from('guest_groups')
    .insert({ event_id: EVENT_ID, name: ' בדיקת  חוזים ' })
    .select('id')
    .single();
  check(
    'group-name unique violation carries code 23505 + guest_groups_event_name_key (normalized)',
    dupGroup.error?.code === '23505' &&
      `${dupGroup.error?.message ?? ''}${dupGroup.error?.details ?? ''}`.includes('guest_groups_event_name_key'),
    dupGroup.error ? `code=${dupGroup.error.code}` : 'INSERT UNEXPECTEDLY SUCCEEDED',
  );

  // --- 2. table-level CHECKs reject negatives -----------------------------
  const neg = await db.from('guests').update({ confirmed_adults: -1 }).eq('id', guestId);
  check(
    'negative confirmed_adults rejected by table CHECK (23514)',
    neg.error?.code === '23514',
    neg.error ? `code=${neg.error.code}` : 'UPDATE UNEXPECTEDLY SUCCEEDED',
  );

  // --- 3. freshest answer wins: WA headcount dies with a new answer -------
  const s1 = await db.rpc('submit_rsvp', {
    _token: token, _status: 'attending', _adults: 1, _kids: 0, _meal: null, _note: null,
  });
  if (s1.error || s1.data?.ok !== true) throw new Error(`attend submit failed: ${s1.error?.message ?? JSON.stringify(s1.data)}`);
  // simulate the WhatsApp headcount answer
  const wa = await db
    .from('guests')
    .update({ confirmed_headcount: 5, confirmed_adults: 5, headcount_answered_at: new Date().toISOString() })
    .eq('id', guestId);
  if (wa.error) throw new Error(`headcount simulate failed: ${wa.error.message}`);
  const s2 = await db.rpc('submit_rsvp', {
    _token: token, _status: 'declined', _adults: 0, _kids: 0, _meal: null, _note: null,
  });
  if (s2.error || s2.data?.ok !== true) throw new Error(`decline submit failed: ${s2.error?.message ?? JSON.stringify(s2.data)}`);
  const after = await db
    .from('guests')
    .select('status, confirmed_headcount, headcount_answered_at, confirmed_adults')
    .eq('id', guestId)
    .single();
  check(
    'declining clears the stale WhatsApp headcount (freshest answer wins)',
    after.data?.status === 'declined' &&
      after.data?.confirmed_headcount === 0 &&
      after.data?.headcount_answered_at === null &&
      after.data?.confirmed_adults === 0,
    JSON.stringify(after.data),
  );

  // totals must not count the declined row's old headcount
  const t = await db.rpc('guest_totals', { _event_id: EVENT_ID });
  check(
    'guest_totals gates attending_people strictly by status=attending',
    !t.error && typeof t.data?.attending_people === 'number' && t.data.attending_people === 0,
    `attending_people=${t.data?.attending_people}`,
  );

  // --- 5. over_invited: the 4-condition business rule ----------------------
  const s3 = await db.rpc('submit_rsvp', {
    _token: token, _status: 'attending', _adults: 1, _kids: 0, _meal: null, _note: null,
  });
  if (s3.error || s3.data?.ok !== true) throw new Error(`re-attend failed: ${s3.error?.message ?? JSON.stringify(s3.data)}`);
  // attending within the invited size (1 <= 2) → NOT flagged
  const notOver = await db.from('guests').select('over_invited').eq('id', guestId).single();
  check(
    'attending within the invited size is NOT flagged',
    notOver.data?.over_invited === false,
    JSON.stringify(notOver.data),
  );
  // WhatsApp answers 5 (> expected 2) → flagged; totals expose rows+people
  const wa2 = await db
    .from('guests')
    .update({ confirmed_headcount: 5, confirmed_adults: 5, headcount_answered_at: new Date().toISOString() })
    .eq('id', guestId);
  if (wa2.error) throw new Error(`overage simulate failed: ${wa2.error.message}`);
  const over = await db.from('guests').select('over_invited').eq('id', guestId).single();
  check('a real answer above the invited size IS flagged', over.data?.over_invited === true, JSON.stringify(over.data));
  const t2 = await db.rpc('guest_totals', { _event_id: EVENT_ID });
  check(
    'guest_totals derives over_invited_rows and surplus people (5 vs 2 → +3)',
    !t2.error && t2.data?.over_invited_rows >= 1 && t2.data?.over_invited_people >= 3,
    `rows=${t2.data?.over_invited_rows} people=${t2.data?.over_invited_people}`,
  );
  // declining removes the flag together with the stale headcount
  const s4 = await db.rpc('submit_rsvp', {
    _token: token, _status: 'declined', _adults: 0, _kids: 0, _meal: null, _note: null,
  });
  if (s4.error || s4.data?.ok !== true) throw new Error(`re-decline failed: ${s4.error?.message ?? JSON.stringify(s4.data)}`);
  const cleared = await db.from('guests').select('over_invited').eq('id', guestId).single();
  check('declining clears the overage flag', cleared.data?.over_invited === false, JSON.stringify(cleared.data));

  // --- 4. empty event → exactly one zero row ------------------------------
  const empty = await db.rpc('guest_totals', { _event_id: '00000000-0000-4000-8000-000000000000' });
  check(
    'guest_totals returns a single zero row for an empty event',
    !empty.error && empty.data?.rows === 0 && empty.data?.invited_people === 0,
    JSON.stringify(empty.data),
  );
} catch (err) {
  check('script completed without unexpected errors', false, err instanceof Error ? err.message : String(err));
} finally {
  // --- cleanup (responses cascade via FK; delete children explicitly if not)
  if (guestId) {
    await db.from('rsvp_responses').delete().eq('guest_id', guestId);
    await db.from('guests').delete().eq('id', guestId);
  }
  if (groupId) await db.from('guest_groups').delete().eq('id', groupId);
}

console.log(failures === 0 ? '\nALL CONTRACTS HOLD' : `\n${failures} CONTRACT(S) BROKEN`);
process.exit(failures === 0 ? 0 : 1);
