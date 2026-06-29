-- Harden the public RSVP gateway: get_rsvp_by_token (read) + submit_rsvp (write).
--
-- Both functions ALREADY EXIST in the live DB (verified via pg_proc — note that
-- information_schema.routines does NOT surface them, so pg_proc is authoritative).
-- They are SECURITY DEFINER and were granted EXECUTE to anon/authenticated, which
-- means a NEXT-side rate limiter is NOT real protection: anyone could call them
-- directly. This migration closes that hole and folds in the full review:
--
--   1. (already satisfied) rsvp_token uniqueness — guests_rsvp_token_key exists,
--      and the live data has no duplicates, so NO new constraint is added here.
--   2. Revoke ALL anonymous/authenticated EXECUTE on BOTH functions; grant only
--      to service_role. The public page and its submit action call them through a
--      server-side service-role client AFTER the Next rate limiter, so the limiter
--      can no longer be bypassed. The functions remain the atomic validation gate.
--   3. submit_rsvp is genuinely idempotent: it locks the guest row, compares the
--      normalized payload to the guest's most recent response, and no-ops an
--      unchanged resubmit (double-click safe) instead of appending a duplicate.
--   4. Count rule is tied to the business meaning of expected_count: attending =>
--      1 <= adults+kids <= expected_count (NO upper cap when expected_count IS
--      NULL, i.e. not set — the data layer inserts NULL for guests imported
--      without a count, so a coalesce-to-1 cap would reject every "+1"); declined
--      and maybe => counts forced to 0.
--   5. Custom answers are validated INSIDE the function (not only in Zod): unknown
--      keys rejected, required questions enforced, free text length-capped, and
--      choice answers validated against the question's options.
--   6. The anon direct-read policy on event_questions (eq_public_read) is dropped:
--      the secured read function is the ONLY public path to a token's questions.
--      The inert authenticated INSERT policy on rsvp_responses (rsvp_auth_insert)
--      is dropped too — only the SECURITY DEFINER submit writes that table.
--
-- Also: token revocation/rotation support (rsvp_token_revoked_at, mirroring
-- organization_invitations.revoked_at) gating BOTH functions; and the deadline is
-- compared in Asia/Jerusalem explicitly (the DB session time zone is UTC).
--
-- Also: token strength. The live rsvp_token default was encode(
-- extensions.gen_random_bytes(12),'hex') = 96-bit. The token is the public
-- bearer secret for a guest, and guests.ts intentionally never sets it (it is
-- left to this DB default — the server-controlled home), so the default is the
-- single point that governs every new guest. This migration raises it to 16
-- bytes = 128-bit (OWASP guidance for URL bearer tokens), bringing it in line
-- with the rest of the codebase's opaque-token strength. The source primitive
-- (extensions.gen_random_bytes, a CSPRNG) was already correct — only the length
-- changes. Format stays lowercase hex, now 32 chars.
--
-- NOTE (handled OUTSIDE this migration, approval-gated): the live data has tokens
-- below the new 128-bit/32-hex standard — including the active event's seed guest
-- 00000000-…-a1, whose token is non-canonical (unknown entropy). Rotate every
-- token not matching ^[0-9a-f]{32}$ to encode(extensions.gen_random_bytes(16),
-- 'hex') before the public route goes live. That is a live-data correction, not a
-- schema change, so it is presented separately rather than buried here.
--
-- Apply as the standard migration owner (postgres) so SECURITY DEFINER keeps
-- bypassing RLS for the controlled gateway.

-- ---------------------------------------------------------------------------
-- 0) Token revocation/rotation field (additive; mirrors the proven
--    organization_invitations.revoked_at posture). Both functions treat a
--    revoked token as if it did not exist. No extra index: lookups are by
--    rsvp_token (already uniquely indexed) and this is a column read on the
--    single resolved row.
-- ---------------------------------------------------------------------------
alter table public.guests
  add column if not exists rsvp_token_revoked_at timestamptz;

