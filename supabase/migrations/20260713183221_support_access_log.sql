-- =====================================================================
-- Support access log — append-only audit for STAFF SUPPORT-ACCESS (P3).
--
-- Platform staff holding has_platform_permission('view_customer_data') may view
-- a customer's NON-FINANCIAL event/guest data for support, read-only, via a
-- dedicated /admin/support surface (src/lib/data/admin/support.ts). Every view
-- requires a break-glass reason and writes exactly one row here, mirroring the
-- existing platform_role_audit_log pattern (additive, service-role writes,
-- owner-only read).
--
-- RLS: enabled; SELECT is owner-only (the owner reviews the log). There is
-- deliberately NO update/delete policy — the table is append-only. Writes go
-- through the service-role client in the app (getEventForSupportView), not
-- through RLS-gated authenticated inserts.
-- =====================================================================

create table if not exists public.support_access_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references auth.users(id),
  event_id uuid not null references public.events(id) on delete cascade,
  reason text not null,
  accessed_at timestamptz not null default now()
);

create index if not exists support_access_log_event_id_accessed_at_idx
  on public.support_access_log (event_id, accessed_at desc);

create index if not exists support_access_log_staff_id_accessed_at_idx
  on public.support_access_log (staff_id, accessed_at desc);

alter table public.support_access_log enable row level security;

drop policy if exists support_access_log_owner_select on public.support_access_log;
create policy support_access_log_owner_select on public.support_access_log
  for select to authenticated using (public.is_platform_owner());

revoke all on table public.support_access_log from public;
revoke all on table public.support_access_log from authenticated;
grant select on table public.support_access_log to authenticated;
