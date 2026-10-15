-- Retire the last consumers of the legacy `user_roles.admin` flag, and the self-service way to get it.
--
-- STAGE 1 of 2. Stage 2 (drop has_role, user_roles, app_role) is NOT a migration yet: it runs only after
-- this one is applied AND the matching application build is deployed. See plans/user-roles-retirement-stage-2.md.
--
-- WHY. 20260910090301 made platform_staff the one admin floor and moved 21 RLS policies off has_role(). Two
-- groups of consumers were missed, because they are SECURITY DEFINER bodies and two policies spelled differently
-- from the pattern the loop matched. Measured on the live catalog, 15.10.2026:
--   * public.fleet_answer_request, fleet_goal_abandon, fleet_goal_create, fleet_goal_pause, fleet_goal_resume,
--     fleet_owner_request  -> gate on has_role(auth.uid(), 'admin')
--   * policy voice_purposes_admin_all (FOR ALL) and voice_purpose_attempts_admin_read (SELECT) -> has_role()
--   * public.claim_first_admin() -> lets ANY authenticated caller insert themselves into user_roles as 'admin'
--     when no admin row exists (3 exist today, so it returns false; it re-opens if they are ever deleted:
--     user_roles.user_id is ON DELETE CASCADE from auth.users). It also counts and inserts without a lock, so two
--     concurrent callers on an empty table both succeed. Nothing links to /app/admin-access.
--   * public.org_role_rank(uuid) -> SECURITY DEFINER, executable by `authenticated`, used by no policy, function,
--     trigger or code path (pg_depend: 0 dependents).
--
-- WHAT CHANGES FOR PEOPLE. Two platform_staff rows exist (owner x1, billing_clerk x1) and BOTH also hold
-- user_roles.admin; a third admin row belongs to an account that has no staff row, never signed in and has no
-- fleet activity. Today the billing_clerk could call the fleet RPCs and write voice_purposes straight through
-- /rest/v1, because the legacy flag - not the role - decided it; the application layer would have refused. After
-- this migration the DATABASE asks the same question the application already asks:
--   fleet_*        -> has_platform_permission('manage_settings')   (nav entry, all 18 server call sites, the
--                     fleet-file route and admin-data-layer-coverage.test.ts already say exactly this)
--   voice policies -> has_platform_permission('manage_voice')      (the permission the voice admin area is pinned to)
-- The owner is unaffected (owner holds every permission). ops_engineer holds both keys, so that role - nobody holds
-- it today - gains DB-level rights that the application already gives it. billing_clerk and the third account lose
-- a back door they did not use. No new permission key is introduced: a dedicated fleet key would be a product
-- decision, and the roles matrix at /admin/roles is where it would be made.
--
-- The refusal is raised with SQLSTATE 42501 (insufficient_privilege) instead of matching on message text; the
-- application now reads error.code.
--
-- ROLLBACK:
--   * fleet_* : re-create each function with its previous gate `public.has_role(auth.uid(), 'admin'::public.app_role)`
--     and the message '<fn>: admin only' - bodies are in 20260723094500_fleet_requests.sql,
--     20260729155911_fleet_owner_request.sql and 20260729215426_fleet_goals.sql (apply the later edits, if any, from
--     git history).
--   * policies : alter policy voice_purposes_admin_all on public.voice_purposes
--        using (( SELECT has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) AS has_role))
--        with check (( SELECT has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) AS has_role));
--      alter policy voice_purpose_attempts_admin_read on public.voice_purpose_attempts
--        using (( SELECT has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) AS has_role));
--   * claim_first_admin (definition as it was, live 15.10.2026):
--        create or replace function public.claim_first_admin() returns boolean language plpgsql security definer
--        set search_path to 'public' as $f$
--        declare admin_count int;
--        begin
--          if auth.uid() is null then raise exception 'must be authenticated'; end if;
--          select count(*) into admin_count from public.user_roles where role = 'admin';
--          if admin_count > 0 then return false; end if;
--          insert into public.user_roles(user_id, role) values (auth.uid(), 'admin') on conflict do nothing;
--          return true;
--        end; $f$;
--        revoke execute on function public.claim_first_admin() from public, anon;
--        grant execute on function public.claim_first_admin() to authenticated, service_role;
--   * org_role_rank: grant execute on function public.org_role_rank(uuid) to authenticated;

-- 1. The six fleet RPCs. Bodies are identical to the live definitions except the gate and its message.
--    search_path stays '' so the permission function is schema-qualified; ACLs are preserved by CREATE OR REPLACE.

