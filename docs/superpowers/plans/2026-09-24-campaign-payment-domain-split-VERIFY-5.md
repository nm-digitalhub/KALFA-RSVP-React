# אימות חמישי — חמשת תיקוני הביקורת החיצונית (25.9 01:25) מול הריפו ומול ה-DB החי

נכתב 2026-09-25 על ידי rls-schema-engineer (VERIFY-5). אותה שיטה כמו VERIFY-4: הכתיבה היחידה ל-DB היא טרנזקציה אחת `begin; … rollback;` (הקובץ `verify5.sql` בסקראצ'פד: כל סקריפט Task 1 בגרסתו הנוכחית, בלי שורת ה-extension ובלי `drop column if exists auth_expires_at`, ואחריו 42 בדיקות שכותבות לטבלה זמנית), הרצה אחת דרך `npx supabase db query --linked --file`, ואחריה קריאה שהוכיחה שכלום לא נשאר. שני התיקונים ב-TypeScript (Task 2, Task 4) לא נבדקו רק ביד: הקוד של התוכנית הועתק מילה במילה לסקראצ'פד והורץ ב-vitest 5.0.1 של הריפו (בלי לגעת בריפו).

תיוג: **VERIFIED** = קיים ומתנהג כמו שהתוכנית טוענת היום · **NOT PRESENT** = התוכנית מניחה דבר שלא קיים ולא יוצרת אותו · **DESIGN-ONLY** = נכון כתכנון, נבדק ב-rollback / בהרצה מבודדת, אבל עדיין לא בריפו/ב-DB.

**מצב פתיחה (VERIFIED-LIVE 25.9 01:25):** `migration list --linked` — 0 drift (אחרונה `20260924061630`). `default_transaction_isolation = read committed`. אפס אובייקטים `payment_%`. שלושת הקמפיינים: X=`39334087` (active, authorized, `release_status=released`, `hold_order_document_id=2327129322`), Y=`49a4617b` ו-Z=`15a8730e` (closed, authorized, `nothing_to_charge`, `credit_applied` 4/84, `hold_order_document_id` null). לשלושתם `card_token_ref` ו-`approved_by` מלאים. `event_cancellation_requests` עם `sumit_document_id`: **0**. שורת `activity_log` `campaign.hold_released_synced`: אחת, `meta.campaignId`=X, `created_at=2026-09-23T06:00:29.021648+00:00`. טריגרים על `campaigns`: `campaigns_guard_cancel`, `campaigns_require_active_event`, `trg_campaigns_updated` — כולם `O`.

**הוכחה שכלום לא נשאר אחרי ה-rollback (VERIFIED-LIVE):** `payment_rels=0, slot_cols=0 (once_slot/parent_slot בכל טבלה), enum_types=0, fns=0 (4 הפונקציות), trg=0, campaigns_guard_cancel tgenabled='O', Y.status='closed', vault.secrets 'pm:%'=0`.

---

## 1. `deriveStatus` — כל שורה לא-פתורה קובעת (Task 2)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| קובץ הבדיקה של Task 2 (שורות 474-536) עובר מול המימוש (שורות 544-613) | vitest, סקראצ'פד: `status.ts` + `status.test.ts` הועתקו כמו שהם | **27/27 passed** (18 `deriveStatus` + 9 `paymentBadge`) | DESIGN-ONLY (הורץ) |
| `authorize → charge(review) → release(succeeded)` = `review` | בדיקה "an unresolved review is NOT hidden by a later release" + probe נוסף עם `toEqual({status:'review', collected:0, committed:200})` | עובר | DESIGN-ONLY (הורץ) |
| `authorize → charge(review) → release(pending)` = `review` | בדיקה "review beats pending when both exist" | עובר | DESIGN-ONLY (הורץ) |
| `authorize → charge(0) → release` = `collected`/0 | probe נוסף (סדר זמן: authorize, charge 0, release) → `{status:'collected', collected:0, committed:200}`; וגם הבדיקה "the real closed-campaign sequence" (authorize, release+1s, charge 0) → אותו דבר | עובר | DESIGN-ONLY (הורץ) |
| שוויון `occurredAt` → `recordedAt` שובר | בדיקת התוכנית (release נרשם אחרי authorize → `released`) + probe הפוך (authorize נרשם אחרי release → `committed`) | שניהם עוברים: `localeCompare` על `recordedAt` הוא שובר השוויון | DESIGN-ONLY (הורץ) |
| 'only a failed authorize → declined' לא נשבר | הבדיקה עוברת; הליכה ביד: `inFlight=null` (אין review/pending), הלולאה מדלגת על failed, `status='none'` → `declined` | עובר | DESIGN-ONLY (הורץ) |
| 'charge pending → pending' לא נשבר | הבדיקה עוברת; `inFlight='pending'` → return לפני ה-`declined` | עובר | DESIGN-ONLY (הורץ) |
| probes נוספים: `authorize(pending)` בלבד → pending; `authorize(failed)+charge(pending)` → pending (לא declined); `review` מוקדם ואז `charge` succeeded מאוחר → review; הכל failed → declined; `effect='none'` succeeded בלבד → declined | 9 probes, vitest | 9/9 | DESIGN-ONLY (הורץ) |

הערה (לא חוסמת): `effect='none'` שהצליח לבדו מחזיר `declined` ("something was attempted, nothing succeeded") — אין סוג כזה ברישום היום, אבל אם ייכנס סוג אינפורמטיבי, קמפיין עם שורה אחת שלו יוצג "נדחה". לתעד או להחזיר `none` כשכל השורות המוצלחות הן `effect='none'`.

---

## 2. `payment_operations_before_insert` בודק את מצב הקמפיין תחת הנעילה (Task 1)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| ה-plpgsql בגרסה החדשה מתקמפל (declare עם 4 משתנים לפני `begin`) | SQL: `create or replace function` התקבל; `pg_proc.prosrc like '%v_status = ''cancelled''%'` = true; הטריגר רץ ב-13 inserts | מתקמפל ורץ | DESIGN-ONLY (נבדק) |
| `campaigns_guard_cancel` החי חוסם `status='cancelled'` על Y | SQL 2a: `23514: campaign cannot be cancelled: financial commitment or wrong state` (Y סגור + `capture_status='authorized'`) | כצפוי; לכן הטריגר **הושבת בתוך טרנזקציית ה-rollback בלבד** (`alter table public.campaigns disable trigger campaigns_guard_cancel` … `enable` לפני ה-rollback; אחרי ה-rollback `tgenabled='O'`, נמדד) | VERIFIED |
| אחרי `update campaigns set status='cancelled'` על Y, `charge` pending → `check_violation` | SQL 2c | `23514: campaign 49a4617b-… is cancelled: no charge allowed` | DESIGN-ONLY (נבדק) |
| `cancellation_charge` (collect) על מבוטל → נחסם | SQL 2d | `23514 … no cancellation_charge allowed` | DESIGN-ONLY (נבדק) |
| `authorize` **failed** (commit) על מבוטל → נחסם גם הוא | SQL 2e | `23514 … no authorize allowed` — הבדיקה היא על `effect`, לא על `outcome`; בזרימת האפליקציה השורה הראשונה היא תמיד pending ולכן זה לא מגביל בפועל | DESIGN-ONLY (נבדק) |
| `release` על מבוטל (parent = ה-authorize של Y שהוכנס לפני הביטול) → מתקבל | SQL 2f | `ACCEPTED, parent_slot=true` | DESIGN-ONLY (נבדק) |
| `refund` על מבוטל → מתקבל | SQL 2g | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| kind לא ברישום → `23503` (FK) ולא `23502` | SQL 2h (על Y המבוטל) ו-2i (על X הפעיל) | שניהם `23503 … violates foreign key constraint "payment_operations_kind_fkey"` — ה-`coalesce` עובד; `v_effect` null → התנאי `null in (...)` לא זורק | DESIGN-ONLY (נבדק) |
| campaign לא קיים → `23503` עם ההודעה של הטריגר | SQL 2j | `23503: campaign 00000000-… not found` | DESIGN-ONLY (נבדק) |
| בקרה: `charge` pending על X הפעיל מתקבל | SQL 2k | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| ה-`select … for update` נועל את שורת הקמפיין | SQL 2l: `campaigns.xmax = pg_current_xact_id()` על X אחרי ה-insert | `true` | DESIGN-ONLY (נבדק) |
| dry-run (a)-(g) על הגרסה החדשה | SQL 0a-0h | anon/auth `select=false`, `service_role=true` ×3; 0 policies; `citizen_id` exec anon=false/sr=true; 5 סוגים עם `once_per_parent` רק ל-`release`; **0** עמודות FK בלי אינדקס; 2 טריגרים; `confdeltype='r'`; `parent_uq` = `WHERE (parent_slot AND outcome = ANY('{pending,review,succeeded}'))`; `cancellation_uq` = `UNIQUE … ((meta ->> 'cancellation_request_id')) WHERE (meta ? 'cancellation_request_id')` | DESIGN-ONLY (נבדק) |

---

## 3. Backfill אידמפוטנטי לפי פעולה — `meta.backfill_key` (Task 4)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| `.not('meta->>backfill_key', 'is', null)` הוא supabase-js תקין | `node_modules/@supabase/postgrest-js/dist/index.d.cts:3175-3177`: שלושה overloads; `meta->>backfill_key` אינו `keyof Row` ולכן נופל ל-`not(column: string, operator: string, value: unknown)` — מתקמפל. runtime `index.cjs:1847-1849`: `searchParams.append(column, 'not.is.null')` → `meta->>backfill_key=not.is.null`, תחביר JSON-path של PostgREST. שימוש קיים בריפו: `.eq('meta->>callback_request_id', …)` ב-`admin/callbacks.ts:566`, `console-calls.ts:679`, `sales-call-attempts.ts:262`, `callback-request-attempts.ts:283`; `.not(col, 'is', null)` ב-`callback-scheduling.ts:145,793,968` | תקין | VERIFIED |
| (a) ריצה טרייה מכניסה 8 שורות | `main()` של Task 4 (שורות 794-902) הועתק לסקראצ'פד עם fake client שמממש את סמנטיקת האינדקסים של Task 1 (`one_pending_uq`, `once_uq`, `parent_uq`, `cancellation_uq`) ואת שלושת הקמפיינים כפי שנמדדו חי + שורת ה-`activity_log` | **8 שורות, 3 `payment_methods`**: X `authorize/app → release/provider_sync` (parent = ה-authorize של X, `occurred_at = 2026-09-23T06:00:29.021648+00:00`, `backfill_key = <X>:release:<אותו זמן>`); Y ו-Z `authorize → charge(0) → release/manual_backfill`; לכל 8 השורות יש `backfill_key` | DESIGN-ONLY (הורץ) |
| (b) קריסה אחרי ה-authorize ולפני ה-release של X → ריצה חוזרת מכניסה בדיוק את ה-release עם ההורה הנכון | הרצה: כל 8 השורות פחות ה-release של X קיימות; `main()` שוב | **נכשל: `insert release failed for 15a8730e`** — עוד לפני שהגיע ל-X. הסיבה: `done` נטען עם `.eq('source','app')`, ולכן שורות ה-`release` (`provider_sync`/`manual_backfill`) של Z ו-Y **לא נכנסות ל-`existingKey`**; ה-`every` נכשל, הלולאה מנסה להכניס `release` שכבר קיים → `parent_uq` 23505 → throw | **DEFECT** |
| (c) ריצה חוזרת מלאה לא מכניסה כלום | הרצה עם כל 8 השורות קיימות | **נכשל, אותה שגיאה** (`insert release failed for 15a8730e`) | **DEFECT** |
| (b)+(c) אחרי הסרת `.eq('source','app')` (וריאנט `backfill-fixed.ts`, שינוי של פילטר אחד) | אותן שתי הרצות | (c) עובר: 0 inserts, 0 payment methods. (b) מכניס בדיוק `[X, 'release', <id של ה-authorize הקיים>]` — **אבל `createPaymentMethod` נקרא שוב** (`pmCalls=1`): `payment_methods` כפול + secret כפול ב-Vault, וה-release מקבל `payment_method_id` של השורה החדשה בעוד ה-authorize מצביע על הישנה | **DEFECT שני** |
| `parentId` מתחדש מ-authorize קיים | קוד שורה 880: `if (already) { if (op.kind === 'authorize') parentId = already; continue; }` — הוכח ב-(b) המתוקן | נכון | DESIGN-ONLY (הורץ) |
| שורות ביטול: `backfill_key: cancel:<id>` + "rerun is also caught by cancellation_uq → 23505 → skip" | קוד שורות 897-899: ה-insert אינו בודק `existingKey` (המפתח נטען כי `source='app'`, אבל לא נבדק), ו-`if (e) throw` — 23505 **זורק**, לא מדלג. חי: 0 בקשות עם מסמך, אין השפעה מספרית היום | ההערה סותרת את הקוד | **DEFECT (סמוי)** |
| `keyOf` דטרמיניסטי בין ריצות | `occurred_at` מגיע מה-DB (`created_at` של `activity_log`, `authorized_at`/`charged_at` של `campaigns`) או מ-`plusOneSecond` על ערך DB — אותו מחרוזת בכל ריצה | נכון | DESIGN-ONLY (הליכה ביד) |

---

## 4. `payment_operations_cancellation_uq` ייחודי (Task 1)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| האינדקס נוצר כ-UNIQUE עם ה-predicate | SQL 0f: `pg_indexes.indexdef` | `CREATE UNIQUE INDEX … ((meta ->> 'cancellation_request_id')) WHERE (meta ? 'cancellation_request_id')` | DESIGN-ONLY (נבדק) |
| שתי שורות עם אותו `meta.cancellation_request_id` → השנייה 23505 על האינדקס הזה | SQL 4a/4b | `23505 on payment_operations_cancellation_uq` | DESIGN-ONLY (נבדק) |
| שורות בלי המפתח לא מושפעות | SQL 4d: שני `cancellation_charge` succeeded עם `meta={"other":"x"}` ו-`{}` | שניהם התקבלו; 4e: רק שורה אחת במערכת נושאת את המפתח | DESIGN-ONLY (נבדק) |
| שורה **failed** עם אותו מפתח | SQL 4c | **גם היא 23505** — ל-`cancellation_uq` אין סינון על `outcome` (בניגוד ל-`once_uq`/`parent_uq`). אם Task 5 ירשום ניסיון גבייה שנכשל עם `cancellation_request_id` ב-`meta`, ניסיון חוזר על אותה בקשה חסום לנצח | DESIGN-ONLY (נבדק) — ראה "מה לשנות" |

---

## 5. `once_per_parent` → `parent_slot` → `parent_uq` + ה-reconciler אחרי Contract (Task 1, 5, 8)

| טענה | איך אומת | תוצאה | תווית |
|---|---|---|---|
| seed: `release=true / refund=false` ברישום | SQL 0d | `release:void:once_c=false:once_p=true`, `refund:return:once_c=false:once_p=false` | DESIGN-ONLY (נבדק) |
| `release` succeeded עם parent → `parent_slot=true` | SQL 5a | `true` | DESIGN-ONLY (נבדק) |
| `release` שני succeeded לאותו parent → 23505 על `parent_uq` | SQL 5b | `23505 on payment_operations_parent_uq` | DESIGN-ONLY (נבדק) |
| `release` **pending** לאותו parent אחרי succeeded → נחסם | SQL 5c | `23505 on payment_operations_parent_uq` | DESIGN-ONLY (נבדק) |
| `release` **failed** לאותו parent → מתקבל (יוצא מה-predicate) | SQL 5d | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| שני `refund` succeeded לאותו parent (charge) → שניהם מתקבלים, `parent_slot=false` | SQL 5f | `false,false (both accepted)` | DESIGN-ONLY (נבדק) |
| `release` עם parent NULL → `parent_slot=false`, אין קונפליקט (שניים כאלה) | SQL 5e | `false,false`, שניהם התקבלו | DESIGN-ONLY (נבדק) |
| update של `parent_slot` → `check_violation` | SQL 5g (עם שינוי outcome: `only outcome, amounts, provider refs, occurred_at, note and meta may change on completion`), 5h (בלי: `pending → pending is not an allowed transition`) | שני המסלולים חסומים | DESIGN-ONLY (נבדק) |
| `pending release → succeeded` (ראשון ל-parent) מותר | SQL 5i | `ACCEPTED` | DESIGN-ONLY (נבדק) |
| הנחת יסוד: ה-reconciler היום מתאים לפי `hold_order_document_id` ↔ תיקיית SUMIT | `sumit-hold-reconcile.ts:70-76`: `select('id, event_id, hold_order_document_id, auth_amount').eq('capture_status','authorized').not('hold_order_document_id','is',null).or('release_status.is.null,release_status.neq.released')`; `:90` `byOrderDocId = new Map(entities.map(e => [e.orderDocumentId, e]))`; `:94` `byOrderDocId.get(row.hold_order_document_id)`; `:95` רק `billingStatus === SUMIT_HOLD_STATUS_RELEASED`. `orderDocumentId` = `Billing_OrderDocument[0].ID` (`crm-holds.ts:74`) | תואם לתיאור בשורות 60/1021/1083 של התוכנית | VERIFIED |
| הנחת יסוד: מה הוא כותב היום | `:97-102` CAS `update({ release_status: 'released' }).eq('id').or('release_status.is.null,release_status.neq.released').select('id')`; `:105` `recordReleaseActivity` → insert ישיר ל-`activity_log` `campaign.hold_released_synced` עם `meta={campaignId, holdOrderDocumentId, amount}` (`:48-63`); Slack `campaign_billing` (`:109-118`). לא נוגע ב-`auth_amount` (נקרא רק בשביל ה-meta) | תואם; `occurredAt = עכשיו` בתוכנית = זמן הזיהוי, כמו שורת ה-activity_log | VERIFIED |
| שאילתת המועמדים אחרי Contract ("authorize מוצלח עם `provider_document_id` בלי `release` מוצלח") ניתנת לביטוי על סכימת Task 1 | SQL 5j/5k: `from payment_operations a join kinds k … where k.effect='commit' and a.outcome='succeeded' and a.provider_document_id is not null and not exists (select 1 from payment_operations r join kinds rk … where r.parent_operation_id=a.id and rk.effect='void' and r.outcome='succeeded')` | 5j: `0 rows` (X כבר עם release succeeded; Y/Z בלי doc id) — 5k בלי ה-`not exists`: `X/doc=2327129322` בלבד. הביטוי עובד; ה-`payment_operations_parent_idx` (partial על `parent_operation_id is not null`) משרת את ה-`not exists` | DESIGN-ONLY (נבדק) |

---

## סיכום

| # | תיקון | תווית | פסק דין בשורה |
|---|---|---|---|
| 1 | `deriveStatus` — כל שורה לא-פתורה קובעת | DESIGN-ONLY (הורץ: 27/27 + 9/9 probes) | כל המקרים שהביקורת דרשה מחזירים את הערך הצפוי; 'declined' ו-'pending' לא נשברו. |
| 2 | `before_insert` בודק מצב קמפיין תחת הנעילה | DESIGN-ONLY (נבדק ב-rollback, 12 בדיקות; `guard_cancel` הושבת בתוך הטרנזקציה בלבד) | commit/collect על מבוטל → 23514; void/return מתקבלים; kind לא ידוע → 23503; שורת הקמפיין נעולה (xmax = xid). |
| 3 | Backfill אידמפוטנטי לפי `backfill_key` | **DESIGN-ONLY עם 3 DEFECTS** | ריצה טרייה נכונה (8 שורות); **ריצה חוזרת קורסת** (`.eq('source','app')` מסתיר את ה-release); אחרי תיקון הפילטר — `payment_methods` כפול בריצה חלקית; שורות ביטול זורקות במקום לדלג. |
| 4 | `cancellation_uq` UNIQUE | DESIGN-ONLY (נבדק) | 23505 על האינדקס הנכון; שורות בלי המפתח לא מושפעות; **גם `failed` נחסם** (אין סינון outcome). |
| 5 | `parent_slot` → `parent_uq` + reconciler | DESIGN-ONLY (נבדק, 9 בדיקות; הנחות הריפו VERIFIED) | release פעם אחת ל-parent (pending/succeeded חוסמים, failed לא); refund ×2 מותר; parent NULL בטוח; `parent_slot` immutable; שאילתת המועמדים ניתנת לביטוי ומחזירה את הצפוי. |

---

## מה התוכנית חייבת לשנות (מינימלי)

1. **Task 4 `main()`, שורה 851 — הסר את `.eq('source', 'app')`:** `admin.from('payment_operations').select('id, campaign_id, kind, meta, payment_method_id').not('meta->>backfill_key', 'is', null)`. בלי זה כל ריצה חוזרת (גם אחרי ריצה מלאה ומוצלחת) קורסת ב-`insert release failed` (23505 על `parent_uq`) — הוכח בהרצה.
2. **Task 4 `main()`, שורות 871-875 — `createPaymentMethod` רק כשאין authorize קיים:** אם `existingKey` מכיל את מפתח ה-`authorize` של הקמפיין, קח `payment_method_id` מהשורה הקיימת (לכן `payment_method_id` ב-select של סעיף 1) ואל תקרא ל-`createPaymentMethod`. אחרת ריצה חלקית יוצרת `payment_methods` + secret ב-Vault כפולים.
3. **Task 4 `main()`, שורות 891-899 — שורות ביטול:** לפני ה-insert `if (existingKey.has(\`cancel:${r.id}\`)) continue;`, ולתקן את ההערה "23505 → skip" (הקוד זורק). 0 שורות חיות היום, אבל הקוד סותר את ההערה.
4. **Task 1 — `payment_operations_cancellation_uq`:** להחליט: או `where meta ? 'cancellation_request_id' and outcome in ('pending','review','succeeded')` (עקבי עם `once_uq`/`parent_uq`, ניסיון חוזר אחרי כישלון אפשרי), או לתעד ש-`event-cancellation.ts` (Task 5) רושם `cancellation_charge` רק בהצלחה (כמו היום: `sumit_document_id` נכתב רק ב-resolve, `event-cancellation.ts:513-522`) ושניסיון שנכשל לא נושא את המפתח ב-`meta`.
5. **Task 2 (אופציונלי, תיעוד):** `deriveStatus` על שורות `effect='none'` מוצלחות בלבד מחזיר `declined`. אין סוג כזה ברישום; לתעד או להחזיר `none` במקרה הזה.
6. **Task 1 dry-run (j) — לציין** ש-`campaigns_guard_cancel` החי חוסם את ה-`update … status='cancelled'` על שלושת הקמפיינים (כולם `authorized`), ולכן הבדיקה דורשת `alter table public.campaigns disable trigger campaigns_guard_cancel` בתוך אותה טרנזקציית ROLLBACK (או קמפיין `draft` בלי תפיסה).

הריפו לא השתנה. ה-DB לא השתנה (הוכח בספירות לאחר ה-rollback, כולל `tgenabled` של `campaigns_guard_cancel` ו-`status` של Y). הקובץ היחיד שנכתב: דוח זה. חומרי העבודה (`verify5.sql`, `verify5.out`, `status*.ts`, `backfill*.ts`, `fake.ts`) בסקראצ'פד של הסשן.
