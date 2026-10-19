# Permission Matrix — one table, read by every layer

Load-bearing rules restated (hold even if you read nothing else):

1. **Deny by default.** Every cell starts as `—`. A new permission key ships granted to no role, and
   someone writes each grant on purpose.
2. **Cells are scopes, not booleans:** `—` / `own` / `team` / `org` / `all`. A checkbox cannot say
   "their team's orders".
3. **Roles live on the membership** (user × organization). A `role` column on `users` cannot say
   "Admin at Acme, Viewer at Globex".
4. **Permission keys are always defined in code.** Role→permission assignments are code-defined by
   default. They move to the database only when customer admins must create roles at runtime.
5. **Checks name keys, never roles**: in policies, in routes, and in the UI.
6. **Keep one source-of-truth file**, plus a spec that fails when the documented table no longer
   matches it.

This file is stack-neutral. Enforcement is owned elsewhere: Pundit →
`@skills/std-rails-conventions/references/roles-and-permissions.md`; UI gates →
`@skills/access-control-designer/references/ui-gates.md`; what each UI state looks like →
`@skills/ui-ux-patterns/references/role-based-ux.md`; tables and indexes →
`@skills/std-database/references/relationships.md`.

---

## Vocabulary

| Term | Means | Lives in |
|---|---|---|
| **Role** | A named job inside a customer organization (e.g. Manager); a bundle of grants | Code (the DB only when custom roles exist) |
| **Permission key** | `resource.action` (e.g. `orders.approve`); the unit every check names | Code, always |
| **Scope** | How far a grant reaches: `own` = records the caller owns · `team` = the caller's teams · `org` = the whole organization · `all` = every organization | The matrix cell |
| **Membership** | The user × organization row that carries the role | Database |
| **Entitlement** | A feature included in the organization's plan (e.g. `exports`) | Plan / billing data |
| **Record state** | A fact about one record that blocks an action for everyone (e.g. `shipped`) | The record itself |

Scopes widen in one direction: `—` < `own` < `team` < `org` < `all`. Because `all` crosses tenants,
only platform-staff roles hold it. Those roles live outside customer memberships and have their own
policy namespace.

## A sample matrix — B2B ordering platform

| Permission key | Owner | Admin | Manager | Member | Viewer | Entitlement |
|---|---|---|---|---|---|---|
| `orders.read` | org | org | team | own | org | — |
| `orders.create` | org | org | team | own | — | — |
| `orders.update` | org | org | team | own | — | — |
| `orders.cancel` | org | org | team | — | — | — |
| `orders.approve` | org | org | team | — | — | `approvals` |
| `orders.export` | org | org | team | — | org | `exports` |
| `members.read` | org | org | team | team | — | — |
| `members.invite` | org | org | team | — | — | — |
| `roles.assign` | org | org | — | — | — | — |
| `billing.update` | org | — | — | — | — | — |

What each role is:

- **Owner** holds the account and the payment card.
- **Admin** runs the organization day to day but never touches billing.
- **Manager** leads a team and approves its orders.
- **Member** is a sales rep working their own orders.
- **Viewer** is finance or audit: reads and exports everything, changes nothing.

Viewer reaches further than Member because roles describe jobs, not rank.

No key is named `*.manage`. `manage` is CASL's wildcard action, so a key that maps to it would
grant every action on that subject in the UI.

## The source of truth — one file

Generate everything from this file, or test it against this file: the policies, the `/me` rules, the
documented table, and the UI fixtures.

- **Rails-only product:** the file is the `PermissionCatalog` and `PermissionMatrix` constants
  (`@skills/std-rails-conventions/references/roles-and-permissions.md`).
- **A Python service or a codegen step also reads it:** make it YAML.

```yaml
# config/permissions.yml — THE matrix. A role omitted from `grants` has `—`.
roles: [owner, admin, manager, member, viewer]
subjects:                        # the CASL subject type, and the column each scope filters on
  orders:  { type: Order, own: user_id, team: team_id }
  billing: { type: Billing }
permissions:
  orders.read:    { grants: { owner: org, admin: org, manager: team, member: own, viewer: org } }
  orders.approve: { grants: { owner: org, admin: org, manager: team }, entitlement: approvals, creator_cannot_approve: true }
  billing.update: { grants: { owner: org } }
  # ...one entry per row of the table
```

