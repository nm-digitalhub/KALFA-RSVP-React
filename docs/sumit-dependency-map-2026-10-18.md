# מיפוי תלויות SUMIT — 18.10.2026

**מטרה.** החלטת הבעלים (18.10.2026): SUMIT אינו בשימוש, CardCom הוא ספק הסליקה היחיד. המסמך ממפה כל מקום במערכת שעדיין תלוי ב-SUMIT, מסווג כל תלות לפי מצבה, ומפרט מה חוסם את הסרתה. **זה מיפוי בלבד. לא שונה קוד, לא הורצה מיגרציה ולא בוצעה קריאה ל-SUMIT.**

**שיטה.** קריאת קוד (לא רק חיפוש טקסט) של נקודות הכניסה, שאילתות קריאה-בלבד על ה-DB החי (ספירות ושמות בלבד, בלי תוכן), ובדיקת תור המשימות של ה-worker. כל טענה מסומנת **נמדד** (נקרא בקוד או נספר ב-DB) או **הסקה**.

## 1. מצב בשורה אחת

תשלומים חדשים אינם עוברים ב-SUMIT (נמדד). אבל SUMIT עדיין **מחובר כברירת מחדל שקטה**, יש לו **משימה יומית פעילה**, **כלי חיוב אמיתי בממשק הניהול**, ו-workflow פעיל אחד שתלוי בו.

## 2. עובדות חיות (נמדד, DB חי)

| נושא | ממצא |
|---|---|
| הגדרת CardCom | שורה אחת: `enabled=true`, טרמינל שאינו טרמינל הבדיקה 1000, עודכן 9.10 |
| ledger — SUMIT | 6 פעולות שהצליחו, כולן ממודל התשלום הישן: 2 `authorize`, 2 `release`, 2 `charge` (7.7–28.9), בשני קמפיינים שנסגרו (`closed`). **אפס** `package_purchase` ב-SUMIT מעולם |
| ledger — CardCom (אמיתי) | `package_purchase`: 3 הצליחו, 1 נכשל (8–11.10). `refund`: 1 הצליח, **5 נכשלו**, כולם ב-9.10 אחר הצהריים (3 עם קוד CardCom 9006: למשתמש אין הרשאה לזיכוי; הניסיון האחרון, 14:40, הצליח) |
| ledger — CardCom (טרמינל בדיקה) | `package_purchase`: 1 הצליח, 3 נכשלו (7.10) |
| פרטי גישה ל-SUMIT | `app_settings` (שורה אחת): מפתח API ומזהה חברה **מוגדרים** |
| משימה יומית | תור `sumit-health-check` ב-pg-boss: 8 הרצות הושלמו, האחרונה 18.10 ב-04:30 (שעון ישראל) |
| workflows | 22 בסך הכל, 6 מזכירים SUMIT, **1 פעיל** |
| נתוני SUMIT | `sumit_customers`: 3 שורות. `sumit_test_transactions`: 6 שורות (3 `charge`, 2 `capture`, 1 `hold`; האחרונה 6.10). `campaigns.sumit_customer_id`: קמפיין אחד |

## 3. מלאי לפי שכבה

**סיווג:** `ברירת מחדל` = מופעל כשההגדרה חסרה/כבויה · `פעיל` = רץ היום · `כלי ניהול` = נגיש לצוות · `רדום` = קיים בקוד, אין שימוש מדוד · `נתונים` · `מת/תיעוד`.

סך הכל **152** קבצים (לא כולל בדיקות) מזכירים SUMIT: scripts 12 · app-admin 26 · app-customer 7 · api 4 · lib/data 18 · lib/payments 16 · lib/sumit 16 · lib/workflow 38 · lib/other 10 · worker 1 · generated types 1 · other 3. בנוסף **66 קבצי בדיקה**.

### 3.1 זמן ריצה

