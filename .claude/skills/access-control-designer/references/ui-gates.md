# UI Gates — CASL draws the matrix, Rails enforces it

Load-bearing rules restated (hold even if you read nothing else):

1. **CASL is UX only.** It decides what to draw. The Rails policy decides what happens, on every
   request. A wrong gate in the UI is a UX bug. A gate that exists *only* in the UI is a
   vulnerability.
2. **`/me` lives in TanStack Query under `['me']`, never in Zustand.** It is server data. The auth
   token may stay in the auth store. Next.js Server Components read `/me` through `getSession()`.
3. **CASL condition keys are camelCase**, matching the JSON records they are tested against. A
   `snake_case` key reads `undefined` on a camelCase record, and the rule evaluates `false` with no
   error. The button then never appears for the people it was written for.
4. **Gates name permission keys, never role names.**
5. **Navigation uses type checks; actions use record checks.** `ability.can('update', 'Order')`
   ignores conditions and means "at least one order". Only
   `ability.can('update', subject('Order', order))` asks about *this* order.
6. **The nav config is areas with sections, filtered before anything is built.** The global sidebar
   renders areas only; sections render only in the area's own layout.
7. **A feature reached by URL without its grant renders the no-access page; a record outside scope
   is not found.** Never `notFound()` and never a silent redirect for a missing grant.

The canonical definition of the three states and their resolution order (permission → entitlement →
record state) is `@skills/ui-ux-patterns/references/role-based-ux.md`. What the navigation holds and
how deep it goes is `@skills/ui-ux-patterns/references/drill-down-navigation.md`. This file covers
only the implementation.

---

## The `/me` contract

`GET /api/v1/me` returns the house `{ data }` envelope (`std-api-design`). For a Member at one
organization:

```json
{
  "data": {
    "id": "u_42",
    "organizationId": "org_7",
    "roles": ["member"],
    "entitlements": ["approvals"],
    "permissions": {
      "version": 7,
      "rules": [
        { "action": "read", "subject": "Order", "conditions": { "organizationId": "org_7", "userId": "u_42" } },
        { "action": "create", "subject": "Order" },
        { "action": "read", "subject": "Member", "conditions": { "organizationId": "org_7", "teamId": { "$in": ["team_3"] } } }
      ]
    }
  }
}
```

