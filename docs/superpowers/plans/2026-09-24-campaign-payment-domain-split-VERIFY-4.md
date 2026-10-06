# אימות רביעי — חמשת המנגנונים מול הריפו ומול ה-DB החי

נכתב 2026-09-25 על ידי rls-schema-engineer. זו לא ביקורת Markdown: כל מנגנון נבדק מול הקוד הקיים ומול ה-DB החי (`npx supabase db query --linked`). הכתיבה היחידה ל-DB היא טרנזקציה אחת `begin; … rollback;` (הקובץ `verify4.sql`, 36 בדיקות, הרצה אחת), ואחריה קריאה שהוכיחה שכלום לא נשאר.

תיוג: **VERIFIED** = קיים ומתנהג כמו שהתוכנית טוענת היום · **NOT PRESENT** = התוכנית מניחה דבר שלא קיים ולא יוצרת אותו · **DESIGN-ONLY** = נכון כתכנון, נבדק ב-rollback היכן שאפשר, אבל עדיין לא בריפו/ב-DB. מקור: SQL (טרנזקציית ה-rollback) / קובץ:שורה / DOCS.

**מצב פתיחה (VERIFIED-LIVE 25.9):** `migration list --linked` — 282 מיגרציות, 0 drift. `default_transaction_isolation = read committed`. `pg_extension`: `supabase_vault` (סכימה `vault`), `cem-uuidv7` (סכימה `extensions`). אפס אובייקטים בשם `payment_%` ב-`public`. שלושת הקמפיינים: `39334087` (active, authorized, charge null), `49a4617b` ו-`15a8730e` (closed, authorized, nothing_to_charge).

**הוכחה שכלום לא נשאר אחרי ה-rollback (VERIFIED-LIVE):** `payment_rels=0, once_slot_cols=0, enum_types=0, fns=0, trg=0` (ספירה על `pg_class`, `information_schema.columns`, `pg_type`, `pg_proc`, `pg_trigger`).

---

## 1. `once_slot` snapshot + נעילת שורת הקמפיין (Task 1)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| כל סקריפט Task 1 (בלי שורת ה-extension ובלי `drop column if exists auth_expires_at`) מתקבל על ידי Postgres | SQL: 3 טבלאות, enum, 8 אינדקסים, `add column once_slot`, 2 טריגרים, ACL, 2 פונקציות Vault, grants — בתוך `begin…rollback` | `ALL STATEMENTS ACCEPTED`; בדיקות (a)(b)(c)(e)(g)(f) של ה-dry-run: anon/auth `select`=false, service_role=true; 0 policies; `payment_method_citizen_id` exec anon=false/sr=true; **0 עמודות FK בלי אינדקס** (התוכנית מצפה לשורה אחת, `kind` — ראה הערה); `confdeltype='r'` על `campaign_id`; `once_uq` = `WHERE (once_slot AND outcome = ANY('{pending,review,succeeded}'))` | DESIGN-ONLY (נבדק ב-rollback) |
| `insert … kind='charge'` → `once_slot=true` | SQL: insert ל-`39334087`, `select once_slot` | `true outcome=pending` | DESIGN-ONLY (נבדק) |
| `insert … kind='release'` → `once_slot=false` | SQL | `false` | DESIGN-ONLY (נבדק) |
| ה-`for update` בטריגר לוקח נעילת שורה אמיתית | SQL בתוך אותה טרנזקציה: `xmax` של שורת `campaigns` `39334087` מול `pg_current_xact_id()` ו-`pg_locks` ל-pid הנוכחי | `xmax=3350144 my_xid=3350144 locked_by_me=true`; `pg_locks` על `campaigns`: `RowShareLock:true` (הנעילה ש-`SELECT … FOR UPDATE` לוקחת על הטבלה) + `ShareRowExclusiveLock` (מיצירת הטריגר באותה טרנזקציה); שורת `49a4617b` שלא נגעו בה: `xmax=3075917` (ישן, לא שלי) | DESIGN-ONLY (נבדק) |
| הנחת יסוד: הנעילה של היום היא UPDATE מסונן | `src/lib/data/campaigns.ts:467-482`: `lockCampaignForHold` = `.update({ capture_status: 'pending' }).eq('id', campaignId).or('capture_status.is.null,capture_status.in.(hold_failed,hold_review)').select('id').maybeSingle()`; `:784-797` `lockCampaignForCharge` = `.update({ charge_status: 'pending' }) … .or('charge_status.is.null,charge_status.in.(charge_failed,charge_review)')` | תואם לתוכנית | VERIFIED |
| הנחת יסוד: בידוד ברירת מחדל = read committed | SQL `show default_transaction_isolation` | `read committed` | VERIFIED |

