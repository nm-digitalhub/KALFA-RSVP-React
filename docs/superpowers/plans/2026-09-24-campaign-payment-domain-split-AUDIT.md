# ביקורת שורה-אחר-שורה — `2026-09-24-campaign-payment-domain-split.md`

נכתב 2026-09-24 על ידי rls-schema-engineer. קריאה בלבד: כל טענה אומתה מול הריפו ומול ה-DB החי (`npx supabase db query --linked`, ללא כתיבה). תיוג: VERIFIED-LIVE = נמדד ב-DB החי; FILE = נקרא בקובץ; DOCS = מקור חיצוני.

**פסק דין: לא מוכנה לביצוע כפי שהיא. 3 חוסמים, 9 חשובים, 10 קלים. רשימת התיקונים המינימלית בסוף.**

---

## 1. ממצאים

### חוסם

#### 1. זמני ה"שחרור" ב-SUMIT הם זמני התפיסה — ה-`release` ייכתב לפני ה-`authorize`
- **שורות בתוכנית:** 28, 600-602, 662-665, 697, 854.
- **ציטוט:** "SUMIT: released 21.07 19:38", "SUMIT: released 07.07 13:18", `MANUAL_RELEASED … '2026-07-21T16:38:00Z', '2026-07-07T10:18:00Z'`.
- **מה לא נכון:** הזמנים שנמדדו בתיקיית התפיסות הם `Billing_Date`, שהקוד עצמו מתעד כזהה ל-`authorized_at` "עד השנייה" על תפיסה ששוחררה (FILE `src/lib/sumit/hold-status.ts:16-20`, `src/lib/sumit/crm-holds.ts:13-15`). VERIFIED-LIVE: `authorized_at` של `49a4617b` = `2026-07-21 16:38:52Z` (= 19:38 שעון ישראל), של `15a8730e` = `2026-07-07 10:18:50Z` (= 13:18). ההמרה ל-UTC נכונה אריתמטית, אבל ה-`occurred_at` של ה-`release` (`16:38:00Z`) **קודם** ל-`authorize` (`16:38:52Z`). `deriveStatus` ממיין לפי `occurredAt` (שורה 462) → שני הקמפיינים הסגורים יצאו `committed`, לא `returned`. Task 6 שלב 5 ("הוחזר בשלוש השורות") ו-Review Focus #1 נכשלים.
- **סתירה פנימית נוספת (39334087):** הטבלה (שורה 600) אומרת "SUMIT 02.09 16:14" (= `authorized_at` `13:14:22Z`), הקוד (שורה 695) יכתוב `updated_at` = `2026-09-23T06:00:28Z`. `updated_at` משתנה בכל UPDATE (`trg_campaigns_updated`). הזמן המדוד היחיד לשחרור הוא `activity_log` `campaign.hold_released_synced` ב-`2026-09-23T06:00:29Z` (VERIFIED-LIVE).

#### 2. `nothing_to_charge` → "אין פעולה" מאבד זיכויים שנוצלו ומשאיר שורת `pending` לנצח
- **שורות:** 604, 825, 69, 44, 756.
- **ציטוט:** "`nothing_to_charge`→ **אין פעולה** (לא קרה כלום לכסף)".
- **מה לא נכון:** VERIFIED-LIVE: שני הקמפיינים הסגורים הם `nothing_to_charge` עם `credit_applied` = **84** (`15a8730e`) ו-**4** (`49a4617b`), ו-`charged_at` מלא. `markCampaignChargeOutcome` כותב `credit_applied` + `charged_at` + `final_charge_amount=0` דווקא במצב הזה (FILE `src/lib/data/campaigns.ts:838-841`, נקרא מ-`close-charge.ts:257`). היום הזיכוי נחשב כמנוצל בלי קשר ל-`charge_status` (`billing.ts:113` — `credit_applied` של קמפיינים אחים; `users.ts:278`), וב-`owner_agent_billing_sums` (`charge_status in ('charged','nothing_to_charge')`, VERIFIED-LIVE `pg_get_functiondef`). לפי הנוסחה בשורה 69 (סכום `credit_applied` על `collect` מוצלח בלבד) הזיכויים "חוזרים": אירוע `294d23e1` (84 ₪ מוענק לא-מבוטל ב-`billing_credits`) עובר מיתרה 0 ל-84; אירוע `659ae5e7` (10 מוענק) מ-6 ל-10.
- **הפער השני:** ב-Task 5 `lockCampaignForCharge` הופך ל-`beginOperation({kind:'capture'})` שמכניס שורה `pending` (שורה 825). ב-`nothing_to_charge` "אין פעולה" → אף אחד לא משלים אותה. תוצאה: `deriveStatus` = `pending` לנצח, `one_pending_uq` חוסם כל ניסיון נוסף, וה-guard החדש של ביטול (`outcome in ('succeeded','pending','review')`) חוסם ביטול. הציפייה "6 שורות" (שורה 756) גם משתנה.

