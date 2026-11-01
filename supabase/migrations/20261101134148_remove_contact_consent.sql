-- Remove the per-contact consent gates (WhatsApp and AI call) entirely.
--
-- WHY
--   Owner decision, 01.11.2026: RSVP outreach (invitations, reminders, calls, thank-you) is not advertising, so a guest
--   needs no recorded prior consent to be contacted. The two admin switches that could lift the gates were already off
--   in production (app_settings.whatsapp_consent_required = false, call_compliance_settings.call_consent_required =
--   false, read 01.11.2026), so the gates blocked nothing; this removes the code and the data behind them.
--   A guest who asks not to be contacted (contacts.removal_requested) is still never contacted — that is unchanged.
--
-- WHAT IT DOES
--   1. call_dispatch_status reason: 'no_call_consent' becomes 'removal_requested'. The dispatcher no longer checks call
--      consent; the only per-contact refusal left in that slot is an opted-out contact. call_dispatch_status had no
--      rows in production (read 01.11.2026), so no row carries the old value. Recreated verbatim with that one value
--      swapped (the same approach as 20261004081706); call-dispatch-status.test.ts reads THIS file as the live contract.
--   2. public.submit_rsvp loses its trailing `_call_consent boolean` parameter and the block that stamped
--      contacts.call_consent_at. Everything else is the live text (read back from the linked project 01.11.2026; md5 of
--      pg_get_functiondef matched the local database built from 20260714193500). A new parameter list is a new function
--      identity, so the 9-argument function is dropped and the 8-argument one created; the grant posture is restored
--      (service_role only, as 20260714193500 set it).
--   3. public.get_rsvp_by_token stops returning the guest's `call_consent` flag. Same signature, so CREATE OR REPLACE
--      keeps its ACL.
--   4. Drops contacts.whatsapp_consent_at, contacts.call_consent_at, app_settings.whatsapp_consent_required and
--      call_compliance_settings.call_consent_required. call_compliance_settings keeps dnc_registry_gate_enabled.
--   5. Verifies the end state; any failed check rolls the whole file back.
--
-- WHAT IT DOES NOT DO
--   - contacts.removal_requested, the call_dnc_list table and the DNC registry gate are untouched.
--   - No other function, view or policy references the dropped columns (pg_proc / pg_views / pg_policies searched
--     locally 01.11.2026: only submit_rsvp and get_rsvp_by_token did).
--
-- DEPLOY ORDER — push this AFTER the application code of the same change is deployed, BOTH processes:
--   - the web app (kalfa-beta), and
--   - the pg-boss worker (kalfa-worker, a separate bundle: dist/worker.cjs). `npm run deploy` rebuilds and restarts it
--     through scripts/worker-build-restart.mjs (the bundle changes with this change, so it restarts).
--   The old code passes `_call_consent` to submit_rsvp (public link, WhatsApp button, call result) and selects
--   contacts.whatsapp_consent_at in the step path; against this schema those RSVPs would fail ("function not found") and
--   every due step would read no contact and be skipped. The new code passes no `_call_consent` and reads none of the
--   columns, so it works against both the old schema and this one.
--   After the push: `npm run gen:types`, then `npm run types:check` (types.generated.ts is generated from the linked
--   project, so it can only drop these columns once they are gone there).
--
-- house assumption (same as 20261101081450): `supabase db push` applies a migration file as ONE transaction.
--
-- ROLLBACK (manual; the dropped consent timestamps are NOT recoverable — 38 of 44 contacts carried whatsapp_consent_at
-- and 1 carried call_consent_at on 01.11.2026)
--   alter table public.contacts add column whatsapp_consent_at timestamptz, add column call_consent_at timestamptz;
--   alter table public.app_settings add column whatsapp_consent_required boolean not null default true;
--   alter table public.call_compliance_settings add column call_consent_required boolean not null default true;
--   drop function public.submit_rsvp(text, text, integer, integer, text, text, jsonb, boolean);
--   then re-run the submit_rsvp and get_rsvp_by_token definitions and grants from
--   20260714193500_voximplant_b1_rsvp_call_consent.sql, and the reason CHECK from
--   20261004081706_campaign_contact_quota_gate_support.sql (first make sure no row carries 'removal_requested').

set local lock_timeout = '10s';

-- 1. Dispatch reason: no_call_consent -> removal_requested ---------------------------------------------------------
alter table public.call_dispatch_status
  drop constraint call_dispatch_status_reason_check;

