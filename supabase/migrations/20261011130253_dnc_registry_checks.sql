-- The record of every Do-Not-Call decision behind an outbound dial.
--
-- WHY: Consumer Protection Law 16ג(ג) requires a business to verify, before a marketing call, that the number is not
-- in the national "אל תתקשר אליי" registry; Regulation 3(ב) requires that check to fall within the 15 days before the
-- call, and the Sixth Schedule puts the burden of proving an exemption (a callback the person asked for) on the
-- business. No existing table can hold that proof (measured 11.10.2026): call_attempts is written only after the
-- gates pass and has no phone column; activity_log accepts client inserts; call_dnc_list keeps one row per phone,
-- overwritten on upsert. Change: openspec/changes/dnc-registry-dial-gate (design D8, task 4.1).
--
-- WHAT IT DOES:
--   1. public.dnc_registry_checks — one row per check (or exemption) used in a dial decision, never changed
--      afterwards. Written by the server (service_role) only; staff read it through the admin data layer. It holds no
--      token and no request header. `result`, `source`, `purpose` and `dial_path` are open text, so a new value needs
--      no migration.
--
-- ROLLBACK (only while the table holds no decisions — once it does, never drop it):
--   drop table public.dnc_registry_checks;
--   drop function public.dnc_registry_checks_immutable();

create table public.dnc_registry_checks (
  id              uuid primary key default gen_random_uuid(),
  phone_e164      text not null check (phone_e164 <> ''),
  checked_at      timestamptz not null default now(),
  result          text not null check (result <> ''),
  source          text not null check (source <> ''),
  transaction_id  uuid,
  error_code      integer,
  failure         text,
  purpose         text not null check (purpose <> ''),
  dial_path       text not null check (dial_path <> ''),
  exemption_ref   text,
  job_id          text,
  attempt_id      uuid
);

comment on table public.dnc_registry_checks is
  'Evidence of each Do-Not-Call decision behind an outbound dial (Consumer Protection Law 16ג, Regulation 3). Append-only: written by the server (service_role) only, never updated or deleted. No tokens or headers.';
comment on column public.dnc_registry_checks.result is
  'local_blocked | registry_listed | registry_clear | registry_unchecked | registry_unavailable | not_covered | exempt (src/lib/dnc/registry-check.ts).';
comment on column public.dnc_registry_checks.transaction_id is
  'The registry service''s transactionId, when it returned one — what the authority''s support asks for.';
comment on column public.dnc_registry_checks.exemption_ref is
  'For result = exempt: the record that proves the person asked to be called, e.g. callback_requests:<id>.';

create index dnc_registry_checks_phone_latest
  on public.dnc_registry_checks (phone_e164, checked_at desc);
create index dnc_registry_checks_latest
  on public.dnc_registry_checks (checked_at desc);

alter table public.dnc_registry_checks enable row level security;

revoke all on table public.dnc_registry_checks from anon, authenticated, service_role;
grant select, insert on table public.dnc_registry_checks to service_role;

create function public.dnc_registry_checks_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'dnc_registry_checks is append-only (% blocked)', tg_op;
end;
$$;

create trigger dnc_registry_checks_immutable
  before update or delete on public.dnc_registry_checks
  for each row execute function public.dnc_registry_checks_immutable();
