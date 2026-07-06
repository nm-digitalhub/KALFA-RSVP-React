-- Per-event toggle for the public RSVP meal-preference field.
--
-- events.show_meal_pref (default true = current behavior for every existing
-- event) controls whether the public RSVP form collects "העדפת תפריט":
--   * get_rsvp_by_token now projects the flag so the form can hide the field;
--   * submit_rsvp ignores _meal server-side when the toggle is off, so a stale
--     or forged client cannot write a preference the owner disabled.
-- Both function bodies below are the LIVE pg_proc definitions (dumped
-- 2026-07-06, post rsvp_note_split) with exactly one edit each.

begin;

alter table public.events add column if not exists show_meal_pref boolean not null default true;

comment on column public.events.show_meal_pref is
  'Owner toggle: when true (default) the public RSVP form collects a meal preference from attending guests; when false the field is hidden and submit_rsvp ignores any submitted value.';

CREATE OR REPLACE FUNCTION public.get_rsvp_by_token(_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.submit_rsvp(_token text, _status text, _adults integer, _kids integer, _meal text, _note text, _answers jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Owner toggle (events.show_meal_pref): when collection is disabled the
    -- field is not rendered, and any submitted value is ignored server-side.
    _meal_n := case when _e.show_meal_pref
                    then nullif(btrim(_meal), '')
                    else null end;
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
    rsvp_note        = _note_n,
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
$function$
;

commit;
