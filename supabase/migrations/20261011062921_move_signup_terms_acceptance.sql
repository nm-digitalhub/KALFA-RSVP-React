-- The signup terms acceptance moves out of profiles into a table no user can write.
--
-- WHY: profiles.terms_accepted_at is the record that a user accepted the terms at signup, but the user could change it.
-- own_profile_write is FOR ALL on the user's own row and authenticated holds UPDATE on every column, and RLS selects
-- rows, not columns. Measured 11.10.2026 on the live project, as a signed-in user inside a block that aborted: the
-- user's own UPDATE of terms_accepted_at changed 1 row; another user's row, 0. Supabase's column-level-security guide
-- recommends a dedicated table over column privileges for this.
--
-- WHAT IT DOES:
--   1. public.signup_terms_acceptances: one row per user, written only by handle_new_user(). RLS on with no policy, and
--      every privilege revoked from anon, authenticated and service_role except SELECT for service_role — the API
--      cannot insert, update or delete a row. A BEFORE UPDATE trigger refuses any update from any role.
--      user_id cascades from auth.users exactly as profiles (and the old column with it) does today, so deleting a user
--      (auth.admin.deleteUser, unconfirmed-signup-cleanup) still works; that is why DELETE is not blocked by the trigger.
--   2. Backfills the rows that already exist (measured: 2 of 6 profiles carry a value).
--   3. handle_new_user(): the same profile insert without terms_accepted_at, plus the acceptance row when
--      raw_user_meta_data carries terms_accepted — the same condition as before. search_path is now '' with every name
--      schema-qualified. The sales-referral handling is unchanged. Its EXECUTE grants are kept (CREATE OR REPLACE).
--   4. Drops profiles.terms_accepted_at. No app code reads it; the only writer was handle_new_user() (measured: no view
--      or other function references it).
--
-- WHAT IT DOES NOT DO: add a terms version, IP or any field not recorded today; change any profiles policy or grant.
--
-- ROLLBACK:
--   alter table public.profiles add column terms_accepted_at timestamptz;
--   update public.profiles p set terms_accepted_at = s.accepted_at
--     from public.signup_terms_acceptances s where s.user_id = p.id;
--   -- then restore handle_new_user() from 20260831205702_signup_terms_consent.sql and:
--   drop table public.signup_terms_acceptances;
--   drop function public.signup_terms_acceptances_no_update();

create table public.signup_terms_acceptances (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  accepted_at timestamptz not null default now()
);

comment on table public.signup_terms_acceptances is
  'One row per user who accepted the terms of service at signup. Written only by handle_new_user(); never updated.';
comment on column public.signup_terms_acceptances.accepted_at is
  'When the signup that carried terms_accepted created the account.';

alter table public.signup_terms_acceptances enable row level security;

revoke all on table public.signup_terms_acceptances from anon, authenticated, service_role;
grant select on table public.signup_terms_acceptances to service_role;

create function public.signup_terms_acceptances_no_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'signup_terms_acceptances is append-only (UPDATE blocked)';
end;
$$;

create trigger signup_terms_acceptances_immutable
  before update on public.signup_terms_acceptances
  for each row execute function public.signup_terms_acceptances_no_update();

insert into public.signup_terms_acceptances (user_id, accepted_at)
select id, terms_accepted_at
from public.profiles
where terms_accepted_at is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref_text text;
  ref_uuid uuid;
begin
  ref_text := new.raw_user_meta_data->>'sales_referral_attempt_id';
  if ref_text is not null and ref_text <> '' then
    begin
      ref_uuid := ref_text::uuid;
    exception when others then
      ref_uuid := null;
    end;
  end if;

  insert into public.profiles (id, full_name, phone, sales_referral_attempt_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    ref_uuid
  );

  if new.raw_user_meta_data->>'terms_accepted' is not null then
    insert into public.signup_terms_acceptances (user_id) values (new.id);
  end if;

  return new;
end;
$$;

alter table public.profiles drop column terms_accepted_at;
