-- =====================================================================
-- Owner WhatsApp agent: capabilities (media in, buttons/lists, reactions,
-- message bursts, BSUID identity, proactive daily report).
--
-- Plan: plans/owner-agent-chat-sdk-capabilities-plan.md §5, owner decisions
-- 2026-09-27 (§9): proactive messages + inbound media APPROVED; the write
-- tool set_report_schedule NOT approved, so there is no pending-schedule
-- table here — schedules are written only by the service-role owner DAL.
--
-- Additive. The only relaxations are owner_agent_intake.message_text NOT
-- NULL (a media/location/button row may have no text) and the replaced
-- owner_agent_billing_sums signature (one function, _until defaults to
-- null, so the live one-argument call keeps its exact result).
-- With every new column at its default the deployed code behaves exactly as
-- before: it inserts intake rows without message_type (-> 'text') and with
-- message_text set, which the type/fields CHECK accepts.
--
-- Read from the LIVE schema on 2026-09-27 (pg_catalog, `db query --linked`):
--   * owner_agent_intake: 19 rows, message_text NOT NULL on all of them;
--     no table-level grant, column-level SELECT to authenticated on the id /
--     status columns only — a column added here is hidden from
--     authenticated unless granted below.
--   * owner_agent_allowlist / owner_agent_audit: table-level SELECT to
--     authenticated, RLS on, *_owner_select USING ((select is_platform_owner())).
--   * Default privileges in schema public give anon and authenticated full
--     rights on every NEW table and EXECUTE on every new function (PUBLIC
--     also gets EXECUTE on CREATE FUNCTION) — hence every revoke names
--     public, anon and authenticated.
--   * owner_agent_billing_sums(timestamptz): LANGUAGE sql STABLE, SECURITY
--     INVOKER (not definer), search_path '', EXECUTE postgres + service_role
--     only, no dependent objects. Kept exactly so.
--   * pg_catalog.timezone(text, timestamptz) is IMMUTABLE, so it may appear
--     in a CHECK: an unknown zone name raises instead of being stored.
-- =====================================================================


-- --- 1. Intake: message type, media, interactive reply, location ----------

