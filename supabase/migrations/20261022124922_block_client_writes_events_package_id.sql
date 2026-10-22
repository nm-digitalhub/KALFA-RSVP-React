-- events.package_id: no client write, by UPDATE or by INSERT.
--
-- Verified 22.10.2026 against the live catalog, and executed against local Supabase (same definitions as production,
-- 18/18 catalog lines identical including the md5 of events_guard_update):
--   - `authenticated` holds a column-level UPDATE grant on events.package_id, and a TABLE-level INSERT grant on events;
--   - policy events_org_update admits the event owner (and org members with events.edit);
--   - events_guard_update checks status and dates only, never package_id;
--   - a signed-in owner changed package_id of their own event through PostgREST: no error, 1 row.
-- Nothing in the app writes or reads events.package_id (grep src/ and worker/; no SQL function or view reads it), so
-- the column is server-only from now on. A package a customer buys lives on the campaign snapshot
-- (create_package_campaign), never here.

-- UPDATE: the grant is column-scoped (no table-wide UPDATE for authenticated), so a column revoke closes it.
revoke update (package_id) on public.events from authenticated, anon;

-- INSERT: authenticated holds INSERT on the whole table, and a column REVOKE cannot narrow a table-level grant
-- (PostgreSQL privileges are additive). A BEFORE INSERT guard refuses a client-set value instead. Service-role and
-- owner-role writers are not affected; no writer sets the column today.
create or replace function public.events_block_client_package_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.package_id is not null and current_user in ('authenticated', 'anon') then
    raise exception 'events.package_id is server-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.events_block_client_package_id() from public, anon, authenticated;

create trigger events_block_client_package_id
  before insert on public.events
  for each row execute function public.events_block_client_package_id();

comment on function public.events_block_client_package_id() is
  'Refuses a client-set events.package_id on INSERT (UPDATE is closed by the column grant). Server-managed column.';