#### 3. ה-ACL לא מוריד את ברירת המחדל של `service_role` — נשארים DELETE ו-UPDATE מלא
- **שורות:** 111, 261-266, 319-322.
- **ציטוט:** "אין delete לאף תפקיד"; dry-run (a) "sr_upd … f for operations".
- **מה לא נכון:** VERIFIED-LIVE: `pg_default_acl` לסכימה `public` (מ-`postgres` ומ-`supabase_admin`) מעניק `arwdDxtm` ל-`anon`, `authenticated` **ו-`service_role`** על כל טבלה חדשה. `revoke all … from public, anon, authenticated` לא נוגע ב-`service_role`, ולכן על `payment_operations` נשארים DELETE ו-UPDATE ברמת טבלה. בדיקה (a) תיכשל מול המיגרציה שלה עצמה, וה-append-only נשען רק על טריגר UPDATE (שלא חוסם DELETE). תקדים חי: `integration_connections`, שהמיגרציה `20260916002343:147-149` הצהירה עליה "No DELETE", מחזיקה היום `relacl = service_role=ard` — DELETE קיים.

### חשוב

#### 4. ספירות העמודות סותרות את ה-SQL
- **שורות:** 7, 36, 104, 881, 935, 955.
- **ציטוט:** "21 העמודות החיות ו-6 המתות", "27 עמודות", "28 שמות העמודות", `-- payment, live (21)`.
- **מה לא נכון:** ה-SQL בשורות 936-942 מוריד **23** עמודות חיות (נספרו אחת-אחת: 3+4+4+4+3+3+2) + 3 מתות = **26** מ-`campaigns`, ועוד 2 מ-`event_cancellation_requests`. VERIFIED-LIVE: 49 עמודות, מהן 26 עמודות תשלום קיימות; `auth_expires_at` כבר לא קיימת; `enabled`/`steps` בהערה. אף ספירה במסמך לא מתארת את מה שה-SQL עושה.

#### 5. `payment_methods_write` מייצר v4 בעוד הטבלה מוצהרת v7
- **שורה 284** (`v_id uuid := gen_random_uuid()`) מול **96, 161** ("שתי הטבלאות החדשות ב-v7", `default extensions.uuid_generate_v7()`). ה-RPC היחיד שיוצר `payment_methods` עוקף את ה-default.

#### 6. `reconcile.integration.test.ts` לא יכול לרוץ מול ה-DB החי, ו-`cem-uuidv7` שובר DB בדיקה טרי
- **שורות:** 85, 927, 155-158.
- **ציטוט:** "בודק את `reconcile_authorized_set` חי — חייב לרוץ אחרי Task 8"; "עובר מול ה-DB החי אחרי ה-push".
- **מה לא נכון:** הבדיקה מוגנת ב-`OUTREACH_DB_IT=1` ו-`resolveTestDb()` ש-"HARD-FAILS if pointed at prod … NEVER the linked prod project" (FILE `src/lib/data/reconcile.integration.test.ts:7-16`). אין stack מקומי. בנוסף: `cem-uuidv7` **אינו** ב-`pg_available_extensions` (VERIFIED-LIVE: מופיע רק ב-`pgtle.available_extensions()`), ולכן `create extension if not exists "cem-uuidv7"` נכשל על DB בדיקה/מקומי שאין בו pg_tle + התקנת TLE. ההערה "on this project it is a no-op" נכונה (מותקן 1.0.2 ב-`extensions`), אבל התוכנית לא אומרת איך תרוץ בדיקת האינטגרציה.

