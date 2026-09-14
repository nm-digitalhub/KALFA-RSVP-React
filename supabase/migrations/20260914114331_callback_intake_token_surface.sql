-- Self-service intake for a callback_requests row created by a MISSED call.
--
-- The problem this solves, measured on 2026-09-14: when nobody answers, the
-- row is written from a phone number and nothing else, so `full_name` gets the
-- stand-in 'מתקשר לא מזוהה' and `topic` the system label 'שיחה נכנסת ללא נציג
-- זמין'. Both are then spoken by the confirmation agent. Conversation
-- conv_9301m2fsp280eq9rhcxevektrakh had no name to work with; conv_8601m2fs…
-- was asked four times what the call was about and invented "נושא העבודה"
-- rather than admit it did not know.
--
-- So: SMS the caller a one-time link, let them fill in the two fields we are
-- missing, and UPDATE the row we already have. Not a new row -- the existing
-- /contact form already INSERTs, and an insert here would leave the original
-- missed-call row untouched and un-named, which is the whole bug.
--
-- SHAPE follows submit_rsvp (20260630…, and its later revisions) exactly,
-- because that is this codebase's settled answer for an anonymous token
-- surface, and it has been in production since June:
--   * the browser NEVER holds a Supabase client -- `createAdminClient()` calls
--     these from a Server Action, so neither function is reachable by `anon`;
--   * every failure mode collapses to NULL / ok=false so the route can return
--     ONE generic message and a prober learns nothing about which tokens exist;
--   * gating and the write live in ONE statement, so there is no window
--     between "may they?" and the UPDATE, and two simultaneous submissions
--     cannot both win.
--
-- `phone` is deliberately NOT a parameter of either function. It is the
-- identity anchor the token is bound to; a surface that accepts it would let
-- whoever holds the SMS redirect someone else's callback to their own number.
-- There is no door to guard because there is no door.

alter table public.callback_requests
  -- 16 bytes hex = the dispatch-token convention already used by
  -- meeting-confirm/sales-call/outreach (`randomBytes(16).toString('hex')`).
  add column if not exists intake_token text,
  add column if not exists intake_token_expires_at timestamptz,
  add column if not exists intake_completed_at timestamptz,
  -- Send bookkeeping -- the same four columns, with the same meanings, as the
  -- no_contact_sms_* set this table already carries. Claim-then-send makes a
  -- duplicate SMS impossible even if two workers race.
  add column if not exists intake_sms_claimed_at timestamptz,
  add column if not exists intake_sms_sent_at timestamptz,
  add column if not exists intake_sms_provider_id text,
  add column if not exists intake_sms_error text;

-- Partial: only rows that actually have a token participate, and the lookup
-- below is an equality probe on exactly one value.
create unique index if not exists callback_requests_intake_token_key
  on public.callback_requests (intake_token)
  where intake_token is not null;

