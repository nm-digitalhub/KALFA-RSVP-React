-- CardCom pilot (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, S2): where the connection to the clearing
-- company lives, and how a CardCom payment session is tied to its row in the payment ledger.
--
-- WHY NOT app_settings (owner, 7.10.2026): it is the one table that already carries every switch and the SUMIT secrets.
-- This is the console_agent_secrets / integration_provider_configs pattern instead: a closed table no client role can
-- touch, with the one real secret (the API password, needed only to refund) in Vault.
--
-- WHY A SECOND TABLE FOR THE SESSION: the ledger row is written PENDING before CardCom is asked for anything, and
-- payment_operations_guard_update refuses pending -> pending. The LowProfileId only exists after the Create call, so it
-- cannot be added to that row. It lives here, keyed by the id CardCom will report back (webhook / GetLpResult), with
-- ONE session per operation. The ledger itself is not changed.

-- ── 1. Connection settings: a singleton, like app_settings. ──
-- No row = not configured. `enabled` is the pilot's switch: only an explicit true sends a package purchase to CardCom.
create table public.cardcom_config (
  id                  boolean primary key default true check (id),
  terminal_number     integer not null check (terminal_number > 0),
  api_name            text    not null check (length(btrim(api_name)) > 0),
  -- The API password is used ONLY to refund (CancelDoc / RefundByTransactionId). It lives in Vault; the row keeps the
  -- secret's id. NULL = none stored.
  api_password_secret uuid,
  enabled             boolean not null default false,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  -- Fail closed at the data level too: a pilot that cannot refund must not be switched on.
  constraint cardcom_config_enabled_needs_password check (not enabled or api_password_secret is not null)
);
comment on table public.cardcom_config is 'CardCom connection (single row). Server-only; the API password is a Vault secret id, never the password.';
comment on column public.cardcom_config.enabled is 'The pilot switch: true sends package purchases to CardCom, anything else keeps them on the existing provider. Requires a stored API password.';

-- ── 2. One CardCom session per ledger operation. ──
create table public.cardcom_payment_sessions (
  -- CardCom's identifier of the payment page / Open Fields deal. Its format is not documented, so it is only bounded.
  low_profile_id text primary key check (length(low_profile_id) between 1 and 64),
  -- RESTRICT, like the ledger's own foreign keys: the money record never vanishes because a session row was deleted.
  -- UNIQUE: a new attempt is a new LowProfile and therefore a new operation, never a second session on the same one
  -- (the unique constraint is also the index the foreign key needs).
  operation_id   uuid not null unique references public.payment_operations (id) on delete restrict,
  created_at     timestamptz not null default now()
);
comment on table public.cardcom_payment_sessions is 'Maps CardCom''s LowProfileId to the payment_operations row it pays for. Server-only, append-only.';

-- ── 3. Closed to every client role (three statements: a narrower GRANT is additive, it cannot take a privilege away;
--      20260916002343 / 20260916002651 are the precedent). RLS on, no policies: even a future grant would deny. ──
alter table public.cardcom_config enable row level security;
alter table public.cardcom_payment_sessions enable row level security;

revoke all on public.cardcom_config from anon, authenticated;
revoke all on public.cardcom_config from service_role;
revoke all on public.cardcom_payment_sessions from anon, authenticated;
revoke all on public.cardcom_payment_sessions from service_role;

-- What the code does, and nothing more. The config is written only through cardcom_config_save below (as service_role).
grant select, insert on public.cardcom_config to service_role;
grant update (terminal_number, api_name, api_password_secret, enabled, updated_at, updated_by)
  on public.cardcom_config to service_role;
-- A session is written once and read; it is never edited or deleted.
grant select, insert on public.cardcom_payment_sessions to service_role;