#### 7. `createFakeTableClient` לא תומך ב-`uniqueIndexes`, `where`, `.single()`, `.not()`
- **שורות:** 780-819 (בפרט 795, 799, 821).
- **מה לא נכון:** החתימה החיה היא `createFakeTableClient(tables, rpc)` — הארגומנט השני הוא מפת RPC handlers (FILE `src/test/fake-table-client.ts:58-60`). רשימת הנתמך (שורות 12-17): `select, insert, update, delete, eq, neq, in, gt, gte, lt, lte, is, order, limit, maybeSingle, rpc`. אין אינדקס ייחודי, אין `where` חלקי, אין `.single()` (ש-`ledger.ts` משתמש בו לפי שורה 821), אין `.not()`. האובייקט `{ uniqueIndexes }` ייבלע בשקט כמפת handlers → בדיקות 2-3 ייכשלו גם אחרי מימוש נכון. ההסתייגות בשורה 819 קיימת, אבל אין שלב/בדיקה משובצים ל-Task.

#### 8. `owner_agent_billing_sums` מחזירה 4 עמודות; התוכנית מתארת 2
- **שורות:** 44, 869.
- VERIFIED-LIVE: `returns table(charged_amount, credit_applied_amount, unvoided_credit_amount, credit_granted_amount)`; שתי האחרונות מ-`billing_credits`. הצרכן קורא את כל הארבע (FILE `src/lib/owner-agent/cores/billing.ts:67-70`). התוכנית לא קובעת שהחתימה נשמרת.

#### 9. `on delete cascade` על יומן כסף, בניגוד לתקדים
- **שורות:** 199-200.
- VERIFIED-LIVE: `billed_results` — שלושת ה-FK ב-`ON DELETE RESTRICT`; `campaigns.event_id → events` הוא CASCADE. מחיקת אירוע תמחק בשקט את `payment_operations`, בניגוד ל-"append-only" ולתקדים הכסף.

#### 10. ה-diff הממתין ב-`types.generated.ts` אינו "3 מחיקות" — הוא מכניס תוסף צעצוע חשוף ל-Data API
- **שורה 118.**
- `git diff --stat`: 28 הוספות + 4 מחיקות; mtime 21:54 (לא 20:52). ההוספות: `scatter`, `scatter_sfunc`, `scatter_internal`, `scatter_state` מהתוסף `olirice-asciiplot` 0.0.1 המותקן ב-`public` (VERIFIED-LIVE), עם EXECUTE ל-`anon` (default ACL). ייכנס ל-commit של Task 1 בלי כוונה.

#### 11. `stuckHolds` משמיט `failed`
- **שורה 862.** היום `STUCK_CAPTURE_STATUSES = ['pending','hold_failed','hold_review']` (FILE `src/lib/owner-agent/cores/campaigns.ts:45`); המיפוי ל-`outcome in ('pending','review')` הוא שינוי התנהגות שלא מצוין.

#### 12. זמן ה-`release` של `39334087`: הטבלה מול הקוד
- **שורה 600 מול 695.** ראה #1. הטבלה 02.09, הקוד `updated_at` (23.09, משתנה בכל UPDATE). הזמן המדוד הוא ב-`activity_log`, לא ב-`updated_at`.

### קל