| פריט | מיקום | סיווג | ראיה |
|---|---|---|---|
| בדיקת תקינות יומית של SUMIT | `worker/main.ts:1503-1510`, `:1686` (`30 4 * * *`); `src/lib/sumit/run-health-check.ts` | **פעיל** | נמדד: 8 הרצות, האחרונה היום. מתריעה רק על זוג פרטי גישה שנדחה |
| בחירת ספק | `src/lib/payments/provider.ts:13-16` | **ברירת מחדל** | נמדד: `null` או `enabled=false` ← `sumit`; טרמינל 1000 ללא הרשאת מנהל ← `sumit` |
| טעינת הגדרת CardCom | `src/lib/data/cardcom-config.ts:33-48` | **ברירת מחדל** | נמדד: מחזירה `null` על כל שגיאת קריאה, ערך לא תקין או `enabled` שאינו בוליאני |
| רכישה דרך SUMIT | `src/lib/payments/package-purchase.ts:124-146`; `src/app/api/campaigns/[id]/purchase/route.ts` | **ברירת מחדל** | נמדד: אם `resolvePurchaseProvider` אומר `sumit` והבדיקות האחרות עוברות — החיוב יוצא ל-SUMIT. נמדד ב-DB: `payments_enabled=true`, `package_model_enabled=true`, ומפתחות SUMIT (ציבורי ופרטי) קיימים. כלומר כל התנאים מתקיימים היום חוץ מ-CardCom עצמו |
| טופס כרטיס של SUMIT ללקוח | `.../payment/sumit-card-form.tsx:56`, `package-payment-view.tsx:127` | **ברירת מחדל** | נמדד: מוצג כש-`provider==='sumit'`; טוען בדפדפן הלקוח את `https://app.sumit.co.il/scripts/payments.js` |
| החזר דרך SUMIT | `src/lib/payments/package-refund.ts` | **רדום** | נמדד: אין `package_purchase` של SUMIT ב-ledger, ולכן אין מה להחזיר בו. אבל `purchase-provider.ts:24` מחזיר `sumit` גם כשאין רכישה מוצלחת כלל |
| אירועי SUMIT נכנסים | `src/app/api/workflows/hook/[endpoint]/route.ts`; `src/lib/workflow/webhook-trigger.ts` | **פעיל (הסקה)** | נמדד: ה-workflow הפעיל מבוסס על `trigger.sumit_card`. שהאירועים אכן מגיעים דרך ה-hook הזה לא נבדק |

### 3.2 כלי ניהול

| פריט | מיקום | הערה |
|---|---|---|
| **`/admin/sumit-test`** | `src/app/(admin)/admin/sumit-test/`, `src/app/api/admin/sumit-test/route.ts`, פריט בתפריט (`admin-shell.tsx`) | **כלי חיוב אמיתי.** נקרא בקוד: "tokenize a card → POST a charge… J4/J5", דורש `manage_billing`. השימוש האחרון 6.10 |
| הגדרת פרטי גישה | `/admin/integrations/sumit/` (4 קבצים), `src/lib/data/admin/settings.ts` (20 אזכורים), `src/lib/validation/admin.ts` | טופס שמירת המפתחות |
| פאנל אינטגרציות | `src/lib/ops/integrations.ts:177` ("SUMIT / OfficeGuy"); פונקציית SQL `integrations_configured_flags` | מציג מצב הגדרה |
| סקירת תשלומים | `src/lib/data/admin/payment-review.ts` (`probeSumitCharge`), `admin/payments/review-card.tsx` (17 אזכורים), `payment-orphans.ts`, `data/payments.ts` | לא נקראו במלואם; ייתכן שהם משרתים גם CardCom |
| ביטולים | `src/lib/data/event-cancellation.ts` (11), `package-cancellation.ts`, `admin/cancellations/[id]/page.tsx` | העמודות `sumit_document_*` ריקות בכל השורות |

### 3.3 Workflows

