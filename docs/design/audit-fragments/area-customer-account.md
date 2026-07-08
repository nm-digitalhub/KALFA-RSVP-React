# Area: Customer — Account (settings, team, admin-access)
_Files read: 3 pages, 3 co-located client components (+ 3 co-located actions.ts + `@/components/forms.tsx` + a targeted read of `@/lib/data/orgs.ts` DTO shapes for accuracy)._

## 1. Inventory Rows
| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| `/app/settings` | `src/app/(customer)/app/settings/page.tsx` | Server | AppShell | Loads profile/settings/orders, renders client page |
| `/app/settings` | `src/app/(customer)/app/settings/settings-client.tsx` | Client | AppShell | Profile, notifications, billing snapshot, security, account/email-change UI |
| `/app/team` | `src/app/(customer)/app/team/page.tsx` | Server | AppShell | Loads org members/invitations/roles + permission gate |
| `/app/team` | `src/app/(customer)/app/team/team-client.tsx` | Client | AppShell | Invite form, member list, pending-invitation list |
| `/app/admin-access` | `src/app/(customer)/app/admin-access/page.tsx` | Server | AppShell | Admin-status branch: link to /admin, or claim-first-admin form |
| `/app/admin-access` | `src/app/(customer)/app/admin-access/claim-admin-form.tsx` | Client | AppShell | Single submit-only "claim admin" form |

No `loading.tsx`, `error.tsx`, or `not-found.tsx` files exist in any of the three route directories (confirmed via directory listing).

## 2. Design Briefs

