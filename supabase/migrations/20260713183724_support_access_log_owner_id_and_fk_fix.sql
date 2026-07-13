-- =====================================================================
-- support_access_log corrections (P3 support-access, follow-up):
--
-- 1. Add `owner_id` — the CUSTOMER account (event owner) at the time of
--    access. The approved schema for this table includes it so the audit
--    trail can answer "has anyone at KALFA looked at this customer's data"
--    directly, without joining through `events` (which may itself change
--    owner or, in principle, be removed later). Nullable: existing rows (if
--    any) predate this column and cannot be backfilled without guessing.
--
-- 2. Replace the `event_id` FK's `ON DELETE CASCADE` with a plain FK (no
--    cascade). An audit log must outlive the row it describes — cascading the
--    delete would silently erase who-viewed-what history the moment an event
--    is removed, which contradicts this table's own purpose and the
--    append-only pattern already used by `platform_role_audit_log` (whose
--    target_* columns carry no FK at all, specifically so deleting the
--    referenced row never touches the audit trail). Events are never
--    hard-deleted anywhere in the app today, so this is a safety net, not a
--    behavior change.
-- =====================================================================

alter table public.support_access_log
  add column if not exists owner_id uuid;

alter table public.support_access_log
  drop constraint if exists support_access_log_event_id_fkey;

alter table public.support_access_log
  add constraint support_access_log_event_id_fkey
  foreign key (event_id) references public.events (id);
