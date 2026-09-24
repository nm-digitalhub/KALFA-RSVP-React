# טבלת פעולות תשלום — הוצאת התשלום מטבלת `campaigns`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** כל דבר שקורה לכסף של קמפיין נרשם כשורה בטבלה אחת, `payment_operations`. מצב התשלום לא נשמר בשום עמודה: הוא מחושב מרצף השורות. `campaigns` נשארת עם הקמפיין בלבד.

**Architecture:** שתי טבלאות חדשות, לא חשופות ל-Data API (רק `service_role`), RLS דלוק, בלי policies: `payment_methods` (אמצעי התשלום השמור; ת"ז ב-Vault) ו-`payment_operations` (יומן append-only של פעולות: אישור מסגרת, גבייה, שחרור, חיוב ישיר, גביית ביטול, החזר, כל דבר שיבוא). סוג הפעולה הוא **טקסט ברישום** (`payment_operation_kinds`), לא enum סגור: פעולה חדשה מחר היא שורה ברישום, לא מיגרציה. לרישום יש עמודת `effect` (`commit` / `collect` / `return` / `none`) שממנה קוד אחד מחשב את המצב לתצוגה, כך שגם החישוב לא תלוי בסוג ספציפי. המעבר הוא **Expand → Migrate → Contract**: קודם הטבלאות והכתיבה הכפולה, אחר כך הקוראים, ורק בסוף מחיקת 21 העמודות החיות ו-6 המתות מ-`campaigns`. כל שלב פרוס וניתן להחזרה בנפרד.

**Tech Stack:** Supabase Postgres (מיגרציות ב-`supabase migration new` בלבד), Supabase Vault (הדפוס של `integration_connections`), `supabase-js` service-role בשרת, TypeScript, Zod 4, Vitest.

**Spec:** השיחה של 24.9 (הממצאים והחלטות הבעלים, מסוכמים למטה) + `plans/payment-events-implementation-plan.md` (1.7, יומן append-only שנעצר בהיקף כלי הבדיקה; תוכנית זו מחליפה אותו). **מקורות שנמדדו היום:** הקטלוג החי של `campaigns` (49 עמודות אחרי שהבעלים מחק את `auth_expires_at` ב-`ALTER TABLE`; `types.generated.ts` נוצר מחדש ב-20:52 ו-`types:check` עובר), הקוראים והכותבים של כל עמודה ב-`src/`, תיקיית תפיסות המסגרת ב-SUMIT, `src/lib/sumit/capture.ts:135` (SUMIT דורש `CreditCard_CitizenID` בגבייה מטוקן), changelog של Supabase 2026-04-28 (טבלאות חדשות לא נחשפות אוטומטית ל-Data API; אכיפה לכל הפרויקטים ב-2026-10-30).

## החלטות הבעלים (24.9)

1. השלב הראשון קבוע, רק הסוף מתחלף; מה שמוצג הוא **תרגום** של העובדות, לא עמודה נוספת.
2. **לא לתכנן סביב סוג פעולה ספציפי.** "תפיסה" היא מקרה אחד; חיוב ישיר של דמי ההפעלה (200 ₪), החזר, או תשלום אחר חייבים להיכנס בלי שינוי מבנה.
3. שמות ניטרליים לתשלום (לא `hold`, לא `auth_*`, לא "תפוס").
4. הת"ז לא בעמודה. `auth_expires_at` אינו נתון (SUMIT לא מחזיר תפוגה לתפיסה) והבעלים כבר מחק אותו.

## הממצאים שהתוכנית מתקנת

| # | ממצא (נמדד 24.9) | תיקון | Task |
|---|---|---|---|
| 1 | `capture_status` נשאר `authorized` לתמיד; החיוב/השחרור נרשמים בעמודות אחרות; המסך הציג "תפוס" לשלושה מצבים | המצב מחושב מרצף הפעולות (`deriveStatus`), לא נשמר | 2, 6 |
| 2 | שלוש שכבות מצב בלי אילוצי ערכים; `captured`/`expired` תוכננו ואף קוד לא כתב אותם | פעולה = שורה עם `outcome` אחד; סוגים ברישום עם FK | 1 |
| 3 | `billing_route` ריק ב-3 מ-3 | נמחק (יחד עם ה-enum). "איך שולם" = `kind` של הפעולה | 8 |
| 4 | `card_citizen_id` בטקסט פתוח ב-`campaigns`, שנקראת ל-`anon` דרך Data API | Vault דרך `payment_methods_write`; הטבלאות החדשות לא חשופות | 1, 3 |
| 5 | שתי תפיסות (4 ₪, 152 ₪) שוחררו ב-SUMIT ב-07.07/21.07 בלי `release_status` | פעולת `release` עם `source='manual_backfill'` לפי מה שנמדד בתיקיית SUMIT | 4 |
| 6 | ערכים מתים ב-`campaigns.status` (`awaiting_invoice`,`billed`,`paid`) | לא נוגעים ב-enum; מתועד | 9 |
| 7 | 6 עמודות מתות ב-`campaigns`: `billing_route`, `sumit_order_document_id`, `final_invoice_document_id` (תשלום), `enabled`, `steps` (קמפיין), `auth_expires_at` (כבר נמחקה ידנית) | נמחקות ב-Contract; המחיקה הידנית מתועדת במיגרציה עם `if exists` | 8 |
| 8 | `sumit_customer_id` כפול: ב-`sumit_customers` וב-`campaigns` | נשאר רק ב-`sumit_customers` + `payment_methods.provider_customer_id` | 5, 8 |
| 9 | `event_cancellation_requests.sumit_document_id/_url` = פעולת תשלום שנכתבה לטבלה של תחום אחר | פעולה מסוג `cancellation_charge`; הטבלה מצביעה עליה | 4, 7 |

## מפת השפעה — היכן משתמשים במה שמפוצל (נמדד 24.9, 22:00)

נמדד בשני מקורות: `pg_depend` + חיפוש בגוף כל פונקציה/view/policy/trigger ב-DB החי, ו-grep על כל 28 שמות העמודות ב-`src/`, `worker/`, `scripts/`, `supabase/functions/`. **אומת 24.9 22:19 על ידי סוכן `sumit-billing-expert` במעקב זרימת נתונים (לא grep):** 6 החמצות (★★ למטה: camelCase, טיפוסים ו-guards ש-grep לא רואה) ו-3 שגיאות שתוקנו: (א) `campaign_committed_amount` ניכה שחרור והיה מפיל את תקרת הנמענים של קאקון ל-0 → עכשיו "ה-commit המוצלח האחרון", זהה ל-`deriveStatus().committed`; (ב) מחיקת עמודות הנעילה בלי תחליף → אינדקס `one_pending_uq` + טריגר `guard_update` + `beginOperation`/`completeOperation` (Task 1, 5) וטריגר `campaigns_guard_activate` (Task 8); (ג) `sumit-customers.ts` שובץ בטעות. הסוכן אישר נקי: views, policies, פונקציות מחוץ ל-`public`, edge functions, `src/lib/workflow`, Zod, fleet, seed, תבניות מייל/הסכם, רשימת 20 הבדיקות. **כל פריט משובץ ל-Task; מה שלא היה בתוכנית מסומן ★, ומה שרק הסוכן מצא ★★.**

### א. אובייקטים ב-DB (חייבים להשתנות לפני Contract, אחרת `drop column` נכשל או שובר לוגיקה)

| אובייקט | מה הוא קורא | מה הוא עושה | תיקון | Task |
|---|---|---|---|---|
| ★ `campaigns_guard_cancel()` (trigger על `campaigns`) | `capture_status`, `charge_status` | חוסם `status='cancelled'` אם יש תפיסה חיה או חיוב | הבדיקה הופכת ל-"אין ב-`payment_operations` פעולה עם `outcome in ('succeeded','pending','review')` ו-`effect<>'none'`"; trigger חדש באותו שם | 8 |
| ★ `cancel_campaign()` (RPC) | `capture_status`, `charge_status` | אותו תנאי, בצד ה-RPC | אותו תיקון | 8 |
| ★ `owner_agent_billing_sums(_since)` (RPC של הסוכן) | `final_charge_amount`, `charge_status`, `charged_at`, `credit_applied` | סכומי "נגבה החודש" ו-"זיכויים שקוזזו" | `sum(amount)` / `sum(credit_applied)` על `payment_operations` join `kinds` where `effect='collect' and outcome='succeeded' and occurred_at >= _since` | 7 |
| ★ `reconcile_authorized_set(...)` (RPC, הקפאת נמענים) | `auth_amount` | תקרת נמענים: `included + floor((auth − base) / price)` | `auth_amount` → הסכום המחויב הפתוח: `sum(amount)` של פעולות `effect='commit'`, `outcome='succeeded'`, שאין להן פעולת `return`/`collect` מוצלחת. מוגדר כפונקציית SQL אחת `campaign_committed_amount(campaign_id)` ומשמש בשני ה-RPC | 8 |
| ★ `try_record_billed_result(...)` (RPC, רישום נמען שהושג) | `auth_amount` | אותה תקרה בזמן אמת | `campaign_committed_amount(campaign_id)` | 8 |
| `billing_route` (enum) | העמודה `campaigns.billing_route` בלבד | אין קוראים | `drop column` ואז `drop type` | 8 |
| `campaigns_require_active_event`, `trg_campaigns_updated`, שני הטריגרים של `event_cancellation_requests` | לא נוגעים בעמודות המפוצלות | — | ללא שינוי | — |
| views (`console_campaigns` ועוד) | אף view לא קורא עמודה מפוצלת (נמדד ב-`pg_depend` וב-`pg_views`) | — | ללא שינוי | — |
| policies | אף policy לא מפנה לעמודה מפוצלת | — | ללא שינוי | — |

> **חשוב ל-`campaign_committed_amount`:** שני ה-RPC של ההקפאה רצים על כל רישום נמען. הפונקציה חייבת להיות `stable`, `security invoker`, ולהשתמש באינדקס `(campaign_id, occurred_at desc)`. בדיקה ב-Task 8: `explain` מראה Index Scan.

### ב. קוד — לפי Task

| קובץ | עמודות | תיקון | Task |
|---|---|---|---|
| `src/lib/data/campaigns.ts` | 22 עמודות: כל הכתיבה של תפיסה/חיוב + `CAMPAIGN_COLUMNS` | כותב: Task 5; קורא/`OwnerCampaign`: Task 7 | 5, 7 |
| `src/lib/data/close-charge.ts` | `card_*`, `sumit_customer_id`, `auth_external_ref`, `capture_status`, `charge_status`, `credit_applied` | הכרטיס מ-`payment_methods` (+ ת"ז מ-Vault), ההרשאה מפעולת `authorize`, החיוב = פעולת `capture` | 5, 7 |
| `src/lib/data/sumit-hold-reconcile.ts` | `auth_amount`, `capture_status`, `hold_order_document_id`, `release_status` | מתאים לפי `provider_document_id` של פעולת `authorize`; כותב פעולת `release` | 5, 7 |
| `src/lib/data/event-cancellation.ts` | `card_*`, `auth_external_ref`, `charge_status`, `credit_applied`, `final_charge_amount`, `sumit_document_id/_url` | כרטיס מ-`payment_methods`; גביית ביטול = פעולת `cancellation_charge` | 5, 7 |
| `src/lib/data/admin/campaigns.ts` + `campaign-hold-badge.ts` + `src/app/(admin)/admin/campaigns/page.tsx` | `capture_status`, `charge_status`, `release_status`, `credit_applied`, `final_charge_amount`, `hold_order_document_*` | מסך הקמפיינים קורא מהיומן | 6 |
| ★ `src/app/(customer)/app/events/[id]/campaign/[campaignId]/page.tsx` + `manage-client.tsx` | `capture_status`, `charge_status`, `credit_applied`, `final_charge_amount` | מסך הקמפיין של הלקוח: `payment` מ-`deriveStatus` במקום 4 העמודות | 7 |
| ★ `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/page.tsx` | `capture_status`, `auth_amount` | "כבר אושר?" = `status in ('committed','collected')`; הסכום = `committed` | 7 |
| ★ `src/app/(customer)/app/events/[id]/event-summary.tsx` | `charge_status`, `final_invoice_document_id` | `final_invoice_document_id` מת (ריק ב-3/3) → מסמך החיוב = `provider_document_url` של פעולת ה-`collect` | 7 |
| ★ `src/app/(customer)/app/events/[id]/stats/page.tsx`, `src/lib/data/event-stats.ts` | `capture_status`, `card_*`, `charge_*`, `credit_applied`, `final_charge_amount` | מהיומן | 7 |
| ★ `src/app/api/campaigns/[id]/authorize/route.ts` | `auth_number`, `authorized_at`, `capture_status` | קורא ל-`recordCampaignHold` (Task 5); ההערות והתשובה ל-client מתעדכנות | 5 |
| ★ `src/lib/data/admin/callbacks.ts:652` | `authorized_at` | "מתי נתפסה המסגרת הראשונה" = `min(occurred_at)` של `authorize` מוצלח | 7 |
| ★ `src/lib/data/admin/users.ts:278`, `src/lib/data/billing.ts:113` | `credit_applied` | יתרת זיכוי לאירוע = מוענק − `sum(credit_applied)` על פעולות `collect` מוצלחות | 7 |
| ★ `src/lib/data/tax-ceiling.ts:30` | `final_charge_amount`, `charge_status`, `charged_at` | הכנסה שנתית = `sum(amount)` על `collect` מוצלח מתחילת השנה (אותה שאילתה כמו `owner_agent_billing_sums`; להוציא ל-`src/lib/payments/sums.ts` ולהשתמש בשניים) | 7 |
| ★ `src/lib/data/admin/sumit-test.ts:40`, `scripts/sumit-doc-check.ts:45` | `card_*`, `sumit_customer_id` | כלי אבחון: "קמפיין עם כרטיס שמור" = `payment_methods` פעיל | 7 |
| `src/lib/data/sumit-customers.ts` | — | **לא נוגע ב-`campaigns`** (verifier): משווה `sumit_customers.sumit_customer_id` לתשובת SUMIT. ללא שינוי | — |
| `src/lib/data/event-labels.ts`, `setup-steps.ts` | `capture_status` | `PaymentStatus` | 6, 7 |
| `src/lib/owner-agent/cores/billing.ts`, `cores/campaigns.ts`, `consumer/primer.ts`, ★ `consumer/reply-text.ts` | 8 עמודות | הסוכן קורא מהיומן; ה-primer מתאר את הטבלאות החדשות | 7 |
| ★ הערות בלבד: `src/lib/queue/queues.ts:184`, `worker/main.ts:1532`, `src/lib/sumit/capture.ts:21`, `crm-holds.ts:15,29`, `hold-status.ts:18` | שמות עמודות בהערות | עדכון ההערות ב-Contract | 8 |
| ★★ `src/app/(admin)/admin/cancellations/[id]/page.tsx:41,44,96` (verifier, camelCase) | `campaign.chargeStatus`, `campaign.hasCardOnFile` דרך ה-DTO של `getCampaignForEventAdmin` | "לפני חיוב / יש כרטיס" מ-`payment.status` ומ-`payment_methods` | 7 |
| ★★ אותו דף, שורות 124-126 (verifier) | `request.sumitDocumentUrl` ← `ADMIN_SELECT` ← `sumit_document_url` | ה-URL מפעולת `cancellation_charge` | 7 |
| ★★ `src/lib/data/campaigns.ts` `activateCampaign` (verifier) | `.eq('capture_status','authorized')` כ-guard אטומי ב-UPDATE (לא קורא, לא כותב) | טריגר `campaigns_guard_activate` | 5, 8 |
| ★★ `src/lib/data/campaigns.ts` `lockCampaignForHold` / `lockCampaignForCharge` / `markCampaignChargeOutcome` (verifier) | UPDATE מסונן על `capture_status`/`charge_status` = ה-mutex של "חיוב פעם אחת" | `beginOperation`/`completeOperation` + אינדקס `one_pending_uq` + טריגר `guard_update` | 1, 5 |
| ★★ `src/app/(customer)/app/events/[id]/page.tsx:342` → `setup-steps.tsx:49-63` (verifier) | `OwnerCampaign` → `computeSetupSteps` דורש `capture_status` בטיפוס | מתעדכן בגרירה עם `SetupInput` | 7 |
| ★★ `.claude/agents/shared/tax-catalog-israel.md:70,194` (verifier) | מתאר התנהגות לפי `charge_status='charged'`/`charged_at` | §ד | 9 |

### ג. בדיקות שיישברו (20 קבצים) — כל אחת מתעדכנת באותו Task כמו הקובץ שהיא בודקת

`authorize/route.test.ts`, `close-charge/route.test.ts`, `whatsapp-send/route.test.ts`, `admin/callbacks.test.ts`, `admin/campaign-hold-badge.test.ts` (נמחק ב-6), `admin/users.test.ts`, `billing.test.ts`, `campaign-lifecycle-parity.test.ts`, `campaigns.test.ts`, `close-charge.test.ts`, `event-cancellation.test.ts`, `event-labels.test.ts`, `event-stats.test.ts`, `reconcile.integration.test.ts` (★ בודק את `reconcile_authorized_set` חי — חייב לרוץ אחרי Task 8), `setup-steps.test.ts`, `sumit-hold-reconcile.test.ts`, `tax-ceiling.test.ts`, `owner-agent/consumer/primer.test.ts`, `owner-agent/cores/billing.test.ts`, `owner-agent/cores/campaigns.test.ts`.

### ד. תיעוד שמזכיר את העמודות (מתעדכן ב-Task 9)

`docs/project/03-database-schema.md`, `04-events-and-lifecycle.md`, `06-campaigns-and-outreach.md`, `08-billing-and-payments.md`, `10-api-and-webhooks.md`, `docs/schema-and-architecture.md`, `docs/sumit-payments-implementation.md`, `docs/sumit-response-capture-and-audit.md`, `.claude/agents/sumit-billing-expert.md`, `.claude/agents/campaign-outreach-engineer.md`, ★★ `.claude/agents/shared/tax-catalog-israel.md:70,194`. תוכניות ישנות ב-`plans/` ו-`docs/superpowers/plans/2026-06-26-*` נשארות כהיסטוריה עם הערת "הוחלף" בראש.

## ביקורת מול supabase-postgres-best-practices (24.9, 21:05)

| כלל | מה נבדק | תוצאה |
|---|---|---|
| schema-foreign-key-indexes | כל FK ב-`payment_operations`/`payment_methods` | תוקן: נוספו אינדקסים ל-`event_id`, `payment_method_id`, `parent_operation_id`; `owner_user_id` הפך לאינדקס מלא (cascade מ-`auth.users`). `kind` לא מאונדקס בכוונה (רישום של 6 שורות). בדיקה (e) ב-dry-run |
| schema-primary-keys | uuid v4 מפצל אינדקסים | **תוקן 21:49:** הבעלים התקין `cem-uuidv7` 1.0.2 בסכימה `extensions`; אומת חי: `extensions.uuid_generate_v7()` מחזירה v7 (nibble 7), מונוטונית, ו-`service_role` יכול להריץ. שתי הטבלאות החדשות ב-v7. שאר 94 הטבלאות נשארות v4 (לא נוגעים) |
| schema-data-types | `numeric(12,2)` לכסף, `timestamptz`, `text` ולא `varchar`, `bigint` למזהי ספק | תואם |
| schema-constraints | `add constraint if not exists` אסור | לא בשימוש; אילוצים inline ב-`create table` |
| security-privileges | least privilege | `service_role` בלבד; `payment_operations` = `select, insert` בלבד (append-only) |
| security-rls-basics | RLS על כל טבלה ב-`public` | דלוק, אפס policies, בלי grants ל-`anon`/`authenticated` |
| advanced-jsonb-indexing | חיפוש על `meta->>'cancellation_request_id'` | תוקן: expression index חלקי |
| query-composite-indexes | `loadOperations` מסנן `campaign_id` וממיין `occurred_at` | `(campaign_id, occurred_at desc)`: שוויון ואז טווח |
| data-n-plus-one | `openCommitments` בסוכן | תוקן ב-Task 7: שאילתה אחת + חישוב בזיכרון |
| lock-short-transactions | הכתיבה ליומן אחרי קריאת SUMIT | `recordOperation` הוא insert בודד אחרי ה-HTTP, לא בתוך טרנזקציה פתוחה; Contract מוריד 27 עמודות על 3 שורות (נעילה של מילישניות) |

## Global Constraints

- **מיגרציות רק ב-`npx supabase migration new <name>`**; לעולם לא שם ידני. החלה רק ב-`npx supabase db push --linked` אחרי `--dry-run` שמציג רק את הקובץ החדש, ורק **בידי הבעלים**.
- **אחרי כל מיגרציה:** `npm run gen:types && npm run types:check`. **`src/lib/supabase/types*.ts` לעולם לא בעריכה ידנית.**
- **`npx supabase db advisors --linked --type security` אחרי כל מיגרציה**; אין ממצא חדש על האובייקטים החדשים.
- **טבלאות חדשות:** `enable row level security`; `revoke all … from public, anon, authenticated`; **בלי** grant ל-`anon`/`authenticated` ובלי policy עבורם. `service_role` מקבל `select, insert, update` על `payment_methods`/`payment_operation_kinds`; על `payment_operations` — `insert` + `update` על עמודות ההשלמה בלבד, וטריגר מבטיח שרק שורה `pending` משתנה, פעם אחת. אין delete לאף תפקיד.
- **RLS על `campaigns` לא משתנה** בתוכנית הזו.
- **אין `SECURITY DEFINER` חדש.** פונקציות Vault הן `security invoker` + `set search_path = ''` + `revoke execute from public, anon, authenticated` + `grant execute to service_role`, הדפוס של `20260916002343_integration_credential_store.sql`.
- **סוגי פעולה הם נתונים, לא קוד:** קוד לא משווה ל-`kind` ספציפי כדי לחשב מצב; הוא קורא `effect` מהרישום. השוואה ל-`kind` מותרת רק בכותב שיוצר את הפעולה.
- **Expand → Migrate → Contract:** שום Task לא מוחק עמודה מ-`campaigns` לפני Task 8. עד אז הקוד כותב לשני המקומות (Task 5) והבדיקות מוכיחות שוויון.
- **פריסה בידי הבעלים בלבד** (`npm run deploy`), אחרי Task 5 ואחרי Task 7, לפני Task 8. אין `next build` במקביל.
- **אין `any`; Zod בגבולות; שגיאות למשתמש בעברית וגנריות. `events.event_date` לעולם לא `slice(0,10)`.**
- **כל Task = commit נפרד** עם ה-trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` ו-`Claude-Session: https://claude.ai/code/session_01T7V4yCBdhLzRsq8LHfd13g`. השינוי הקיים ב-`types.generated.ts` (3 מחיקות, 20:52) נכנס ל-commit של Task 1.

## Review Focus

1. **קמפיין שנסגר בלי חיוב ושוחרר ידנית ב-SUMIT לפני הסגירה** (המצב של קאקון היום): רצף `authorize→release` בלי פעולת גבייה → "הוחזר", לא "אושר". (Task 2.)
2. **חיוב שנכשל ואז הצליח:** שתי שורות `charge` (failed, succeeded); המצב "נגבה" פעם אחת; ניסיון שלישי מוצלח לאותו `parent_operation_id` נדחה על ידי unique index. (Task 1, 5.)
3. **קמפיין בלי אף פעולה** (לא עבר backfill, או נוצר לפני התפיסה): `deriveStatus([])` = `none`; המסך מציג "—"; הסוכן אומר "אין פעולות תשלום", לא "פתוח". (Task 2, 7.)
4. **`anon` מנסה `select` על `payment_operations` דרך Data API:** permission denied, לא שורות ריקות. (Task 1, dry-run.)
5. **סוג פעולה חדש** (למשל `immediate_charge` עם `effect='collect'`) נוסף לרישום בלי שינוי קוד: `deriveStatus` מחזיר "נגבה" ו-`authorizationBadge` מציג אותו. (Task 2, בדיקה עם kind מומצא.)

---

### Task 1: מיגרציה Expand — `payment_methods`, `payment_operation_kinds`, `payment_operations`, Vault, ACL

**Files:**
- Create: `supabase/migrations/<timestamp>_payment_operations_expand.sql` (השם נוצר ב-CLI)
- Commit also: `src/lib/supabase/types.generated.ts`

**Interfaces:**
- Produces: הטבלאות `public.payment_methods`, `public.payment_operation_kinds`, `public.payment_operations`; ה-enum `payment_operation_outcome` (`pending|succeeded|failed|review`); הפונקציות `public.payment_methods_write(...)` ו-`public.payment_method_citizen_id(p_id uuid)` (`security invoker`, `service_role` בלבד).

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
  kind                 text not null default 'saved_card',   -- free text on purpose (owner 24.9: no closed lists)
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
  effect     text not null check (effect in ('commit', 'collect', 'return', 'none')),
  sort_order integer not null default 100,
  active     boolean not null default true
);
insert into public.payment_operation_kinds (kind, label_he, effect, sort_order) values
  ('authorize',           'אישור מסגרת',   'commit',  10),
  ('capture',             'גבייה ממסגרת',  'collect', 20),
  ('release',             'שחרור מסגרת',   'return',  30),
  ('charge',              'חיוב',          'collect', 40),
  ('cancellation_charge', 'גביית ביטול',   'collect', 50),
  ('refund',              'החזר',          'return',  60);

-- ── payment_operations: append-only. One row per thing that happened to money. ──
create table public.payment_operations (
  id                   uuid primary key default extensions.uuid_generate_v7(),
  campaign_id          uuid not null references public.campaigns (id) on delete cascade,
  event_id             uuid not null references public.events (id) on delete cascade,
  payment_method_id    uuid references public.payment_methods (id),
  kind                 text not null references public.payment_operation_kinds (kind),
  outcome              public.payment_operation_outcome not null default 'pending',
  amount               numeric(12,2) not null default 0 check (amount >= 0),
  credit_applied       numeric(12,2) not null default 0 check (credit_applied >= 0),
  parent_operation_id  uuid references public.payment_operations (id),   -- capture/release → its authorize
  provider             text not null default 'sumit',
  provider_ref         text,                                            -- auth number / payment id, as text
  provider_document_id bigint,
  provider_document_number integer,
  provider_document_url text,
  source               text not null default 'app' check (source in ('app', 'provider_sync', 'manual_backfill')),
  occurred_at          timestamptz not null default now(),              -- when it happened at the provider
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
create index payment_operations_doc_idx      on public.payment_operations (provider_document_id) where provider_document_id is not null;
-- The one meta key code looks up (event-cancellation, Task 7): expression index, not a table scan (advanced-jsonb-indexing).
create index payment_operations_cancellation_idx on public.payment_operations ((meta->>'cancellation_request_id')) where meta ? 'cancellation_request_id';
-- Review Focus #2: one SUCCEEDED collect per parent (a hold is captured once).
create unique index payment_operations_one_success_per_parent_uq
  on public.payment_operations (parent_operation_id, kind) where outcome = 'succeeded' and parent_operation_id is not null;
-- THE MUTEX (verifier 24.9, finding ב): today lockCampaignForHold/lockCampaignForCharge are an UPDATE filtered on
-- capture_status/charge_status — a compare-and-set that makes "final charge exactly once" true under concurrency.
-- In the ledger the lock is the PENDING row: inserting it acquires the lock (23505 if one is already pending),
-- completing it (pending → succeeded/failed/review) releases it. One pending operation per campaign per kind.
create unique index payment_operations_one_pending_uq
  on public.payment_operations (campaign_id, kind) where outcome = 'pending';

-- Append-only with ONE controlled exception: a pending row may be completed once. Nothing else ever changes.
create or replace function public.payment_operations_guard_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.outcome <> 'pending' then
    raise exception 'payment_operations is append-only: % is already %', old.id, old.outcome using errcode = 'check_violation';
  end if;
  if new.outcome = 'pending' then
    raise exception 'a pending operation can only be completed' using errcode = 'check_violation';
  end if;
  if new.id <> old.id or new.campaign_id <> old.campaign_id or new.event_id <> old.event_id or new.kind <> old.kind
     or new.parent_operation_id is distinct from old.parent_operation_id or new.occurred_at <> old.occurred_at
     or new.recorded_at <> old.recorded_at or new.source <> old.source then
    raise exception 'only outcome, amounts, provider refs, note and meta may change on completion' using errcode = 'check_violation';
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
grant select, insert, update on table public.payment_methods to service_role;
grant select, insert, update on table public.payment_operation_kinds to service_role;
grant select, insert on table public.payment_operations to service_role;
grant update (outcome, amount, credit_applied, provider_ref, provider_document_id, provider_document_number, provider_document_url, note, meta)
  on table public.payment_operations to service_role;   -- completion of a PENDING row only (trigger above); never delete
-- No policies on purpose: RLS with none denies every non-bypass role; service_role bypasses RLS.

-- ── Vault write + read, the SAME shape as integrations_write/read_credential (20260916002343). ──
create or replace function public.payment_methods_write(
  p_owner_user_id        uuid,
  p_provider_token_ref   text,
  p_exp_month            smallint,
  p_exp_year             smallint,
  p_provider_customer_id bigint,
  p_citizen_id           text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id        uuid := gen_random_uuid();
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
--           has_table_privilege('service_role',c.oid,'select,insert') sr, has_table_privilege('service_role',c.oid,'update') sr_upd
--    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'payment\_%';
--    expect: anon f, auth f, sr t; sr_upd t for methods/kinds, f for operations
-- b) select count(*) from pg_policies where tablename like 'payment\_%';  -- 0
-- c) select has_function_privilege('anon','public.payment_method_citizen_id(uuid)','execute'),
--           has_function_privilege('service_role','public.payment_method_citizen_id(uuid)','execute'); -- f, t
-- d) select kind, effect from public.payment_operation_kinds order by sort_order; -- 6 rows
-- e) FK columns without an index (schema-foreign-key-indexes) — expect 0 rows for payment_% tables:
--    select conrelid::regclass, a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
--    where c.contype='f' and conrelid::regclass::text like 'payment\_%' and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and a.attnum=any(i.indkey));
--    (kind → payment_operation_kinds is the one FK left unindexed on purpose: a 6-row registry, never deleted from.)
-- f) select count(*) from pg_trigger where tgname='payment_operations_guard_update'; -- 1
-- ROLLBACK (manual): drop trigger payment_operations_guard_update on public.payment_operations; drop function public.payment_operations_guard_update();
--   drop function public.payment_methods_write(uuid, text, smallint, smallint, bigint, text);
--   drop function public.payment_method_citizen_id(uuid); drop table public.payment_operations, public.payment_operation_kinds, public.payment_methods;
--   drop type public.payment_operation_outcome;
```

- [ ] **Step 3: בדוק ש-Vault זמין (קריאה בלבד)**

```bash
npx supabase db query --linked "select extname from pg_extension where extname='supabase_vault'"
```
צפוי: שורה אחת. אם ריק, עצור ודווח.

- [ ] **Step 4: הבעלים: dry-run → push → types → advisors**

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
  export type OperationEffect = 'commit' | 'collect' | 'return' | 'none';
  export type OperationOutcome = 'pending' | 'succeeded' | 'failed' | 'review';
  export interface OperationRow { kind: string; effect: OperationEffect; outcome: OperationOutcome; amount: number; occurredAt: string }
  export type PaymentStatus = 'none' | 'pending' | 'review' | 'declined' | 'committed' | 'collected' | 'returned';
  export function deriveStatus(ops: readonly OperationRow[]): { status: PaymentStatus; collected: number; committed: number };
  export function paymentBadge(status: PaymentStatus): { label: string; variant: 'success'|'warning'|'destructive'|'neutral' } | null;
  ```