הערות (לא חוסמות):
- (e) של ה-dry-run מצפה ל"בדיוק שורה אחת: `payment_operations.kind`". בפועל **0**: `kind` הוא העמודה השנייה באינדקסים `one_pending_uq` ו-`once_uq` (`(campaign_id, kind)`), ולכן השאילתה של (e) (`attnum = any(indkey)`) מוצאת אותה מאונדקסת. הציפייה בתוכנית שגויה בכיוון הבטוח; לעדכן ל-"0 שורות".
- `select k.once_per_campaign into new.once_slot` עם `kind` שלא ברישום מחזיר NULL → הכישלון יהיה `23502` (not null על `once_slot`) ולא `23503` (FK). לא משנה התנהגות; שווה `coalesce(…, false)` או להשאיר ולתעד.
- הנעילה על שורת הקמפיין נמשכת רק עד סוף הטרנזקציה של ה-INSERT. דרך supabase-js כל insert הוא טרנזקציה משלו, ולכן הנעילה משוחררת מיד — היא מסדרת כתיבות מקבילות ליומן מול טריגרי ה-guard של `campaigns`, לא מחזיקה נעילה במהלך הקריאה ל-SUMIT. זה תואם למה שהתוכנית כותבת ("the lock is the PENDING row"), רק כדאי לומר זאת במפורש.

---

## 2. `payment_operations_once_uq` (Task 1)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| אחרי `charge` succeeded לקמפיין X, `charge` pending ל-X נכשל ב-23505 | SQL: X=`39334087`; update pending→succeeded; insert pending ב-DO עם `GET STACKED DIAGNOSTICS CONSTRAINT_NAME` | `23505 on payment_operations_once_uq` | DESIGN-ONLY (נבדק) |
| שורת `review` גם חוסמת | SQL: Y=`49a4617b`, insert `charge` outcome `review`, ואז insert pending | `23505 on payment_operations_once_uq` | DESIGN-ONLY (נבדק) |
| אחרי `failed` — pending חדש מתקבל | SQL: Z=`15a8730e`, insert `charge` failed, ואז pending | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| סוג לא-once (`release`) לא נחסם על ידי `once_uq` | SQL: שני `release` succeeded ל-X | שניהם התקבלו | DESIGN-ONLY (נבדק) |
| `one_pending_uq` עדיין חוסם שני `release` pending | SQL: `release` pending ל-X ואז עוד אחד | `23505 on payment_operations_one_pending_uq` | DESIGN-ONLY (נבדק) |
| אחרי `review → failed` (הכרעה ידנית) pending חדש מתקבל | SQL על Y | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| ייחודיות נאכפת בלי תלות ברמת הבידוד | DOCS: PostgreSQL "Index Uniqueness Checks" (`docs/current/index-unique-checks.html`): "We require the index access method to apply these tests itself, which means that it must reach into the heap to check the commit status of any row that is shown to have a duplicate key according to the index contents" ו-"If a conflicting row has been inserted by an as-yet-uncommitted transaction, the would-be inserter must wait to see if that transaction commits. If it rolls back then there is no conflict. If it commits without deleting the conflicting row again, there is a uniqueness violation." הדף לא מזכיר רמת בידוד כלל — הבדיקה נעשית ב-btree מול מצב ה-commit, לא מול snapshot | הטענה של התוכנית ("at any isolation level") נתמכת בתיעוד | VERIFIED (DOCS) |
| בדיקה (h) בשני חיבורים | `db query --linked` = חיבור אחד לקריאה; אי אפשר להריץ שני חיבורים מקבילים דרכו | לא נבדק חי; ההתנהגות נגזרת מהתיעוד למעלה: B נחסם קודם על ה-`for update` של שורת הקמפיין בטריגר, ואחרי ש-A מסיים — על רשומת האינדקס; אם A commit → 23505, אם A rollback → B מצליח | DOCS-ONLY |

---

