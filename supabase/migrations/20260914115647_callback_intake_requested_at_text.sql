-- `submit_callback_intake._requested_at` becomes `text`, cast inside the body.
--
-- MEASURED, not assumed. 20260914114904 was meant to add `default null` to the
-- three optional parameters so that `supabase gen types` would emit them as
-- optional -- the way submit_rsvp's `_answers` already generates as
-- `_answers?`. That block never reached the database (a backgrounded shell job
-- rewrote the migration file before it was pushed), and after `db push` +
-- `gen:types` the property was still `_requested_at: string`: required and
-- non-nullable, with no way to express the NULL that 'asap' means.
--
-- 'asap' means "no stated time" -- requested_at stays NULL and the scheduler
-- resolves it against the clock when it actually runs, rather than against the
-- moment a form was submitted. So the absence has to be expressible.
--
-- Rather than depend on how a default is reflected into generated types, the
-- parameter now carries its own empty case in a type that cannot be anything
-- else: '' IS the absence. The cast happens once, here, and a value that is
-- neither empty nor a timestamp is refused instead of silently becoming NULL.
--
-- The signature changes, so the previous function is dropped first. Every
-- other line of the body is unchanged from 20260914114331.

-- Both spellings, so this migration is idempotent after the failed first
-- attempt: the previous signature (…, _requested_at timestamptz, …) and the
-- new all-text one, which differ by type and would otherwise coexist as two
-- OVERLOADS — and a named-argument `.rpc()` call against two overloads is
-- ambiguous, which fails at runtime rather than here.
drop function if exists public.submit_callback_intake(text, text, text, text, timestamptz, text);
drop function if exists public.submit_callback_intake(text, text, text, text, text, text);

create or replace function public.submit_callback_intake(
  _token text,
  _full_name text,
  _topic text,
  _note text default null,
  _requested_at text default null,
  _requested_rank text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
  _was_locked boolean;
  _instant timestamptz;
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

  -- '' and NULL both mean "no stated time" -- the caller chose 'asap', and the
  -- scheduler resolves that against the clock when it runs. A value that is
  -- neither empty nor a timestamp is a CALLER bug, not a user one: refuse it
  -- rather than quietly storing NULL and looking like the user said 'asap'.
  begin
    _instant := nullif(btrim(coalesce(_requested_at, '')), '')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end;

  if _full_name is null or length(_full_name) > 120
     or _topic is null or length(_topic) > 120
     or (_note is not null and length(_note) > 500)
     -- SlotRank, as schedule-policy.ts defines it. The app maps the form's
     -- asap/morning/afternoon/evening through preferenceToInstant() first;
     -- this rejects anything that did not come from that mapping.
     or (_requested_rank is not null
         and _requested_rank not in ('earliest', 'early', 'late', 'nearest'))
     or (_instant is not null and _instant <= now())
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
                            then _instant
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

revoke all on function public.submit_callback_intake(text, text, text, text, text, text) from public;
revoke all on function public.submit_callback_intake(text, text, text, text, text, text) from anon, authenticated;
grant execute on function public.submit_callback_intake(text, text, text, text, text, text) to service_role;

comment on function public.submit_callback_intake(text, text, text, text, text, text) is
  'Fills name/topic/note (and the requested slot, only while unscheduled) on the callback_requests row holding this one-time token. Atomic and single-use. Never accepts a phone. Server-side (service_role) only.';
