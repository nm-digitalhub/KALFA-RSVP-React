-- call_compliance_settings — the switches that decide WHO may be called, apart from app_settings.
--
-- WHY: app_settings has grown to 115 columns mixing provider credentials, screens, billing and legal text. The settings
-- that decide whether a person may be called at all are compliance decisions with their own legal exposure, so they get
-- their own single-row table (owner decision 11.10.2026). Change: openspec/changes/dnc-registry-dial-gate.
--
-- WHAT IT DOES:
--   1. public.call_compliance_settings — one row (id = true), same access model as app_settings: RLS on, platform staff
--      read and update through the policy, authenticated holds only SELECT and UPDATE, anon nothing. The server reads
--      it with the service-role client.
--      * call_consent_required — MOVED from app_settings.call_consent_required, with its current value. When true, an AI
--        dial needs a recorded contacts.call_consent_at; false lifts only that check.
--      * dnc_registry_gate_enabled — NEW, default false. When true, dials whose purpose is marketing are checked against
--        the national "אל תתקשר אליי" registry before the provider is called.
--   2. The value of app_settings.call_consent_required is copied in. The old column is NOT dropped here: the code still
--      deployed reads it until this change's code is deployed. It is dropped by a follow-up migration created after that
--      deploy (tasks.md 2b.4).
--
-- ROLLBACK (before the old column is dropped):
--   drop table public.call_compliance_settings;

create table public.call_compliance_settings (
  id                         boolean primary key default true check (id),
  call_consent_required      boolean not null default true,
  dnc_registry_gate_enabled  boolean not null default false,
  updated_at                 timestamptz not null default now()
);

comment on table public.call_compliance_settings is
  'Single-row switches that decide who may be called (consent, Do-Not-Call registry). Split out of app_settings 11.10.2026.';
comment on column public.call_compliance_settings.call_consent_required is
  'When true (default, SAFE), an AI dial requires a recorded contacts.call_consent_at. False lifts only that check; opt-out and the local DNC list still apply. Moved from app_settings.call_consent_required.';
comment on column public.call_compliance_settings.dnc_registry_gate_enabled is
  'When true, outbound dials whose purpose is marketing are checked against the national Do-Not-Call registry before the provider is called (Consumer Protection Law 16ג). Default false until enablement is verified.';

insert into public.call_compliance_settings (id, call_consent_required)
select true, coalesce((select call_consent_required from public.app_settings where id = true), true);

alter table public.call_compliance_settings enable row level security;

revoke all on table public.call_compliance_settings from anon, authenticated;
grant select, update on table public.call_compliance_settings to authenticated;

create policy call_compliance_settings_staff_all on public.call_compliance_settings
  for all to authenticated
  using ((select public.is_platform_staff()))
  with check ((select public.is_platform_staff()));