## 3. `guard_update`: מעברים, `once_slot` בלתי-ניתן לשינוי, `review` חוסם עד הכרעה (Task 1)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| pending → succeeded מותר | SQL (עם `occurred_at` ו-`provider_ref` באותו UPDATE) | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| pending → review מותר | SQL | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| review → succeeded מותר | SQL (עם `provider_document_id`, `note`) | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| review → failed מותר | SQL | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| succeeded → failed / pending / succeeded (note בלבד) — כולם `check_violation` | SQL | `succeeded → failed is not an allowed transition`, `succeeded → pending …`, `succeeded → succeeded …` | DESIGN-ONLY (נבדק) |
| pending → pending (note בלבד) נזרק | SQL | `pending → pending is not an allowed transition` | DESIGN-ONLY (נבדק) |
| review → review / review → pending נזרקים | SQL | שניהם `check_violation` | DESIGN-ONLY (נבדק) |
| שינוי `once_slot` נזרק | SQL: (א) `set once_slot=true` בלבד על pending → נופל כבר על "pending → pending"; (ב) `set outcome='succeeded', once_slot=true` → `only outcome, amounts, provider refs, occurred_at, note and meta may change on completion` | שני המסלולים חסומים | DESIGN-ONLY (נבדק) |
| שינוי `campaign_id` נזרק | SQL: `set outcome='succeeded', campaign_id=Y, event_id=…` | `check_violation` (הודעת "only outcome…") | DESIGN-ONLY (נבדק) |
| בזמן `review` על Z, `charge` pending חדש ל-Z נחסם | SQL | `23505 on payment_operations_once_uq` | DESIGN-ONLY (נבדק) |
| הנחת יסוד: היום `charge_review`/`hold_review` ניתנים לניסיון חוזר אוטומטי | `campaigns.ts:781-783` הערה: "Matches only when no charge yet (null) or a prior attempt is retryable (charge_failed/charge_review)"; `:792` `.or('charge_status.is.null,charge_status.in.(charge_failed,charge_review)')`; `:473` `.or('capture_status.is.null,capture_status.in.(hold_failed,hold_review)')`; `close-charge.ts:135-142`: "Retryable states (charge_failed/charge_review) pass" — רק `charged`/`nothing_to_charge` מחזירים `bad_state` | "review חוסם עד הכרעה" הוא **שינוי התנהגות מתועד** מול היום | VERIFIED |

הערה: הטריגר זורק גם על UPDATE שלא משנה `outcome` (למשל הוספת `note` לשורה `review` בלי להכריע). זה עקבי עם append-only, אבל `resolvePaymentReview` (Task 7) לא יוכל "לרשום הערה בלי להכריע"; אם רוצים זאת — `activity_log`, לא היומן.

---

## 4. `completeOperation` compare-and-set (Task 5) + `resolvePaymentReview` (Task 7)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| `UPDATE … where id=$id and outcome=$from` מחזיר 0 שורות כשהמצב לא תואם, לפני שהטריגר בכלל רץ | SQL: `update … set outcome='succeeded' where id=<שורה succeeded> and outcome='pending'`, `GET DIAGNOSTICS row_count` | `rows=0` (בלי שגיאה — הטריגר לא הופעל כי אף שורה לא התאימה) | DESIGN-ONLY (נבדק) |
| הקוד `completeOperation`/`beginOperation`/`ledger.ts` קיים | `ls src/lib/payments` → אין תיקייה; grep | לא קיים | DESIGN-ONLY |
| `fake-table-client` מדווח שורות מושפעות ב-update רק עם `.select()` | `src/test/fake-table-client.ts:98-101`: `if (rec.op === 'update') { for (const r of matched) Object.assign(r, patch); return { data: returning ? matched.map(…) : null … } }`; `returning` נדלק רק ב-`select()` אחרי `update` (`:123-128`) | נכון. "0 rows → throw" ניתן למימוש כבר היום עם `.select('id').maybeSingle()` (`:163-166`) ובדיקת `null` | VERIFIED |
| `fake-table-client` היום: אין `.single()`, אין `.not()`, אין `uniqueIndexes` | `:12-17` רשימת הנתמכים; `:58-61` חתימה `(tables, rpc = {})`; אין מתודות `single`/`not` באובייקט `b` (`:122-170`); `insert` (`:92-96`) לא בודק ייחודיות | Step 0 של Task 5 נדרש לבדיקות ה-23505 (ledger.test 2-4); לא נדרש ל-CAS עצמו | VERIFIED |
| אין `resolvePaymentReview` / `resolve*Review` היום | grep על `src`, `worker`, `scripts` (`resolvePaymentReview\|resolve[A-Za-z]*Review\|resolve_[a-z_]*review`) | 0 תוצאות; ב-`src/app/(admin)/admin/campaigns/page.tsx:26` יש רק תווית `charge_review: 'בבדיקה'` | NOT PRESENT (התוכנית יוצרת ב-Task 7 0א) |
| `charge_review` היום מנוסה שוב רק דרך close-charge | `close-charge.ts:172, 207, 406` = הכתיבה ל-`charge_review`; `:135-142` מעביר `charge_review` הלאה; `:309` `lockCampaignForCharge` תופס מחדש מ-`charge_review` (`campaigns.ts:792`) | אין מסלול אחר (לא אדמין, לא worker) | VERIFIED |