| פריט | מצב |
|---|---|
| ה-workflow הפעיל | "תפיסת מסגרת השתנתה ב-SUMIT — התראה לצוות": `trigger.sumit_card` ← `action.notify_team`. 21 הרצות (14.9 עד 6.10). נמדד |
| חמישה workflows לא פעילים | 2 עותקים של התראת תפיסת מסגרת, 3 של "יצירת לקוח והפקת מסמך". 0 הרצות |
| צמתים בקוד | `trigger-sumit-card`, `action-sumit-create-customer`, `action-sumit-create-document`; 3 תבניות בקטלוג; מנוע ה-workflow מזכיר SUMIT ב-38 קבצים |
| רישום טריגרים **בצד SUMIT** | `src/lib/sumit/crm-triggers.ts` ו-`sumit-trigger-subscriptions.ts` יוצרים ומסירים מנויים ב-CRM של SUMIT. **לא נבדק** — דורש קריאה ל-SUMIT (ראו סעיף 6) |

### 3.4 נתונים

| אובייקט | פירוט |
|---|---|
| טבלאות | `sumit_customers` (3 שורות, טריגר `trg_sumit_customers_updated`), `sumit_test_transactions` (6 שורות, מפתח זר `RESTRICT` לעצמה) |
| עמודות | `app_settings`: `sumit_api_key`, `sumit_api_public_key`, `sumit_company_id` · `campaigns`: `sumit_customer_id`, `sumit_order_document_id`, `sumit_charge_document_id` · `event_cancellation_requests`: `sumit_document_id`, `sumit_document_url` |
| פונקציות SQL | `integrations_configured_flags`, `test_event_purge_blocker` (שתיהן SECURITY DEFINER) |
| תור | `sumit-health-check` ב-pg-boss |
| לא נמצא | views, מדיניות RLS, אינדקסים מעבר לטבלאות לעיל, סודות Vault ששמם כולל "sumit". 52 קבצי מיגרציה היסטוריים מזכירים SUMIT (היסטוריה, לא לשינוי) |

### 3.5 ספרייה, סקריפטים, תצורה

| פריט | הערה |
|---|---|
| `src/lib/sumit/` | 16 קבצי קוד: לקוח OpenAPI מחולל (`generated/api.ts`, ~256 אזכורים), `charge.ts`, `accounting.ts`, `crm-triggers.ts`, `health.ts` |
| `scripts/` | 11 סקריפטים `sumit-*` (בהם `sumit-charge-token.ts`, `sumit-crm-list-*.ts`) ועוד `find-legacy-campaign-payment-columns.mjs`. שלושת הסקריפטים שנקראו (`sumit-health`, `sumit-payment-get`, `sumit-charge-token`) לוקחים את פרטי הגישה האמיתיים מ-`getSumitServerConfig()`. את שאר התשעה לא קראתי |
| `src/lib/relocation/env-validation.ts:78-81` | דורש (בצורה ניתנת-לדילוג) `NEXT_PUBLIC_SUMIT_COMPANY_ID`, `NEXT_PUBLIC_SUMIT_API_PUBLIC_KEY`, `SUMIT_API_KEY`. נמדד: שום קוד לא קורא משתני סביבה כאלה, הערכים נקראים מ-`app_settings`. **בדיקה מתה** |
| `src/lib/owner-agent/consumer/primer.ts:103` | מתאר לסוכן הבעלים את עמודות SUMIT ב-`app_settings` |
| ממשק לקוח — "מספר לקוח" | `settings/customer-number-field.tsx`: מציג את מספר הלקוח של SUMIT. **נמדד:** הפונקציה היחידה שכותבת אותו (`recordSumitCustomerId`) נקראת רק מנתיב הרכישה של SUMIT. לקוח CardCom לא יקבל מספר לעולם, והשדה יציג "יופיע לאחר התשלום הראשון" לנצח |

### 3.6 תיעוד, סוכנים, תכנון

83 קבצי `docs/` · `.claude/agents/sumit-billing-expert.md` (סוכן שלם ל-SUMIT) ואזכורים בשני סוכנים נוספים · סקיל `israeli-osek-patur-tax` · `.claude/settings.local.json` · OpenSpec: `retire-sumit-campaign-columns` (6 קבצים), `personal-coupons` (2), `personal-coupons-admin-panel` (1), `access-denied-page` (1).

## 4. רישום סיכונים