### /app/settings
- **Route:** `/app/settings`
- **Page name:** הגדרות / Settings
- **Component type:** Server (`page.tsx`) → Client (`settings-client.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Central account-settings hub: profile, notification preferences, billing/orders snapshot, security (password reset), account (email change + metadata).
- **Primary user goal:** Update profile info and notification prefs; glance at recent orders; request a password reset or email change.
- **Main content sections:** Sticky anchor-nav sidebar (5 items) + 5 stacked `<section>` cards (`#profile`, `#notifications`, `#billing`, `#security`, `#account`).
- **Actions:** Save profile; save notification prefs; send password-reset email; request email change.
- **Forms / fields:**
  - Profile: `full_name` (text), `phone` (tel, `dir="ltr"`) — `updateProfileSchema`, server-returned `fieldErrors`.
  - Notifications: `event_updates`, `reminder_updates`, `billing_updates` (checkboxes) — `updateSettingsSchema`.
  - Security: no fields, submit-only (`sendPasswordResetAction` uses the session's own email).
  - Account/email-change: `new_email` (email, `dir="ltr"`) — `emailChangeSchema`; blocks same-as-current email, checked server-side.
- **Tables / lists:** `BillingSection` renders a `<ul>` of up to 3 recent orders (amount, date, status pill) — not a full table, no link to full order history.
- **Status states:** Order status via `ORDER_STATUS_LABELS[order.status]` (imported from `@/lib/constants`; enum values themselves not opened — **Needs verification** for the full status set).
- **Empty / loading / error states:** `loadError` boolean (page.tsx catches `requireUser`/`getProfile`/etc.) renders a hardcoded alert banner (`bg-red-50 text-red-700`, NOT the shared `FormError`) at the top of the client tree. Billing empty state = dashed-border box + `Receipt` icon + Hebrew text. No file-based `loading.tsx`/`error.tsx`.
- **Existing shared components used:** shared: `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`). No direct `@/components/ui/*` imports in this file (only indirectly via `SubmitButton` → `Button`).
- **Components that should be reused:** The `loadError` banner reimplements `FormError`'s alert styling with raw literal colors instead of importing `FormError`. `ToggleField` hand-rolls a checkbox toggle row; `ui/switch` is a shared primitive and is not used here.
- **Components that should be extracted:** `SectionTitle` (icon + title + description header, local to this file) is a clean reusable "settings section header" pattern used 5×. `ToggleField` (label+description+checkbox) is an extract candidate, ideally rebuilt on `ui/switch`.
- **Mobile considerations:** `grid gap-6 lg:grid-cols-[220px_1fr]` collapses to a single column below `lg` — anchor nav stacks above content, no fixed pixel widths found, all inputs `w-full`.
- **Desktop considerations:** Sidebar is `lg:sticky lg:top-24 lg:self-start`, fixed 220px column.
- **RTL considerations:** Phone/email inputs correctly force `dir="ltr"` + `text-start` for LTR-content fields embedded in the RTL form. No physical `left/right`/`ml-/mr-`/`pl-/pr-` classes found in the file.
- **Design risks:** `loadError` banner and order-status pill are ad hoc instead of using the shared `FormError`/a real Badge; `ToggleField` reinvents `ui/switch`; no "view all orders" affordance (hard-capped at 3, no pagination/link).
- **Recommended redesign scope:** Light

### /app/team
- **Route:** `/app/team`
- **Page name:** ניהול משתמשים / Team management
- **Component type:** Server (`page.tsx`) → Client (`team-client.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Org multi-tenancy member management: invite members, list current members with roles, manage pending invitations.
- **Primary user goal:** Invite a teammate; review/manage current members' roles; manage pending invites.
- **Main content sections:** `InviteForm` (rendered only if `canManage`), member list section, pending-invitations section (rendered only if `canManage`).
- **Actions:** Invite member; change member role; remove member; resend invitation; revoke invitation.
- **Forms / fields:**
  - Invite: `email` (email, required, `dir="ltr"`), `role_id` (select, required, excludes the owner role) — `inviteMemberSchema`.
  - Per-member inline role form: `role_id` select (`defaultValue`=current role) — `changeMemberRoleSchema`.
  - Per-member remove form: hidden `member_id` — `memberIdSchema`.
  - Per-invitation resend/revoke: hidden `invitation_id` — `invitationIdSchema`.
- **Tables / lists:** Two `<ul className="divide-y">` lists (members, invitations) — **not** an HTML `<table>`; each row is a `flex flex-wrap` block, so it already behaves like a card/list on narrow widths (no separate mobile fallback needed since there's no table to fall back from).
- **Status states:** Member row shows a hardcoded "פעיל" (Active) badge — no real status field backs it (**Needs verification**: is there ever an inactive/suspended member state?). Invitation row shows a hardcoded "ממתינה" (Pending) badge — no expired/accepted/declined states surfaced in this component. Role is real/data-driven: `member.roleLabel` / `invitation.roleLabel` (from `org_roles.label`, confirmed via `src/lib/data/orgs.ts`).
- **Empty / loading / error states:** "אין חברים עדיין" / "אין הזמנות ממתינות" plain-text empty states (no icon, no shared EmptyState). Per-row `FormError`/`FormNotice` shown inline below each row's inline forms. No file-based `loading.tsx`/`error.tsx`.
- **Existing shared components used:** shared: `FieldError`, `FormError`, `FormNotice` (`@/components/forms`). Notably **`SubmitButton` is NOT used** — a local `RowSubmit` is hand-rolled instead. No direct `@/components/ui/*` imports.
- **Components that should be reused:** `RowSubmit` duplicates `SubmitButton`'s pending-state pattern (`useFormStatus`) instead of extending it, and hardcodes button styling — primary variant re-implements `Button`'s default look, and the "danger" variant (`bg-red-50 text-red-700 hover:bg-red-100`) re-implements what `<Button variant="destructive">` (`@/components/ui/button`) already provides. The local `Badge` component duplicates the inline pill pattern also seen in settings' `BillingSection`.
- **Components that should be extracted:** Badge/status-chip — used 4× inline in this one file alone (member role, member "active", invitation role, invitation "pending") and again independently in settings — matches the spec's confirmed-missing "Badge" primitive exactly. `RowSubmit` should ideally fold into `SubmitButton` via a `variant` prop rather than living as a parallel implementation.
- **Mobile considerations:** Rows use `flex flex-wrap items-center justify-between gap-3` so they reflow at narrow widths; invite form grid `sm:grid-cols-[1fr_auto_auto]` collapses to one column below `sm`; no fixed pixel widths found.
- **Desktop considerations:** Invite form's email/role/submit align on one row at `sm:`+ via the grid-cols template.
- **RTL considerations:** Email fields correctly `dir="ltr"`; no physical `left/right`/`ml-/mr-` classes found.
- **Design risks:** **Destructive actions have no confirmation step** — `removeMemberAction` and `revokeInvitationAction` fire directly from a `RowSubmit variant="danger"` click, with no confirm dialog (and no Dialog primitive exists in the shared kit per spec, only `sheet`). The invite/resend success notice exposes the raw join link as plain text inside `FormNotice` with no copy-to-clipboard affordance. Hardcoded "פעיל"/"ממתינה" badges aren't sourced from a real status field, so the UI can't reflect richer invitation/member states if the data model grows.
- **Recommended redesign scope:** Medium (badge extraction, submit-button consolidation, confirm-before-destroy pattern for remove/revoke)

### /app/admin-access
- **Route:** `/app/admin-access`
- **Page name:** גישת ניהול / Admin access (claim)
- **Component type:** Server (`page.tsx`) → Client (`claim-admin-form.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Bootstrap page to claim the first-admin role via the `claim_first_admin()` RPC; shows a link into `/admin` if the user is already an admin.
- **Primary user goal:** Claim first-admin access, or navigate into `/admin` if already an admin.
- **Main content sections:** Single narrow column (`max-w-md`) — header + conditional block (already-admin link OR claim form).
- **Actions:** Claim first admin (redirects to `/admin` on success); navigate to `/admin` (plain `Link`).
- **Forms / fields:** None — the claim "form" is submit-only, no input fields (the RPC takes no args).
- **Tables / lists:** None.
- **Status states:** Implicit boolean (already-admin vs not) from `isAdmin()` — no explicit status enum.
- **Empty / loading / error states:** `FormError` only, from `claimFirstAdminAction` (generic "already exists" or "action failed" message — deliberately does not leak who/how many admins exist). No file-based `loading.tsx`/`error.tsx`.
- **Existing shared components used:** shared: `FormError`, `SubmitButton` (`@/components/forms`). No direct `@/components/ui/*` imports.
- **Components that should be reused:** n/a.
- **Components that should be extracted:** n/a — smallest, cleanest page in this area.
- **Mobile considerations:** `max-w-md` centered column, no fixed pixel widths beyond that cap; fits narrow viewports without issue.
- **Desktop considerations:** Intentionally stays capped at `max-w-md` even on wide screens (bootstrap/utility flow, not a dashboard page).
- **RTL considerations:** No physical `left/right` classes; plain Hebrew text, inherits `dir="rtl"` from root layout.
- **Design risks:** Minor only — the "מעבר לאזור הניהול" link and the claim `SubmitButton` are visually near-identical CTAs, but the link is a raw `<Link>` with inline utility classes (`rounded-md bg-primary px-4 py-2 ...`) instead of `<Button asChild>` wrapping the `Link`, so the two "primary CTA" surfaces on this page are styled from two different sources of truth.
- **Recommended redesign scope:** None

## 3. UI Elements Per Page

### /app/settings
- buttons: `SubmitButton` ×4 (profile save, notifications save, password-reset send, email-change send) — shared (`@/components/forms` → wraps `ui/button` default variant)
- inputs / selects / search / filters: `full_name`, `phone` (text/tel) — inline/local; 3× checkbox (`ToggleField`) — inline/local; `new_email` (email) — inline/local. No `ui/input`/`ui/select`/`ui/checkbox` used (checkbox has no shared primitive per spec; text/email inputs also hand-rolled rather than using `ui/input`).
- cards / tables / lists: 5× section "card" (`rounded-lg border border-border bg-card p-5`, inline/local, not `ui/card`); billing recent-orders `<ul>` — inline/local
- badges / status chips: order-status pill (`rounded-full border ... px-3 py-1`) — inline/local, not extracted
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: billing empty state (icon + text, inline); `loadError` top-of-page alert (inline, raw colors, not `FormError`)
- destructive actions: none on this page

### /app/team
- buttons: `RowSubmit` (local, NOT `SubmitButton`) ×5 usage sites (invite, per-member role-update, per-member remove, per-invitation resend, per-invitation revoke) — inline/local, hardcodes both its default and "danger" visual styles instead of using `ui/button` variants
- inputs / selects / search / filters: invite `email` input — inline/local; invite `role_id` select — inline/local; per-member `role_id` select — inline/local; hidden `member_id`/`invitation_id` inputs
- cards / tables / lists: `InviteForm` section card (inline/local `sectionClass`); member `<ul>` list; invitation `<ul>` list — none use `ui/card`, no `<table>` present
- badges / status chips: local `Badge` component, used 4× (role ×2, "active", "pending") — inline/local, not extracted, not the same markup as settings' order-status pill (duplication)
- dropdown menus / dialogs / sheets: none — notably absent for the destructive remove/revoke actions
- empty / loading / error UI: "אין חברים עדיין" / "אין הזמנות ממתינות" plain text (inline); per-row `FormError`/`FormNotice` (shared)
- destructive actions: **remove member**, **revoke invitation** — both fire immediately on click via `RowSubmit variant="danger"`, no confirmation step

### /app/admin-access
- buttons: `SubmitButton` (shared) for claim; `Link` styled as a button (inline/local classes) for "מעבר לאזור הניהול"
- inputs / selects / search / filters: none
- cards / tables / lists: none
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError` only (shared)
- destructive actions: none (claim is idempotent/safe — RPC refuses if an admin already exists)

## 4. Responsive & RTL Findings

### /app/settings: mobile-fit = yes; wide areas: none found (grid collapses to 1 col below `lg`, all inputs `w-full`, section max-widths on submit buttons only e.g. `max-w-44`/`max-w-48`); RTL risks: none — LTR fields (`phone`, `new_email`) correctly opt out with `dir="ltr"` + `text-start`, no physical-direction utility classes present.

### /app/team: mobile-fit = yes; wide areas: none found (rows are `flex flex-wrap`, invite form grid collapses below `sm`); RTL risks: none — `email` field correctly `dir="ltr"`, no physical-direction utility classes present. Note: this page's lists are already list/card-shaped, not a `<table>`, so there's no "desktop table / mobile card" split to check.

### /app/admin-access: mobile-fit = yes; wide areas: none (`max-w-md` cap); RTL risks: none — plain Hebrew, no physical-direction classes.

## 5. Duplications & Extract Candidates
- **Badge / status-chip pattern** → seen independently in `settings-client.tsx` (order-status pill, `rounded-full border border-border px-3 py-1`) and `team-client.tsx` (local `Badge`, `rounded-full border border-border px-2.5 py-0.5`) → two slightly different implementations of the same concept in one area. Suggest extract as `Badge` (matches spec's confirmed-missing primitive) with size/tone variants, then use it in both places.
- **Pending-aware submit button** → `settings-client.tsx`/`claim-admin-form.tsx` use the shared `SubmitButton`, but `team-client.tsx`'s `RowSubmit` reimplements the identical `useFormStatus`-driven pending pattern from scratch, plus adds ad hoc primary/danger color styling that duplicates `ui/button`'s `default`/`destructive` variants → suggest folding `RowSubmit` into `SubmitButton` via an optional `variant` prop (or use `SubmitButton` + `Button`'s existing `destructive` variant directly) so there is one pending-submit source of truth across the area.
- **Section "card" wrapper** → `sectionClass` is redefined independently in both `settings-client.tsx` and `team-client.tsx` with nearly identical Tailwind (`rounded-lg border border-border bg-card p-5` vs `space-y-4 rounded-lg border border-border bg-card p-5`) instead of both using `ui/card` → suggest standardizing on `ui/card` (or a shared `SettingsSection`/`Section` wrapper) across both pages.
- **Confirm-before-destroy** → no page in this area wraps a destructive form submit in any confirmation UI; `/app/team`'s remove-member and revoke-invitation are the only genuinely destructive actions in this area and both are one-click. Suggest a shared `ConfirmSubmit`/`AlertDialog`-style primitive once a Dialog primitive exists (spec confirms no Dialog exists today, only `sheet`).

## 6. Shared Components Referenced (from imports)
- from `@/components/ui`: none imported directly in any of the 3 pages/clients — `Button` is only pulled in indirectly through `SubmitButton` (`@/components/forms` → `@/components/ui/button`).
- from `@/components`: `forms.tsx` → `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (used across all three routes, though `team-client.tsx` skips `SubmitButton` in favor of a local `RowSubmit`).
- inline/local components defined in this area:
  - `settings-client.tsx`: `SectionTitle` (icon+title+description header), `ProfileSection`, `ToggleField` (checkbox toggle row), `NotificationsSection`, `BillingSection` (incl. inline order-status pill), `SecuritySection`, `AccountSection` (incl. email-change form + metadata `<dl>`), `SettingsPageClient` (top-level layout: anchor nav + sections).
  - `team-client.tsx`: `Badge` (status chip), `RowSubmit` (pending-aware submit button, primary/danger variants), `InviteForm`, `MemberRow`, `InvitationRow`, `TeamClient` (top-level layout).
  - `claim-admin-form.tsx`: `ClaimAdminForm` (submit-only form wrapper).
