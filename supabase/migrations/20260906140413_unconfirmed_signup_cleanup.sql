-- Delete signups that were never confirmed, after 30 days.
--
-- Not housekeeping for its own sake. A mistyped address is usually one
-- character off a REAL inbox (dana@ vs dan@), so the confirmation mail reaches
-- a stranger, and that stranger can take the account: Supabase Studio gates
-- "Reset password" on isEmailAuth ALONE, while gating the confirmation mail on
-- isVerified — password recovery is not blocked by an unconfirmed email. The
-- account carries the real signer's full_name and phone, so the exposure is
-- their personal data, not just an empty row.
--
-- 30 days follows Supabase's own documented cleanup for anonymous users
-- ("automatic cleanup is not currently available", delete older than 30 days).
-- It also sits well past the reminder sweep's 7-day window, so an account is
-- never deleted while it might still be reminded.

alter table public.app_settings
  add column if not exists unconfirmed_cleanup_enabled boolean not null default false;

comment on column public.app_settings.unconfirmed_cleanup_enabled is
  'Arms the daily deletion of signups still unconfirmed after 30 days. Off by default.';

-- auth.users is not exposed through PostgREST. SECURITY DEFINER keeps the read
-- narrow: only unconfirmed, old, dataless signups — never a general window onto
-- auth.users.
create or replace function public.stale_unconfirmed_signups(
  max_age_days integer default 30
)
returns table (user_id uuid, email text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.created_at
  from auth.users u
  where u.email_confirmed_at is null
    and u.deleted_at is null
    and u.created_at < now() - make_interval(days => max_age_days)
    -- Belt and braces. An unconfirmed account cannot hold a session and so
    -- cannot create anything, but deletion is irreversible: if a row ever does
    -- own an event, it is a bug worth investigating, never something to delete.
    and not exists (select 1 from public.events e where e.owner_id = u.id)
  order by u.created_at;
$$;

comment on function public.stale_unconfirmed_signups(integer) is
  'Never-confirmed signups old enough to delete, excluding any that own data. Service-role only.';

-- EXECUTE is granted to PUBLIC by default; the revoke is what makes this
-- service-role-only, and it strips service_role too (which holds it only via
-- PUBLIC), so the grant must follow.
revoke all on function public.stale_unconfirmed_signups(integer) from public, anon, authenticated;
grant execute on function public.stale_unconfirmed_signups(integer) to service_role;