alter table public.owner_agent_intake
  alter column message_text drop not null,
  -- Code-shaped, NOT a closed list: a new Meta type needs no migration.
  -- The gate decides which types are answered (text, image, document,
  -- audio, location, interactive, button today).
  add column if not exists message_type      text not null default 'text',
  -- Meta media id (all digits). Downloaded after the gate, never stored.
  add column if not exists media_id          text,
  add column if not exists media_mime        text,
  add column if not exists media_sha256_b64  text,
  add column if not exists media_bytes       bigint,
  -- WhatsApp audio.voice (a voice note rather than an audio file).
  add column if not exists media_voice       boolean,
  add column if not exists media_filename    text,
  -- interactive.button_reply / list_reply id+title, or button.payload+text.
  -- Client-controlled: the id is resolved against `followups`, never trusted.
  add column if not exists interactive_id    text,
  add column if not exists interactive_title text,
  add column if not exists location_lat      double precision,
  add column if not exists location_lng      double precision,
  add column if not exists location_label    text,
  -- context.id of the inbound message (the wamid it replies to / reacts to).
  add column if not exists reply_to_wamid    text,
  -- The follow-up suggestions we offered as buttons/list rows for THIS
  -- intake; a click's nonce (oa:fu:<intake id>:<n>) is resolved here.
  add column if not exists followups         jsonb,
  -- wamids of what we sent for this intake (the answer AND the interactive
  -- message — a click's context.id is the interactive one).
  add column if not exists reply_wamids      text[],
  -- Voice-note transcript (the audio itself is never stored).
  add column if not exists transcript        text;

alter table public.owner_agent_intake
  add constraint owner_agent_intake_message_type_shape
    check (message_type ~ '^[a-z][a-z0-9_]{0,31}$'),
  add constraint owner_agent_intake_media_id_chk
    check (media_id is null or media_id ~ '^[0-9]{1,32}$'),
  -- Length only: voice notes arrive as 'audio/ogg; codecs=opus'.
  add constraint owner_agent_intake_media_mime_len
    check (media_mime is null or char_length(media_mime) between 3 and 255),
  -- Character set + length cap, not an exact 44-char form: a stricter check
  -- that disagreed with Meta would drop the message.
  add constraint owner_agent_intake_media_sha256_chk
    check (media_sha256_b64 is null or media_sha256_b64 ~ '^[A-Za-z0-9+/=_-]{1,128}$'),
  add constraint owner_agent_intake_media_bytes_nonneg
    check (media_bytes is null or media_bytes >= 0),
  add constraint owner_agent_intake_media_filename_len
    check (media_filename is null or char_length(media_filename) between 1 and 255),
  -- Generous cap: a guest template click on this number (plan §8 M5) must
  -- reach the gate as unknown_action, not fail the insert.
  add constraint owner_agent_intake_interactive_id_len
    check (interactive_id is null or char_length(interactive_id) between 1 and 1024),
  add constraint owner_agent_intake_interactive_title_len
    check (interactive_title is null or char_length(interactive_title) between 1 and 256),
  add constraint owner_agent_intake_location_range
    check ((location_lat is null or location_lat between -90 and 90)
           and (location_lng is null or location_lng between -180 and 180)),
  add constraint owner_agent_intake_location_label_len
    check (location_label is null or char_length(location_label) between 1 and 1024),
  add constraint owner_agent_intake_reply_to_wamid_len
    check (reply_to_wamid is null or char_length(reply_to_wamid) between 1 and 512),
  add constraint owner_agent_intake_followups_shape
    check (followups is null
           or (jsonb_typeof(followups) = 'array'
               and jsonb_array_length(followups) <= 10
               and octet_length(followups::text) <= 16384)),
  add constraint owner_agent_intake_reply_wamids_shape
    check (reply_wamids is null
           or (cardinality(reply_wamids) <= 8
               and array_position(reply_wamids, null) is null)),
  add constraint owner_agent_intake_transcript_len
    check (transcript is null or char_length(transcript) between 1 and 16384),
  -- Field groups: detail columns only next to the column that owns them.
  add constraint owner_agent_intake_media_group_chk
    check (media_id is not null
           or (media_mime is null and media_sha256_b64 is null and media_bytes is null
               and media_voice is null and media_filename is null and transcript is null)),
  add constraint owner_agent_intake_location_group_chk
    check ((location_lat is null) = (location_lng is null)
           and (location_label is null or location_lat is not null)),
  add constraint owner_agent_intake_interactive_group_chk
    check (interactive_title is null or interactive_id is not null),
  -- Type <-> fields. Known types carry their own group and no other; any
  -- other (future) type carries no typed group — only text/status — so it
  -- can be stored (and gated) without a migration.
  add constraint owner_agent_intake_type_fields_chk
    check (case
             when message_type = 'text' then
               message_text is not null
               and media_id is null and interactive_id is null and location_lat is null
             when message_type in ('image', 'document', 'audio', 'video', 'sticker') then
               media_id is not null
               and interactive_id is null and location_lat is null
             when message_type = 'location' then
               location_lat is not null
               and media_id is null and interactive_id is null
             when message_type in ('interactive', 'button') then
               interactive_id is not null
               and media_id is null and location_lat is null
             else
               media_id is null and interactive_id is null and location_lat is null
           end),
  add constraint owner_agent_intake_voice_is_audio_chk
    check (media_voice is null or message_type = 'audio');

-- Column-level grant (section 5 of 20260924034054): the code-shaped type is
-- visible to the owner's session; every free-text / client-controlled column
-- above (media_*, interactive_*, location_*, reply_to_wamid, followups,
-- reply_wamids, transcript) and message_text stay ungranted.
grant select (message_type) on table public.owner_agent_intake to authenticated;


-- --- 2. Intake + audit: burst coalescing and turn link (plan §5/§4.6) ------
-- Not in the lead's task list; taken from plan §5 because the approved
-- owner_agent_burst_ms (section 5) has nothing to record coalescing into
-- without it. Delete this section if unwanted.

alter table public.owner_agent_intake
  -- The newest queued message of a burst leads; the earlier ones point at it.
  add column if not exists coalesced_into uuid
    references public.owner_agent_intake (id) on delete set null;

alter table public.owner_agent_intake
  add constraint owner_agent_intake_coalesced_not_self
    check (coalesced_into is null or coalesced_into <> id);

create index if not exists owner_agent_intake_coalesced_into_idx
  on public.owner_agent_intake (coalesced_into) where coalesced_into is not null;

grant select (coalesced_into) on table public.owner_agent_intake to authenticated;

alter table public.owner_agent_audit
  -- The leading intake of the turn an audit row belongs to (after coalescing).
  add column if not exists turn_intake_id uuid
    references public.owner_agent_intake (id) on delete set null;

create index if not exists owner_agent_audit_turn_intake_idx
  on public.owner_agent_audit (turn_intake_id) where turn_intake_id is not null;


-- --- 3. Allow-list: BSUID binding + report opt-in --------------------------

alter table public.owner_agent_allowlist
  -- Meta business-scoped user id (from_user_id), bound once by CAS from a
  -- signed message that ALSO carried a matching, verified `from`.
  add column if not exists bsuid           text,
  add column if not exists parent_bsuid    text,
  add column if not exists bsuid_bound_at  timestamptz,
  -- The phone the binding was made from; a BSUID-only message is diverted
  -- only while this equals the row's e164 and the verified phone.
  add column if not exists bound_from_e164 text,
  add column if not exists report_opt_in   boolean not null default false;

alter table public.owner_agent_allowlist
  add constraint owner_agent_allowlist_bsuid_key unique (bsuid),
  add constraint owner_agent_allowlist_bsuid_chk
    check (bsuid is null or bsuid ~ '^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]{1,128}$'),
  add constraint owner_agent_allowlist_parent_bsuid_chk
    check (parent_bsuid is null or parent_bsuid ~ '^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]{1,128}$'),
  add constraint owner_agent_allowlist_bound_from_e164_chk
    check (bound_from_e164 is null or bound_from_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- Bind and unbind (rotation = revoke) always move these together.
  add constraint owner_agent_allowlist_bsuid_binding_chk
    check ((bsuid is null) = (bsuid_bound_at is null)
           and (bsuid is null) = (bound_from_e164 is null)
           and (parent_bsuid is null or bsuid is not null));


-- --- 4. Proactive report: subscription + one row per sent slot ------------

create table if not exists public.owner_agent_report_subscription (
  id                 uuid primary key default gen_random_uuid(),
  -- The allow-list row IS the recipient identity; the phone is derived at
  -- send time from it, never stored here.
  allowlist_entry_id uuid not null
                     references public.owner_agent_allowlist (id) on delete cascade,
  report_key         text not null,
  -- Local wall-clock time in `timezone`, whole minutes.
  slot_time          time not null,
  timezone           text not null,
  enabled            boolean not null default false,
  -- Per-subscription template override; null = app_settings default.
  template_name      text,
  template_lang      text,
  -- Nullable: an external allow-list person has no auth user.
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint owner_agent_report_subscription_slot_key
    unique (allowlist_entry_id, report_key, slot_time),
  constraint owner_agent_report_subscription_report_key_shape
    check (report_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint owner_agent_report_subscription_slot_minute
    check (extract(second from slot_time) = 0),
  constraint owner_agent_report_subscription_timezone_chk
    check (timezone ~ '^[A-Za-z0-9_+/-]{1,64}$'
           and timezone(timezone, '2000-01-01 00:00:00+00'::timestamptz) is not null),
  constraint owner_agent_report_subscription_template_name_chk
    check (template_name is null or template_name ~ '^[a-z0-9_]{1,512}$'),
  constraint owner_agent_report_subscription_template_lang_chk
    check (template_lang is null or template_lang ~ '^[a-z]{2,3}(_[A-Z]{2})?$')
);

-- allowlist_entry_id is covered by the leading column of the unique key.
create index if not exists owner_agent_report_subscription_created_by_idx
  on public.owner_agent_report_subscription (created_by) where created_by is not null;

drop trigger if exists owner_agent_report_subscription_set_updated_at
  on public.owner_agent_report_subscription;
create trigger owner_agent_report_subscription_set_updated_at
  before update on public.owner_agent_report_subscription
  for each row execute function public.set_updated_at();

comment on table public.owner_agent_report_subscription is
  'Owner WhatsApp agent proactive reports: which allow-list row gets which '
  'report at which local time. Written only by the service-role owner DAL; '
  'the platform owner may read it.';

create table if not exists public.owner_agent_report_run (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
                  references public.owner_agent_report_subscription (id) on delete cascade,
  local_date      date not null,
  slot_time       time not null,
  -- claimed / sent / failed / expired / skipped today (code-shaped).
  status          text not null default 'claimed',
  -- text (inside the 24h window) / template (code-shaped).
  channel         text,
  outbound_wamid  text,
  -- Our code or Meta's numeric code (e.g. 131047).
  error_code      text,
  claimed_at      timestamptz not null default now(),
  sent_at         timestamptz,
  -- The claim: one INSERT ... ON CONFLICT DO NOTHING per slot = at most one send.
  constraint owner_agent_report_run_slot_key
    unique (subscription_id, local_date, slot_time),
  constraint owner_agent_report_run_status_shape
    check (status ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint owner_agent_report_run_channel_shape
    check (channel is null or channel ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint owner_agent_report_run_outbound_wamid_len
    check (outbound_wamid is null or char_length(outbound_wamid) between 1 and 512),
  constraint owner_agent_report_run_error_code_shape
    check (error_code is null or error_code ~ '^[a-z0-9][a-z0-9_]{0,63}$')
);

-- subscription_id is covered by the leading column of the unique key;
-- claimed_at serves the retention purge.
create index if not exists owner_agent_report_run_claimed_idx
  on public.owner_agent_report_run (claimed_at);

comment on table public.owner_agent_report_run is
  'One row per (subscription, local date, slot): the unique key is the '
  'at-most-once guarantee for proactive reports. Ids and codes only.';

-- RLS + grants: service_role only, platform owner may read (ops_errors /
-- owner_agent_* pattern). No insert/update/delete policy on purpose.
alter table public.owner_agent_report_subscription enable row level security;
alter table public.owner_agent_report_run          enable row level security;

revoke all on table public.owner_agent_report_subscription from public, anon, authenticated;
revoke all on table public.owner_agent_report_run          from public, anon, authenticated;

grant select on table public.owner_agent_report_subscription to authenticated;
grant select on table public.owner_agent_report_run          to authenticated;

drop policy if exists owner_agent_report_subscription_owner_select
  on public.owner_agent_report_subscription;
create policy owner_agent_report_subscription_owner_select
  on public.owner_agent_report_subscription
  for select to authenticated
  using ((select public.is_platform_owner()));

drop policy if exists owner_agent_report_run_owner_select on public.owner_agent_report_run;
create policy owner_agent_report_run_owner_select on public.owner_agent_report_run
  for select to authenticated
  using ((select public.is_platform_owner()));


-- --- 5. Audit: which report run a row is about -----------------------------
-- The audit shape CHECKs are unchanged; every new code fits them.

alter table public.owner_agent_audit
  add column if not exists report_run_id uuid
    references public.owner_agent_report_run (id) on delete set null;

create index if not exists owner_agent_audit_report_run_idx
  on public.owner_agent_audit (report_run_id) where report_run_id is not null;


-- --- 6. app_settings: burst window, report switch, default template --------

alter table public.app_settings
  add column if not exists owner_agent_burst_ms              integer not null default 0,
  add column if not exists owner_agent_reports_enabled       boolean not null default false,
  add column if not exists owner_agent_report_template_name  text,
  add column if not exists owner_agent_report_template_lang  text;

alter table public.app_settings
  drop constraint if exists app_settings_owner_agent_burst_ms_check;
alter table public.app_settings
  -- Ceiling stays below the consumer's STRANDED_AFTER_MS.
  add constraint app_settings_owner_agent_burst_ms_check
    check (owner_agent_burst_ms >= 0 and owner_agent_burst_ms <= 15000);

alter table public.app_settings
  drop constraint if exists app_settings_owner_agent_report_template_name_check;
alter table public.app_settings
  add constraint app_settings_owner_agent_report_template_name_check
    check (owner_agent_report_template_name is null
           or owner_agent_report_template_name ~ '^[a-z0-9_]{1,512}$');

alter table public.app_settings
  drop constraint if exists app_settings_owner_agent_report_template_lang_check;
alter table public.app_settings
  add constraint app_settings_owner_agent_report_template_lang_check
    check (owner_agent_report_template_lang is null
           or owner_agent_report_template_lang ~ '^[a-z]{2,3}(_[A-Z]{2})?$');

comment on column public.app_settings.owner_agent_burst_ms is
  'Delay (ms) before an owner-agent intake job starts, so a burst of messages '
  'becomes one turn. 0 = start immediately (behaviour before this setting).';
comment on column public.app_settings.owner_agent_reports_enabled is
  'Owner-agent proactive reports kill switch, separate from owner_agent_enabled.';
comment on column public.app_settings.owner_agent_report_template_name is
  'Approved WhatsApp template for a report sent outside the 24h window. '
  'null = no out-of-window report (template_unavailable), never free text.';


-- --- 7. owner_agent_billing_sums: optional upper bound ---------------------
-- CREATE OR REPLACE with a second parameter would add an OVERLOAD, and the
-- live one-argument call would become ambiguous — so the function is
-- dropped and recreated as ONE function whose _until defaults to null.
-- Window is half-open [_since, _until). unvoided_credit_amount stays the
-- current balance (no range), as before. The drop removes the ACL and the
-- comment, so both are re-applied.

drop function if exists public.owner_agent_billing_sums(timestamptz);

create function public.owner_agent_billing_sums(
  _since timestamptz,
  _until timestamptz default null
)
returns table (
  charged_amount numeric,         -- final charges captured in range
  credit_applied_amount numeric,  -- credit consumed by close-charges in range
  unvoided_credit_amount numeric, -- current unvoided credit balance (no range)
  credit_granted_amount numeric   -- credit granted in range
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce((
      select sum(c.final_charge_amount)
      from public.campaigns c
      where c.charge_status = 'charged'
        and c.charged_at >= _since
        and (_until is null or c.charged_at < _until)
    ), 0),
    coalesce((
      select sum(c.credit_applied)
      from public.campaigns c
      where c.charge_status in ('charged', 'nothing_to_charge')
        and c.charged_at >= _since
        and (_until is null or c.charged_at < _until)
    ), 0),
    coalesce((
      select sum(b.amount)
      from public.billing_credits b
      where b.voided_at is null
    ), 0),
    coalesce((
      select sum(b.amount)
      from public.billing_credits b
      where b.voided_at is null
        and b.created_at >= _since
        and (_until is null or b.created_at < _until)
    ), 0);
$$;

comment on function public.owner_agent_billing_sums(timestamptz, timestamptz) is
  'Owner-agent billing_summary: money sums only (charged, credit applied, '
  'credit granted) in [_since, _until); _until null = open-ended. No row '
  'data. EXECUTE: service_role only.';

revoke all on function public.owner_agent_billing_sums(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.owner_agent_billing_sums(timestamptz, timestamptz) to service_role;


-- =====================================================================
-- DRY RUN (2026-09-27): this file's body inside one DO block that ends in
--   raise exception 'DRYRUN_ROLLBACK %', <checks>;
-- run through `supabase db query --linked -f` — the raise rolls everything
-- back. (The DO block's own dollar tag must not appear in this file.)
-- Then: npx supabase db push --linked --dry-run (must list ONLY this file)
--       npx supabase db push --linked
--       npx supabase db advisors --linked
--       npm run gen:types
--
-- ROLLBACK (manual, approval required). Restore the RPC first, while the
-- code still calls it with _since only:
--   drop function if exists public.owner_agent_billing_sums(timestamptz, timestamptz);
--   create function public.owner_agent_billing_sums(_since timestamptz)
--   returns table (charged_amount numeric, credit_applied_amount numeric,
--                  unvoided_credit_amount numeric, credit_granted_amount numeric)
--   language sql stable set search_path = '' as $$
--     select
--       coalesce((select sum(c.final_charge_amount) from public.campaigns c
--                 where c.charge_status = 'charged' and c.charged_at >= _since), 0),
--       coalesce((select sum(c.credit_applied) from public.campaigns c
--                 where c.charge_status in ('charged', 'nothing_to_charge')
--                   and c.charged_at >= _since), 0),
--       coalesce((select sum(b.amount) from public.billing_credits b
--                 where b.voided_at is null), 0),
--       coalesce((select sum(b.amount) from public.billing_credits b
--                 where b.voided_at is null and b.created_at >= _since), 0);
--   $$;
--   comment on function public.owner_agent_billing_sums(timestamptz) is
--     'Owner-agent billing_summary: money sums only (charged, credit applied, '
--     'credit granted). No row data. EXECUTE: service_role only.';
--   revoke all on function public.owner_agent_billing_sums(timestamptz)
--     from public, anon, authenticated;
--   grant execute on function public.owner_agent_billing_sums(timestamptz) to service_role;
--   alter table public.owner_agent_audit drop column if exists report_run_id,
--                                        drop column if exists turn_intake_id;
--   drop table if exists public.owner_agent_report_run;
--   drop table if exists public.owner_agent_report_subscription;
--   alter table public.owner_agent_allowlist
--     drop constraint if exists owner_agent_allowlist_bsuid_key,
--     drop column if exists report_opt_in, drop column if exists bound_from_e164,
--     drop column if exists bsuid_bound_at, drop column if exists parent_bsuid,
--     drop column if exists bsuid;
--   -- Only when no row has message_text null (media/location/button rows):
--   --   delete them or backfill, then set not null again.
--   alter table public.owner_agent_intake
--     drop column if exists coalesced_into, drop column if exists transcript,
--     drop column if exists reply_wamids, drop column if exists followups,
--     drop column if exists reply_to_wamid, drop column if exists location_label,
--     drop column if exists location_lng, drop column if exists location_lat,
--     drop column if exists interactive_title, drop column if exists interactive_id,
--     drop column if exists media_filename, drop column if exists media_voice,
--     drop column if exists media_bytes, drop column if exists media_sha256_b64,
--     drop column if exists media_mime, drop column if exists media_id,
--     drop column if exists message_type;
--   alter table public.owner_agent_intake alter column message_text set not null;
--   alter table public.app_settings
--     drop constraint if exists app_settings_owner_agent_report_template_lang_check,
--     drop constraint if exists app_settings_owner_agent_report_template_name_check,
--     drop constraint if exists app_settings_owner_agent_burst_ms_check,
--     drop column if exists owner_agent_report_template_lang,
--     drop column if exists owner_agent_report_template_name,
--     drop column if exists owner_agent_reports_enabled,
--     drop column if exists owner_agent_burst_ms;
-- (Dropping a column drops its CHECKs, indexes and column grants with it.)
-- =====================================================================
