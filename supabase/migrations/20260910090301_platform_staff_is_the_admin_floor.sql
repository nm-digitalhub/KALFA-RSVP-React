-- The admin floor becomes platform_staff membership, on one axis instead of two.
--
-- WHY, measured 2026-09-10 against this database:
--
--   * `user_roles.admin` has NO independent purpose. All 21 RLS policies that
--     call has_role(uid,'admin') sit on PLATFORM-MANAGEMENT tables — app_settings,
--     channels, workflows, packages, message_templates, webhook_inbox, fleet_*,
--     ops_alerts, faq_items, agreement_documents, call_dnc_list,
--     callback_schedule_policies, otp_challenges, outreach_template_failures,
--     vox_log_exports, workflow_run_*. NOT ONE is a customer table; events,
--     guests, contacts and campaigns are governed by ownership and org policies.
--     So the flag is a platform-staff proxy and nothing else.
--
--   * The two axes are structurally independent: no foreign key between
--     platform_staff and user_roles, and no trigger keeping them in step (the two
--     triggers on platform_staff are its audit writer and its last-owner guard).
--     They agree today — 3 admins, 3 staff, 0 divergence either way — by hand,
--     not by construction.
--
--   * And they are written by TWO SEPARATE FLOWS that do not know about each
--     other: `setPlatformAdmin` (users.ts) writes only user_roles;
--     `assignStaffRole` and the revoke path (platform-roles.ts) write only
--     platform_staff.
--
-- THE BLOCKING CONSEQUENCE, which is what forced this decision: adding a
-- `billing_clerk` through /admin/roles today produces a person the admin layout
-- REDIRECTS to /app, because requireAdmin() reads user_roles and that row was
-- never created. Every non-owner role — support_agent, auditor, billing_clerk,
-- ops_engineer — is unusable as shipped.
--
-- WHAT THIS CHANGES: the 21 policies swap has_role(uid,'admin') for
-- is_platform_staff(). Semantically IDENTICAL today (the two sets are equal,
-- verified above), so no one gains or loses access on the day it lands. What it
-- buys is that the DB and the application agree on ONE definition of "staff"
-- from here on, instead of two that happen to match.
--
-- Deliberately NOT done here: no OR between the two axes (that would widen
-- access, never narrow it), and user_roles is left untouched — retiring it is a
-- separate decision once nothing reads it.
--
-- ROLLBACK: re-create each policy with the has_role form below, then
--   drop function public.is_platform_staff();
-- user_roles is not modified, so rollback restores the exact prior behaviour.

-- ---------------------------------------------------------------------------
-- The predicate
-- ---------------------------------------------------------------------------

-- Mirrors is_platform_owner()/has_platform_permission(): SECURITY DEFINER so the
-- caller needs no direct read on platform_staff, STABLE so the planner evaluates
-- it once per query rather than per row, and search_path pinned.
create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.platform_staff s where s.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_platform_staff() from anon;
grant execute on function public.is_platform_staff() to authenticated, service_role;

comment on function public.is_platform_staff() is
  'True when the caller holds a platform_staff row, at any role. THE admin floor: "is this person staff at all". Which capability they hold is has_platform_permission(); whether they are an owner is is_platform_owner(). Replaces has_role(uid,''admin'') in RLS as of 2026-09-10 — see the migration header for why the two axes were merged.';

-- ---------------------------------------------------------------------------
-- The 21 policies, one axis
-- ---------------------------------------------------------------------------
-- Written as a loop rather than 21 hand-copied blocks: the substitution is
-- mechanical and identical everywhere, and spelling it out once means a policy
-- cannot be missed or mistyped. Only policies whose expression actually mentions
-- has_role are touched; anything else is left exactly as it is.
do $$
declare
  pol record;
  new_qual text;
  new_check text;
  stmt text;
begin
  for pol in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual like '%has_role%' or with_check like '%has_role%')
     order by tablename, policyname
  loop
    -- TWO stored spellings, measured: 18 policies carry the initplan-wrapped
    -- form `( SELECT has_role(...) AS has_role)` and 3 carry it bare. Replace the
    -- wrapped one FIRST (it contains the bare one as a substring) so the
    -- `( SELECT ... )` wrapper survives — that wrapper is what makes Postgres
    -- evaluate the predicate once per query instead of per row, and it is why
    -- Supabase's own auth_rls_initplan lint is clean on this database.
    new_qual := replace(pol.qual,
                  '( SELECT has_role(( SELECT auth.uid() AS uid), ''admin''::app_role) AS has_role)',
                  '( SELECT public.is_platform_staff())');
    new_qual := replace(new_qual,
                  'has_role(( SELECT auth.uid() AS uid), ''admin''::app_role)',
                  '( SELECT public.is_platform_staff())');

    new_check := replace(coalesce(pol.with_check, ''),
                   '( SELECT has_role(( SELECT auth.uid() AS uid), ''admin''::app_role) AS has_role)',
                   '( SELECT public.is_platform_staff())');
    new_check := replace(new_check,
                   'has_role(( SELECT auth.uid() AS uid), ''admin''::app_role)',
                   '( SELECT public.is_platform_staff())');

    -- Belt and braces: if the stored expression is spelled differently on some
    -- policy, the replace is a no-op and the policy would be recreated with the
    -- OLD predicate. Fail loudly instead of silently leaving it behind.
    if new_qual = pol.qual and (pol.with_check is null or new_check = pol.with_check) then
      raise exception 'policy %.% still references has_role after substitution — expression was: %',
        pol.tablename, pol.policyname, pol.qual;
    end if;

    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);

    stmt := format('create policy %I on public.%I as %s for %s to %s using (%s)',
      pol.policyname, pol.tablename,
      case when pol.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      lower(pol.cmd), array_to_string(pol.roles, ', '), new_qual);
    if pol.with_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;
    execute stmt;
  end loop;
end $$;

-- Proof, inside the same transaction. Two assertions, because "it ran" is not
-- the same as "it did the right thing":
--   1. nothing still reaches for has_role, and
--   2. every rewritten predicate kept its `( SELECT ... )` wrapper. Postgres
--      normalises the stored text to `( SELECT is_platform_staff() AS
--      is_platform_staff)`; losing that wrapper would silently turn a once-per-
--      query check into a once-per-ROW check on 21 tables, which is exactly the
--      regression Supabase's auth_rls_initplan lint exists to catch.
do $$
declare
  leftover  int;
  converted int;
  unwrapped int;
begin
  select count(*) into leftover
    from pg_policies
   where schemaname = 'public'
     and (qual like '%has_role%' or with_check like '%has_role%');
  if leftover <> 0 then
    raise exception '% policies still call has_role', leftover;
  end if;

  select count(*) into converted
    from pg_policies
   where schemaname = 'public'
     and (qual like '%is_platform_staff%' or with_check like '%is_platform_staff%');
  if converted <> 21 then
    raise exception 'expected 21 policies on is_platform_staff, found %', converted;
  end if;

  select count(*) into unwrapped
    from pg_policies
   where schemaname = 'public'
     and qual like '%is_platform_staff%'
     and qual not like '%( SELECT is_platform_staff()%';
  if unwrapped <> 0 then
    raise exception '% policies lost the ( SELECT ... ) initplan wrapper', unwrapped;
  end if;
end $$;
