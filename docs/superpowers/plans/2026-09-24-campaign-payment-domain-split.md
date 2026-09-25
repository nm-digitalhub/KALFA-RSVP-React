# טבלת פעולות תשלום — הוצאת התשלום מטבלת `campaigns`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** כל דבר שקורה לכסף של קמפיין נרשם כשורה בטבלה אחת, `payment_operations`. מצב התשלום לא נשמר בשום עמודה: הוא מחושב מרצף השורות. `campaigns` נשארת עם הקמפיין בלבד.

**Architecture:** שלוש טבלאות חדשות, לא חשופות ל-Data API (רק `service_role`), RLS דלוק, בלי policies: `payment_methods` (אמצעי התשלום השמור; ת"ז ב-Vault), `payment_operation_kinds` (רישום סוגי הפעולות) ו-`payment_operations` (יומן של פעולות: אישור מסגרת, חיוב, שחרור מסגרת, גביית ביטול, החזר, כל דבר שיבוא). סוג הפעולה הוא **טקסט ברישום**, לא enum סגור: פעולה חדשה מחר היא שורה ברישום, לא מיגרציה. לרישום יש עמודת `effect` (`commit` / `collect` / `void` / `return` / `none`) שממנה קוד אחד מחשב את המצב לתצוגה, כך שגם החישוב לא תלוי בסוג ספציפי. **עובדה מכריעה למודל (הבעלים 24.9 23:02; `capture.ts:123-162`, נמדד חי 29.6):** החיוב הסופי הוא **חיוב חדש ועצמאי על הטוקן השמור**, לא מימוש של המסגרת; המסגרת נשארת פתוחה בנפרד עד ששוחררה. לכן `charge` הוא פעולה בלי הורה, ו-`release` הוא סיום ערובה (`void`), לא החזר כסף (`return`). המעבר הוא **Expand → Migrate → Contract**: קודם הטבלאות והכתיבה הכפולה, אחר כך הקוראים, ורק בסוף מחיקת 23 העמודות החיות ו-3 המתות של התשלום מ-`campaigns` (26; ועוד 2 מ-`event_cancellation_requests`). כל שלב פרוס וניתן להחזרה בנפרד.

**Tech Stack:** Supabase Postgres (מיגרציות ב-`supabase migration new` בלבד), Supabase Vault (הדפוס של `integration_connections`), `supabase-js` service-role בשרת, TypeScript, Zod 4, Vitest.

**Spec:** השיחה של 24.9 (הממצאים והחלטות הבעלים, מסוכמים למטה) + `plans/payment-events-implementation-plan.md` (1.7, יומן append-only שנעצר בהיקף כלי הבדיקה; תוכנית זו מחליפה אותו). **מקורות שנמדדו היום:** הקטלוג החי של `campaigns` (49 עמודות אחרי שהבעלים מחק את `auth_expires_at` ב-`ALTER TABLE`; `types.generated.ts` נוצר מחדש ב-20:52 ו-`types:check` עובר), הקוראים והכותבים של כל עמודה ב-`src/`, תיקיית תפיסות המסגרת ב-SUMIT, `src/lib/sumit/capture.ts:135` (SUMIT דורש `CreditCard_CitizenID` בגבייה מטוקן), changelog של Supabase 2026-04-28 (טבלאות חדשות לא נחשפות אוטומטית ל-Data API; אכיפה לכל הפרויקטים ב-2026-10-30).

## החלטות הבעלים (24.9)

1. השלב הראשון קבוע, רק הסוף מתחלף; מה שמוצג הוא **תרגום** של העובדות, לא עמודה נוספת.
2. **לא לתכנן סביב סוג פעולה ספציפי.** "תפיסה" היא מקרה אחד; חיוב ישיר של דמי ההפעלה (סכום מוגדר בחבילה, לא קבוע בקוד), החזר, או תשלום אחר חייבים להיכנס בלי שינוי מבנה.
3. שמות ניטרליים לתשלום (לא `hold`, לא `auth_*`, לא "תפוס").
4. הת"ז לא בעמודה. `auth_expires_at` אינו נתון (SUMIT לא מחזיר תפוגה לתפיסה) והבעלים כבר מחק אותו.

## הממצאים שהתוכנית מתקנת

| # | ממצא (נמדד 24.9) | תיקון | Task |
|---|---|---|---|
| 1 | `capture_status` נשאר `authorized` לתמיד; החיוב/השחרור נרשמים בעמודות אחרות; המסך הציג "תפוס" לשלושה מצבים | המצב מחושב מרצף הפעולות (`deriveStatus`), לא נשמר | 2, 6 |
| 2 | שלוש שכבות מצב בלי אילוצי ערכים; `captured`/`expired` תוכננו ואף קוד לא כתב אותם | פעולה = שורה עם `outcome` אחד; סוגים ברישום עם FK | 1 |
| 3 | `billing_route` ריק ב-3 מ-3 | נמחק (יחד עם ה-enum). "איך שולם" = `kind` של הפעולה | 8 |
| 4 | `card_citizen_id` בטקסט פתוח ב-`campaigns`; ל-`anon` יש GRANT SELECT על הטבלה (מחזיר 0 שורות רק בזכות ה-policy `camp_org_select`, שהיא ל-`authenticated`) | Vault דרך `payment_methods_write`; הטבלאות החדשות בלי grant ל-`anon`/`authenticated` בכלל | 1, 3 |
| 5 | שתי תפיסות (4 ₪, 152 ₪) שוחררו ב-SUMIT ב-07.07/21.07 בלי `release_status` | פעולת `release` עם `source='manual_backfill'` לפי מה שנמדד בתיקיית SUMIT | 4 |
| 6 | ערכים מתים ב-`campaigns.status` (`awaiting_invoice`,`billed`,`paid`) | לא נוגעים ב-enum; מתועד | 9 |
| 7 | 5 עמודות מתות ב-`campaigns` (נמדד 24.9: ברירת מחדל/null ב-3 מ-3): `billing_route`, `sumit_order_document_id`, `final_invoice_document_id` (תשלום), `enabled`, `steps` (קמפיין); `auth_expires_at` כבר נמחקה ידנית על ידי הבעלים | 3 המתות של התשלום נמחקות ב-Contract; `enabled`/`steps` ממתינות להחלטה; המחיקה הידנית מתועדת במיגרציה עם `if exists` | 8 |
| 8 | `sumit_customer_id` כפול: ב-`sumit_customers` וב-`campaigns` | נשאר רק ב-`sumit_customers` + `payment_methods.provider_customer_id` | 5, 8 |
| 9 | `event_cancellation_requests.sumit_document_id/_url` = פעולת תשלום שנכתבה לטבלה של תחום אחר | פעולה מסוג `cancellation_charge`; הטבלה מצביעה עליה | 4, 7 |

## מפת השפעה — היכן משתמשים במה שמפוצל (נמדד 24.9, 22:00)

נמדד בשני מקורות: `pg_depend` + חיפוש בגוף כל פונקציה/view/policy/trigger ב-DB החי, ו-grep על כל 28 שמות העמודות (26 ב-`campaigns` + 2 ב-`event_cancellation_requests`) ב-`src/`, `worker/`, `scripts/`, `supabase/functions/`. **אומת 24.9 22:19 על ידי סוכן `sumit-billing-expert` במעקב זרימת נתונים (לא grep):** 6 החמצות (★★ למטה: camelCase, טיפוסים ו-guards ש-grep לא רואה) ו-3 שגיאות שתוקנו: (א) `campaign_committed_amount` ניכה שחרור והיה מפיל את תקרת הנמענים של קאקון ל-0 → עכשיו "ה-commit המוצלח האחרון", זהה ל-`deriveStatus().committed`; (ב) מחיקת עמודות הנעילה בלי תחליף → אינדקסים `one_pending_uq` + `once_uq` (snapshot `once_slot`, נעילת שורת הקמפיין ב-`before_insert`; הבעלים 25.9: טריגר `exists` אינו נעילה ב-read committed) + `beginOperation`/`completeOperation` (Task 1, 5), `resolvePaymentReview` לאדמין (Task 7) וטריגר `campaigns_guard_activate` (Task 8); (ג) `sumit-customers.ts` שובץ בטעות. **החלטת הבעלים 25.9 03:10 — התקרה הכבולה למסגרת מבוטלת:** `funded_cap` מוסר משתי פונקציות ההקפאה (Task 8), אין `campaign_committed_amount`, שומר ההפעלה בודק אמצעי תשלום בלבד. נמדד: המנגנון חי ב-DB (מיגרציית 2.9) אך מעולם לא הופעל; `billing_exposure_gate` דלוק מאז 24.9 09:36 ולכן חברות ברשימה המוקפאת כבר לא נדרשת לחיוב. **VERIFY-5 25.9 01:34 (42 בדיקות ב-rollback + vitest על ה-TypeScript של Task 2/4): תיקונים 1, 2, 4, 5 מחזיקים; תיקון 3 (backfill) — 3 פגמים שהוכחו בהרצה ותוקנו: פילטר `source` שהסתיר את שורות ה-`release`, יצירת `payment_methods` כפולה בריצה חוזרת, ושורות ביטול בלי בדיקת מפתח; `cancellation_uq` משחרר על `failed`; `effect='none'` בלבד → `none`.** **סבב חמישי 25.9 01:25 (ביקורת חיצונית של הבעלים, 5 פערים שלא היו בהיקף VERIFY-4 — כולם מיושמים):** `deriveStatus` — כל שורה `review`/`pending` קובעת, לא רק האחרונה; `before_insert` בודק את מצב הקמפיין תחת הנעילה וחוסם `commit`/`collect` על מבוטל; backfill אידמפוטנטי לפי פעולה (`meta.backfill_key`); `cancellation_uq` ייחודי; `once_per_parent` → `parent_slot` → `parent_uq` + reconciler אחרי Contract מהיומן. **אימות רביעי 25.9 01:10 (`VERIFY-4.md`, מול ה-DB החי ב-begin…rollback, 36 בדיקות התנהגות): נקודות 1-4 DESIGN-ONLY ונבדקו (SQL של Task 1 התקבל; `for update` נועל; `once_uq` חוסם pending/review/succeeded ולא failed; 14 מעברי `guard_update` כמתואר; CAS מחזיר 0 שורות בלי להגיע לטריגר); נקודה 5 תוקנה: אין חיפוש ב-SUMIT לפי `ExternalIdentifier` (probe לפי תאריכים+CustomerID+Amount) ואין timeout על קריאות SUMIT (נוסף `AbortSignal.timeout(60s)`).** **ביקורת שלישית 25.9 00:10 (`AUDIT-3.md`): 19/21 נפתרו, 2 חוסמים + 6 חשובים + 12 קלים חדשים — כולם מיושמים בגרסה זו** (מפתח `campaignId` ב-backfill; נעילת "פעם אחת" באינדקס `once_uq` (snapshot `once_slot`), לא בטריגר; `authorize` פעם אחת; `paused` בשומר ההפעלה; אי-אטומיות של `db push` מתועדת; גבול ה-admin client לקריאת היומן; `listAttentionCampaigns` במקום `ADMIN_ATTENTION_FILTER`; תוויות הקבלה של Task 6; `default null` ב-RPC; ועוד). **ביקורת שנייה 24.9 23:08 (`rls-schema-engineer`, שורה-שורה; הדוח ב-`2026-09-24-campaign-payment-domain-split-AUDIT.md`): 22 ממצאים, כולם מיושמים בגרסה זו**, למעט אחד שהבעלים דחה במפורש (מחיקה ישירה מהטבלה על ידי `service_role`: "אין שום סיבה שמישהו ימחוק ישירות, מדובר באנשי צוות שלנו" → ההרשאות של `service_role` נשארות ברירת המחדל של Supabase כמו בכל טבלה אחרת). תיקונים עיקריים: זמני השחרור (לא נמדדו; `Billing_Date` = זמן התפיסה), סגירה ב-0 = פעולת `charge` בסכום 0 עם הזיכוי שקוזז, `charge` עצמאי ולא `capture`, `on delete restrict`, v7 גם ב-RPC, חתימת `owner_agent_billing_sums` נשמרת, ספירות 23/26(+2), `fake-table-client` מורחב ב-Task 5 שלב 0. הסוכן אישר נקי: views, policies, פונקציות מחוץ ל-`public`, edge functions, `src/lib/workflow`, Zod, fleet, seed, תבניות מייל/הסכם, רשימת 20 הבדיקות. **כל פריט משובץ ל-Task; מה שלא היה בתוכנית מסומן ★, ומה שרק הסוכן מצא ★★.**

### א. אובייקטים ב-DB (חייבים להשתנות לפני Contract, אחרת `drop column` נכשל או שובר לוגיקה)

| אובייקט | מה הוא קורא | מה הוא עושה | תיקון | Task |
|---|---|---|---|---|
| ★ `campaigns_guard_cancel()` (trigger על `campaigns`) | `capture_status`, `charge_status` | חוסם `status='cancelled'` אם יש תפיסה חיה או חיוב | הבדיקה הופכת ל-"אין ב-`payment_operations` פעולה עם `outcome in ('succeeded','pending','review')` ו-`effect<>'none'`"; `create or replace function` בלבד — הטריגר וה-SECDEF הקיימים נשמרים (audit finding 18) | 8 |
| ★ `cancel_campaign()` (RPC) | `capture_status`, `charge_status` | אותו תנאי, בצד ה-RPC | אותו תיקון | 8 |
| ★ `owner_agent_billing_sums(_since)` (RPC של הסוכן) | `final_charge_amount`, `charge_status`, `charged_at`, `credit_applied` | מחזירה **4 עמודות** (`charged_amount, credit_applied_amount, unvoided_credit_amount, credit_granted_amount`; השתיים האחרונות מ-`billing_credits`; הצרכן קורא את כולן, `cores/billing.ts:67-70`) | **החתימה נשמרת**; רק שתי הראשונות משתנות: `sum(amount)` / `sum(credit_applied)` על `payment_operations` join `kinds` where `effect='collect' and outcome='succeeded' and occurred_at >= _since` (כולל `charge` בסכום 0 — audit finding 2) | 7 |
| ★ `reconcile_authorized_set(...)` (RPC, הקפאת נמענים; נקראת מ-`contacts.ts:268`) | `auth_amount` | תקרת נמענים: `included + floor((auth − base) / price)` | **ה-cap מוסר** (הבעלים 25.9: התקרה הכבולה למסגרת מבוטלת; אף פעם לא הופעלה בפועל — 0 שורות לוג, 0 שורות ביקורת). כל אורח כשיר מתקבל לרשימה. הפונקציה החיה היא SECDEF; `create or replace` שומר אותה כפי שהיא | 8 |
| ★ `try_record_billed_result(...)` (RPC, רישום נמען שהושג; נקראת מ-`billing.ts:34` לכל נמען) | `auth_amount` | אותה תקרה בזמן אמת (`ceiling_reached`) | **ה-cap מוסר**: כל נמען עם חשיפה אמיתית (`exposed_for_billing`) מחויב | 8 |
| `billing_route` (enum) | העמודה `campaigns.billing_route` בלבד | אין קוראים | `drop column` ואז `drop type` | 8 |
| `campaigns_require_active_event`, `trg_campaigns_updated`, שני הטריגרים של `event_cancellation_requests` | לא נוגעים בעמודות המפוצלות | — | ללא שינוי | — |
| views (`console_campaigns` ועוד) | אף view לא קורא עמודה מפוצלת (נמדד ב-`pg_depend` וב-`pg_views`) | — | ללא שינוי | — |
| policies | אף policy לא מפנה לעמודה מפוצלת | — | ללא שינוי | — |

> **התקרה (הבעלים 25.9):** `funded_cap` בשתי הפונקציות נגזר מסכום המסגרת שנתפסה. הוא מעולם לא הופעל (0 שורות `ceiling_full`/`ceiling_reached` בלוגים, 0 ברישום הביקורת), ובקמפיין החי היה חוסם הזמנה מהאורח הראשון שמעבר לכמות הכלולה. הוא **מוסר** ב-Task 8, לא מועבר ליומן. החיוב מוגבל במספר האנשים שהושגו בפועל.

### ב. קוד — לפי Task

| קובץ | עמודות | תיקון | Task |
|---|---|---|---|
| `src/lib/data/campaigns.ts` | 22 עמודות: כל הכתיבה של תפיסה/חיוב + `CAMPAIGN_COLUMNS` | כותב: Task 5; קורא/`OwnerCampaign`: Task 7 | 5, 7 |
| `src/lib/data/close-charge.ts` | `card_*`, `sumit_customer_id`, `auth_external_ref`, `capture_status`, `charge_status`, `credit_applied` | הכרטיס מ-`payment_methods` (+ ת"ז מ-Vault), ההרשאה מפעולת `authorize`, החיוב = פעולת `charge` עצמאית (בלי הורה); סגירה ב-0 = `charge` בסכום 0 עם הזיכוי | 5, 7 |
| `src/lib/data/sumit-hold-reconcile.ts` | `auth_amount`, `capture_status`, `hold_order_document_id`, `release_status` | מתאים לפי `provider_document_id` של פעולת `authorize`; כותב פעולת `release` | 5, 7 |
| `src/lib/data/event-cancellation.ts` | `card_*`, `auth_external_ref`, `charge_status`, `credit_applied`, `final_charge_amount`, `sumit_document_id/_url` | כרטיס מ-`payment_methods`; גביית ביטול = פעולת `cancellation_charge` | 5, 7 |
| `src/lib/data/admin/campaigns.ts` + `campaign-hold-badge.ts` + `src/app/(admin)/admin/campaigns/page.tsx` | `capture_status`, `charge_status`, `release_status`, `credit_applied`, `final_charge_amount`, `hold_order_document_*` | מסך הקמפיינים קורא מהיומן | 6 |
| ★ `src/app/(customer)/app/events/[id]/campaign/[campaignId]/page.tsx` + `manage-client.tsx` | `capture_status`, `charge_status`, `credit_applied`, `final_charge_amount` | מסך הקמפיין של הלקוח: `payment` מ-`deriveStatus` במקום 4 העמודות | 7 |
| ★ `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/page.tsx` | `capture_status`, `auth_amount` | "כבר אושר?" = `status in ('committed','collected')`; הסכום = `committed` | 7 |
| ★ `src/app/(customer)/app/events/[id]/event-summary.tsx` | `charge_status`, `final_invoice_document_id` | `final_invoice_document_id` מת (ריק ב-3/3) → מסמך החיוב = `provider_document_url` של פעולת ה-`collect` | 7 |
| ★ `src/app/(customer)/app/events/[id]/stats/page.tsx`, `src/lib/data/event-stats.ts` | `capture_status`, `card_*`, `charge_*`, `credit_applied`, `final_charge_amount` | מהיומן | 7 |
| ★ `src/app/api/campaigns/[id]/authorize/route.ts` | `auth_number`, `authorized_at`, `capture_status` | קורא ל-`recordCampaignHold` (Task 5); ההערות והתשובה ל-client מתעדכנות | 5 |
| ★ `src/lib/data/admin/callbacks.ts:652` | `authorized_at` | "מתי נתפסה המסגרת הראשונה" = `min(occurred_at)` של `authorize` מוצלח | 7 |
| ★ `src/lib/data/admin/users.ts:278`, `src/lib/data/billing.ts:113` | `credit_applied` | יתרת זיכוי לאירוע = מוענק − `sum(credit_applied)` על פעולות `collect` מוצלחות, **כולל `charge` בסכום 0** (audit finding 2: היום 84 ₪ ו-4 ₪ מנוצלים בקמפיינים שנסגרו ב-0; היתרות של האירועים `294d23e1` ו-`659ae5e7` חייבות להישאר 0 ו-6) | 7 |
| ★ `src/lib/data/tax-ceiling.ts:30` | `final_charge_amount`, `charge_status`, `charged_at` | הכנסה שנתית = `sum(amount)` על `collect` מוצלח מתחילת השנה (אותה שאילתה כמו `owner_agent_billing_sums`; להוציא ל-`src/lib/payments/sums.ts` ולהשתמש בשניים) | 7 |
| ★ `src/lib/data/admin/sumit-test.ts:40`, `scripts/sumit-doc-check.ts:45` | `card_*`, `sumit_customer_id` | כלי אבחון: "קמפיין עם כרטיס שמור" = `payment_methods` פעיל | 7 |
| `src/lib/data/sumit-customers.ts` | — | **לא נוגע ב-`campaigns`** (verifier): משווה `sumit_customers.sumit_customer_id` לתשובת SUMIT. ללא שינוי | — |
| `src/lib/data/event-labels.ts`, `setup-steps.ts` | `capture_status` | `PaymentStatus` | 6, 7 |
| `src/lib/owner-agent/cores/billing.ts`, `cores/campaigns.ts`, `consumer/primer.ts`, ★ `consumer/reply-text.ts` | 11 שמות עמודות | הסוכן קורא מהיומן; ה-primer מתאר את הטבלאות החדשות; `stuckHolds` שומר את ההתנהגות של היום (`pending`, **`failed`**, `review` — `STUCK_CAPTURE_STATUSES` כולל `hold_failed`, `cores/campaigns.ts:45`) | 7 |
| ★ הערות בלבד: `src/lib/queue/queues.ts:184`, `worker/main.ts:1532`, `src/lib/sumit/capture.ts:21`, `crm-holds.ts:15,29`, `hold-status.ts:18` | שמות עמודות בהערות | עדכון ההערות ב-Contract | 8 |
| ★★ `src/app/(admin)/admin/cancellations/[id]/page.tsx:41,44,96` (verifier, camelCase) | `campaign.chargeStatus`, `campaign.hasCardOnFile` דרך ה-DTO של `getCampaignForEventAdmin` | "לפני חיוב / יש כרטיס" מ-`payment.status` ומ-`payment_methods` | 7 |
| ★★ אותו דף, שורות 124-126 (verifier) | `request.sumitDocumentUrl` ← `ADMIN_SELECT` ← `sumit_document_url` | ה-URL מפעולת `cancellation_charge` | 7 |
| ★★ `src/lib/data/campaigns.ts` `activateCampaign` (verifier) | `.eq('capture_status','authorized')` כ-guard אטומי ב-UPDATE (לא קורא, לא כותב) | טריגר `campaigns_guard_activate` | 5, 8 |
| ★★ `src/lib/data/campaigns.ts` `lockCampaignForHold` / `lockCampaignForCharge` / `markCampaignChargeOutcome` (verifier) | UPDATE מסונן על `capture_status`/`charge_status` = ה-mutex של "חיוב פעם אחת" | `beginOperation`/`completeOperation` (compare-and-set: `from`) + אינדקסים `one_pending_uq`/`once_uq` + טריגר `guard_update` | 1, 5 |
| ★★ `src/app/(customer)/app/events/[id]/page.tsx:342` → `setup-steps.tsx:49-63` (verifier) | `OwnerCampaign` → `computeSetupSteps` דורש `capture_status` בטיפוס | מתעדכן בגרירה עם `SetupInput` | 7 |
| ★★★ **פער קיים היום, לא רק בתוכנית** (owner 25.9): קריסת תהליך אחרי הנעילה ולפני הרישום (`authorize/route.ts:138-262`, `close-charge.ts:330-410`) משאירה `capture_status`/`charge_status='pending'` לנצח; אין sweeper, אין פעולת אדמין, `lockCampaignFor*` מסרב לנסות שוב, ואין קוד שמחפש חיוב ב-SUMIT לפי `ExternalIdentifier` | — | job `payment-orphans` + `probeSumitOperation` + `resolvePaymentReview` | 5, 7 |
| ★★ `.claude/agents/shared/tax-catalog-israel.md:70,194` (verifier) | מתאר התנהגות לפי `charge_status='charged'`/`charged_at` | §ד | 9 |

### ג. בדיקות שיישברו (20 קבצים) — כל אחת מתעדכנת באותו Task כמו הקובץ שהיא בודקת

`authorize/route.test.ts`, `close-charge/route.test.ts`, `whatsapp-send/route.test.ts`, `admin/callbacks.test.ts`, `admin/campaign-hold-badge.test.ts` (נמחק ב-6), `admin/users.test.ts`, `billing.test.ts`, `campaign-lifecycle-parity.test.ts`, `campaigns.test.ts`, `close-charge.test.ts`, `event-cancellation.test.ts`, `event-labels.test.ts`, `event-stats.test.ts`, `reconcile.integration.test.ts` (★ בודק את `reconcile_authorized_set` על DB בדיקה בלבד — `OUTREACH_DB_IT=1`, נכשל בכוונה מול prod; רץ אחרי Task 8 רק אם יוקם DB בדיקה עם `pg_tle`+`dbdev`), `setup-steps.test.ts`, `sumit-hold-reconcile.test.ts`, `tax-ceiling.test.ts`, `owner-agent/consumer/primer.test.ts`, `owner-agent/cores/billing.test.ts`, `owner-agent/cores/campaigns.test.ts`.

### ד. תיעוד שמזכיר את העמודות (מתעדכן ב-Task 9)

`docs/project/03-database-schema.md`, `04-events-and-lifecycle.md`, `06-campaigns-and-outreach.md`, `08-billing-and-payments.md`, `10-api-and-webhooks.md`, `docs/schema-and-architecture.md`, `docs/sumit-payments-implementation.md`, `docs/sumit-response-capture-and-audit.md`, `.claude/agents/sumit-billing-expert.md`, `.claude/agents/campaign-outreach-engineer.md`, ★★ `.claude/agents/shared/tax-catalog-israel.md:70,194`. תוכניות ישנות ב-`plans/` ו-`docs/superpowers/plans/2026-06-26-*` נשארות כהיסטוריה עם הערת "הוחלף" בראש.

## ביקורת מול supabase-postgres-best-practices (24.9, 21:05)

| כלל | מה נבדק | תוצאה |
|---|---|---|
| schema-foreign-key-indexes | כל FK ב-`payment_operations`/`payment_methods` | תוקן: נוספו אינדקסים ל-`event_id`, `payment_method_id`, `parent_operation_id`; `owner_user_id` הפך לאינדקס מלא (cascade מ-`auth.users`). `kind` לא מאונדקס בכוונה (רישום של 5 שורות, אין מחיקה ממנו). `campaign_id`/`event_id` ב-`on delete restrict` כמו `billed_results` (audit finding 9). בדיקה (e)+(g) ב-dry-run |
| schema-primary-keys | uuid v4 מפצל אינדקסים | **תוקן 21:49:** הבעלים התקין `cem-uuidv7` 1.0.2 בסכימה `extensions`; אומת חי: `extensions.uuid_generate_v7()` מחזירה v7 (nibble 7), מונוטונית, ו-`service_role` יכול להריץ. שתי הטבלאות החדשות ב-v7, גם ב-RPC `payment_methods_write` (audit finding 5). שאר 96 הטבלאות נשארות v4 (לא נוגעים) |
| schema-data-types | `numeric(12,2)` לכסף, `timestamptz`, `text` ולא `varchar`, `bigint` למזהי ספק | תואם |
| schema-constraints | `add constraint if not exists` אסור | לא בשימוש; אילוצים inline ב-`create table` |
| security-privileges | least privilege | בלי grant/policy ל-`anon`/`authenticated`; `service_role` בברירת המחדל של Supabase (החלטת הבעלים); append-only נאכף בטריגר `guard_update`; "פעם אחת" נאכף באינדקס `once_uq` (btree, אטומי), לא בטריגר |
| security-rls-basics | RLS על כל טבלה ב-`public` | דלוק, אפס policies, בלי grants ל-`anon`/`authenticated` |
| advanced-jsonb-indexing | חיפוש על `meta->>'cancellation_request_id'` | תוקן: expression index חלקי |
| query-composite-indexes | `loadOperations` מסנן `campaign_id` וממיין `occurred_at` | `(campaign_id, occurred_at desc)`: שוויון ואז טווח |
| data-n-plus-one | `openCommitments` בסוכן | תוקן ב-Task 7: שאילתה אחת + חישוב בזיכרון |
| lock-short-transactions | הכתיבה ליומן אחרי קריאת SUMIT | `recordOperation` הוא insert בודד אחרי ה-HTTP, לא בתוך טרנזקציה פתוחה; Contract מוריד 26 עמודות על 3 שורות תחת `lock_timeout='5s'` (ACCESS EXCLUSIVE שמחכה ל-`for update` פתוחים; לא "מילישניות" — נמדד בזמן הריצה) |

## Global Constraints

- **מיגרציות רק ב-`npx supabase migration new <name>`**; לעולם לא שם ידני. החלה רק ב-`npx supabase db push --linked` אחרי `--dry-run` שמציג רק את הקובץ החדש, ורק **בידי הבעלים**.
- **אחרי כל מיגרציה:** `npm run gen:types && npm run types:check`. **`src/lib/supabase/types*.ts` לעולם לא בעריכה ידנית.**
- **`npx supabase db advisors --linked --type security` אחרי כל מיגרציה**; אין ממצא חדש על האובייקטים החדשים.
- **טבלאות חדשות:** `enable row level security`; `revoke all … from public, anon, authenticated`; **בלי** grant ל-`anon`/`authenticated` ובלי policy עבורם. `service_role` מחזיק את הרשאות ברירת המחדל של Supabase (ה-default ACL של `public` מעניק לו `arwdDxtm` על כל טבלה חדשה; נמדד 24.9) — כמו בכל טבלה אחרת בפרויקט, **בהחלטת הבעלים** ("אין שום סיבה שמישהו ימחוק ישירות מהטבלה, מדובר באנשי צוות שלנו"). מה שכן נאכף ב-DB (לא ברמת ההרשאות): `guard_update` מתיר רק `pending → succeeded|failed|review` ו-`review → succeeded|failed` ואוסר שינוי של זהות השורה (`once_slot`/`parent_slot` כלולים); `before_insert` נועל את שורת הקמפיין, חוסם `commit`/`collect` על קמפיין מבוטל ומצלם את דגלי הרישום; `once_uq`/`parent_uq`/`cancellation_uq`/`one_pending_uq` אוכפים ייחודיות.
- **RLS על `campaigns` לא משתנה** בתוכנית הזו.
- **אין `SECURITY DEFINER` חדש.** פונקציות Vault הן `security invoker` + `set search_path = ''` + `revoke execute from public, anon, authenticated` + `grant execute to service_role`, הדפוס של `20260916002343_integration_credential_store.sql`.
- **היומן נקרא רק דרך `createAdminClient()`, אחרי בדיקת בעלות** (`requireOwnedEvent`/`requireEventAccess`/`requirePlatformPermission`). ל-`authenticated` אין grant ולא policy על `payment_*`, ולכן `loadOperations` עם ה-cookie client או embed של `payment_operations` בתוך `CAMPAIGN_COLUMNS` (שנקראת ב-`getCampaign`/`listCampaignsForEvent`/`getCampaignForEvent`/`getCampaignStageForEvent`, `campaigns.ts:287-366`, cookie client) נכשלים ב-42501 (audit-3 #28). הדפוס: הקורא של הקמפיין נשאר cookie; `payment` מצורף בשלב שני דרך admin.
- **שלמות ב-DB (owner 25.9 01:47):** `event_id` נגזר מהקמפיין הנעול ולא מהקלט; הורה חייב להיות מאותו קמפיין ומוצלח; מסמך SUMIT נרשם פעם אחת (`doc_uq`); `effect`/דגלי הרישום בלתי-ניתנים לשינוי (סוג חדש במקום עריכה). **לא נאכף בכוונה:** התאמה בין `payment_methods.owner_user_id` לבעל האירוע — עם ריבוי בעלים (`approved_by` לעומת `events.owner_id`) אין כלל אחד נכון; הקוד מעביר את הבעלים הנכון (`approved_by`).
- **ייחודיות נאכפת רק באינדקס ייחודי, לעולם לא בטריגר עם `exists`** (הבעלים 25.9; `default_transaction_isolation = read committed` נמדד): טריגר שבודק "אין עדיין שורה" לא רואה טרנזקציה מקבילה שטרם עברה commit. הרישום מגדיר (`once_per_campaign`, `once_per_parent`), הטריגר מצלם לעמודה (`once_slot`, `parent_slot`), ה-btree אוכף (`once_uq`, `parent_uq`). `pending`, `review` ו-`succeeded` תופסים את המקום; `failed` משחרר.
- **כל השלמה של פעולה היא compare-and-set:** `completeOperation(id, { from: 'pending'|'review', … })` = `update … where id = $id and outcome = $from`; 0 שורות → שגיאה. זרימות האפליקציה תמיד `from: 'pending'`; `resolvePaymentReview` של האדמין תמיד `from: 'review'`. `review` חוסם עד הכרעה ידנית (שינוי מתועד מול היום).
- **כל קריאה ל-SUMIT עם `signal: AbortSignal.timeout(60_000)`** (`authorize.ts`, `capture.ts` ×2, `charge.ts`, `raw-charge.ts`, `probe.ts`); היום אין timeout באף אחת מהן (VERIFY-4). `AbortError` → `SumitNetworkError` → `review` באותו תהליך.
- **קריסה באמצע פעולה לעולם לא נפתרת בניסיון חוזר אוטומטי.** שורת `pending` יתומה הופכת ל-`review` (job `payment-orphans`, Task 5 שלב 5א) ונפתחת רק בהכרעה ידנית אחרי בדיקה ב-SUMIT (Task 7 שלב 0א). `once_uq` מבטיח שבינתיים אין פעולה מקבילה.
- **סוגי פעולה הם נתונים, לא קוד:** קוד לא משווה ל-`kind` ספציפי כדי לחשב מצב; הוא קורא `effect` מהרישום. השוואה ל-`kind` מותרת רק בכותב שיוצר את הפעולה.
- **Expand → Migrate → Contract:** שום Task לא מוחק עמודה מ-`campaigns` לפני Task 8. עד אז הקוד כותב לשני המקומות (Task 5) והבדיקות מוכיחות שוויון.
- **`reconcile.integration.test.ts` לא רץ מול ה-DB החי** (הבדיקה עצמה נכשלת בכוונה אם היא מופנית ל-prod, `reconcile.integration.test.ts:7-16`, ודורשת `OUTREACH_DB_IT=1` + DB בדיקה). אין DB בדיקה כזה כרגע. האימות של Task 8 מול החי הוא קריאה בלבד (`pg_get_functiondef` של שתי הפונקציות, בדיקת השומר ב-dry-run), והבדיקה מסומנת "דורשת DB בדיקה עם `pg_tle` + `dbdev.install('cem-uuidv7')`" עד שיוקם.
- **`create extension "cem-uuidv7"` עובד רק במקום שה-TLE הותקן דרך dbdev** (הוא לא ב-`pg_available_extensions`, רק ב-`pgtle.available_extensions()`; נמדד). על ה-DB החי זה no-op. על DB טרי צריך קודם `pg_tle` + `dbdev` + `dbdev.install`.
- **פריסה בידי הבעלים בלבד** (`npm run deploy`), אחרי Task 5 ואחרי Task 7, לפני Task 8. אין `next build` במקביל.
- **אין `any`; Zod בגבולות; שגיאות למשתמש בעברית וגנריות. `events.event_date` לעולם לא `slice(0,10)`.**
- **כל Task = commit נפרד** עם ה-trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` ו-`Claude-Session: https://claude.ai/code/session_01T7V4yCBdhLzRsq8LHfd13g`. `types.generated.ts` כבר עודכן ונכנס ל-commit `091b22d` (24.9 22:59: הסרת `auth_expires_at`, PostgREST 14.15, ו-3 פונקציות `scatter*` של `olirice-asciiplot` שהבעלים בחר להשאיר).

## Review Focus

1. **קמפיין ששוחרר ב-SUMIT ולא נגבה** (המצב של קאקון היום, וגם של שני הסגורים): רצף `authorize→release` בלי `charge` → "שוחרר ללא גבייה", לא "אושר"; ו-`authorize→charge→release` → נשאר "נגבה" (שחרור הערובה אחרי גבייה לא מחזיר כסף). (Task 2.)
2. **חיוב שנכשל ואז הצליח:** שתי שורות `charge` (failed, succeeded); המצב "נגבה" פעם אחת; `charge` נוסף לאותו קמפיין (pending/review/succeeded חי) נדחה על ידי האינדקס `once_uq` בכל רמת בידוד. **`review` לא משחרר את הנעילה** (SUMIT אולי חייב): רק הכרעה ידנית `review → succeeded|failed` (שינוי מול היום, שבו `charge_review` ניתן לניסיון חוזר אוטומטי, `campaigns.ts:783-792`). סגירה ב-0 עם זיכוי היא `charge` מוצלח בסכום 0 עם `credit_applied`, לא "אין פעולה". (Task 1, 5.)
3. **קמפיין בלי אף פעולה** (לא עבר backfill, או נוצר לפני התפיסה): `deriveStatus([])` = `none`; המסך מציג "—"; הסוכן אומר "אין פעולות תשלום", לא "פתוח". (Task 2, 7.)
4. **`anon` מנסה `select` על `payment_operations` דרך Data API:** permission denied, לא שורות ריקות. (Task 1, dry-run.)
5. **סוג פעולה חדש** (למשל `immediate_charge` עם `effect='collect'`) נוסף לרישום בלי שינוי קוד: `deriveStatus` מחזיר "נגבה" ו-`paymentBadge` מציג אותו. (Task 2, בדיקה עם kind מומצא.)
6. **קריסה של התהליך באמצע פעולה** (pm2 kill / deploy / OOM אחרי `beginOperation` ולפני `completeOperation`): השורה נשארת `pending` ונועלת. היום (`capture_status='pending'`/`charge_status='pending'`) זה תקוע לנצח בלי sweeper ובלי פעולת אדמין; בתוכנית: job `payment-orphans` מעביר `pending` ישן מ-10 דקות ל-`review` + Slack, והאדמין מכריע דרך `resolvePaymentReview` אחרי בדיקה ב-SUMIT (`probeSumitOperation`: חלון תאריכים + `CustomerID` + סכום; אין ב-SUMIT חיפוש לפי `ExternalIdentifier` — VERIFY-4). אין חיוב כפול בשום שלב, כי `once_uq` מחזיק גם על `review`. (Task 5 שלב 5א, Task 7 שלב 0א.)
7. **`review` שאינו הפעולה האחרונה** (ביקורת חיצונית 25.9): `authorize → charge(review) → release(succeeded)` חייב להציג "נדרשת בדיקה ידנית", לא "שוחרר". כל שורה `review`/`pending` בכל מקום ברצף קובעת; `review` גובר על `pending`. (Task 2; הורץ ב-VERIFY-5.)
8. **ביטול שעבר commit רגע לפני תחילת חיוב:** `before_insert` נועל את שורת הקמפיין ורק אז קורא את מצבו; `commit`/`collect` על קמפיין `cancelled` נזרק (`check_violation`), `release`/`refund` עליו מותרים. (Task 1; הורץ ב-VERIFY-5 עם 12 בדיקות.)
9. **ריצה חוזרת של ה-backfill אחרי קריסה באמצע קמפיין:** אידמפוטנטיות לפי פעולה (`meta.backfill_key`), בלי פילטר `source`, בלי יצירת `payment_methods` שני, ושורות ביטול מדלגות על מפתח קיים. ריצה מלאה חוזרת = 0 הכנסות. (Task 4; VERIFY-5 מצא את שלושת הפגמים בגרסה הקודמת, התיקון עדיין לא הורץ.)

---

### Task 1: מיגרציה Expand — `payment_methods`, `payment_operation_kinds`, `payment_operations`, Vault, ACL

**Files:**
- Create: `supabase/migrations/<timestamp>_payment_operations_expand.sql` (השם נוצר ב-CLI)
- Commit also: `src/lib/supabase/types.generated.ts`

**Interfaces:**
- Produces: הטבלאות `public.payment_methods`, `public.payment_operation_kinds` (5 סוגים; `effect` ∈ commit/collect/void/return/none; `once_per_campaign`), `public.payment_operations`; ה-enum `payment_operation_outcome` (`pending|succeeded|failed|review`); הטריגרים `payment_operations_before_insert` (נעילת שורת הקמפיין + snapshot של `once_slot`) ו-`payment_operations_guard_update` (מעברים מותרים בלבד); האינדקסים `one_pending_uq` ו-`once_uq`; הפונקציות `public.payment_methods_write(...)` ו-`public.payment_method_citizen_id(p_id uuid)` (`security invoker`, `service_role` בלבד).

- [ ] **Step 1: צור את הקובץ עם ה-CLI**

```bash
cd /var/www/vhosts/kalfa.me/beta && npx supabase migration new payment_operations_expand && ls supabase/migrations | tail -1
```

- [ ] **Step 2: כתוב את התוכן**

```sql
-- Expand phase of the payment split (docs/superpowers/plans/2026-09-24-campaign-payment-domain-split.md).
-- Adds the payment domain beside campaigns; touches no existing column. Contract is a later migration.

-- ── outcome of ONE attempt. The only enum here: it is about the attempt, not the kind of money movement. ──
create type public.payment_operation_outcome as enum ('pending', 'succeeded', 'failed', 'review');

-- ── payment_methods: the saved instrument. Citizen id lives in Vault, never here. ──
-- Time-ordered v7 ids (schema-primary-keys): cem-uuidv7 1.0.2 is installed in `extensions` (owner, 24.9 21:49;
-- verified: version nibble 7, monotonic, executable by service_role). Not core Postgres — the `if not exists` below
-- makes the migration honest about the dependency; on this project it is a no-op.
create extension if not exists "cem-uuidv7" with schema extensions;

create table public.payment_methods (
  id                   uuid primary key default extensions.uuid_generate_v7(),
  owner_user_id        uuid not null references auth.users (id) on delete cascade,
  kind                 text not null default 'saved_card',   -- free text on purpose
  provider             text not null default 'sumit',
  provider_token_ref   text,                                 -- campaigns.card_token_ref today
  provider_customer_id bigint,                               -- campaigns.sumit_customer_id today (also sumit_customers)
  exp_month            smallint check (exp_month between 1 and 12),
  exp_year             smallint check (exp_year between 2024 and 2100),
  citizen_id_secret    uuid,                                 -- vault.secrets.id — the ONLY link to the ת"ז
  meta                 jsonb not null default '{}'::jsonb,   -- non-sensitive provider extras only
  created_at           timestamptz not null default now(),
  revoked_at           timestamptz
);
comment on table public.payment_methods is 'Saved payment instruments. The card-holder citizen id is a Vault secret (citizen_id_secret), never a column. Server-only: RLS enabled, zero policies, no grants to anon/authenticated.';
-- FK index (schema-foreign-key-indexes): full, not partial — ON DELETE CASCADE from auth.users must find revoked rows too.
create index payment_methods_owner_idx on public.payment_methods (owner_user_id);

-- ── payment_operation_kinds: the registry. A new kind is a ROW, not a migration. ──
-- effect drives the derived status (src/lib/payments/status.ts): commit = money reserved,
-- collect = money taken, return = money given back, none = informational.
create table public.payment_operation_kinds (
  kind       text primary key,
  label_he   text not null,
  -- effect: commit = money reserved (a guarantee), collect = money taken, void = a guarantee ended with no
  -- money movement (a hold released/expired), return = money given back, none = informational.
  effect     text not null check (effect in ('commit', 'collect', 'void', 'return', 'none')),
  -- once_per_campaign: at most ONE live (pending/review/succeeded) operation of this kind per campaign (the final
  -- charge happens once). Snapshotted onto payment_operations.once_slot at insert and enforced by the partial
  -- unique index payment_operations_once_uq — data-driven, no kind name in code or index.
  once_per_campaign boolean not null default false,
  -- once_per_parent: at most ONE succeeded operation of this kind per parent operation (a hold is released once;
  -- a charge may be refunded several times). Snapshotted onto parent_slot; enforced by payment_operations_parent_uq.
  once_per_parent   boolean not null default false,
  sort_order integer not null default 100,
  active     boolean not null default true
);
-- effect is DEFINITIONAL and read live by every status computation. Changing it would rewrite the meaning of
-- history for every campaign. A different behaviour is a NEW kind, never an edited one.
create or replace function public.payment_operation_kinds_guard_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.kind <> old.kind or new.effect <> old.effect or new.once_per_campaign <> old.once_per_campaign
     or new.once_per_parent <> old.once_per_parent then
    raise exception 'payment_operation_kinds: kind/effect/once flags are immutable — add a new kind instead' using errcode = 'check_violation';
  end if;
  return new;   -- label_he, sort_order, active may change
end $$;
create trigger payment_operation_kinds_guard_update before update on public.payment_operation_kinds
  for each row execute function public.payment_operation_kinds_guard_update();
-- The final charge is a FRESH charge on the saved token (capture.ts:123-162; verified live 2026-06-29), NOT a
-- capture of the hold — so there is no 'capture' kind and 'charge' has no parent. 'release' ends the guarantee.
insert into public.payment_operation_kinds (kind, label_he, effect, once_per_campaign, once_per_parent, sort_order) values
  ('authorize',           'אישור מסגרת',   'commit',  true,  false, 10),   -- once per campaign: today lockCampaignForHold never re-holds after 'authorized' (campaigns.ts:467-482)
  ('release',             'שחרור מסגרת',   'void',    false, true,  20),   -- once per parent: a hold is released once (reconciler dedupe
  ('charge',              'חיוב סופי',     'collect', true,  false, 30),
  ('cancellation_charge', 'גביית ביטול',   'collect', false, false, 40),
  ('refund',              'החזר',          'return',  false, false, 50);   -- several partial refunds of one charge are allowed

-- ── payment_operations: append-only. One row per thing that happened to money. ──
create table public.payment_operations (
  id                   uuid primary key default extensions.uuid_generate_v7(),
  -- RESTRICT, like billed_results (measured: its three FKs are ON DELETE RESTRICT): a money ledger never vanishes
  -- silently because a campaign or event was deleted.
  campaign_id          uuid not null references public.campaigns (id) on delete restrict,
  event_id             uuid not null references public.events (id) on delete restrict,
  payment_method_id    uuid references public.payment_methods (id),
  kind                 text not null references public.payment_operation_kinds (kind),
  outcome              public.payment_operation_outcome not null default 'pending',
  amount               numeric(12,2) not null default 0 check (amount >= 0),
  credit_applied       numeric(12,2) not null default 0 check (credit_applied >= 0),
  parent_operation_id  uuid references public.payment_operations (id),   -- release → its authorize; refund → its charge. charge has NONE.
  provider             text not null default 'sumit',
  provider_ref         text,                                            -- auth number / payment id, as text
  provider_document_id bigint,
  provider_document_number integer,
  provider_document_url text,
  source               text not null default 'app' check (source in ('app', 'provider_sync', 'manual_backfill')),
  occurred_at          timestamptz not null default now(),              -- when it happened at the provider; for a two-phase op it is
                                                                         -- the begin time and may be set once on completion (guard_update)
  recorded_at          timestamptz not null default now(),              -- when we wrote it
  note                 text,
  meta                 jsonb not null default '{}'::jsonb               -- non-sensitive extras only (no card data, no ת"ז)
);
comment on table public.payment_operations is 'Append-only ledger of every money movement per campaign. Status is DERIVED from the rows (effect of the last succeeded operations), never stored. Server-only.';
-- Indexes. Every FK column is indexed (schema-foreign-key-indexes: Postgres does not do it for you; cascades and joins scan otherwise).
create index payment_operations_campaign_idx on public.payment_operations (campaign_id, occurred_at desc);  -- loadOperations: equality then order
create index payment_operations_event_idx    on public.payment_operations (event_id);
create index payment_operations_method_idx   on public.payment_operations (payment_method_id) where payment_method_id is not null;
create index payment_operations_parent_idx   on public.payment_operations (parent_operation_id) where parent_operation_id is not null;
-- UNIQUE: one SUMIT document (receipt/order) is recorded once. Recording the same receipt twice would double the
-- collected sum. The backfill maps hold_order_document_id → authorize and sumit_charge_document_id
-- → charge, distinct documents, so the 3 live campaigns pass.
create unique index payment_operations_doc_uq on public.payment_operations (provider, provider_document_id) where provider_document_id is not null;
-- The one meta key code looks up (event-cancellation, Task 7): expression index, not a table scan (advanced-jsonb-indexing).
-- UNIQUE: one cancellation request → one cancellation_charge, enforced in the btree.
create unique index payment_operations_cancellation_uq on public.payment_operations ((meta->>'cancellation_request_id'))
  where meta ? 'cancellation_request_id' and outcome in ('pending', 'review', 'succeeded');   -- failed leaves the slot, like once_uq
-- Uniqueness of the final charge is enforced by payment_operations_once_uq (below) via the once_slot snapshot — not by a
-- parent-based unique index, which would also block a second partial refund of one charge.
-- THE MUTEX: today lockCampaignForHold/lockCampaignForCharge are an UPDATE filtered on
-- capture_status/charge_status — a compare-and-set that makes "final charge exactly once" true under concurrency.
-- In the ledger the lock is the PENDING row: inserting it acquires the lock (23505 if one is already pending),
-- completing it (pending → succeeded/failed/review) releases it. One pending operation per campaign per kind.
create unique index payment_operations_one_pending_uq
  on public.payment_operations (campaign_id, kind) where outcome = 'pending';

-- ── Concurrency ─────────
-- A trigger that does `exists(select …)` is NOT a lock under read committed: two concurrent inserts see neither
-- row and both pass. Uniqueness is enforced only inside the btree (index-unique-checks), at any isolation level.
-- So: the registry stays the source of truth (once_per_campaign), a BEFORE INSERT trigger SNAPSHOTS that flag
-- onto the row (once_slot) and locks the campaign row, and a partial UNIQUE index does the enforcement.

alter table public.payment_operations add column once_slot boolean not null default false;
alter table public.payment_operations add column parent_slot boolean not null default false;
comment on column public.payment_operations.parent_slot is 'Snapshot of kinds.once_per_parent (and parent set) at insert; immutable; drives payment_operations_parent_uq.';
comment on column public.payment_operations.once_slot is 'Snapshot of payment_operation_kinds.once_per_campaign at insert time; immutable; drives payment_operations_once_uq.';

-- BEFORE INSERT: (1) lock the campaign row, so ledger writes and campaign status changes (whose guard triggers
-- read the ledger) queue behind each other instead of racing; (2) snapshot the registry flag.
create or replace function public.payment_operations_before_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_status text; v_event uuid; v_effect text; v_once boolean; v_parent_once boolean; v_parent_campaign uuid; v_parent_outcome public.payment_operation_outcome;
begin
  -- Lock the campaign row FIRST, then read its status under the lock: a cancel that committed a moment ago is
  -- seen here (cancel-first scenario. Money may not be committed or collected for a
  -- cancelled campaign; a release/refund (void/return) on one is still allowed — that is how it gets its money back.
  select c.status::text, c.event_id into v_status, v_event from public.campaigns c where c.id = new.campaign_id for update;
  if v_status is null then
    raise exception 'campaign % not found', new.campaign_id using errcode = 'foreign_key_violation';
  end if;
  select k.effect, k.once_per_campaign, k.once_per_parent into v_effect, v_once, v_parent_once
    from public.payment_operation_kinds k where k.kind = new.kind;
  if v_status = 'cancelled' and v_effect in ('commit', 'collect') then
    raise exception 'campaign % is cancelled: no % allowed', new.campaign_id, new.kind using errcode = 'check_violation';
  end if;
  -- coalesce: an unknown kind then fails on the FK (23503, clear) rather than on NOT NULL (23502)
  -- Integrity: event_id is DERIVED from the locked campaign, never trusted from the caller.
  new.event_id := v_event;
  -- A parent must belong to the same campaign and must have succeeded (releasing a failed hold or refunding a
  -- failed charge is meaningless and would corrupt the derived state).
  if new.parent_operation_id is not null then
    select p.campaign_id, p.outcome into v_parent_campaign, v_parent_outcome
      from public.payment_operations p where p.id = new.parent_operation_id;
    if v_parent_campaign is distinct from new.campaign_id then
      raise exception 'parent operation % belongs to another campaign', new.parent_operation_id using errcode = 'check_violation';
    end if;
    if v_parent_outcome <> 'succeeded' then
      raise exception 'parent operation % did not succeed (%)', new.parent_operation_id, v_parent_outcome using errcode = 'check_violation';
    end if;
  end if;
  new.once_slot   := coalesce(v_once, false);
  new.parent_slot := coalesce(v_parent_once, false) and new.parent_operation_id is not null;
  return new;
end $$;
create trigger payment_operations_before_insert before insert on public.payment_operations
  for each row execute function public.payment_operations_before_insert();

-- THE LOCK for once-per-campaign kinds: at most one LIVE row per campaign per kind.
--   pending   → blocks (an attempt is in flight)
--   review    → blocks until a person reconciles it (SUMIT may have charged; a retry could charge twice)
--   succeeded → blocks for good
--   failed    → leaves the index; a retry is allowed
create unique index payment_operations_once_uq
  on public.payment_operations (campaign_id, kind)
  where once_slot and outcome in ('pending', 'review', 'succeeded');
-- One live once-per-parent child per parent (a hold is released once, even if two reconciler runs overlap).
create unique index payment_operations_parent_uq
  on public.payment_operations (parent_operation_id, kind)
  where parent_slot and outcome in ('pending', 'review', 'succeeded');

-- Append-only with controlled completion. Allowed transitions: pending → succeeded | failed | review,
-- review → succeeded | failed (the human reconciliation). Nothing else ever changes.
create or replace function public.payment_operations_guard_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not (
       (old.outcome = 'pending' and new.outcome in ('succeeded', 'failed', 'review'))
    or (old.outcome = 'review'  and new.outcome in ('succeeded', 'failed'))
  ) then
    raise exception 'payment_operations: % → % is not an allowed transition (row %)', old.outcome, new.outcome, old.id
      using errcode = 'check_violation';
  end if;
  if new.id <> old.id or new.campaign_id <> old.campaign_id or new.event_id <> old.event_id or new.kind <> old.kind
     or new.parent_operation_id is distinct from old.parent_operation_id
     or new.recorded_at <> old.recorded_at or new.source <> old.source
     or new.once_slot is distinct from old.once_slot or new.parent_slot is distinct from old.parent_slot then
    raise exception 'only outcome, amounts, provider refs, occurred_at, note and meta may change on completion' using errcode = 'check_violation';
  -- Note: an UPDATE that does not change outcome (e.g. note only on a review row) is rejected by the transition check
  -- above. Interim admin notes go to activity_log, not to the row.
  end if;
  return new;
end $$;
create trigger payment_operations_guard_update before update on public.payment_operations
  for each row execute function public.payment_operations_guard_update();

-- ── ACL: not part of the Data API. ──
alter table public.payment_methods         enable row level security;
alter table public.payment_operation_kinds enable row level security;
alter table public.payment_operations      enable row level security;
revoke all on table public.payment_methods, public.payment_operation_kinds, public.payment_operations from public, anon, authenticated;
-- service_role keeps Supabase's default privileges (the public default ACL grants it full table rights on every new
-- table; measured 2026-09-24) — the same as every other table here, by the owner's decision. Append-only is enforced
-- by the two triggers above, not by privileges.
-- No policies on purpose: RLS with none denies every non-bypass role; service_role bypasses RLS.

-- ── Vault write + read, the SAME shape as integrations_write/read_credential (20260916002343). ──
-- Optional args carry `default null`: supabase gen types makes a no-default arg REQUIRED and non-nullable in TS
-- (types.generated.ts: integrations_write_credential Args), and createPaymentMethod passes number | null.
create or replace function public.payment_methods_write(
  p_owner_user_id        uuid,
  p_provider_token_ref   text,
  p_exp_month            smallint default null,
  p_exp_year             smallint default null,
  p_provider_customer_id bigint default null,
  p_citizen_id           text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id        uuid := extensions.uuid_generate_v7();   -- same generator as the table default
  v_secret_id uuid;
begin
  if p_citizen_id is not null then
    v_secret_id := vault.create_secret(p_citizen_id, 'pm:' || v_id::text, 'payment method citizen id', null);
  end if;
  insert into public.payment_methods
    (id, owner_user_id, provider_token_ref, exp_month, exp_year, provider_customer_id, citizen_id_secret)
  values
    (v_id, p_owner_user_id, p_provider_token_ref, p_exp_month, p_exp_year, p_provider_customer_id, v_secret_id);
  return v_id;
end;
$$;

create or replace function public.payment_method_citizen_id(p_id uuid)
returns text
language sql
security invoker
stable
set search_path = ''
as $$
  select s.decrypted_secret
    from public.payment_methods m
    join vault.decrypted_secrets s on s.id = m.citizen_id_secret
   where m.id = p_id and m.revoked_at is null
$$;
revoke execute on function public.payment_methods_write(uuid, text, smallint, smallint, bigint, text) from public, anon, authenticated;
revoke execute on function public.payment_method_citizen_id(uuid) from public, anon, authenticated;
grant execute on function public.payment_methods_write(uuid, text, smallint, smallint, bigint, text) to service_role;
grant execute on function public.payment_method_citizen_id(uuid) to service_role;

-- ── Records the owner's manual drop of 2026-09-24 so migration history matches the live schema. No-op live. ──
alter table public.campaigns drop column if exists auth_expires_at;

-- ── DRY RUN (owner, one transaction ending in ROLLBACK) ──
-- a) select c.relname, has_table_privilege('anon',c.oid,'select') anon_sel, has_table_privilege('authenticated',c.oid,'select') auth_sel,
--           has_table_privilege('service_role',c.oid,'select,insert,update,delete') sr
--    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'payment\_%';
--    expect: anon f, auth f, sr t (default ACL, owner's decision)
-- b) select count(*) from pg_policies where tablename like 'payment\_%';  -- 0
-- c) select has_function_privilege('anon','public.payment_method_citizen_id(uuid)','execute'),
--           has_function_privilege('service_role','public.payment_method_citizen_id(uuid)','execute'); -- f, t
-- d) select kind, effect, once_per_campaign from public.payment_operation_kinds order by sort_order; -- 5 rows; authorize+charge once
-- e) FK columns without an index (schema-foreign-key-indexes) — expect 0 rows (kind is the second column of
--    one_pending_uq and once_uq, which the query counts;):
--    select conrelid::regclass, a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
--    where c.contype='f' and conrelid::regclass::text like 'payment\_%' and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and a.attnum=any(i.indkey));
--    (kind has no index of its own on purpose — a 5-row registry, never deleted from; the composite indexes cover the FK check.)
-- f) select count(*) from pg_trigger where tgname in ('payment_operations_before_insert','payment_operations_guard_update'); -- 2
--    select indexdef from pg_indexes where indexname='payment_operations_once_uq'; -- WHERE once_slot AND outcome IN (pending, review, succeeded)
-- g) select confdeltype from pg_constraint where conrelid='public.payment_operations'::regclass and contype='f' and conname like '%campaign_id%'; -- 'r' (restrict)
-- h) TWO connections (not one transaction — the point is concurrency; `db query --linked` is ONE connection and
--    cannot run this — use two psql sessions or two SQL-editor tabs: A inserts a pending 'charge' for campaign X and
--    waits; B inserts a pending 'charge' for X → B blocks on the index until A commits/rolls back, then fails 23505
--    (or succeeds if A rolled back). Then: A's row updated to 'review' → a new pending insert still fails; A's row
--    updated to 'failed' → a new pending insert succeeds. Both connections ROLLBACK at the end.
-- i) update a 'succeeded' row's outcome → check_violation; update a row's once_slot / parent_slot → check_violation
-- j) (ROLLBACK) the live campaigns_guard_cancel blocks cancelling an authorized campaign, so inside the SAME rollback
--    transaction first `alter table public.campaigns disable trigger campaigns_guard_cancel` (it is rolled back too),
--    then update campaigns set status='cancelled' where id=X; insert 'charge' pending for X → check_violation ('cancelled');
--    insert 'release' succeeded for X (parent = X's authorize) → accepted; a second 'release' for the same parent → 23505 on payment_operations_parent_uq
-- k) (ROLLBACK) two rows with the same meta.cancellation_request_id → 23505 on payment_operations_cancellation_uq
-- l) (ROLLBACK) insert with event_id of another event → row gets the campaign's real event_id (derived); a release whose
--    parent belongs to another campaign → check_violation; a release whose parent authorize is 'failed' → check_violation
-- m) (ROLLBACK) two rows with the same (provider, provider_document_id) → 23505 on payment_operations_doc_uq
-- n) (ROLLBACK) update payment_operation_kinds set effect='return' where kind='release' → check_violation; set label_he=… → accepted
-- ROLLBACK (manual): drop trigger payment_operation_kinds_guard_update on public.payment_operation_kinds; drop function public.payment_operation_kinds_guard_update();
--   drop trigger payment_operations_before_insert on public.payment_operations; drop function public.payment_operations_before_insert();
--   drop trigger payment_operations_guard_update on public.payment_operations; drop function public.payment_operations_guard_update();
--   drop function public.payment_methods_write(uuid, text, smallint, smallint, bigint, text);
--   drop function public.payment_method_citizen_id(uuid); drop table public.payment_operations, public.payment_operation_kinds, public.payment_methods;
--   drop type public.payment_operation_outcome;
```

- [ ] **Step 3: בדוק ש-Vault ו-`cem-uuidv7` זמינים (קריאה בלבד)**

```bash
npx supabase db query --linked "select extname from pg_extension where extname in ('supabase_vault','cem-uuidv7')"
```
צפוי: שתי שורות. אם חסרה אחת, עצור ודווח (על ה-DB החי שתיהן מותקנות, נמדד 24.9).

- [ ] **Step 4: הבעלים: dry-run → push → types → advisors.** ⚠️ `db push` **לא** מריץ את הקובץ כטרנזקציה אחת: ה-CLI (2.117.0, `pkg/migration/file.go`, `isPipelineIncompatible`) מוציא כל `create index` מה-batch ומריץ אותו ב-autocommit, כך שהקובץ מתבצע כ-3 batches + 8 אינדקסים. כישלון ב-batch האחרון (למשל בפונקציות ה-Vault) משאיר טבלאות ואינדקסים מחויבים **בלי רישום גרסה**, ו-push חוזר נכשל על `create type … already exists`. **אם ה-push נכשל באמצע: להריץ את בלוק ה-ROLLBACK הידני (למטה) ואז push שוב.** ה-dry-run "בטרנזקציה אחת" בודק את ה-SQL, לא את אופן ההרצה של ה-CLI.

```bash
npx supabase db push --linked --dry-run   # רק הקובץ החדש
npx supabase db push --linked
npm run gen:types && npm run types:check
npx supabase db advisors --linked --type security
```

- [ ] **Step 5: הרץ את בדיקות (a)–(d) על החי (קריאה) ותעד בהודעת ה-commit**

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<timestamp>_payment_operations_expand.sql src/lib/supabase/types.generated.ts
git commit -m "feat(db): payment operations ledger — expand: payment_methods, payment_operation_kinds, payment_operations, Vault citizen id"
```

---

### Task 2: מודול המצב הטהור — `deriveStatus` + תוויות

**Files:**
- Create: `src/lib/payments/status.ts`
- Create: `src/lib/payments/status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OperationEffect = 'commit' | 'collect' | 'void' | 'return' | 'none';
  export type OperationOutcome = 'pending' | 'succeeded' | 'failed' | 'review';
  export interface OperationRow { kind: string; effect: OperationEffect; outcome: OperationOutcome; amount: number; occurredAt: string; recordedAt: string }
  export type PaymentStatus = 'none' | 'pending' | 'review' | 'declined' | 'committed' | 'collected' | 'released' | 'refunded';
  export interface PaymentState { status: PaymentStatus; collected: number; committed: number }
  export function deriveStatus(ops: readonly OperationRow[]): PaymentState;
  export function paymentBadge(state: PaymentState): { label: string; variant: 'success'|'warning'|'destructive'|'neutral' } | null;
```
- Consumes: כלום (טהור). `effect` מגיע מה-join עם `payment_operation_kinds`, לא מהקוד.

- [ ] **Step 1: בדיקה נכשלת**

```ts
import { describe, expect, it } from 'vitest';
import { deriveStatus, paymentBadge, type OperationRow, type PaymentState } from './status';

const op = (kind: string, effect: OperationRow['effect'], outcome: OperationRow['outcome'], amount = 0, t = '2026-09-01T00:00:00Z', r = t): OperationRow =>
  ({ kind, effect, outcome, amount, occurredAt: t, recordedAt: r });
const AUTH = op('authorize', 'commit', 'succeeded', 200);

describe('deriveStatus — the ledger decides, no stored state', () => {
  it('no operations → none', () => expect(deriveStatus([]).status).toBe('none'));
  it('authorize succeeded → committed 200', () =>
    expect(deriveStatus([AUTH])).toEqual({ status: 'committed', collected: 0, committed: 200 }));
  it('authorize → charge succeeded → collected 120 (the charge is independent of the hold)', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'succeeded', 120, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 120 }));
  it('authorize → release → released; committed stays 200', () =>
    expect(deriveStatus([AUTH, op('release', 'void', 'succeeded', 0, '2026-09-02T00:00:00Z')])).toEqual({ status: 'released', collected: 0, committed: 200 }));
  it('authorize → charge → release → STILL collected: releasing the guarantee returns no money', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'succeeded', 120, '2026-09-02T00:00:00Z'), op('release', 'void', 'succeeded', 0, '2026-09-03T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 120 }));
  it('charge failed then succeeded → collected once', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'failed', 120, '2026-09-02T00:00:00Z'), op('charge', 'collect', 'succeeded', 120, '2026-09-03T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 120 }));
  it('closed at zero with a credit: charge succeeded amount 0 → collected, collected=0 (finding 2 of the audit)', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'succeeded', 0, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 0 }));
  it('charge pending → pending (money in flight beats committed)', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'pending', 120, '2026-09-02T00:00:00Z')]).status).toBe('pending'));
  it('an unresolved review is NOT hidden by a later release', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'review', 120, '2026-09-02T00:00:00Z'), op('release', 'void', 'succeeded', 0, '2026-09-03T00:00:00Z')]).status).toBe('review'));
  it('review beats pending when both exist', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'review', 120, '2026-09-02T00:00:00Z'), op('release', 'void', 'pending', 0, '2026-09-03T00:00:00Z')]).status).toBe('review'));
  it('charge review → review', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'review', 120, '2026-09-02T00:00:00Z')]).status).toBe('review'));
  it('only informational rows (effect none) → none, not declined', () =>
    expect(deriveStatus([op('note', 'none', 'succeeded', 0)]).status).toBe('none'));
  it('only a failed authorize → declined', () =>
    expect(deriveStatus([op('authorize', 'commit', 'failed', 200)]).status).toBe('declined'));
  it('a brand-new kind with effect=collect works without code changes', () =>
    expect(deriveStatus([op('immediate_charge', 'collect', 'succeeded', 200)])).toMatchObject({ status: 'collected', collected: 200 }));
  it('charge then refund → refunded; collected nets to 0', () =>
    expect(deriveStatus([op('charge', 'collect', 'succeeded', 200), op('refund', 'return', 'succeeded', 200, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'refunded', collected: 0 }));
  it('partial refund → still collected, collected nets to 150', () =>
    expect(deriveStatus([op('charge', 'collect', 'succeeded', 200), op('refund', 'return', 'succeeded', 50, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 150 }));
  it('order is by occurredAt, not array order', () =>
    expect(deriveStatus([op('release', 'void', 'succeeded', 0, '2026-09-03T00:00:00Z'), op('authorize', 'commit', 'succeeded', 200, '2026-09-01T00:00:00Z')]).status).toBe('released'));
  it('EQUAL occurredAt → recordedAt breaks the tie', () =>
    expect(deriveStatus([op('release', 'void', 'succeeded', 0, '2026-07-21T16:38:52Z', '2026-09-25T00:00:01Z'), op('authorize', 'commit', 'succeeded', 4, '2026-07-21T16:38:52Z', '2026-09-25T00:00:00Z')]).status).toBe('released'));
  it('the real closed-campaign sequence: authorize → release(+1s) → charge(0, credit) by time → collected 0', () =>
    expect(deriveStatus([op('authorize', 'commit', 'succeeded', 4, '2026-07-21T16:38:52Z'), op('release', 'void', 'succeeded', 0, '2026-07-21T16:38:53Z'), op('charge', 'collect', 'succeeded', 0, '2026-07-27T08:53:58Z')])).toEqual({ status: 'collected', collected: 0, committed: 4 }));
});

describe('paymentBadge — never the word תפוס', () => {
  const st = (status: PaymentState['status'], collected = 0): PaymentState => ({ status, collected, committed: 0 });
  it.each([
    ['none', 0, null],
    ['pending', 0, 'בתהליך'],
    ['review', 0, 'נדרשת בדיקה ידנית'],
    ['declined', 0, 'נדחה'],
    ['committed', 0, 'אושר — ממתין לגבייה'],
    ['collected', 120, 'נגבה'],
    ['collected', 0, 'נסגר ללא חיוב'],
    ['released', 0, 'שוחרר ללא גבייה'],
    ['refunded', 0, 'הוחזר'],
  ] as const)('%s / %s → %s', (status, collected, label) => {
    const b = paymentBadge(st(status, collected));
    expect(b?.label ?? null).toBe(label);
    if (b) expect(b.label).not.toContain('תפוס');
  });
});
```

- [ ] **Step 2: הרץ ווודא כישלון:** `npx vitest run src/lib/payments/status.test.ts` → module not found.

- [ ] **Step 3: מימוש** (`status.ts`)

```ts
// Payment status is DERIVED from the ledger (payment_operations joined with
// payment_operation_kinds.effect), never stored. The code never looks at a
// specific kind: a kind is a row in the registry, its effect is
// what matters here. Replay the succeeded operations in time order; the
// latest in-flight attempt (pending/review) wins over settled state because
// money may be moving right now.
export type OperationEffect = 'commit' | 'collect' | 'void' | 'return' | 'none';
export type OperationOutcome = 'pending' | 'succeeded' | 'failed' | 'review';
export type PaymentStatus = 'none' | 'pending' | 'review' | 'declined' | 'committed' | 'collected' | 'released' | 'refunded';
export type BadgeVariant = 'success' | 'warning' | 'destructive' | 'neutral';

export interface OperationRow {
  kind: string;
  effect: OperationEffect;
  outcome: OperationOutcome;
  amount: number;
  occurredAt: string;
  recordedAt: string;
}

export interface PaymentState {
  status: PaymentStatus;
  collected: number;
  committed: number;
}

// Replay in time order. occurredAt first; recordedAt breaks ties (a backfilled release whose real time is unknown
// is written 1s after its authorize). The latest in-flight attempt (pending/review) wins over
// settled state because money may be moving right now.
export function deriveStatus(ops: readonly OperationRow[]): PaymentState {
  if (ops.length === 0) return { status: 'none', collected: 0, committed: 0 };
  const sorted = [...ops].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt));
  // ANY unresolved row decides: a release/refund written after an unresolved review must
  // not hide it. review beats pending (a person must act), pending beats every settled state.
  const inFlight = sorted.some((o) => o.outcome === 'review') ? 'review' : sorted.some((o) => o.outcome === 'pending') ? 'pending' : null;
  let status: PaymentStatus = 'none';
  let collected = 0;
  let committed = 0;
  let everCollected = false;
  for (const o of sorted) {
    if (o.outcome !== 'succeeded' || o.effect === 'none') continue;
    // "committed" is informational (what the customer approved), never netted by a later void/return, and nothing
    // in the system caps billing on it: the final charge is a fresh charge on the saved token, and the recipient
    // set is bounded by the list, not by an amount.
    if (o.effect === 'commit') { committed = o.amount; if (!everCollected) status = 'committed'; }
    if (o.effect === 'collect') { collected += o.amount; everCollected = true; status = 'collected'; }
    // void = the guarantee ended, no money moved: only matters if nothing was ever collected.
    if (o.effect === 'void' && !everCollected) status = 'released';
    if (o.effect === 'return') { collected = Math.max(0, collected - o.amount); status = collected > 0 ? 'collected' : 'refunded'; }
  }
  if (inFlight) return { status: inFlight, collected, committed };
  // Nothing with a money effect succeeded. If something was ATTEMPTED (a failed commit/collect) → declined; if the
  // only rows are informational (effect 'none' — no such kind today) → none, not declined.
  if (status === 'none') {
    const attempted = sorted.some((o) => o.effect !== 'none');
    return { status: attempted ? 'declined' : 'none', collected, committed };
  }
  return { status, collected, committed };
}