---

## 5. טיפול בקריסה: `payment-orphans` (Task 5 5א), `probeSumitOperation` + `resolvePaymentReview` (Task 7 0א)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| אין היום sweeper ל-`capture_status='pending'`/`charge_status='pending'` | grep `worker/main.ts`, `src/lib/queue/queues.ts`, `src/lib/data/*.ts` על `pending`/`orphan`/`stale`; `sumit-hold-reconcile.ts:73` בוחר רק `capture_status='authorized'` | היחידים שכותבים `pending` הם הנעילות (`campaigns.ts:471, 790`); אף קוד לא קורא אותן חזרה | VERIFIED (הפער קיים) |
| `lockCampaignForHold`/`lockCampaignForCharge` מסרבים לשורה `pending` | `campaigns.ts:473` `.or('capture_status.is.null,capture_status.in.(hold_failed,hold_review)')`; `:792` `.or('charge_status.is.null,charge_status.in.(charge_failed,charge_review)')` — `pending` לא ברשימה | קמפיין `pending` תקוע לנצח | VERIFIED |
| דפוס חיווט job שאפשר להעתיק | `worker/main.ts:1533-1539`: `await boss.work(QUEUES.sumitHoldReconcile, POLL_SLOW_CRON, guardedWorker(QUEUES.sumitHoldReconcile, async () => { await runSumitHoldReconcile(); }))`; `:1623` `await boss.schedule(QUEUES.sumitHoldReconcile, '*/30 * * * *')`; `queues.ts:193` `sumitHoldReconcile: 'sumit-hold-reconcile'`; `POLL_SLOW_CRON = { pollingIntervalSeconds: 30 }` (`:908`); `guardedWorker` (`:313-330`) שולח Slack `category: 'errors'` וזורק | תואם לתוכנית | VERIFIED |
| `ExternalIdentifier` נשלח ב-authorize וב-capture | `authorize.ts:70` `ExternalIdentifier: p.authRef`; `capture.ts:130` `ExternalIdentifier: p.externalRef`; מקורות: `authorize/route.ts:178` `const authRef = crypto.randomUUID()`; `close-charge.ts:344` `externalRef: campaign.auth_external_ref ?? ''` | נשלח בשניהם — **אבל אותו ערך**: החיוב שולח את ה-UUID של התפיסה, לא מזהה משלו | VERIFIED (עם סייג) |
| אין קוד ששואל את SUMIT לפי `ExternalIdentifier` | grep `ExternalIdentifier` ב-`src`/`worker`/`scripts` | רק בגופי בקשה יוצאות (`authorize`, `capture`, `charge`, `raw-charge`, `accounting`) וב-`safe-preview` (הסתרה) | VERIFIED |
| `/billing/payments/list/` מקבל סינון לפי `ExternalIdentifier` | `swagger.json` → `PaymentsController_Payments_List_Request`: `required: [Credentials, Date_From, Date_To]`, properties: `Credentials`, `Date_From` (date-time), `Date_To` (date-time), `Valid` (bool/null, "List only valid/invalid payments"), `StartIndex` (int32), `additionalProperties: false`. התשובה `Payments_List_Response.Payments[]` = `Typed.Payment` עם: `ID, CustomerID, Date, ValidPayment, Status, StatusDescription, Amount, Currency, PaymentMethod, AuthNumber, FirstPaymentAmount, NonFirstPaymentAmount, RecurringCustomerItemIDs` | **אין** פילטר `ExternalIdentifier` בבקשה, **אין** `ExternalIdentifier` ו**אין** `DocumentID` בפריט התשובה. הסינון האפשרי: חלון תאריכים + התאמה בצד שלנו על `CustomerID` (+`Amount`, `AuthNumber`). זיכרון `sumit-charge-verified-behavior` (נמדד 29.6): `payments/list` מציג רק תשלומים שנגבו (J5 לא מופיע); `gettransaction` לפי ה-UUID שלנו → "not found" | NOT PRESENT (הנחה שגויה) |
| `getforcustomer` כבר ממומש | grep `getforcustomer` ב-`src/lib/sumit/*.ts` | רק ב-`types.generated.ts` (:938-948, סכימות :3394-3412). אין client. `GetForCustomer_Request` = `Credentials`, `Customer` (`Accounting_Typed_Customer`: `ID`, `Name`, `EmailAddress`, `ExternalIdentifier`, `SearchMode`…), `IncludeInactive`. הזיכרון (נמדד 14.7) + `plans/sumit-customer-id-reconciliation.md:33-40`: עובד לפי `Customer.ID` = SUMIT CustomerID; חיפוש לפי `ExternalIdentifier` "unreliable" כי הוא UUID לכל ניסיון תפיסה | NOT PRESENT (הקוד לא קיים; הקלט הנכון הוא CustomerID) |
| קריאות SUMIT מוגבלות ב-timeout קצר בהרבה מ-10 דקות | `authorize.ts:102-106`, `capture.ts:167-171` ו-`:289`, `charge.ts:58-62`, `raw-charge.ts:152`: `fetch(SUMIT_CHARGE_URL, { method, headers, body })` — **בלי `signal`**. `AbortSignal.timeout` קיים רק ב-`sumit/health.ts:93` (12s). `close-charge.ts`/`authorize/route.ts`: אין timeout ואין `maxDuration`. DOCS (undici Dispatcher, Node 24.21.0 בשרת): `headersTimeout` "Defaults to 300 seconds", `bodyTimeout` "Defaults to 300 seconds" | **אין timeout.** גרוע ביותר: עד ~5 דקות לכותרות + עד ~5 דקות לגוף ≈ 10 דקות — **לא "קצר בהרבה" מסף ה-10 דקות של ה-sweep**; חופף לו | NOT PRESENT (הנחה שגויה) |
| `sendSlackAlert` עם `category: 'campaign_billing'` קיים | `close-charge.ts:396-402`; `app_settings.slack_alert_campaign_billing` (`types.generated.ts:217`) | קיים | VERIFIED |

