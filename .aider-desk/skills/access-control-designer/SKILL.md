---
name: access-control-designer
description: "Design application roles, a permission matrix, and permission-gated UI for the product you are building — Pundit policies on the Rails API, CASL gates for sidebars, menus and actions on Vite SPA, Next.js and React Native, plus a per-role 'As a <Role>, what should I see, and how should I see it?' UX pass. Use for designing roles and permissions, RBAC, who-can-do-what, admin vs member access, role-based navigation, hiding or disabling actions by permission, or multi-tenant access. Application authorization only — not Claude Code permission settings, and not which skills or agents Claude may use."
model: opus
---

# Access Control Designer

Decide who can do what in the product being built — once, as data — then enforce it on the server
and reflect it in every UI. The matrix is the artifact. Pundit, CASL, and the per-role UX pass are
three readers of it, and none of them keeps a second copy.

| This skill **is** | This skill **is not** |
|---|---|
| Application authorization: roles, a permission matrix, Pundit policies, CASL gates, role-gated sidebars, menus, and actions | Claude Code's own permission settings, its deny rules, or the SessionStart sentinel |
| Multi-tenant access: memberships, scopes, plan entitlements | Which skills or agents Claude may use |
| The "As a <Role>, what should I see?" UX pass | Authentication: sign-in, tokens, JWT revocation (`std-security`, `@skills/std-rails-conventions/references/authorization.md`) |

Load-bearing rules (hold even if you read nothing else):

1. **The Rails policy is the authority. CASL is UX only.** Hiding a button does not protect anything;
   the request behind it is re-authorized every time.
2. **Deny by default.** A new permission key ships granted to no role.
3. **The UI checks permission keys (`orders.update`), never role names.** `role === 'admin'` breaks
   the first time a customer's Manager needs the same button.
4. **Roles live on the membership (user × organization)**, never in a `role` column on `users`.
5. **Permission ≠ record state ≠ entitlement.** They are three inputs with three owners and three
   different UI outcomes.

---

## Step 1: Roles as personas, per tenant

- Name each customer role by the job it does inside the customer's organization (Owner, Admin,
  Manager, Member, Viewer). Write one line per role: what they come to do, and what would go wrong
  if they could do more.
- Keep it to 4-6 roles. If two roles differ by one key, the fix is a scope or an entitlement, not
  another role.
- **Platform staff are not a customer role.** Your support and ops engineers get a separate staff
  model, a separate policy namespace, and audited impersonation. Never add a `super_admin` row to a
  customer's membership table.
- Roles are not a ladder. A Viewer (finance, audit) may read more than a Member (a sales rep working
  their own orders). Design from the job, not from seniority.
- If the `requirements-consultant` produced a draft matrix, start from it.

## Step 2: The matrix

- **Rows** are permission keys in `resource.action` form (`orders.read`, `orders.approve`,
  `members.invite`). **Columns** are roles. **Cells** are scopes: `—` / `own` / `team` / `org` /
  `all`. Add an **Entitlement** column naming the plan feature a key also requires.
- Every cell starts as `—`. Each grant is written on purpose, so an empty matrix denies everything.
- `all` crosses organizations, so it appears only in platform-staff columns.
- Flag separation-of-duties pairs (creator ≠ approver) in the matrix. They are enforced per record,
  not per cell.
- The single source-of-truth file, a sample B2B matrix, and the spec that keeps the documented table
  in sync → `references/permission-matrix.md`.

## Step 3: Decide the role model

- **Code-defined by default:** roles and role→permission assignments live in one file in the repo,
  change through a PR, and are pinned by a spec.
- **DB-backed assignments only when customer admins must create roles at runtime.** Permission keys
  stay in code even then. A key is a code path, and an admin must not be able to invent one that
  nothing checks.
- This choice changes the data model and is expensive to reverse, so record it as an ADR through the
  `architecture-advisor` agent. The decision table → `references/permission-matrix.md`.

## Step 4: Enforce with Pundit

- Each policy predicate answers one matrix row. `update?` means "`orders.update` is granted at a
  scope that covers this record". `Scope#resolve` turns the scope column into a `where`.
- Membership lookup, scope resolution, the `/me` rules generator, and the role-grant policy in Ruby →
  `@skills/std-rails-conventions/references/roles-and-permissions.md`.
- The wiring that makes a forgotten `authorize` fail CI (`verify_authorized` /
  `verify_policy_scoped`), and scoping before authorizing so an out-of-scope record returns 404
  instead of 403 → `@skills/std-rails-conventions/references/authorization.md`. Link to it instead of
  repeating it.
- Django/DRF (`BasePermission` + `get_queryset`) and FastAPI (`require_permission` via `Depends`)
  equivalents → `references/permission-matrix.md`.

## Step 5: Expose effective permissions on `/api/v1/me`

- `/api/v1/me` returns the caller's roles in the current organization, the organization's
  entitlements, and `permissions: { version, rules }`. The rules are CASL rules generated
  server-side from the matrix, for this organization only, inside the house `{ data }` envelope.
