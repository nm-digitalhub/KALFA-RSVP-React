-- One "how many are coming" answer instead of adults + kids, and no 10-person ceiling (EXPAND step).
--
-- WHY
--   Owner, 08.11.2026: drop the adults/kids split and ask one question, "how many are coming". No calculation ever
--   read the split: guest_totals, guest_effective_attending, over_invited and every report use the sum only, and the
--   WhatsApp headcount answer, the WhatsApp button and the call digit already store "adults = n, kids = 0" (read in
--   src/lib/data/headcount.ts, webhook-processing.ts and call-result-processing.ts, 08.11.2026). The owner also lifted the
--   10-person ceiling: guests_confirmed_headcount_range capped confirmed_headcount at 10, so the web action wrote
--   Math.min(10, adults + kids) and a family of 15 was stored as 10 with no error.
--
--   The web page also wrote the count in a second statement after submit_rsvp (confirmed_headcount + the answered
--   stamp), so a failure between the two left an attending guest with 0 people and no error. With _headcount the whole
--   answer is one statement inside submit_rsvp.
--
-- WHAT IT DOES
--   1. guests: the CHECK becomes confirmed_headcount >= 0 (no upper bound). The column stays NOT NULL DEFAULT 0, and
--      0 still means "no count given yet" for the WhatsApp headcount question.
--   2. rsvp_responses.headcount (nullable): the count a guest gave, kept in the append-only history. Rows written in
--      the old shape keep it NULL and their adults/kids as before.
--   3. guest_effective_attending and over_invited read confirmed_headcount >= 1 instead of 1..10.
--   4. get_rsvp_by_token also returns confirmed_headcount, so the page can show the stored count. The old keys stay.
--   5. submit_rsvp gains _headcount. Every count parameter now has a default, so the call shapes in production keep
--      working unchanged:
--        - _headcount given (new shape, the web page and the voice agent's read-back): the count is the guest's answer
--          and final. confirmed_headcount = the count and headcount_answered_at = now(), so the WhatsApp flow does not
--          ask again. confirmed_adults = the count and confirmed_kids = 0 keep the old readers correct.
--        - _headcount NULL (old shape, _adults/_kids): exactly the behaviour before this file — counts from _adults +
--          _kids, confirmed_headcount reset to 0 and the stamps cleared, so a WhatsApp button press is still followed
--          by the headcount question.
--      Idempotency in the new shape compares the count with the guest row (confirmed_headcount and the answered stamp),
--      not with the last response: the WhatsApp headcount answer writes the guest row without a response row, so a
--      later web answer with a different count must not be taken as "unchanged".
--      The signature changes, so the function is dropped and recreated in this transaction, with the same SECURITY
--      DEFINER, search_path and grants (EXECUTE for service_role only, as on the linked project 08.11.2026). No other
--      database function calls submit_rsvp (pg_proc searched 08.11.2026).
--   6. Data: attending guests whose adults + kids is 2 or more and above confirmed_headcount get that sum as their
--      count, answered. On the linked project 08.11.2026 that is one row (a count given and never projected); no row
--      was cut at 10. A sum of exactly 1 is left alone: a WhatsApp button press and a guest who said "just me" store
--      the same values.
--
-- DEPLOY ORDER — push this file BEFORE the application code of the same change. The code calls submit_rsvp with
--   _headcount, which only exists after this push. The code already running keeps working after it (old shape).
--
-- CONTRACT STEP (separate, after the owner decides how a count-less "coming" is counted, and after the voice agent and
--   the VoxEngine scenario send one count): drop _adults/_kids from submit_rsvp, the adults/kids keys from
--   get_rsvp_by_token, guests.confirmed_adults/confirmed_kids with their CHECKs, the adults+kids branch in
--   guest_effective_attending and over_invited, and adjust console_rsvp_results / console_call_analysis.

-- 1. No ceiling on the confirmed count.
alter table public.guests drop constraint guests_confirmed_headcount_range;
alter table public.guests
  add constraint guests_confirmed_headcount_nonneg check (confirmed_headcount >= 0);

-- 2. The count in the response history.
alter table public.rsvp_responses add column headcount integer;
alter table public.rsvp_responses
  add constraint rsvp_responses_headcount_nonneg check (headcount is null or headcount >= 0);

-- 3. Effective attending count and the over-invited flag: any confirmed count of 1 or more.
create or replace function public.guest_effective_attending(g guests)
 returns integer
 language sql
 stable
 set search_path to 'public'
as $function$
  select case when g.status = 'attending' then
    case
      when coalesce(g.confirmed_headcount, 0) >= 1
        then g.confirmed_headcount
      when greatest(coalesce(g.confirmed_adults, 0), 0)
         + greatest(coalesce(g.confirmed_kids, 0), 0) > 0
        then greatest(coalesce(g.confirmed_adults, 0), 0)
           + greatest(coalesce(g.confirmed_kids, 0), 0)
      when coalesce(g.expected_count, 0) > 0
        then g.expected_count
      else 1
    end
  else 0 end;
$function$;

create or replace function public.over_invited(g guests)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select g.status = 'attending'
     and g.expected_count is not null
     and (coalesce(g.confirmed_headcount, 0) >= 1
          or greatest(coalesce(g.confirmed_adults, 0), 0)
           + greatest(coalesce(g.confirmed_kids, 0), 0) > 0)
     and public.guest_effective_attending(g) > g.expected_count;
$function$;

-- 4. The page reads the stored count.
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
      'confirmed_headcount', g.confirmed_headcount,
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

-- 5. One count, in one statement.
drop function public.submit_rsvp(text, text, integer, integer, text, text, jsonb, boolean);

create function public.submit_rsvp(
  _token text,
  _status text,
  _adults integer default null,
  _kids integer default null,
  _meal text default null,
  _note text default null,
  _answers jsonb default '{}'::jsonb,
  _show_in_list boolean default false,
  _headcount integer default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _g          public.guests;
  _e          public.events;
  _answers_in jsonb   := coalesce(_answers, '{}'::jsonb);
  -- New shape: the guest gave one count. Old shape: adults + kids (callers not yet moved).
  _one_count  boolean := _headcount is not null;
  _adults_n   integer := greatest(coalesce(_adults, 0), 0);
  _kids_n     integer := greatest(coalesce(_kids, 0), 0);
  _attending  boolean;
  _total      integer := 0;
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

  -- (d) normalize per status. attending: 1 <= count <= expected_count
  --     (no upper cap when expected_count IS NULL). declined/maybe: count 0 and
  --     meal cleared (a meal preference is only meaningful when attending).
  _attending := case _status when 'attending' then true
                             when 'declined'  then false
                             else null end;  -- 'maybe'

  if _status = 'attending' then
    _total := case when _one_count then greatest(_headcount, 0)
                   else _adults_n + _kids_n end;
    if _total < 1 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_count');
    end if;
    if _g.expected_count is not null and _total > _g.expected_count then
      return jsonb_build_object('ok', false, 'reason', 'invalid_count');
    end if;
    -- The one count, projected onto the old pair so readers not yet moved stay correct.
    if _one_count then
      _adults_n := _total;
      _kids_n   := 0;
    end if;
    -- Owner toggle (events.show_meal_pref): when collection is disabled the
    -- field is not rendered, and any submitted value is ignored server-side.
    _meal_n := case when _e.show_meal_pref
                    then nullif(btrim(_meal), '')
                    else null end;
    -- Guest opt-in for the "who's coming" list; only meaningful when attending.
    _show_list_n := coalesce(_show_in_list, false);
  else
    _total    := 0;
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
  --     lives). The count: in the one-count shape it is compared with the guest
  --     row (confirmed_headcount + the answered stamp), because the WhatsApp
  --     headcount answer writes the guest row without a response row; in the old
  --     shape with the last response's adults/kids, as before. Unchanged ->
  --     success WITHOUT a new row/update.
  select * into _last
    from public.rsvp_responses
   where guest_id = _g.id
   order by created_at desc
   limit 1;
  if found
     and _last.attending is not distinct from _attending
     and _last.meal_pref is not distinct from _meal_n
     and _last.note      is not distinct from _note_n
     and _last.extras    is not distinct from _answers_in
     and _g.show_in_guest_list is not distinct from _show_list_n
     -- Parenthesised: plpgsql reads an IF condition up to the first THEN.
     and (case
           when _one_count then
             _g.confirmed_headcount = _total
             and (_status <> 'attending' or _g.headcount_answered_at is not null)
           else
             _last.adults is not distinct from _adults_n
             and _last.kids is not distinct from _kids_n
         end) then
    return jsonb_build_object('ok', true, 'status', _status, 'unchanged', true);
  end if;

  -- (g) append-only audit row.
  insert into public.rsvp_responses(
    guest_id, event_id, attending, adults, kids, headcount, meal_pref, note, extras
  )
  values (
    _g.id, _g.event_id, _attending, _adults_n, _kids_n,
    case when _one_count then _total end,
    _meal_n, _note_n, _answers_in
  );

  -- (h) last-write-wins projection onto the guest.
  update public.guests set
    status              = _status::public.guest_status,
    confirmed_adults    = _adults_n,
    confirmed_kids      = _kids_n,
    meal_pref           = _meal_n,
    rsvp_note           = _note_n,
    show_in_guest_list  = _show_list_n,
    -- One count given: it is the answer, final for the WhatsApp headcount question.
    -- Old shape: freshest answer wins and the WhatsApp flow asks afresh on the next
    -- attend press (unchanged from before; idempotent re-submits skip this projection).
    confirmed_headcount    = case when _one_count and _status = 'attending' then _total else 0 end,
    headcount_requested_at = null,
    headcount_answered_at  = case when _one_count and _status = 'attending' then now() end,
    headcount_attempts     = 0,
    contact_status   = 'responded'::public.contact_status
  where id = _g.id;

  return jsonb_build_object('ok', true, 'status', _status);
end;
$function$;

revoke all on function public.submit_rsvp(text, text, integer, integer, text, text, jsonb, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.submit_rsvp(text, text, integer, integer, text, text, jsonb, boolean, integer)
  to service_role;

-- 6. Counts that were given but never projected (one row on the linked project, 08.11.2026).
update public.guests
   set confirmed_headcount   = coalesce(confirmed_adults, 0) + coalesce(confirmed_kids, 0),
       headcount_answered_at = coalesce(headcount_answered_at, now())
 where status = 'attending'
   and coalesce(confirmed_adults, 0) + coalesce(confirmed_kids, 0) >= 2
   and coalesce(confirmed_adults, 0) + coalesce(confirmed_kids, 0) > confirmed_headcount;