| # | סיכון | חומרה | למה |
|---|---|---|---|
| R1 | **חזרה שקטה לחיוב דרך SUMIT** כש-CardCom כבוי, מוגדר לא תקין או לא נטען | **גבוהה** | נמדד בסעיף 3.1. כל התנאים האחרים מתקיימים. בקטע הקוד שנקרא (`package-purchase.ts:124-146`) אין התראה על המעבר ל-SUMIT |
| R2 | **יציבות ההחזרים ב-CardCom מבוססת על דגימה קטנה** | בינונית | נמדד: 5 מתוך 6 החזרים אמיתיים נכשלו, כולם ב-9.10; 3 מהם בקוד 9006 (חסרה הרשאת זיכוי למשתמש ה-API), והניסיון האחרון הצליח. מאז לא נעשו החזרים נוספים. הסרת הגיבוי של SUMIT נשענת על הצלחה אחת |
| R3 | כלי חיוב אמיתי של ספק מוצא-משימוש בממשק הניהול | בינונית | `/admin/sumit-test`, הרשאת `manage_billing` |
| R4 | מנויי טריגרים ב-SUMIT עדיין עשויים להיות רשומים ולהפנות ל-hook שלנו | לא ידוע | לא נבדק (סעיף 6) |
| R5 | משימה יומית ופרטי גישה פעילים לספק שאינו בשימוש | נמוכה | מוסיפה משטח חשיפה בלי ערך |
| R6 | שדה "מספר לקוח" שלא יתמלא ללקוחות CardCom | נמוכה | פגם בחוויית משתמש |
| R7 | תיעוד וסוכנים מכוונים עבודה עתידית ל-SUMIT | בינונית (תהליך) | `sumit-billing-expert`, 83 מסמכים |
| R8 | שמירת רשומות חשבונאיות | לבירור | ששת שורות ה-ledger ומסמכי SUMIT הקשורים עשויים לחול עליהם חובת שמירה. אין למחוק לפני שהיועץ המס מאשר. לא קבעתי זאת בעצמי |

## 5. סדר הסרה מוצע (לא בוצע, כל שלב כשינוי OpenSpec נפרד)

1. **תנאים מקדימים:** בירור כשל ההחזרים ב-CardCom (R2). החלטת שמירה על נתונים היסטוריים (R8). אישור לבדיקה קריאה-בלבד מול SUMIT (סעיף 6).
2. **סגירת הדלת:** הפיכת ברירת המחדל מ-"SUMIT" ל-"הרכישה מושבתת" כש-CardCom לא זמין. מכאן אין חזרה שקטה (R1).
3. **צמצום משטח:** הסרת `/admin/sumit-test` והפריט בתפריט. הפסקת המשימה היומית.
4. **Workflows:** הסרת הרישום ב-SUMIT, ביטול ה-workflow הפעיל או החלפתו, הסרת הצמתים והתבניות.
5. **ממשק לקוח:** הסרת שדה "מספר לקוח" או החלפתו בנתון מ-CardCom.
6. **קוד מת:** `src/lib/sumit`, הסקריפטים, בדיקת הסביבה ב-relocation, סוכן `sumit-billing-expert`.
7. **נתונים:** מחיקת טבלאות ועמודות רק אחרי החלטת השמירה. מחיקת פרטי הגישה השמורים.

## 6. מה לא ניתן היה לאמת

- **מצב בצד SUMIT:** מנויי CRM רשומים, פרטי החשבון, מסמכים שהופקו. דורש קריאה ל-SUMIT עם פרטי הייצור (קריאה בלבד, אך מול צד שלישי). לא בוצעה בלי אישור.
- **צרכנים חיצוניים של ה-hook** (Make, Zapier וכד').
- **ניסוחי הסכמים ומסמכים משפטיים ב-DB** שאולי מזכירים את ספק הסליקה. לא נבדק.
- **תוכן מלא של `admin/payments/review-card.tsx` ו-`payment-review.ts`:** לא נקראו במלואם, ולכן לא הוכרע אם הם משרתים גם CardCom.
- **סיבת ההרצה האחרונה של ה-workflow (6.10):** תאריך השורה האחרונה ב-`sumit_test_transactions` זהה. ההנחה שזו בדיקה היא הסקה, לא מדידה.