The `/me` generator does two things with `subjects`: it camelizes the columns (`user_id` →
`userId`), and it maps the `orders` resource to the subject type `Order`. The client breaks without
either step; see `@skills/access-control-designer/references/ui-gates.md`.

### Pin the documented table to the file

A matrix hand-copied into a wiki goes stale within a quarter. Nobody notices, because the doc still
reads fine. Parse the doc in a spec instead:

```ruby
# spec/authorization/matrix_doc_spec.rb — the documented table IS the constant, cell for cell
require "rails_helper"

RSpec.describe "docs/access-control/matrix.md" do # the doc holds this one table
  let(:table) do
    Rails.root.join("docs/access-control/matrix.md").read.lines.grep(/\A\|/)
      .map { |line| line.strip.delete_prefix("|").delete_suffix("|").split("|").map(&:strip) }
  end
  let(:roles) { table.first[1...-1].map(&:downcase) } # header: key, one column per role, entitlement
  let(:rows)  { table.drop(2).to_h { |key, *cells| [key.delete("`"), cells.first(roles.size)] } }

  it "should list exactly the matrix roles and catalog keys when the doc is parsed" do
    expect(roles).to eq(PermissionMatrix::ROLES.keys)
    expect(rows.keys).to match_array(PermissionCatalog::KEYS.to_a)
  end

  it "should match PermissionMatrix cell for cell when the doc is parsed" do
    rows.each do |key, cells|
      expected = roles.map { |role| PermissionMatrix::ROLES.fetch(role).fetch(key, :none) }
      expect(cells.map { |cell| cell == "—" ? :none : cell.to_sym }).to eq(expected), "#{key} drifted"
    end
  end
