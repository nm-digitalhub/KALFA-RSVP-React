# verification-browser — task ה.2 (acceptance 24 + 26), run 13.10.2026

## Where this pass ran — and where it did not

Not on the deployed site. The apply directive forbids deploying and touching the remote
database, and the authenticated admin screens only exist behind a login, so the pass ran
on a **local `next dev`** against the **local Supabase stack**:

- `next dev -p 3005 -H 127.0.0.1`, isolated build directory `.next-local-e2e` (git-ignored by
  `/.next-*/`); the pm2 `kalfa-beta` server on 3002 and its `.next` were not touched.
- Supabase local stack (`supabase start`), DB `127.0.0.1:54322`, API `127.0.0.1:54321`.
- Every variable that `.env.local` defines was exported EMPTY in the dev server's shell
  (Next.js never overrides what the shell already has), then only the local values were
  set — no production Supabase, Slack, WhatsApp, SUMIT, ElevenLabs, Resend or Meta
  credential, and the direct-DB variables (`SUPABASE_DB_*`, used by pg-boss) point at the
  local database. Measured: the only non-local connection of the process was a Next.js
  version check against `registry.npmjs.org`.
- Headless Chrome 155 on the server, driven over the DevTools protocol; it browsed only
  `http://127.0.0.1:3005`.
- Disclosure: the FIRST dev-server launch of the session overrode only the three Supabase
  variables, so it inherited the production direct-DB and sender variables from
  `.env.local`. It was stopped, before any write action, when the review caught it, and
  relaunched sanitized as above. Its outbound connections were not measured. It had only
  served the list page and a login against the local Auth.
- An existing `tailscale serve` rule maps `https://<host>.ts.net:3005` to `127.0.0.1:3005`,
  so while the dev server ran it was also reachable from the owner's tailnet (private,
  local test data only). It is stopped.

Because it ran on `next dev` (not a production build, not the deployed host), the owner may
want to repeat a short smoke pass after their own deploy. Nothing below depends on it.

## Test data

All created through the real screens/RPCs on the local DB: customer
`e2e-customer@local.test` (local Auth admin API), staff `e2e-admin@local.test` (owner role),
offer "הצעת E2E · 10%" over a v4-id package. Four assignments were created through
`/admin/assignments/new` and voided: two by the dialog's own success path (360px, one of
them opened with list filters in the URL), two by a concurrent RPC void issued while the
dialog was open (the refusal path). Residue stays in the local DB only (users, one
offer/package pair, assignments + their events — events are insert-only by design). No
existing local user email was typed into the lookup.

## What was walked

| Screen / state | 360 | 390 | 320 (zoom ≈400%) | desktop 1440 |
|---|---|---|---|---|
| List (`/admin/assignments`) — cards on mobile, table on desktop | ✓ | ✓ | ✓ | ✓ |
| New, step 1 (account lookup) + step 2 (found card, offer, preview) | ✓ | ✓ | ✓ | ✓ |
| Detail (after create, after void, after refusal) | ✓ | ✓ | ✓ | ✓ |
| Void dialog (open, empty reason, Esc, Tab loop, submit) | ✓ | – | – | ✓ |

- "No horizontal overflow" = `documentElement.scrollWidth` equals the viewport width at each
  width (list also checked for stray elements wider than the viewport). RTL: `dir=rtl`
  on the document, visual order checked in the screenshots.
- **Zoom** was simulated by viewport emulation at **320 CSS px**, the width a 1280px window
  has at 400% browser zoom (WCAG 1.4.10 reflow). A headless browser has no real Ctrl+ zoom.
- Keyboard: Tab order on the list filters follows the RTL reading order and the focus
  outline is visible; in the dialog the focus enters on the reason field, two Tabs
  return to the reason field (focus never left the dialog), Esc closes it and the focus returns to the
  "ביטול ההטבה" trigger, the submit button is disabled while the reason is empty.
- No console errors or warnings on any screen.
- Screenshots: `verification-screenshots/` (10 files, local test data only; phone numbers
  are the masked form).

## Findings and what was done

Fixed in this change (1 and 4 have automated tests; 2 and 3 live in a client component and
were verified in the browser run above):

1. **A claimed account whose name/email could not be resolved showed "—"**, which reads as
   "no customer". Now says "חשבון — הפרטים אינם זמינים" (list, table and cards). The trigger
   locally is a fixture artifact (the 135 SQL-inserted test users have NULL token columns,
   so the local GoTrue answers `getUserById` with 500), but a failed lookup must never look
   like "no customer".
2. **After a server refusal, the offer `select` snapped back to the placeholder** (React
   resets a form's fields when its action settles) while the preview and the submit button
   stayed as if chosen — a second click would send an empty offer. The select is re-synced
   to the chosen offer after every action result.
3. **After "תנאי ההצעה השתנו" the preview kept the OLD prices**, so re-confirming would be
   refused again forever. The form now refreshes the server data after a refusal; the
   preview shows the current terms (verified: 180.00/200.00 → 180.90/201.00 after a price
   change under the open form; the second confirmation then created the assignment).
   Matches spec §8 ("לרענן את ההצעה ולהציג תנאי ההצעה השתנו…").
4. **Void outcome messages vanished with the dialog.** A refusal because the state moved
   (e.g. already cancelled by someone else) replaces the actions section, so the dialog —
   and its error — unmounted; a successful void left the stale green "ההטבה הוקצתה."
   banner from the URL. Both outcomes now redirect to the detail page with a closed-code
   notice: `?notice=void_refused_<code>` (amber "הביטול לא בוצע. … המצב המעודכן מוצג כאן.")
   or `?notice=voided` ("ההטבה בוטלה."), keeping the validated list filters
   (`status/sort/page/q/offer/source`; unknown keys and malformed values are dropped).
   This is spec line 268 of the owner's brief ("הודעה על המצב החדש ורענון הפרטים").
   **Refinement of my own spec scenario "State changed since the dialog opened"**: it said the
   typed reason is kept on the failed form. A state-driven refusal always means the void
   action is no longer available, so that form no longer exists; the reason is kept only
   for validation/unexpected errors, where the dialog stays. The scenario and ד.6 text were
   updated to say so.

Recorded, not changed (minor or environmental):

- The list's offer filter shows ~50 identical "הצעת בדיקה" entries (local fixtures);
  same-titled offers cannot be told apart there. Cosmetic; production titles are distinct.
- The four pre-existing staff-assignable fixture offers use non-RFC UUIDs (`ffffffff-0000-…`)
  from the earlier SQL race tests; `z.uuid()` refuses them ("נא לבחור הצעה"), as it should.
  The pass used an offer/package created with real v4 ids.
- Local-stack gotcha: `.env.local` defines `SUPABASE_DB_PORT=5432` (pg-boss session mode
  against production). The CLI (v2.120.0) lets that variable override `[db] port` in
  `config.toml`, so `supabase start` tried to bind host port 5432 (taken by the system
  PostgreSQL) and failed with "address already in use". Starting the local stack needs
  `SUPABASE_DB_PORT=54322` in the shell. Nothing was reset or deleted; the volume survived.
