# /admin/assignments

Staff screens for personal benefits (`coupon_assignments`, personal-coupons admin-panel change):
list, staff assign, detail and void. Shared rules live in the root AGENTS.md and CLAUDE.md;
this file covers only what is specific to this folder. Offers themselves are edited in `../offers`.

## Map

- `page.tsx`: list. Filters, sort and pagination (25 per page) are URL params applied in SQL by
  the `admin_list_coupon_assignments` RPC. Also shows the global exception (guard) count.
- `new/page.tsx` + `new/assign-form.tsx`: two-step assign. Step 1 is a GET form (`?email=`) resolved
  on the server; step 2 (offer choice + preview) renders only when the account was found.
- `[id]/page.tsx`: detail, every section from `getStaffAssignmentDetail`. `[id]/void-dialog.tsx`: void.
- `actions.ts`: `createAssignmentAction`, `voidAssignmentAction(assignmentId, listSearch, ...)`
  (pre-bound with `.bind(null, assignmentId, listSearch)`).
- `list-params.ts`: the whitelist of list params carried to the detail page and back.
- `void-refusals.ts`: the closed set of void refusal codes and their Hebrew text.
- Data layer: `src/lib/data/admin/coupon-assignments.ts`. Display status: `src/lib/offers/assignment-display-status.ts`.

## Authorization

- Pages gate with `requirePlatformPermission('manage_billing')` as an optimistic early redirect. The real
  check is the first line of every exported DAL function; `actions.ts` has no gate of its own.
- `src/lib/auth/admin-data-layer-coverage.test.ts` pins `coupon-assignments.ts` to `manage_billing`.
- Detail page: the gate runs before the id is checked, so an unknown id is a 404 only for permitted staff.
  Links to the user and the event render only if the viewer also has `manage_staff` / `view_events`
  (`hasPlatformPermission`).

## Money and assign rules

- The browser never sends a price. It sends an email, an offer id, an idempotency key and
  `confirmed_terms`: the preview it was shown (`AssignableOffer.rawOptions`), echoed back as JSON.
- `createStaffAssignment` recomputes the terms with `computeOfferOption` and refuses with
  "תנאי ההצעה השתנו" if the echo differs (compared in whole agorot). The RPC
  `create_staff_coupon_assignment` checks again under locks, in one transaction.
- The idempotency key is a `randomUUID()` minted per render of `new/page.tsx`. A replay returns
  `outcome: 'existing'` with the stored terms, never today's computation.
- Duplicate rule (D18): an identical option set for the same account keeps one row and voids the other.
  The action redirects to `keptAssignmentId` with `notice=created|existing|duplicate_kept`.
- On a create or void failure the action calls `refresh()` so the page re-reads the current state.
- Account lookup is exact email via the `admin_lookup_account_by_email` RPC. found, not_found and
  unavailable are three different messages; a lookup failure must never read as a missing account.

## Void

- Reason is required, 1 to 500 chars (checked in the action and again in the DAL).
- `void_staff_coupon_assignment` decides under locks. A refusal redirects to the detail page with
  `notice=void_refused_<code>`; only codes in `VOID_REFUSALS` ever reach the URL.
- Keep in step: `VoidRefusal` in the DAL, `VOID_REFUSALS` here, and `BLOCK_REASON_TEXT` in
  `[id]/page.tsx` (that one maps `allowedActions.blockReason`, which uses `consumption_exception`).

## URL params

- Never pass a free return URL. `listBackHref` / `detailSearch` rebuild the query from `PATTERNS` in
  `list-params.ts` only; unknown keys are dropped.
- The allowed values live in three places that must stay in step: `PATTERNS` (`list-params.ts`),
  `normalizeFilters` (DAL) and `STATUS_OPTIONS` / `SORT_OPTIONS` (`page.tsx`).
- A list fetch failure renders an error with retry, never an empty list. A failed guard check says
  the check is unavailable, never "no exceptions".

## Tests

Colocated: `actions.test.ts`, `page.test.tsx`, `new/page.test.tsx`, `[id]/page.test.tsx` (node env;
pages render with `renderToStaticMarkup`). All mock the DAL and `server-only`; page tests also mock
`@/lib/auth/dal` and `next/link`. `actions.test.ts` makes `redirect` throw `REDIRECT:<target>` and
`unstable_rethrow` a no-op. The client components (`assign-form.tsx`, `void-dialog.tsx`) have no tests;
the page tests replace them with markers.

```bash
npx vitest run "src/app/(admin)/admin/assignments" src/lib/data/admin/coupon-assignments.test.ts src/lib/data/admin/coupon-assignment-detail.test.ts src/lib/offers/assignment-display-status.test.ts
```