- Consumes: כלום (טהור). `effect` מגיע מה-join עם `payment_operation_kinds`, לא מהקוד.

- [ ] **Step 1: בדיקה נכשלת**

```ts
import { describe, expect, it } from 'vitest';
import { deriveStatus, paymentBadge, type OperationRow } from './status';

const op = (kind: string, effect: OperationRow['effect'], outcome: OperationRow['outcome'], amount = 0, t = '2026-09-01T00:00:00Z'): OperationRow =>
  ({ kind, effect, outcome, amount, occurredAt: t });

describe('deriveStatus — the ledger decides, no stored state', () => {
  it('no operations → none', () => expect(deriveStatus([]).status).toBe('none'));
  it('authorize succeeded → committed 200', () =>
    expect(deriveStatus([op('authorize', 'commit', 'succeeded', 200)])).toEqual({ status: 'committed', collected: 0, committed: 200 }));
  it('authorize → capture succeeded → collected, collected=120', () =>
    expect(deriveStatus([op('authorize', 'commit', 'succeeded', 200), op('capture', 'collect', 'succeeded', 120, '2026-09-02T00:00:00Z')]))
      .toMatchObject({ status: 'collected', collected: 120 }));
  it('authorize → release → returned (Review Focus #1); committed stays 200 — the funding base survives the release', () =>
    expect(deriveStatus([op('authorize', 'commit', 'succeeded', 200), op('release', 'return', 'succeeded', 0, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'returned', committed: 200 }));
  it('capture failed then succeeded → collected once (Review Focus #2)', () =>
    expect(deriveStatus([op('authorize', 'commit', 'succeeded', 200), op('capture', 'collect', 'failed', 120), op('capture', 'collect', 'succeeded', 120, '2026-09-03T00:00:00Z')]))
      .toMatchObject({ status: 'collected', collected: 120 }));
  it('capture pending → pending (money in flight beats committed)', () =>
    expect(deriveStatus([op('authorize', 'commit', 'succeeded', 200), op('capture', 'collect', 'pending', 120, '2026-09-02T00:00:00Z')]).status).toBe('pending'));
  it('capture review → review', () =>
    expect(deriveStatus([op('authorize', 'commit', 'succeeded', 200), op('capture', 'collect', 'review', 120, '2026-09-02T00:00:00Z')]).status).toBe('review'));
  it('only a failed authorize → declined', () =>
    expect(deriveStatus([op('authorize', 'commit', 'failed', 200)]).status).toBe('declined'));
  it('a brand-new kind with effect=collect works without code changes (Review Focus #5)', () =>
    expect(deriveStatus([op('immediate_charge', 'collect', 'succeeded', 200)])).toMatchObject({ status: 'collected', collected: 200 }));
  it('collect then refund → returned; collected nets to 0', () =>
    expect(deriveStatus([op('charge', 'collect', 'succeeded', 200), op('refund', 'return', 'succeeded', 200, '2026-09-02T00:00:00Z')]))
      .toMatchObject({ status: 'returned', collected: 0 }));
  it('order is by occurredAt, not array order', () =>
    expect(deriveStatus([op('release', 'return', 'succeeded', 0, '2026-09-03T00:00:00Z'), op('authorize', 'commit', 'succeeded', 200, '2026-09-01T00:00:00Z')]).status).toBe('returned'));
});

describe('paymentBadge — never the word תפוס', () => {
  it.each([
    ['none', null],
    ['pending', 'בתהליך'],
    ['review', 'נדרשת בדיקה ידנית'],
    ['declined', 'נדחה'],
    ['committed', 'אושר — ממתין להכרעה'],
    ['collected', 'נגבה'],
    ['returned', 'הוחזר'],
  ] as const)('%s → %s', (status, label) => {
    const b = paymentBadge(status);
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
// specific kind (owner 24.9): a kind is a row in the registry, its effect is
// what matters here. Replay the succeeded operations in time order; the
// latest in-flight attempt (pending/review) wins over settled state because
// money may be moving right now.
export type OperationEffect = 'commit' | 'collect' | 'return' | 'none';
export type OperationOutcome = 'pending' | 'succeeded' | 'failed' | 'review';
export type PaymentStatus = 'none' | 'pending' | 'review' | 'declined' | 'committed' | 'collected' | 'returned';
export type BadgeVariant = 'success' | 'warning' | 'destructive' | 'neutral';

export interface OperationRow {
  kind: string;
  effect: OperationEffect;
  outcome: OperationOutcome;
  amount: number;
  occurredAt: string;
}

export function deriveStatus(ops: readonly OperationRow[]): { status: PaymentStatus; collected: number; committed: number } {
  if (ops.length === 0) return { status: 'none', collected: 0, committed: 0 };
  const sorted = [...ops].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const last = sorted[sorted.length - 1];
  let status: PaymentStatus = 'none';
  let collected = 0;
  let committed = 0;
  for (const o of sorted) {
    if (o.outcome !== 'succeeded' || o.effect === 'none') continue;
    // ONE definition of "committed" (verifier 24.9): the latest succeeded commit, NOT netted by a later return.
    // The final charge is a fresh charge on the saved token, so releasing the hold in SUMIT does not shrink the
    // funding base the recipient ceiling is computed from. campaign_committed_amount() (Task 8) must agree.
    if (o.effect === 'commit') { committed = o.amount; status = 'committed'; }
    if (o.effect === 'collect') { collected += o.amount; status = 'collected'; }
    if (o.effect === 'return') { collected = Math.max(0, collected - o.amount); status = 'returned'; }
  }
  if (last.outcome === 'pending') return { status: 'pending', collected, committed };
  if (last.outcome === 'review') return { status: 'review', collected, committed };
  if (status === 'none') return { status: 'declined', collected, committed }; // something was attempted, nothing succeeded
  return { status, collected, committed };
}

const LABELS: Record<Exclude<PaymentStatus, 'none'>, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'בתהליך', variant: 'warning' },
  review: { label: 'נדרשת בדיקה ידנית', variant: 'destructive' },
  declined: { label: 'נדחה', variant: 'destructive' },
  committed: { label: 'אושר — ממתין להכרעה', variant: 'success' },
  collected: { label: 'נגבה', variant: 'neutral' },
  returned: { label: 'הוחזר', variant: 'neutral' },
};

export function paymentBadge(status: PaymentStatus): { label: string; variant: BadgeVariant } | null {
  return status === 'none' ? null : LABELS[status];
}
```

