# Tasks

Stages follow the spec's §15 order. After every stage: lint, `npx tsc --noEmit`, the
touched suites; the full suite + build before the final commit of the change. Reading
AGENTS.md's Next.js docs note applies before UI work.

## Stage א — data layer

- [x] א.1 The unified display-status mapper (state + expires_at + history reason →
  label), shared by list and detail. Verify: unit tests covering every row of the
  spec's §5 table, incl. expired-assigned → פגה and consumed-past-expiry → מומשה.
- [x] א.2 listStaffAssignments(filters, pagination): SQL-side q (exact normalized
  email/phone), status, source, offer, sort (+id tiebreak), 25/page, total of the
  filtered set; rows slim to list fields; email resolution not serial-per-row. Verify:
  tests for filter beyond 200 rows, out-of-range page correction, invalid-param
  normalization, fetch-failure shape.
- [x] א.3 The global guard via pricing_round_id (AD4): globalGuardCount +
  guardCheckStatus, independent of page/filter; the ranking stays display-only.
  Verify: tests — exception off-page found; pending does not mask succeeded; failed
  check reported as unavailable, not zero.
- [x] א.4 getStaffAssignmentDetail(id) (AD5): all sections, package matching by
  package_id, payment attempts via pricing_round_id, history ordered at,id with
  actor labeling rules, allowedActions display-only, section-level failure markers.
  Verify: tests incl. missing-options warning, unknown-action event rendering,
  historical consumption visible after release, refund shown without releasing a
  consumed assignment.
- [x] א.5 Idempotent replay answers the SAVED assignment+options and refuses a
  same-key/different-request replay (AD7; final enforcement moves into the create
  function in ד.2 — this task shapes the read path and messages). Verify: test —
  retry after a price change returns the frozen options; mismatched replay refused.

## Stage ב — list + detail screens

- [x] ב.1 /admin/assignments rewritten on א.2/א.3: concise table (desktop) / cards
  (mobile, no 64rem min-width), filters/search/sort/pagination in the URL, the
  "דורש בדיקה" entry when exceptions exist, honest empty/filtered-empty/error states,
  no green banner on every load. Verify: component tests per state; params round-trip.
- [x] ב.2 /admin/assignments/[id] (new page) rendering א.4: header, recipient, terms +
  source (callback linkage only when resolvable), frozen options table / mobile
  blocks, binding + payments (incl. the expired-but-open-payment sentence), history,
  copyable id. Permission-gated links (AD10). Verify: component tests per section,
  not-found after permission check, partial-failure rendering.
- [x] ב.3 List→detail→back navigation preserving validated filters (AD1). Verify: test
  that a crafted return param outside the list is rejected.

## Stage ג — assign flow (UI)

- [x] ג.1 lookupStaffAssignmentRecipient (AD6) + the account step in
  /admin/assignments/new: exact validated email, איתור חשבון → confirm card with the
  account's active benefits; found/not_found/unavailable distinct. Verify: test that a
  user beyond the provider page limit is found; failure ≠ not-found.
- [x] ג.2 Explicit offer choice (no silent default), server-computed preview, estimated
  validity labeled as such; the submitted request carries the confirmed preview terms
  for ד.2's in-transaction validation, and a refusal renders "תנאי ההצעה השתנו" with a
  re-confirm. Verify: tests for the stale path and the explicit-choice requirement.
- [x] ג.3 Submit: stable idempotency key per operation, double-submit blocked
  client-side (the server guarantee is ד.2/ד.4), success and duplicate-kept navigate
  to the resulting assignment's detail with the spec's messages. Verify: tests —
  replay message, duplicate-kept points at the KEPT row.

## Stage ד — atomic write paths

- [x] ד.1 Lock-order audit: release_coupon_assignment, bind_coupon_assignment and
  replace_sales_coupon_assignment vs the campaign→round→assignment order (acceptance
  20); fix release first if it assumes another order. Verify: documented reading of
  the function sources recorded in this change.
- [x] ד.2 Migration via `npx supabase migration new`: create_staff_coupon_assignment
  (service_role-only, SECURITY DEFINER, empty search_path) — ONE transaction: offer +
  packages locked for share, confirmed-preview terms re-validated against live prices
  (refuse "terms changed"), assignment + ALL frozen options + the 'assigned' event
  inserted together, idempotency bound to target+offer (mismatched replay refused;
  same-request replay answers the STORED assignment and options), the duplicate rule
  (keep later-expiring, void+event for the loser) inside the transaction. The TS
  delete-on-partial-failure compensation is retired. Verify: SQL checks on the local
  DB — forced failure at each step rolls back everything (acceptance 16); grants
  refused to browser roles.