-- ---------------------------------------------------------------------------
-- Read: the intake view for a token, or NULL.
-- ---------------------------------------------------------------------------
-- NULL for unknown, expired, already-filled, or terminal-status -- the caller
-- cannot tell which, by design. `phone` is returned MASKED: the page shows the
-- person which number we will ring so they can spot a mistake, without the
-- surface handing back a full number to anyone holding a guessed token.
create or replace function public.get_callback_intake_by_token(_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.callback_requests%rowtype;
begin
  if _token is null or length(_token) < 16 then
    return null;
  end if;

  select * into _row
    from public.callback_requests
   where intake_token = _token
   limit 1;

  if not found
     or _row.intake_token_expires_at is null
     or _row.intake_token_expires_at <= now()
     or _row.intake_completed_at is not null
     or _row.status in ('cancelled', 'closed')
  then
    return null;
  end if;

  return jsonb_build_object(
    'id', _row.id,
    -- Last two digits only: enough to recognise your own number, useless to
    -- someone who does not already know it.
    'phone_hint', right(_row.phone, 2),
    'created_at', _row.created_at,
    'scheduled_at', _row.scheduled_at,
    -- The page uses this to decide whether the time-preference control is
    -- shown at all: once a slot exists, changing the preference would move
    -- `scheduled_at` out from under an in-flight confirmation call, whose ctx
    -- route refuses any request whose scheduled_at no longer matches the
    -- snapshot it dispatched with.
    'locked', (_row.scheduled_at is not null)
  );
end;
$$;

comment on function public.get_callback_intake_by_token(text) is
  'Public intake view for a callback_requests row, keyed on its one-time token. NULL for unknown/expired/filled/terminal -- indistinguishable on purpose. Server-side (service_role) only.';

-- ---------------------------------------------------------------------------
-- Write: fill in what the missed call could not tell us.
-- ---------------------------------------------------------------------------
-- Additive by construction. The four things a caller may set are the four
-- things we are missing; status, phone, scheduled_at and calendar_item_id are
-- untouchable here.
--
-- The time preference is applied ONLY while the row is unscheduled (see
-- 'locked' above). Once a slot exists it is silently ignored rather than
-- rejected --
-- the person filled the form in good faith, and their name and topic are still
-- worth having; the response tells the page which happened so it can say so.
create or replace function public.submit_callback_intake(
  _token text,
  _full_name text,
  _topic text,
  _note text,
  _requested_at timestamptz,
  _requested_rank text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
  _was_locked boolean;
begin
  if _token is null or length(_token) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Trimmed and bounded HERE as well as in the app's Zod schema: the schema
  -- checks the shape of what was posted, this checks what actually lands in a
  -- column that a voice agent will later read aloud.
  _full_name := nullif(btrim(coalesce(_full_name, '')), '');
  _topic     := nullif(btrim(coalesce(_topic, '')), '');
  _note      := nullif(btrim(coalesce(_note, '')), '');
  _requested_rank := nullif(btrim(coalesce(_requested_rank, '')), '');

  if _full_name is null or length(_full_name) > 120
     or _topic is null or length(_topic) > 120
     or (_note is not null and length(_note) > 500)
     -- SlotRank, as schedule-policy.ts defines it. The app maps the form's
     -- asap/morning/afternoon/evening through preferenceToInstant() first;
     -- this rejects anything that did not come from that mapping.
     or (_requested_rank is not null
         and _requested_rank not in ('earliest', 'early', 'late', 'nearest'))
     or (_requested_at is not null and _requested_at <= now())
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- ONE statement: every gate is a predicate, so nothing can change between
  -- the check and the write, and a second submission with the same token
  -- matches zero rows because intake_completed_at is no longer null.
  update public.callback_requests
     set full_name = _full_name,
         topic = _topic,
         note = case
                  when _note is null then note
                  when note is null or note = '' then _note
                  else note || E'\n' || _note
                end,
         -- Only while unscheduled: moving these on a row that already has a
         -- slot would shift scheduled_at under an in-flight confirmation call,
         -- whose ctx route 404s the moment the row stops matching the snapshot
         -- it dispatched with.
         requested_at = case
                          when scheduled_at is null and _requested_rank is not null
                            then _requested_at
                          else requested_at
                        end,
         requested_rank = case
                            when scheduled_at is null and _requested_rank is not null
                              then _requested_rank
                            else requested_rank
                          end,
         intake_completed_at = now(),
         updated_at = now()
   where intake_token = _token
     and intake_token_expires_at > now()
     and intake_completed_at is null
     and status not in ('cancelled', 'closed')
  returning id, (scheduled_at is not null) into _id, _was_locked;

  if _id is null then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  return jsonb_build_object('ok', true, 'id', _id, 'schedule_locked', coalesce(_was_locked, false));
end;
$$;

comment on function public.submit_callback_intake(text, text, text, text, timestamptz, text) is
  'Fills name/topic/note (and preference, only while unscheduled) on the callback_requests row holding this one-time token. Atomic and single-use. Never accepts a phone. Server-side (service_role) only.';

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
-- `anon` and `authenticated` INHERIT from PUBLIC, so revoking from them alone
-- leaves EXECUTE in place -- both revokes are required, in this order. Same
-- three lines as submit_rsvp's own migration.
revoke all on function public.get_callback_intake_by_token(text) from public;
revoke all on function public.get_callback_intake_by_token(text) from anon, authenticated;
grant execute on function public.get_callback_intake_by_token(text) to service_role;

revoke all on function public.submit_callback_intake(text, text, text, text, timestamptz, text) from public;
revoke all on function public.submit_callback_intake(text, text, text, text, timestamptz, text) from anon, authenticated;
grant execute on function public.submit_callback_intake(text, text, text, text, timestamptz, text) to service_role;
