-- Admin-editable version of DEFAULT_CALLBACK_POLICY (src/lib/callbacks/schedule-policy.ts).
-- Single settings row (id=true), same singleton shape as app_settings/channels_lookup.
-- Seed values below are copied verbatim from DEFAULT_CALLBACK_POLICY so a fresh read
-- through the new loader matches today's hardcoded behavior exactly until an admin
-- changes something.

create table public.callback_schedule_policies (
  id boolean primary key default true,
  check (id),

  sun_start_min smallint,
  sun_end_min smallint,
  mon_start_min smallint,
  mon_end_min smallint,
  tue_start_min smallint,
  tue_end_min smallint,
  wed_start_min smallint,
  wed_end_min smallint,
  thu_start_min smallint,
  thu_end_min smallint,
  fri_start_min smallint,
  fri_end_min smallint,
  sat_start_min smallint,
  sat_end_min smallint,

  min_notice_minutes smallint not null default 120,
  horizon_days smallint not null default 14,
  duration_minutes smallint not null default 15,
  daily_cap smallint not null default 8,
  motzash_resume_minutes smallint not null default 30,

  updated_at timestamptz not null default now(),

  check ((sun_start_min is null) = (sun_end_min is null)
    and (sun_start_min is null or (sun_start_min between 0 and 1439 and sun_end_min between 1 and 1440 and sun_start_min < sun_end_min))),
  check ((mon_start_min is null) = (mon_end_min is null)
    and (mon_start_min is null or (mon_start_min between 0 and 1439 and mon_end_min between 1 and 1440 and mon_start_min < mon_end_min))),
  check ((tue_start_min is null) = (tue_end_min is null)
    and (tue_start_min is null or (tue_start_min between 0 and 1439 and tue_end_min between 1 and 1440 and tue_start_min < tue_end_min))),
  check ((wed_start_min is null) = (wed_end_min is null)
    and (wed_start_min is null or (wed_start_min between 0 and 1439 and wed_end_min between 1 and 1440 and wed_start_min < wed_end_min))),
  check ((thu_start_min is null) = (thu_end_min is null)
    and (thu_start_min is null or (thu_start_min between 0 and 1439 and thu_end_min between 1 and 1440 and thu_start_min < thu_end_min))),
  check ((fri_start_min is null) = (fri_end_min is null)
    and (fri_start_min is null or (fri_start_min between 0 and 1439 and fri_end_min between 1 and 1440 and fri_start_min < fri_end_min))),
  check ((sat_start_min is null) = (sat_end_min is null)
    and (sat_start_min is null or (sat_start_min between 0 and 1439 and sat_end_min between 1 and 1440 and sat_start_min < sat_end_min))),

  check (min_notice_minutes >= 0),
  check (horizon_days between 1 and 90),
  check (duration_minutes between 5 and 120),
  check (daily_cap between 1 and 50),
  check (motzash_resume_minutes >= 0)
);

comment on table public.callback_schedule_policies is
  'Admin-editable callback-scheduling policy (hours, notice, horizon, duration, daily cap, motzash resume). Single row, id=true. Falls back to DEFAULT_CALLBACK_POLICY in code on any read failure or missing row — see src/lib/callbacks/policy-config.ts.';

alter table public.callback_schedule_policies enable row level security;

-- Same shape as app_settings: RLS is not the only layer. Revoke the wide-open
-- schema defaults first, then grant back only what admin the UI actually needs
-- (select + update; the seed row below is the only insert this table ever gets).
revoke all on public.callback_schedule_policies from anon;
revoke all on public.callback_schedule_policies from authenticated;
grant select, update on public.callback_schedule_policies to authenticated;

create policy callback_schedule_policies_admin_all
  on public.callback_schedule_policies
  as permissive
  for all
  to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)));

insert into public.callback_schedule_policies (
  id,
  sun_start_min, sun_end_min,
  mon_start_min, mon_end_min,
  tue_start_min, tue_end_min,
  wed_start_min, wed_end_min,
  thu_start_min, thu_end_min,
  fri_start_min, fri_end_min,
  sat_start_min, sat_end_min,
  min_notice_minutes, horizon_days, duration_minutes, daily_cap, motzash_resume_minutes
) values (
  true,
  540, 1080,
  540, 1080,
  540, 1080,
  540, 1080,
  540, 1080,
  540, 780,
  null, null,
  120, 14, 15, 8, 30
)
on conflict (id) do nothing;
