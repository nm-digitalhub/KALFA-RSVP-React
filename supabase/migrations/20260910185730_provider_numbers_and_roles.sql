-- =====================================================================
-- provider_numbers + provider_number_roles
--
-- provider_numbers: every business phone number / sender identity KALFA holds at a
-- provider, one row per (provider, provider_ref). The same E.164 may legitimately
-- appear under several providers — the backfill below produces +972 3-330-1505 twice,
-- once as the ExtrA line and once as the company contact phone. Snapshot = non-secret
-- provider status fields (quality, tier, verification, renewal…), never a token.
--
-- ⚠️ `provider` AND `role` ARE POSTGRES ENUMS, NOT text + CHECK.
-- The plan (§Task 1.1 Step 4) offered both and recommended this one; the reason is a
-- gap this document watched happen to itself. §5.3 added `business_line_inbound` to
-- the role list, the backfill below writes that row, and the TypeScript union stayed
-- at nine — schema inviting extension with nothing enforcing that the code follows.
-- An enum closes it at zero cost in new code: `npm run gen:types` emits it into
-- types.generated.ts, and scripts/check-supabase-types.mjs — the FIRST step of
-- `npm run deploy` — blocks a deploy on drift. The TS type stops being maintained by
-- hand and becomes `Enums<'provider_number_role'>`. It is also the house pattern:
-- public.app_role, public.campaign_channel and eight others are enums.
-- The price is identical to a CHECK — adding a value is a migration — and that is
-- correct for a runtime contract.
--
-- `source` deliberately stays text + CHECK: it is a provenance label with no runtime
-- reader and no TypeScript union to drift against.
--
-- Access model mirrors channels_admin_all (20260726111038): admin writes go through
-- the cookie client (authenticated + platform staff); the worker/runtime reads via
-- service_role, which keeps the schema-default ALL grant.
--
-- ⚠️ THE PREDICATE IS is_platform_staff(), NOT has_role(uid,'admin'). Migration
-- 20260910090301 moved all 21 existing policies off the retired axis and left ZERO on
-- has_role. Creating these two tables on it would put it straight back into a database
-- just cleaned of it.
--
-- ROLLBACK (also at the bottom): drop the roles table first — the FK is
-- `on delete restrict`. Then the tables, then the two enum types. Legacy app_settings
-- columns are untouched, so rollback restores the exact pre-migration runtime: the
-- resolvers fall back to those columns.
-- =====================================================================

create type public.provider_key as enum (
  'meta_whatsapp', 'voximplant', 'extra_sms', 'company'
);

-- Ten values. `business_line_inbound` is the one with no runtime reader — it is the
-- ExtrA virtual line that forwards inbound calls to the owner's device, a display/ops
-- label. Documented rather than designed around: if such labels accumulate, split them
-- out (runtime roles in this enum, display tags in `snapshot`) rather than loosening
-- the whole set.
create type public.provider_number_role as enum (
  'whatsapp_rsvp_sender',
  'whatsapp_import_sender',
  'voice_caller_id_rsvp',
  'voice_caller_id_meeting_confirm',
  'voice_caller_id_sales',
  'voice_caller_id_call_me_now',
  'voice_inbound_did',
  'sms_sender',
  'company_contact',
  'business_line_inbound'
);

