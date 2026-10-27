# Proposal

## Why

The organization (customer) axis has no declared action map: its 24 keys are passed as string pairs at 61 call
sites, role management is gated by an "is org owner" check instead of a permission, and 12 of its SECURITY DEFINER
functions still run with `search_path=public` (measured 2026-10-26, design Context). Invitations and the org switcher
already let a user join a second organization, so each decision must be made in the right organization; this change
was split out of `permissions-macro-to-micro` with owner approval on 2026-10-26 (~21:52).

## What Changes

- **An organization action map.** `ORG_ACTIONS`, in its own module, maps every org key to a CASL `subject.action`.
  - The event is the subject of both the `events.*` and the `campaigns.*` keys:
    `Event.{view, create, edit, delete, view_rsvp, create_rsvp, edit_rsvp, delete_rsvp, administer_rsvp}`.
  - The rest map by resource: `Guest`, `Contact`, `Report`, `Billing`, `Member`, `Organization`.
  - The key union is generated from the catalogue.
- **Every org gate takes an action pair.** `can`, `requirePermission`, `requireEventAccess` and `canAccessEvent` take
  `(action, subject)`, and a static check bans string pairs.
  - Org-scoped gates decide in the organization they are given (the server-verified active organization), through
    one key RPC.
  - Event-scoped gates decide in the event's own organization, whichever organization is active.
- **Organization role management becomes a permission.** A new system-protected org key gates the roles matrix, its
  actions, and the team page's entry point. Its name is owner decision B-O21.
  - The migration grants the key to the owner role in every existing organization before any gate reads it, so
    today's owners keep role management.
  - `requireOrgOwner`, `isOrgOwner` and `is_org_owner()` are retired. The two role-table policies move to the key.
- **Database hygiene, with no access change:**
  - `search_path=''` on the 12 org SECURITY DEFINER functions;
  - the default-grant rule defined once, and shared by `create_organization` and the role reset;
  - the 3 inert template rows deleted.
- **Proof:**
  - pgTAP pins the org invariant and the 13 org-helper policies;
  - local-it personas: org owner, admin, member, viewer, and one user in two organizations;
  - the core change's permission analyzer learns the org gates and renders the organization section of its map.
- **Owner decision B-O18.** Deleting an RSVP question moves from the event owner only to holders of `events.edit`.
  This retires `owns_event()`.

No live person's access changes, except through B-O18, which has no live effect (the table has 0 rows).

## Capabilities

### New Capabilities
- `organization-authorization`: how an organization member's permissions are decided:
  - every decision goes through the organization action map;
  - role management is a permission that only the owner role can hold;
  - an org-scoped decision is made in the given organization, and an event-scoped decision in the event's own
    organization;
  - a role reset restores exactly what a new organization receives.

### Modified Capabilities
- None. `openspec/specs/` is empty. The three organization requirements move here from the in-flight
  `permissions-macro-to-micro` (`authorization-model`), which removes them (design D0).

## Impact

- **Code:**
  - `src/lib/org-actions.ts` (new);
  - `src/lib/auth/org-permission-keys.generated.ts` with `scripts/gen-org-permission-keys.mjs` (new);
  - `src/lib/permissions.ts` and `src/lib/data/events.ts` (`requireEventAccess`, `canAccessEvent`);
  - `src/lib/data/orgs.ts`;
  - `src/lib/auth/dal.ts` (`requireOrgOwner` and `isOrgOwner` removed);
  - `src/app/(customer)/app/team/**` and `src/app/(customer)/app/layout.tsx`;
  - the 61 call sites, in 25 files;
  - `src/lib/supabase/types.generated.ts`, regenerated after each function is added or dropped;
  - `scripts/permission-matrix/*`, owned by the core change: the org gate recognizers and the organization section
    only.
- **Database:**
  - new functions `current_org_permission_keys` and `org_role_permissions_defaults` (the default-grant rule);
    `create_organization` re-seeds through the latter;
  - `search_path` on 12 functions;
  - the role-management key and its owner backfill;
  - 2 policies, and `drop function is_org_owner`;
  - if B-O18 is accepted: `eq_owner_delete` and `drop function owns_event`.

  Every migration is its own push. A push to main deploys it, so each one needs owner approval.
- **Docs:**
  - the organization section of `docs/project/02a-permissions-map.md`, which the core change owns and generates;
  - §7 of `docs/project/02-auth-and-authorization.md` (the organization axis) marked superseded by that section;
  - supersede notes in the two 2026-07-13 org-RBAC documents under `docs/superpowers/specs/`.
- **CI:** none here. The core change owns the CI change (design D6).
- **Sibling changes:** `permissions-macro-to-micro` (the core) and `harden-public-access-surface`; see design D0.