---

## סיכום

| # | מנגנון | תווית | פסק דין בשורה |
|---|---|---|---|
| 1 | `once_slot` snapshot + נעילת שורת קמפיין | DESIGN-ONLY (נבדק ב-rollback; הנחות היסוד VERIFIED) | ה-SQL רץ, ה-snapshot נכון (`charge`→true, `release`→false), `for update` נועל את השורה (xmax = xid שלי, RowShareLock). |
| 2 | `once_uq` | DESIGN-ONLY (נבדק; תיעוד Postgres VERIFIED) | succeeded ו-review חוסמים (23505 על `once_uq`), failed לא, `release` לא נחסם, `one_pending_uq` עדיין עובד; ייחודיות ב-btree בלי תלות בבידוד. |
| 3 | `guard_update` + `once_slot` immutable + review חוסם | DESIGN-ONLY (נבדק; הנחת "היום retry אוטומטי" VERIFIED) | כל 14 המעברים שנבדקו התנהגו כמתואר; שינוי `once_slot`/`campaign_id` נזרק; שינוי `occurred_at` בסיום מותר. |
| 4 | `completeOperation` CAS + `resolvePaymentReview` | DESIGN-ONLY (הנחות VERIFIED; `resolvePaymentReview` NOT PRESENT היום כמו שהתוכנית אומרת) | CAS מחזיר 0 שורות בלי להגיע לטריגר; ה-fake תומך בזה כבר היום דרך `.select().maybeSingle()`; Step 0 נחוץ רק לבדיקות ה-23505. |
| 5 | טיפול בקריסה | **NOT PRESENT ×2 בהנחות** (השאר VERIFIED) | הפער והחיווט מאומתים, אבל (א) `payments/list` לא מסנן לפי `ExternalIdentifier` ולא מחזיר אותו או `DocumentID`; (ב) ל-SUMIT אין timeout בקוד — סף 10 הדקות לא מעל הגרוע ביותר. |

---

## מה התוכנית חייבת לשנות (עריכות מינימליות)

