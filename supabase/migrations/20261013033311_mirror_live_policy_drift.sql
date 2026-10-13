-- Records six RLS policies that exist on the LIVE database but in no migration, so that a database built
-- from the migrations (a reset, a preview, a local copy) matches production.
--
-- EVIDENCE. Read-only comparison of pg_policies, 13.10.2026: live 121 policies, local (built from the
-- migrations) 119. Two exist only on live; four have the same definition but are scoped to `public` in the
-- migrations and to `authenticated` on live. All six are PERMISSIVE. Nothing is local-only.
--
-- WHY IT MATTERS. Without `packages_public_read` a migration-built database gives `anon` no read on
-- `packages` (the public pricing read fails); the four `public`-scoped copies are wider than production.
--
-- ON PRODUCTION THIS CHANGES NOTHING. The two live-only policies are created only when absent (the DO blocks
-- test pg_policies first, so the live ones are not dropped or recreated); `ALTER POLICY ... TO authenticated`
-- sets the role list to what is already there. PERMISSIVE policies combine with OR, so the four existing
-- policies are altered in place, not shadowed by a second, narrower one.
--
-- The definitions below are copied from the live catalog (cmd, roles, USING, WITH CHECK, permissive).
--
-- ROLLBACK (only meaningful on a database where these were created by this migration; production had them
-- before it):
--   drop policy if exists packages_public_read on public.packages;
--   drop policy if exists "Platform owners can manage staff" on public.platform_staff;
--   alter policy packages_admin_all on public.packages to public;
--   alter policy al_owner_insert on public.activity_log to public;
--   alter policy own_profile_read on public.profiles to public;
--   alter policy own_profile_write on public.profiles to public;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'packages' and policyname = 'packages_public_read'
  ) then
    create policy packages_public_read on public.packages
      as permissive for select to anon, authenticated
      using (active = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'platform_staff' and policyname = 'Platform owners can manage staff'
  ) then
    create policy "Platform owners can manage staff" on public.platform_staff
      as permissive for all to authenticated
      using (public.is_platform_owner())
      with check (public.is_platform_owner());
  end if;
end $$;

alter policy packages_admin_all on public.packages to authenticated;
alter policy al_owner_insert on public.activity_log to authenticated;
alter policy own_profile_read on public.profiles to authenticated;
alter policy own_profile_write on public.profiles to authenticated;