- [ ] **Step 4: הרץ ווודא הצלחה** (18 בדיקות), **Step 5: Commit** `feat(payments): status derived from the operations ledger; neutral labels`

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
- Modify: `package.json` (`"payments:backfill"`)

**Interfaces:**
- Consumes: Task 1, Task 3 (`createPaymentMethod`).
- Produces: לכל קמפיין עם `capture_status` לא-null: `payment_methods` אחד (אם `card_token_ref`), ורצף פעולות לפי העמודות הישנות; לכל `event_cancellation_requests` עם `sumit_document_id`: פעולת `cancellation_charge`.

**מה נמדד (24.9) ומה ייכתב:**

| campaign | עמודות ישנות | פעולות שייכתבו |
|---|---|---|
| `39334087` (קאקון, פעיל) | authorized 200, release_status=released (SUMIT 02.09 16:14) | `authorize` succeeded 200 → `release` succeeded, `source=provider_sync` |
| `49a4617b` (סגור) | authorized 4, nothing_to_charge, release ריק; **SUMIT: released 21.07 19:38** | `authorize` 4 → `release`, `source=manual_backfill`, note עם התאריך שנמדד |
| `15a8730e` (סגור) | authorized 152, nothing_to_charge, release ריק; **SUMIT: released 07.07 13:18** | `authorize` 152 → `release`, `source=manual_backfill` |

