# Visual Findings — /chrome pass (main session, Browser 2, logged in as admin@nm-digitalhub.com, desktop ~1440–1512px)

_Structure only — colors intentionally excluded per instruction. These are runtime-observed on beta.kalfa.me and corroborate the code fragments._

## Pages captured (desktop)
1. `/` landing · 2. `/app` dashboard · 3. `/app/events` · 4. `/app/events/[id]` detail · 5. `/app/events/[id]/guests` · 6. `/app/settings` · 7. `/app/team` · 8. `/admin` dashboard · 9. `/admin/users`

## Shell confirmations
- **AppShell & AdminShell render near-identically:** right-side sidebar (RTL), sticky top header, account control at header inline-start = avatar initial + email + chevron → dropdown; content centered `max-w-5xl`. Customer header adds a search field + org switcher ("הארגון שלי"); admin header shows "אזור ניהול" and a longer nav. Desktop sidebar permanently expanded; hamburger only < md. → **strongest extract candidate: one shared AppShell + a shared AccountMenu/UserMenu.**
- Account/user menu is visually identical in both shells.

## Layout patterns observed (the app's whole vocabulary)
- **Stat-card row:** dashboard (3 cards), guests (4 tiles), admin dashboard (4 cards), landing hero preview. Same card, re-implemented per page → extract `StatCard`/`StatTile`.
- **List as card-rows (NOT tables):** events list, team members, admin/users, admin activity feed, dashboard "recent events". Each row = title + meta + status chip(s) + trailing action(s). → extract `ListRow`/`RowCard`.
- **The ONLY wide data `<table>` in the product = the guests desktop table** (7 cols, → mobile cards < lg). admin/users is card-rows, not a table. Confirms code: no other page risks table overflow.
- **Two-column + in-page nav:** `/app/settings` = content cards on one side, a sticky section-nav card ("פרופיל/התראות/חיוב/אבטחה/חשבון") on the other. Unique; candidate `SettingsLayout`/`SectionNav`.
- **Stacked section cards:** event detail = several full-width section cards (status/close, RSVP/campaign, edit form).
- **Marketing page:** landing has its own header (logo + nav + "לאזור האישי") and hero with a fake product-preview card — page-specific, no app shell.

## Component confirmations (structure)
- **Status chips are everywhere and inconsistent in weight** (outline pill vs soft pill), across event status, campaign status, guest RSVP/messaging status, member role/status, admin activity types, user role/orgs. → confirms need for ONE shared `Badge`/`StatusChip` (states, not colors).
- **Hand-rolled checkboxes** on `/app/settings` notifications (no `ui/checkbox`) — confirms missing primitive.
- **Forms consistent:** label above field, single primary submit (full-width on mobile via shared `SubmitButton`), destructive actions as a distinct button (e.g. team "הסרה", event "סגירת האירוע", guest "מחיקה").
- **Search + filter bar** (guests) is the richest control cluster; admin lists use a simpler single search + button.

## RTL
- Correct throughout at runtime: sidebar on the right, text right-aligned, controls mirrored, no visible LTR leakage — matches code fragments (zero physical-direction Tailwind classes found by the agents).

## Not visually captured (covered by code fragments; browser deferred)
- `/app/orders`, `/app/orders/[id]/pay`, campaign flow (`/campaign/[campaignId]` + approve + payment), admin catalog/config tables, auth pages (redirect while logged in), public `/r/[token]` RSVP (needs a live token) & `/join/[token]`. Mobile breakpoints not screenshot-verified (resize unreliable on this host); mobile behavior taken from code (`lg`/`md` breakpoints, cards-vs-table).
