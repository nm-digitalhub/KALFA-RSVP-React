-- The evidence of each customer's consent to KALFA marketing email, and the switch that releases the feature.
--
-- WHY: Communications Law §30A requires prior written consent before a marketing email, and in a claim the advertiser
-- has to prove it. No consent to marketing email is recorded anywhere today (measured 11.10.2026). The record cannot
-- sit on profiles or user_settings: a signed-in user can write every column of their own row (measured 11.10.2026 with
-- an aborted write as authenticated), and Supabase's column-level-security guide recommends a dedicated table instead.
-- Change: openspec/changes/marketing-email-consent (design D1, D2, D9).
--
-- WHAT IT DOES:
--   1. public.marketing_consent_events — one row per grant or withdrawal, never changed afterwards.
--      * user_id has NO foreign key on purpose: a cascade would delete the evidence with the account, SET NULL would be
--        an UPDATE the immutability trigger refuses (breaking auth.admin.deleteUser), and RESTRICT would block account
--        deletion. email is stored on every row so a record still names its address after the account is gone.
--      * A grant must carry the wording the customer saw and its version.
--      * provider_event_id (the webhook's svix-id) is unique, so a redelivered provider event records once.
--      * RLS on with no policy; every privilege revoked from anon, authenticated and service_role, then only SELECT and
--        INSERT granted back to service_role. A BEFORE UPDATE OR DELETE trigger refuses any change from any role.
--   2. app_settings.marketing_consent_enabled (default false): the signup box and the settings toggle are shown only
--      when true, so the code can ship before the wording and the privacy text are approved.
--
-- WHAT IT DOES NOT DO: send anything, or touch profiles, user_settings, contacts or guests.
--
-- ROLLBACK (only while the table holds no evidence — once it does, never drop it):
--   alter table public.app_settings drop column if exists marketing_consent_enabled;
--   drop table public.marketing_consent_events;
--   drop function public.marketing_consent_events_immutable();

create table public.marketing_consent_events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid,
  email              text not null check (email <> ''),
  action             text not null check (action in ('grant', 'withdraw')),
  source             text not null check (
                       source in ('signup', 'settings', 'provider_unsubscribe', 'provider_complaint', 'account_removed')
                     ),
  wording            text,
  wording_version    text,
  ip                 inet,
  user_agent         text,
  provider_event_id  text,
  occurred_at        timestamptz not null default now(),
  constraint marketing_consent_events_grant_has_wording
    check (action <> 'grant' or (wording is not null and wording <> '' and wording_version is not null and wording_version <> ''))
);

comment on table public.marketing_consent_events is
  'Evidence of customer consent to KALFA marketing email (Communications Law §30A). Append-only: written by the server (service_role) only, never updated or deleted. The latest row per user (or per email) is the current consent. Customers only — never guests or event contacts.';
comment on column public.marketing_consent_events.user_id is
  'auth.users.id at the time. No foreign key: the record must outlive the account (see the migration header).';
comment on column public.marketing_consent_events.email is
  'The address the consent applies to, as it was at the time.';
comment on column public.marketing_consent_events.wording is
  'For a grant: the exact consent text shown to the customer, as rendered by the server.';
comment on column public.marketing_consent_events.provider_event_id is
  'The email provider''s webhook event id (svix-id) when the row came from a provider event.';

create unique index marketing_consent_events_provider_event_key
  on public.marketing_consent_events (provider_event_id)
  where provider_event_id is not null;
create index marketing_consent_events_user_latest
  on public.marketing_consent_events (user_id, occurred_at desc);
create index marketing_consent_events_email_latest
  on public.marketing_consent_events (lower(email), occurred_at desc);

alter table public.marketing_consent_events enable row level security;

revoke all on table public.marketing_consent_events from anon, authenticated, service_role;
grant select, insert on table public.marketing_consent_events to service_role;

create function public.marketing_consent_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'marketing_consent_events is append-only (% blocked)', tg_op;
end;
$$;

create trigger marketing_consent_events_immutable
  before update or delete on public.marketing_consent_events
  for each row execute function public.marketing_consent_events_immutable();

alter table public.app_settings
  add column if not exists marketing_consent_enabled boolean not null default false;

comment on column public.app_settings.marketing_consent_enabled is
  'When true, the signup form offers the marketing-email consent box and settings shows the toggle. Default false until the consent wording and the privacy text are approved.';