const LABELS: Record<Exclude<PaymentStatus, 'none'>, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'בתהליך', variant: 'warning' },
  review: { label: 'נדרשת בדיקה ידנית', variant: 'destructive' },
  declined: { label: 'נדחה', variant: 'destructive' },
  committed: { label: 'אושר — ממתין לגבייה', variant: 'success' },
  collected: { label: 'נגבה', variant: 'neutral' },
  released: { label: 'שוחרר ללא גבייה', variant: 'neutral' },
  refunded: { label: 'הוחזר', variant: 'neutral' },
};

export function paymentBadge(state: PaymentState): { label: string; variant: BadgeVariant } | null {
  if (state.status === 'none') return null;
  if (state.status === 'collected' && state.collected === 0) return { label: 'נסגר ללא חיוב', variant: 'neutral' };
  return LABELS[state.status];
}
```

- [ ] **Step 4: הרץ ווודא הצלחה** (28 בדיקות), **Step 5: Commit** `feat(payments): status derived from the operations ledger; neutral labels`

---

### Task 3: אמצעי תשלום + ת"ז ב-Vault

**Files:**
- Create: `src/lib/payments/payment-methods.ts`, `src/lib/payments/payment-methods.test.ts`
- Read first: `src/lib/integrations/credential-accessor.ts:140-170` (הקריאה ל-`integrations_read_credential`, אותו דפוס)

**Interfaces:**
- Produces:
  ```ts
  export async function createPaymentMethod(admin: AdminClient, input: { ownerUserId: string; providerTokenRef: string; expMonth: number|null; expYear: number|null; providerCustomerId: number|null; citizenId: string|null }): Promise<string>;
  export async function readCitizenId(admin: AdminClient, paymentMethodId: string): Promise<string | null>;