create or replace function public.fleet_answer_request(p_id uuid, p_verdict text, p_answer text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_row public.fleet_requests%rowtype;
begin
  if not public.has_platform_permission('manage_settings') then
    raise exception 'fleet_answer_request: not permitted' using errcode = '42501';
  end if;

  select * into v_row
    from public.fleet_requests
    where id = p_id
    for update;
  if not found then
    raise exception 'fleet_answer_request: request not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'fleet_answer_request: request is not pending';
  end if;
  if v_row.expires_at <= now() then
    raise exception 'fleet_answer_request: request has expired';
  end if;

  if v_row.kind = 'approval' then
    if p_verdict not in ('approved', 'denied') then
      raise exception 'fleet_answer_request: approval requests take approved/denied only';
    end if;
  elsif v_row.kind = 'question' then
    if p_verdict <> 'answered' then
      raise exception 'fleet_answer_request: question requests take answered only';
    end if;
    if p_answer is null or btrim(p_answer) = '' then
      raise exception 'fleet_answer_request: an answer is required for questions';
    end if;
  else -- fyi
    if p_verdict <> 'answered' then
      raise exception 'fleet_answer_request: fyi requests take answered only';
    end if;
  end if;

  update public.fleet_requests
    set status = p_verdict,
        answer = p_answer,
        answered_by = auth.uid(),
        answered_at = now()
    where id = p_id;
end;
$function$;

create or replace function public.fleet_goal_abandon(p_id uuid, p_note text)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_updated int;
begin
  if not public.has_platform_permission('manage_settings') then
    raise exception 'fleet_goal_abandon: not permitted' using errcode = '42501';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'fleet_goal_abandon: a note is required';
  end if;

  update public.fleet_goals
     set status = 'failed', closed_at = now(), next_wake_at = null,
         last_error = p_note, step_count = step_count + 1
   where id = p_id and status in ('active','paused');

  get diagnostics v_updated = row_count;
  return case when v_updated = 1 then 'abandoned' else 'already_closed' end;
end;
$function$;

create or replace function public.fleet_goal_create(p_role text, p_title text, p_body text)
 returns public.fleet_goals
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_row public.fleet_goals%rowtype;
begin
  if not public.has_platform_permission('manage_settings') then
    raise exception 'fleet_goal_create: not permitted' using errcode = '42501';
  end if;

  -- next_wake_at = now(), לא ברירת המחדל (null). שאילתת goal_due בתזמן
  -- ו-goal-poll ב-CLI שתיהן מסננות next_wake_at <= now(); NULL אינו ≤ שום
  -- דבר, אז בלי השורה הזו מטרה טרייה הייתה יושבת ב-active לנצח, בלתי-
  -- נראית לשני הצדדים. עם השורה הזו, הטיק הבא של התזמן (≤60ש') מרים אותה
  -- בלי שום התערבות.
  insert into public.fleet_goals (role, title, body, created_by, next_wake_at)
  values (p_role, btrim(p_title), btrim(p_body), auth.uid(), now())
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.fleet_goal_pause(p_id uuid, p_note text default null::text)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_updated int;
begin
  if not public.has_platform_permission('manage_settings') then
    raise exception 'fleet_goal_pause: not permitted' using errcode = '42501';
  end if;

  update public.fleet_goals
     set status = 'paused',
         next_wake_at = null,          -- מוציא מיידית מ-fleet_goals_due_idx
         last_error = coalesce(p_note, last_error)
   where id = p_id and status = 'active';

  get diagnostics v_updated = row_count;
  return case when v_updated = 1 then 'paused' else 'not_active' end;
end;
$function$;

create or replace function public.fleet_goal_resume(p_id uuid, p_next_wake_at timestamp with time zone default null::timestamp with time zone)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_updated int;
begin
  if not public.has_platform_permission('manage_settings') then
    raise exception 'fleet_goal_resume: not permitted' using errcode = '42501';
  end if;
  if p_next_wake_at is not null
     and (p_next_wake_at <= now() or p_next_wake_at > now() + interval '30 days') then
    raise exception 'fleet_goal_resume: next_wake_at must be within (now, now + 30 days]';
  end if;

  update public.fleet_goals
     set status = 'active', consecutive_failures = 0, last_error = null,
         next_wake_at = coalesce(p_next_wake_at, now() + interval '1 hour')
   where id = p_id and status = 'paused';

  get diagnostics v_updated = row_count;
  return case when v_updated = 1 then 'resumed' else 'not_paused' end;
end;
$function$;

create or replace function public.fleet_owner_request(p_role text, p_kind text, p_tier smallint, p_title text, p_body text, p_thread_root uuid default null::uuid)
 returns public.fleet_requests
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_key text;
  v_payload jsonb;
  v_row public.fleet_requests%rowtype;
begin
  if not public.has_platform_permission('manage_settings') then
    raise exception 'fleet_owner_request: not permitted' using errcode = '42501';
  end if;

  if p_kind not in ('approval', 'question', 'fyi') then
    raise exception 'fleet_owner_request: kind must be approval, question or fyi';
  end if;
  if p_tier is null or p_tier < 0 or p_tier > 2 then
    raise exception 'fleet_owner_request: tier must be 0, 1 or 2';
  end if;
  if btrim(coalesce(p_role, '')) = '' then
    raise exception 'fleet_owner_request: role is required';
  end if;
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_body, '')) = '' then
    raise exception 'fleet_owner_request: title and body are required';
  end if;

  -- Same shape as deriveRequestKey(), with an `owner:` prefix so an
  -- owner-initiated ask can never collide with an agent-filed one that happens
  -- to carry identical text on the same day.
  v_key := 'owner:' || p_role || ':'
        || to_char(timezone('Asia/Jerusalem', now()), 'YYYY-MM-DD') || ':'
        || substr(md5(p_kind || E'\n' || p_title || E'\n' || p_body), 1, 16);

  v_payload := jsonb_build_object('origin', 'owner');
  if p_thread_root is not null then
    v_payload := v_payload || jsonb_build_object('thread_root', p_thread_root);
  end if;

  insert into public.fleet_requests (request_key, role, kind, tier, title, body, payload)
  values (v_key, p_role, p_kind, p_tier, btrim(p_title), btrim(p_body), v_payload)
  on conflict (request_key) do nothing
  returning * into v_row;

  -- Conflict path: the identical ask already exists today. Return it rather
  -- than raising — a double submit should be invisible, not an error page.
  if v_row.id is null then
    select * into v_row from public.fleet_requests where request_key = v_key;
  end if;

  return v_row;
