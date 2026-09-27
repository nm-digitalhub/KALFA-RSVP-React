-- =====================================================================
-- Owner WhatsApp agent: free-text report instructions per subscription
-- (owner request 2026-09-27). The owner writes, in the admin screen, what a
-- report should contain; the report builder reads it at send time.
--
-- Additive: one nullable column + its CHECK. Read from the LIVE schema on
-- 2026-09-27 (pg_catalog, `db query --linked`):
--   * owner_agent_report_subscription (20260927011338): 0 rows; table-level
--     SELECT to authenticated behind owner_agent_report_subscription_owner_select
--     USING ((select is_platform_owner())); writes service_role only. A new
--     column inherits that table-level grant — owner read, service-role
--     write — so no grant change is needed.
--   * slot_time CHECK owner_agent_report_subscription_slot_minute is
--     extract(second from slot_time) = 0: ANY whole minute is allowed
--     (08:00, 07:45, 23:59), not only round hours. Left unchanged.
--   * No cap on the number of slots exists: no count CHECK, and the only
--     trigger is set_updated_at. Each slot is its own row; the unique key
--     (allowlist_entry_id, report_key, slot_time) stays.
-- =====================================================================

alter table public.owner_agent_report_subscription
  add column if not exists instructions text;

alter table public.owner_agent_report_subscription
  add constraint owner_agent_report_subscription_instructions_len
    check (instructions is null or char_length(btrim(instructions)) between 1 and 2000);

comment on column public.owner_agent_report_subscription.instructions is
  'Owner-written free-text instructions for what this report should contain. '
  'Treated as data by the report builder, never as a recipient or permission. '
  'null = the default report.';


-- =====================================================================
-- DRY RUN (2026-09-27): this file's body inside one DO block that ends in
--   raise exception 'DRYRUN_ROLLBACK %', <checks>;
-- run through `supabase db query --linked -f` — the raise rolls it back.
-- Then: npx supabase db push --linked --dry-run (must list ONLY this file)
--       npx supabase db push --linked
--       npx supabase db advisors --linked
--       npm run gen:types
--
-- ROLLBACK (manual, approval required):
--   alter table public.owner_agent_report_subscription
--     drop column if exists instructions;   -- drops its CHECK with it
-- =====================================================================