alter table public.call_dispatch_status
  add constraint call_dispatch_status_reason_check
  check (reason is null or reason in
    ('already_reached', 'outside_dial_window', 'removal_requested', 'dnc_listed',
     'campaign_not_active', 'event_closed', 'concurrent_owner',
     'max_concurrency', 'campaign_hour_cap', 'outreach_disabled',
     'config_missing', 'live_calls_disabled', 'balance_below_reserve',
     'already_dispatched', 'already_concluded', 'failed_to_start',
     'start_unknown', 'temporary_dispatch_failure', 'waiting_for_quota'));

-- 2. submit_rsvp without call consent -----------------------------------------------------------------------------
drop function public.submit_rsvp(text, text, integer, integer, text, text, jsonb, boolean, boolean);

create function public.submit_rsvp(
  _token text,
  _status text,
  _adults integer,
  _kids integer,
  _meal text,
  _note text,
  _answers jsonb default '{}'::jsonb,
  _show_in_list boolean default false
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  _g          public.guests;
  _e          public.events;
  _answers_in jsonb   := coalesce(_answers, '{}'::jsonb);
  _adults_n   integer := greatest(coalesce(_adults, 0), 0);
  _kids_n     integer := greatest(coalesce(_kids, 0), 0);
  _attending  boolean;
  _total      integer;
  _meal_n     text;
  _note_n     text;
  _show_list_n boolean;
  _q          record;
  _val        text;
  _last       public.rsvp_responses;
begin
  -- (a) status whitelist.
  if _status is null or _status not in ('attending', 'declined', 'maybe') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  -- (b) resolve + LOCK the guest by token; revoked or unknown token are both
  --     'not_found' (no enumeration signal). The lock makes the idempotency
  --     check below race-safe under concurrent submits.
  select * into _g
    from public.guests
   where rsvp_token = _token
     and rsvp_token_revoked_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- (c) event gates: active + NOT a past event day + deadline (Asia/Jerusalem).
  select * into _e from public.events where id = _g.event_id;
  if not found or _e.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  -- L2: a past event (calendar day in Israel) is closed for RSVP, regardless of
  -- the deadline. NULL event_date does not gate.
  if _e.event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date
           > (_e.event_date at time zone 'Asia/Jerusalem')::date then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if _e.rsvp_deadline is not null
     and (now() at time zone 'Asia/Jerusalem')::date > _e.rsvp_deadline then
    return jsonb_build_object('ok', false, 'reason', 'deadline_passed');
  end if;

  -- (d) normalize per status. attending: 1 <= adults+kids <= expected_count
  --     (no upper cap when expected_count IS NULL). declined/maybe: counts 0 and
  --     meal cleared (a meal preference is only meaningful when attending).
  _attending := case _status when 'attending' then true
                             when 'declined'  then false
                             else null end;  -- 'maybe'

  if _status = 'attending' then
    _total := _adults_n + _kids_n;
    if _total < 1 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_count');
    end if;
    if _g.expected_count is not null and _total > _g.expected_count then
      return jsonb_build_object('ok', false, 'reason', 'invalid_count');
    end if;
    -- Owner toggle (events.show_meal_pref): when collection is disabled the
    -- field is not rendered, and any submitted value is ignored server-side.
    _meal_n := case when _e.show_meal_pref
                    then nullif(btrim(_meal), '')
                    else null end;
    -- Guest opt-in for the "who's coming" list; only meaningful when attending.
    _show_list_n := coalesce(_show_in_list, false);
  else
    _adults_n := 0;
    _kids_n   := 0;
    _meal_n   := null;
    -- Defense in depth: get_event_attendees_public already filters on
    -- status = 'attending', but a declined/maybe guest is never opted in here.
    _show_list_n := false;
  end if;
  _note_n := nullif(btrim(_note), '');

  -- (e) validate custom answers against the event's questions (defense in depth,
  --     not only Zod). Unknown key = not a question for this event AT ALL (any
  --     enabled state) -> reject. required / options validated on the currently
  --     ENABLED questions only. Options contract: q.options is a jsonb array of
  --     scalar allowed values; a single scalar answer must be a member. Free
  --     text capped at 500 chars.
  if exists (
    select 1
      from jsonb_object_keys(_answers_in) k
     where k not in (
       select q.q_key from public.event_questions q where q.event_id = _g.event_id
     )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
  end if;

  for _q in
    select q_key, q_type, required, options
      from public.event_questions
     where event_id = _g.event_id and enabled = true
  loop
    _val := _answers_in ->> _q.q_key;
    if _q.required and coalesce(btrim(_val), '') = '' then
      return jsonb_build_object('ok', false, 'reason', 'missing_required');
    end if;
    if _val is not null then
      if length(_val) > 500 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      if jsonb_typeof(_q.options) = 'array'
         and not (_q.options @> to_jsonb(_val)) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
    end if;
  end loop;

  -- (f) idempotency: compare the NORMALIZED payload to the guest's most recent
  --     response (the response row is the only record that carries the custom
  --     answers), PLUS the opt-in flag against the CURRENT guests row (there is
  --     no rsvp_responses column for it — the guest row is the only place it
  --     lives). Unchanged -> success WITHOUT a new row/update. Edge: if the
  --     owner manually edits the guest between two identical submits, the
  --     second no-ops and won't re-assert the guest fields (rare, acceptable).
  select * into _last
    from public.rsvp_responses
   where guest_id = _g.id
   order by created_at desc
   limit 1;
  if found
     and _last.attending is not distinct from _attending
     and _last.adults    is not distinct from _adults_n
     and _last.kids      is not distinct from _kids_n
     and _last.meal_pref is not distinct from _meal_n
     and _last.note      is not distinct from _note_n
     and _last.extras    is not distinct from _answers_in
     and _g.show_in_guest_list is not distinct from _show_list_n then
    return jsonb_build_object('ok', true, 'status', _status, 'unchanged', true);
  end if;

  -- (g) append-only audit row.
  insert into public.rsvp_responses(
    guest_id, event_id, attending, adults, kids, meal_pref, note, extras
  )
  values (
    _g.id, _g.event_id, _attending, _adults_n, _kids_n, _meal_n, _note_n, _answers_in
  );

  -- (h) last-write-wins projection onto the guest.
  update public.guests set
    status              = _status::public.guest_status,
    confirmed_adults    = _adults_n,
    confirmed_kids      = _kids_n,
    meal_pref           = _meal_n,
    rsvp_note           = _note_n,
    show_in_guest_list  = _show_list_n,
    -- Freshest answer wins: a NEW submission supersedes any earlier WhatsApp
    -- headcount, so a stale count can never influence the attending totals
    -- after a status change (attending -> declined/maybe) OR after a newer
    -- web answer. Clearing the request stamps lets the WhatsApp flow ask
    -- afresh on the next attend press (idempotent re-submits skip this
    -- projection entirely, so an unchanged answer keeps its headcount).
    confirmed_headcount    = 0,
    headcount_requested_at = null,
    headcount_answered_at  = null,
    headcount_attempts     = 0,
    contact_status   = 'responded'::public.contact_status
  where id = _g.id;

  return jsonb_build_object('ok', true, 'status', _status);
end;
$function$;

-- The hardened grant posture (NO anon/public; service_role only), as 20260714193500 set it.
revoke execute on function public.submit_rsvp(
  text, text, integer, integer, text, text, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.submit_rsvp(
  text, text, integer, integer, text, text, jsonb, boolean
) to service_role;

-- 3. get_rsvp_by_token without the consent flag (same signature: ACL kept) ----------------------------------------
create or replace function public.get_rsvp_by_token(_token text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'guest', jsonb_build_object(
      'id',               g.id,
      'full_name',        g.full_name,
      'expected_count',   g.expected_count,
      'status',           g.status,
      'event_id',         g.event_id,
      'confirmed_adults', g.confirmed_adults,
      'confirmed_kids',   g.confirmed_kids,
      'meal_pref',        g.meal_pref,
      'rsvp_note',        g.rsvp_note,
      'show_in_guest_list', g.show_in_guest_list,
      -- prior custom answers, filtered to the currently-enabled questions.
      'answers', coalesce((
        select jsonb_object_agg(kv.key, kv.value)
          from public.rsvp_responses rr
          cross join lateral jsonb_each(rr.extras) kv
         where rr.guest_id = g.id
           and rr.created_at = (
             select max(rr2.created_at)
               from public.rsvp_responses rr2
              where rr2.guest_id = g.id
           )
           and kv.key in (
             select q.q_key
               from public.event_questions q
              where q.event_id = g.event_id and q.enabled = true
           )
      ), '{}'::jsonb)
    ),
    'event', jsonb_build_object(
      'id',            e.id,
      'name',          e.name,
      'event_type',    e.event_type,
      'event_date',    e.event_date,
      'venue_name',    e.venue_name,
      'venue_address', e.venue_address,
      'show_meal_pref', e.show_meal_pref,
      'celebrants',    e.celebrants,
      'invite_image_path', e.invite_image_path,
      'gift_link_token', case when e.gift_payment_url is not null
                              then e.gift_link_token end,
      -- Coarse provider tag for the gift CTA icon (bit / paybox / other) —
      -- derived from the host, the URL itself is never exposed publicly.
      'gift_provider', case
        when e.gift_payment_url is null then null
        when e.gift_payment_url ilike '%bitpay.co.il%'
          or e.gift_payment_url ilike '%//bit.%' then 'bit'
        when e.gift_payment_url ilike '%paybox%' then 'paybox'
        else 'other'
      end
    ),
    -- the enabled questions the form must render (this function is the ONLY
    -- public path to them; eq_public_read was dropped above).
    'questions', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'q_key',    q.q_key,
                 'label',    q.label,
                 'q_type',   q.q_type,
                 'required', q.required,
                 'options',  q.options
               ) order by q.sort_order, q.q_key
             )
        from public.event_questions q
       where q.event_id = g.event_id and q.enabled = true
    ), '[]'::jsonb),
    -- L2: gate the FORM on BOTH the event day (Asia/Jerusalem calendar) AND the
    -- deadline. A NULL event_date does not gate (matches the DB NULL semantics).
    -- The DB session is UTC, so the deadline (a date) is compared in Israel time.
    'can_respond', (
      (e.event_date is null
       or (now() at time zone 'Asia/Jerusalem')::date
            <= (e.event_date at time zone 'Asia/Jerusalem')::date)
      and (e.rsvp_deadline is null
       or (now() at time zone 'Asia/Jerusalem')::date <= e.rsvp_deadline)
    )
  )
  from public.guests g
  join public.events e on e.id = g.event_id
  where g.rsvp_token = _token
    and g.rsvp_token_revoked_at is null
    and e.status = 'active';