`charge_status` ממופה: `charged`→`capture` succeeded (amount=`final_charge_amount`), `charge_failed`→`capture` failed, `charge_review`→`capture` review, `pending`→`capture` pending, `nothing_to_charge`→ **אין פעולה** (לא קרה כלום לכסף; המידע "נסגר ב-0" הוא של הקמפיין, לא של התשלום).

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
const manual = new Map([['49a4617b', '2026-07-21T16:38:00Z']]);

describe('planOperations', () => {
  it('authorized only → one succeeded authorize', () => {
    const ops = planOperations(row({}), manual);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'authorize', outcome: 'succeeded', amount: 200, provider_document_id: 2327129322, source: 'app' });
  });
  it('released in DB → authorize + release(provider_sync)', () => {
    expect(planOperations(row({ release_status: 'released' }), manual).map((o) => [o.kind, o.source])).toEqual([['authorize', 'app'], ['release', 'provider_sync']]);
  });
  it('manual override → release(manual_backfill) at the measured time (finding #5)', () => {
    const ops = planOperations(row({ id: '49a4617b', charge_status: 'nothing_to_charge' }), manual);
    expect(ops[1]).toMatchObject({ kind: 'release', source: 'manual_backfill', occurred_at: '2026-07-21T16:38:00Z' });
  });
  it('nothing_to_charge without override → no charge row, still committed', () => {
    expect(planOperations(row({ charge_status: 'nothing_to_charge' }), manual)).toHaveLength(1);
  });
  it('charged → capture succeeded with the document', () => {
    const ops = planOperations(row({ charge_status: 'charged', final_charge_amount: '120', charged_at: '2026-09-05T00:00:00Z', sumit_charge_document_id: 7, credit_applied: '30' }), manual);
    expect(ops[1]).toMatchObject({ kind: 'capture', outcome: 'succeeded', amount: 120, credit_applied: 30, provider_document_id: 7, occurred_at: '2026-09-05T00:00:00Z' });
  });
  it.each([['charge_failed', 'failed'], ['charge_review', 'review'], ['pending', 'pending']])('%s → capture %s', (cs, outcome) => {
    expect(planOperations(row({ charge_status: cs }), manual)[1]).toMatchObject({ kind: 'capture', outcome });
  });
  it('hold_failed → failed authorize only', () => {
    expect(planOperations(row({ capture_status: 'hold_failed', release_status: 'released' }), manual)).toEqual([expect.objectContaining({ kind: 'authorize', outcome: 'failed' })]);
  });
  it('no capture at all → []', () => expect(planOperations(row({ capture_status: null }), manual)).toEqual([]));
  it('never carries the citizen id', () => {
    expect(JSON.stringify(planOperations(row({ card_citizen_id: '316125434' }), manual))).not.toContain('316125434');
  });
});
```

- [ ] **Step 2: כישלון**, **Step 3: מימוש** (`scripts/payments-backfill.ts`; ריצה: `node --env-file=.env.local dist/payments-backfill.cjs [--apply]`, בלי `--apply` מדפיס בלבד)

```ts
import { createAdminClient } from '@/lib/supabase/admin';
import { createPaymentMethod } from '@/lib/payments/payment-methods';

