-- Revoke unused write privileges on the platform RBAC tables from anon/authenticated.
--
-- WHY (verified on the live DB 2026-07-19):
--   Both `anon` AND `authenticated` hold INSERT, UPDATE, DELETE and TRUNCATE on all
--   four tables that define who is staff and what staff may do (confirmed with
--   has_table_privilege() against pg_catalog, not information_schema):
--       platform_staff                  -- who is a staff member
--       platform_roles                  -- which roles exist
--       platform_role_permissions       -- what each role may do
--       platform_permission_definitions -- the permission catalogue
--
--   ...plus platform_role_audit_log, the record of who changed the above.
--
--   SEVERITY, stated precisely (an earlier draft of this comment overstated it):
--   this is NOT an active hole. `anon` and `authenticated` are `rolcanlogin = false`
--   — PostgREST switches into them with SET ROLE — and PostgREST exposes no TRUNCATE,
--   so most of these privileges are unreachable today. The `platform_*` tables also
--   carry exactly one SELECT policy each and no write policy, so writes fall through
--   to RLS default-deny.
--
--   What this closes is a LATENT TRAP: the GRANT half of the check is already in
--   place, so the day anyone adds a permissive write policy on one of these tables —
--   which is precisely what the platform-permission work is contemplating — it
--   becomes self-service privilege escalation with no further mistake required.
--   Grants and RLS are two independent layers; leaving one wide open and relying
--   entirely on the other is the thing being fixed here.
--
-- WHY THIS IS SAFE (each point verified against the live DB and the code):
--   * No write policy exists on any of these tables, so nothing can currently
--     exercise these privileges through PostgREST — we are removing capability that
--     is already unreachable.
--   * Every application read and write goes through
--     src/lib/data/admin/platform-roles.ts, which uses the service-role client
--     (rolbypassrls = true). Grants to anon/authenticated are irrelevant to it.
--   * SELECT is deliberately untouched: each table keeps its `*_owner_select` policy
--     for `authenticated`, so /admin/roles is unaffected.
--
-- SCOPE — deliberately NOT included, and why:
--   The org-side permission tables (org_roles, permission_definitions,
--   role_permissions, organization_role_permissions) look identical at the grant
--   level but belong to the CUSTOMER axis, not the staff axis: they back the
--   customer-facing team-roles page under src/app/(customer)/app/team/roles/.
--   Verified line-by-line in src/lib/data/orgs.ts — customers READ them with their
--   own JWT (L115, L158, L177, L495, L609, all `.select(...)`) while every write
--   goes through createAdminClient (L295-L442). Revoking there needs its own
--   analysis and must preserve SELECT; it is out of scope here.
--
--   `user_roles` is also excluded. It has a real defect — policy `ur_admin_all`
--   (PERMISSIVE, FOR ALL, authenticated, `has_role(...,'admin')`) lets an admin
--   grant admin to anyone via `POST /rest/v1/user_roles`, bypassing the application
--   and leaving no audit row — but that is an authorization-model decision, not a
--   grant cleanup, and is tracked separately.

revoke insert, update, delete, truncate
  on table
    public.platform_staff,
    public.platform_roles,
    public.platform_role_permissions,
    public.platform_permission_definitions,
    -- The audit table itself: the party being audited must not be able to write
    -- or erase the record of what they did.
    public.platform_role_audit_log
  from anon, authenticated;

-- NOTE (deliberately NOT changed here): REFERENCES and TRIGGER remain granted, and
-- Supabase's schema-level default privileges will re-grant the full set to any NEW
-- table created in `public`. Both are broader questions than this migration and are
-- tracked separately — this change is scoped to closing the escalation path on the
-- five tables that govern the STAFF permission system itself.