```

- [ ] **Step 1: בדיקה נכשלת**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPaymentMethod, readCitizenId } from './payment-methods';

const rpcClient = (data: unknown, error: { message: string } | null = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) });

describe('payment methods — the citizen id never touches a table column', () => {
  it('createPaymentMethod → payment_methods_write with the ת"ז as an RPC arg, returns the id', async () => {
    const admin = rpcClient('9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a');
    const id = await createPaymentMethod(admin as never, { ownerUserId: '0b2c6e1a-4c3d-4e5f-8a9b-1c2d3e4f5a6b', providerTokenRef: 'tok', expMonth: 9, expYear: 2031, providerCustomerId: 2327129071, citizenId: '316125434' });
    expect(id).toBe('9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a');
    expect(admin.rpc).toHaveBeenCalledWith('payment_methods_write', { p_owner_user_id: '0b2c6e1a-4c3d-4e5f-8a9b-1c2d3e4f5a6b', p_provider_token_ref: 'tok', p_exp_month: 9, p_exp_year: 2031, p_provider_customer_id: 2327129071, p_citizen_id: '316125434' });
  });
  it('failure → Hebrew, provider-free error', async () => {
    await expect(createPaymentMethod(rpcClient(null, { message: 'permission denied for schema vault' }) as never, { ownerUserId: 'u', providerTokenRef: 't', expMonth: null, expYear: null, providerCustomerId: null, citizenId: null }))
      .rejects.toThrow('שמירת אמצעי התשלום נכשלה');
  });
  it('readCitizenId → payment_method_citizen_id by id', async () => {
    const admin = rpcClient('316125434');
    await expect(readCitizenId(admin as never, '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a')).resolves.toBe('316125434');
    expect(admin.rpc).toHaveBeenCalledWith('payment_method_citizen_id', { p_id: '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a' });
  });
  it('readCitizenId → null on error or non-string', async () => {
    await expect(readCitizenId(rpcClient(null, { message: 'x' }) as never, 'a')).resolves.toBeNull();
    await expect(readCitizenId(rpcClient(null) as never, 'a')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: כישלון**, **Step 3: מימוש**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

type AdminClient = SupabaseClient<Database>;

// The saved instrument and the card-holder citizen id SUMIT needs on every
// saved-token charge (src/lib/sumit/capture.ts, CreditCard_CitizenID). The ת"ז
// goes to vault.secrets inside payment_methods_write — one transaction, secret
// + row together, like integrations_write_credential — and payment_methods
// keeps only the secret's uuid. Both RPCs: security invoker, service_role only.
export async function createPaymentMethod(
  admin: AdminClient,
  input: { ownerUserId: string; providerTokenRef: string; expMonth: number | null; expYear: number | null; providerCustomerId: number | null; citizenId: string | null },
): Promise<string> {
  const { data, error } = await admin.rpc('payment_methods_write', {
    p_owner_user_id: input.ownerUserId,
    p_provider_token_ref: input.providerTokenRef,
    p_exp_month: input.expMonth,
    p_exp_year: input.expYear,
    p_provider_customer_id: input.providerCustomerId,
    p_citizen_id: input.citizenId,
  });
  if (error || typeof data !== 'string') throw new Error('שמירת אמצעי התשלום נכשלה');
  return data;
}

export async function readCitizenId(admin: AdminClient, paymentMethodId: string): Promise<string | null> {
  const { data, error } = await admin.rpc('payment_method_citizen_id', { p_id: paymentMethodId });
  if (error) return null;
  return typeof data === 'string' ? data : null;
}
```

