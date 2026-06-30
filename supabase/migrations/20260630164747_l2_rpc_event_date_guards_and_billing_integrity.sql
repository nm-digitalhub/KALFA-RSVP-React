-- L2 — event_date guards inside the three service-role RPCs + billing integrity.
--
-- AUDIT: plans/authz-audit-unified-report.md §7 L2 (LC-4, LC-5) +
-- plans/authz-current-state-verification.md §2. L1 (app guards) stops the
-- OUTBOUND paths; L2 closes the gaps that live ONLY in the DB/RPC layer:
--   * submit_rsvp / get_rsvp_by_token — gated only on status='active' + the
--     optional rsvp_deadline, with NO event_date compare → an active event whose
--     day already passed stays open for RSVP indefinitely (live: event 03733daf,
--     active + event_date 22/6 + deadline NULL → RSVP open 8 days later).
--   * try_record_billed_result — no event_date gate (the close_at window is the
--     only time-stop and is SKIPPED when close_at IS NULL), AND it inserts the
--     caller-supplied p_event verbatim. With UNIQUE(event_id, contact_id) a wrong
--     p_event writes a charge under the WRONG event. The INBOUND webhook billing
--     path calls this RPC directly (NOT through the L1 stepGate), so a guest reply
--     to a past event with close_at NULL could still accrue a charge.
--
-- ONE shared "past event" rule, identical to the L0a DB guard and the L1 app
-- helper: an event is past only AFTER the end of its calendar day in Israel —
--   (now() AT TIME ZONE 'Asia/Jerusalem')::date
--     > (event_date AT TIME ZONE 'Asia/Jerusalem')::date
-- A NULL event_date never gates (matches L0a + isPastEventDay()).
--
-- Forward-only. SECURITY DEFINER, search_path, and the anon/authenticated EXECUTE
-- revokes are all preserved (re-asserted at the end, idempotent). No signature
-- change → CREATE OR REPLACE keeps each function's existing ACL.

-- 1) get_rsvp_by_token — gate the FORM on the event day too (LC-4 display side).
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
      'note',             g.note,
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
      'venue_address', e.venue_address
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

-- 2) submit_rsvp — reject a submission once the event day has passed (LC-4 write
--    side). Returns the existing 'closed' reason (a past event IS closed for RSVP)
--    so no UI/reason-map change is needed.
create or replace function public.submit_rsvp(_token text, _status text, _adults integer, _kids integer, _meal text, _note text, _answers jsonb default '{}'::jsonb)
 returns jsonb
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
    _meal_n := nullif(btrim(_meal), '');
  else
    _adults_n := 0;
    _kids_n   := 0;
    _meal_n   := null;
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
  --     answers). Unchanged -> success WITHOUT a new row. Edge: if the owner
  --     manually edits the guest between two identical submits, the second
  --     no-ops and won't re-assert the guest fields (rare, acceptable).
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
     and _last.extras    is not distinct from _answers_in then
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
    status           = _status::public.guest_status,
    confirmed_adults = _adults_n,
    confirmed_kids   = _kids_n,
    meal_pref        = _meal_n,
    note             = _note_n,
    contact_status   = 'responded'::public.contact_status
  where id = _g.id;

  return jsonb_build_object('ok', true, 'status', _status);
end;
$function$;

-- 3) try_record_billed_result — event_date gate + referential integrity (LC-5).
--    * Derive the event from the LOCKED campaign row (campaign.event_id), reject
--      'event_mismatch' when the caller-supplied p_event disagrees, and INSERT
--      the campaign-derived event_id (never the caller's) so a wrong p_event can
--      never write a charge under another event (UNIQUE(event_id, contact_id)).
--    * Reject 'event_passed' once the event day has passed (Asia/Jerusalem),
--      independent of close_at (which may be NULL) — this also covers the INBOUND
--      webhook billing path, which does not pass through the L1 stepGate.
create or replace function public.try_record_billed_result(p_event uuid, p_campaign uuid, p_contact uuid, p_channel public.campaign_channel, p_attempt text, p_evidence text, p_provider_ref text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text; v_price numeric; v_max int; v_start timestamptz; v_close timestamptz;
  v_count int; v_removed boolean; v_event_id uuid; v_event_date timestamptz;
begin
  -- Authoritative event comes from the campaign, not the caller.
  select event_id, status::text, price_per_reached, max_contacts, start_at, close_at
    into v_event_id, v_status, v_price, v_max, v_start, v_close
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  -- L2: the caller-supplied event must match the campaign's event (defensive;
  -- the insert below uses v_event_id regardless).
  if p_event is distinct from v_event_id then return 'event_mismatch'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: paused still bills inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  -- L2: never bill for an event whose day has already passed (Israel calendar) —
  -- independent of close_at (NULL-window) and of the L1 stepGate (inbound path).
  select event_date into v_event_date from events where id = v_event_id;
  if v_event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date
           > (v_event_date at time zone 'Asia/Jerusalem')::date then
    return 'event_passed';
  end if;
  select removal_requested into v_removed from contacts where id=p_contact;
  if coalesce(v_removed,false) then return 'removal_requested'; end if;
  -- Phase 2 BINDING CAP: the frozen authorized SET caps `reached` by construction.
  -- A contact not in the snapshot NEVER bills (fail-closed: empty set → bills nobody).
  if not exists (
    select 1 from public.campaign_authorized_contacts a
    where a.campaign_id=p_campaign and a.contact_id=p_contact
  ) then return 'not_authorized'; end if;
  -- Secondary defense (count cap): set membership already bounds reached at |set|.
  select count(*) into v_count from billed_results where campaign_id=p_campaign;
  if v_count >= v_max then return 'ceiling_reached'; end if;
  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,locked_price,evidence_source,provider_ref)
    values (v_event_id,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $function$;

-- Re-assert the service_role-only lockdown (idempotent; CREATE OR REPLACE keeps
-- the existing ACL, but be explicit so the lockdown can never silently regress).
revoke all on function public.get_rsvp_by_token(text) from public, anon, authenticated;
grant execute on function public.get_rsvp_by_token(text) to service_role;

revoke all on function public.submit_rsvp(text, text, integer, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_rsvp(text, text, integer, integer, text, text, jsonb) to service_role;

revoke all on function public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text) from public, anon, authenticated;
grant execute on function public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text) to service_role;