- [x] ד.3 Migration via `npx supabase migration new`: void_staff_coupon_assignment —
  live re-checks under locks, release+state+event in one transaction, staff reason to
  meta.staff_reason, no-op never answers success, repeat void writes no second event.
  Verify: SQL checks incl. rollback-on-late-failure after the release step
  (acceptance 17); grants refused to browser roles.
- [x] ד.4 Create concurrency on the local DB, two real connections: double submit
  yields one assignment+one event with both callers answered by it (acceptance 18);
  create vs offer/price edit serializes — previewed terms commit whole or refuse
  (part of 19). Verify: recorded run like the replacement RPC's proof.
- [x] ד.5 Void concurrency on the local DB, two real connections: void vs
  bind/approve/open-payment/settlement — one winner, zero partial writes (acceptance
  19). Verify: recorded run.
- [x] ד.6 The void dialog on the detail page (AlertDialog, required reason, danger
  styling, focus kept/returned), wired to ד.3; a state changed since the dialog
  opened refuses, refreshes the view and keeps the typed reason (acceptance 23).
  Verify: component tests; action tests for every refusal code.

## Stage ה — closure

- [x] ה.1 Permission acceptance (§14 1–3): no manage_billing → no list/detail/lookup/
  assign/void; id tampering never bypasses; links only with their own permissions.
  Verify: the admin coverage test stays green + targeted tests.
- [ ] ה.2 **BLOCKED on the deploy (the apply directive forbids deploying; the authenticated admin screens are reachable only on the deployed build).** Browser pass at 360/390/desktop, RTL, keyboard, zoom (acceptance 24) on the
  deployed build; record findings with real test data only (acceptance 26). Verify:
  noted in this change.
- [ ] ה.3 **Gates DONE on the final state (lint, tsc, suite 12,343, build OK) and the acceptance walk recorded in verification-acceptance.md (24/26 proven); the checkbox waits only for ה.2's two browser items.** Full gates (lint, tsc, full suite, build) + the acceptance mapping below
  walked item-by-item, each outcome recorded in verification-acceptance.md
  (acceptance 25). Verify: all green before the change is offered for archive.

## Acceptance mapping (spec §14 → tasks)

| # | בדיקת קבלה | משימות |
|---|---|---|
| 1 | אין קריאה/כתיבה בלי manage_billing | ה.1 |
| 2 | שינוי מזהה בכתובת אינו עוקף הרשאות | ב.2, ה.1 |
| 3 | קישורי חשבון/אירוע רק בהרשאותיהם | ב.2, ה.1 |
| 4 | חסר/שגיאה/ריק — שלושה מצבים שונים | א.4, ב.1, ב.2 |
| 5 | assigned שפגה → פגה; consumed שפגה → מומשה | א.1 |
| 6 | פגה עם תשלום פתוח אינה פנויה ואינה ניתנת לביטול | א.4, ב.2, ד.3 |
| 7 | סינון מוצא הקצאה מעבר ל-200 | א.2 |
| 8 | חריגה גלובלית מחוץ לעמוד הנוכחי | א.3 |
| 9 | שיוך תשלום לפי סבב; pending לא מסתיר succeeded | א.3, א.4 |
| 10 | מחירים לא משתנים אחרי שינוי הצעה/מחירון | א.4, ג.2 |
| 11 | שתי חבילות באותו שם מזוהות לפי מזהה | א.4 |
| 12 | בקשה חוזרת מחזירה אפשרויות מקוריות | א.5, ד.2 |
| 13 | שינוי הצעה בין תצוגה לאישור → רענון ואישור מחדש | ג.2, ד.2 |
| 14 | לקוח מעבר ל-1,000 ניתן לאיתור | ג.1 |
| 15 | כפילות מדווחת ומפנה להקצאה שנשארה | ג.3, ד.2 |
| 16 | כשל באפשרויות/אירוע לא משאיר הקצאה חלקית | ד.2 |
| 17 | כשל ביטול לא משאיר שחרור בלי ביטול | ד.3 |
| 18 | לחיצה כפולה לא יוצרת שתי הקצאות/שני ביטולים | ד.4, ד.6 |
| 19 | ביטול מול bind/approve/payment בשני חיבורים אמיתיים | ד.4, ד.5 |
| 20 | סדר נעילות אחיד; תיקון release לפני | ד.1 |
| 21 | תשלום שנפתח בתוקף שומר תנאים אחרי תפוגה | א.4, ב.2 |
| 22 | החזר אינו משחרר consumed | א.1, א.4 |
| 23 | מצב שהשתנה מאז פתיחת החלון → סירוב ורענון | ד.6 |
| 24 | מובייל 360/390, דסקטופ, RTL, מקלדת, הגדלה | ה.2 |
| 25 | typecheck, בדיקות ובנייה עוברים | ה.3 |
| 26 | צילומי בדיקה עם נתוני בדיקה אמיתיים בלבד | ה.2 |