-- ── 4. Vault write + read: the same privileges / search_path as payment_citizen_id(_write). ──
-- Save: creates or updates the single row. A blank password keeps the stored one (rotating the terminal number or
-- turning the switch must not require typing the password again); a first save has none to keep, which is allowed
-- while the switch is off. The database refuses enabled=true without a password (constraint above).
create or replace function public.cardcom_config_save(
  p_terminal_number integer,
  p_api_name        text,
  p_api_password    text,
  p_enabled         boolean,
  p_updated_by      uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_name      text := btrim(coalesce(p_api_name, ''));
begin
  if p_terminal_number is null or p_terminal_number <= 0 then
    raise exception using errcode = '22023', message = 'terminal number is required';
  end if;
  if v_name = '' then
    raise exception using errcode = '22023', message = 'api name is required';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'enabled is required';
  end if;

  -- Two concurrent first saves must not both create a Vault secret (the name below is unique).
  perform pg_advisory_xact_lock(hashtextextended('cardcom_config', 0));

  select c.api_password_secret into v_secret_id from public.cardcom_config c where c.id for update;

  if nullif(btrim(coalesce(p_api_password, '')), '') is not null then
    if v_secret_id is null then
      v_secret_id := vault.create_secret(p_api_password, 'cardcom:api_password', 'CardCom API password (refunds only)', null);
    else
      perform vault.update_secret(v_secret_id, p_api_password, 'cardcom:api_password', 'CardCom API password (refunds only)');
    end if;
  end if;

  insert into public.cardcom_config (id, terminal_number, api_name, api_password_secret, enabled, updated_by)
  values (true, p_terminal_number, v_name, v_secret_id, p_enabled, p_updated_by)
  on conflict (id) do update
     set terminal_number     = excluded.terminal_number,
         api_name            = excluded.api_name,
         api_password_secret = excluded.api_password_secret,
         enabled             = excluded.enabled,
         updated_at          = now(),
         updated_by          = excluded.updated_by;
end $$;

-- Read: the decrypted password, or null. Called only at the moment of a refund.
create or replace function public.cardcom_api_password()
returns text
language sql
security invoker
stable
set search_path = ''
as $$
  select s.decrypted_secret
    from public.cardcom_config c
    join vault.decrypted_secrets s on s.id = c.api_password_secret
   where c.id
$$;

revoke execute on function public.cardcom_config_save(integer, text, text, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.cardcom_api_password() from public, anon, authenticated;
grant execute on function public.cardcom_config_save(integer, text, text, boolean, uuid) to service_role;
grant execute on function public.cardcom_api_password() to service_role;

-- ── DRY RUN (owner, one transaction ending in ROLLBACK) ──
-- a) select c.relname, has_table_privilege('anon',c.oid,'select') anon_sel, has_table_privilege('authenticated',c.oid,'select') auth_sel,
--           has_table_privilege('service_role',c.oid,'select,insert') sr_ins, has_table_privilege('service_role',c.oid,'delete') sr_del
--    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('cardcom_config','cardcom_payment_sessions');
--    expect: anon f, auth f, sr_ins t, sr_del f
-- b) select count(*) from pg_policies where tablename in ('cardcom_config','cardcom_payment_sessions');  -- 0
-- c) select has_function_privilege('anon','public.cardcom_api_password()','execute'),
--           has_function_privilege('authenticated','public.cardcom_config_save(integer,text,text,boolean,uuid)','execute'),
--           has_function_privilege('service_role','public.cardcom_api_password()','execute');  -- f, f, t
-- d) (ROLLBACK, as service_role) select public.cardcom_config_save(1000,'x',null,true,null);  -- check_violation: enabled needs a password
--    select public.cardcom_config_save(1000,'x','p',true,null); select public.cardcom_api_password();  -- 'p'
--    select public.cardcom_config_save(1000,'x',null,true,null); select public.cardcom_api_password();  -- still 'p' (blank keeps it)
-- e) (ROLLBACK) two sessions for one operation -> 23505; a session for an operation that does not exist -> 23503;
--    delete from payment_operations of an operation that has a session -> 23503 (RESTRICT)
-- f) FK columns without an index — expect 0 rows:
--    select conrelid::regclass, a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
--    where c.contype='f' and conrelid::regclass::text in ('cardcom_payment_sessions','cardcom_config')
--      and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and a.attnum=any(i.indkey));
--    (cardcom_config.updated_by is expected to show: auth.users FK on a one-row table, never joined — not worth an index.)
-- ROLLBACK (manual): drop function public.cardcom_config_save(integer, text, text, boolean, uuid); drop function public.cardcom_api_password();
--   drop table public.cardcom_payment_sessions, public.cardcom_config;
--   delete from vault.secrets where name = 'cardcom:api_password';
