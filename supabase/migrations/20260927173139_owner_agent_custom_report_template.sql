-- =====================================================================
-- Owner WhatsApp agent: default template for a report written from the
-- owner's free-text instructions (2 body params: period, summary), next to
-- the numeric-report pair owner_agent_report_template_{name,lang} (4 params)
-- from 20260927011338. Owner approved 2026-09-27.
--
-- Additive: two nullable columns, same shape as the existing pair — except
-- the name length is checked with char_length, not a {1,512} regex bound:
-- Postgres regex repetition counts max out at 255, so '{1,512}' raises
-- 2201B "invalid repetition count(s)" on every non-null value (VERIFIED-LIVE
-- 2026-09-27). The two existing template-name CHECKs from 20260927011338
-- carry that bug and are FIXED below (owner approved 2026-09-27).
-- null = no out-of-window custom report (template_unavailable), never free
-- text.
--
-- Read from the LIVE schema on 2026-09-27 (pg_catalog, `db query --linked`):
--   * app_settings: RLS on, one policy app_settings_admin_all
--     USING ((select is_platform_staff())); table-level ACL
--     authenticated=rw (SELECT, UPDATE), no column-level ACLs — the new
--     columns inherit it exactly like the existing pair. No grant changes.
-- =====================================================================

alter table public.app_settings
  add column if not exists owner_agent_custom_report_template_name text,
  add column if not exists owner_agent_custom_report_template_lang text;

alter table public.app_settings
  drop constraint if exists app_settings_owner_agent_custom_report_template_name_check;
alter table public.app_settings
  add constraint app_settings_owner_agent_custom_report_template_name_check
    check (owner_agent_custom_report_template_name is null
           or (owner_agent_custom_report_template_name ~ '^[a-z0-9_]+$'
               and char_length(owner_agent_custom_report_template_name) <= 512));

alter table public.app_settings
  drop constraint if exists app_settings_owner_agent_custom_report_template_lang_check;
alter table public.app_settings
  add constraint app_settings_owner_agent_custom_report_template_lang_check
    check (owner_agent_custom_report_template_lang is null
           or owner_agent_custom_report_template_lang ~ '^[a-z]{2,3}(_[A-Z]{2})?$');

comment on column public.app_settings.owner_agent_custom_report_template_name is
  'Approved WhatsApp template (2 body params: period, summary) for a report '
  'written from the owner''s free-text instructions, sent outside the 24h '
  'window. null = no out-of-window custom report (template_unavailable), '
  'never free text.';


-- --- Fix: the two existing template-name CHECKs (20260927011338) ------------
-- '{1,512}' exceeds Postgres' regex repetition limit (255) and raises 2201B on
-- every non-null value, so no template name could ever be saved. Same meaning,
-- valid form: a shape regex plus a char_length bound. Both columns are null in
-- every live row today, so the new CHECKs validate instantly.

alter table public.app_settings
  drop constraint if exists app_settings_owner_agent_report_template_name_check;
alter table public.app_settings
  add constraint app_settings_owner_agent_report_template_name_check
    check (owner_agent_report_template_name is null
           or (owner_agent_report_template_name ~ '^[a-z0-9_]+$'
               and char_length(owner_agent_report_template_name) <= 512));

alter table public.owner_agent_report_subscription
  drop constraint if exists owner_agent_report_subscription_template_name_chk;
alter table public.owner_agent_report_subscription
  add constraint owner_agent_report_subscription_template_name_chk
    check (template_name is null
           or (template_name ~ '^[a-z0-9_]+$' and char_length(template_name) <= 512));


-- =====================================================================
-- DRY RUN (2026-09-27): this file's body inside one DO block that ends in
--   raise exception 'DRYRUN_ROLLBACK %', <checks>;
-- run through `supabase db query --linked` — the raise rolls everything back.
-- Then: npx supabase db push --linked --dry-run (must list ONLY this file)
--       npx supabase db push --linked
--       npx supabase db advisors --linked
--       npm run gen:types
--
-- ROLLBACK (manual, approval required):
--   alter table public.app_settings
--     drop constraint if exists app_settings_owner_agent_custom_report_template_lang_check,
--     drop constraint if exists app_settings_owner_agent_custom_report_template_name_check,
--     drop column if exists owner_agent_custom_report_template_lang,
--     drop column if exists owner_agent_custom_report_template_name;
--   (The two fixed CHECKs are not reverted: the old form raises 2201B on
--    every non-null value.)
-- =====================================================================