-- Strengthen the token default 96-bit -> 128-bit (12 -> 16 bytes). Same CSPRNG
-- (extensions.gen_random_bytes), same lowercase-hex format (now 32 chars). This
-- governs every newly-created guest; existing rows are rotated separately (see
-- the NOTE above) since a DEFAULT change does not touch stored values.
alter table public.guests
  alter column rsvp_token set default encode(extensions.gen_random_bytes(16), 'hex');

-- ---------------------------------------------------------------------------
-- 1) Drop the over-broad / inert anon & authenticated policies. With the read
--    function as the sole public gate, anon never needs direct table reads; and
--    rsvp_responses is written only by the SECURITY DEFINER submit function.
-- ---------------------------------------------------------------------------
drop policy if exists eq_public_read on public.event_questions;
drop policy if exists rsvp_auth_insert on public.rsvp_responses;

-- ---------------------------------------------------------------------------
-- 2) READ: get_rsvp_by_token — same signature (text -> jsonb), CREATE OR REPLACE.
--    Gates: token not revoked AND event 'active' (draft/closed/unknown/revoked
--    are indistinguishable -> NULL, no enumeration signal). Returns the enabled
--    questions the form must render, the prior answers (filtered to currently
--    enabled questions, so the prefill never carries a disabled/deleted key into
--    resubmit), and can_respond computed in Asia/Jerusalem.
-- ---------------------------------------------------------------------------
create or replace function public.get_rsvp_by_token(_token text)
  returns jsonb
  language sql
  stable
  security definer
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
    -- show the event but gate the FORM once the deadline has passed. The DB
    -- session is UTC, so the deadline (a date) is compared in Israel local time.
    'can_respond', (
      e.rsvp_deadline is null
      or (now() at time zone 'Asia/Jerusalem')::date <= e.rsvp_deadline
    )
  )
  from public.guests g
  join public.events e on e.id = g.event_id
  where g.rsvp_token = _token
    and g.rsvp_token_revoked_at is null
    and e.status = 'active';
$function$;

-- ---------------------------------------------------------------------------
-- 3) WRITE: submit_rsvp — signature change (boolean -> text status + jsonb
--    answers), so DROP both the OLD 6-arg version and (for re-runnability) the
--    new 7-arg version, then CREATE.
-- ---------------------------------------------------------------------------
drop function if exists public.submit_rsvp(text, boolean, integer, integer, text, text);
drop function if exists public.submit_rsvp(text, text, integer, integer, text, text, jsonb);

create function public.submit_rsvp(
  _token   text,
  _status  text,
  _adults  integer,
  _kids    integer,
  _meal    text,
  _note    text,
  _answers jsonb default '{}'::jsonb
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

  -- (c) event gates: active + deadline (Asia/Jerusalem) not passed.
  select * into _e from public.events where id = _g.event_id;
  if not found or _e.status <> 'active' then
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

-- ---------------------------------------------------------------------------
-- 4) Lock down EXECUTE. New functions default to EXECUTE for PUBLIC, and the
--    prior grants reached anon/authenticated — revoke all of that and grant ONLY
--    service_role. Both functions are now reachable only from the server-side
--    service-role client, behind the Next rate limiter. The token + every gate
--    inside the functions remain the real protection.
-- ---------------------------------------------------------------------------
revoke all on function public.get_rsvp_by_token(text) from public;
revoke all on function public.get_rsvp_by_token(text) from anon, authenticated;
grant execute on function public.get_rsvp_by_token(text) to service_role;

revoke all on function public.submit_rsvp(text, text, integer, integer, text, text, jsonb) from public;
revoke all on function public.submit_rsvp(text, text, integer, integer, text, text, jsonb) from anon, authenticated;
grant execute on function public.submit_rsvp(text, text, integer, integer, text, text, jsonb) to service_role;
