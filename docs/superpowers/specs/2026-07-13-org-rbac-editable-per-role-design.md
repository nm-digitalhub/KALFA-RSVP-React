# Spec: UI-Editable, Per-Role, DB-Driven Org (Customer) RBAC

Status: **Approved by product owner** (design only — no code or migrations in this doc).
Date: 2026-07-13.
Author: implementation-planning pass, verified against live code at commit `1cdba89`.

## 1. Problem

`role_permissions` — the org role → permission mapping seeded in
`supabase/migrations/202606280021_org_multitenancy.sql` — is **global**: it has no
`org_id` column, and the four roles in `org_roles` (`owner` / `admin` / `member` /
`viewer`) are global, fixed rows. `has_org_permission(_org_id, _resource, _action)`
(same migration) joins `organization_members → role_permissions →
permission_definitions` with no per-org join key at all.

That means every org today shares one identical permission matrix. There is no way
to let one org's owner tighten or loosen what their `member` role may do without
changing every other org's `member` role at the same time. Exposing
`role_permissions` for editing would do exactly that — a global blast radius for
a per-tenant setting.

This spec adds a **second, org-scoped layer** so each organization can customize
its own role→permission grants, while the global table keeps working as the
factory-default template for brand-new orgs. It mirrors the platform (KALFA
staff) Owner/Staff RBAC shipped in `supabase/migrations/20260713171233_platform_rbac_owner_staff.sql`
+ `src/app/(admin)/admin/roles/` + `src/lib/data/admin/platform-roles.ts` — same
"permissions are DATA, editable from a UI, audited, trigger-guarded" pattern,
applied one layer down.

## 2. Current state (verified against code, not memory)