13. **שורה 870** — "`campaigns.ts:750-764` (`CAMPAIGN_COLUMNS`)": `CAMPAIGN_COLUMNS` בשורות 56-57; 747-764 היא רשימת העמודות של `getCampaignForCharge`.
14. **שורה 96** — "שאר 94 הטבלאות": VERIFIED-LIVE 96 טבלאות ב-`public`.
15. **שורה 74** — "8 עמודות" בסוכן: grep מובחן ב-`src/lib/owner-agent` (לא בדיקות) = 11 שמות.
16. **שורה 27** — "`campaigns` נקראת ל-`anon` דרך Data API": VERIFIED-LIVE ל-`anon` יש GRANT SELECT (כולל `card_citizen_id`) וגם INSERT/UPDATE/DELETE, אבל ה-policy היחידה היא `camp_org_select` ל-`authenticated`; `anon` מקבל 0 שורות. הסיכון אמיתי (grant פתוח), הניסוח מוגזם.
17. **שורה 104** — "נעילה של מילישניות": הנחה. `ALTER TABLE … DROP COLUMN` לוקח ACCESS EXCLUSIVE; ממתין מאחורי כל `for update` פתוח ב-`try_record_billed_result`/`reconcile_authorized_set` וחוסם קריאות בזמן ההמתנה. מדידה: `set lock_timeout` בטרנזקציה, חלון שקט.
18. **שורה 42** — "trigger חדש באותו שם": הפונקציה החיה היא `SECURITY DEFINER set search_path=''`; `create or replace function` מספיק, הטריגר נשאר. לומר במפורש שה-SECDEF הקיים נשמר (שורה 113 אוסרת רק SECDEF *חדש*).
19. **שורות 732-734** — `events!inner(campaigns(id))` + `campaigns[0]`: VERIFIED-LIVE הייחודיות היא `campaigns_event_noncancelled_uidx` (מסננת `cancelled`) → אירוע עם קמפיין מבוטל מחזיר יותר משורה אחת. כרגע יש בקשת ביטול אחת, `declined`, בלי מסמך → הבקפיל יכתוב 0 שורות `cancellation_charge`.
20. **שורה 874** — ה-grep "מחזיר רק את הכתיבות הכפולות": `src/lib/data/sumit-customers.ts` (עמודה של הטבלה שלו), `crm-holds.ts`, `hold-status.ts`, `queues.ts`, `worker/main.ts` (הערות) יעלו ב-grep; הקריטריון כפי שנוסח ייכשל.
21. **שורות 228-229** — `one_success_per_parent_uq (parent_operation_id, kind)`: חוסם החזר חלקי שני לאותו הורה, בניגוד להחלטה 2. לציין כהגבלה מכוונת או להגביל ל-`effect='collect'`.
22. **שורות 906-916** — `campaigns_guard_activate` יורה על כל מעבר ל-`active`, כולל `paused→active`; היום resume לא בודק `capture_status`. שלושת הקמפיינים החיים מחזיקים authorize, אין שבירה מיידית, אבל ההרחבה לא מתוארת.

---

## 2. אומת כנכון