- Record-state blocks never go in the rules. They arrive on each record:
  `actions: { cancel: { enabled: false, reasonCode: "ORDER_SHIPPED" } }`.
- The contract, the scope → CASL conditions mapping, and the camelCase rule →
  `references/ui-gates.md`.

## Step 6: Gate the UI

Resolve every gated element in this order; the first "no" decides. The canonical definition is
`@skills/ui-ux-patterns/references/role-based-ux.md`:

| The caller… | The element is… |
|---|---|
| Is not permitted | **Not rendered.** No greyed-out hint of power they don't have |
| Is permitted, but the plan lacks the entitlement | **Visible and locked**, shown only to roles that could act on it |
| Is permitted and entitled, but this record's state blocks it | **Disabled, with a visible reason** (from `reasonCode`) |

- `/me` lives in TanStack Query under `['me']`, never in Zustand (the auth token may stay in the auth
  store). CASL condition keys must be camelCase, or they silently evaluate `false`.
- Per-stack mechanics → `references/ui-gates.md`: Vite SPA loaders, the Next.js layout and shadcn
  `Sidebar`, React Native navigators, Phlex props, and switching organization.
- Navigation structure — the global nav lists areas only, sections render in each area's layout, a
  role with one area lands inside it, and a feature reached by URL without its grant gets the
  no-access page (records still 404) → `@skills/ui-ux-patterns/references/drill-down-navigation.md`;
  the nav config, `visibleNav` and `areaState` → `references/ui-gates.md`.

## Step 7: The role lens

For each role, walk the primary screens and answer **"As a <Role>, what should I see, and how should
I see it?"** Cover the landing screen, the nav, what an empty state says to someone who cannot
create, and whether a Viewer's dashboard is a smaller Manager dashboard or a different one entirely.
Persona cards, walkthrough tables, and the checklist → `@skills/ui-ux-patterns/references/role-based-ux.md`.

## Step 8: Verify

- **Policy specs driven by the matrix:** iterate every role × key and assert the policy's answer.
  Include an **other-tenant row**: the Owner of organization B gets a 404 on organization A's
  records. A hand-picked sample of cases is how the one wrong cell ships.
- **A doc spec** that parses the documented table and compares it cell by cell with the source file
  → `references/permission-matrix.md`.
- **Per-role UI tests:** table-driven, one `/me` fixture per role, asserting rendered / locked /
  disabled for each gated element → `references/ui-gates.md`.
- AAA structure and naming → `std-testing`.

## Step 9: Grants and audit

- **A grant must fit within the granter's own permissions**, in both key and scope. The member's
  *current* role must fit too, so an Admin can neither create an Owner nor demote one.
- **No self-grant:** nobody changes their own role. Another member holding `roles.assign` does it.
- **Last-owner guard:** demoting or removing the last Owner fails. Recheck this under a lock inside
  the transaction.
- **Append-only audit events** commit in the same transaction as the change, recording actor,
  organization, the member affected, from-role, and to-role. Events are never updated or deleted.
- A role change bumps the member's `permissions.version` and invalidates their `['me']` →
  `references/ui-gates.md`.
- The admin screens that apply these rules — role catalog, invite and assign, the matrix editor, the
  last-owner guard, the audit log, "view as" → `@skills/ui-ux-patterns/references/role-management-ux.md`.

## Output

1. Role personas (Step 1), plus the matrix as a table and as its source file (Step 2)
2. The role-model decision, written as an ADR when DB-backed (Step 3)
3. A policy and scope plan per resource (Step 4), and the `/me` contract (Step 5)
4. A per-role gate table: each gated element and its state for every role (Steps 6-7)
5. The test plan: matrix-driven policy specs with the other-tenant row, the doc spec, and the
   per-role UI table (Step 8)

## Deep guides (read on demand, do not preload)

- Vocabulary, a sample B2B matrix, the source-of-truth file and its doc spec, static vs DB-backed
  roles, memberships, separation of duties, grant rules, Django/DRF and FastAPI enforcement →
  `references/permission-matrix.md`
- The `/me` contract, scope → CASL conditions, per-record `actions`, `ability.ts` and the provider,
  the nav config (areas with sections, `visibleNav`, `areaState`), breadcrumbs and scoped counts,
  Vite SPA / Next.js / React Native / Phlex gates (a missing grant renders no access, a record outside
  scope is not found), switching organization, realtime invalidation, per-role UI and navigation
  structure tests → `references/ui-gates.md`

## Owned elsewhere — do not duplicate

- Membership, role, and team tables, with their relationships and indexes → `std-database`
  (`@skills/std-database/references/relationships.md`)
- Rendering the 403 and the error envelope → `@skills/std-api-design/references/errors-rails.md`
- ARIA mechanics for disabled and locked controls → `std-accessibility`
- Building the Next.js UI from shadcn/ui components and blocks → the `nextjs-developer` agent
- Building Phlex UI → the `phlex-developer` agent
