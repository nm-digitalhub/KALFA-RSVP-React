# verification-acceptance — spec §14 walked item-by-item (13.10.2026)

Status key: ✓ proven (test/SQL/browser run named). The browser rows (24, 26) are proven on a LOCAL `next dev` + local Supabase only ("✓ מקומי"); the deployed-build pass ("◻ פרוס") is still pending the owner's deploy — see verification-browser.md and task ה.2.

| # | בדיקה | סטטוס | ראיה |
|---|---|---|---|
| 1 | אין קריאה/כתיבה בלי manage_billing | ✓ | admin coverage test + gate tests: list/create/void/lookup/detail (coupon-assignments.test, detail.test) |
| 2 | שינוי מזהה אינו עוקף הרשאות | ✓ | detail: gate BEFORE existence; malformed id 404s before the reader ([id]/page.test) |
| 3 | קישורי חשבון/אירוע רק בהרשאותיהם | ✓ | cross-links permission-gated test ([id]/page.test) |
| 4 | חסר/שגיאה/ריק — שלושה מצבים | ✓ | list: empty/filtered-empty/error-with-retry (page.test); detail: section unavailable |
| 5 | assigned שפגה → פגה; consumed שפגה → מומשה | ✓ | display-status tests (11) |
| 6 | פגה עם תשלום פתוח: לא פנויה, לא ניתנת לביטול | ✓ | detail test (saved-terms sentence + held_by_payment); void RPC refuses expired as already_ended |
| 7 | סינון מעבר ל-200 | ✓ | SQL run: 305 rows, the oldest found by filter (rolled back) |
| 8 | חריגה גלובלית מחוץ לעמוד | ✓ | guard independent of page/filters (list tests) |
| 9 | שיוך לפי סבב; pending לא מסתיר succeeded | ✓ | guard join asserts outcome=succeeded only; detail attributes via rounds (tests) |
| 10 | מחירים לא משתנים אחרי שינוי הצעה/מחירון | ✓ | frozen options read-only from the table; stale-preview refusal; replay returns SAVED options |
| 11 | שתי חבילות באותו שם — לפי מזהה | ✓ | detail matches the chosen package by package_id (test) |
| 12 | בקשה חוזרת מחזירה אפשרויות מקוריות | ✓ | SQL replay returns stored; TS 'existing' reads stored options (tests + SQL run) |
| 13 | שינוי בין תצוגה לאישור → רענון ואישור מחדש | ✓ | in-transaction 'terms changed' (SQL) + TS pre-check + UI message (tests) |
| 14 | לקוח מעבר ל-1,000 ניתן לאיתור | ✓ | one indexed SQL lookup (migration 20261013000428); no page cap exists |
| 15 | כפילות מדווחת ומפנה להקצאה שנשארה | ✓ | duplicate_kept navigation to keptAssignmentId (action tests + SQL duplicate run) |
| 16 | כשל באפשרויות/אירוע לא משאיר הקצאה חלקית | ✓ | forced-failure SQL run: 0 rows (verification-d-4-5 + ד.2 run) |
| 17 | כשל ביטול לא משאיר שחרור בלי ביטול | ✓ | forced post-release failure: fully restored (SQL run) |
| 18 | לחיצה כפולה — הקצאה/ביטול אחד | ✓ | two-connection double submit (create: 1 row; void: 1 event) |
| 19 | ביטול מול bind/approve/payment בשני חיבורים | ✓ | verification-d-4-5: void-vs-bind run; payment window structurally closed; approve=locked round refusal |
| 20 | סדר נעילות אחיד; release תוקן קודם | ✓ | verification-d-1 + migration 20261013001452 |
| 21 | תשלום שנפתח בתוקף שומר תנאים | ✓ | the saved-terms sentence + no re-pricing anywhere (detail test) |
| 22 | החזר אינו משחרר consumed | ✓ | consumed beats expiry (mapper) + detail healthy-shape test |
| 23 | מצב שהשתנה מאז פתיחת החלון | ✓ | RPC re-decides under locks (ד.6); a state-driven refusal is answered on the detail page with the new state's message + refreshed details, list filters kept (action + page tests; browser: concurrent void while the dialog was open); terms drift on assign refreshes the preview and asks to re-confirm (browser) |
| 24 | מובייל 360/390, דסקטופ, RTL, מקלדת, הגדלה | ✓ מקומי · ◻ פרוס | verification-browser.md — list/new/detail/dialog at 360, 390, 1440; reflow at 320px (≈400% zoom, simulated by viewport); keyboard + dialog focus; no overflow, no console errors. Local `next dev`, not the deployed build |
| 25 | typecheck, בדיקות ובנייה | ✓ | lint+tsc clean; full suite 12,343+; build — rerun below with this change |
| 26 | צילומי בדיקה עם נתוני בדיקה בלבד | ✓ מקומי · ◻ פרוס | verification-screenshots/ (10 files) — local test accounts/offers only (`*@local.test`), masked phone format |