// Measured 2026-09-24 in SUMIT's holds folder (Billing_Status 3 = released). Both predate
// hold_order_document_id (30.8), so the reconciler can never see them. Times are Israel local → UTC.
export const MANUAL_RELEASED = new Map<string, string>([
  ['49a4617b-ac2e-4f17-bfeb-6ceb84c56551', '2026-07-21T16:38:00Z'],
  ['15a8730e-df46-43f6-a29f-13a1ea3a0038', '2026-07-07T10:18:00Z'],
]);

type Legacy = Record<string, unknown> & { id: string; event_id: string; capture_status: string | null; charge_status: string | null; release_status: string | null };
type PlannedOp = { kind: string; outcome: 'pending' | 'succeeded' | 'failed' | 'review'; amount: number; credit_applied: number; provider_ref: string | null; provider_document_id: number | null; provider_document_number: number | null; provider_document_url: string | null; source: 'app' | 'provider_sync' | 'manual_backfill'; occurred_at: string; note: string | null };

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const OUTCOME_OF_CAPTURE: Record<string, PlannedOp['outcome']> = { authorized: 'succeeded', hold_failed: 'failed', hold_review: 'review', pending: 'pending' };
const OUTCOME_OF_CHARGE: Record<string, PlannedOp['outcome']> = { charged: 'succeeded', charge_failed: 'failed', charge_review: 'review', pending: 'pending' };

