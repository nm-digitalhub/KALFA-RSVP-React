-- "Robust" hardening round 2 (reviewer conditions):
--
-- 1) REAL table-level CHECK constraints on every quantity field — a negative
--    value can now never be STORED, not merely never counted (the aggregate
--    clamps stay as defense in depth). NULL keeps its documented meaning:
--    confirmed_* NULL = never answered; expected_count NULL = unknown invited
--    size. Preflighted live 2026-07-06: zero violating rows.
alter table public.guests
  add constraint guests_confirmed_adults_nonneg
    check (confirmed_adults is null or confirmed_adults >= 0),
  add constraint guests_confirmed_kids_nonneg
    check (confirmed_kids is null or confirmed_kids >= 0),
  add constraint guests_expected_count_positive
    check (expected_count is null or expected_count > 0);

-- 2) submit_rsvp v2 — "freshest answer wins" for headcounts. Derived VERBATIM
--    from the live definition (introspected 2026-07-06); the ONLY change is in
--    step (h): the guest projection now also resets the WhatsApp-headcount
--    fields, so counts from any source apply only while the answer that
--    produced them is the CURRENT one.
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