- [ ] **Step 4: הצלחה + `npx tsc --noEmit`**, **Step 5: Commit** `feat(payments): payment methods with the citizen id in Vault`

---

### Task 4: Backfill — היסטוריית 3 הקמפיינים + גביות ביטול קיימות

**Files:**
- Create: `scripts/payments-backfill.ts`, `scripts/payments-backfill.test.ts`
- Modify: `package.json`: `"payments:backfill": "esbuild scripts/payments-backfill.ts --bundle --platform=node --format=cjs --target=node24 --outfile=dist/payments-backfill.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/payments-backfill.cjs"` (אותם aliases כמו `owner-agent:smoke`; `--apply` מועבר אחרי `--`)

**Interfaces:**
- Consumes: Task 1, Task 3 (`createPaymentMethod`).
- Produces: לכל קמפיין עם `capture_status` לא-null: `payment_methods` אחד (אם `card_token_ref`), ורצף פעולות לפי העמודות הישנות; לכל `event_cancellation_requests` עם `sumit_document_id`: פעולת `cancellation_charge`.

**מה נמדד (24.9) ומה ייכתב:**

| campaign | עמודות ישנות | פעולות שייכתבו |
|---|---|---|
| `39334087` (קאקון, פעיל) | authorized 200 ב-02.09 13:14Z; `release_status=released` | `authorize` 200 → `release` (`source=provider_sync`, `occurred_at` = זמן ה-`activity_log` `campaign.hold_released_synced` = **2026-09-23T06:00:29Z**, נמדד) |
| `49a4617b` (סגור) | authorized 4 ב-21.07 16:38:52.003Z (ה-+1s בפועל = 16:38:53.003Z); `nothing_to_charge`, `credit_applied` **4**, `charged_at` מלא; ב-SUMIT Billing_Status=3 (released) | `authorize` 4 → `charge` succeeded **0** עם `credit_applied=4` (`occurred_at=charged_at`) → `release` (`manual_backfill`, `occurred_at = authorized_at + 1s`, note "release time unknown") |
| `15a8730e` (סגור) | authorized 152 ב-07.07 10:18:50.025Z; `nothing_to_charge`, `credit_applied` **84**, `charged_at` מלא; ב-SUMIT Billing_Status=3 | `authorize` 152 → `charge` succeeded **0** עם `credit_applied=84` → `release` (`manual_backfill`, `authorized_at + 1s`) |