1. **Task 7 שלב 0א, `probeSumitOperation` ל-`charge`:** להחליף "מסונן ל-`Customer.ExternalIdentifier`" ב-: `POST /billing/payments/list/` עם `Date_From`/`Date_To` = חלון של ±1 יום סביב `recorded_at` של הפעולה, `Valid: true`, ואז התאמה בצד שלנו על `CustomerID` (= `payment_methods.provider_customer_id`, או `sumit_customers.sumit_customer_id` של הבעלים) ו-`Amount` = סכום הפעולה (ו-`AuthNumber` אם קיים). לציין שהפריט לא מכיל `DocumentID`; ההצעה למסך היא "נמצא תשלום N ₪ ב-<תאריך>, AuthNumber …", ומספר המסמך מוזן ידנית מה-dashboard (או משאילתה נפרדת של מסמכים — לא בתוכנית). לתקן גם את המשפט "המסך מציג את ה-`provider_ref`/`ExternalIdentifier` של הפעולה (נשלח בכל בקשה ל-SUMIT בדיוק בשביל זה)": ה-`ExternalIdentifier` של החיוב הוא `auth_external_ref` של התפיסה (`close-charge.ts:344`), ואף endpoint של SUMIT לא מחפש לפיו (זיכרון 29.6). מקור: `swagger.json` `PaymentsController_Payments_List_Request` / `Typed.Payment`.
2. **Task 7 שלב 0א, `probeSumitOperation` ל-`authorize`:** `getforcustomer` עם `Customer: { ID: <SUMIT CustomerID> }, IncludeInactive: true` — הקלט הוא CustomerID (מ-`sumit_customers` של הבעלים; ה-route כבר מקבל `holdResult.sumitCustomerId`), לא `ExternalIdentifier`. להוסיף: ה-client לא קיים היום (רק טיפוסים ב-`types.generated.ts`), ולכן `src/lib/sumit/probe.ts` הוא קובץ חדש עם fetch משלו — עם `signal: AbortSignal.timeout(…)` כמו `health.ts:93`. לחלופין/בנוסף, למצב התפיסה עצמה: `listCrmHolds` הקיים (`crm-holds.ts`, תיקייה `1076735289`, `Billing_Amount`/`Billing_Date`/`Billing_Status`) — התאמה לפי סכום + `Billing_Date` ≈ `recorded_at`.
3. **Task 5 שלב 5א, סף היתומים:** המשפט "כל קריאה ל-SUMIT מוגבלת ב-timeout קצר בהרבה" שגוי. לבחור אחד: (א) **מומלץ** — להוסיף ל-Task 5 שלב 4 `signal: AbortSignal.timeout(60_000)` לארבע קריאות ה-fetch ב-`authorize.ts:102`, `capture.ts:167`, `capture.ts:289`, `charge.ts:58` (ו-`raw-charge.ts:152`); `AbortError` נופל ל-`catch` הקיים → `SumitNetworkError` → `review` באותו תהליך, וה-sweep נשאר רק למוות של התהליך (pm2 `kill_timeout: 45000`, `ecosystem.config.cjs:68`). אז סף 10 דקות תקף. (ב) בלי timeout — להעלות את הסף ל-15 דקות לפחות ולתעד ש-undici (Node 24) מגביל כותרות וגוף ל-300s כל אחד.
4. **Task 1 dry-run (e):** לתקן את הציפייה מ-"בדיוק שורה אחת (`kind`)" ל-"0 שורות" — `kind` מאונדקס כעמודה שנייה ב-`one_pending_uq`/`once_uq`, והשאילתה של (e) מזהה זאת. (נמדד ב-rollback.)
5. **Task 1, הערה קטנה ב-`payment_operations_before_insert`:** `kind` לא ברישום → `23502` על `once_slot` לפני ה-FK. אופציונלי: `coalesce((select …), false)` כדי שהשגיאה תהיה `23503` הברורה יותר; או להשאיר ולתעד.
6. **Task 1 / Task 7, הערת תיעוד:** `guard_update` זורק על כל UPDATE שלא משנה `outcome` (גם `note` בלבד על `review`). `resolvePaymentReview` לא יכול "לרשום הערה בלי להכריע" — הערות ביניים ל-`activity_log`.
7. **Task 1 dry-run (h):** לציין ש-`db query --linked` הוא חיבון אחד ולא יכול להריץ את בדיקת שני החיבורים; היא מתבצעת בשני חיבורי psql/SQL editor, או שנסמכים על תיעוד "Index Uniqueness Checks" (מצוטט למעלה) + ה-`for update` שמסדר את ההכנסות עוד לפני האינדקס.

הריפו לא השתנה. ה-DB לא השתנה (הוכח בספירות לאחר ה-rollback). הקובץ היחיד שנכתב: דוח זה.