| Scope | Rule emitted |
|---|---|
| `—` | **No rule.** A missing rule is the denial |
| `own` | `{ "organizationId": …, "<ownerColumn>": "<caller id>" }` (the subject's owner column, camelized) |
| `team` | `{ "organizationId": …, "teamId": { "$in": [<caller's team ids>] } }` |
| `org` | `{ "organizationId": … }`. Keep the condition: after an organization switch, the old organization's records can linger in the cache |
| `all` | Never sent to a customer client |

- **Send one organization's rules only.** Never send every membership's rules, and never the role →
  permission table. Generator → `@skills/std-rails-conventions/references/roles-and-permissions.md`.
- **`subject` is the CASL subject type (`Order`).** It is mapped from the key's resource (`orders`)
  by the same table the client uses. A rule written for `orders` never matches
  `subject('Order', record)`.
- **`create` rules carry no conditions,** because there is no record yet and the server assigns
  ownership.
- **Never emit `manage`, `all`, or inverted rules.** CASL treats `manage` and `all` as wildcards,
  and a missing rule already denies.
- **`version` increments whenever effective permissions change.** Clients compare it but never
  compute with it.
- **`roles` is for display only.** Never gate on it.
- **Serialize every field a condition names.** If the serializer drops `teamId`, every team-scoped
  rule evaluates false. Pin the fields with a request spec.

Record state travels on each record, and only for actions the caller is permitted to take.
Unpermitted actions are omitted:

```json
{ "data": { "id": "ord_9", "status": "shipped", "userId": "u_42", "organizationId": "org_7",
  "actions": { "cancel": { "enabled": false, "reasonCode": "ORDER_SHIPPED" } } } }
```

`reasonCode` is a stable code that maps to translated copy (`orders.reasons.ORDER_SHIPPED`). The UI
never renders the raw code, and never renders a sentence written by the server.

## `ability.ts` and the provider — one of each, shared by every React stack

```ts
// src/lib/ability.ts
import { createMongoAbility, subject, type ForcedSubject, type MongoAbility, type RawRuleOf } from '@casl/ability';

type Subjects = 'Order' | 'Member' | 'Billing';
type Actions = 'read' | 'create' | 'update' | 'cancel' | 'approve' | 'export' | 'invite';
export type AppAbility = MongoAbility<[Actions, Subjects | ForcedSubject<Subjects>]>;
export type AppRule = RawRuleOf<AppAbility>;

// Generated from the matrix file with the API client; Rails maps keys with the same table.
export const PERMISSIONS = {
  'orders.read': ['read', 'Order'],
  'orders.cancel': ['cancel', 'Order'],
  'orders.approve': ['approve', 'Order'],
  'members.read': ['read', 'Member'],
  'billing.update': ['update', 'Billing'],
} as const satisfies Record<string, readonly [Actions, Subjects]>;
export type PermissionKey = keyof typeof PERMISSIONS;

export const buildAbility = (rules: AppRule[]): AppAbility => createMongoAbility<AppAbility>(rules);

export function allows(ability: AppAbility, key: PermissionKey, record?: object): boolean {
  const [action, type] = PERMISSIONS[key];
  if (!record) return ability.can(action, type); // type check: nav items, "New" buttons
  return ability.can(action, subject(type, { ...record })); // subject() tags its argument, so copy the shared cache object
}
```

```tsx
// src/components/providers/AbilityProvider.tsx — @casl/react 7
'use client'; // Next.js needs the directive; Vite and Metro ignore it

import { useMemo, type ReactNode } from 'react';
import { AbilityProvider as CaslAbilityProvider, Can as CaslCan, useAbility, type CanProps } from '@casl/react';
import { buildAbility, type AppAbility, type AppRule } from '@/lib/ability';

export const Can = CaslCan as (props: CanProps<AppAbility>) => ReactNode; // typed to this app's actions and subjects
export const useAppAbility = () => useAbility<AppAbility>(); // throws outside an AbilityProvider

// Plain rules in, Ability built here. Next.js requires this (a class instance cannot cross the
// Server → Client boundary), and it lets one provider shape serve all three stacks.
export function AbilityProvider({ rules, children }: { rules: AppRule[]; children: ReactNode }) {
  const ability = useMemo(() => buildAbility(rules), [rules]); // new rules, new Ability
  return <CaslAbilityProvider value={ability}>{children}</CaslAbilityProvider>;
}
```

- **Pin `@casl/react@^7` with `@casl/ability@^7`.** 7.0.0 replaced `createContextualCan` with
  `<AbilityProvider>`: `useAbility()` takes no context argument, and `<Can>` takes no `ability` prop
  and reads the provider itself (@casl/react — CHANGELOG). A package still on 6 or earlier keeps
  `createContextualCan` and `useAbility(context)` until it upgrades — one API per package, never both.
- **The provider's prop is `value`** — the 7.0.1 typings and runtime. `ability={…}`, which one README
  example shows, leaves the context empty, and the first gate below it throws.
- **`useAppAbility()` throws outside an `AbilityProvider`** ("AbilityContext is not provided"). There
  is no default context any more: before `/me` arrives, "nothing permitted" is the provider holding
  empty rules. So a component that renders the provider cannot read it — the Vite `AppLayout` renders
  `AppShell` for that reason — and a component test of a gated leaf renders it inside one, through the
  web harness's `rules` option (`@skills/std-testing/references/react-components.md`).
- **`[ability]` is a sound hook dependency here,** because the provider builds a new Ability when the
  rules change. Code that mutates one Ability with `ability.update()` depends on `ability.rules`
  instead (@casl/react — README).

A client leaf that resolves its states in the canonical order:

```tsx
// src/components/organisms/CancelOrderButton.tsx
export function CancelOrderButton({ order, onCancel }: { order: Order; onCancel: () => void }) {
  const ability = useAppAbility();
  const { t } = useTranslation();
  const reasonId = useId();
  if (!allows(ability, 'orders.cancel', order)) return null; // 1. not permitted: not rendered
  const blocked = order.actions.cancel?.enabled === false; // 2. no entitlement on this key; 3. record state
  return (
    <div>
      <button type="button" aria-disabled={blocked} aria-describedby={blocked ? reasonId : undefined}
        onClick={blocked ? undefined : onCancel} className="bg-primary text-primary-foreground">
        {t('orders.cancel')}
      </button>
      {blocked && <p id={reasonId} className="text-muted-foreground">{t(`orders.reasons.${order.actions.cancel?.reasonCode}`)}</p>}
    </div>
  );
}
```

`aria-disabled` (not `disabled`) keeps the control focusable, so the user can still reach it and its
reason. The rest of the ARIA contract belongs to `std-accessibility`. A control locked by a missing
entitlement has the same shape, with the upgrade or "ask" line from `role-based-ux.md`.

## Navigation — areas with sections, filtered before anything is built

The rules this config serves — areas only in the global sidebar, sections in the area's layout, the
budgets, the one-area role — are `@skills/ui-ux-patterns/references/drill-down-navigation.md`. One
config serves every React stack:

```ts
// src/lib/nav.ts
import { allows, type AppAbility, type PermissionKey } from '@/lib/ability';

// Labels are i18n keys. Icons are names, not components, so the config can cross into a Client Component.
export interface Section { key: string; label: string; href: string; permission: PermissionKey }
export interface Area {
  key: string;
  label: string;
  icon: string;
  href: string; // the area's landing: its overview, or its first section's list
  permission: PermissionKey; // the key that landing authorizes with
  entitlement?: string; // a plan-locked area shows one locked entry, not a padlock per section
  match?: string[]; // extra route prefixes the area owns, e.g. flat member routes
  group?: string; // optional static group label key: never a link, never collapsible
  sections?: Section[]; // rendered ONLY by the area's own layout, never in the global sidebar
}
export type VisibleArea = Omit<Area, 'sections'> & { sections: Section[]; locked: boolean };

export const NAV: Area[] = [
  { key: 'orders', label: 'nav.orders', icon: 'shopping-cart', href: '/orders', permission: 'orders.read',
    match: ['/shipments'] }, // one collection, no sections; a shipment's flat URL still marks Orders
  { key: 'approvals', label: 'nav.approvals', icon: 'check-circle', href: '/approvals',
    permission: 'orders.approve', entitlement: 'approvals' },
  { key: 'organization', label: 'nav.organization', icon: 'building', href: '/members', permission: 'members.read',
    sections: [
      { key: 'members', label: 'nav.members', href: '/members', permission: 'members.read' },
      { key: 'billing', label: 'nav.billing', href: '/billing', permission: 'billing.update' },
    ] },
];

// Filter first, then build. An area appears when its landing or any of its sections is permitted.
export function visibleNav(nav: Area[], ability: AppAbility, entitlements: readonly string[]): VisibleArea[] {
  return nav.flatMap((area) => {
    const sections = (area.sections ?? []).filter((section) => allows(ability, section.permission));
    const landingAllowed = allows(ability, area.permission);
    if (!landingAllowed && sections.length === 0) return []; // not permitted → not rendered
    const href = landingAllowed ? area.href : sections[0].href; // derived landing: never a page that denies
    const locked = !!area.entitlement && !entitlements.includes(area.entitlement);
    return [{ ...area, href, sections, locked }];
  });
}

const within = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

// aria-current for an area or a section link: 'page' on its exact URL, 'true' anywhere inside it.
export function areaState(pathname: string, item: Pick<Area, 'href' | 'match' | 'sections'>): 'page' | 'true' | undefined {
  if (pathname === item.href) return 'page';
  const prefixes = [item.href, ...(item.match ?? []), ...(item.sections ?? []).map((section) => section.href)];
  return prefixes.some((prefix) => within(pathname, prefix)) ? 'true' : undefined;
}
```

- **The layout runs `visibleNav` once** — the Next.js server layout, `AppLayout` in the Vite SPA,
  `MainTabs` in React Native — and hands plain data down. A nav-link molecule receives only `href`,
  `label`, `active` (the `areaState` value) and `locked`, never a key or the ability (the
  `atomic-design` skill's organism data-awareness rule).
- **The global sidebar renders `areas` only:** `group` as a static label (dropped for a one-area
  group); no `sections`, no `SidebarMenuSub`, nothing nested; nothing at all when `areas.length === 1`.
  The area layout renders `area.sections` as its section nav when two or more remain, and a command
  palette's "Go to" entries read the same output.
- **`areaState` matches whole path segments:** `/orders` is current on `/orders/4812`, never on
  `/orders-archive`, and `match` lets a flat member route mark its home area. Never
  `pathname.startsWith(href)`.
- **Row menus follow the same recipe:** drop unpermitted items, lock unentitled ones, disable
  state-blocked ones, and render no menu trigger when no items remain.

## Breadcrumbs, counts, and deep links

- **Breadcrumbs render the server's `ancestors`** (root → parent, already filtered by permission) —
  never a trail rebuilt from history, route params or the nav config. The list crumb's `href` carries
  that list's remembered query string.
- **Badges and overview counts show the API's scoped counts**, never a client-side total.
- **A deep link that returns 404 renders not found and never refetches `['me']`** — out-of-scope
  records are 404 by design; only a 403 means stale rules.
- The payload, the summary endpoint and search hits → `@skills/std-api-design/references/drill-down-resources.md`.

## Vite SPA

```ts
// src/api/me.ts
export const meQuery = queryOptions({
  queryKey: ['me'] as const,
  queryFn: async ({ signal }) => (await api.get<{ data: Me }>('/me', { signal })).data.data,
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: 'always', // a demoted user returning to the tab sees the change immediately
});

// src/router/require-permission.ts — a feature gate: the no-access page, never a silent redirect
export function requirePermission(key: PermissionKey) {
  return async () => {
    const me = await queryClient.query(meQuery); // warms ['me'] for the page's gates, within meQuery's staleTime
    if (!allows(buildAbility(me.permissions.rules), key)) throw new Response(null, { status: 403 });
    return null;
  };
}
// { path: 'billing', element: <Billing />, loader: requirePermission('billing.update') }
```

```tsx
// src/components/organisms/RouteError/RouteError.tsx — excerpt
const error = useRouteError();
if (isRouteErrorResponse(error) && error.status === 403) return <NoAccessPage />; // a feature reached by URL
if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />; // a record outside scope
```

- **`queryClient.query` replaces `ensureQueryData`,** deprecated for removal in TanStack Query's next
  major (TanStack — Prefetching & Router Integration). It honours `meQuery`'s `staleTime`
  (`{ ...meQuery, staleTime: 'static' }` keeps the old never-refetch behaviour); on a release without
  `query`, keep `ensureQueryData(meQuery)` until the upgrade.
- **A missing grant is a page, not a redirect** — a redirect to `/` explains nothing and discards the
  URL they followed (`@skills/ui-ux-patterns/references/role-based-ux-states.md`). Put
  `errorElement: <RouteError />` on the pathless route that wraps the pages inside `AppLayout`, so the
  shell and its sidebar stay.
- **Provide the ability in `AppLayout`; read it one component down.** `AppLayout` renders
  `<AbilityProvider rules={me?.permissions.rules ?? NO_RULES}>` around `AppShell`, the component
  that reads the areas and renders the sidebar and outlet. A context read "does not consider
  providers in the component from which you're calling `useContext()`" (React docs — useContext),
  so an `AppLayout` that also read the areas would get none — and under @casl/react 7 it throws.
  `NO_RULES` is a module constant so the memo holds; structural sharing keeps `rules` stable until
  the server sends new ones. The shape → `@skills/std-reactjs/references/routing-and-code-split.md`.
- **Pick the right check.** `<Can I="create" a="Order">` covers declarative type checks. Row actions
  call `allows`.
- **Treat a 403 from the API as stale rules:** the UI offered something the server refused. Add one
  branch to the existing interceptor (`@skills/std-reactjs/references/data-fetching.md`):
  `if (error.response?.status === 403) void queryClient.invalidateQueries({ queryKey: ['me'] });`.
  A 404 does not trigger this, because out-of-scope records return 404 by design.

## Next.js (App Router)

```ts
// src/lib/ability.server.ts
import 'server-only';
import { cache } from 'react';
import { getSession } from '@/lib/auth';
import { buildAbility } from '@/lib/ability';

export const getAbility = cache(async () =>
  buildAbility((await getSession())?.permissions.rules ?? []), // getSession() is memoized: no second /me call
);
```

```tsx
// app/(app)/layout.tsx — the app shell
export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const areas = visibleNav(NAV, await getAbility(), session.entitlements); // filtered on the server

  return (
    <AbilityProvider rules={session.permissions.rules}>
      {areas.length > 1 && <AppSidebar areas={areas} />}
      <main className="bg-background text-foreground">{children}</main>
    </AbilityProvider>
  );
}
```

```tsx
// app/(app)/(organization)/billing/page.tsx — a feature gate renders no access, never notFound()
export default async function BillingPage() {
  if (!allows(await getAbility(), 'billing.update')) return <NoAccessPage feature="nav.billing" />;
  return <BillingSettings />;
}
```

- **Filter on the server.** A denied area never reaches the HTML or the RSC payload. `AppSidebar` is
  the shadcn/ui `Sidebar` block on house tokens (built by the `nextjs-developer` agent) and receives
  only `areas`; the area layouts render the sections (`@skills/std-nextjs/references/navigation.md`).
- **`notFound()` is for records** the API answered 404 for. A role-conditional parallel slot is not a
  gate either: "Both slots render on the server, regardless of which one the layout returns" (Next.js
  docs — Parallel Routes); authorize in the data layer.
- **Pass plain rules, not the Ability.** `AbilityProvider` rebuilds the Ability for client leaves.
- **After a server action changes a role**, call `revalidatePath('/', 'layout')` to rebuild the
  acting admin's sidebar (action shape → `@skills/std-nextjs/references/server-actions.md`). The
  *affected* user finds out through Realtime, below.
- **Keep proxy coarse** (`proxy.ts` on Next.js 16, `middleware.ts` before it): check that a session
  cookie exists, and nothing about permissions (`@skills/std-nextjs/references/middleware-seo-deploy.md`).

## React Native

```tsx
// src/navigation/MainTabs.tsx — rendered only once ['me'] has data, inside the AbilityProvider its parent
// screen renders from me.permissions.rules; one tab per visible area
const AREA_STACKS: Record<string, ComponentType> = { orders: OrdersStack, approvals: ApprovalsStack, organization: OrganizationStack };

export function MainTabs() {
  const ability = useAppAbility();
  const { data: me } = useQuery(meQuery);
  const { t } = useTranslation();
  const areas = visibleNav(NAV, ability, me?.entitlements ?? []);
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      {areas.map((area) => (
        <Tab.Screen key={area.key} name={area.key} component={AREA_STACKS[area.key]} options={{ title: t(area.label) }} />
      ))}
      <Tab.Screen name="account" component={AccountStack} options={{ title: t('nav.account') }} />
    </Tab.Navigator>
  );
}
```

- **Tabs are areas:** 3–5 including Account; a role with more than 4 work areas gets a More tab that
  opens a list screen; each tab owns one native stack → `@skills/std-react-native/references/navigation.md`.
- **An unregistered screen does not exist.** A deep link or push notification to it resolves as not
  found, instead of opening a screen whose first request fails. Keep one always-present screen
  (Account), because a navigator with no screens throws.
- **Refetch `/me` when the app returns to the foreground.** Wire `focusManager` to `AppState` once,
  at app scope:
  `AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'))`. The
  `refetchOnWindowFocus: 'always'` setting on `meQuery` does the rest.
- **Rules restored from a persisted MMKV cache are only a hint** until that refetch lands
  (`@skills/std-react-native/references/offline-and-mutations.md`). Rails still authorizes every
  request.

## Phlex

Components never call Pundit. The controller asks the policies and passes booleans down:
`policy(record)` for per-row flags, and `policy(:navigation)` for the nav. The headless
`NavigationPolicy` is defined in `@skills/std-rails-conventions/references/roles-and-permissions.md`.

```ruby
# app/controllers/orders_controller.rb
def index
  orders = policy_scope(Order).order(created_at: :desc)
  nav = policy(:navigation)
  render Views::Orders::Index.new(
    orders:,
    nav: { orders: nav.orders?, approvals: nav.approvals?, members: nav.members?, billing: nav.billing? },
    can_create: policy(Order).create?
  )
end
```

- **The global sidebar organism renders areas only.** An area renders when its landing flag or any
  of its section flags is true — Organization when `members` or `billing` is — and lists no sections.
- **The area layout renders its section nav** from its section flags, only when two or more are true.
- **Molecules receive only `href:`, `label:`, and `current:`** — `current:` is `"page"`, `"true"` or
  `nil`, computed with the same whole-segment rule as `areaState`
  (`@skills/std-phlex-conventions/references/navigation.md`).
- **An organism that calls `helpers.policy` has pulled authorization into the view layer**
  (`@skills/std-phlex-conventions/references/component-levels-composites.md`).

## Switching organization

The selected organization is client intent. It lives in the auth store (Zustand), and the axios
request interceptor sends it as the header Rails uses to resolve the membership. Switching
organizations changes the membership, so every organization-scoped cache entry is wrong at once:

```ts
export async function switchOrganization(organizationId: string) {
  useAuthStore.getState().setOrganizationId(organizationId); // which organization, not what it allows
  queryClient.clear(); // ['me'] and every org-scoped list go; nothing crosses the boundary
  await router.navigate('/'); // the loader refetches ['me'] and the landing page is re-derived
}
```

In Next.js the organization lives in the session cookie or the path. Set it in a server action, then
call `revalidatePath('/', 'layout')`.

## Realtime: a role change reaches the affected user

1. **Rails publishes after the change commits.** It bumps the member's permissions version and
   publishes the new `version` (never the rules) on that user's personal channel.
2. **The client compares versions.** If the event's version is newer than the cached `['me']`, the
   handler invalidates `['me']` (Vite SPA, React Native) or calls `router.refresh()` (Next.js, where
   the rules live in the server-rendered layout).
3. **The handler invalidates rather than patches,** because the event says only "something changed".

That rule, the single client, `getSubscription ?? newSubscription`, handler cleanup, and reconnect
invalidation are owned by `@skills/std-react-native/references/realtime-centrifugo.md`. The 403
branch catches anything the event misses.

## Per-role UI tests — one table, every role

```tsx
// src/components/templates/AppLayout/AppLayout.test.tsx
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { server } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import meByRole from '@/test/fixtures/me-by-role.json'; // exported by the Rails /me request spec: real rules, not a hand copy

const AREA_BUDGET = 7; // the area budget the project's IA review recorded (drill-down-navigation.md)

const cases = [
  { role: 'owner', areas: ['Orders', 'Approvals', 'Organization'] },
  { role: 'admin', areas: ['Orders', 'Approvals', 'Organization'] },
  { role: 'manager', areas: ['Orders', 'Approvals', 'Organization'] },
  { role: 'member', areas: ['Orders', 'Organization'] },
] as const;

describe.each(cases)('AppLayout navigation for $role', ({ role, areas }) => {
  it(`should render exactly the permitted areas when the caller is ${role}`, async () => {
    // Arrange
    server.use(http.get('*/api/v1/me', () => HttpResponse.json({ data: meByRole[role] })));
    // Act
    renderWithProviders(<AppLayout />);
    // Assert: findAll waits for ['me'], because until it arrives nothing is permitted
    const nav = await screen.findByRole('navigation', { name: /main/i });
    const rendered = await within(nav).findAllByRole('link');
    expect(rendered.map((link) => link.textContent)).toEqual(areas);
  });

  it(`should render areas only, within the recorded budget, when the caller is ${role}`, async () => {
    // Arrange
    server.use(http.get('*/api/v1/me', () => HttpResponse.json({ data: meByRole[role] })));
    // Act
    renderWithProviders(<AppLayout />);
    // Assert: no list nested under an area, and no role over the reviewed budget
    const nav = await screen.findByRole('navigation', { name: /main/i });
    expect(nav.querySelector('ul ul')).toBeNull();
    expect((await within(nav).findAllByRole('link')).length).toBeLessThanOrEqual(AREA_BUDGET);
  });
});
```

`AREA_BUDGET` is a review trigger, not a ceiling: a failing assertion starts the IA review, which
changes the IA or raises the constant in the same PR with a link to the review. Extend the table:

- **One area:** the viewer sees only Orders, so no area list renders. Wait for something that exists
  only once `['me']` has arrived (the user menu) before asserting it is absent — earlier, the check
  passes vacuously.
- **Section nav:** Organization's layout renders Members · Billing for the owner, and none for an
  admin, who keeps one section.
- **Feature gate:** a role without `billing.update` opening `/billing` sees the no-access page inside
  the shell, at the same URL.
- **Record state:** `ORDER_SHIPPED` → Cancel is `aria-disabled` and its reason is visible.
- **Plan:** without `approvals`, the Approvals area is visible and locked, only for roles holding
  `orders.approve`.
- **Palette:** where the product ships one, its "Go to" entries equal the role's visible areas and
  sections.

Supporting guides: the test harness and MSW → `@skills/std-testing/references/react-components.md`;
React Native → `@skills/std-testing/references/react-native.md`; Server Component gates →
`@skills/std-testing/references/nextjs-server.md`.

## Sources

- @casl/react — README — https://github.com/stalniy/casl/tree/master/packages/casl-react
- @casl/react — CHANGELOG (7.0.0) — https://github.com/stalniy/casl/blob/master/packages/casl-react/CHANGELOG.md
- Next.js docs — Parallel Routes — https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes
- Next.js docs — proxy.js — https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- React docs — useContext — https://react.dev/reference/react/useContext
- TanStack — Prefetching & Router Integration — https://tanstack.com/query/latest/docs/framework/react/guides/prefetching