export function planOperations(c: Legacy, manualReleased: ReadonlyMap<string, string>): PlannedOp[] {
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
      kind: 'capture', outcome: chargeOutcome, amount: num(c.final_charge_amount), credit_applied: num(c.credit_applied),
      provider_ref: (c.charge_auth_number as string | null) ?? (c.charge_payment_id != null ? String(c.charge_payment_id) : null),
      provider_document_id: (c.sumit_charge_document_id as number | null) ?? null, provider_document_number: (c.charge_document_number as number | null) ?? null,
      provider_document_url: (c.charge_document_url as string | null) ?? null, source: 'app', occurred_at: at(c.charged_at, authorizedAt), note: null,
    });
  }
  if (c.release_status === 'released') {
    ops.push({ kind: 'release', outcome: 'succeeded', amount: 0, credit_applied: 0, provider_ref: null, provider_document_id: null, provider_document_number: null, provider_document_url: null, source: 'provider_sync', occurred_at: at(c.updated_at, authorizedAt), note: 'seen released by sumit-hold-reconcile' });
  } else if (manualReleased.has(c.id)) {
    ops.push({ kind: 'release', outcome: 'succeeded', amount: 0, credit_applied: 0, provider_ref: null, provider_document_id: null, provider_document_number: null, provider_document_url: null, source: 'manual_backfill', occurred_at: manualReleased.get(c.id)!, note: 'released in SUMIT holds folder; measured 2026-09-24' });
  }
  return ops;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const admin = createAdminClient();
  const { data: campaigns, error } = await admin.from('campaigns').select('*').not('capture_status', 'is', null);
  if (error) throw new Error('read campaigns failed');
  const { data: done } = await admin.from('payment_operations').select('campaign_id');
  const seen = new Set((done ?? []).map((r) => r.campaign_id));
  let n = 0;
  for (const c of campaigns ?? []) {
    if (seen.has(c.id)) continue;
    const ops = planOperations(c as never, MANUAL_RELEASED);
    if (ops.length === 0) continue;
    n += 1;
    console.log(`campaign ${c.id.slice(0, 8)}: ${ops.map((o) => `${o.kind}/${o.outcome}${o.source !== 'app' ? '(' + o.source + ')' : ''}`).join(' → ')}`);
    if (!apply) continue;
    let paymentMethodId: string | null = null;
    if (c.card_token_ref) {
      if (!c.approved_by) throw new Error(`campaign ${c.id.slice(0, 8)}: approved_by is null`);
      paymentMethodId = await createPaymentMethod(admin, { ownerUserId: c.approved_by, providerTokenRef: c.card_token_ref, expMonth: c.card_exp_month, expYear: c.card_exp_year, providerCustomerId: c.sumit_customer_id, citizenId: c.card_citizen_id });
    }
    let parentId: string | null = null;
    for (const op of ops) {
      const { data: row, error: e } = await admin.from('payment_operations')
        .insert({ ...op, campaign_id: c.id, event_id: c.event_id, payment_method_id: paymentMethodId, parent_operation_id: op.kind === 'authorize' ? null : parentId })
        .select('id').single();
      if (e || !row) throw new Error(`insert ${op.kind} failed for ${c.id.slice(0, 8)}`);
      if (op.kind === 'authorize') parentId = row.id;
    }
  }
  // Cancellation charges (finding #9): one cancellation_charge per resolved request that produced a SUMIT document.
  const { data: cancels } = await admin.from('event_cancellation_requests').select('id, event_id, sumit_document_id, sumit_document_url, resolved_at, resolution_amount, events!inner(campaigns(id))').not('sumit_document_id', 'is', null);
  for (const r of cancels ?? []) {
    const campaignId = (r as { events: { campaigns: { id: string }[] } }).events.campaigns[0]?.id;
    if (!campaignId) { console.log(`cancellation ${r.id.slice(0, 8)}: no campaign — skipped`); continue; }
    n += 1;
    console.log(`cancellation ${r.id.slice(0, 8)}: cancellation_charge/succeeded doc ${r.sumit_document_id}`);
    if (!apply) continue;
    const { error: e } = await admin.from('payment_operations').insert({ campaign_id: campaignId, event_id: r.event_id, kind: 'cancellation_charge', outcome: 'succeeded', amount: Number(r.resolution_amount ?? 0), provider_document_id: r.sumit_document_id, provider_document_url: r.sumit_document_url, source: 'app', occurred_at: r.resolved_at ?? new Date().toISOString(), meta: { cancellation_request_id: r.id } });
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
צפוי אחרי apply: `select campaign_id, kind, outcome, source from payment_operations order by campaign_id, occurred_at` = 6 שורות לשלושת הקמפיינים (authorize+release ×3) + שורת `cancellation_charge` לכל בקשת ביטול עם מסמך (הספירה מודפסת בריצה ללא `--apply`).

- [ ] **Step 5: Commit** (סקריפט + בדיקה + `package.json`; לא `dist/`)

---

### Task 5: כתיבה כפולה — כל כותב תשלום כותב גם ל-`payment_operations`

**Files:**
- Create: `src/lib/payments/ledger.ts`, `src/lib/payments/ledger.test.ts`
- Modify: `src/lib/data/campaigns.ts` (authorize path ~471–540; `recordCampaignCharge`/`markCampaignChargeOutcome` ~790–850), `src/lib/data/sumit-hold-reconcile.ts` (~95–105), `src/lib/data/close-charge.ts:159,343`, `src/lib/data/event-cancellation.ts:520`

**Interfaces:**
- Produces:
  ```ts
  export async function recordOperation(admin, op: { campaignId: string; eventId: string; kind: string; outcome: OperationOutcome; amount: number; creditApplied?: number; paymentMethodId?: string|null; parentOperationId?: string|null; providerRef?: string|null; providerDocument?: { id: number; number: number|null; url: string|null } | null; source?: 'app'|'provider_sync'|'manual_backfill'; occurredAt?: string; note?: string|null; meta?: Record<string, unknown> }): Promise<string>;  // one-shot: outcome known at write time
  // Two-phase (the mutex — replaces lockCampaignForHold/lockCampaignForCharge, verifier finding ב):
  export async function beginOperation(admin, op: Omit<Parameters<typeof recordOperation>[1], 'outcome'>): Promise<{ id: string } | { alreadyInProgress: true }>;  // inserts outcome='pending'; 23505 on payment_operations_one_pending_uq → alreadyInProgress
  export async function completeOperation(admin, id: string, result: { outcome: 'succeeded'|'failed'|'review'; amount?: number; creditApplied?: number; providerRef?: string|null; providerDocument?: {...} | null; note?: string|null }): Promise<void>;  // UPDATE … where id and outcome='pending'; 0 rows → throw
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
  it('a second succeeded capture for the same parent is rejected by the unique index (Review Focus #2)', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'a', campaign_id: 'c1', kind: 'authorize', outcome: 'succeeded' }, { id: 'b', campaign_id: 'c1', kind: 'capture', outcome: 'succeeded', parent_operation_id: 'a' }] }, { uniqueIndexes: [['parent_operation_id', 'kind']] });
    await expect(recordOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'capture', outcome: 'succeeded', amount: 120, parentOperationId: 'a' })).rejects.toThrow();
  });
  it('beginOperation acquires the lock; a second begin for the same campaign+kind reports alreadyInProgress (23505)', async () => {
    const db = createFakeTableClient({ payment_operations: [] }, { uniqueIndexes: [['campaign_id', 'kind', { where: { outcome: 'pending' } }]] });
    const a = await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'capture', amount: 120 });
    const b = await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'capture', amount: 120 });
    expect('id' in a).toBe(true);
    expect(b).toEqual({ alreadyInProgress: true });
  });
  it('completeOperation finishes the pending row once; completing it again throws', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'capture', outcome: 'pending' }] });
    await completeOperation(db.client as never, 'p1', { outcome: 'succeeded', amount: 120, providerDocument: { id: 7, number: 1, url: 'u' } });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', amount: 120, provider_document_id: 7 });
    await expect(completeOperation(db.client as never, 'p1', { outcome: 'failed' })).rejects.toThrow();
  });
  it('loadOperations joins the effect from the registry and maps to OperationRow', async () => {
    const db = createFakeTableClient({
      payment_operations: [{ id: 'a', campaign_id: 'c1', kind: 'authorize', outcome: 'succeeded', amount: '200', occurred_at: '2026-09-01T00:00:00Z', payment_operation_kinds: { effect: 'commit' } }],
    });
    expect(await loadOperations(db.client as never, 'c1')).toEqual([{ kind: 'authorize', effect: 'commit', outcome: 'succeeded', amount: 200, occurredAt: '2026-09-01T00:00:00Z' }]);
  });
});
```
> אם `createFakeTableClient` לא תומך ב-`uniqueIndexes` או ב-embed, הרחב אותו ב-Task הזה (קובץ `src/test/fake-table-client.ts`) עם בדיקה משלו; אל תדלג על הבדיקה.

- [ ] **Step 2: כישלון. Step 3: מימוש `ledger.ts`** (`insert … select('id').single()`; `loadOperations` = `select('kind, outcome, amount, occurred_at, payment_operation_kinds!inner(effect)')` ממוין ב-`occurred_at`).

- [ ] **Step 4: חיבור הכותבים הקיימים**, בלי לשנות את הכתיבה הישנה:
  - `campaigns.ts` אחרי `update({ capture_status: 'authorized', … })`: `createPaymentMethod(...)` (ת"ז ל-Vault) ואז `recordOperation({ kind: 'authorize', outcome: 'succeeded', amount: hold.amount, paymentMethodId, providerRef: hold.authNumber, providerDocument })`. אחרי `hold_failed`/`hold_review`: `authorize` עם `failed`/`review`.
  - `campaigns.ts` `lockCampaignForHold` → `beginOperation({ kind: 'authorize' })` (alreadyInProgress = מה שהיום מחזיר "כבר בתהליך"); אחרי תשובת SUMIT → `completeOperation`. `lockCampaignForCharge` → `beginOperation({ kind: 'capture', parentOperationId: latestOperation('authorize','succeeded') })`; `recordCampaignCharge` → `completeOperation(succeeded)`; `markCampaignChargeOutcome` → `completeOperation(failed|review)`. `nothing_to_charge`: **אין פעולה**. עד Task 8 הכתיבה הישנה (UPDATE מסונן) נשארת לצד זה, וה-lock החדש הוא בדיקה כפולה.
  - `campaigns.ts` `activateCampaign` (★★ verifier): ה-`extraGuard` על `capture_status` נשאר עד Task 8; מ-Task 8 הטריגר `campaigns_guard_activate` (DB) הוא השומר האטומי.
  - `sumit-hold-reconcile.ts` אחרי `update({ release_status: 'released' })`: `release` succeeded, `source: 'provider_sync'`, `parentOperationId` של ה-authorize.
  - `close-charge.ts`: הת"ז נקראת דרך `readCitizenId(paymentMethodId)` כשיש `payment_method_id` על ה-authorize; אחרת מ-`campaign.card_citizen_id` (עד Task 8).
  - `event-cancellation.ts:520`: לצד `sumit_document_id` גם `recordOperation({ kind: 'cancellation_charge', … meta: { cancellation_request_id } })`.

- [ ] **Step 5: בדיקת שוויון** ב-`ledger.test.ts`: מריצים את נתיב הכתיבה האמיתי (authorize → charge) עם ה-fake client ומאמתים ש-`deriveStatus(loadOperations(...))` תואם את מה שהעמודות הישנות היו מציגות (`charged`→`collected`, `released`→`returned`).

- [ ] **Step 6: gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm run worker:deps && npx vitest run src/lib/payments src/lib/data && npm test
git add src/lib/payments/ledger.ts src/lib/payments/ledger.test.ts src/lib/data/campaigns.ts src/lib/data/sumit-hold-reconcile.ts src/lib/data/close-charge.ts src/lib/data/event-cancellation.ts src/test/fake-table-client.ts
git commit -m "feat(payments): every payment writer also appends to payment_operations (dual-write)"
```
**פריסה בידי הבעלים.**

---

### Task 6: הקוראים — מסך הקמפיינים

**Files:**
- Modify: `src/lib/data/admin/campaigns.ts:209-279` (`listCampaignsForAdmin` טוען `payment_operations(kind, outcome, amount, occurred_at, provider_document_number, provider_document_url, payment_operation_kinds(effect))` ומחזיר `payment: { status, collected, committed, documentNumber, documentUrl }`)
- Modify: `src/app/(admin)/admin/campaigns/page.tsx:42-73,105,130-138` (HoldCell → `PaymentCell` עם `paymentBadge`; כותרת "תפיסה" → "תשלום")
- Delete: `src/lib/data/admin/campaign-hold-badge.ts` + `.test.ts` (הוחלפו ב-Task 2)
- Modify: `src/lib/data/event-labels.ts:131-145` (`campaignStage` מקבל `PaymentStatus`; fallback ללגאסי עד Task 8)

- [ ] **Step 1: בדיקה נכשלת** (`src/lib/data/admin/campaigns.test.ts`, צור אם אין): שורה עם פעולות → `payment.status` מהיומן; שורה בלי פעולות → `deriveStatus([])` = `none` ותצוגת "—" (Review Focus #3). המסך לא קורא `capture_status`/`charge_status`/`release_status`.
- [ ] **Step 2–4: מימוש; `npx vitest run src/lib/data/admin src/lib/payments`**
- [ ] **Step 5: בדיקת דפדפן (הבעלים אחרי deploy):** `/admin/campaigns` מציג "הוחזר" בשלוש השורות, לא "תפוס".
- [ ] **Step 6: Commit** `refactor(admin): campaigns list reads the payment ledger; neutral labels`

---

### Task 7: הקוראים הנותרים — הסוכן, cores, ביטול אירוע, סטטיסטיקות

**Files:**
- Modify: `src/lib/owner-agent/cores/billing.ts`, `src/lib/owner-agent/cores/campaigns.ts` (`stuckHolds` → פעולות `authorize` עם `outcome in ('pending','review')`; חדש `openCommitments` = קמפיינים ש-`deriveStatus` שלהם `committed` וסטטוס קמפיין סגור). **שאילתה אחת** לכל הקמפיינים המועמדים (`.in('campaign_id', ids)`) ואז `deriveStatus` בזיכרון לפי `campaign_id`; לא שאילתה לכל קמפיין (data-n-plus-one).
- Modify: `src/lib/owner-agent/consumer/primer.ts` (+ `primer.test.ts` drift): הטבלאות החדשות; "מצב תשלום = מחושב מ-`payment_operations` לפי `effect`"; קמפיין בלי פעולות = "אין פעולות תשלום" (Review Focus #3)
- Modify: `src/lib/data/event-cancellation.ts` (`hasCardOnFile` מ-`payment_methods`; ת"ז דרך `readCitizenId`; קריאה של המסמך מ-`payment_operations` לפי `meta.cancellation_request_id`)
- Modify: `src/lib/data/event-stats.ts:175,296`, `src/lib/data/setup-steps.ts:31`
- Modify (★★ verifier 24.9): `src/app/(admin)/admin/cancellations/[id]/page.tsx:41,44,96,124-126` — `campaign.chargeStatus`/`hasCardOnFile` (מ-`getCampaignForEventAdmin` ב-`event-cancellation.ts:206-231`) → `payment.status` + `paymentMethodId != null`; `request.sumitDocumentUrl` (מ-`ADMIN_SELECT` `event-cancellation.ts:118` → `mapAdminRow`:147) → `provider_document_url` של פעולת `cancellation_charge` (`meta.cancellation_request_id`), דרך `loadOperations`
- Modify (★ מפת השפעה ב): `src/app/(customer)/app/events/[id]/campaign/[campaignId]/page.tsx` + `manage-client.tsx`, `.../campaign/[campaignId]/payment/page.tsx:90-123`, `src/app/(customer)/app/events/[id]/event-summary.tsx`, `src/app/(customer)/app/events/[id]/stats/page.tsx`, `src/lib/data/admin/callbacks.ts:652`, `src/lib/data/admin/users.ts:278`, `src/lib/data/billing.ts:113`, `src/lib/data/tax-ceiling.ts:30`, `src/lib/data/admin/sumit-test.ts:40`, `scripts/sumit-doc-check.ts:45`, `src/lib/owner-agent/consumer/reply-text.ts`
- Create: `src/lib/payments/sums.ts` (+ test): `collectedSince(admin, since)`, `creditAppliedByEvent(admin, eventIds)` — שאילתה אחת לכל צרכן (הסוכן, `tax-ceiling`, `users`, `billing`)
- Migration (CLI): `<timestamp>_owner_agent_billing_sums_from_ledger` — `owner_agent_billing_sums(_since)` נכתבת מחדש על `payment_operations` (★ מפת השפעה א); `types:check` אחרי
- Modify: `src/lib/data/campaigns.ts:750-764` (`CAMPAIGN_COLUMNS` בלי עמודות התשלום; `OwnerCampaign` מקבל `payment` מהיומן)

- [ ] **Step 1:** לכל קובץ: בדיקה שמוכיחה קריאה מהיומן (fake client), כישלון, החלפה, הצלחה.
- [ ] **Step 2:** `npm run owner-agent:smoke` על 3 שאלות: "האם יש תפיסות פתוחות?", "כמה נגבה החודש?", "מה מצב התשלום של קאקון?"; תעד ב-`plans/owner-whatsapp-agent-plan.md`.
- [ ] **Step 3:** וודא: `grep -rn "capture_status\|charge_status\|release_status\|card_citizen_id\|card_token_ref\|hold_order_document\|sumit_customer_id" src worker --include=*.ts --include=*.tsx | grep -v test | grep -v types.generated` מחזיר רק את הכתיבות הכפולות של Task 5.
- [ ] **Step 4: gates מלאים + commit** `refactor(payments): remaining readers move to the ledger; agent primer knows derived status`

**פריסה בידי הבעלים.**

---

### Task 8: Contract — מחיקת 27 העמודות מ-`campaigns` והכתיבה הכפולה

**Files:**
- Create: `supabase/migrations/<timestamp>_payment_operations_contract.sql` (CLI)
- Modify: `campaigns.ts`, `sumit-hold-reconcile.ts`, `close-charge.ts`, `event-cancellation.ts` (הסרת הכתיבה ללגאסי), `src/lib/data/event-cancellation.ts` (הפסקת קריאה של `sumit_document_id`)

- [ ] **Step 1: תנאי מקדים (הבעלים):** Task 5–7 פרוסים ≥ 7 ימים; אין ב-`ops_errors` שגיאה שמזכירה `payment_`; גיבוי נלקח.
- [ ] **Step 2 (★ מפת השפעה א): הפונקציות שקוראות את העמודות — נכתבות מחדש באותה מיגרציה, לפני ה-`drop column`**

```sql
-- The funding base of the recipient ceiling = the LATEST succeeded commit, NOT netted by a later release
-- (verifier 24.9, finding א: the final charge is a fresh charge on the saved token, so SUMIT releasing the hold
-- does not shrink what the customer approved; today auth_amount never changes after release, and campaign
-- 39334087 is active with a released hold). Same definition as deriveStatus().committed in Task 2.
create or replace function public.campaign_committed_amount(p_campaign_id uuid)
returns numeric language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select o.amount
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
     where o.campaign_id = p_campaign_id and o.outcome = 'succeeded' and k.effect = 'commit'
     order by o.occurred_at desc limit 1), 0)