- 49 עמודות ב-`campaigns`; 17 ב-`event_cancellation_requests` כולל `sumit_document_id/_url`, `resolved_at`, `resolution_amount` (VERIFIED-LIVE).
- 6 המתות: `billing_route` null ×3, `sumit_order_document_id` null ×3, `final_invoice_document_id` null ×3, `enabled` = default false ×3, `steps` = default `'[]'` ×3, `auth_expires_at` לא קיימת.
- `console_campaigns` מחשבת `enabled` מ-`status`; אף view לא תלוי בעמודה מפוצלת (pg_rewrite deps על campaigns: רק id/event_id/status/start_at/close_at/max_contacts/created_at/updated_at). אף policy לא מפנה לעמודה מפוצלת.
- הפונקציות שקוראות עמודות מפוצלות הן בדיוק 5: `campaigns_guard_cancel` (3 שורות `capture_status` + 1 `charge_status`), `cancel_campaign` (זהה), `owner_agent_billing_sums`, `reconcile_authorized_set` (`auth_amount` ב-SELECT … FOR UPDATE), `try_record_billed_result` (`auth_amount`, רק כש-`billing_exposure_gate` דלוק; חי = true).
- קוראי ה-RPC: `reconcile_authorized_set` מ-`contacts.ts:268` (הוספה/repoint/מחיקה של אורח), `try_record_billed_result` מ-`billing.ts:34` (לכל נמען שהושג). "רץ על כל רישום נמען" — מדויק מספיק.
- טריגרים: `campaigns_guard_cancel`, `campaigns_require_active_event`, `trg_campaigns_updated`; ב-ecr: `no_remutate` (בודק רק `status`), `set_updated_at`. `public.set_updated_at()` קיים.
- `cem-uuidv7` 1.0.2 ב-`extensions`; `pg_tle` 1.4.0 ב-`pgtle`; `supabase-dbdev` 0.0.5 ב-`public`; `supabase_vault` 0.3.1. `extensions.uuid_generate_v7()` → `uuid`, ללא ארגומנטים, מחזירה nibble 7 (דגימה חיה), EXECUTE ל-`service_role` (וגם ל-`authenticated`).
- `vault.create_secret(text, text, text, uuid)` — overload יחיד; `service_role` מחזיק EXECUTE, USAGE על `vault`, SELECT על `decrypted_secrets`. הדפוס במיגרציה `20260916002343`: `security invoker`, `set search_path = ''`, `revoke … from public, anon, authenticated`, `grant … to service_role`, `null` כ-key_id — התוכנית מעתיקה נאמנה.
- `captureHeldCardSumit` שולח POST ל-`/billing/payments/charge/` עם `CreditCard_Token` + `CreditCard_CitizenID` (`capture.ts:6,135,169`) = חיוב טרי מטוקן, לא capture של J5. `capture.ts:135` דורש `CreditCard_CitizenID` — נכון.
- מזהי 3 הקמפיינים, סכומים (152/4/200), סטטוסים (closed/closed/active), `release_status` released רק ב-`39334087`, `hold_order_document_id` null בשני הישנים (הרקונסיילר מסנן `not null`, `sumit-hold-reconcile.ts:73-75`) — "הרקונסיילר לא יראה אותם לעולם" נכון.
- ציטוטי קבצים תואמים: `campaigns.ts` 467/482/530/784/799/829/984-995 (`extraGuard` על `capture_status`); `event-cancellation.ts:118,147,206-231,513-522`; `cancellations/[id]/page.tsx:41,44,96,124-126`; `tax-ceiling.ts:30`; `callbacks.ts:652`; `users.ts:278`; `billing.ts:113`; `admin/campaigns.ts:252-277`; `admin/campaigns/page.tsx:47-63,105,131-134`; `event-labels.ts:130-145`; `event-stats.ts:175,293-299`; `setup-steps.ts:31`; `payment/page.tsx:90-123`; `events/[id]/page.tsx:342`; `setup-steps.tsx:49-63`; `queues.ts:184`; `worker/main.ts:1532`; `capture.ts:21`; `crm-holds.ts:15,29`; `hold-status.ts:18`; `sumit-test.ts:40`; `sumit-doc-check.ts:45`; `tax-catalog-israel.md:70,194`; `credential-accessor.ts:150`.
- Changelog (DOCS `https://supabase.com/changelog.md`): 2026-04-28 "Breaking Change: Tables not exposed to Data and GraphQL API automatically … Opt-in today, default for new projects on 2026-05-30, enforced on all projects on 2026-10-30". הפרויקט הזה עדיין לא opt-in (ה-default ACL מעניק).
- `worker/empty.js` קיים; ה-esbuild aliases זהים ל-`owner-agent:smoke`; `gen:types`, `types:check`, `worker:deps`, `owner-agent:smoke`, `deploy`, `test`, `lint` קיימים ב-`package.json`; `payments:backfill` חסר (מתוכנן להוספה).
- 20 קבצי הבדיקה קיימים (כולל `whatsapp-send/route.test.ts`); `admin/campaigns.test.ts` לא קיים (התוכנית: "צור אם אין"). כל 11 קבצי התיעוד, שני ה-plans, 4 תוכניות `2026-06-26-*`, קובץ הזיכרון `stuck-j5-hold-bac77347-cleanup.md`, וכל דפי הלקוח/הסוכן קיימים.
- `campaigns.ts` נוגע ב-22 עמודות תשלום (grep מובחן) — נכון. `sumit-customers.ts` לא קורא `campaigns` — נכון.
- `ops_errors` קיימת. `billing_route` enum = `saved_token, hold_j5`; `campaign_status` כולל `awaiting_invoice, billed, paid`.
- FK `payment_operations.kind → payment_operation_kinds.kind` קיים ב-SQL (שורה 202) → ה-embed `payment_operation_kinds!inner(effect)` תקף. אי-אינדוקס `kind` תקין (רישום קטן, אין DELETE/UPDATE עליו).
- `campaign_committed_amount` ("ה-commit המוצלח האחרון") תואם ל-`deriveStatus().committed`; לקאקון = 200.
- Task 2: 18 בדיקות בדיוק; כל התרחישים עוברים לפי המימוש כפי שכתוב. Task 3 ו-Task 4 (`planOperations`) — הבדיקות עקביות עם הקוד.
- `has_table_privilege(...,'update')` אכן מחזיר false כשיש רק column-level UPDATE — ציפיית (a) נכונה עקרונית (אך ראה חוסם 3).
- `payment_operations` guard trigger: `raise … errcode='check_violation'` תקין; `set search_path=''` + שמות מלאים — תואם מדיניות.
- מיגרציות מסונכרנות (`migration list --linked`, האחרונה `20260924061630`).

