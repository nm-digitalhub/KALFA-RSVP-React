-- One-shot reminder for a signup that was never confirmed.
--
-- Why this exists: a user who signs up and never clicks the confirmation link
-- simply disappears — nothing in the product notices, and until 2026-09-06 the
-- login screen answered them "wrong email or password" forever. The sweep
-- (src/lib/data/signup-confirmation-reminder.ts, worker/main.ts) re-sends the
-- confirmation mail ONCE, a day after signup.
--
-- Deliberately ONE reminder, never a cascade: a second nudge to someone who
-- ignored the first is spam-adjacent, and the "signed up a day ago, still
-- unconfirmed" set is enriched for typo and throwaway addresses, so every extra
-- send is also extra hard-bounce exposure on the same Resend domain that
-- carries the signed agreements. For the same reason the candidate query below
-- excludes any address whose confirmation mail has ALREADY hard-bounced
-- (klnetanel@gnail.com, 2026-09-01, is the live example).

-- 1. The one-shot latch. On profiles rather than a new table: handle_new_user()
--    already guarantees a row per auth user, and this mirrors
--    contact_messages.reminder_sent_at, the same idiom in inquiry-followup.
alter table public.profiles
  add column if not exists signup_reminder_sent_at timestamptz;

comment on column public.profiles.signup_reminder_sent_at is
  'When the one-shot "confirm your email" reminder was sent. Non-null = never remind again.';

-- 2. Kill-switch, off by default like every other sweep switch. Surfaced at
--    /admin/settings — a DB column alone is not an operable control.
alter table public.app_settings
  add column if not exists signup_reminder_enabled boolean not null default false;

comment on column public.app_settings.signup_reminder_enabled is
  'Arms the daily signup-confirmation reminder sweep. Off by default.';

-- 3. auth.users is not exposed through PostgREST, so the sweep cannot read
--    confirmation state with the service-role client directly. SECURITY DEFINER
--    keeps the read narrow: it returns ONLY unconfirmed, not-yet-reminded,
--    recent signups — never a general window onto auth.users.
create or replace function public.signup_reminder_candidates(
  min_age_hours integer default 24,
  max_age_days integer default 7
)
returns table (user_id uuid, email text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.created_at
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email_confirmed_at is null
    and u.deleted_at is null
    and u.email is not null
    and p.signup_reminder_sent_at is null
    -- Old enough that they have plainly not just clicked the link, young enough
    -- that a reminder still reads as part of the signup they started.
    and u.created_at < now() - make_interval(hours => min_age_hours)
    and u.created_at > now() - make_interval(days => max_age_days)
    -- Never re-mail an address the provider already rejected outright.
    -- jsonb_exists (not the `?` operator) so drivers that treat `?` as a bind
    -- placeholder cannot mangle this.
    and not exists (
      select 1
      from public.webhook_inbox w
      where w.provider = 'resend'
        and w.event_kind = 'email_delivery'
        and w.payload ->> 'type' = 'email.bounced'
        and jsonb_exists(w.payload -> 'data' -> 'to', u.email::text)
    )
  order by u.created_at;
$$;

comment on function public.signup_reminder_candidates(integer, integer) is
  'Signups due exactly one confirmation reminder. Service-role only.';

-- EXECUTE on a new function is granted to PUBLIC by default, so the revoke is
-- what makes it service-role-only — and it also strips service_role, which
-- holds it only via PUBLIC. The grant below must therefore follow the revoke.
revoke all on function public.signup_reminder_candidates(integer, integer) from public, anon, authenticated;
grant execute on function public.signup_reminder_candidates(integer, integer) to service_role;

-- 4. Backfill: treat every CURRENTLY unconfirmed signup as already reminded, so
--    arming the switch cannot blast the accumulated backlog. Only signups made
--    from here on are ever reminded.
update public.profiles p
set signup_reminder_sent_at = now()
from auth.users u
where u.id = p.id
  and u.email_confirmed_at is null
  and p.signup_reminder_sent_at is null;