$$;
-- Replaces activateCampaign's `.eq('capture_status','authorized')` guard (verifier, item 3): no activation
-- without a succeeded commit — atomic, in the same statement, like campaigns_guard_cancel.
create or replace function public.campaigns_guard_activate()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'active' and old.status is distinct from 'active'
     and public.campaign_committed_amount(new.id) <= 0 then
    raise exception 'campaign cannot be activated: no payment authorization' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger campaigns_guard_activate before update on public.campaigns
  for each row execute function public.campaigns_guard_activate();
revoke execute on function public.campaign_committed_amount(uuid) from public, anon, authenticated;
grant execute on function public.campaign_committed_amount(uuid) to service_role;

-- reconcile_authorized_set / try_record_billed_result: replace `auth_amount` in the SELECT with
--   public.campaign_committed_amount(<campaign id>)
-- and keep the rest of each body byte-identical (copy from `pg_get_functiondef`, do not retype).
-- campaigns_guard_cancel / cancel_campaign: replace the three `capture_status` lines and the `charge_status` line with
--   and not exists (select 1 from public.payment_operations o join public.payment_operation_kinds k on k.kind=o.kind
--                   where o.campaign_id = <id> and k.effect <> 'none' and o.outcome in ('succeeded','pending','review'))
```
בדיקה: `explain (analyze) select public.campaign_committed_amount('<id>')` → Index Scan על `payment_operations_campaign_idx`; `select public.campaign_committed_amount('39334087-…')` = **200** (קאקון: authorize 200 + release; לא 0); `src/lib/data/reconcile.integration.test.ts` עובר מול ה-DB החי אחרי ה-push; ניסיון `update campaigns set status='active'` על קמפיין בלי authorize מוצלח נכשל ב-`check_violation` (ב-dry-run עם ROLLBACK).

- [ ] **Step 3:** באותו קובץ מיגרציה, אחרי הפונקציות:

```sql
-- Contract: the payment columns leave public.campaigns. Every reader moved in Tasks 6–7,
-- every writer in Task 5; the grep at Task 7 step 3 was empty of readers.
alter table public.campaigns
  -- payment, live (21)
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
- [ ] **Step 6: Commit** `feat(db): payment operations — contract: 27 payment columns dropped from campaigns, ceiling/cancel/sums functions on the ledger`

