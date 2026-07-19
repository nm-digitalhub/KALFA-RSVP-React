-- Sever the staff axis from the tenant axis.
--
-- THE DEFECT (verified live 2026-07-19, read-only probe, no rows written):
--   Acting as Postgres role `authenticated` with the admin's own JWT — i.e. what
--   the admin's BROWSER can do against the public Data API, with no service_role:
--
--       acting_as               = 1bbe74dc-…            (the admin)
--       has_org_permission(foreign org,'members','manage') = false
--       has_role(uid,'admin')                              = true
--       select count(*) from guests                        = 44   (BOTH tenants)
--       select count(*) from events                        = 2    (BOTH tenants)
--
--   `organization_members_manage` is PERMISSIVE **FOR ALL** with predicate
--       has_org_permission(organization_id,'members','manage') OR has_role(uid,'admin')
--   Because FOR ALL covers INSERT, that predicate evaluates `false OR true` = TRUE
--   for a foreign organization. A staff member can therefore INSERT themselves into
--   any customer's organization. Once that row exists:
--       has_org_permission()  -> true
--       can_access_event()    -> true
--   and the staff member is indistinguishable from a legitimate tenant member —
--   permanently, and with no row in support_access_log, platform_role_audit_log or
--   activity_log. Staff privilege launders itself into tenant privilege.
--
--   The same shape on `user_roles` (`ur_admin_all`, PERMISSIVE FOR ALL) lets an admin
--   mint another admin via `POST /rest/v1/user_roles`, bypassing the application and
--   leaving no audit row.
--
-- THE FIX: the staff axis stops being expressible in RLS on tenant-owned data.
--   `has_role('admin')` is demoted to "may open /admin" — a route-reachability flag,
--   never a data grant. Staff reach customer data ONLY through service-role DAL
--   modules that are gated and audited in application code, where a break-glass
--   reason can be required and the audit write can fail closed. RLS cannot express
--   "log this access", which is the actual requirement.
--
-- BLAST RADIUS (verified per call-site, not assumed):
--   user_roles              — all 7 touches are createAdminClient (admin/users.ts
--                             L93,180,278,292,299,308,341). service_role bypasses RLS.
--   org_roles               — admin writes via createAdminClient (orgs.ts L328,391);
--                             customer reads survive on `org_roles_select`.
--   permission_definitions  — admin via createAdminClient (L330,401); customer reads
--                             survive on `permission_definitions_select`.
--   role_permissions        — only createAdminClient (L413); customer reads survive
--                             on `role_permissions_select`.
--   organization_members    — admin touches are createAdminClient (admin/users.ts
--                             L94,182); customer paths keep has_org_permission /
--                             is_org_member.
--   Expected breakage: none.
--
-- ROLLBACK: the exact prior definitions are recorded beside each statement below.

-- 1. user_roles — an admin must not be able to mint an admin over the Data API.
--    Prior: ur_admin_all  PERMISSIVE ALL {authenticated}
--           USING/CHECK (select has_role((select auth.uid()),'admin'))
drop policy if exists ur_admin_all on public.user_roles;

--    Prior: ur_self_read  PERMISSIVE SELECT {authenticated}
--           USING (user_id = (select auth.uid())
--                  OR (select has_role((select auth.uid()),'admin')))
--    Reading one's OWN role stays; reading everyone's does not.
drop policy if exists ur_self_read on public.user_roles;
create policy ur_self_read on public.user_roles
  as permissive for select to authenticated
  using (user_id = (select auth.uid()));

-- 2. The global role/permission catalogues. Writes move to service_role only; the
--    customer-facing `*_select` policies (auth.uid() IS NOT NULL) are untouched, so
--    the team-roles matrix under /app/team/roles keeps rendering.
--    Prior (all three): PERMISSIVE ALL {authenticated}
--           USING/CHECK (select has_role((select auth.uid()),'admin'))
drop policy if exists org_roles_admin_all on public.org_roles;
drop policy if exists permission_definitions_admin_all on public.permission_definitions;
drop policy if exists role_permissions_admin_all on public.role_permissions;

-- 3. THE ESCALATION ITSELF — staff can no longer write themselves into a tenant.
--    Prior: organization_members_manage  PERMISSIVE ALL {authenticated}
--           USING/CHECK (has_org_permission(organization_id,'members','manage')
--                        OR (select has_role((select auth.uid()),'admin')))
drop policy if exists organization_members_manage on public.organization_members;
create policy organization_members_manage on public.organization_members
  as permissive for all to authenticated
  using (has_org_permission(organization_id, 'members', 'manage'))
  with check (has_org_permission(organization_id, 'members', 'manage'));

--    Prior: organization_members_select PERMISSIVE SELECT {authenticated}
--           USING (is_org_member(organization_id)
--                  OR (select has_role((select auth.uid()),'admin')))
--    Staff visibility over every tenant's membership moves to the audited
--    service-role path (admin/users.ts already reads it that way).
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  as permissive for select to authenticated
  using (is_org_member(organization_id));

-- 4. Grant layer, same reasoning as the platform_* migration: remove DML that no
--    longer has any policy backing it, so a future policy cannot silently re-open
--    the path. SELECT is deliberately preserved — the customer catalogue reads
--    depend on it.
revoke insert, update, delete, truncate
  on table
    public.user_roles,
    public.org_roles,
    public.permission_definitions,
    public.role_permissions
  from anon, authenticated;
