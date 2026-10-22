# /admin/offers

Admin CRUD for the staff-managed benefit offers (`offers` + `offer_packages`, personal-coupons D14/D23).
Shared rules live in the root AGENTS.md and CLAUDE.md; this file covers only what is specific to this folder.

## Map

- `page.tsx`: list (active and inactive), not paginated. `new/page.tsx`: create. `[id]/page.tsx`: edit + delete.
- `actions.ts`: `createOfferAction`, `updateOfferAction(id, ...)`, `deleteOfferAction(id, ...)`.
  The id actions are pre-bound with `.bind(null, id)` so the client gets `(prevState, formData)`.
- `offer-form.tsx`: shared client form for create and edit (`initial` absent means create).
- `[id]/delete-offer-form.tsx`: confirm-gated delete (`window.confirm`).
- Data layer: `src/lib/data/admin/offers.ts`. Schema: `offerSchema` / `OfferInput` in `src/lib/validation/admin.ts`.
  Pricing: `computeOfferOption` in `src/lib/offers/pricing.ts` (decimal.js, agorot precision).

## Authorization

- Not in the CASL pilot. Pages gate with `requirePlatformPermission('manage_billing')` as an optimistic
  early redirect; the real check is the first line of every exported function in the DAL.
- `actions.ts` has no gate of its own: it relies on `createOffer` / `updateOffer` / `deleteOffer` gating.
  Keep any new write going through a gated DAL function.
- `src/lib/auth/admin-data-layer-coverage.test.ts` pins `offers.ts` to `manage_billing`. Changing the key
  there without updating that test fails CI. The nav entry (`src/components/admin-shell.tsx`) uses the same key.
- `offers` / `offer_packages` have no grants to anon or authenticated. Every read and write uses
  `createAdminClient()` strictly after the gate.
- If this folder joins the CASL pilot, `src/lib/casl-pilot-static.test.ts` will scan it and forbid quoted
  permission keys, this file included.

## Form contract

- `packages` is edited as checkbox rows with an optional per-package override and sent as one hidden
  `packages_json` field. Malformed or missing JSON becomes `[]`, which `offerSchema` refuses (min 1 package).
- `agent_objections` is a textarea, one free value per line (D23). Never turn it into a closed list in code;
  `offerMatchesObjection` in `src/lib/data/agent-benefits.ts` matches by case-insensitive substring in
  either direction; an empty list matches any objection.
- `value_override` blank means "use the offer's value"; it is preprocessed to `null` before coercion.
- Floor rule (D14): every allowed package's final price must stay positive. The DAL is the single enforcement
  point (`assertPositiveFloors` throws `OfferFloorError`); the actions map it to `fieldErrors.value`.
  The form preview calls the same `computeOfferOption`, so preview and refusal cannot disagree.
- The form hides inactive packages unless the offer already allows them. The server does not refuse an
  inactive package, only a package id that no longer exists.
- Catch blocks call `unstable_rethrow(err)` first, so `redirect()` / `notFound()` are not swallowed.
- Create and delete `redirect('/admin/offers')`; update returns `{ notice }` and revalidates both paths.
- `deleteOfferAction` shows `err.message`. FK 23503 (a `coupon_assignments` row references the offer,
  ON DELETE RESTRICT) becomes the Hebrew "deactivate instead" message.

## Data invariants

- Assignments freeze the offer's terms (D3). Editing or deleting an offer must never write
  `coupon_assignments` / `coupon_assignment_options`.
- `updateOffer` replaces `offer_packages` by delete-then-insert, in separate statements (not one transaction).
  `createOffer` deletes the fresh `offers` row if the package insert fails.
- Every write records an activity row: `offer.created`, `offer.updated` (with `changedFields`), `offer.deleted`.
- Readers outside this folder: `allow_staff` + `is_active` feed `/admin/assignments`
  (`src/lib/data/admin/coupon-assignments.ts`); `allow_agent`, `agent_objections`, `may_replace` feed the
  sales agent (`src/lib/data/agent-benefits.ts`).

## Tests

Only `actions.test.ts` is colocated (node env). It mocks the DAL but keeps the real `OfferFloorError`
class, because the action maps it by `instanceof`. Pages and client forms have no tests here.
DAL behavior (gate order, floor, FK message, freeze) is in `src/lib/data/admin/offers.test.ts`.

```bash
npx vitest run "src/app/(admin)/admin/offers" src/lib/data/admin/offers.test.ts src/lib/offers/pricing.test.ts
```