create table if not exists public.provider_numbers (
  id            uuid primary key default gen_random_uuid(),
  provider      public.provider_key not null,
  provider_ref  text,                              -- Meta phone_number_id / Voximplant phone_id / ExtrA sender / 'contact'
  e164          text
                constraint provider_numbers_e164_chk
                check (e164 is null or e164 ~ '^\+[1-9][0-9]{6,14}$'),
  display_label text,                              -- admin-facing label ("מספר RSVP", "מספר ייבוא")
  is_active     boolean not null default true,
  snapshot      jsonb,                             -- provider status fields only. DELIBERATELY untyped:
                                                   -- the one open surface here, so a provider adding a
                                                   -- status field needs no migration. Do not "improve" it
                                                   -- into a rigid type. NEVER a token, PIN or app secret —
                                                   -- it is written straight from a provider response.
  snapshot_at   timestamptz,
  source        text not null default 'admin'
                constraint provider_numbers_source_chk check (source in ('admin','backfill','sync')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint provider_numbers_ref_or_e164 check (provider_ref is not null or e164 is not null)
);

create unique index if not exists provider_numbers_provider_ref_uq
  on public.provider_numbers (provider, provider_ref) where provider_ref is not null;

-- The Voximplant backfill row carries provider_ref = null, so the partial index above
-- does not cover it — without this second index `on conflict do nothing` has no
-- arbiter for that row and a second execution inserts a DUPLICATE. It also makes "at
-- most one backfill row per provider" a real invariant, which is exactly what the role
-- backfill's `source='backfill'` join assumes.
create unique index if not exists provider_numbers_backfill_uq
  on public.provider_numbers (provider) where source = 'backfill';

create index if not exists provider_numbers_e164_idx on public.provider_numbers (e164);

comment on table public.provider_numbers is
  'Business phone numbers / sender identities per provider. Replaces the four single fields on app_settings (whatsapp_phone_number_id, voximplant_caller_id, extra_sms_sender, company_contact_phone) which stay as read-fallbacks until the cleanup migration. Snapshot holds non-secret provider status only.';

-- Exactly ONE number per role (role is the PK); a number may hold many roles. The
-- runtime resolvers read this first and fall back to the legacy app_settings column
-- while the backfill is verified.
create table if not exists public.provider_number_roles (
  role       public.provider_number_role primary key,
  number_id  uuid not null references public.provider_numbers(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index if not exists provider_number_roles_number_idx on public.provider_number_roles (number_id);

comment on table public.provider_number_roles is
  'Which provider_numbers row serves which runtime role. One row per role. Voice caller ids are per persona (RSVP / meeting-confirm / sales / call-me-now) — the four personas shared app_settings.voximplant_caller_id before this table. business_line_inbound = the ExtrA virtual line that forwards inbound calls to the owner''s device (display/ops role, no runtime reader).';

drop trigger if exists provider_numbers_set_updated_at on public.provider_numbers;
create trigger provider_numbers_set_updated_at
  before update on public.provider_numbers
  for each row execute function public.set_updated_at();
drop trigger if exists provider_number_roles_set_updated_at on public.provider_number_roles;
create trigger provider_number_roles_set_updated_at
  before update on public.provider_number_roles
  for each row execute function public.set_updated_at();

-- RLS: mirrors channels_admin_all, with `to authenticated` added (the
-- app_settings_admin_all form). anon has every privilege revoked, so it never reaches
-- policy evaluation at all. Policies use the initplan-wrapped form so auth is
-- evaluated once per statement, not per row.
alter table public.provider_numbers enable row level security;
alter table public.provider_number_roles enable row level security;
revoke all on public.provider_numbers from anon, authenticated;
revoke all on public.provider_number_roles from anon, authenticated;
grant select, insert, update, delete on public.provider_numbers to authenticated;
grant select, insert, update, delete on public.provider_number_roles to authenticated;

drop policy if exists provider_numbers_admin_all on public.provider_numbers;
create policy provider_numbers_admin_all on public.provider_numbers for all
  to authenticated
  using ((select public.is_platform_staff()))
  with check ((select public.is_platform_staff()));
drop policy if exists provider_number_roles_admin_all on public.provider_number_roles;
create policy provider_number_roles_admin_all on public.provider_number_roles for all
  to authenticated
  using ((select public.is_platform_staff()))
  with check ((select public.is_platform_staff()));

-- Backfill from the four legacy fields. Idempotent: every insert has an arbiter index.
--
-- E.164 normalization is a ONE-TIME expression over the four values measured
-- 2026-09-10, not a runtime rule and not a country assumption for new numbers (the
-- admin form validates E.164 in Zod):
--   whatsapp_phone_number_id = '1018741517998430'  (a Meta id, not a phone number)
--   voximplant_caller_id     = '97237219347'       (11 digits, NO '+')
--   extra_sms_sender         = '03-3301505'        (Israeli local, punctuated)
--   company_contact_phone    = '033301505'         (Israeli local, digits only)
-- Digits-only with a country code get a '+'; a leading '0' is the Israeli local form
-- of the two lines this account actually holds; anything else stays null, the screen
-- says "השלימו E.164", and the Phase 1.3 sync fills it.
insert into public.provider_numbers (provider, provider_ref, display_label, source)
select 'meta_whatsapp'::public.provider_key, whatsapp_phone_number_id, 'מספר אישורי הגעה (RSVP)', 'backfill'
  from public.app_settings where whatsapp_phone_number_id is not null
on conflict do nothing;

-- voximplant_caller_id is '97237219347' — digits, no '+'. Writing e164 = null on a row
-- whose provider_ref is ALSO null violates provider_numbers_ref_or_e164 and aborts the
-- whole migration (reproduced verbatim in a dry run). So: normalize digits → '+digits',
-- and only insert when the result IS a valid E.164 — Phase 1.3 merges this row BY
-- E.164, so a null-e164 row would be unmergeable and would strand its four voice roles
-- on a number the sync can never complete. If the value is ever unnormalizable, no row
-- is created, no voice role is assigned, and the resolvers keep falling back to
-- app_settings.voximplant_caller_id (fail-safe).
insert into public.provider_numbers (provider, provider_ref, e164, display_label, source)
select 'voximplant'::public.provider_key, null, '+' || d.digits, 'מספר יוצא (Caller ID)', 'backfill'
  from public.app_settings s
  cross join lateral (select regexp_replace(coalesce(s.voximplant_caller_id,''), '[^0-9]', '', 'g') as digits) d
 where s.voximplant_caller_id is not null
   and d.digits ~ '^[1-9][0-9]{6,14}$'
on conflict do nothing;

-- ExtrA: provider_ref = the verified sender id string as stored today ('03-3301505').
-- The e164 CASE is SEPARABLE from the fix above — this insert cannot fail without it
-- (provider_ref is not null). It is here because the numbers module groups by E.164,
-- and MEASURED both this line and company_contact_phone normalize to +97233301505 —
-- that is what makes "מספר אחד, ארבעה כובעים" render on day one instead of after the
-- first Phase 1.3 sync.
insert into public.provider_numbers (provider, provider_ref, e164, display_label, source)
select 'extra_sms'::public.provider_key, s.extra_sms_sender,
       case when d.digits ~ '^0[1-9][0-9]{6,12}$' then '+972' || substring(d.digits from 2)
            when d.digits ~ '^[1-9][0-9]{6,14}$'  then '+' || d.digits
            else null end,
       'קו העסק / שולח SMS (ExtrA)', 'backfill'
  from public.app_settings s
  cross join lateral (select regexp_replace(coalesce(s.extra_sms_sender,''), '[^0-9]', '', 'g') as digits) d
 where s.extra_sms_sender is not null
on conflict do nothing;

-- Company: same separable normalization; provider_ref stays the literal 'contact'
-- (this row is a pointer to the agreement field, edited in /admin/company).
insert into public.provider_numbers (provider, provider_ref, e164, display_label, source)
select 'company'::public.provider_key, 'contact',
       case when d.digits ~ '^0[1-9][0-9]{6,12}$' then '+972' || substring(d.digits from 2)
            when d.digits ~ '^[1-9][0-9]{6,14}$'  then '+' || d.digits
            else null end,
       'טלפון החברה (הסכם)', 'backfill'
  from public.app_settings s
  cross join lateral (select regexp_replace(coalesce(s.company_contact_phone,''), '[^0-9]', '', 'g') as digits) d
 where s.company_contact_phone is not null
on conflict do nothing;

-- NINE roles. Each branch matches at most one row thanks to
-- provider_numbers_backfill_uq; a provider whose backfill row was not created simply
-- contributes no role, and its resolver keeps the legacy fallback.
--
-- voice_inbound_did is assigned here rather than left to Phase 3 because the account
-- holds exactly ONE DID — 97237219347, phone_id 2303422 — and it is the very number
-- this backfill just inserted as the caller id. The role is descriptive (nothing dials
-- "the inbound DID"; Voximplant routes by rule pattern), so assigning it cannot break a
-- runtime reader, and a second DID would repoint it with a one-row UPDATE.
--
-- whatsapp_import_sender is NOT assigned here: the WABA's second number
-- (1298694319994421 / +972 3-330-1505) has no backfill row of its own — the legacy
-- app_settings field holds only the RSVP sender — and it joins the table on the first
-- Phase 1.3 sync.
--
-- ⚠️ EVERY LITERAL IS CAST. Inside a UNION the branch literals resolve as `text`, and
-- Postgres will not implicitly cast text -> enum on the INSERT target:
--   ERROR: 42804 column "role" is of type provider_number_role but expression is of
--          type text
-- Caught by the dry run before this file ever reached the database. Casting only the
-- first branch would type the whole UNION, but naming the type on each line is what a
-- reader checks against the enum declared at the top.
insert into public.provider_number_roles (role, number_id)
select 'whatsapp_rsvp_sender'::public.provider_number_role, id from public.provider_numbers where provider='meta_whatsapp' and source='backfill'
union all select 'voice_caller_id_rsvp'::public.provider_number_role, id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'voice_inbound_did'::public.provider_number_role, id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'voice_caller_id_meeting_confirm'::public.provider_number_role, id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'voice_caller_id_sales'::public.provider_number_role, id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'voice_caller_id_call_me_now'::public.provider_number_role, id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'sms_sender'::public.provider_number_role, id from public.provider_numbers where provider='extra_sms' and source='backfill'
union all select 'business_line_inbound'::public.provider_number_role, id from public.provider_numbers where provider='extra_sms' and source='backfill'
union all select 'company_contact'::public.provider_number_role, id from public.provider_numbers where provider='company' and source='backfill'
on conflict (role) do nothing;

-- ROLLBACK:
--   drop table public.provider_number_roles;
--   drop table public.provider_numbers;
--   drop type public.provider_number_role;
--   drop type public.provider_key;
-- (roles first — the FK is `on delete restrict`; then the types, which the columns
-- depend on. Indexes, triggers and policies drop with their tables.)
