-- casl-console-ability-foundation: tell an open admin page that its user's permissions changed.
--
-- Why: the admin layout builds the CASL rules, the navigation grants and the softphone gate once, and a Next.js
-- layout does not re-render on client navigation (node_modules/next/dist/docs/01-app/02-guides/authentication.md,
-- "layouts do not re-render on navigation"). Server gates already read the live tables on every request
-- (has_platform_permission, is_console_agent), so a withdrawn permission is refused at once; what goes stale is the
-- page the user still has open. This migration sends that page a signal; the page then calls router.refresh(), which
-- re-renders the Server Components, the layout included (use-router.md:46).
--
-- What it adds:
--   1. public.platform_permission_change_signal(): an AFTER ROW trigger function that calls realtime.send() with an
--      EMPTY payload, event 'permissions_changed', on the private topic 'staff:<user_id>' of every user whose
--      decisions the changed row feeds:
--        - platform_staff            (is_staff, has_platform_permission, is_platform_owner): the row's user;
--        - platform_role_permissions (has_platform_permission): every staff member holding the row's role;
--        - platform_roles.is_owner_role (has_platform_permission, is_platform_owner): every holder of the role;
--        - console_agents            (is_console_agent: the softphone gate): the row's user.
--      Deletes that cascade from auth.users / platform_roles fire these row triggers too.
--   2. One SELECT policy on realtime.messages: an authenticated user may join a private broadcast topic only when the
--      topic is exactly 'staff:' || auth.uid(). That is the documented Realtime Authorization pattern
--      (supabase.com/docs/guides/realtime/authorization: realtime.topic(), auth.uid(), extension = 'broadcast').
--      No INSERT policy: clients cannot send on these topics; only the database does.
--
-- Why the payload is empty: Realtime caches a client's channel authorization for the life of the connection
-- (authorization guide, "Updating RLS policies"), and database broadcasts are kept in realtime.messages for 3 days
-- (broadcast guide). The message says only "re-read your permissions"; the permissions themselves come from the server
-- render. realtime.send() adds an `id` to the payload; nothing else is sent.
--
-- Failure mode: realtime.send() catches its own errors and raises a WARNING (realtime.send body, local and production
-- 22.10.2026), so a Realtime problem never blocks a permission change. A missed signal is covered by the client
-- refreshing when its channel re-joins (src/lib/realtime/permission-changes.ts).
--
-- Rollback (as a new migration; production history is append-only):
--   drop trigger if exists platform_staff_permission_signal on public.platform_staff;
--   drop trigger if exists platform_role_permissions_permission_signal on public.platform_role_permissions;
--   drop trigger if exists platform_roles_permission_signal on public.platform_roles;
--   drop trigger if exists console_agents_permission_signal on public.console_agents;
--   drop function if exists public.platform_permission_change_signal();
--   drop policy if exists "staff read own permission signal" on realtime.messages;

create or replace function public.platform_permission_change_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _users uuid[];
begin
  if TG_TABLE_NAME in ('platform_staff', 'console_agents') then
    _users := array[]::uuid[];
    if TG_OP in ('INSERT', 'UPDATE') then
      _users := _users || NEW.user_id;
    end if;
    if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and OLD.user_id is distinct from NEW.user_id) then
      _users := _users || OLD.user_id;
    end if;
  elsif TG_TABLE_NAME = 'platform_role_permissions' then
    select coalesce(array_agg(distinct s.user_id), array[]::uuid[]) into _users
      from public.platform_staff s
     where s.role_id = any (array[
             case when TG_OP <> 'DELETE' then NEW.role_id end,
             case when TG_OP <> 'INSERT' then OLD.role_id end
           ]);
  elsif TG_TABLE_NAME = 'platform_roles' then
    select coalesce(array_agg(distinct s.user_id), array[]::uuid[]) into _users
      from public.platform_staff s
     where s.role_id = NEW.id;
  end if;

  perform realtime.send('{}'::jsonb, 'permissions_changed', 'staff:' || u::text, true)
     from unnest(_users) as u
    where u is not null;

  return null;
end;
$$;

comment on function public.platform_permission_change_signal() is
  'AFTER ROW trigger: realtime.send(empty payload, ''permissions_changed'', ''staff:<user_id>'', private) to every user '
  'whose platform/console permission decisions the row feeds. See migration 20261022100542.';

-- A trigger function needs no EXECUTE grant to fire; keep it uncallable as an RPC.
revoke all on function public.platform_permission_change_signal() from public, anon, authenticated;

create trigger platform_staff_permission_signal
  after insert or update or delete on public.platform_staff
  for each row execute function public.platform_permission_change_signal();

create trigger platform_role_permissions_permission_signal
  after insert or update or delete on public.platform_role_permissions
  for each row execute function public.platform_permission_change_signal();

create trigger platform_roles_permission_signal
  after update of is_owner_role on public.platform_roles
  for each row
  when (old.is_owner_role is distinct from new.is_owner_role)
  execute function public.platform_permission_change_signal();

create trigger console_agents_permission_signal
  after insert or delete or update of vox_active, user_id on public.console_agents
  for each row execute function public.platform_permission_change_signal();

create policy "staff read own permission signal"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'staff:' || (select auth.uid())::text
  );
