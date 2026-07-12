-- P0-1 (A2a): billing-exposure toggle column on the wide single-row app_settings.
-- false = legacy (set-membership gate); true = exposure-gated. Default false.
alter table public.app_settings
  add column if not exists billing_exposure_gate boolean not null default false;