end;
$function$;

-- 2. The two voice policies. ALTER keeps the name, command and role list; the `( SELECT ... )` wrapper keeps the
--    predicate evaluated once per query (the auth_rls_initplan property 20260910090301 preserved).

alter policy voice_purposes_admin_all on public.voice_purposes
  using (( select public.has_platform_permission('manage_voice') ))
  with check (( select public.has_platform_permission('manage_voice') ));

alter policy voice_purpose_attempts_admin_read on public.voice_purpose_attempts
  using (( select public.has_platform_permission('manage_voice') ));

-- 3. The self-service path to the legacy flag, and a helper nothing calls.

drop function if exists public.claim_first_admin();

revoke execute on function public.org_role_rank(uuid) from public, anon, authenticated;

-- 4. Proof, inside the same transaction: "it ran" is not "it did the right thing".
do $$
declare
  rec record;
  pol record;
  checked int := 0;
begin
  for rec in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('fleet_answer_request','fleet_goal_abandon','fleet_goal_create',
                         'fleet_goal_pause','fleet_goal_resume','fleet_owner_request')
  loop
    checked := checked + 1;
    if rec.def ilike '%has_role%' then
      raise exception 'public.% still references has_role', rec.proname;
    end if;
    if rec.def not like '%has_platform_permission(''manage_settings'')%'
       or rec.def not like '%errcode = ''42501''%' then
      raise exception 'public.% lacks the manage_settings gate / 42501 refusal', rec.proname;
    end if;
    if has_function_privilege('anon', rec.oid, 'execute') then
      raise exception 'anon can execute public.%', rec.proname;
    end if;
  end loop;
  if checked <> 6 then
    raise exception 'expected 6 fleet functions, found %', checked;
  end if;

  for pol in
    select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
      from pg_policies
     where schemaname = 'public'
       and policyname in ('voice_purposes_admin_all', 'voice_purpose_attempts_admin_read')
  loop
    if pol.expr ilike '%has_role%' or pol.expr not like '%has_platform_permission%manage_voice%' then
      raise exception 'policy %.% was not rewritten: %', pol.tablename, pol.policyname, pol.expr;
    end if;
    if pol.expr not like '%( SELECT %has_platform_permission%' then
      raise exception 'policy %.% lost its initplan wrapper: %', pol.tablename, pol.policyname, pol.expr;
    end if;
  end loop;

  if exists (select 1 from pg_policies
              where schemaname = 'public'
                and (qual ilike '%has_role(%' or with_check ilike '%has_role(%')) then
    raise exception 'a policy still references has_role';
  end if;

  if exists (select 1 from pg_proc
              where pronamespace = 'public'::regnamespace and proname = 'claim_first_admin') then
    raise exception 'claim_first_admin still exists';
  end if;

  if has_function_privilege('authenticated', 'public.org_role_rank(uuid)', 'execute')
     or has_function_privilege('anon', 'public.org_role_rank(uuid)', 'execute') then
    raise exception 'org_role_rank is still executable by a browser role';
  end if;
  if not has_function_privilege('service_role', 'public.org_role_rank(uuid)', 'execute') then
    raise exception 'org_role_rank lost service_role EXECUTE';
  end if;
end $$;