$function$;

-- 4. The consent columns and switches --------------------------------------------------------------------------
alter table public.contacts
  drop column whatsapp_consent_at,
  drop column call_consent_at;

alter table public.app_settings
  drop column whatsapp_consent_required;

alter table public.call_compliance_settings
  drop column call_consent_required;

-- 5. Verification: abort (and roll back the whole file) unless the end state is exactly the intended one ----------
do $$
declare
  v_left text;
begin
  select string_agg(table_name || '.' || column_name, ', ')
    into v_left
    from information_schema.columns
   where table_schema = 'public'
     and (table_name, column_name) in (
       ('contacts', 'whatsapp_consent_at'),
       ('contacts', 'call_consent_at'),
       ('app_settings', 'whatsapp_consent_required'),
       ('call_compliance_settings', 'call_consent_required'));
  if v_left is not null then
    raise exception 'consent column(s) still present: %', v_left;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'call_compliance_settings'
                    and column_name = 'dnc_registry_gate_enabled') then
    raise exception 'call_compliance_settings.dnc_registry_gate_enabled must stay';
  end if;

  if to_regprocedure('public.submit_rsvp(text,text,integer,integer,text,text,jsonb,boolean,boolean)') is not null then
    raise exception 'the 9-argument submit_rsvp still exists';
  end if;
  if to_regprocedure('public.submit_rsvp(text,text,integer,integer,text,text,jsonb,boolean)') is null then
    raise exception 'the 8-argument submit_rsvp is missing';
  end if;

  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('submit_rsvp', 'get_rsvp_by_token')
                and p.prosrc ~* 'consent') then
    raise exception 'submit_rsvp or get_rsvp_by_token still mentions consent';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.prosrc ~* '(whatsapp_consent_at|call_consent_at|whatsapp_consent_required|call_consent_required)') then
    raise exception 'a function still references a dropped consent column';
  end if;

  if has_function_privilege('anon', 'public.submit_rsvp(text,text,integer,integer,text,text,jsonb,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.submit_rsvp(text,text,integer,integer,text,text,jsonb,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.submit_rsvp(text,text,integer,integer,text,text,jsonb,boolean)', 'execute')
     or has_function_privilege('anon', 'public.get_rsvp_by_token(text)', 'execute')
     or has_function_privilege('authenticated', 'public.get_rsvp_by_token(text)', 'execute')
     or not has_function_privilege('service_role', 'public.get_rsvp_by_token(text)', 'execute') then
    raise exception 'submit_rsvp / get_rsvp_by_token grants are not service_role only';
  end if;

  if pg_get_constraintdef((select oid from pg_constraint where conname = 'call_dispatch_status_reason_check'))
       !~ '''removal_requested'''
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'call_dispatch_status_reason_check'))
       ~ '''no_call_consent''' then
    raise exception 'call_dispatch_status_reason_check does not carry removal_requested in place of no_call_consent';
  end if;
end $$;