> **זמני השחרור (audit finding 1):** ה-`Billing_Date` בתיקיית SUMIT הוא זמן **התפיסה** (`hold-status.ts:16-20` מזהה שחרור לפי שוויון ל-`authorized_at` עד השנייה), לא זמן השחרור. לשני הישנים אין זמן שחרור מדוד בשום מקום; לקאקון יש ב-`activity_log`. `deriveStatus` שובר שוויון ב-`recorded_at`, כך ש-"+1s" בטוח גם אם `authorized_at` נחתך לשנייה.

`charge_status` ממופה ל-`charge` (בלי הורה — חיוב עצמאי על הטוקן): `charged`→succeeded (amount=`final_charge_amount`), `charge_failed`→failed, `charge_review`→review, `pending`→pending, **`nothing_to_charge`→succeeded בסכום 0 עם `credit_applied`** (audit finding 2: `markCampaignChargeOutcome` כותב `credit_applied`+`charged_at` דווקא במצב הזה, `campaigns.ts:838-841`; הזיכוי נחשב מנוצל ב-`billing.ts:113`, `users.ts:278`, `owner_agent_billing_sums`).

- [ ] **Step 1: בדיקה נכשלת — `planOperations` טהורה**

```ts
import { describe, expect, it } from 'vitest';
import { planOperations } from './payments-backfill';

const row = (o: Record<string, unknown>) => ({
  id: 'c', event_id: 'e', capture_status: 'authorized', charge_status: null, release_status: null,
  auth_amount: '200', auth_number: ' 055528', authorized_at: '2026-09-02T13:14:22Z', auth_external_ref: 'ref',
  hold_order_document_id: 2327129322, hold_order_document_number: 1005, hold_order_document_url: 'u',
  final_charge_amount: null, credit_applied: '0', charged_at: null, sumit_charge_document_id: null,
  charge_document_number: null, charge_document_url: null, charge_auth_number: null, charge_payment_id: null, ...o,
});
const manual = new Set(['49a4617b']);
const releasedAt = new Map<string, string>();

describe('planOperations', () => {
  it('authorized only → one succeeded authorize', () => {
    const ops = planOperations(row({}), manual, releasedAt);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'authorize', outcome: 'succeeded', amount: 200, provider_document_id: 2327129322, source: 'app' });
  });
  it('released in DB → authorize + release(provider_sync) at the activity_log time', () => {
    const ops = planOperations(row({ release_status: 'released' }), manual, new Map([['c', '2026-09-23T06:00:29Z']]));
    expect(ops.map((o) => [o.kind, o.source])).toEqual([['authorize', 'app'], ['release', 'provider_sync']]);
    expect(ops[1].occurred_at).toBe('2026-09-23T06:00:29Z');
  });
  it('released in DB but no activity_log row → release at authorized_at + 1s with a note', () => {
    const ops = planOperations(row({ release_status: 'released' }), manual, releasedAt);
    expect(ops[1]).toMatchObject({ kind: 'release', occurred_at: '2026-09-02T13:14:23Z', note: expect.stringContaining('unknown') });
  });
  it('manual override (seen released in SUMIT, no time) → release(manual_backfill) at authorized_at + 1s', () => {
    const ops = planOperations(row({ id: '49a4617b', authorized_at: '2026-07-21T16:38:52Z', charge_status: 'nothing_to_charge', credit_applied: '4', charged_at: '2026-07-27T08:53:58Z' }), manual, releasedAt);
    expect(ops.map((o) => o.kind)).toEqual(['authorize', 'charge', 'release']);
    expect(ops[2]).toMatchObject({ kind: 'release', source: 'manual_backfill', occurred_at: '2026-07-21T16:38:53Z', note: expect.stringContaining('unknown') });
  });
  it('nothing_to_charge → charge succeeded amount 0 carrying the applied credit', () => {
    const ops = planOperations(row({ charge_status: 'nothing_to_charge', credit_applied: '84', charged_at: '2026-07-07T12:00:00Z', final_charge_amount: '0' }), manual, releasedAt);
    expect(ops[1]).toMatchObject({ kind: 'charge', outcome: 'succeeded', amount: 0, credit_applied: 84, occurred_at: '2026-07-07T12:00:00Z' });
  });
  it('charged → charge succeeded with the document, no parent', () => {
    const ops = planOperations(row({ charge_status: 'charged', final_charge_amount: '120', charged_at: '2026-09-05T00:00:00Z', sumit_charge_document_id: 7, credit_applied: '30' }), manual, releasedAt);
    expect(ops[1]).toMatchObject({ kind: 'charge', outcome: 'succeeded', amount: 120, credit_applied: 30, provider_document_id: 7, occurred_at: '2026-09-05T00:00:00Z' });
  });
  it.each([['charge_failed', 'failed'], ['charge_review', 'review'], ['pending', 'pending']])('%s → charge %s', (cs, outcome) => {
    expect(planOperations(row({ charge_status: cs }), manual, releasedAt)[1]).toMatchObject({ kind: 'charge', outcome });
  });
  it('hold_failed → failed authorize only', () => {
    expect(planOperations(row({ capture_status: 'hold_failed', release_status: 'released' }), manual, releasedAt)).toEqual([expect.objectContaining({ kind: 'authorize', outcome: 'failed' })]);
  });
  it('no hold at all → []', () => expect(planOperations(row({ capture_status: null }), manual, releasedAt)).toEqual([]));
  it('never carries the citizen id', () => {
    expect(JSON.stringify(planOperations(row({ card_citizen_id: '316125434' }), manual, releasedAt))).not.toContain('316125434');
  });
  it('partial restart: with the authorize already inserted (by backfill_key), a rerun inserts only the missing release', async () => {
    // exercised in main() via a fake admin client: existing row { kind: 'authorize', meta: { backfill_key: 'c:authorize:<t>' } } → plan has authorize+release → exactly one insert, kind 'release', parent = the existing authorize id
  });
});
```

