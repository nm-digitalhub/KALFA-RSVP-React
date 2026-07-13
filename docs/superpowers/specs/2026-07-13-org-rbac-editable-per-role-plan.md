# Implementation Plan: UI-Editable, Per-Role, DB-Driven Org RBAC

Companion to `2026-07-13-org-rbac-editable-per-role-design.md`. This is a
dependency-ordered tasklist for a later implementer to **execute**, not
something executed as part of this doc. SQL-first: every migration step lands
and is verified live before any app code that depends on it is deployed.

Each step lists: what changes, the exact file(s), how to verify it, and the
gate before moving to the next step.

---

## Phase 0 — Preconditions

- [ ] Confirm on `main` (or a dedicated feature branch) with a clean working
      tree (`git status`).
- [ ] Re-run the reference table in §2 of the spec against current `HEAD` —
      confirm none of the cited line numbers have drifted since 2026-07-13.
- [ ] `supabase migration new org_role_permissions_per_role` to reserve the
      timestamped filename (per this repo's `no hand-editing generated
      artifacts` rule and the established "always use `migration new`, never
      hand-name a timestamp" convention documented in
      `docs/guest-features-implementation-log-2026-07-12.md`).

**Gate:** empty migration file exists with a fresh, non-colliding timestamp.

---

## Phase 1 — Schema (single migration file, sections in this order)

1. **`system_protected` column**
   - `alter table permission_definitions add column if not exists
     system_protected boolean not null default false;`
   - `update permission_definitions set system_protected = true where
     (resource, action) in (('campaigns','create'),('campaigns','manage'));`
   - Verify: `select resource, action, system_protected from
     permission_definitions where system_protected;` returns exactly those 2 rows.

2. **New tables**
   - `organization_role_permissions` (+ `unique(organization_id, role_id,
     permission_id)`, index `(organization_id, role_id)`).
   - `organization_role_audit_log` (+ index `(organization_id, created_at
     desc)`), `actor_id` **nullable** (same rationale as
     `platform_role_audit_log`, documented inline in the migration).
   - Verify: `\d organization_role_permissions`, `\d organization_role_audit_log`
     show the expected columns/constraints/indexes.

3. **Backfill** (idempotent — guard with `on conflict do nothing`, same style
   as the base org migration's backfill block)
   - For every existing `(organization_id, role_id)` pair with ≥1 member,
     copy `role_permissions` rows for that role into
     `organization_role_permissions`, excluding rows where
     `permission_definitions.system_protected = true` **and** the role is not
     the org's owner role.
   - Verify: `select count(*) from organization_role_permissions;` > 0 (assuming
     orgs+members already exist); spot-check one org's copied rows equal that
     role's `role_permissions` rows minus the 2 system_protected exclusions
     (unless it's the owner role).

4. **`create_organization()` update**
   - Append: after inserting the owner membership, copy `role_permissions` →
     `organization_role_permissions` for all 4 roles of the new org (same
     exclusion rule as step 3).
   - Verify: call `create_organization('test')` in a scratch/staging check (not
     against production data — see repo rule against live test events), confirm
     the new org's `organization_role_permissions` row count matches the
     template's expected count per role.

5. **`is_org_owner(_org_id uuid)`**
   - New SECDEF function per spec §3.5.
   - `revoke all ... from public; grant execute ... to authenticated;` (mirror
     the platform layer's grant pattern).
   - Verify: as a member with the owner role, `select is_org_owner('<org>');`
     returns `true`; as a member with any other role, `false`.

6. **`has_org_permission()` rewrite**
   - `create or replace function` per spec §3.3 (join swapped to
     `organization_role_permissions`, `system_protected` read-time guard added).
   - Verify: for an org whose backfilled matrix is untouched, every
     `has_org_permission(org, resource, action)` call returns the **same**
     boolean as it did before the rewrite, for a representative sample of
     (role, resource, action) triples across all 4 roles — this is the
     regression check that the rewrite is behavior-preserving until someone
     actually edits a matrix cell.
   - Verify: `select has_org_permission(org,'campaigns','create')` is `false`
     for `admin`/`member`/`viewer` even if a row were manually inserted for
     them (test the read-time guard directly, not just the trigger).

7. **Triggers** (created last, per spec §5 step 8, so backfill/seed writes in
   steps 3–4 don't fire the audit trigger)
   - `org_role_permissions_protect_system` (BEFORE INSERT).
   - `org_role_permissions_protect_owner` (BEFORE DELETE).
   - `org_role_permissions_audit` (AFTER INSERT/DELETE).
   - Verify: attempt to insert a `(non-owner role, campaigns.create)` row
     directly via SQL → rejected. Attempt to delete an owner-role row directly
     → rejected. Insert/delete a normal row → one audit row appended each time.

8. **RLS**
   - Enable RLS + owner-only SELECT policy (using `is_org_owner`, per spec
     §3.7, with the `has_role(...,'admin')` staff carve-out) on both new
     tables.
   - D4's RLS DELETE swap: `guests_owner_delete` / `gg_owner_delete` →
     `can_access_event(event_id,'guests','delete')`.
   - Verify: as a non-owner member, `select * from
     organization_role_permissions where organization_id = '<org>';` returns
     zero rows (RLS-blocked) even though the row exists. As the owner, the
     same query returns the full matrix.

**Gate (end of Phase 1):** migration applied to a non-production
target first (local/staging per this repo's Supabase workflow — never push
untested SQL straight to the linked production project); `supabase db
advisors --linked` clean; all Phase 1 verify steps above pass; `supabase gen
types typescript --linked` regenerates `types.ts` with the two new tables and
the `system_protected` column present (never hand-edit the generated file).

---

## Phase 2 — Companion fix: `whatsapp-import.ts`

- [ ] Change `src/lib/data/whatsapp-import.ts:82` from
      `.from('role_permissions')` to read `organization_role_permissions`
      filtered by the caller's actual `(organization_id, role_id)` — same join
      shape `has_org_permission()` uses, so the two never diverge again.
- [ ] Add/update the regression test covering this file's routing decision for
      an org with a customized (non-default) matrix, proving it reflects the
      customization rather than the frozen template.

**Gate:** existing whatsapp-import tests pass; new test demonstrating
divergence-detection (matrix customized → routing decision changes) passes.

---

## Phase 3 — DAL primitive

- [ ] Add `requireOrgOwner(orgId)` to `src/lib/auth/dal.ts`, mirroring
      `requirePlatformOwner` (`dal.ts:90-96`) — `requireUser()` then the
      `is_org_owner` RPC, redirect to `/app/team` on failure, wrapped in
      `cache()`.
- [ ] Unit test: mirror the existing `requirePlatformOwner` test coverage
      pattern (owner passes, non-owner redirects, anonymous redirects to
      login).

**Gate:** `npx tsc --noEmit` clean; new DAL test passes.

---

## Phase 4 — Data layer (`src/lib/data/orgs.ts`, additive)

- [ ] `getOrgRolePermissionMatrix(orgId)` — `requireOrgOwner(orgId)` first,
      then read roles/permissions/grants from the new tables (mirror
      `getRolePermissionMatrix` in `platform-roles.ts:90-108` for shape).
- [ ] `setOrgRolePermission(orgId, roleId, permissionId, granted)` —
      `requireOrgOwner(orgId)` first; app-layer rejects (a) editing the owner
      role, (b) granting a `system_protected` permission to a non-owner role
      (defense-in-depth over the DB triggers, mirroring
      `platform-roles.ts:151-159`); writes via `createAdminClient()`;
      `logActivity()` + `sendSlackAlert({ category: 'security' })` on success.
- [ ] Extend or create `src/lib/data/orgs-role-permissions.test.ts` (or a
      section within a new `orgs.test.ts` if that file doesn't already exist)
      covering: owner-only gate, owner-role-immutable rejection,
      system_protected-grant rejection, successful grant/revoke + audit row
      written, self-escalation is a non-issue here (owner already holds every
      permission) but confirmed anyway for parity with the platform layer's
      test suite.

**Gate:** `npm run lint`, `npx tsc --noEmit`, focused test file all pass.

---

## Phase 5 — Server Actions

- [ ] New file `src/app/(customer)/app/team/roles/actions.ts`, sibling to the
      existing `src/app/(customer)/app/team/actions.ts`, mirroring
      `admin/roles/actions.ts` shape: Zod schema (`z.uuid()` ×2, `z.boolean()`),
      `requireOrgOwner(orgId)` as the first line of every action,
      `revalidatePath` on the new roles screen path, `FormState` return type.

**Gate:** `npx tsc --noEmit` clean; action-level test mirroring
`admin/roles/actions.ts` coverage if such tests exist for that file (confirm
during implementation — none were found for `admin/roles/actions.ts` at spec
time, so this may be new test surface rather than a mirror).

---

## Phase 6 — UI

- [ ] `src/app/(customer)/app/team/roles/page.tsx` — `requireOrgOwner(orgId)`
      gate (redirect non-owners to `/app/team`), loads the matrix, renders
      `EmptyState` if no roles/permissions (mirror `admin/roles/page.tsx`).
- [ ] `src/app/(customer)/app/team/roles/org-roles-client.tsx` — copy (not
      import) the responsive table↔accordion pattern from
      `admin/roles/roles-client.tsx`, adapted to `OrgRoleDTO`/
      `PermissionDefDTO`/the new matrix shape. Two locked-cell kinds: owner
      column (always granted, disabled), `system_protected` cells for
      non-owner roles (disabled, unchecked, tooltip "שמור לבעלים בלבד").
- [ ] Add an entry point from the existing `team/page.tsx` (or its nav) to the
      new `/app/team/roles` screen, visible only when `requireOrgOwner`-gated
      (or hidden via a non-throwing `isOrgOwner`-style check on the nav item —
      confirm which convention the team surface already uses for conditional
      nav before adding a new one).

**Gate:** `npm run build` succeeds; manual RTL check (Hebrew labels, disabled
cells right-to-left, accordion on mobile viewport, table on desktop viewport)
per this repo's UI/RTL requirements.

---

## Phase 7 — D4: guest/group delete toggle

- [ ] Swap `deleteGuest` (`guests.ts:533,537`) and `deleteGroup`
      (`guests.ts:750,754`) from `requireOwnedEvent(eventId)` to
      `requireEventAccess(eventId, 'guests', 'delete')`.
- [ ] Confirm this only takes effect once `guests.delete` exists in
      `permission_definitions` and has been granted to at least the owner role
      in every org's `organization_role_permissions` (should already be true
      from the Phase 1 backfill, since `guests.delete` already exists in the
      global catalog and is not `system_protected`).
- [ ] Update/add tests for `deleteGuest`/`deleteGroup` covering: owner always
      allowed; a member without `guests.delete` rejected; after the owner
      grants `guests.delete` to `member`, the **same session** (no re-login)
      succeeds — this is the concrete instance of the live-revocation
      integration test described in the spec's §6.

**Gate:** focused guest-deletion tests pass; full test suite run.

---

## Phase 8 — Full verification (Definition of Done)

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] Full test suite (`npm test` or repo equivalent)
- [ ] `supabase db advisors --linked` (post-deploy, against the now-live schema)
- [ ] Manual RLS live-immediacy proof against a real (non-production-data)
      test org: member lacks `guests.delete` → `deleteGuest` rejected → owner
      toggles `guests.delete` ON via the new UI → **same session** →
      `deleteGuest` succeeds → owner toggles OFF → next request rejected.
- [ ] Confirm `whatsapp-import.ts` regression test (Phase 2) still passes
      against the final schema.

**Gate:** all of the above green before this is considered shippable. Report
changed files, verification output, and any residual limitations per this
repo's Definition of Done.

---

## Feature flag (if desired)

If a staged rollout is preferred over shipping the UI live to all orgs at
once, gate the new `/app/team/roles` **page and nav entry** behind an
`app_settings`-driven flag (this repo's established pattern for
business-config toggles — "no hardcoded business facts", read server-side).
The schema and `has_org_permission()` rewrite are **not** flag-gated — they
must ship in full since every org's authorization now depends on the rewritten
function; only the *UI for editing* the matrix is a reasonable place to stage
a flag, since the backfill guarantees no org's effective permissions change
until an owner actually uses the new screen.