| Fact | Verified at |
|---|---|
| `role_permissions(role_id, permission_id)` has no `org_id` — global | `supabase/migrations/202606280021_org_multitenancy.sql` (table `role_permissions`, section C seed) |
| 4 fixed global roles: `owner`(rank 40, `is_owner_role=true`), `admin`(30), `member`(20), `viewer`(10) | same file, section C |
| `admin` role is seeded with **every permission except `organization.edit`** — including `organization.manage` **and `guests.delete`** (`member`'s curated set and `viewer`'s view-only set never included `guests.delete`, so only `admin` is affected here) | same file, section C ("admin → all except organization.edit"; `('guests','delete',...)` at line 128 of the catalog seed; member's curated `values(...)` list at section C omits it) |
| `has_org_permission(_org_id,_resource,_action)` joins `organization_members → role_permissions → permission_definitions`, `stable security definer set search_path = public` | same file, section D |
| `can_access_event(_event_id,_resource,_action)` = `owner_id = auth.uid() OR (org_id is not null AND has_org_permission(org_id,...))` | same file, section D |
| App-side wrapper: `can(orgId, resource, action)` (cached, non-throwing) and `requirePermission(orgId, resource, action)` (throws) | `src/lib/permissions.ts:23,44` |
| `createCampaign` = `requireOwnedEvent(eventId)` — **never** wired to `has_org_permission`; owner-only regardless of any future flag | `src/lib/data/campaigns.ts:131-132` |
| `approveCampaign` = `requireOwnedEvent(campaign.event_id)` (comment: `// ownership`) | `src/lib/data/campaigns.ts:288,306` |
| `cancelCampaign` = `requireAdmin()` — **platform** admin, not org — already out of scope | `src/lib/data/campaigns.ts:884,890` |
| `deleteGuest` / `deleteGroup` = `requireOwnedEvent(eventId)` (owner-only today) | `src/lib/data/guests.ts:533,537` and `:750,754` |
| All other guest/campaign verbs already route through `requireEventAccess(eventId, resource, action)` → `can_access_event` RPC | `src/lib/data/guests.ts` (view/create/edit lines), `src/lib/data/campaigns.ts:234,257` |
| RSVP link admin (get/revoke/regenerate) already `requireEventAccess(eventId,'guests','edit')` | `src/lib/data/rsvp-links.ts:33,53,74` |
| Guest RLS delete policies are still owner-only: `guests_owner_delete`, `gg_owner_delete` | `supabase/migrations/20260705115539_org_phase3_rls_swap.sql:110,132`; listed as row-dependent (skipped) in the initplan pass at `supabase/migrations/20260713143941_gap1_rls_initplan_optimization.sql:116,125` |
| `whatsapp-import.ts` reads `role_permissions` **directly**, not via `has_org_permission()` | `src/lib/data/whatsapp-import.ts:82` — confirmed literal `.from('role_permissions')` |
| Customer team surface already exists at `src/app/(customer)/app/team/` (`page.tsx`, `team-client.tsx`, `actions.ts`) — today it manages **members/invitations**, not role permissions | verified directory listing + `team/page.tsx` (gates on `can(orgId,'members','manage')`, loads `listMembers`/`listInvitations`/`listRoles` from `src/lib/data/orgs.ts`) |
| `src/lib/data/orgs.ts` **already exists** (16.7 KB) — member/invitation CRUD, NOT a role-permission matrix. New functions are ADDED here, not a new file | read in full; exports `listRoles`, `getPermissionCatalog`, `listMembers`, `listInvitations`, `inviteMember`, `resendInvitation`, `revokeInvitation`, `changeMemberRole`, `removeMember`, `acceptInvitation`, `listOrgsForUser` |
| Platform pattern to mirror: `src/app/(admin)/admin/roles/page.tsx` (gate `requirePlatformOwner()`), `roles-client.tsx` (table↔accordion responsive matrix, `sm:` breakpoint switch, shared `MatrixCell`), `actions.ts` (Zod `z.uuid()`, `requirePlatformOwner()` first line of every action), `src/lib/data/admin/platform-roles.ts` (service-role writes, `logActivity` + `sendSlackAlert(category:'security')`, DB trigger does the real guarding, app layer duplicates the guard defense-in-depth) | all four files read in full |
| `requirePlatformOwner()` pattern in `src/lib/auth/dal.ts:90-96`: `requireUser()` then an `is_platform_owner()` **RPC**, redirect to `/app` if false | read in full |
| **No existing `is_org_owner()`-style RPC.** The org layer's only "am I high enough rank" checks today are ad hoc: `getOrgContext().rank` (`src/lib/auth/dal.ts:170-206`) and a local `actorRank()` helper in `orgs.ts:99-102`, both rank-based, not owner-flag-based | read in full |

### Important finding: `organization.manage` is NOT owner-exclusive today

The seed in `202606280021_org_multitenancy.sql` grants `admin` **every**
permission except `organization.edit` — `organization.manage` is included. So
`has_org_permission(orgId,'organization','manage')` returns **true for the
`admin` role**, not just `owner`. Any gate on this new screen that reuses
`organization.manage` would let an org's `admin` role edit the permission
matrix — including its own role's grants (self-escalation) — which contradicts
the design's explicit intent that this screen is **owner-only**. This is
called out in the approved design itself ("`requireOrgOwner` ... stricter than
`organization.manage`") — see §7's self-review fix for how this is resolved
consistently in the DB layer too.

## 3. Approved architecture — additive, copy-on-write

### 3.1 New tables

```
organization_role_permissions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  role_id          uuid not null references org_roles(id),
  permission_id    uuid not null references permission_definitions(id),
  granted_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (organization_id, role_id, permission_id)
)
-- index (organization_id, role_id)

organization_role_audit_log (       -- mirrors platform_role_audit_log
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  actor_id         uuid,            -- nullable: see platform_role_audit_log precedent
  action           text not null,   -- 'permission_granted' | 'permission_revoked'
  target_role_id   uuid,
  details          jsonb,
  created_at       timestamptz not null default now()
)
-- index (organization_id, created_at desc)
```

`permission_definitions` gains one column: `system_protected boolean not null
default false`, set `true` for exactly `('campaigns','create')` and
`('campaigns','manage')`.

The global `role_permissions` table is **kept, untouched**. It is read only:
(a) once, at org creation time (`create_organization`), to seed a brand-new
org's `organization_role_permissions`, and (b) once, in the migration's
one-time backfill for existing orgs. After this migration ships,
`has_org_permission()` never reads `role_permissions` again — it is a frozen
factory-default template, not a live authorization source.

### 3.2 Triggers on `organization_role_permissions` (all `security definer set
search_path = public`, mirroring the platform layer's trigger style)

1. **BEFORE INSERT** `org_role_permissions_protect_system` — reject inserting a
   row that grants a `system_protected` permission to any role except the org's
   owner role.
2. **BEFORE DELETE** `org_role_permissions_protect_owner` — reject deleting any
   row whose `role_id` is the org's owner role (owner permissions are
   immutable, same invariant as the platform layer's owner role).
3. **BEFORE UPDATE** `org_role_permissions_no_update` — **added per adversarial
   review (Fix 5).** The original draft only had triggers 1 and 2; a bare
   `UPDATE` of `organization_role_permissions` (e.g. changing a row's `role_id`
   or `permission_id` in place) would bypass both, silently reassigning a grant
   without going through the INSERT/DELETE path the other two triggers guard.
   This trigger unconditionally rejects every `UPDATE` on the table
   (`raise exception`). This is not overly strict: the app's only two
   sanctioned mutations are "grant" (insert-if-missing, §3.6's
   `setOrgRolePermission`) and "revoke" (delete) — there is no legitimate
   product reason to ever `UPDATE` a row in place, so blocking `UPDATE`
   entirely is simpler and strictly safer than trying to enumerate which
   column changes are acceptable.
4. **AFTER INSERT/DELETE** `org_role_permissions_audit` — append-only row into
   `organization_role_audit_log`.

### 3.3 `has_org_permission()` rewrite

```sql
create or replace function public.has_org_permission(_org_id uuid, _resource text, _action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organization_role_permissions orp
      on orp.organization_id = m.organization_id and orp.role_id = m.role_id
    join public.permission_definitions p on p.id = orp.permission_id
    where m.organization_id = _org_id
      and m.user_id = (select auth.uid())
      and p.resource = _resource
      and p.action = _action
      and (
        not p.system_protected
        or exists (
          select 1 from public.org_roles r
          where r.id = m.role_id and r.is_owner_role
        )
      )
  );
$$;
```

The trailing `system_protected` clause is the approved **Q2 belt-and-suspenders
read-time guard**: even if a `system_protected` row somehow existed for a
non-owner role (bug, manual SQL, future trigger regression), the permission
check itself still returns `false` for anyone but the owner role. Two
independent layers (the BEFORE INSERT trigger, and this read-time filter) have
to fail together for the anti-escalation invariant to break.

**Acyclicity:** `has_org_permission` is the only function in the call graph
that reads `organization_role_permissions`; that table's own RLS SELECT policy
(§3.5) calls the *new* `is_org_owner()` helper, not `has_org_permission` — so
there is no recursion (`has_org_permission` → table RLS → `is_org_owner` →
`organization_members`/`org_roles`, a dead end, never back into
`has_org_permission`). This mirrors why `has_org_permission` itself is
`security definer` in the base migration: SECDEF functions do not re-trigger
RLS on the tables they read, so the call graph is a DAG by construction as
long as no SECDEF function calls back into a caller higher up the chain. It
does not.

### 3.4 D1–D5 resolution (verified against current gates)

| # | Action | Resolution |
|---|---|---|
| D1 | `createCampaign` (`campaigns.ts:131-132`) | `campaigns.create` becomes `system_protected = true`. The action **stays** `requireOwnedEvent` — never wired to `has_org_permission` at all. The flag only prevents the new UI from ever offering this permission to a non-owner role; it does not change enforcement, which was already owner-only. |
| D2 | `approveCampaign` (`campaigns.ts:288,306`) | Same treatment: `campaigns.manage` is `system_protected`; `approveCampaign` stays `requireOwnedEvent`, unaffected by the matrix. |
| D3 | `cancelCampaign` (`campaigns.ts:884,890`) | Already `requireAdmin()` — **platform**-admin, a different role system entirely. Out of scope, no change. |
| D4 | `deleteGuest` / `deleteGroup` (`guests.ts:533,537` / `:750,754`) | Becomes a real toggle: swap the app gate `requireOwnedEvent(eventId)` → `requireEventAccess(eventId,'guests','delete')`, **and** swap the RLS DELETE policies `guests_owner_delete` / `gg_owner_delete` from `owns_event(...)` to `can_access_event(event_id,'guests','delete')` — dual-layer, same pattern as the 12 existing Phase-3 policies already on `can_access_event`. Init-plan-safe (mirrors the other row-dependent policies the 2026-07-13 GAP-1 pass deliberately skipped for the same reason: `USING (can_access_event(...))` cannot be wrapped in `(select ...)` because it is evaluated per-row against `event_id`). **Backfill/seed deliberately withhold `guests.delete` from every non-owner role** (§5 step 4/5) — see §3.9 for why. |
| D5 | RSVP link admin (`rsvp-links.ts:33,53,74`) | Already `requireEventAccess(eventId,'guests','edit')`. Done, no change. |

### 3.5 `requireOrgOwner` + the self-review fix (see §7 for the full trail)

New SECDEF helper, mirroring `is_platform_owner()`
(`20260713171233_platform_rbac_owner_staff.sql`):

```sql
create or replace function public.is_org_owner(_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    join public.org_roles r on r.id = m.role_id
    where m.organization_id = _org_id
      and m.user_id = (select auth.uid())
      and r.is_owner_role
  );
$$;
```

New DAL primitive in `src/lib/auth/dal.ts`, mirroring `requirePlatformOwner`
(`dal.ts:90-96`):

```ts
export const requireOrgOwner = cache(async (orgId: string) => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_org_owner', { _org_id: orgId });
  if (error || data !== true) {
    redirect('/app/team');
  }
  return user;
});
```

**This is deliberately NOT `requirePermission(orgId,'organization','manage')`**
— per §2's finding, `organization.manage` is granted to the `admin` role too,
so reusing it would let an org admin edit the permission matrix (including
self-escalating their own role). `is_org_owner()` checks `org_roles.is_owner_role`
directly and is immune to that.

### 3.6 Server Action + DAL surface

New functions **added to the existing `src/lib/data/orgs.ts`** (not a new
file — that file already owns the org-scoped read/write surface):

```ts
getOrgRolePermissionMatrix(orgId: string): Promise<OrgRolePermissionMatrix>
setOrgRolePermission(orgId: string, roleId: string, permissionId: string, granted: boolean): Promise<void>
```

Both:
1. Call `requireOrgOwner(orgId)` first (belt-and-suspenders — the RLS SELECT
   policy in §3.7 is owner-only too, but the primary gate is always the app
   layer per this repo's two-tier model).
2. `setOrgRolePermission` additionally rejects, in the app layer (defense-in-depth
   over the two DB triggers, mirroring `setRolePermission`'s
   `platform-roles.ts:151-153` owner-role-immutable check and its
   `platform-roles.ts:157-159` self-escalation check):
   - editing the owner role's grants at all,
   - granting a `system_protected` permission to a non-owner role.
3. Writes go through `createAdminClient()` (RLS on the new tables is owner-only
   read; writes are service-role only, same posture as `platform_role_permissions`).
4. Calls `logActivity()` with the real `requireOrgOwner()` actor and
   `sendSlackAlert({ category: 'security', ... })`, mirroring
   `platform-roles.ts:173-183`.

New Server Action file under the customer team surface — sibling to the
existing `src/app/(customer)/app/team/actions.ts`, e.g.
`src/app/(customer)/app/team/roles/actions.ts` — Zod-validated (`z.uuid()` for
`roleId`/`permissionId`, `z.boolean()` for `granted`; same shape as
`setRolePermissionSchema` in `admin/roles/actions.ts:29-33`), calling
`revalidatePath` on the new roles screen's path. Every action re-verifies
`requireOrgOwner(orgId)` as its first line, exactly like every function in
`admin/roles/actions.ts` re-verifies `requirePlatformOwner()` first.

### 3.7 RLS on the new tables

```sql
alter table organization_role_permissions enable row level security;
create policy organization_role_permissions_owner_select
  on organization_role_permissions for select
  using (is_org_owner(organization_id) or has_role((select auth.uid()),'admin'::app_role));
-- writes: service-role only (no policy grants INSERT/UPDATE/DELETE to `authenticated`)

alter table organization_role_audit_log enable row level security;
create policy organization_role_audit_log_owner_select
  on organization_role_audit_log for select
  using (is_org_owner(organization_id) or has_role((select auth.uid()),'admin'::app_role));
```

Platform staff (`has_role('admin')`) retain read visibility, matching every
other org-scoped table's RLS posture in this codebase (e.g.
`organization_audit_log_select` in the base migration).

### 3.8 UI

New page under the existing customer team surface —
`src/app/(customer)/app/team/roles/page.tsx` — gated by `requireOrgOwner(orgId)`
(redirect non-owners to `/app/team`, matching `admin/roles/page.tsx`'s
`requirePlatformOwner()` gate). New client component
`org-roles-client.tsx` in the same directory, **copying** the responsive
table↔accordion pattern documented in `roles-client.tsx:1-46` (sm: breakpoint
table vs. per-role Accordion; shared toggle/optimistic/revert cell logic) — not
importing it, since the DTOs differ (`OrgRoleDTO`/`PermissionDefDTO` from
`orgs.ts` vs. `PlatformRoleDTO`/`PlatformPermissionDTO` from
`admin/platform-roles.ts`).

Two kinds of locked, disabled cells (both mirror `roles-client.tsx`'s existing
owner-column lock):
- The **owner column** — always granted, disabled, for every permission.
- Any **`system_protected`** cell for a non-owner role — disabled, unchecked,
  tooltip: `"שמור לבעלים בלבד"`.

### 3.9 Backfill rule: newly-live permissions default OFF for non-owner roles

**Confirmed by adversarial review — a real defect in the first draft, fixed
here.** The global seed grants `admin` **every** permission except
`organization.edit` (§2), which includes `guests.delete`. Today that grant is
inert: `deleteGuest`/`deleteGroup` are `requireOwnedEvent`-gated and never
consult `has_org_permission()` at all, so an `admin`'s `guests.delete` row in
`role_permissions` has zero live effect. D4 (§3.4) changes that — it wires
`deleteGuest`/`deleteGroup` to `has_org_permission()` for the first time.

A naive backfill that copies `role_permissions` wholesale (excluding only
`system_protected` pairs) would therefore make every existing org's `admin`
**silently** able to delete guests the moment this migration ships — no owner
action, no audit-log entry, no UI interaction. That directly contradicts this
design's own framing of the new screen as opt-in, owner-controlled grants, and
is a genuine privilege change smuggled in by a schema migration.

**Rule (revoke-with-opt-in), stated generally so it doesn't get re-broken by a
future permission this workstream operationalizes:** for every permission that
this workstream moves from "enforced by ownership only" to "enforced by
`has_org_permission()`" (currently exactly one: `guests.delete`, via D4), the
backfill (§5 step 4) and the `create_organization()` seed (§5 step 5)
**exclude it from every non-owner role**, regardless of what the global
`role_permissions` template grants that role. The owner role is unaffected
(owners always get every permission). Concretely today: `admin` does **not**
receive `guests.delete` in `organization_role_permissions` at migration time,
even though `role_permissions` grants it to `admin`. An org's owner may grant
it back to `admin`/`member`/`viewer` afterward through the new UI — that's the
intended, auditable path.

**This is a deliberate behavioral decision, not a mechanical copy — flagging
for explicit product-owner confirmation before implementation**, since it
means "what the global template says a role can do" and "what a freshly
migrated org's role can actually do" diverge for this one permission by
design. The alternative (copy `guests.delete` to `admin` as-is, matching the
template exactly) was rejected because it changes live behavior with no
owner-visible trigger, which this codebase's Definition of Done and audit
requirements treat as a hole, not a nicety.

## 4. Companion fix — required, not optional

`src/lib/data/whatsapp-import.ts:82` reads `.from('role_permissions')`
directly, inside `resolveOwnerActiveEvents()` (`whatsapp-import.ts:56-108`).
Once `has_org_permission()` stops reading `role_permissions` (§3.3), this call
site silently keeps evaluating against the **frozen global template** — any
org that customizes its matrix will see WhatsApp import routing decisions
diverge from every other permission check in the app. This must be migrated
in the same workstream.

**Adversarial review flagged the first draft's fix as under-specified and
wrong in a way that would reintroduce the exact bug this migration is meant to
fix.** The current code (verbatim):

```ts
const { data: allowedRoles } = await admin
  .from('role_permissions')
  .select('role_id, permission_definitions!inner(resource, action)')
  .in('role_id', memberships.map((m) => m.role_id))
  .eq('permission_definitions.resource', 'guests')
  .eq('permission_definitions.action', 'create');
const okRoles = new Set((allowedRoles ?? []).map((r) => r.role_id));
const orgIds = memberships
  .filter((m) => okRoles.has(m.role_id))
  .map((m) => m.organization_id);
```

This builds a **single, global `Set<role_id>`** of "role ids that may
`guests.create`" across ALL of the sender's memberships, then keeps every
membership whose `role_id` is in that set — safe only because `role_permissions`
is keyed by `role_id` alone, so a role id means the same thing everywhere.
Once permissions are per-`(organization_id, role_id)`, that assumption breaks:
the same role (say, `member`) can hold `guests.create` in org A but not in org
B after an owner customizes org B's matrix. A global "permitted role ids" set
cannot represent that — it would either wrongly grant org B routing (false
positive, using org A's `member` grant) or wrongly deny org A (false negative),
reintroducing incident-2026-07-06-style misrouting, which is exactly what this
file's own top-of-function comment says was fixed once already.

**Correct fix — per-`(organization_id, role_id)` tuple check, not a global
role-name/role-id set:**

```ts
const { data: allowedTuples } = await admin
  .from('organization_role_permissions')
  .select('organization_id, role_id, permission_definitions!inner(resource, action)')
  .in('organization_id', memberships.map((m) => m.organization_id))
  .in('role_id', memberships.map((m) => m.role_id))
  .eq('permission_definitions.resource', 'guests')
  .eq('permission_definitions.action', 'create');
const okTuples = new Set(
  (allowedTuples ?? []).map((r) => `${r.organization_id}:${r.role_id}`),
);
const orgIds = memberships
  .filter((m) => okTuples.has(`${m.organization_id}:${m.role_id}`))
  .map((m) => m.organization_id);
```

The `.in('organization_id', ...)` / `.in('role_id', ...)` pair is a
Cartesian **pre-filter** (Postgres/PostgREST has no tuple-`IN`), so the app
layer must reconstitute the exact `(organization_id, role_id)` pair via the
composite-key `Set` before trusting a row — never `okRoles.has(role_id)`
alone. This is concrete enough that an implementer cannot collapse it back
into a single-column set without the composite key falling out of the code
shape. Add a regression test with two orgs sharing a member on the same
global role where one org has customized `guests.create` off for that role —
asserting the routing decision differs per org, proving the tuple check (not
just a passing type-check) actually holds.

## 5. Migration order (single additive `supabase migration new` file, per the
project's "no hand-editing generated artifacts" rule — types via
`supabase gen types typescript --linked` afterward)

1. `alter table permission_definitions add column system_protected boolean not null default false` + `update ... set system_protected = true where (resource,action) in (('campaigns','create'),('campaigns','manage'))`.
2. `create table organization_role_permissions` + its index.
3. `create table organization_role_audit_log` + its index. *(Moved earlier than
   the triggers so the table exists before anything can reference it — content
   unchanged from the approved order, this is purely about DDL dependency
   ordering within the single file.)*
4. Backfill: `insert into organization_role_permissions (organization_id, role_id, permission_id, granted_by) select m.organization_id, m.role_id... ` — for every `(organization_id, role_id)` pair that has at least one member, copy `role_permissions` rows for that `role_id`, **excluding**:
   - `(system_protected = true and role is not owner)` pairs (permanent
     invariant, also trigger-enforced going forward — §3.2), **and**
   - `(resource, action) = ('guests','delete') and role is not owner` (the
     §3.9 revoke-with-opt-in rule — a one-time backfill decision, not a
     permanent invariant; an owner may grant it back later through the UI).
5. Append seed logic to `create_organization()`: after inserting the owner
   membership, copy `role_permissions` → `organization_role_permissions` for
   all four roles in the new org (same two exclusions as step 4, so a
   brand-new org's `admin` starts without `guests.delete` too — consistent
   with existing orgs post-backfill).
6. Create `is_org_owner()`.
7. Rewrite `has_org_permission()` per §3.3.
8. Create the 4 triggers on `organization_role_permissions` **last** (so the
   backfill in step 4 does not fire the audit trigger thousands of times):
   the 2 from the original draft (`protect_system`, `protect_owner`) plus the
   Fix-5 `org_role_permissions_no_update`.
9. RLS: policies from §3.7, plus D4's RLS DELETE swap on `guests_owner_delete`
   / `gg_owner_delete` → `can_access_event(event_id,'guests','delete')`.
10. `supabase gen types typescript --linked` (never hand-edit `types.ts`).

**Rollback — corrected per adversarial review (Fix 3).** The original draft's
rollback ("drop the triggers, repoint `has_org_permission()`, leave the new
tables unused") is **incomplete**: it says nothing about D4, which ships two
other artifacts in this same workstream — the RLS DELETE swap (step 9 above,
part of the *same* Phase-1 migration) and the app-gate swap in
`deleteGuest`/`deleteGroup` (Phase 7 of the implementation plan, shipped as an
**app deploy**, not SQL). If Phase 7 has already shipped by the time a
rollback is needed, reverting only the trigger/function pieces would leave:
`guests_owner_delete`/`gg_owner_delete` still pointing at `can_access_event`,
the app gate still calling `requireEventAccess(...,'guests','delete')`, and
`has_org_permission()` back to reading the frozen `role_permissions` template
— under which, per §2, `admin` **is** granted `guests.delete`. Net result: a
"rollback" would hand every org's `admin` role live guest-delete power,
the opposite of restoring owner-only deletion.

A correct rollback is therefore **two coordinated pieces, both required**:
1. **DB (additive forward migration):** drop the 4 triggers; repoint
   `has_org_permission()` back to its exact pre-migration body (verbatim,
   reading `role_permissions`); **also revert `guests_owner_delete` and
   `gg_owner_delete` back to `owns_event(event_id)`** (undoing step 9); leave
   the two new tables in place, unused. No data loss — `role_permissions`
   itself is never dropped or altered structurally at any point.
2. **App (deploy):** if Phase 7 shipped, revert `deleteGuest`/`deleteGroup`
   back to `requireOwnedEvent(eventId)` in the **same rollback window** as the
   DB piece above — the two must land together, not one without the other,
   or the intermediate state is inconsistent (app checks a permission gate
   whose backing RLS policy no longer matches it, or vice versa).

## 6. Verification plan

- **Unit** (mirror `src/lib/data/admin/platform-roles.test.ns` structure — add
  a sibling `src/lib/data/orgs-role-permissions.test.ts` or extend
  `orgs.test.ts` if one is created): owner-only gate rejects non-owner callers;
  owner-role permissions are immutable (trigger + app-layer both reject);
  granting a `system_protected` permission to a non-owner role is rejected
  (trigger + app-layer); every grant/revoke writes an audit row.
- **Integration / RLS live-immediacy proof** (this is the property the whole
  "no JWT claims for customers" architecture principle exists to prove — see
  §8): with a `member` who lacks `guests.delete`, `deleteGuest` is rejected;
  the owner toggles `guests.delete` ON for `member`; **same session, no
  re-login**, the member's next `deleteGuest` call succeeds; owner toggles it
  back OFF; the member's very next request is rejected again.
- **Regression — `has_org_permission()` rewrite, corrected claim (Fix 2).**
  The original draft claimed the rewrite returns an **identical** boolean for
  every `(role, resource, action)` triple, pre- vs. post-migration. That is
  **false as a literal catalog-equality claim** — it is true for
  **effective** (i.e., actually-enforced) behavior, not raw row equality.
  Two intended catalog deltas, both zero-behavioral-effect:
  - `admin` loses `campaigns.create`/`campaigns.manage` in
    `organization_role_permissions` (the `system_protected` exclusion,
    §3.9's sibling rule). Zero live effect: `createCampaign`/`approveCampaign`
    are `requireOwnedEvent`-gated and **never** call `has_org_permission()`
    (§2, D1/D2) — the flag only prevents the UI from ever offering these
    permissions, it changes nothing already-enforced.
  - `admin` does **not** receive `guests.delete` in
    `organization_role_permissions` (§3.9). This is the one delta with
    potential live effect once D4 ships — but D4 and the backfill exclusion
    ship in the **same** migration, so at every point in time
    `deleteGuest`/`deleteGroup`'s effective enforcement for `admin` is
    unchanged: owner-only before the migration (via `requireOwnedEvent`) and
    still owner-only immediately after (via `has_org_permission()` returning
    `false` for `admin`, since the backfill withheld the grant). The
    regression test must assert **this**, not naive pre/post catalog
    equality: for every `(role, resource, action)` triple **except** the two
    `system_protected` pairs and `guests.delete`, `has_org_permission()`
    returns the identical boolean pre/post; for the `system_protected` pairs
    and for `guests.delete` on non-owner roles, assert the **effective**
    (actually-enforced-by-the-app) permission is unchanged, not the raw table
    contents.
- **Regression**: `whatsapp-import.ts` behavior unchanged for orgs that never
  customize their matrix (still resolves identically to the frozen template
  it now reads via `organization_role_permissions`, which the backfill made
  identical to `role_permissions` at migration time — **except** for the
  `guests.delete` exclusion above, which is irrelevant to this file since it
  only ever checks `guests.create`).
- `npm run lint`, `npx tsc --noEmit`, `npm run build` per this repo's
  Definition of Done.
- `supabase db advisors --linked` after the migration is live.

## 7. Self-review (fresh-eyes pass after drafting)

- **Found and fixed:** the draft's RLS SELECT policy for the two new tables
  originally read `has_org_permission(organization_id,'organization','manage')`,
  copied verbatim from the org layer's existing `organization_audit_log`
  policy. Per §2's verified finding, that permission is **not** owner-exclusive
  (the `admin` role has it too) — using it here would have let an org admin
  read the permission matrix and its audit log, and — worse — the DAL gate
  named `requireOrgOwner` would have been *stricter* than the RLS policy meant
  to back it up, an inconsistency between the two enforcement layers. §3.5 and
  §3.7 now both use the new `is_org_owner()` helper consistently, closing that
  gap. This is the one substantive correction made during self-review; it is
  reflected directly in the design text above, not left as a TODO.
- Checked for placeholders/TODOs: none remain — every table/function/trigger
  above is fully specified (columns, types, constraints), not sketched.
- Checked for internal contradictions: the "owner-only" claim in §1 is now
  consistent across §3.5 (DAL), §3.7 (RLS), and §3.8 (UI redirect target).
- Checked for scope creep: confirmed D3 (`cancelCampaign`) is genuinely
  untouched (platform-admin gate, unrelated role system) and left it that way;
  confirmed §9's out-of-scope items are recorded as *future* workstreams, not
  partially implemented here.
- Checked for ambiguous requirements: `system_protected` is pinned to exactly
  two `(resource, action)` pairs by literal value, not "campaign-related
  permissions" or similar vague phrasing that could later be interpreted two
  ways.

## 8. Architecture principle (stated explicitly per product owner's request)

Two role layers, two different revocation models, by design:

- **Platform staff** (`platform_staff` / `platform_roles` /
  `platform_role_permissions`, `20260713171233_platform_rbac_owner_staff.sql`)
  is a small, low-churn set of KALFA employees. That tier **may** eventually
  move permission checks into JWT/Auth-Hook custom claims (Supabase's
  Custom Access Token Hook — `custom_access_token_hook(event jsonb)`, see
  Supabase docs: *Custom Claims & Role-Based Access Control (RBAC)*) if a
  stable, rarely-changing claim set becomes worth the token-refresh latency
  trade-off. It is not doing so today.
- **Customer/org tier** (this spec) stays 100% DB-driven, checked live on
  every request via `has_org_permission()`. This is a hard requirement, not a
  preference: revocation must be effective on the *very next request*, with
  no dependency on token expiry or refresh timing — proven by the integration
  test in §6. JWT custom claims are explicitly the wrong tool here because a
  claim baked into an access token stays valid until that token is refreshed
  (Supabase's own custom-claims-and-RBAC guidance describes claims as set at
  token-issuance time via the hook, not re-checked per-request), which would
  let a revoked `guests.delete` grant remain exploitable for the lifetime of
  an already-issued token. Postgres RLS combined with a `security definer`
  function evaluated per-request (with `(select auth.uid())` wrapping so the
  Postgres planner can still cache it as an initPlan per statement — Supabase's
  RLS performance guidance, *"Call functions with `select`"*) gets the
  live-revocation property without sacrificing query performance.
- Supabase official references consulted: *Custom Claims & Role-Based Access
  Control (RBAC)* (Auth Hooks), *Row Level Security* guide's "Optimize RLS
  policies by wrapping functions" section, and the RLS performance
  troubleshooting doc's "Wrap RLS functions in SELECT statements" section —
  all fetched live via `ctx7` against `/supabase/supabase` on 2026-07-13, not
  recalled from training data. The team-lead-supplied blog links (Makerkit,
  EastonDev, a GitLab RLS-recursion snippet) remain valid as secondary,
  illustrative references but are not the primary citation for the claims
  above.

## 9. Out of scope — separate future workstreams

- **(a) Per-event permission overrides.** Rejected for this design — RLS-expensive
  (would require a third join keyed on event_id inside every `has_org_permission`
  call, defeating the initplan-caching approach this codebase relies on).
- **(b) Custom org-role creation.** `org_roles` stays the fixed four
  (`owner`/`admin`/`member`/`viewer`) globally; this design edits what each
  fixed role *can do* per-org, not how many roles exist.
- **(c) A separate, second layer: KALFA management-team (platform staff)
  managing individual customer users' permissions** (a user × permission axis,
  distinct from this design's org-role × permission axis) — explicitly **not**
  part of this design. Flagged here as a distinct future workstream for
  whoever picks it up next.

## 10. Adversarial review — round 2 (confirmed fixes applied)

An adversarial review pass found 5 confirmed defects in the first draft (4
blockers, 1 cheap-to-close gap). All 5 are folded into the design text above,
not left as addenda:

1. **Silent `admin` → `guests.delete` escalation (blocker).** The naive
   backfill would have copied `guests.delete` to `admin` from the global
   template, silently making it live the moment D4 shipped, with no owner
   action. Fixed by §3.9's revoke-with-opt-in rule: backfill/seed withhold
   `guests.delete` from every non-owner role regardless of the template;
   owners opt back in via the UI. **Flagged for explicit product-owner
   confirmation** — this is a real behavioral decision, not a mechanical fix.
2. **False regression-check claim (blocker).** §6 originally claimed
   `has_org_permission()` returns byte-identical booleans pre/post for all 4
   roles — false once `system_protected` and the Fix-1 `guests.delete`
   exclusion are accounted for. Corrected to an **effective-behavior**
   equivalence claim with the two intended deltas spelled out, and the
   regression test respecified to match.
3. **Incomplete D4 rollback (blocker).** The original rollback only undid the
   trigger/function pieces, leaving the RLS DELETE swap and the Phase-7 app
   gate swap in place — which, combined with `has_org_permission()` reverting
   to the frozen template (where `admin` holds `guests.delete`), would have
   made a "rollback" grant admin live delete power. Fixed: rollback is now
   explicitly two coordinated pieces (DB migration + app deploy) that must
   land together, with the RLS policies included in the DB piece.
4. **Under-specified `whatsapp-import.ts` fix (blocker).** The original §4
   said "same join shape" without specifying it; the actual current code
   builds a single global `Set<role_id>`, which stops being safe once
   permissions are per-`(organization_id, role_id)` — the same bug class the
   file's own top comment describes fixing once already. Respecified as a
   concrete per-membership composite-key (`organization_id:role_id`) tuple
   check, with the current buggy-if-copied-verbatim code and the corrected
   code both shown.
5. **`UPDATE` bypass on `organization_role_permissions` (non-blocker, cheap).**
   Only `BEFORE INSERT`/`BEFORE DELETE` triggers existed; a bare `UPDATE`
   would bypass both guards. Fixed by adding a `BEFORE UPDATE` trigger that
   unconditionally rejects any `UPDATE` on the table, since the app's only
   sanctioned mutations are insert (grant) and delete (revoke) — chosen over
   a partial column-change check because it's simpler and there is no
   legitimate `UPDATE` path to preserve.