- [ ] **Step 2: כישלון**, **Step 3: מימוש** (`scripts/payments-backfill.ts`; ריצה: `node --env-file=.env.local dist/payments-backfill.cjs [--apply]`, בלי `--apply` מדפיס בלבד)

```ts
import { createAdminClient } from '@/lib/supabase/admin';
import { createPaymentMethod } from '@/lib/payments/payment-methods';

// Seen released (Billing_Status 3) in SUMIT's holds folder on 2026-09-24. Both predate hold_order_document_id
// (30.8), so the reconciler can never see them. The folder's Billing_Date is the HOLD time, not the release time
// (hold-status.ts:16-20) — the release time is unknown and is written as authorized_at + 1s with a note.
export const MANUAL_RELEASED = new Set<string>([
  '49a4617b-ac2e-4f17-bfeb-6ceb84c56551',
  '15a8730e-df46-43f6-a29f-13a1ea3a0038',
]);
const plusOneSecond = (iso: string) => new Date(new Date(iso).getTime() + 1000).toISOString().replace('.000Z', 'Z');

type Legacy = Record<string, unknown> & { id: string; event_id: string; capture_status: string | null; charge_status: string | null; release_status: string | null };
type PlannedOp = { kind: string; outcome: 'pending' | 'succeeded' | 'failed' | 'review'; amount: number; credit_applied: number; provider_ref: string | null; provider_document_id: number | null; provider_document_number: number | null; provider_document_url: string | null; source: 'app' | 'provider_sync' | 'manual_backfill'; occurred_at: string; note: string | null };

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const OUTCOME_OF_CAPTURE: Record<string, PlannedOp['outcome']> = { authorized: 'succeeded', hold_failed: 'failed', hold_review: 'review', pending: 'pending' };
// nothing_to_charge = a successful final charge of ₪0 (the credit did the paying).
const OUTCOME_OF_CHARGE: Record<string, PlannedOp['outcome']> = { charged: 'succeeded', nothing_to_charge: 'succeeded', charge_failed: 'failed', charge_review: 'review', pending: 'pending' };

export function planOperations(c: Legacy, manualReleased: ReadonlySet<string>, releasedAt: ReadonlyMap<string, string>): PlannedOp[] {
  if (!c.capture_status) return [];
  const at = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  const authorizedAt = at(c.authorized_at, at(c.created_at, new Date(0).toISOString()));
  const ops: PlannedOp[] = [{
    kind: 'authorize', outcome: OUTCOME_OF_CAPTURE[c.capture_status] ?? 'review', amount: num(c.auth_amount), credit_applied: 0,
    provider_ref: typeof c.auth_number === 'string' ? c.auth_number.trim() : null,
    provider_document_id: (c.hold_order_document_id as number | null) ?? null, provider_document_number: (c.hold_order_document_number as number | null) ?? null,
    provider_document_url: (c.hold_order_document_url as string | null) ?? null, source: 'app', occurred_at: authorizedAt, note: null,
  }];
  if (ops[0].outcome !== 'succeeded') return ops;
  const chargeOutcome = c.charge_status ? OUTCOME_OF_CHARGE[c.charge_status] : undefined;
  if (chargeOutcome) {
    ops.push({
      kind: 'charge', outcome: chargeOutcome, amount: num(c.final_charge_amount), credit_applied: num(c.credit_applied),
      provider_ref: (c.charge_auth_number as string | null) ?? (c.charge_payment_id != null ? String(c.charge_payment_id) : null),
      provider_document_id: (c.sumit_charge_document_id as number | null) ?? null, provider_document_number: (c.charge_document_number as number | null) ?? null,
      provider_document_url: (c.charge_document_url as string | null) ?? null, source: 'app', occurred_at: at(c.charged_at, authorizedAt), note: null,
    });
  }
  const release = (source: PlannedOp['source'], when: string | undefined, seen: string): PlannedOp => ({
    kind: 'release', outcome: 'succeeded', amount: 0, credit_applied: 0, provider_ref: null, provider_document_id: null, provider_document_number: null, provider_document_url: null,
    source, occurred_at: when ?? plusOneSecond(authorizedAt), note: when ? seen : `${seen}; release time unknown, written as authorized_at + 1s`,
  });
  if (c.release_status === 'released') {
    ops.push(release('provider_sync', releasedAt.get(c.id), 'seen released by sumit-hold-reconcile'));
  } else if (manualReleased.has(c.id)) {
    ops.push(release('manual_backfill', undefined, 'seen released (Billing_Status 3) in SUMIT holds folder 2026-09-24'));
  }
  return ops;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const admin = createAdminClient();
  const { data: campaigns, error } = await admin.from('campaigns').select('*').not('capture_status', 'is', null);
  if (error) throw new Error('read campaigns failed');
  // Idempotent per OPERATION, not per campaign: a crash after the authorize insert and before
  // the release insert must not leave the campaign half-migrated forever. Every planned op carries a deterministic
  // meta.backfill_key = '<campaign>:<kind>:<occurred_at>'; a rerun inserts only the keys that are missing.
  // No `source` filter: release rows are provider_sync/manual_backfill and must be seen too.
  const { data: done } = await admin.from('payment_operations').select('id, campaign_id, kind, meta, payment_method_id').not('meta->>backfill_key', 'is', null);
  const existingKey = new Map<string, { id: string; paymentMethodId: string | null }>();   // backfill_key → row
  for (const r of done ?? []) { const k = (r.meta as { backfill_key?: string } | null)?.backfill_key; if (k) existingKey.set(k, { id: r.id, paymentMethodId: r.payment_method_id }); }
  const keyOf = (campaignId: string, op: { kind: string; occurred_at: string }) => `${campaignId}:${op.kind}:${op.occurred_at}`;
  // The only measured release time: the reconciler's activity_log row (recordReleaseActivity, sumit-hold-reconcile.ts:48-63;
  // meta = { amount, campaignId, holdOrderDocumentId }).
  const { data: syncRows } = await admin.from('activity_log').select('meta, created_at').eq('action', 'campaign.hold_released_synced');
  const releasedAt = new Map<string, string>();
  for (const r of syncRows ?? []) {
    const cid = (r.meta as { campaignId?: string } | null)?.campaignId;   // key as written by sumit-hold-reconcile.ts:53-57
    if (cid && !releasedAt.has(cid)) releasedAt.set(cid, r.created_at);
  }
  let n = 0;
  for (const c of campaigns ?? []) {
    const ops = planOperations(c as never, MANUAL_RELEASED, releasedAt);
    if (ops.length === 0) continue;
    if (ops.every((op) => existingKey.has(keyOf(c.id, op)))) continue;   // fully migrated already
    n += 1;
    console.log(`campaign ${c.id.slice(0, 8)}: ${ops.map((o) => `${o.kind}/${o.outcome}${o.source !== 'app' ? '(' + o.source + ')' : ''}`).join(' → ')}`);
    if (!apply) continue;
    // Rerun: if the authorize row already exists, reuse ITS payment method — never create a
    // second payment_methods row + Vault secret for the same card.
    const existingAuth = ops.filter((op) => op.kind === 'authorize').map((op) => existingKey.get(keyOf(c.id, op))).find(Boolean);
    let paymentMethodId: string | null = existingAuth?.paymentMethodId ?? null;
    if (c.card_token_ref && !existingAuth) {
      if (!c.approved_by) throw new Error(`campaign ${c.id.slice(0, 8)}: approved_by is null`);
      paymentMethodId = await createPaymentMethod(admin, { ownerUserId: c.approved_by, providerTokenRef: c.card_token_ref, expMonth: c.card_exp_month, expYear: c.card_exp_year, providerCustomerId: c.sumit_customer_id, citizenId: c.card_citizen_id });
    }
    let parentId: string | null = null;
    for (const op of ops) {
      const key = keyOf(c.id, op);
      const already = existingKey.get(key);
      if (already) { if (op.kind === 'authorize') parentId = already.id; continue; }   // rerun: keep going from where it stopped
      const { data: row, error: e } = await admin.from('payment_operations')
        .insert({ ...op, campaign_id: c.id, event_id: c.event_id, payment_method_id: paymentMethodId, parent_operation_id: op.kind === 'release' ? parentId : null, meta: { backfill_key: key } })
        .select('id').single();
      if (e || !row) throw new Error(`insert ${op.kind} failed for ${c.id.slice(0, 8)}`);
      if (op.kind === 'authorize') parentId = row.id;
    }
  }
  // Cancellation charges: one cancellation_charge per resolved request that produced a SUMIT document.
  // campaigns_event_noncancelled_uidx allows several rows per event once one is cancelled → pick the non-cancelled one.
  const { data: cancels } = await admin.from('event_cancellation_requests').select('id, event_id, sumit_document_id, sumit_document_url, resolved_at, resolution_amount, events!inner(campaigns(id, status))').not('sumit_document_id', 'is', null);
  for (const r of cancels ?? []) {
    const campaignId = (r as { events: { campaigns: { id: string; status: string }[] } }).events.campaigns.find((c) => c.status !== 'cancelled')?.id;
    if (!campaignId) { console.log(`cancellation ${r.id.slice(0, 8)}: no campaign — skipped`); continue; }
    if (existingKey.has(`cancel:${r.id}`)) continue;   // rerun
    n += 1;
    console.log(`cancellation ${r.id.slice(0, 8)}: cancellation_charge/succeeded doc ${r.sumit_document_id}`);
    if (!apply) continue;
    const { error: e } = await admin.from('payment_operations').insert({ campaign_id: campaignId, event_id: r.event_id, kind: 'cancellation_charge', outcome: 'succeeded', amount: Number(r.resolution_amount ?? 0), provider_document_id: r.sumit_document_id, provider_document_url: r.sumit_document_url, source: 'app', occurred_at: r.resolved_at ?? new Date().toISOString(), meta: { cancellation_request_id: r.id, backfill_key: `cancel:${r.id}` } });
    // A race with a concurrent writer surfaces as 23505 on payment_operations_cancellation_uq: treat as already done.
    if (e && e.code === '23505') continue;
    if (e) throw new Error(`insert cancellation_charge failed for ${r.id.slice(0, 8)}`);
  }
  console.log(`${apply ? 'applied' : 'planned'}: ${n}`);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
```
> העמודות `resolved_at` ו-`resolution_amount` נמדדו בקטלוג החי (24.9): `event-cancellation.ts:513-522` כותב אותן יחד עם `sumit_document_id` באותו update, לכן הסכום של גביית הביטול הוא `resolution_amount`.

- [ ] **Step 4: בדיקות, build ל-`dist/`, ריצה ללא `--apply`, בדיקה מול הטבלה למעלה, ואז `--apply` (הבעלים)**

```bash
npx vitest run scripts/payments-backfill.test.ts
npx esbuild scripts/payments-backfill.ts --bundle --platform=node --format=cjs --target=node24 --outfile=dist/payments-backfill.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native
node --env-file=.env.local dist/payments-backfill.cjs
node --env-file=.env.local dist/payments-backfill.cjs --apply
```
צפוי אחרי apply: `select campaign_id, kind, outcome, amount, credit_applied, source from payment_operations order by campaign_id, occurred_at, recorded_at` = **8 שורות**: קאקון `authorize 200` + `release`(provider_sync, 23.09 06:00:29Z); שני הסגורים `authorize` + `charge 0` (`credit_applied` 4 / 84) + `release`(manual_backfill). `cancellation_charge`: **0 שורות** (נמדד 24.9: בקשת ביטול אחת, `declined`, בלי מסמך). ואז `deriveStatus` לכל אחד: קאקון `released`, שני הסגורים `collected` עם `collected=0` (תווית "נסגר ללא חיוב"). וזיכויים: `sum(credit_applied)` על `collect` מוצלח = 88, זהה ל-`sum(campaigns.credit_applied)` היום.

- [ ] **Step 5: Commit** (סקריפט + בדיקה + `package.json`; לא `dist/`)

---

### Task 5: כתיבה כפולה — כל כותב תשלום כותב גם ל-`payment_operations`

**Files:**
- Modify FIRST (Step 0, audit finding 7): `src/test/fake-table-client.ts` (+ `fake-table-client.test.ts`) — היום החתימה היא `(tables, rpc)` ונתמכים רק `select/insert/update/delete/eq/neq/in/gt/gte/lt/lte/is/order/limit/maybeSingle/rpc` (שורות 12-17, 58-60). מוסיפים: ארגומנט שלישי `options.uniqueIndexes: Array<{ columns: string[]; where?: Record<string, unknown | unknown[]> }>` (ערך מערך = `in`) שמפיל insert/update ב-`{ code: '23505' }`, `.single()` (0 או 2+ שורות → error), `.not(col, 'is', null)`. בדיקה משלו לכל אחד. בלי זה בדיקות 2-3 למטה נכשלות גם עם מימוש נכון.
- Create: `src/lib/payments/ledger.ts`, `src/lib/payments/ledger.test.ts`
- Create (Step 5א): `src/lib/data/payment-orphans.ts`, `src/lib/data/payment-orphans.test.ts`; Modify: `src/lib/queue/queues.ts` (`paymentOrphans`), `worker/main.ts:1534-1536,1623` (worker + schedule `*/10`)
- Modify: `src/lib/data/campaigns.ts` (authorize path ~471–540; `recordCampaignCharge`/`markCampaignChargeOutcome` ~790–850), `src/lib/data/sumit-hold-reconcile.ts` (~95–105), `src/lib/data/close-charge.ts:159,343`, `src/lib/data/event-cancellation.ts:520`

**Interfaces:**
- Produces:
  ```ts
  export async function recordOperation(admin, op: { campaignId: string; eventId: string; kind: string; outcome: OperationOutcome; amount: number; creditApplied?: number; paymentMethodId?: string|null; parentOperationId?: string|null; providerRef?: string|null; providerDocument?: { id: number; number: number|null; url: string|null } | null; source?: 'app'|'provider_sync'|'manual_backfill'; occurredAt?: string; note?: string|null; meta?: Record<string, unknown> }): Promise<string>;  // one-shot: outcome known at write time
  // Two-phase (the mutex — replaces lockCampaignForHold/lockCampaignForCharge, verifier finding ב):
  export async function beginOperation(admin, op: Omit<Parameters<typeof recordOperation>[1], 'outcome'>): Promise<{ id: string } | { alreadyInProgress: true }>;  // inserts outcome='pending'; 23505 on payment_operations_one_pending_uq → alreadyInProgress
  // Compare-and-set: the caller states the outcome it expects to move FROM. An app flow (close-charge, the hold)
  // always passes from: 'pending'; the admin reconciliation passes from: 'review'. So an admin can never close a row
  // that is still in flight, and close-charge can never overwrite a row a person is deciding on.
  export async function completeOperation(admin, id: string, result: {
    from: 'pending' | 'review';
    outcome: 'succeeded' | 'failed' | 'review';          // from 'review' only succeeded | failed (guard_update enforces too)
    amount?: number; creditApplied?: number;
    providerRef?: string | null; providerDocument?: { id: number; number: number | null; url: string | null } | null;
    paymentMethodId?: string | null;                     // the authorize completion attaches the method created after SUMIT answered
    occurredAt?: string;                                 // the provider's time, if known; otherwise the begin time stays
    note?: string | null;
  }): Promise<void>;  // UPDATE … where id = $id and outcome = $from; 0 rows → throw ('operation not in expected state')
  // review → succeeded | failed is the admin reconciliation — Task 7 adds it; today NO such action exists
  // (charge_review is simply retried by close-charge: close-charge.ts:136,172,207,406).
  export async function latestOperation(admin, campaignId: string, kind: string, outcome?: OperationOutcome): Promise<{ id: string } | null>;
  export async function loadOperations(admin, campaignId: string): Promise<OperationRow[]>;  // joined with kinds.effect, for deriveStatus
```
- Consumes: Task 2 `OperationRow`, Task 3 `createPaymentMethod`/`readCitizenId`.