---

## 3. ספירה

| חוסם | חשוב | קל |
|---|---|---|
| 3 | 9 | 10 |

---

## 4. פסק דין ותיקונים מינימליים

**לא מוכנה לביצוע כפי שהיא.** המינימום שהופך אותה למוכנה:

1. **זמני השחרור (חוסם 1, 12):** למחוק את "SUMIT: released HH:MM" מהטבלה ומה-`MANUAL_RELEASED`; לתעד ש-`Billing_Date` הוא זמן התפיסה. ל-`39334087` להשתמש ב-`activity_log` (`2026-09-23T06:00:29Z`). לשני הישנים: `occurred_at = authorized_at + 1s` עם note "release time unknown", **או** להוסיף ל-`deriveStatus` שובר-שוויון יציב (`recorded_at`/סדר הכנסה) ולכסות בבדיקה.
2. **`nothing_to_charge` (חוסם 2):** להגדיר אותו כהשלמת ה-`capture` ה-pending עם `succeeded`, `amount=0`, `credit_applied=X` (effect `collect`). לעדכן את הבקפיל (`nothing_to_charge` → `capture succeeded 0 + credit_applied`, `occurred_at=charged_at`), את הציפייה "6 שורות" ל-8, ואת נוסחת הזיכוי (שורה 69) ואת `owner_agent_billing_sums` כך ש-`credit_applied` נספר גם על `collect` בסכום 0.
3. **ACL (חוסם 3):** `revoke all on table … from service_role;` לפני ה-grants בשורות 261-266; טריגר BEFORE DELETE שמרים חריגה (תקדים `authorized_set_audit`); לעדכן את ציפיות ה-dry-run.
4. **חשוב 4, 5, 8, 9:** לתקן את הספירות ל-23/26(+2); `extensions.uuid_generate_v7()` ב-`payment_methods_write`; לקבוע שחתימת `owner_agent_billing_sums` (4 עמודות) נשמרת ורק שני הסכומים הראשונים משתנים; `on delete restrict` על שני ה-FK.
5. **חשוב 6, 7:** להחליט איך `reconcile.integration.test.ts` רץ (DB בדיקה עם pg_tle + dbdev, או לוותר על v7 עד PG18) ולהוסיף ל-Task 5 שלב 0 מפורש: הרחבת `src/test/fake-table-client.ts` (`uniqueIndexes` עם `where`, `.single()`, `.not()`) עם בדיקה משלה.
6. **חשוב 10, 11:** להסיר `olirice-asciiplot` (בעלים) ולהריץ `gen:types` לפני Task 1, או לפצל את ה-commit; לכלול `failed` ב-`stuckHolds` או לתעד את השינוי.

הקלים (13-22) הם תיקוני ניסוח/ציון שאפשר לעשות באותו סבב.
