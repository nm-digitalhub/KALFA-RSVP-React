-- =====================================================================
-- activity_log: clients may insert only (user_id, event_id, action, meta).
--
-- Why. The table lives in `public`, so `anon` and `authenticated` received the
-- automatic table-level privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER), and no migration ever revoked them. Measured live on
-- 11.10.2026: a signed-in customer could insert a row naming any `created_at`,
-- e.g. 2020-01-01. UPDATE and DELETE were already refused, because no policy
-- grants them. The only insert policy, al_owner_insert, checks user_id alone.
-- So the time column, which the audit trail depends on, was client-chosen.
--
-- Fix, per Supabase "Column-level security" and "Securing your API": revoke the
-- table-level write privileges, then grant INSERT back on the four columns the
-- client actually writes. `id` and `created_at` now always take their server
-- defaults; an insert that names either is refused with 42501.
--
-- Who is affected (checked 11.10.2026):
--   * logActivity (src/lib/data/activity.ts) is the only writer on the cookie
--     client, and it sets exactly event_id, user_id, action and meta.
--   * Every other writer uses the service-role client, which these grants do
--     not touch.
--   * The functions that insert here, cancel_campaign (user_id, event_id,
--     action, meta) and resolve_outreach_step (id, event_id, user_id, action,
--     meta), are SECURITY INVOKER but executable only by postgres and
--     service_role, so they are unaffected.
--   * Client reads stay as they were: SELECT and al_org_read are unchanged.
--
-- Not in this migration: narrowing al_owner_insert to events the user may
-- edit. That is task 1b.2 of openspec/changes/marketing-email-sequences.
--
-- Rollback:
--   grant insert, update, delete, truncate, references, trigger
--     on public.activity_log to anon, authenticated;
-- =====================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.activity_log from anon, authenticated;

grant insert (user_id, event_id, action, meta)
  on public.activity_log to authenticated;
