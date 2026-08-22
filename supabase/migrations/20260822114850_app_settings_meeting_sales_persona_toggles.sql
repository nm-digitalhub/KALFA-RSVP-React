-- Per-persona kill switches for the meeting-confirm and sales-closing
-- Voximplant dispatchers. Requested by sales-meeting-voximplant-build,
-- routed via team-lead, 2026-08-22.
--
-- Why separate columns, not reusing voximplant_live_calls/voximplant_
-- rule_id: those stay RSVPAgent's exclusively -- rule_id in particular is
-- the live OutCall rule (1494311), which CLAUDE.md already forbids touching
-- with the bridge. Sharing a toggle or rule_id across personas would risk a
-- wrong-dial-target failure (a meeting-confirm or sales dispatch firing
-- against the RSVP rule, or vice versa) -- each new persona gets its own
-- enabled flag and its own rule_id, same shape as the existing voximplant_
-- live_calls/voximplant_rule_id pair
-- (20260714213031_voximplant_live_calls_toggle.sql,
-- 20260714160000_voximplant_bridge.sql), fail-closed default (false/null)
-- matching that precedent exactly. The shared service-account JSON, caller
-- id, callback secret, and balance thresholds remain common (one Voximplant
-- account) -- only the per-persona enable/rule_id pair is new.
--
-- Consumer code already exists and reads these exact column names
-- (verified live, not assumed): src/lib/data/voximplant-config.ts
-- (getMeetingConfirmDispatchConfig/getSalesCallDispatchConfig) and
-- src/lib/data/admin/voximplant-channel.ts (getVoximplantChannelConfig).
-- Both access the columns through a forward-compatible string-keyed lookup
-- (the same pattern outreach-config.ts already uses), which is why `npx tsc
-- --noEmit` was already clean BEFORE this migration -- confirmed directly,
-- not assumed from the request text.
--
-- No RLS changes: app_settings already has admin-only RLS
-- (20260714213031's own comment: "app_settings has admin-only RLS, so only
-- an administrator can flip it"), unaffected by adding columns. No FK, no
-- index: single-row settings table, read via `.eq('id', true)`.
--
-- Validated: run inside an explicit BEGIN/ROLLBACK against the linked
-- project (2026-08-22), confirming the ALTER applies cleanly against the
-- live table, then rolled back. NOT applied outside that transaction --
-- staged pending explicit go, same process as the rest of this series.
--
-- Rollback: alter table public.app_settings drop column
-- voximplant_meeting_confirm_enabled, drop column
-- voximplant_meeting_confirm_rule_id, drop column
-- voximplant_sales_calls_enabled, drop column voximplant_sales_call_rule_id.

alter table public.app_settings
  add column voximplant_meeting_confirm_enabled boolean not null default false,
  add column voximplant_meeting_confirm_rule_id text,
  add column voximplant_sales_calls_enabled boolean not null default false,
  add column voximplant_sales_call_rule_id text;

comment on column public.app_settings.voximplant_meeting_confirm_enabled is
  'Admin toggle: permit REAL outbound Voximplant calls for the meeting-booking confirmation/reschedule dispatcher. Same fail-closed shape as voximplant_live_calls -- default false (dark). Independent of voximplant_live_calls, which stays RSVPAgent-only.';
comment on column public.app_settings.voximplant_meeting_confirm_rule_id is
  'Voximplant OutCall rule id for the meeting-confirm dispatcher -- deliberately separate from voximplant_rule_id (RSVPAgent''s rule, 1494311, must never carry another persona''s calls).';
comment on column public.app_settings.voximplant_sales_calls_enabled is
  'Admin toggle: permit REAL outbound Voximplant calls for the sales-closing dispatcher. Same fail-closed shape as voximplant_live_calls -- default false (dark). Independent of voximplant_live_calls, which stays RSVPAgent-only.';
comment on column public.app_settings.voximplant_sales_call_rule_id is
  'Voximplant OutCall rule id for the sales-closing dispatcher -- deliberately separate from voximplant_rule_id (RSVPAgent''s rule, 1494311, must never carry another persona''s calls).';