- [ ] **Step 1: בדיקות נכשלות** (fake table client מ-`src/test/fake-table-client.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { createFakeTableClient } from '@/test/fake-table-client';
import { beginOperation, completeOperation, loadOperations, recordOperation } from './ledger';

describe('ledger writes', () => {
  it('recordOperation inserts one row and returns its id', async () => {
    const db = createFakeTableClient({ payment_operations: [] });
    const id = await recordOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'authorize', outcome: 'succeeded', amount: 200, providerRef: '055528' });
    expect(id).toBeTruthy();
    expect(db.rows('payment_operations')).toMatchObject([{ campaign_id: 'c1', kind: 'authorize', outcome: 'succeeded', amount: 200, source: 'app' }]);
  });
  it('a charge after a succeeded charge is rejected by once_uq', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'b', campaign_id: 'c1', kind: 'charge', outcome: 'succeeded', once_slot: true }] }, {}, { uniqueIndexes: [{ columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } }] });
    expect(await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 })).toEqual({ alreadyInProgress: true });
  });
  it('a charge after a REVIEW charge is rejected too (SUMIT may have charged); after a failed one it is allowed', async () => {
    const idx = { uniqueIndexes: [{ columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } }] };
    const reviewed = createFakeTableClient({ payment_operations: [{ id: 'r', campaign_id: 'c1', kind: 'charge', outcome: 'review', once_slot: true }] }, {}, idx);
    expect(await beginOperation(reviewed.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 })).toEqual({ alreadyInProgress: true });
    const failed = createFakeTableClient({ payment_operations: [{ id: 'f', campaign_id: 'c1', kind: 'charge', outcome: 'failed', once_slot: true }] }, {}, idx);
    expect('id' in (await beginOperation(failed.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 }))).toBe(true);
  });
  it('beginOperation acquires the lock; a second begin for the same campaign+kind reports alreadyInProgress (23505)', async () => {
    const db = createFakeTableClient({ payment_operations: [] }, {}, { uniqueIndexes: [{ columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } }] });
    const a = await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 });
    const b = await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 });
    expect('id' in a).toBe(true);
    expect(b).toEqual({ alreadyInProgress: true });
  });
  it('completeOperation finishes the pending row once; completing it again throws', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }] });
    await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'succeeded', amount: 120, providerDocument: { id: 7, number: 1, url: 'u' } });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', amount: 120, provider_document_id: 7 });
    await expect(completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'failed' })).rejects.toThrow();
  });
  it('compare-and-set: an admin resolve (from review) cannot touch a row that is still pending, and vice versa', async () => {
    const pending = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }] });
    await expect(completeOperation(pending.client as never, 'p1', { from: 'review', outcome: 'succeeded', amount: 120 })).rejects.toThrow();
    expect(pending.rows('payment_operations')[0].outcome).toBe('pending');
    const reviewed = createFakeTableClient({ payment_operations: [{ id: 'r1', campaign_id: 'c1', kind: 'charge', outcome: 'review' }] });
    await expect(completeOperation(reviewed.client as never, 'r1', { from: 'pending', outcome: 'failed' })).rejects.toThrow();
    await completeOperation(reviewed.client as never, 'r1', { from: 'review', outcome: 'succeeded', amount: 120, providerDocument: { id: 9, number: 2, url: 'u' }, note: 'confirmed in SUMIT by admin' });
    expect(reviewed.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', provider_document_id: 9 });
  });
  it('the authorize completion attaches the payment method created after SUMIT answered', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'a1', campaign_id: 'c1', kind: 'authorize', outcome: 'pending', payment_method_id: null }] });
    await completeOperation(db.client as never, 'a1', { from: 'pending', outcome: 'succeeded', amount: 200, paymentMethodId: 'pm-1', providerRef: '055528' });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', payment_method_id: 'pm-1', provider_ref: '055528' });
  });
  it('loadOperations joins the effect from the registry and maps to OperationRow', async () => {
    const db = createFakeTableClient({
      payment_operations: [{ id: 'a', campaign_id: 'c1', kind: 'authorize', outcome: 'succeeded', amount: '200', occurred_at: '2026-09-01T00:00:00Z', recorded_at: '2026-09-01T00:00:01Z', payment_operation_kinds: { effect: 'commit' } }],
    });
    expect(await loadOperations(db.client as never, 'c1')).toEqual([{ kind: 'authorize', effect: 'commit', outcome: 'succeeded', amount: 200, occurredAt: '2026-09-01T00:00:00Z', recordedAt: '2026-09-01T00:00:01Z' }]);
  });
});
```
> Step 0 (הרחבת `fake-table-client.ts`) קודם לכל הבדיקות כאן.

- [ ] **Step 2: כישלון. Step 3: מימוש `ledger.ts`** (`insert … select('id').single()`; `loadOperations` = `select('kind, outcome, amount, occurred_at, recorded_at, payment_operation_kinds!inner(effect)')` ממוין ב-`occurred_at, recorded_at`).

- [ ] **Step 4: חיבור הכותבים הקיימים**, בלי לשנות את הכתיבה הישנה:
  - `campaigns.ts` — `authorize` נכתב **פעם אחת, דו-שלבית** (audit-3 #25): `lockCampaignForHold` → `beginOperation({ kind: 'authorize', amount: hold.amount })` (alreadyInProgress = מה שהיום מחזיר "כבר בתהליך"); ה-id של השורה ה-pending עובר ב-`authorize/route.ts` יחד עם ה-lock; אחרי תשובת SUMIT: `recordCampaignHold` → `createPaymentMethod(...)` (ת"ז ל-Vault) ואז `completeOperation(id, { from: 'pending', outcome: 'succeeded', paymentMethodId, providerRef: hold.authNumber, providerDocument })`; `hold_failed`/`hold_review` → `completeOperation(id, { from: 'pending', outcome: 'failed'|'review' })`. אין `recordOperation` חד-פעמי ל-`authorize`. `lockCampaignForCharge` → `beginOperation({ kind: 'charge' })` (**בלי הורה**: חיוב חדש על הטוקן); `recordCampaignCharge` → `completeOperation(id, { from: 'pending', outcome: 'succeeded', amount, creditApplied, providerDocument })`; `markCampaignChargeOutcome('charge_failed'|'charge_review')` → `completeOperation(id, { from: 'pending', outcome: 'failed'|'review' })`; **`markCampaignChargeOutcome('nothing_to_charge', creditApplied)` → `completeOperation(id, { from: 'pending', outcome: 'succeeded', amount: 0, creditApplied })`** (audit finding 2: השורה ה-pending נסגרת, הזיכוי נרשם). עד Task 8 הכתיבה הישנה (UPDATE מסונן) נשארת לצד זה, וה-lock החדש הוא בדיקה כפולה.
  - `campaigns.ts` `activateCampaign` (★★ verifier): ה-`extraGuard` על `capture_status` נשאר עד Task 8; מ-Task 8 הטריגר `campaigns_guard_activate` (DB) הוא השומר האטומי.
  - `sumit-hold-reconcile.ts` אחרי `update({ release_status: 'released' })`: `release` succeeded, `source: 'provider_sync'`, `parentOperationId` של ה-authorize, `occurredAt` = עכשיו (זמן הזיהוי, כמו שורת ה-`activity_log` שהוא כותב). **מ-Task 8 (אין `release_status`):** המועמדים הם פעולות `authorize` מוצלחות עם `provider_document_id` שאין להן `release` מוצלח (`not exists` על `parent_operation_id`); ההתאמה מול תיקיית SUMIT נשארת לפי `provider_document_id` ↔ `hold_order_document_id` של SUMIT; אם שני runs חופפים, `parent_uq` מכריע (23505 → מדלגים). בדיקה ב-Task 8: fake client עם authorize שכבר יש לו release → לא נכתב שוב.
  - `close-charge.ts`: הת"ז נקראת דרך `readCitizenId(paymentMethodId)` כשיש `payment_method_id` על ה-authorize; אחרת מ-`campaign.card_citizen_id` (עד Task 8).
  - `event-cancellation.ts:520`: לצד `sumit_document_id` גם `recordOperation({ kind: 'cancellation_charge', … meta: { cancellation_request_id } })`.
  - **timeout לכל קריאה ל-SUMIT (VERIFY-4):** `signal: AbortSignal.timeout(60_000)` ב-`authorize.ts:102`, `capture.ts:167`, `capture.ts:289`, `charge.ts:58`, `raw-charge.ts:152`. `AbortError` נופל ל-`catch` הקיים → `SumitNetworkError` → `review` באותו תהליך (לא retry). ה-sweep של שלב 5א נשאר רק למוות של התהליך עצמו (pm2 `kill_timeout: 45000`, `ecosystem.config.cjs:68`). בדיקה: mock fetch שלא עונה → נזרק אחרי 60s (fake timers) → `review`.

- [ ] **Step 5א (owner 25.9, crash handling): job יתומים.** קובץ חדש `src/lib/data/payment-orphans.ts` (+ `payment-orphans.test.ts`) באותו דפוס של `sumit-hold-reconcile.ts`: `runPaymentOrphanSweep(admin, now)` בוחר `payment_operations` עם `outcome='pending' and recorded_at < now - interval '10 minutes'` (סף תקף רק יחד עם ה-timeout שנוסף בשלב 4 למטה: **היום אין timeout על אף קריאה ל-SUMIT** — `authorize.ts:102`, `capture.ts:167,289`, `charge.ts:58`, `raw-charge.ts:152` הם `fetch` בלי `signal`, ו-undici ב-Node 24 מגביל כותרות וגוף ל-300s כל אחד, כלומר עד ≈10 דקות, בדיוק הסף — VERIFY-4. עם `AbortSignal.timeout(60_000)`, `pending` בן 10 דקות הוא תהליך שמת, לא תהליך שרץ), ולכל אחת: `completeOperation(id, { from: 'pending', outcome: 'review', note: 'orphaned: process died mid-flight (sweep <now>)' })` + שורת `activity_log` `payment.operation_orphaned` (ids בלבד) + `sendSlackAlert` (category `campaign_billing`, level `error`, ids וסוג, בלי סכומים אישיים). ה-CAS מבטיח שאם התהליך המקורי בכל זאת השלים באותה שנייה, ה-sweep מקבל 0 שורות ומדלג. חיווט: `QUEUES.paymentOrphans = 'payment-orphans'` ב-`src/lib/queue/queues.ts`, `guardedWorker` + `boss.schedule(QUEUES.paymentOrphans, '*/10 * * * *')` ב-`worker/main.ts` ליד `sumitHoldReconcile` (שורות 1534-1536, 1623). בדיקות (fake client, `now` מוזרק): `pending` בן 11 דקות → `review` + התראה; `pending` בן 2 דקות → לא נוגעים; `review`/`succeeded` → לא נוגעים; אחרי ה-sweep `beginOperation` לאותו קמפיין+סוג עדיין `alreadyInProgress` (`once_uq`), ו-`resolvePaymentReview` (Task 7) הוא היחיד שפותח.
- [ ] **Step 5: בדיקת שוויון** ב-`ledger.test.ts`: מריצים את נתיב הכתיבה האמיתי (authorize → charge, authorize → nothing_to_charge, authorize → release) עם ה-fake client ומאמתים ש-`deriveStatus(loadOperations(...))` תואם את מה שהעמודות הישנות היו מציגות (`charged`→`collected`, `nothing_to_charge`→`collected`/0, `released`→`released`), ושסכום `credit_applied` ביומן שווה ל-`campaigns.credit_applied`.

- [ ] **Step 6: gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm run worker:deps && npx vitest run src/lib/payments src/lib/data && npm test
git add src/lib/payments/ledger.ts src/lib/payments/ledger.test.ts src/lib/data/campaigns.ts src/lib/data/sumit-hold-reconcile.ts src/lib/data/close-charge.ts src/lib/data/event-cancellation.ts src/test/fake-table-client.ts src/test/fake-table-client.test.ts src/lib/data/payment-orphans.ts src/lib/data/payment-orphans.test.ts src/lib/queue/queues.ts worker/main.ts
git commit -m "feat(payments): every payment writer also appends to payment_operations (dual-write)"
```
**פריסה בידי הבעלים.**

---

### Task 6: הקוראים — מסך הקמפיינים

**Files:**
- Modify: `src/lib/data/admin/campaigns.ts:209-279` (`listCampaignsForAdmin` (admin client, כבר היום) טוען `payment_operations(kind, outcome, amount, occurred_at, recorded_at, provider_document_number, provider_document_url, payment_operation_kinds(effect))` דרך `attachPayment` (Task 7 שלב 0 — נוצר כאן ומורחב שם) ומחזיר `payment: { status, collected, committed, documentNumber, documentUrl }`)
- Modify: `src/app/(admin)/admin/campaigns/page.tsx:42-73,105,130-138` (HoldCell → `PaymentCell` עם `paymentBadge`; כותרת "תפיסה" → "תשלום")
- Delete: `src/lib/data/admin/campaign-hold-badge.ts` + `.test.ts` (הוחלפו ב-Task 2)
- Modify: `src/lib/data/event-labels.ts:131-145` (`campaignStage` מקבל `PaymentStatus`; fallback ללגאסי עד Task 8)

- [ ] **Step 1: בדיקה נכשלת** (`src/lib/data/admin/campaigns.test.ts`, צור אם אין): שורה עם פעולות → `payment.status` מהיומן; שורה בלי פעולות → `deriveStatus([])` = `none` ותצוגת "—" (Review Focus #3). המסך לא קורא `capture_status`/`charge_status`/`release_status`.
- [ ] **Step 2–4: מימוש; `npx vitest run src/lib/data/admin src/lib/payments`**
- [ ] **Step 5: בדיקת דפדפן (הבעלים אחרי deploy):** `/admin/campaigns` מציג "שוחרר ללא גבייה" בקאקון ו-"נסגר ללא חיוב" בשני הסגורים (audit-3 #30), לא "תפוס".
- [ ] **Step 6: Commit** `refactor(admin): campaigns list reads the payment ledger; neutral labels`

---

### Task 7: הקוראים הנותרים — הסוכן, cores, ביטול אירוע, סטטיסטיקות

**Files:**
- Modify: `src/lib/owner-agent/cores/billing.ts`, `src/lib/owner-agent/cores/campaigns.ts` (`stuckHolds` → פעולות `authorize` עם `outcome in ('pending','failed','review')` — כמו היום, `STUCK_CAPTURE_STATUSES` כולל `hold_failed`; חדש `openCommitments` = קמפיינים ש-`deriveStatus` שלהם `committed` וסטטוס קמפיין סגור). **שאילתה אחת** לכל הקמפיינים המועמדים (`.in('campaign_id', ids)`) ואז `deriveStatus` בזיכרון לפי `campaign_id`; לא שאילתה לכל קמפיין (data-n-plus-one).
- Modify: `src/lib/owner-agent/consumer/primer.ts` (+ `primer.test.ts` drift): הטבלאות החדשות; "מצב תשלום = מחושב מ-`payment_operations` לפי `effect`"; קמפיין בלי פעולות = "אין פעולות תשלום" (Review Focus #3)
- Modify: `src/lib/data/event-cancellation.ts` (`hasCardOnFile` מ-`payment_methods`; ת"ז דרך `readCitizenId`; קריאה של המסמך מ-`payment_operations` לפי `meta.cancellation_request_id`)
- Modify: `src/lib/data/event-stats.ts:175,296`, `src/lib/data/setup-steps.ts:31`
- Modify (★★ verifier 24.9): `src/app/(admin)/admin/cancellations/[id]/page.tsx:41,44,96,124-126` — `campaign.chargeStatus`/`hasCardOnFile` (מ-`getCampaignForEventAdmin` ב-`event-cancellation.ts:206-231`) → `payment.status` + `paymentMethodId != null`; `request.sumitDocumentUrl` (מ-`ADMIN_SELECT` `event-cancellation.ts:118` → `mapAdminRow`:147) → `provider_document_url` של פעולת `cancellation_charge` (`meta.cancellation_request_id`), דרך `loadOperations`
- Modify (★ מפת השפעה ב): `src/app/(customer)/app/events/[id]/campaign/[campaignId]/page.tsx` + `manage-client.tsx`, `.../campaign/[campaignId]/payment/page.tsx:90-123`, `src/app/(customer)/app/events/[id]/event-summary.tsx`, `src/app/(customer)/app/events/[id]/stats/page.tsx`, `src/lib/data/admin/callbacks.ts:652`, `src/lib/data/admin/users.ts:278`, `src/lib/data/billing.ts:113`, `src/lib/data/tax-ceiling.ts:30`, `src/lib/data/admin/sumit-test.ts:40`, `scripts/sumit-doc-check.ts:45`, `src/lib/owner-agent/consumer/reply-text.ts`
- Create: `src/lib/payments/sums.ts` (+ test): `collectedSince(admin, since)`, `creditAppliedByEvent(admin, eventIds)` — שאילתה אחת לכל צרכן (הסוכן, `tax-ceiling`, `users`, `billing`). **שינוי משמעות מתועד (audit-3 #37):** היום שניהם סוכמים רק `charge_status='charged'`; מעכשיו כל `effect='collect'` מוצלח, כלומר **גם `cancellation_charge`**. לתקרת עוסק פטור זה נכון (גביית ביטול היא הכנסה). ל-"כמה נגבה החודש" של הסוכן — אותו דבר, והפריימר אומר זאת. היום 0 שורות כאלה, אין שינוי מספרי.
- Migration (CLI): `<timestamp>_owner_agent_billing_sums_from_ledger` — `owner_agent_billing_sums(_since)` נכתבת מחדש על `payment_operations` **באותה חתימה (4 עמודות; `unvoided_credit_amount`/`credit_granted_amount` נשארות מ-`billing_credits`)**; `types:check` אחרי; `cores/billing.test.ts` מוכיח שהצרכן לא השתנה
- Modify: `src/lib/data/campaigns.ts:56-57` (`CAMPAIGN_COLUMNS` בלי עמודות התשלום; `OwnerCampaign` מקבל `payment` מהיומן) ו-`:747-764` (רשימת העמודות של `getCampaignForCharge` → `payment_methods` + היומן)

- [ ] **Step 0א (owner 25.9, review lock):** פעולת אדמין חדשה `resolvePaymentReview(campaignId, operationId, { outcome: 'succeeded'|'failed', amount?, providerDocument?, note })` ב-`src/lib/data/admin/campaigns.ts` (gate `manage_billing` + `recordStaffAccess`, כמו שאר הקוראים שם) שקוראת `completeOperation(operationId, { from: 'review', … })` — ורק `from: 'review'`, כך שאדמין לא יכול לסגור שורה שעדיין `pending`; **ובדיקה מול SUMIT לפני ההכרעה (crash handling; VERIFY-4 תיקן שתי הנחות שגויות):** **אין ב-SUMIT חיפוש לפי `ExternalIdentifier`** (`swagger.json` `PaymentsController_Payments_List_Request` מקבל רק `Credentials/Date_From/Date_To/Valid/StartIndex`, `additionalProperties:false`; `Typed.Payment` מחזיר `CustomerID/Date/Amount/AuthNumber/ValidPayment` — בלי `ExternalIdentifier` ובלי `DocumentID`; וגם החיוב שולח את `auth_external_ref` של התפיסה, `close-charge.ts:344`, לא מזהה משלו). לכן פונקציה חדשה `probeSumitOperation(op)` ב-`src/lib/sumit/probe.ts` (קובץ חדש עם fetch משלו + `signal: AbortSignal.timeout(15_000)` כמו `health.ts:93`; + test עם fixtures): ל-`charge` — `POST /billing/payments/list/` עם `Date_From`/`Date_To` = ±1 יום סביב `recorded_at`, `Valid: true`, והתאמה אצלנו על `CustomerID` (= `payment_methods.provider_customer_id`) ו-`Amount` = סכום הפעולה (ו-`AuthNumber` אם קיים); ל-`authorize` — `POST /billing/paymentmethods/getforcustomer/` עם `Customer: { ID: <CustomerID> }, IncludeInactive: true` (הלוקאפ היחיד שעובד ל-J5, נמדד 14.7; ה-client לא קיים היום, רק טיפוסים) ומחזיר אם יש טוקן פעיל, ובנוסף `listCrmHolds` הקיים (`crm-holds.ts`) בהתאמה לפי סכום + `Billing_Date` ≈ `recorded_at`. התוצאה מוצגת כ-**הצעה** ("נמצא תשלום 120 ₪ ב-25.09, AuthNumber 0759469" / "לא נמצא"); **מספר המסמך אינו זמין מהחיפוש** ומוזן ידנית מה-dashboard של SUMIT, וההכרעה נשארת של אדם: `review` אצלנו פירושו "אולי חויב", ואף פעם לא retry אוטומטי; כפתור במסך `/admin/campaigns` על שורה במצב `review` ("אשר גבייה" עם מספר מסמך מ-SUMIT / "סמן כנכשל"). **היום אין פעולה כזו**: `charge_review` פשוט מנוסה שוב אוטומטית ב-`close-charge` (`close-charge.ts:136`). מעכשיו `review` חוסם עד הכרעה ידנית (אינדקס `once_uq`), ולכן הפעולה הזו חובה לפני Contract. בדיקה: fake client, שורה `review` → `succeeded` עם מסמך; `succeeded` → ניסיון נוסף נזרק.
- [ ] **Step 0 (audit-3 #28, #29):** (א) `src/lib/payments/read.ts`: `attachPayment(campaigns: {id}[]) → Map<campaignId, PaymentState>` — שאילתה אחת ב-`createAdminClient()` על `payment_operations` עם `.in('campaign_id', ids)`, `deriveStatus` בזיכרון. כל קורא בצד הלקוח (`getCampaign` ועוד, cookie client) קורא את הקמפיין כמו היום ואז `attachPayment` **אחרי** `requireOwnedEvent`; `CAMPAIGN_COLUMNS` לא מקבל embed. (ב) `ADMIN_ATTENTION_FILTER` (`cores/campaigns.ts:51`, מחרוזת PostgREST על `capture_status`, בשימוש ב-`admin/campaigns.ts:260` וב-`needsAttention` `cores/campaigns.ts:95`) לא ניתן לביטוי כפילטר אחד כשהמידע בטבלת-בת. מוחלף בפונקציה `listAttentionCampaigns(admin)`: שאילתה 1 = `status in WINDDOWN_STATUSES`; שאילתה 2 = `status='approved'` + `attachPayment` + סינון `status in ('pending','declined','review')` בזיכרון; איחוד לפי id. `listCampaignsForAdmin` ו-`needsAttention` קוראים לאותה פונקציה, כך ש-"המספר של הסוכן = אורך הרשימה" נשמר. בדיקה: fake client עם קמפיין `approved` + `authorize` failed → מופיע; `approved` + `authorize` succeeded → לא.
- [ ] **Step 1:** לכל קובץ: בדיקה שמוכיחה קריאה מהיומן (fake client), כישלון, החלפה, הצלחה.
- [ ] **Step 2:** `npm run owner-agent:smoke` על 3 שאלות: "האם יש תפיסות פתוחות?", "כמה נגבה החודש?", "מה מצב התשלום של קאקון?"; תעד ב-`plans/owner-whatsapp-agent-plan.md`.
- [ ] **Step 3:** וודא: `grep -rn "capture_status\|charge_status\|release_status\|card_citizen_id\|card_token_ref\|hold_order_document" src worker --include=*.ts --include=*.tsx | grep -v test | grep -v types.generated | grep -v "^[^:]*:[0-9]*:\s*//"` מחזיר רק את הכתיבות הכפולות של Task 5 ב-`campaigns.ts`/`sumit-hold-reconcile.ts`/`close-charge.ts`/`event-cancellation.ts` (הערות ב-`crm-holds.ts`, `hold-status.ts`, `queues.ts`, `worker/main.ts` מתעדכנות ב-Task 8; `sumit-customers.ts` מכיל את העמודה של הטבלה שלו ולא נכלל ב-grep).
- [ ] **Step 4: gates מלאים + commit** `refactor(payments): remaining readers move to the ledger; agent primer knows derived status`

**פריסה בידי הבעלים.**

---

### Task 8: Contract — מחיקת 26 העמודות מ-`campaigns` (+2 מ-`event_cancellation_requests`) והכתיבה הכפולה

**Files:**
- Create: `supabase/migrations/<timestamp>_payment_operations_contract.sql` (CLI)
- Modify: `campaigns.ts`, `sumit-hold-reconcile.ts` (המועמדים מהיומן: `authorize` מוצלח בלי `release`; dedupe ב-`parent_uq`), `close-charge.ts`, `event-cancellation.ts` (הסרת הכתיבה ללגאסי), `src/lib/data/event-cancellation.ts` (הפסקת קריאה של `sumit_document_id`)

- [ ] **Step 1: תנאי מקדים (הבעלים):** Task 5–7 פרוסים ≥ 7 ימים; אין ב-`ops_errors` שגיאה שמזכירה `payment_`; גיבוי נלקח.
- [ ] **Step 2 (★ מפת השפעה א): הפונקציות שקוראות את העמודות — נכתבות מחדש באותה מיגרציה, לפני ה-`drop column`**

```sql
set lock_timeout = '5s';   -- first statement of the file: db push runs this file as one batch (no create/drop index), so it holds for all of it
-- Activation requires a payment method on file — nothing about amounts. (Owner 25.9: the recipient ceiling tied to
-- the hold amount is retired; billing is bounded by contacts actually reached, per the outcome-billing model.)
-- Replaces activateCampaign's `.eq('capture_status','authorized')` guard, atomically, like campaigns_guard_cancel.
create or replace function public.campaigns_guard_activate()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Same scope as today's activateCampaign guard, which passes extraGuard capture_status='authorized' for EVERY
  -- from-status including paused (campaigns.ts:957-958, 984-996).
  if new.status = 'active' and old.status in ('approved', 'scheduled', 'paused')
     and not exists (
       select 1 from public.payment_operations o
        where o.campaign_id = new.id and o.outcome = 'succeeded' and o.payment_method_id is not null) then
    raise exception 'campaign cannot be activated: no payment method on file' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger campaigns_guard_activate before update on public.campaigns
  for each row execute function public.campaigns_guard_activate();

-- reconcile_authorized_set / try_record_billed_result: the funded_cap (auth_amount-based) branch is REMOVED, not
-- re-pointed at the ledger. reconcile admits every eligible guest (no 'ceiling_full'); try_record bills every
-- exposed contact (no 'ceiling_reached'). Everything else in each body stays byte-identical (copy from
-- `pg_get_functiondef`, do not retype). The signed agreement (v5) already states the price as a formula of the
-- list, not a frozen number, so no customer-facing promise changes.
-- campaigns_guard_cancel / cancel_campaign: replace the three `capture_status` lines and the `charge_status` line with
--   and not exists (select 1 from public.payment_operations o join public.payment_operation_kinds k on k.kind=o.kind
--                   where o.campaign_id = <id> and k.effect <> 'none' and o.outcome in ('succeeded','pending','review'))
-- This is EQUIVALENT to today (a succeeded release still blocks cancel, because capture_status stays 'authorized'
-- after a release). The ledger would allow a truer rule ("no open commit and nothing collected") — product decision,
-- deliberately NOT taken in this plan.
```
בדיקה (קריאה בלבד מול החי, בתוך ה-dry-run עם ROLLBACK): ניסיון `update campaigns set status='active'` על קמפיין `approved` בלי פעולה מוצלחת עם אמצעי תשלום נכשל ב-`check_violation`; על קאקון (authorize מוצלח עם `payment_method_id`) עובר; `select public.reconcile_authorized_set(...)` על קמפיין עם רשימה גדולה מ-`max_contacts` מחזיר `added`, לא `ceiling_full`; `pg_get_functiondef` של שתי הפונקציות לא מכיל `auth_amount`, `v_auth`, `v_funded_cap`, `v_cap`. `reconcile.integration.test.ts` **לא** רץ מול החי (Global Constraints); אם יוקם DB בדיקה — מריצים אותו שם אחרי `pg_tle` + `dbdev.install('cem-uuidv7')`.

- [ ] **Step 3:** באותו קובץ מיגרציה, אחרי הפונקציות (`set lock_timeout = '5s'` בשורה **הראשונה של הקובץ**, לפני ה-`create trigger` של Step 2 שדורש SHARE ROW EXCLUSIVE, ולא רק לפני ה-`drop column`: `drop column` לוקח ACCESS EXCLUSIVE ומחכה מאחורי כל `for update` פתוח ב-`try_record_billed_result`/`reconcile_authorized_set`; אם נכשל על timeout, מריצים שוב בחלון שקט — audit finding 17):

```sql
-- Contract: the payment columns leave public.campaigns. Every reader moved in Tasks 6–7,
-- every writer in Task 5; the grep at Task 7 step 3 was empty of readers.
alter table public.campaigns
  -- payment, live (23)
  drop column capture_status, drop column release_status, drop column charge_status,
  drop column auth_amount, drop column auth_number, drop column authorized_at, drop column auth_external_ref,
  drop column card_token_ref, drop column card_exp_month, drop column card_exp_year, drop column card_citizen_id,
  drop column sumit_customer_id, drop column hold_order_document_id, drop column hold_order_document_number, drop column hold_order_document_url,
  drop column final_charge_amount, drop column credit_applied, drop column charged_at,
  drop column sumit_charge_document_id, drop column charge_document_number, drop column charge_document_url,
  drop column charge_auth_number, drop column charge_payment_id,
  -- payment, dead (3) — null in 3/3 rows, no reader, no writer (measured 2026-09-24)
  drop column billing_route, drop column sumit_order_document_id, drop column final_invoice_document_id;
drop type public.billing_route;
-- campaign, dead (2) — default in 3/3 rows, no reader, no writer. OWNER DECISION PENDING: keep this block only after an explicit yes.
-- alter table public.campaigns drop column enabled, drop column steps;
-- event_cancellation_requests: the document now lives in payment_operations (kind cancellation_charge, meta.cancellation_request_id).
alter table public.event_cancellation_requests drop column sumit_document_id, drop column sumit_document_url;
-- max_charge_ceiling, base_price, included_reached, price_per_reached STAY: pricing of the campaign, not the payment.
-- ROLLBACK: restore from the pre-contract backup the owner takes first (dashboard → backups), not by migration.
```
- [ ] **Step 4:** הסר את הכתיבות הלגאסי; עדכן את ההערות ב-`queues.ts:184`, `worker/main.ts:1532`, `sumit/capture.ts:21`, `crm-holds.ts:15,29`, `hold-status.ts:18`, `sumit-customers.ts`; `gen:types` → `tsc` מצביע על כל קורא שנשאר; תקן; `npm test`.
- [ ] **Step 5:** הבעלים: גיבוי → `db push --dry-run` → `db push` → `gen:types` → `deploy`.
- [ ] **Step 6: Commit** `feat(db): payment operations — contract: 26 payment columns dropped from campaigns (+2 from event_cancellation_requests), ceiling/cancel functions on the ledger`

---

### Task 9: תיעוד, ממצא #6, זיכרון

**Files:**
- Modify: `docs/project/03-database-schema.md`, `docs/project/08-billing-and-payments.md`
- Modify: `plans/owner-whatsapp-agent-plan.md`; `plans/payment-events-implementation-plan.md` (כותרת: "הוחלף ב-docs/superpowers/plans/2026-09-24-campaign-payment-domain-split.md")
- Modify: זיכרון `stuck-j5-hold-bac77347-cleanup.md` → אין מסגרות תקועות; שלושתן שוחררו ב-SUMIT (נמדד 24.9)

- [ ] **Step 1:** `03-database-schema.md`: שלוש הטבלאות, ה-effect, ההצהרה "מצב מחושב, לא נשמר", איך מוסיפים סוג פעולה (שורה ברישום).
- [ ] **Step 2 (ממצא #6, מתועד ולא מתוקן):** ב-`08-billing-and-payments.md`: "`campaigns.status` מכיל `awaiting_invoice`/`billed`/`paid` שאף קוד לא כותב (נמדד 24.9). מצב התשלום מחושב מ-`payment_operations`. הסרת ערך מ-enum אינה נתמכת ב-Postgres; לא בוצע."
- [ ] **Step 3:** זיכרון; **Step 4: Commit** `docs(payments): operations ledger documented; dead status values recorded`

---

## סדר פריסה (הבעלים)

| אחרי Task | פעולה |
|---|---|
| 1 | `db push` → `gen:types` → `advisors` |
| 4 | `dist/payments-backfill.cjs` (plan) → `--apply` |
| 5 | `npm run deploy` (כולל ה-worker: ה-job `payment-orphans` מתחיל לרוץ כל 10 דקות) |
| 7 | `db push` (מיגרציית `owner_agent_billing_sums_from_ledger`) → `gen:types` → `advisors` → `npm run deploy`; `/admin/campaigns` בדפדפן; 3 שאלות לסוכן |
| 8 | גיבוי → `db push` → `gen:types` → `deploy` |

בין 7 ל-8: לפחות שבוע באוויר.

## פתוח להחלטת הבעלים

- מחיקת `campaigns.enabled` ו-`campaigns.steps` ב-Task 8 (שתיהן מתות; נמדד).
- Commit של תיקון תווית 3 העמודות שכבר עשיתי במסך הקמפיינים (מתקן את המסך היום; מוחלף ב-Task 6).