end
```

Write `—` in every denied cell. A blank cell fails the spec, because an empty string is not a scope.

- **Policy specs** that iterate every role × key, plus the other-tenant row, are owned by
  `@skills/std-rails-conventions/references/roles-and-permissions.md`.
- **With the YAML form**, load the file in the same two examples.
- **A Python service** runs the same checks as a parametrized `pytest`.

## Static or DB-backed role assignments?

| | Code-defined (default) | DB-backed assignments |
|---|---|---|
| Who changes a grant | An engineer, in a reviewed PR | A customer admin, at runtime |
| Custom roles per organization | No | **Yes — the only reason to choose this** |
| Permission keys | In code | **Still in code**: rows reference keys and never invent them |
| How a wrong grant is caught | The matrix spec, in CI | Grant rules at write time, plus the audit log |
| Cost | A deploy per change | Tables, an admin UI, cache invalidation, seeded system roles |

If you choose DB-backed:

- **Seed system roles from the code matrix** and make them read-only. A custom role starts as a copy
  of a system role and is edited within the grant rules below.
- **Validate every stored `permission_key` against the code catalog**, both at write time and in CI.
  An orphaned key is a grant that nothing enforces, yet the admin UI shows it as working.
- **Record the decision as an ADR** through the `architecture-advisor` agent. Tables, constraints,
  and the cache key → the DB-backed section of
  `@skills/std-rails-conventions/references/roles-and-permissions.md` and
  `@skills/std-database/references/relationships.md`.

## Roles live on the membership

```ruby
current_user.admin?       # ❌ one role for the whole person, in every organization
current_membership.role   # ✅ the role in the organization this request acts on
```

- **The current organization comes from the request** (path or header) and is resolved *through the
  caller's memberships*. If the caller doesn't belong to the organization named, there is no
  membership, so there are no grants. The response is a 404; a role is never borrowed from another
  tenant.
- **One membership per user per organization.** If a person holds several roles there, the roles
  hang off that one membership. For each key, the effective scope is the widest scope any of those
  roles grants.
- **The union never crosses organizations.** An Admin at Acme who is a Viewer at Globex is a Viewer
  while acting in Globex.
- **Teams are a second membership** (user × team). The `team` scope reads it.

## Deny by default, in practice

- A new key lands with no grants and an all-`—` row in the doc. Granting it is a separate,
  reviewable change.
- A role without an entry for a key has `—`. Nothing is inherited from "the role above".
- **No wildcards.** Not even "the Owner gets every key": a wildcard also grants every key added
  after it, which quietly turns deny-by-default into allow-by-default. List the Owner's keys like
  any other role's. CASL's `manage` and `all` are the same trap on the client.

## Separation of duties

"A Manager may approve their team's orders, **except the ones they created**" cannot be expressed as
a cell. It is a per-record rule layered on top of the grant:

- **The matrix flags it** (`creator_cannot_approve: true`), so it is visible where grants get
  reviewed.
- **The policy enforces it.** `approve?` requires that the grant covers the record **and** that
  `record.created_by_id != user.id`.
- **The UI receives it as record state:** `actions.approve: { enabled: false, reasonCode:
  "SELF_APPROVAL" }`. The Manager sees a disabled Approve button with a reason, not a missing
  button that looks like a bug.

## Permission, entitlement, record state

| Input | Question it answers | Source | When it says no, the UI… |
|---|---|---|---|
| **Permission** | May this role do this, and how far does it reach? | The matrix → CASL rules on `/me` | Does not render the element |
| **Entitlement** | Does the organization's plan include it? | The plan | Shows it locked, only to roles holding the permission |
| **Record state** | Does *this record* allow it right now? | `actions` on each record | Disables it and shows the reason |

**Effective access = permission AND entitlement.** Record state only decides whether *this* record
can take the action *now*. The server evaluates all three on every request, and the UI resolves them
in the table's order → `@skills/ui-ux-patterns/references/role-based-ux.md`.

Keep the three apart:

- Modelling an entitlement as a role ("Pro Admin") multiplies roles by plans.
- Baking record state into the rules makes `/me` stale the moment an order ships.

## Grant rules

1. **A grant must fit within the granter's own permissions**: same keys, no wider scope. The
   member's *current* role must fit too; otherwise an Admin could "grant" the Owner a demotion.
2. **No self-grant.** Nobody changes their own role, up or down. Another member who holds
   `roles.assign` makes the change.
3. **Last-owner guard.** Demoting or removing the organization's last Owner fails. Recheck under a
   lock inside the transaction; otherwise two Owners demoting each other at the same moment leave
   the organization with none.
4. **Audit in the same transaction.** Every grant, change, and removal writes an append-only event
   (actor, organization, member affected, from-role, to-role). The event commits with the change or
   not at all.
5. **A role change bumps the member's permissions version**, so their client refetches `/me`.

The Rails implementation of rules 1-4 →
`@skills/std-rails-conventions/references/roles-and-permissions.md`.

## The UI checks keys, never role names

```tsx
{me.roles.includes('admin') && <InviteButton />}      // ❌ breaks when a custom role or a Manager needs it
{allows(ability, 'members.invite') && <InviteButton />} // ✅ asks the question the matrix answers
```

`roles` is on `/me` for display ("You are a Manager at Acme"), never for gating. The same holds on
the server: a policy that checks `user.admin?` has quietly created a second, unreviewed matrix.

## Django + DRF

A DRF permission class reads the same matrix. `has_object_permission` runs only through
`get_object()`, never on `list`. That makes `get_queryset` scoping mandatory: it is the only filter
applied to the list, and it turns an out-of-scope `retrieve` into a 404.

```python
# apps/access/matrix.py — MATRIX is config/permissions.yml, loaded once
SCOPES = ("own", "team", "org", "all")


def scope_for(membership: Membership, key: str) -> str | None:
    grants = MATRIX["permissions"][key]["grants"]
    held = [grants[role] for role in membership.role_names if role in grants]
    return max(held, key=SCOPES.index, default=None)  # widest scope within THIS organization