---

### Task 9: תיעוד, ממצא #6, זיכרון

**Files:**
- Modify: `docs/project/03-database-schema.md`, `docs/project/08-billing-and-payments.md`
- Modify: `plans/owner-whatsapp-agent-plan.md`; `plans/payment-events-implementation-plan.md` (כותרת: "הוחלף ב-docs/superpowers/plans/2026-09-24-campaign-payment-domain-split.md")
- Modify: זיכרון `stuck-j5-hold-bac77347-cleanup.md` → אין מסגרות תקועות; שלושתן `returned` (נמדד 24.9)

- [ ] **Step 1:** `03-database-schema.md`: שלוש הטבלאות, ה-effect, ההצהרה "מצב מחושב, לא נשמר", איך מוסיפים סוג פעולה (שורה ברישום).
- [ ] **Step 2 (ממצא #6, מתועד ולא מתוקן):** ב-`08-billing-and-payments.md`: "`campaigns.status` מכיל `awaiting_invoice`/`billed`/`paid` שאף קוד לא כותב (נמדד 24.9). מצב התשלום מחושב מ-`payment_operations`. הסרת ערך מ-enum אינה נתמכת ב-Postgres; לא בוצע."
- [ ] **Step 3:** זיכרון; **Step 4: Commit** `docs(payments): operations ledger documented; dead status values recorded`

---

## סדר פריסה (הבעלים)

| אחרי Task | פעולה |
|---|---|
| 1 | `db push` → `gen:types` → `advisors` |
| 4 | `dist/payments-backfill.cjs` (plan) → `--apply` |
| 5 | `npm run deploy` |
| 7 | `npm run deploy`; `/admin/campaigns` בדפדפן; 3 שאלות לסוכן |
| 8 | גיבוי → `db push` → `gen:types` → `deploy` |

בין 7 ל-8: לפחות שבוע באוויר.

## פתוח להחלטת הבעלים

- מחיקת `campaigns.enabled` ו-`campaigns.steps` ב-Task 8 (שתיהן מתות; נמדד).
- Commit של תיקון תווית 3 העמודות שכבר עשיתי במסך הקמפיינים (מתקן את המסך היום; מוחלף ב-Task 6).