def in_scope(record: Model, scope: str | None, membership: Membership) -> bool:
    if scope is None or record.organization_id != membership.organization_id:
        return scope == "all"
    if scope == "own":
        return record.user_id == membership.user_id  # the subject's `own` column
    if scope == "team":
        return record.team_id in membership.team_ids
    return True  # org (or all)
```

```python
# apps/orders/permissions.py
ACTION_KEYS = {
    "list": "orders.read", "retrieve": "orders.read", "create": "orders.create",
    "update": "orders.update", "partial_update": "orders.update", "cancel": "orders.cancel",
}


class OrderPermission(BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        key = ACTION_KEYS.get(view.action)  # unmapped (e.g. destroy) is denied, not waved through
        return key is not None and scope_for(request.membership, key) is not None

    def has_object_permission(self, request: Request, view: APIView, obj: Order) -> bool:
        key = ACTION_KEYS[view.action]
        return in_scope(obj, scope_for(request.membership, key), request.membership)


class OrderViewSet(viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, OrderPermission]

    def get_queryset(self) -> QuerySet[Order]:
        scope = scope_for(self.request.membership, "orders.read")
        return Order.objects.visible_to(self.request.membership, scope)  # .none() when scope is None
```

`request.membership` is set by an authentication class that resolves the current organization
against the user's memberships. The custom QuerySet manager behind `visible_to` → `std-django`.

## FastAPI

Use a dependency factory. `require_permission("orders.update")` returns a dependency that either
resolves the caller's scope for that key or refuses the request. Routes name keys; no route body
checks a role.

```python
# app/api/deps/permissions.py
def require_permission(key: str) -> Callable[..., Awaitable[str]]:
    async def dependency(membership: Membership = Depends(get_current_membership)) -> str:
        scope = scope_for(membership, key)
        if scope is None:
            # A domain exception, so the ONE app-level handler renders the house envelope.
            # Raising HTTPException here would ship FastAPI's default body instead.
            raise PermissionDenied(key)
        return scope

    return dependency
```

```python
# app/api/routers/orders.py
@router.patch("/{order_id}", response_model=OrderRead, status_code=200)
async def update_order(
    order_id: UUID,
    payload: OrderUpdate,
    scope: str = Depends(require_permission("orders.update")),
    membership: Membership = Depends(get_current_membership),  # FastAPI caches it per request
    session: AsyncSession = Depends(get_session),
) -> OrderRead:
    # The service filters by scope, so an order outside it is "not found": 404, not 403.
    order = await OrderService(session).update(order_id, payload, membership=membership, scope=scope)
    return OrderRead.model_validate(order)


# A whole router behind one key: the return value is discarded, but the refusal still applies.
billing_router = APIRouter(
    prefix="/billing", tags=["billing"], dependencies=[Depends(require_permission("billing.update"))]
)
```

`get_current_membership` builds on `get_current_user` and resolves the organization the request
names. Overriding it in tests is how each role gets exercised → `std-fastapi`.

## Anti-patterns

| Anti-pattern | What goes wrong | Instead |
|---|---|---|
| `role` column on `users` | One role across every organization | Role on the membership |
| `user.admin?` / `role === 'admin'` | New and custom roles silently lose access | Check the key |
| Boolean cells | "Their team's orders" can't be expressed, so it ends up as an `if` somewhere | Scopes |
| Matrix hand-copied into a wiki | Goes stale unnoticed while still reading fine | Source file + doc spec |
| New key granted to Admin "for now" | Default-allow by habit | Ship it granted to nobody |
| "Owner gets every key" by rule | Every future key is granted without review | List the Owner's keys |
| `super_admin` membership in a customer org | Staff power inside tenant data, unaudited | Separate staff model, audited impersonation |
| Permission keys stored in the DB | Admins grant keys that no code checks | Keys in code; the DB stores assignments |
| Role union across organizations | Power leaks between tenants | Union within the current organization |
| Plan tiers as roles ("Pro Admin") | Roles × plans explosion | Entitlement column, AND-ed with the permission |
| Hiding the button as the only control | The endpoint still answers | Pundit on every request; CASL is UX |
