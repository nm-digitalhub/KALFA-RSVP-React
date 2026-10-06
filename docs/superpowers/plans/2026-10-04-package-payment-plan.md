# חבילה בחיוב מיידי — תוכנית מימוש מקצה לקצה

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** למכור חבילה במחיר קבוע שמוגדר בקטלוג, לחייב אותה בחיוב מיידי אחד, להגביל את הפניות למכסת אנשי קשר, ולאפשר שדרוג והחזר, בלי להחזיר ללקוח חיוב לפי מענה.

**Architecture:** (1) הקטלוג (`packages`) קובע מחיר (`price_with_vat`) ומכסה (`contact_quota`), ושניהם מצולמים על הקמפיין בעת יצירתו. (2) כל כסף של חבילה נרשם ביומן `payment_operations` (תוכנית 24.9, Tasks 1-2) עם סוגי פעולה חדשים; עמודות התשלום הישנות ב-`campaigns` לא נקראות ולא נכתבות לקמפיין חבילה. (3) מגן מודל כפול, לפי snapshot על הקמפיין ולפי גרסת ההסכם החתומה, מונע חיוב לפי הנוסחה הישנה. (4) הרשימה המורשית מתמלאת פעם אחת בהפעלה לפי `guests.seq`, ומשם נשמרת בפונקציות הקיימות עם תקרת המכסה (כבר חי).

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (מיגרציות ב-CLI, מופעלות בידי הבעלים), Vitest 5, Zod 4, SUMIT REST (`/billing/payments/charge/`), pg-boss worker.

**Spec:** `2026-10-04-package-payment-survey.md` (העובדות), `2026-09-30-contact-quota-package.md` (המכסה), `2026-09-24-campaign-payment-domain-split.md` (היומן).

**מה בוצע בפועל בתוכנית הזאת (עודכן 4.10, ערב):** הקוד בעץ, **לא מקומט ולא פרוס**, והרכישה **כבויה** (`app_settings.package_model_enabled = false`, ללא כפתור הפעלה במסך הניהול, בכוונה). בעץ: Task 2 (מגני המודל וגרסה v6; 15 הטסטים נכשלו ועברו, והמיגרציה `package_price` הופעלה), Task 4 (היומן, סוגי הפעולה, `status/card/ledger`, מטאטא `payment-orphans`, מסך אדמין `/admin/payments` להכרעה בפעולה שב-`review`), ומסלול הרכישה (P-B, ראו שם "מה נבנה"). **Task 1 (`guests.seq`) ו-Task 3 (כלי הניסוי) עדיין לא בעץ.** `npm run build` לא הורץ (דורש אישור). ממצא סקירה בסוף היום: מסלול ה-hold הישן הציע טופס תפיסה גם לקמפיין חבילה; נסגר (שורת `package_price` בקריאה, סירוב ב-route, והעמוד).

> **חוזה החבילה מנוהל כנתונים (4.10, ערב; המיגרציה הוחלה על ה-DB החי):** אין נוסח חוזה בקוד. לטבלת `agreement_documents` נוספה העמודה `model` (`per_result` | `package`). חוזה החבילה הוא שורה אחת (`model='package'`, גרסה `2026-10-v6`) שמנוהלת ב-`/admin/agreement?model=package`, והיא נזרעה כטיוטה **לא פעילה** (`is_active=false`; הקוד שרץ היום קורא `.eq('is_active', true).maybeSingle()` ושתי שורות פעילות היו מפילות אותו לטיוטת v3). לקוח מקבל את חוזה החבילה רק כשהוא **מאושר**, עם גוף, בגרסת חבילה, ועם `{{packagePrice}}` ו-`{{contactQuota}}`; אין fallback לחוזה של חיוב לפי תוצאה. אישור בודק גם שאין תחליפים לא מוכרים ושאין ציטוט של נתוני חיוב לפי תוצאה. עורך הנוסח הוא TipTap עם שלושה צמתים מותאמים (`dl.terms`, `div.intent`, `div.sub`) ובדיקת הלוך-חזור שמונעת שינוי שקט; נוסח שהעורך לא משחזר במדויק נערך כ-HTML. **החוזה המאושר הבא נדרש לפני שאפשר להציע חבילה ללקוח, והמתג נשאר כבוי.**

> **החלטת הבעלים (4.10, 18:02): אין צורך באישור עו"ד.** כל מקום בתוכנית שנוסח "עובר לעו"ד" או "מחכה לעו"ד" הוא החלטה של הבעלים: שואלים אותו שאלת כן/לא אחת בכל פעם, ולא חוסמים על עו"ד. סקירת הציות הפנימית נשארת כמידע לבעלים, לא כשער.

## Global Constraints

- מיגרציות רק ב-`npx supabase migration new <name>`; הבעלים מריץ `supabase db push --linked --dry-run` ואז `supabase db push --linked`, ואחריו `npm run gen:types && npm run types:check`. `types.generated.ts` לא נערך ידנית.
- טבלה חדשה: `enable row level security`, `revoke all … from public, anon, authenticated`.
- קוד כסף הוא fail-closed ואידמפוטנטי: אין חיוב בלי שורת `pending` מתועדת לפניו; תוצאה לא ידועה הולכת ל-`review` ולעולם לא לניסיון חוזר אוטומטי.
- גוף בקשה ל-SUMIT של עוסק פטור: בלי `VATIncluded` ובלי `VATRate` (החלטת הבעלים 2.9.2026), קבלות בלבד.
- מחירים, מכסות ואחוזי דמי ביטול הם נתונים (`packages`, `app_settings`), לא קבועים בקוד.
- שמות עמודות ביומן נגזרים משדות תשובת SUMIT (הבעלים 30.9).
- בלי `any`; Zod בגבולות; הודעות משתמש בעברית וגנריות; לא נרשמים בלוג פרטי כרטיס, טוקנים, ת"ז או payloads של webhook.
- בלי commit, push, deploy, `npm run build` על העץ החי או הפעלת מיגרציה בלי בקשת הבעלים. כל Task מסתיים בהודעת commit מוכנה בלבד.
- אימות לכל Task: קודם טסטים ממוקדים, אחר כך `npx tsc --noEmit`, `npx eslint <הקבצים>`, וכש-`src/lib/data` משתנה גם `npm run worker:deps`.
- ניסוח ללקוח שנוגע במחיר, בביטול, בהחזר או במה שנגבה עובר סקירת ציות לפני שהוא עולה; הקוד נושא את הניסוח כנתון.
- ניסוי עם כסף אמיתי רק באישור מפורש של הבעלים לכל ריצה, ובסכום של עד ₪2 לניסוי.

## Review Focus

1. **קמפיין חבילה שעובר גמר חשבון לפי הנוסחה הישנה (חיוב כפול).** הדגל `base_overage_pricing_enabled` דולק חי, ו-`createCampaign` מצלם `base_price`/`included_reached` מהחבילה. נבדק ב-Task 2 (שני מגנים, ארבעה טסטים).
2. **ביטול קמפיין חבילה ששולם בלי החזר.** `campaigns_guard_cancel` ו-`cancel_campaign` קוראים רק `capture_status`/`charge_status`. נתיב בקשת הביטול נחסם ב-Task 2. מגן ה-SQL והטסט שלו הם תנאי כניסה לתוכנית P-B (ראו שם) ולא ייפתחו חיובים בלעדיו.
3. **מקומות שמחולקים בסדר שגוי אחרי ייבוא קובץ.** ב-ייבוא כל האורחים מקבלים אותה חותמת זמן, ו-`buildContactsForEvent` בוחר בלי `ORDER BY`. נבדק ב-Task 1.
4. **לחיצה כפולה או שתי לשוניות על רכישה או שדרוג.** נאכף על ידי שורת `pending` ביומן לפני הקריאה ל-SUMIT (אינדקס ייחודי חלקי). טסט ה-route נכתב ב-P-B ו-P-D; הבדיקה ב-DB היא (h) ב-Task 1 של תוכנית 24.9.
5. **משטח שמצטט מודל מחיר שלא זה שנחתם.** `buildBusinessFacts` מכיר שני מודלים בלבד. טסטי המשטחים נכתבים ב-P-G, כולל הרחבת `base-fee-disclosure.test.ts` ולא מחיקתו.
6. **הלקוח שילם וההפעלה נכשלה.** מצב מתאושש: `succeeded` ביומן, הקמפיין נשאר `approved`, והמסך מציג "התשלום התקבל" עם כפתור הפעלה. נכתב ב-P-B.

## מה כבר קיים (נקרא ב-4.10, והתוכנית נשענת עליו)

> הנוסח הראשון של התוכנית נכתב לפני שקראתי את החומר הזה. בעקבותיו תוקנו D3, שלב 0, P-B, P-D ו-P-E.

| מה קיים | איפה | מה זה אומר לתוכנית |
|---|---|---|
| עוגן לקוח SUMIT לכל משלם: טבלת `sumit_customers` עם `getSumitCustomerId`/`recordSumitCustomerId` | `src/lib/data/sumit-customers.ts`, בשימוש ב-`authorize/route.ts:181`; `plans/sumit-customer-id-reconciliation.md` | רכישה ושדרוג שולחים `Customer.ID` של המשלם ורושמים אותו אחרי הצלחה. לפי הערה ב-`authorize.ts` ובביקורת השדות (30.8), חיוב על טוקן שמור בלי `Customer.ID` יצר לקוח חדש ב-SUMIT |
| חיוב J4 על טוקן שמור עם קבלה: `captureHeldCardSumit` | `src/lib/sumit/capture.ts`; נבדק חי 29.6 (₪4 ו-₪1 חלקי) לפי זיכרון `sumit-charge-verified-behavior` | חיוב השדרוג משתמש בו ולא בגוף חדש. ניסוי E3 לא נדרש |
| מסווג סטטוס משותף `sumitStatus()` | `src/lib/sumit/status.ts` (בשימוש `health.ts`). ההערה בו: `authorize.ts` ו-`capture.ts` שומרים עותקים משלהם בינתיים, ולא מחליפים אותם באותו שינוי עם דבר אחר | הפונקציה החדשה משתמשת בו ולא פותחת עותק רביעי |
| `chargeSumit`: חיוב עם `SingleUseToken` וקבלה | `src/lib/sumit/charge.ts`; אין לו קורא (לפי ההערה ב-`status.ts`) | הדגם הקרוב ביותר לרכישה. הוא שולח `VATIncluded`/`VATRate` (בניגוד להחלטה מ-2.9) ובודק רק `Status.IsError`, ולכן מתקנים אותו במקום לכתוב פונקציה חדשה |
| סוג גוף הבקשה `SumitChargeRequestBody` | `src/lib/sumit/charge.ts` | כל גוף חיוב חדש `satisfies` אותו, כך ששמות השדות הם של SUMIT |
| גוף תפיסה עם `SingleUseToken`, בלוק `Customer` מלא ו-`Items` בלי שדות מע"מ, ופענוח התשובה | `authorizeHoldSumit` ב-`authorize.ts` | הדגם לפענוח תשובה: טוקן, תוקף, ת"ז, `CustomerID`, מסמך |
| הדגל `CardTokenNotNeeded` | המפרט החי של SUMIT (נשלף 4.10): "Avoids generating credit card token and saving it on the customer payment method. Defaults to False"; `raw-charge.ts:44,152`; 24.9 שורה 1127 | הטוקן הקבוע נוצר ונשמר על אמצעי התשלום של הלקוח **כברירת מחדל**, ו-`true` מונע אותו. הרכישה לא שולחת את הדגל. חיוב J4 מחזיר טוקן לפי המפרט; חי נבדקה רק תפיסה J5, ו-E1 מאשר את J4 |
| ביקורת שדות הבקשה מול המפרט (30.8) | `docs/sumit-request-parameters-audit.json` | משמעות השדות: ל-`Customer.Name` יש חובה ביצירת לקוח חדש, `Items[].Item.Name` אובייקט מקונן, `Type:1` בטוקן שמור. שורות המע"מ בו קודמות להחלטה מ-2.9, והקוד גובר |
| תשובות חיות וכללי שמירה | `docs/sumit-response-capture-and-audit.md` §3 ו-§7 | תפיסה עם טוקן חד-פעמי החזירה טוקן, ת"ז, תוקף ו-`CustomerID` (1.7). לא שומרים גוף גולמי של SUMIT אלא סיכום (`safe-preview.ts`), ות"ז בעותק יחיד |
| תשובות תמיכת SUMIT (14.7) | זיכרון `sumit-charge-verified-behavior` | טוקן שמור מחויב בשרת בלי נוכחות הלקוח; שחרור תפיסה אפשרי רק בדשבורד (בלי API) |
| הספריות `sumit-api` ו-`sumit-react` | `package.json` (אינן מיובאות); זיכרון `sumit-api-react-packages-evaluated` | הוערכו ב-30.9 ונקבע שאינן מתאימות: לא לאמץ |
| זיכוי: `creditHeldCardSumit` (מסומן UNTESTED); ביטול מסמך `/accounting/documents/cancel/` (במפרט, לא הופעל) | `capture.ts`; `plans/sumit-customer-id-reconciliation.md` §3 | E5 ו-E6 בודקים זיכוי כספי. ביטול מסמך הוא חשבונאי, ואם הוא מחזיר כסף לכרטיס לא ידוע |
| קרדיטים | `billing_credits`, `campaigns.credit_applied`; זיכרון `credits-close-charge-wiring` | D5: הרכישה צורכת את אותו מאגר (קרדיט ברמת האירוע נצרך בפעם הראשונה שהקמפיין נסגר) |
| נתיב תשלום להזמנה (`/api/orders/[id]/pay`) הוסר ב-9.7 | commit `f400e3b`, מיגרציה `20260709120000_remove_orders.sql` | השוואה היסטורית בלבד. נתיב ה-authorize החי הוא הדגם ל-route הרכישה |
| החלטות פתוחות מ-27.8 | `plans/sumit-customer-id-reconciliation.md` | שדה גשר ללקוח ראשון (אימייל או טלפון) ואיחוד לקוחות כפולים ב-SUMIT. חלות גם על הרכישה הראשונה של כל משלם, ואינן חוסמות |

## מה הוחלט

**הבעלים (30.9 עד 4.10):** סעיף 1 בסקר. בקצרה: מחיר קבוע מקטלוג `packages`; מכסה בהיקף אנשי קשר שפונים אליהם; עצירה בהגעה למכסה; הלקוח יכול להוסיף מעבר למכסה והם ממתינים; סדר הוספה עם החלפה לפני פנייה; שדרוג שומר התקדמות; התשלום הוא חיוב; הרשימה מתמלאת בהפעלה.

**ברירות מחדל שבחרתי (לשנות לפי בקשה):**

- **D1 יומן קודם.** כל כסף של חבילה נרשם ב-`payment_operations` (ראו שאלה).
- **D2 חיוב אחד.** J4 עם טוקן חד-פעמי מהטופס הקיים (payments.js), קבלה במייל מ-SUMIT, בלי תשלומים בגרסה הראשונה.
- **D3 פרטי כרטיס.** ברירת מחדל: כמו התכנון הקיים ב-24.9 (החלטת הבעלים 25.9): טוקן ותוקף על שורת הפעולה ששמרה את הכרטיס, ות"ז ב-Vault (Tasks 1 ו-3 של 24.9). הטוקן הקבוע נוצר ונשמר ב-SUMIT כברירת מחדל, כל עוד לא נשלח `CardTokenNotNeeded: true` (המפרט החי); הרכישה לא שולחת אותו. שדרוג מחייב את הטוקן השמור עם `Customer.ID`, ונתיב החיוב הזה נבדק חי (29.6). ניסוי E2 (חיוב בלי אמצעי תשלום בבקשה) אופציונלי: אם יצליח, אפשר בעתיד לא לשמור טוקן בכלל.
- **D4 שדרוג.** הסכום = מחיר החבילה החדשה פחות מה ששולם נטו על חבילות (snapshots, בצד שרת).
- **D5 קרדיטים.** מנוכים ברכישה כשורה שלילית בקבלה (E7 מאמת); יתרה נשארת לאירוע.
- **D6 סדר הפעלה.** חיוב הצליח, אז מילוי הרשימה, אז הפעלה.
- **D7 אין גמר חשבון.** סגירת קמפיין חבילה אחרי האירוע היא job קטן (P-H).
- **D8 סדר מקומות.** `guests.seq`; דרגת איש קשר היא המינימום של `seq` על האורחים שלו.
- **D9 דגל.** `app_settings.package_model_enabled`, מתג אדמין fail-closed שמסרב להפעלה אלא אם ההסכם המאושר הפעיל הוא `PACKAGE_AGREEMENT_VERSION`.
- **D10 ביטול.** "תחילת שירות" = השליחה הראשונה לאורחים (ברירת מחדל שמוצגת לבעלים להחלטה, לא מוכרעת עד שהוא עונה); אחוזי הדמים נשארים ב-`app_settings`.

## שאלה אחת לבעלים

האם לבנות את תשלומי החבילה על **טבלת `payment_operations` מתוכנית 24.9** (רק מה שהחבילה צריכה: Tasks 1 ו-2, והמודול `ledger.ts` מ-Task 5; בלי לגעת בעמודות הישנות ב-`campaigns`, בלי backfill ובלי Contract), במקום להוסיף עמודות תשלום לטבלת הקמפיינים?

ההמלצה שלי: כן. מסמך 24.9 מצטט החלטה שלך (סעיף 2 ב"החלטות הבעלים", שורה 18): "חיוב ישיר של דמי ההפעלה (סכום מוגדר בחבילה, לא קבוע בקוד), החזר, או תשלום אחר חייבים להיכנס בלי שינוי מבנה." חבילה שמשולמת בחיוב אחד היא המקרה הזה. הסיבה המעשית: שדרוג הוא תשלום שני לאותו קמפיין, ושדות התשלום הקיימים ב-`campaigns` (טוקן, מסמך, סכום סופי) מחזיקים תשלום אחד ונדרסים בכל ניסיון (`plans/sumit-customer-id-reconciliation.md`, "Table decision"). המסמך מתעד על עצמו ביקורת שנייה, ביקורת שלישית, אימות רביעי, סבב חמישי (ביקורת חיצונית שלך) ו-VERIFY-5 (שורה 64; לפי המסמך, אימותים 4 ו-5 הורצו מול ה-DB החי ב-begin…rollback). **הטבלה עצמה עדיין לא נבנתה**: זה עיצוב שנבדק, לא קוד שרץ.

## מפת השלבים

| שלב | תוכן | תלוי ב | איפה |
|---|---|---|---|
| Task 1 | `guests.seq`: סדר הוספה | כלום | כאן, קוד מלא |
| Task 2 | `campaigns.package_price`, גרסת הסכם v6, מגני מודל | כלום | כאן, קוד מלא |
| Task 3 | הרחבת כלי הניסוי (חיוב לפי לקוח, זיכוי) | כלום | כאן, קוד מלא |
| שלב 0 | ניסויים חיים E1-E7 | Task 3, אישור הבעלים | כאן, פרוטוקול |
| Task 4 | יומן תשלומים + סוגי פעולה של חבילה | תשובה "כן" לשאלה | כאן (SQL מלא של הסוגים; Tasks 1-2 של 24.9 כמו שהם) |
| P-B | רכישה | שלב 0, Task 2, Task 4 | תוכנית נפרדת |
| P-C | מילוי הרשימה בהפעלה, ממתינים, החלפה | Task 1, P-B | תוכנית נפרדת |
| P-D | שדרוג והתראות | P-B, P-C | תוכנית נפרדת |
| P-E | ביטול והחזר | שלב 0, P-B, החלטת הבעלים | תוכנית נפרדת |
| P-F | שלב בחירת חבילה בהקמה וקטלוג בניהול | Task 2 | תוכנית נפרדת |
| P-G | משטחי מחיר והסכם v6 | החלטת הבעלים | תוכנית נפרדת |
| P-H | פרישה, ניקוי אבטחה וסגירה אוטומטית | הכול | תוכנית נפרדת |

## מבנה קבצים (Tasks 1-4)

- `supabase/migrations/<ts>_guests_seq_order.sql` (Task 1)
- `src/lib/data/contacts.ts` (Task 1, שורה אחת) ו-`src/lib/data/contacts-build-order.test.ts` (חדש)
- `supabase/migrations/<ts>_campaigns_package_price.sql` (Task 2)
- `src/lib/agreements/template.ts`, `src/lib/data/campaigns.ts`, `src/lib/data/close-charge.ts`, `src/lib/data/event-cancellation.ts`, `src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts` (Task 2)
- `src/lib/agreements/package-version.test.ts` (חדש), `src/lib/data/close-charge.test.ts`, `src/lib/data/event-cancellation.test.ts` (Task 2)
- `supabase/migrations/<ts>_sumit_test_transactions_operations.sql` (Task 3)
- `src/lib/sumit/raw-charge.ts`, `src/lib/sumit/safe-preview.ts`, `src/lib/data/admin/sumit-test-transactions.ts`, `src/app/api/admin/sumit-test/route.ts`, `src/app/(admin)/admin/sumit-test/sumit-test-form.tsx`, `src/app/(admin)/admin/sumit-test/page.tsx` ובדיקותיהם (Task 3)
- `supabase/migrations/<ts>_payment_operation_kinds_package.sql` (Task 4)

---

### Task 1: סדר הוספה לאורחים (`guests.seq`)

**למה:** ב-ייבוא קובץ כל האורחים נוצרים בהוספה אחת ולכן חולקים `created_at` (נמדד: 39 מתוך 43 באירוע הגדול). `buildContactsForEvent` בוחר אותם בלי `ORDER BY`, ולכן אנשי הקשר נוצרים, ומקומות יחולקו, לפי סדר ההחזרה של מסד הנתונים. ההחלטה "לפי סדר ההוספה" דורשת עמודת סדר מפורשת.

**Files:**
- Create: `supabase/migrations/<ts>_guests_seq_order.sql`
- Modify: `src/lib/data/contacts.ts` (`buildContactsForEvent`)
- Create: `src/lib/data/contacts-build-order.test.ts`
- Create: `src/lib/data/guests-seq.integration.test.ts` (מדולג בלי DB בדיקה)

**Interfaces:**
- Produces: `guests.seq bigint not null`, ייחודי, עולה. מי שמסתמך עליו: P-C (פונקציית המילוי) ו-`buildContactsForEvent`.
- Consumes: כלום.

- [ ] **Step 1: כתוב את הטסט הנכשל**

`src/lib/data/contacts-build-order.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildContactsForEvent } from '@/lib/data/contacts';

type GuestRow = { id: string; phone: string | null; seq: number };

// A Supabase double whose `order()` really sorts, so a missing `.order('seq')`
// leaves the rows in the (deliberately scrambled) order the database returned
// them — the exact defect: an unordered SELECT returns heap order, not file order.
function guestsBuilder(rows: GuestRow[]) {
  let data = [...rows];
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: (column: keyof GuestRow, opts?: { ascending?: boolean }) => {
      const dir = opts?.ascending === false ? -1 : 1;
      data = [...data].sort((a, b) => (Number(a[column]) - Number(b[column])) * dir);
      return builder;
    },
    then: (resolve: (v: { data: GuestRow[]; error: null }) => unknown) =>
      resolve({ data, error: null }),
  };
  return builder;
}

describe('buildContactsForEvent — contacts are created in the guests\' order of addition', () => {
  const createdPhones: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    createdPhones.length = 0;
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'contacts') {
          return {
            upsert: (row: { normalized_phone: string }) => ({
              select: () => ({
                single: async () => {
                  createdPhones.push(row.normalized_phone);
                  return { data: { id: `contact-${createdPhones.length}` }, error: null };
                },
              }),
            }),
          };
        }
        // guests.update({ contact_id }).eq().eq()
        return { update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) };
      },
    } as unknown as ReturnType<typeof createAdminClient>);
  });

  it('orders by seq: a scrambled SELECT still yields contacts in file order', async () => {
    // File order is seq 1,2,3 (A,B,C); the database handed them back as C,A,B.
    const rows: GuestRow[] = [
      { id: 'g-c', phone: '0541234567', seq: 3 },
      { id: 'g-a', phone: '0501234567', seq: 1 },
      { id: 'g-b', phone: '0521234567', seq: 2 },
    ];
    vi.mocked(createClient).mockResolvedValue({
      from: () => guestsBuilder(rows),
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await buildContactsForEvent('event-1');

    expect(createdPhones).toEqual(['+972501234567', '+972521234567', '+972541234567']);
    // The caller (import → reconcile loop) walks contactIds in this order, so it is
    // also the order seats are handed out in.
    expect(result.contactIds).toEqual(['contact-1', 'contact-2', 'contact-3']);
  });

  it('a household: two guests on one phone give ONE contact, ranked by the earliest guest', async () => {
    const rows: GuestRow[] = [
      { id: 'g-2', phone: '0521234567', seq: 2 },
      { id: 'g-1', phone: '0501234567', seq: 1 },
      { id: 'g-3', phone: '0521234567', seq: 3 }, // same phone as g-2
    ];
    vi.mocked(createClient).mockResolvedValue({
      from: () => guestsBuilder(rows),
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await buildContactsForEvent('event-1');

    expect(createdPhones).toEqual(['+972501234567', '+972521234567']);
    expect(result.uniqueContacts).toBe(2);
  });
});
```

- [ ] **Step 2: הרץ ווודא כישלון**

Run: `npx vitest run src/lib/data/contacts-build-order.test.ts`
Expected: שני הטסטים נכשלים. (הורץ ב-4.10: `expected [ '+972521234567', '+972501234567' ] to deeply equal [ '+972501234567', '+972521234567' ]`.)

- [ ] **Step 3: צור את המיגרציה**

Run: `npx supabase migration new guests_seq_order`, וכתוב:

```sql
-- Stable "order of addition" for guests (contact-quota package: the first N added are inside).
-- Plan: docs/superpowers/plans/2026-10-04-package-payment-plan.md Task 1.
--
-- WHY NOT created_at: a bulk import inserts every row in one statement, so all rows share now().
-- Measured 2026-10-04: 39 of the 43 guests of the largest event have the same created_at.
--
-- seq is an IDENTITY column: the default is evaluated per row, in the order the rows are produced by the
-- INSERT (a PostgREST bulk insert is one statement over the JSON array, so that is the file order), and an
-- identity default needs no separate USAGE grant on the sequence for authenticated writers.
--
-- Existing rows: the file order of past imports is not recoverable (their rows share created_at), so they are
-- numbered by (created_at, id) — fixed and repeatable. Only the live test events are affected.
-- trg_guests_updated is disabled for the backfill so updated_at of existing guests does not move.
-- Measured live 2026-10-04 (read-only): trg_guests_updated is the ONLY non-internal trigger on public.guests, the
-- table is in no publication (no realtime fan-out) and holds 45 rows. RE-RUN the trigger query before pushing
-- (Step 4): a trigger added since then would fire once per row on the backfill UPDATE and must be disabled here too.
--
-- ROLLBACK: drop index guests_event_seq_idx; drop index guests_seq_uq; alter table public.guests drop column seq;

alter table public.guests add column seq bigint generated by default as identity;

alter table public.guests disable trigger trg_guests_updated;
with ordered as (
  select id, row_number() over (order by created_at, id) as rn from public.guests
)
update public.guests g set seq = o.rn from ordered o where g.id = o.id;
alter table public.guests enable trigger trg_guests_updated;

-- New rows continue after the backfill.
select setval(pg_get_serial_sequence('public.guests', 'seq'),
              coalesce((select max(seq) from public.guests), 0) + 1, false);

create unique index guests_seq_uq on public.guests (seq);
create index guests_event_seq_idx on public.guests (event_id, seq);

comment on column public.guests.seq is
  'Order of addition. Monotonic, unique, assigned by the database. A contact''s rank in the contact-quota model is the minimum seq among its guests. Do not use created_at for ordering: bulk inserts share it.';
```

- [ ] **Step 4: הבעלים מפעיל את המיגרציה ומעדכן טיפוסים**

לפני ההפעלה, בדיקה בקריאה בלבד. חייבת להחזיר שורה אחת בלבד, `trg_guests_updated` (נמדד כך ב-4.10); כל שורה נוספת עוצרת את ההפעלה עד שהטריגר מטופל במיגרציה:

```sql
select tgname from pg_trigger where tgrelid = 'public.guests'::regclass and not tgisinternal;
```

```bash
supabase db push --linked --dry-run
supabase db push --linked && npm run gen:types && npm run types:check
```

אימות קריאה בלבד אחרי ההפעלה:

```sql
select count(*) as total, count(distinct seq) as distinct_seq, min(seq), max(seq) from public.guests;  -- total = distinct_seq
select attidentity from pg_attribute where attrelid = 'public.guests'::regclass and attname = 'seq';   -- 'd'
select indexname from pg_indexes where tablename = 'guests' and indexname in ('guests_seq_uq', 'guests_event_seq_idx'); -- 2 rows
```

**חשוב:** את שינוי הקוד (Step 5) מכניסים **רק אחרי** שהמיגרציה הופעלה. לפני כן `.order('seq')` על עמודה שאינה קיימת נכשל ב-42703 וגורם ל-`buildContactsForEvent` לזרוק.

- [ ] **Step 5: שינוי הקוד, שורה אחת**

ב-`src/lib/data/contacts.ts`, בפונקציה `buildContactsForEvent`, החלף:

```ts
    .select('id, phone')
    .eq('event_id', eventId);
  if (error) throw new Error('טעינת המוזמנים נכשלה');
```

ב:

```ts
    .select('id, phone')
    .eq('event_id', eventId)
    // Order of addition (guests.seq). Without it the rows come back in heap order, and a
    // bulk import inserts every guest in one statement (identical created_at), so the
    // contacts would be created — and, in the contact-quota model, seats handed out — in
    // an arbitrary order instead of the order the guests were added.
    .order('seq', { ascending: true });
  if (error) throw new Error('טעינת המוזמנים נכשלה');
```

- [ ] **Step 6: הרץ ווודא הצלחה**

Run: `npx vitest run src/lib/data/contacts-build-order.test.ts "src/app/(customer)/app/events/[id]/guests" src/lib/data/reconcile.test.ts`
Expected: PASS (הורץ ב-4.10: 8 קבצים, 60 טסטים). אחר כך `npx tsc --noEmit` ו-`npx eslint src/lib/data/contacts.ts src/lib/data/contacts-build-order.test.ts`.

- [ ] **Step 7: טסט אינטגרציה (מדולג בלי DB בדיקה)**

`src/lib/data/guests-seq.integration.test.ts`, באותו דפוס שער כמו `reconcile.integration.test.ts` (`OUTREACH_DB_IT=1` ו-`resolveTestDb()`, נכשל בכוונה מול prod):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { resolveTestDb } from '@/lib/outreach/test-db-guard';

// guests.seq must increase in the order rows are produced by ONE multi-row insert (what a bulk import is).
// Gated like reconcile.integration.test.ts: a TEST-ONLY database, never the linked prod project.
const RUN = process.env.OUTREACH_DB_IT === '1';
const TEST = RUN ? resolveTestDb() : null;

describe.skipIf(!RUN)('guests.seq — rollback-isolated', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: TEST!.dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 1,
      application_name: 'kalfa-guests-seq-it',
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('a multi-row insert gets strictly increasing seq in row order', async () => {
    const q = (t: string, v?: unknown[]) => pool.query(t, v);
    await q('begin');
    try {
      await q('set local session_replication_role = replica');
      const event = randomUUID();
      const res = await q(
        `insert into public.guests (id, event_id, full_name)
         select gen_random_uuid(), $1, 'g' || n from generate_series(1, 25) n
         returning full_name, seq`,
        [event],
      );
      const seqs = res.rows.map((r: { seq: string }) => Number(r.seq));
      expect(seqs).toHaveLength(25);
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      expect(res.rows.map((r: { full_name: string }) => r.full_name)).toEqual(
        Array.from({ length: 25 }, (_, i) => `g${i + 1}`),
      );
    } finally {
      await q('rollback');
    }
  });
});
```

Run: `npx vitest run src/lib/data/guests-seq.integration.test.ts` → מדולג (1 skipped).

- [ ] **Step 8: הודעת commit מוכנה (לא להריץ בלי בקשת הבעלים)**

```bash
git add supabase/migrations/*_guests_seq_order.sql src/lib/supabase/types.generated.ts src/lib/data/contacts.ts src/lib/data/contacts-build-order.test.ts src/lib/data/guests-seq.integration.test.ts
git commit -m "feat(guests): seq — a stable order of addition (bulk imports share created_at)"
```

---

### Task 2: מודל החבילה על הקמפיין, גרסת הסכם v6 ומגני מודל

**למה:** קמפיין חבילה שיעבור `closeCampaignAndCharge` יחויב שוב לפי הנוסחה הישנה, כי `createCampaign` מצלם `base_price`/`included_reached`/`price_per_reached` והדגל `base_overage_pricing_enabled` דולק חי. בנוסף, `defaultBody` בהסכם נופל לסעיפי "לפי מענה" לכל גרסה לא מוכרת, כך שהסכם v6 בלי גוף מותאם היה מציג ללקוח חוזה שגוי.

**Files:**
- Create: `supabase/migrations/<ts>_campaigns_package_price.sql`
- Modify: `src/lib/agreements/template.ts`, `src/lib/data/campaigns.ts`, `src/lib/data/close-charge.ts`, `src/lib/data/event-cancellation.ts`, `src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts`
- Create: `src/lib/agreements/package-version.test.ts`
- Modify (tests): `src/lib/data/close-charge.test.ts`, `src/lib/data/event-cancellation.test.ts`

**Interfaces:**
- Produces: `campaigns.package_price numeric(10,2)` (NULL = לא קמפיין חבילה); `PACKAGE_AGREEMENT_VERSION = '2026-10-v6'`; `isPackageAgreementVersion(v: string | null | undefined): boolean`; תוצאת `CloseChargeOutcome` חדשה `'not_applicable'`.
- Consumes: כלום. `package_price` נכתב רק על ידי `createCampaign` בתוכנית P-F, ולכן המגנים רדומים עד אז.

- [ ] **Step 1: כתוב את הטסטים הנכשלים**

`src/lib/agreements/package-version.test.ts` (חדש):

```ts
import { describe, expect, it } from 'vitest';

import {
  renderAgreementBody,
  BASE_FEE_AGREEMENT_VERSION,
  OPEN_CEILING_AGREEMENT_VERSION,
  PACKAGE_AGREEMENT_VERSION,
  isBaseFeeAgreementVersion,
  isOpenCeilingAgreementVersion,
  isPackageAgreementVersion,
  type AgreementContent,
} from '@/lib/agreements/template';

// The package contract (v6) is a different kind of agreement: one fixed price paid at purchase,
// no per-reached component, no settlement. The property defended here is that introducing it
// can neither switch an older signature into the new model nor let the in-code default put the
// WRONG contract text in front of a package buyer.

const content: AgreementContent = {
  company: {
    name: 'קאלפא',
    id: '51-1234567',
    address: 'הרצל 1, תל אביב',
    contactPhone: '03-1234567',
    contactEmail: 'support@kalfa.me',
    privacyUrl: 'https://kalfa.me/privacy',
    termsUrl: 'https://kalfa.me/terms',
    warrantyText: 'השירות ניתן כפי שהוא.',
  },
  eventName: 'החתונה של דנה ויוסי',
  pricePerReached: 0,
  maxContacts: 0,
  ceiling: 0,
  channels: ['whatsapp', 'call'],
  windowText: '1.11.2026 – 19.11.2026',
  baseFee: 0,
  includedReached: 0,
};

describe('isPackageAgreementVersion', () => {
  it('matches the approved version and its draft form', () => {
    expect(isPackageAgreementVersion(PACKAGE_AGREEMENT_VERSION)).toBe(true);
    expect(isPackageAgreementVersion(`draft-${PACKAGE_AGREEMENT_VERSION}`)).toBe(true);
  });

  it.each([null, undefined, '', '2026-07-v4', '2026-09-v5', 'draft-2026-06-v2', '2026-10-v7'])(
    'does not match %s (unknown or absent is NOT a package: the safe default for the money path)',
    (v) => {
      expect(isPackageAgreementVersion(v)).toBe(false);
    },
  );

  it('does not leak into the other model predicates (v4 and v5 are untouched)', () => {
    expect(isBaseFeeAgreementVersion(PACKAGE_AGREEMENT_VERSION)).toBe(false);
    expect(isOpenCeilingAgreementVersion(PACKAGE_AGREEMENT_VERSION)).toBe(false);
    expect(isPackageAgreementVersion(BASE_FEE_AGREEMENT_VERSION)).toBe(false);
    expect(isPackageAgreementVersion(OPEN_CEILING_AGREEMENT_VERSION)).toBe(false);
  });
});

describe('renderAgreementBody for a package version', () => {
  it('refuses to render the in-code default (it has no package clauses; the per-reached text would be wrong)', () => {
    expect(() =>
      renderAgreementBody(content, { version: PACKAGE_AGREEMENT_VERSION, status: 'draft', bodyHtml: null }),
    ).toThrow('package agreement has no default body');
  });

  it('renders a custom body for the package version', () => {
    const html = renderAgreementBody(content, {
      version: PACKAGE_AGREEMENT_VERSION,
      status: 'approved',
      bodyHtml: '<h1>חבילה</h1><p>גרסה {{version}}</p>',
    });
    expect(html).toContain('חבילה');
    expect(html).toContain(PACKAGE_AGREEMENT_VERSION);
  });

  it('every pre-existing version still renders its default body', () => {
    for (const version of ['draft-2026-07-v3', BASE_FEE_AGREEMENT_VERSION, OPEN_CEILING_AGREEMENT_VERSION]) {
      expect(() => renderAgreementBody(content, { version, status: 'draft', bodyHtml: null })).not.toThrow();
    }
  });
});
```

`src/lib/data/close-charge.test.ts` — (א) הרחב את ה-mock של התבנית (רשימת הייצוא שם סגורה):

```ts
    isOpenCeilingAgreementVersion: actual.isOpenCeilingAgreementVersion,
    isPackageAgreementVersion: actual.isPackageAgreementVersion,
  };
```

(ב) הוסף לפני `describe('with an override amount (cancellation-resolve path)', …)`:

```ts
  // A fixed-price PACKAGE campaign is paid at purchase and has no settlement. The old
  // base + overage formula must never run against it: the live base_overage gate is ON, so a
  // campaign created from a package would otherwise carry the old snapshot and be billed twice.
  describe('model guard — package campaigns are never settled by the pay-per-result formula', () => {
    function noMoneyMoved() {
      expect(closeCampaign).not.toHaveBeenCalled();
      expect(lockCampaignForCharge).not.toHaveBeenCalled();
      expect(markCampaignChargeOutcome).not.toHaveBeenCalled();
      expect(captureHeldCardSumit).not.toHaveBeenCalled();
      expect(captureAuthorizationSumit).not.toHaveBeenCalled();
      expect(getCampaignBillingSummary).not.toHaveBeenCalled();
    }

    it('refuses on the campaign\'s own package_price snapshot — before any state change', async () => {
      happy();
      m.forCharge.mockResolvedValue({
        id: 'c1', event_id: 'e1', status: 'active', capture_status: null, charge_status: null,
        package_price: 120, base_price: 200, included_reached: 200, price_per_reached: 4,
        max_charge_ceiling: 600,
      });
      const r = await closeCampaignAndCharge('c1');
      expect(r).toEqual({ outcome: 'not_applicable', amount: 0 });
      noMoneyMoved();
      expect(getSignedAgreementVersion).not.toHaveBeenCalled();
    });

    it('refuses on the SIGNED version even when the snapshot is missing (the old-model fields are all set)', async () => {
      happy();
      m.forCharge.mockResolvedValue({
        id: 'c1', event_id: 'e1', status: 'active', capture_status: 'authorized', charge_status: null,
        card_token_ref: 'tok-abc', card_exp_month: 7, card_exp_year: 2031, card_citizen_id: '316125434',
        auth_external_ref: 'ext-1', package_price: null,
        base_price: 200, included_reached: 200, price_per_reached: 4, max_charge_ceiling: 600,
      });
      m.signed.mockResolvedValue('2026-10-v6');
      m.summary.mockResolvedValue({ reachedCount: 250, accrued: 1000, ceiling: 600, maxContacts: 300 });
      const r = await closeCampaignAndCharge('c1');
      expect(r).toEqual({ outcome: 'not_applicable', amount: 0 });
      expect(captureHeldCardSumit).not.toHaveBeenCalled();
      expect(captureAuthorizationSumit).not.toHaveBeenCalled();
      expect(lockCampaignForCharge).not.toHaveBeenCalled();
      expect(markCampaignChargeOutcome).not.toHaveBeenCalled();
    });

    it('the draft form of the package version is refused too', async () => {
      happy();
      m.signed.mockResolvedValue('draft-2026-10-v6');
      const r = await closeCampaignAndCharge('c1');
      expect(r).toEqual({ outcome: 'not_applicable', amount: 0 });
      expect(captureHeldCardSumit).not.toHaveBeenCalled();
    });

    it('a legacy v4 campaign is unaffected (the guard is not a blanket refusal)', async () => {
      happy();
      m.signed.mockResolvedValue('2026-07-v4');
      const r = await closeCampaignAndCharge('c1');
      expect(r.outcome).toBe('charged');
    });
  });

```

`src/lib/data/event-cancellation.test.ts` — בתוך `happy()` הוסף לאפשרויות `packagePrice?: number | null;` ולשורת הקמפיין `package_price: opts.packagePrice ?? null,` (לפני `...cardFields`), והוסף לפני הטסט `'pre-charge campaign: calls closeCampaignAndCharge with overrideAmount=0 for full_cancellation'`:

```ts
  it('package campaign: fails closed BEFORE the email and any money movement', async () => {
    const { send, smsSend } = happy({ chargeStatus: null, packagePrice: 120 });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל' }),
    ).rejects.toThrow('קמפיין חבילה');
    expect(send).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(creditHeldCardSumit).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: הרץ ווודא כישלון**

Run: `npx vitest run src/lib/agreements/package-version.test.ts src/lib/data/close-charge.test.ts src/lib/data/event-cancellation.test.ts`
Expected: FAIL (הורץ ב-4.10: 15 טסטים נכשלו, ביניהם `isPackageAgreementVersion is not a function`).

- [ ] **Step 3: צור את המיגרציה**

Run: `npx supabase migration new campaigns_package_price`, וכתוב:

```sql
-- Fixed package price agreed at signing, snapshotted on the campaign exactly as price and terms are
-- (plan 2026-10-04-package-payment-plan.md Task 2). NULL = a pay-per-result campaign, i.e. every campaign
-- today. When set, the campaign has no settlement and the close-charge formula must never run on it.
--
-- NOT base_price: base_price feeds the old base + overage formula, and storing a package price there
-- would make the old close-charge bill it again.
--
-- Nothing writes this column yet (createCampaign changes in plan P-F), so the guards that read it are
-- dormant. campaigns has a SELECT-only policy for customers, so an owner cannot set their own price.
--
-- ROLLBACK: alter table public.campaigns drop constraint campaigns_package_price_nonneg;
--           alter table public.campaigns drop column package_price;

-- Same type as packages.price_with_vat (numeric(10,2), measured live 2026-10-04): the value is copied from it.
alter table public.campaigns
  add column if not exists package_price numeric(10, 2);

alter table public.campaigns
  add constraint campaigns_package_price_nonneg
  check (package_price is null or package_price >= 0);

comment on column public.campaigns.package_price is
  'Fixed package price agreed at signing (copied from packages.price_with_vat at creation). NULL = pay-per-result campaign. When set, close-charge refuses the campaign: its money is in the payment ledger.';
```

- [ ] **Step 4: הבעלים מפעיל את המיגרציה ומעדכן טיפוסים**

```bash
supabase db push --linked --dry-run
supabase db push --linked && npm run gen:types && npm run types:check
```

הקוד ב-Steps 5-6 נוגע ב-`package_price`: להכניס אותו **רק אחרי** שהמיגרציה הופעלה, אחרת `getCampaignForCharge` ו-`resolveCancellationRequest` ייכשלו על עמודה שאינה קיימת.

- [ ] **Step 5: `src/lib/agreements/template.ts`**

אחרי `isOpenCeilingAgreementVersion` והלפני הערת `// Standard Israeli VAT rate`:

```ts
// v6 — the fixed-price PACKAGE contract (docs/superpowers/plans/2026-10-04-package-payment-plan.md).
// The price is one amount agreed up front and charged once at purchase; there is no per-reached
// component and no settlement. The owner approves the document with EXACTLY this string
// (approving strips the "draft-" prefix, as for v4). Binding the money to the SIGNED version, not to a
// flag, is the D5 pattern: close-charge refuses to settle a package signature under the old formula.
export const PACKAGE_AGREEMENT_VERSION = '2026-10-v6';

const PACKAGE_AGREEMENT_VERSIONS: ReadonlySet<string> = new Set([
  PACKAGE_AGREEMENT_VERSION,
  `draft-${PACKAGE_AGREEMENT_VERSION}`,
]);
export function isPackageAgreementVersion(
  version: string | null | undefined,
): boolean {
  return version != null && PACKAGE_AGREEMENT_VERSIONS.has(version);
}
```

ובתחילת `defaultBody` (לפני `const channelList`):

```ts
  // FAIL CLOSED. The in-code default has no package clauses yet; falling through to the
  // per-reached branch below would put a pay-per-result contract in front of a customer who is
  // buying a fixed-price package. A package version must come with its own (custom) body.
  if (isPackageAgreementVersion(version)) {
    throw new Error('package agreement has no default body — set a custom body for this version');
  }
```

- [ ] **Step 6: `campaigns.ts`, `close-charge.ts`, `event-cancellation.ts`, `campaign-actions.ts`**

`src/lib/data/campaigns.ts` — בסוף ה-`Pick` של `CampaignChargeState` ובמחרוזת `CHARGE_COLUMNS`:

```ts
  | 'price_per_reached'
  // Fixed package price agreed at signing (NULL = a pay-per-result campaign). When set, the
  // campaign has no settlement: close-charge refuses it.
  | 'package_price'
>;

const CHARGE_COLUMNS =
  'id, event_id, status, capture_status, charge_status, card_token_ref, card_exp_month, card_exp_year, card_citizen_id, auth_external_ref, sumit_customer_id, auth_number, auth_amount, release_status, max_charge_ceiling, base_price, included_reached, price_per_reached, package_price';
```

`src/lib/data/close-charge.ts` — (א) ה-import:

```ts
import {
  isBaseFeeAgreementVersion,
  isPackageAgreementVersion,
} from '@/lib/agreements/template';
```

(ב) תוצאה חדשה בטיפוס:

```ts
    | 'disabled'
    | 'bad_state'
    // A fixed-price package campaign: its money was taken at purchase and lives in the payment
    // ledger. There is nothing to settle here, and the pay-per-result formula below must never
    // run against it.
    | 'not_applicable';
```

(ג) מגן 1, מיד אחרי `if (!campaign) return { outcome: 'bad_state', amount: 0 };`:

```ts
  // MODEL GUARD 1 of 2 — the campaign's own price snapshot. Checked before ANY state change.
  if (campaign.package_price != null) return { outcome: 'not_applicable', amount: 0 };
```

(ד) מגן 2, מיד אחרי בלוק ה-`catch` של קריאת `signedVersion` ולפני ההערה `// Flat-base + included + overage.`:

```ts
  // MODEL GUARD 2 of 2 — the SIGNED agreement version (D5 pattern: the money follows the
  // immutable signature, not a flag or a snapshot that could be missing). A package signature
  // never settles under the old formula, whatever the campaign row says.
  if (isPackageAgreementVersion(signedVersion)) {
    return { outcome: 'not_applicable', amount: 0 };
  }
```

`src/lib/data/event-cancellation.ts` — בטיפוס `ResolveFetchRow` הוסף `package_price: number | null;` אחרי `auth_external_ref`, ובמחרוזת ה-select `…, auth_external_ref, package_price))`, ומיד אחרי `const campaign = event.campaigns[0] ?? null;`:

```ts
  // A fixed-price package was paid at purchase and has no settlement. Neither money branch below
  // fits it (closeCampaignAndCharge refuses it; a refund goes through the ledger refund path of the
  // package plan). Fail closed BEFORE the customer email and before any money moves.
  if (campaign?.package_price != null) {
    throw new Error('קמפיין חבילה: ביטול והחזר מטופלים בנתיב נפרד שטרם הופעל — לא בוצעה פעולה');
  }
```

`campaign-actions.ts` — ב-`switch (r.outcome)` של `settleCampaignAction`, לפני `case 'disabled':`:

```ts
    case 'not_applicable':
      return { error: 'בקמפיין חבילה אין גמר חשבון — התשלום בוצע ברכישה.' };
```

- [ ] **Step 7: הרץ ווודא הצלחה**

Run: `npx vitest run src/lib/agreements src/lib/data/close-charge.test.ts src/lib/data/event-cancellation.test.ts "src/app/(customer)/app/events/[id]/campaign"`
Expected: PASS (הורץ ב-4.10: 9 קבצים, 174 טסטים). אחר כך `npx tsc --noEmit`, `npx eslint` על הקבצים ששונו, ו-`npm run worker:deps`.

- [ ] **Step 8: הודעת commit מוכנה**

```bash
git add supabase/migrations/*_campaigns_package_price.sql src/lib/supabase/types.generated.ts src/lib/agreements src/lib/data/campaigns.ts src/lib/data/close-charge.ts src/lib/data/close-charge.test.ts src/lib/data/event-cancellation.ts src/lib/data/event-cancellation.test.ts "src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts"
git commit -m "feat(billing): package model guards — price snapshot, v6 agreement version, close-charge and cancellation refuse package campaigns"
```

---

### Task 3: הרחבת כלי הניסוי לשלב 0 (חיוב לפי לקוח וזיכוי)

**למה:** ניסוי E1 (חיוב J4 ישיר עם טוקן חד-פעמי) אפשרי כבר היום בטופס 1. ניסויי E2 (חיוב לפי לקוח בלי אמצעי תשלום בבקשה) ו-E5-E6 (זיכוי) דורשים שני מצבים חדשים בכלי ושדה `SupportCredit`. מצב חיוב לפי לקוח משרת רק את E2 האופציונלי; מצב הזיכוי נדרש ל-E5 ו-E6.

**Files:**
- Create: `supabase/migrations/<ts>_sumit_test_transactions_operations.sql`
- Modify: `src/lib/sumit/raw-charge.ts`, `src/lib/sumit/safe-preview.ts`, `src/lib/data/admin/sumit-test-transactions.ts`, `src/app/api/admin/sumit-test/route.ts`, `src/app/(admin)/admin/sumit-test/sumit-test-form.tsx`, `src/app/(admin)/admin/sumit-test/page.tsx`
- Modify (tests): `src/lib/sumit/raw-charge.test.ts`, `src/lib/sumit/safe-preview.test.ts`, `src/app/api/admin/sumit-test/route.test.ts`

**Interfaces:**
- Produces: `chargeRaw({ supportCredit?: boolean })`; בלי טוקן וללא `savedCardToken` הגוף לא כולל אמצעי תשלום כלל; `listTestCharges(): Promise<TestChargeOption[]>`; `getTestChargeRow(id): Promise<TestChargeRow | null>`; מצבי route `customer_charge` ו-`credit`; ערכי `operation` חדשים `customer_charge` ו-`credit`.
- Consumes: `chargeSaveAndRender`, `resultPage`, `FormHeading` הקיימים.

- [ ] **Step 1: טסטים נכשלים**

`src/lib/sumit/raw-charge.test.ts` — בתוך `describe('chargeRaw', …)`, אחרי `beforeEach`:

```ts
  // Step 0 of docs/superpowers/plans/2026-10-04-package-payment-plan.md: whether SUMIT can charge or
  // refund a customer from the payment method IT holds, so KALFA need not keep any card detail.
  it('sends NO payment method when given neither a saved token nor a single-use token (E2)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ Data: {} }), { status: 200 }));
    vi.stubGlobal('fetch', f);

    await chargeRaw({
      companyId: 7,
      apiKey: 'k',
      amount: '1',
      vatRate: '',
      autoCapture: true,
      customerId: 2127277236,
      externalId: 'poc-customer-1',
    });

    const body = sentBodyOf(f);
    expect('PaymentMethod' in body).toBe(false);
    expect('SingleUseToken' in body).toBe(false);
    expect((body.Customer as { ID: number }).ID).toBe(2127277236);
    expect(body.AutoCapture).toBe(true);
  });

  it('builds a credit body: SupportCredit + one negative row, nothing else about a card (E5)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ Data: {} }), { status: 200 }));
    vi.stubGlobal('fetch', f);

    await chargeRaw({
      companyId: 7,
      apiKey: 'k',
      amount: '1',
      vatRate: '',
      autoCapture: true,
      supportCredit: true,
      lines: [{ name: 'KALFA — בדיקת זיכוי', quantity: 1, unitPrice: -1 }],
      customerId: 5,
      externalId: 'poc-credit-1',
    });

    const body = sentBodyOf(f);
    expect(body.SupportCredit).toBe(true);
    expect((body.Items as Array<{ UnitPrice: number }>)).toEqual([
      expect.objectContaining({ UnitPrice: -1, Quantity: 1 }),
    ]);
    expect('PaymentMethod' in body).toBe(false);
  });

  it('does not send SupportCredit unless asked', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ Data: {} }), { status: 200 }));
    vi.stubGlobal('fetch', f);

    await chargeRaw({
      companyId: 7,
      apiKey: 'k',
      ogToken: 'tok',
      amount: '1',
      vatRate: '',
      externalId: 'poc-1',
    });

    expect('SupportCredit' in sentBodyOf(f)).toBe(false);
  });
```

(הטסט הראשון מתעד התנהגות קיימת — `JSON.stringify` משמיט `undefined` — ולכן עובר גם לפני השינוי; ה-`else if` ב-Step 3 רק הופך את הכוונה לגלויה.)

`src/lib/sumit/safe-preview.test.ts` — ב-`REQUEST_ALLOWED_KEYS` הוסף לפני `].sort();`:

```ts
  // Step 0 refund / customer-method experiments: presence and a boolean only.
  'payment_method_present',
  'support_credit',
```

`src/app/api/admin/sumit-test/route.test.ts` — הוסף `getTestChargeRow: vi.fn(),` ל-`vi.mock('@/lib/data/admin/sumit-test-transactions', …)`, הוסף אותו ל-import, ובסוף הקובץ:

```ts
// ── Step 0: charge a customer with no payment method, and credit (refund) ─────────────────────

const CHARGE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  customerId: 2127277236,
  amount: 1,
  creditedAmount: 0,
  cardToken: 'tok-secret',
  expMonth: 7,
  expYear: 2031,
  citizenId: '316125434',
};

describe('POST /api/admin/sumit-test — customer_charge (no payment method in the request)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requirePlatformPermission).mockResolvedValue(undefined as never);
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(getTestChargeRow).mockResolvedValue(CHARGE_ROW);
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: { Payment: { ValidPayment: true } } },
    });
  });

  it('charges the customer with NO token of any kind and records the row as customer_charge', async () => {
    await POST(request({ mode: 'customer_charge', charge_id: CHARGE_ROW.id, amount: '1' }));

    const call = vi.mocked(chargeRaw).mock.calls[0][0];
    expect(call.customerId).toBe(CHARGE_ROW.customerId);
    expect(call.autoCapture).toBe(true);
    expect(call.ogToken).toBeUndefined();
    expect(call.savedCardToken).toBeUndefined();
    expect(recordSumitTestTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'customer_charge', parentId: CHARGE_ROW.id }),
    );
  });

  it('rejects a bad amount before calling SUMIT', async () => {
    const res = await POST(request({ mode: 'customer_charge', charge_id: CHARGE_ROW.id, amount: '0' }));
    expect(await res.text()).toContain('סכום לא תקין');
    expect(chargeRaw).not.toHaveBeenCalled();
  });

  it('rejects a charge row that is missing or has no customer number, without calling SUMIT', async () => {
    vi.mocked(getTestChargeRow).mockResolvedValue(null);
    const res = await POST(request({ mode: 'customer_charge', charge_id: CHARGE_ROW.id, amount: '1' }));
    expect(await res.text()).toContain('לא תקין');
    expect(chargeRaw).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/sumit-test — credit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requirePlatformPermission).mockResolvedValue(undefined as never);
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(getTestChargeRow).mockResolvedValue(CHARGE_ROW);
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: { Payment: { ValidPayment: true } } },
    });
  });

  it('customer method: SupportCredit + one negative row, no token', async () => {
    await POST(request({ mode: 'credit', charge_id: CHARGE_ROW.id, amount: '1', credit_method: 'customer' }));

    const call = vi.mocked(chargeRaw).mock.calls[0][0];
    expect(call.supportCredit).toBe(true);
    expect(call.lines).toEqual([{ name: 'KALFA — בדיקת זיכוי', quantity: 1, unitPrice: -1 }]);
    expect(call.customerId).toBe(CHARGE_ROW.customerId);
    expect(call.savedCardToken).toBeUndefined();
    expect(recordSumitTestTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'credit', parentId: CHARGE_ROW.id, requestAmount: -1 }),
    );
  });

  it('token method: sends the saved token, expiry and CitizenID of that charge', async () => {
    await POST(request({ mode: 'credit', charge_id: CHARGE_ROW.id, amount: '0.5', credit_method: 'token' }));

    expect(chargeRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        savedCardToken: 'tok-secret',
        savedCardExpMonth: 7,
        savedCardExpYear: 2031,
        savedCardCitizenId: '316125434',
        supportCredit: true,
      }),
    );
  });

  it('refuses a credit above what remains of the charge, without calling SUMIT', async () => {
    vi.mocked(getTestChargeRow).mockResolvedValue({ ...CHARGE_ROW, amount: 1, creditedAmount: 0.75 });
    const res = await POST(request({ mode: 'credit', charge_id: CHARGE_ROW.id, amount: '0.5', credit_method: 'customer' }));
    expect(await res.text()).toContain('הסכום גבוה מהיתרה');
    expect(chargeRaw).not.toHaveBeenCalled();
  });

  it('token method on a charge that returned no token is refused before SUMIT', async () => {
    vi.mocked(getTestChargeRow).mockResolvedValue({ ...CHARGE_ROW, cardToken: null });
    const res = await POST(request({ mode: 'credit', charge_id: CHARGE_ROW.id, amount: '1', credit_method: 'token' }));
    expect(await res.text()).toContain('חסרים טוקן');
    expect(chargeRaw).not.toHaveBeenCalled();
  });

  it('an unknown credit method is refused', async () => {
    const res = await POST(request({ mode: 'credit', charge_id: CHARGE_ROW.id, amount: '1', credit_method: 'wire' }));
    expect(await res.text()).toContain('שיטת זיכוי לא מוכרת');
    expect(chargeRaw).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: הרץ ווודא כישלון**

Run: `npx vitest run src/lib/sumit/raw-charge.test.ts src/lib/sumit/safe-preview.test.ts src/app/api/admin/sumit-test`
Expected: FAIL (הורץ ב-4.10: 10 טסטים נכשלו; ה-`allow-list` נכשל על מפתחות חסרים, וה-route על מצבים לא מוכרים).

- [ ] **Step 3: מיגרציה**

Run: `npx supabase migration new sumit_test_transactions_operations`, וכתוב:

```sql
-- /admin/sumit-test (Step 0 of docs/superpowers/plans/2026-10-04-package-payment-plan.md) gains two operations:
--   customer_charge — a charge whose body carries a SUMIT customer number and NO payment method at all
--   credit          — a refund experiment (SupportCredit + one negative row)
-- The CHECK is recreated verbatim plus the two values.
-- ROLLBACK: restore check (operation = any (array['charge','hold','capture'])) after deleting any rows
--           that carry the new values.
alter table public.sumit_test_transactions
  drop constraint sumit_test_transactions_operation_check;

alter table public.sumit_test_transactions
  add constraint sumit_test_transactions_operation_check
  check (operation = any (array['charge', 'hold', 'capture', 'customer_charge', 'credit']));
```

הבעלים מפעיל: `supabase db push --linked && npm run gen:types && npm run types:check`.

- [ ] **Step 4: `raw-charge.ts` ו-`safe-preview.ts`**

ב-`src/lib/sumit/raw-charge.ts`, ב-`SumitRawChargeParams` אחרי `customerId?: number;`:

```ts
  /**
   * SupportCredit:true — "Allow credit instead of charge (debit), in case the total is less than
   * 0" (SUMIT swagger). With a negative Items row this is a REFUND experiment (Step 0 of
   * docs/superpowers/plans/2026-10-04-package-payment-plan.md). Omitted ⇒ not sent.
   */
  supportCredit?: boolean;
```

אחרי השורה `...(typeof p.autoCapture === 'boolean' ? { AutoCapture: p.autoCapture } : {}),`:

```ts
    ...(p.supportCredit ? { SupportCredit: true } : {}),
```

והחלף את `} else { body.SingleUseToken = p.ogToken; }` ב:

```ts
  } else if (p.ogToken) {
    body.SingleUseToken = p.ogToken;
  }
  // Neither a saved token nor a single-use token: the body carries NO payment method at all, so
  // SUMIT charges "the customer payment method" of Customer.ID (swagger: PaymentMethod — "Leave
  // this empty to use the customer payment method"). That is the Step 0 experiment E2 — whether a
  // later charge or refund can run without KALFA holding any card detail.
```

ב-`src/lib/sumit/safe-preview.ts` (`summarizeSumitRequest`), אחרי `card_token_present`:

```ts
    // Whether a PaymentMethod object was sent at all: false on a "customer's own method" run
    // (Step 0 E2/E5), where the body deliberately carries neither it nor a SingleUseToken.
    payment_method_present: pm !== null,
    support_credit: b.SupportCredit ?? null,
```

- [ ] **Step 5: מודול הרישום (`sumit-test-transactions.ts`)**

שנה את `operation` ב-`RecordTestTransactionInput` ל-`'charge' | 'hold' | 'capture' | 'customer_charge' | 'credit'`, והוסף בסוף הקובץ:

```ts
// ── Step 0 of the package-payment plan: charges that can be charged again or refunded ──────────

export interface TestChargeOption {
  id: string;
  createdAt: string;
  operation: 'charge' | 'customer_charge';
  amount: number;
  /** Sum of SUCCESSFUL credits already made against this charge (absolute value). */
  creditedAmount: number;
  lastDigits: string | null;
}

// Successful charges made on this screen that carry a SUMIT customer number — the anchor both
// "charge the customer's own method" and "credit" need. Labels only: no token / CitizenID leaves
// the server.
export async function listTestCharges(): Promise<TestChargeOption[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data: charges, error } = await admin
    .from('sumit_test_transactions')
    .select('id, created_at, operation, payment_amount, payment_method_last_digits')
    .in('operation', ['charge', 'customer_charge'])
    .eq('payment_valid_payment', true)
    .not('data_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error('טעינת חיובי הבדיקה נכשלה');
  if (!charges || charges.length === 0) return [];

  const { data: credits, error: creditError } = await admin
    .from('sumit_test_transactions')
    .select('parent_id, payment_amount')
    .eq('operation', 'credit')
    .eq('payment_valid_payment', true)
    .in('parent_id', charges.map((c) => c.id));
  if (creditError) throw new Error('טעינת חיובי הבדיקה נכשלה');

  const credited = new Map<string, number>();
  for (const c of credits ?? []) {
    if (!c.parent_id) continue;
    // The sign SUMIT reports on a credit is itself part of what Step 0 finds out.
    credited.set(c.parent_id, (credited.get(c.parent_id) ?? 0) + Math.abs(Number(c.payment_amount ?? 0)));
  }
  return charges.map((c) => ({
    id: c.id,
    createdAt: c.created_at,
    operation: c.operation === 'customer_charge' ? 'customer_charge' : 'charge',
    amount: Number(c.payment_amount ?? 0),
    creditedAmount: credited.get(c.id) ?? 0,
    lastDigits: c.payment_method_last_digits,
  }));
}

export interface TestChargeRow {
  id: string;
  customerId: number;
  amount: number;
  creditedAmount: number;
  // Present only when SUMIT returned them with the charge. Never rendered.
  cardToken: string | null;
  expMonth: number | null;
  expYear: number | null;
  citizenId: string | null;
}

// Server-side only: what a follow-up charge or credit on one test charge must send.
export async function getTestChargeRow(chargeId: string): Promise<TestChargeRow | null> {
  await requirePlatformPermission('manage_billing');
  const id = z.uuid().parse(chargeId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sumit_test_transactions')
    .select(
      'id, operation, payment_valid_payment, payment_amount, data_customer_id, payment_customer_id, payment_method_token, payment_method_expiration_month, payment_method_expiration_year, payment_method_citizen_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת חיוב הבדיקה נכשלה');
  const customerId = data?.data_customer_id ?? data?.payment_customer_id ?? null;
  if (
    !data ||
    (data.operation !== 'charge' && data.operation !== 'customer_charge') ||
    data.payment_valid_payment !== true ||
    !customerId
  ) {
    return null;
  }
  const { data: credits, error: creditError } = await admin
    .from('sumit_test_transactions')
    .select('payment_amount')
    .eq('parent_id', data.id)
    .eq('operation', 'credit')
    .eq('payment_valid_payment', true);
  if (creditError) throw new Error('טעינת חיוב הבדיקה נכשלה');
  const creditedAmount = (credits ?? []).reduce(
    (sum, c) => sum + Math.abs(Number(c.payment_amount ?? 0)),
    0,
  );
  return {
    id: data.id,
    customerId,
    amount: Number(data.payment_amount ?? 0),
    creditedAmount,
    cardToken: data.payment_method_token,
    expMonth: data.payment_method_expiration_month,
    expYear: data.payment_method_expiration_year,
    citizenId: data.payment_method_citizen_id,
  };
}
```

- [ ] **Step 6: ה-route (`route.ts`)**

הוסף `getTestChargeRow` ל-import מ-`@/lib/data/admin/sumit-test-transactions`, ולפני `export async function POST`:

```ts
// STEP 0 / E2 — charge a SUMIT customer WITHOUT sending any payment method: the body carries
// Customer.ID and nothing else about a card, so SUMIT uses the customer's own saved method. If this
// works, a later charge (an upgrade) needs no card detail stored on our side. The browser posts
// only a row id and an amount; the customer number is read here.
async function handleCustomerCharge(form: FormData): Promise<NextResponse> {
  const chargeId = String(form.get('charge_id') ?? '').trim();
  const amount = String(form.get('amount') ?? '').trim();
  const amt = parseFloat(amount);
  const email = String(form.get('email') ?? '').trim();
  if (!chargeId) return resultPage({ title: 'error', error: 'לא נבחר חיוב קודם של אותו לקוח.' });
  if (!Number.isFinite(amt) || amt <= 0) return resultPage({ title: 'error', error: 'סכום לא תקין.' });

  let row: Awaited<ReturnType<typeof getTestChargeRow>>;
  try {
    row = await getTestChargeRow(chargeId);
  } catch {
    return resultPage({ title: 'error', error: 'טעינת החיוב הקודם נכשלה — לא בוצעה קריאה ל-SUMIT.' });
  }
  if (!row) {
    return resultPage({
      title: 'error',
      error: 'החיוב שנבחר לא תקין (לא הצליח, או שאין לו מספר לקוח SUMIT).',
    });
  }

  return chargeSaveAndRender(
    {
      amount,
      vatRate: '',
      autoCapture: true,
      customerId: row.customerId,
      customerEmail: email || undefined,
      externalId: `poc-customer-${Date.now()}`,
      // No ogToken, no savedCardToken: deliberately NO payment method in the body.
    },
    {
      operation: 'customer_charge',
      parentId: row.id,
      requestAmount: amt,
      requestAutoCapture: true,
      requestCustomerId: row.customerId,
    },
    'הקריאה ל-SUMIT נכשלה (שגיאת תקשורת). ייתכן שהחיוב בוצע למרות זאת — בדקו ב-SUMIT לפני ניסיון נוסף.',
  );
}

// STEP 0 / E5-E6 — credit (refund) part of an earlier test charge: SupportCredit:true and ONE
// negative Items row, on the same customer. `credit_method=customer` sends no payment method (E5);
// `credit_method=token` sends the saved token + expiry + CitizenID of that charge (E6, the path
// `creditHeldCardSumit` uses today). Refuses a credit above what remains of the charge.
async function handleCredit(form: FormData): Promise<NextResponse> {
  const chargeId = String(form.get('charge_id') ?? '').trim();
  const amount = String(form.get('amount') ?? '').trim();
  const amt = parseFloat(amount);
  const method = String(form.get('credit_method') ?? 'customer');
  if (!chargeId) return resultPage({ title: 'error', error: 'לא נבחר חיוב לזיכוי.' });
  if (!Number.isFinite(amt) || amt <= 0) return resultPage({ title: 'error', error: 'סכום לא תקין.' });
  if (method !== 'customer' && method !== 'token') {
    return resultPage({ title: 'error', error: 'שיטת זיכוי לא מוכרת.' });
  }

  let row: Awaited<ReturnType<typeof getTestChargeRow>>;
  try {
    row = await getTestChargeRow(chargeId);
  } catch {
    return resultPage({ title: 'error', error: 'טעינת החיוב נכשלה — לא בוצעה קריאה ל-SUMIT.' });
  }
  if (!row) {
    return resultPage({
      title: 'error',
      error: 'החיוב שנבחר לא תקין (לא הצליח, או שאין לו מספר לקוח SUMIT).',
    });
  }
  const remaining = Math.round((row.amount - row.creditedAmount) * 100) / 100;
  if (amt > remaining) {
    return resultPage({
      title: 'error',
      error: `הסכום גבוה מהיתרה לזיכוי: חויבו ₪${row.amount}, זוכו כבר ₪${row.creditedAmount}, נותרו ₪${remaining}. לא בוצעה קריאה ל-SUMIT.`,
    });
  }
  if (method === 'token' && (!row.cardToken || row.expMonth == null || row.expYear == null || !row.citizenId)) {
    return resultPage({
      title: 'error',
      error: 'לחיוב חסרים טוקן, תוקף או ת״ז — SUMIT לא החזיר אותם. נסו זיכוי על כרטיס הלקוח.',
    });
  }

  return chargeSaveAndRender(
    {
      amount,
      vatRate: '',
      autoCapture: true,
      supportCredit: true,
      lines: [{ name: 'KALFA — בדיקת זיכוי', quantity: 1, unitPrice: -amt }],
      customerId: row.customerId,
      externalId: `poc-credit-${Date.now()}`,
      ...(method === 'token'
        ? {
            savedCardToken: row.cardToken ?? undefined,
            savedCardExpMonth: row.expMonth ?? undefined,
            savedCardExpYear: row.expYear ?? undefined,
            savedCardCitizenId: row.citizenId ?? undefined,
          }
        : {}),
    },
    {
      operation: 'credit',
      parentId: row.id,
      requestAmount: -amt,
      requestAutoCapture: true,
      requestCustomerId: row.customerId,
    },
    'הקריאה ל-SUMIT נכשלה (שגיאת תקשורת). ייתכן שהזיכוי בוצע למרות זאת — בדקו ב-SUMIT לפני ניסיון נוסף.',
  );
}

```

וב-`POST`, החלף את הבדיקה `if (String(form.get('mode') ?? '') === 'capture') { return handleCapture(form); }` ב:

```ts
  const mode = String(form.get('mode') ?? '');
  if (mode === 'capture') return handleCapture(form);
  if (mode === 'customer_charge') return handleCustomerCharge(form);
  if (mode === 'credit') return handleCredit(form);
```

- [ ] **Step 7: הטופס והעמוד**

`page.tsx` — import `listTestCharges` יחד עם `listTestHolds`, `Promise.all` של שלוש הקריאות (`const [chargeableCampaigns, testHolds, testCharges] = …`), והעבר `testCharges={testCharges}` ל-`<SumitTestForm>`.

`sumit-test-form.tsx` — הוסף ל-props: `testCharges = [],` ובטיפוס:

```tsx
  /** Successful charges made on this screen that carry a SUMIT customer number
   *  (Step 0 of the package-payment plan). Labels + row ids ONLY. */
  testCharges?: {
    id: string;
    createdAt: string;
    operation: 'charge' | 'customer_charge';
    amount: number;
    creditedAmount: number;
    lastDigits: string | null;
  }[];
```

ואחרי `</form>` של טופס 3 (לפני `</>`):

```tsx
      {/* FORM 4 — CHARGE A CUSTOMER WITH NO PAYMENT METHOD IN THE REQUEST (Step 0 / E2). Posts only a
          charge row id; route.ts reads the customer number server-side. */}
      <form
        action="/api/admin/sumit-test"
        method="post"
        className={`mt-6 ${formClass}`}
      >
        <FormHeading
          n={4}
          title="חיוב לפי לקוח, בלי אמצעי תשלום בבקשה"
          subtitle="חיוב J4 על מספר הלקוח של חיוב קודם, כשהבקשה לא כוללת טוקן או פרטי כרטיס. בודק אם אפשר לחייב שדרוג בלי לשמור אצלנו שום פרט כרטיס."
        />
        <input type="hidden" name="mode" value="customer_charge" />
        {testCharges.length === 0 ? (
          <p className={hintClass}>
            אין עדיין חיוב מוצלח עם מספר לקוח. בצעו חיוב בטופס 1 (AutoCapture=true) — הוא יופיע כאן.
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="customer_charge_id" className={labelClass}>
                חיוב קודם (מקור מספר הלקוח)
              </label>
              <select id="customer_charge_id" name="charge_id" required className={inputClass}>
                {testCharges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {new Date(c.createdAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
                    {' · '}₪{c.amount}
                    {c.lastDigits ? ` · ⋯${c.lastDigits}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="customer_charge_amount" className={labelClass}>
                סכום (₪)
              </label>
              <input
                id="customer_charge_amount"
                name="amount"
                type="text"
                inputMode="decimal"
                dir="ltr"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="customer_charge_email" className={labelClass}>
                אימייל לקבלה (אופציונלי)
              </label>
              <input
                id="customer_charge_email"
                name="email"
                type="email"
                dir="ltr"
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              חייב את הלקוח
            </button>
          </>
        )}
      </form>

      {/* FORM 5 — CREDIT (REFUND) PART OF AN EARLIER TEST CHARGE (Step 0 / E5-E6). "customer" sends no
          payment method; "token" sends the saved token of that charge (what creditHeldCardSumit does). */}
      <form
        action="/api/admin/sumit-test"
        method="post"
        className={`mt-6 ${formClass}`}
      >
        <FormHeading
          n={5}
          title="זיכוי חיוב בדיקה"
          subtitle="זיכוי מלא או חלקי של חיוב קודם (SupportCredit עם שורה שלילית אחת). הסכום לא יכול לעלות על מה שנותר לזיכוי."
        />
        <input type="hidden" name="mode" value="credit" />
        {testCharges.length === 0 ? (
          <p className={hintClass}>אין עדיין חיוב מוצלח לזיכוי.</p>
        ) : (
          <>
            <div>
              <label htmlFor="credit_charge_id" className={labelClass}>
                חיוב לזיכוי
              </label>
              <select id="credit_charge_id" name="charge_id" required className={inputClass}>
                {testCharges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {new Date(c.createdAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
                    {' · '}₪{c.amount}
                    {c.creditedAmount > 0 ? ` · כבר זוכה ₪${c.creditedAmount}` : ''}
                    {c.lastDigits ? ` · ⋯${c.lastDigits}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="credit_amount" className={labelClass}>
                סכום לזיכוי (₪)
              </label>
              <input
                id="credit_amount"
                name="amount"
                type="text"
                inputMode="decimal"
                dir="ltr"
                required
                className={inputClass}
              />
            </div>
            <fieldset className="space-y-1">
              <legend className={labelClass}>על איזה אמצעי תשלום</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="credit_method" value="customer" defaultChecked />
                כרטיס הלקוח ב-SUMIT (בלי טוקן בבקשה)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="credit_method" value="token" />
                הטוקן השמור של החיוב
              </label>
            </fieldset>
            <button
              type="submit"
              className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              בצע זיכוי
            </button>
          </>
        )}
      </form>
```

(הטפסים לא נבדקו בדפדפן; `tsc` ו-`eslint` עברו על הקוד הזה ב-4.10.)

- [ ] **Step 8: הרץ ווודא הצלחה**

Run: `npx vitest run src/lib/sumit src/app/api/admin/sumit-test` → PASS (הורץ ב-4.10: 12 קבצים, 130 טסטים). `npx tsc --noEmit`, `npx eslint src/lib/sumit src/lib/data/admin/sumit-test-transactions.ts src/app/api/admin/sumit-test "src/app/(admin)/admin/sumit-test"`.

- [ ] **Step 9: בדיקה בדפדפן (הבעלים)** — `/admin/sumit-test` מציג את טפסים 4 ו-5 ("אין עדיין חיוב" כל עוד לא בוצע חיוב), במובייל וב-RTL.

- [ ] **Step 10: הודעת commit מוכנה**

```bash
git add supabase/migrations/*_sumit_test_transactions_operations.sql src/lib/supabase/types.generated.ts src/lib/sumit src/lib/data/admin/sumit-test-transactions.ts src/app/api/admin/sumit-test "src/app/(admin)/admin/sumit-test"
git commit -m "feat(admin): sumit-test — charge by customer with no payment method, and credit experiments (package payment step 0)"
```

---

## שלב 0: ניסויים חיים מול SUMIT (באישור הבעלים לכל ריצה)

**למה:** בטבלת הניסויים אין חיוב J4 ישיר עם טוקן חד-פעמי, חיוב לפי לקוח או זיכוי. (תפיסה J5 עם טוקן חד-פעמי נבדקה ב-1.7, וחיוב על טוקן שמור נבדק חי ב-29.6, ולכן שניהם לא חלק מהשלב.) התשובות קובעות איך מתבצעים רכישה, שדרוג והחזר, ולכן שלב 0 קודם לכל תוכנית כסף. נדרשים E1, E5 ו-E7 (ו-E6 אם E5 נכשל); E2 אופציונלי; E3 ו-E4 לא נדרשים. כל ניסוי הוא על הכרטיס של הבעלים, ₪1 עד ₪2, מ-`/admin/sumit-test`. כל קבלה אמיתית נכנסת לספרים (כמו קבלה 40106) ומדווחת לרו"ח.

| ניסוי | מה עושים | מה מתעדים | מה זה מחליט |
|---|---|---|---|
| **E1** | **נדרש.** טופס 1: כרטיס חדש, סוג עסקה **J4** (`auto_capture=true`; ברירת המחדל בטופס היא J5 ולכן חייבים לבחור), בלי `card_token_not_needed`, עם מסמך, אימייל הבעלים, ₪1 | `ValidPayment`, מסמך; האם נשמרו טוקן, תוקף, ת"ז ו-`CustomerID` (עמודות `payment_method_*` ו-`data_customer_id`). תפיסה J5 כבר החזירה את כולם ב-1.7, והשאלה כאן היא אם גם חיוב J4 מחזיר | האם הרכישה מניבה נתונים לשדרוג עתידי על הטוקן השמור |
| **E2** | **אופציונלי.** טופס 4: הלקוח מ-E1, ₪1, בלי אמצעי תשלום בבקשה | הצלחה או שגיאה והודעתה | הצלחה: אפשר בעתיד לא לשמור טוקן בכלל. כישלון: לא משנה, D3 נשאר כברירת המחדל |
| **E3** | **לא נדרש.** חיוב על טוקן שמור עם `Customer.ID` נבדק חי ב-29.6 (₪4 ו-₪1 חלקי) לפי זיכרון `sumit-charge-verified-behavior`, והקוד שלו (`captureHeldCardSumit`) הוא מה שהשדרוג ישתמש בו | | |
| **E4** | **לא נדרש.** הדגל `CardTokenNotNeeded` פועל בכיוון ההפוך: `true` מונע יצירת טוקן (המפרט החי). הרכישה לא שולחת אותו, כי הטוקן הקבוע הוא מה ששדרוג והחזר צריכים | | |
| **E5** | טופס 5: זיכוי ₪1 מחיוב E1, "כרטיס הלקוח" | הצלחה, מסמך זיכוי, סימן הסכום בתשובה | האם החזר אפשרי בלי טוקן |
| **E6** | (רק אם E5 נכשל) טופס 5: אותו זיכוי עם "הטוקן השמור" | הצלחה או שגיאה | האם `creditHeldCardSumit` תקין כמו שהוא |
| **E7** | טופס 1 עם שורות בעורך השורות הקיים (הוא תומך בערך שלילי; סכום השורות חייב להיות חיובי): שורה חיובית ₪2 ושורה שלילית ₪1 (קרדיט), סוג עסקה J4 | האם המסמך הופק עם שתי שורות ונגבה ₪1 נטו | האם קרדיט ברכישה (D5) יכול להופיע כשורה שלילית |

**מה כבר קיים בטופס 1 ומה מוסיף Task 3 (נבדק בקוד ב-4.10):** בטופס 1 הקיים יש בורר סוג עסקה (J4/J5), תיבת `card_token_not_needed`, שדה אימייל, `prevent_document_creation` ועורך שורות עם ערך שלילי, ולכן E1 ו-E7 ניתנים לביצוע בו. E5 ו-E6 דורשים את טופס 5 מ-Task 3; טופס 4 משרת רק את E2 האופציונלי.

**תוצאות:** נרשמות אוטומטית ב-`sumit_test_transactions`; אחריהן נכתב `docs/superpowers/plans/2026-10-04-package-payment-step0-results.md` עם טבלה של הניסויים, והתוכנית P-B נכתבת על סמכו. עלות מקסימלית נטו: ₪5. אם E1 לא מחזיר טוקן או `CustomerID`, שדרוג דורש הזנת כרטיס מחדש, כמו רכישה.

---

### Task 4: יומן תשלומים וסוגי פעולה של חבילה (מותנה בתשובה "כן" לשאלה)

> **מצב (4.10, אחרי "כן" של הבעלים):** נכתבו הקבצים, **והבעלים הפעיל את שני קבצי המיגרציה ב-4.10 בלי חזרה מקדימה בעסקה מתבטלת** (`db push`, `gen:types` ו-`types:check` עברו; `db advisors --type security` החזיר 46 ממצאים קיימים ואף אחד על האובייקטים החדשים). אומת מול המסד בקריאה בלבד אחרי ההפעלה: שתי הטבלאות עם RLS ובלי policies, ל-`anon` ול-`authenticated` אין select, ל-`service_role` יש הכול; 6 סוגי פעולה (authorize, release, charge, package_purchase, package_upgrade, refund); 3 טריגרים; 9 אינדקסים כולל `once_uq`, `one_pending_uq`, `parent_uq`, `doc_uq` ו-`cancellation_uq`; מפתחות זרים `campaign_id` ו-`event_id` ב-RESTRICT; שתי פונקציות הכספת ל-`service_role` בלבד; שתי הגרסאות רשומות ב-`schema_migrations`; `tsc` על כל הפרויקט נקי. **ההתנהגות נבדקה אחר כך על המסד החי בשתי הרצות של בלוק `DO` שמסתיים בחריגה (כלומר ביטול מלא; אומת אחריו: 0 שורות בטבלה, 0 סודות Vault, מצבי הקמפיינים ללא שינוי):** משתמשי הדפדפן חסומים (42501); דריסת אירוע נגזרת מהקמפיין; רכישה כפולה, חיוב אחרי הצלחה, אותה קבלה פעמיים, אותה בקשת ביטול פעמיים ושחרור כפול נדחים (23505); מעבר אסור, שינוי סוג או שדה נעול אחרי השלמה, ושורה שנסגרה (23514); הורה מקמפיין אחר או שנכשל נדחה; חיוב ורכישה על קמפיין מבוטל נדחים, והחזר ושחרור עליו מותרים; כתיבה וקריאה של ת"ז בכספת עובדות כ-`service_role`. **ממצא:** המסד לא חוסם שדרוג חדש כשיש שדרוג אחר בבדיקה ידנית (`review`), כי `one_pending_uq` סופר רק `pending`. הקוד של השדרוג חייב לסרב (ראו P-D). **נבנו אחרי ההפעלה (קבצים בלבד, לא נפרסו):** `src/lib/payments/card.ts` (טוקן ות"ז בכספת), `ledger.ts` (כתיבה בשני שלבים עם נעילה, השלמה עם compare-and-set, קריאה, `currentCard`), `src/lib/data/payment-orphans.ts` (פעולה תקועה יותר מ-10 דקות עוברת ל-`review` ומתריעה) וחיווטו ב-`queues.ts`, `queue-schedule.ts` ו-`worker/main.ts`, והרחבת `src/test/fake-table-client.ts` (אינדקסים ייחודיים, `single`, `not`, `rows`, `beforeInsert`). 62 בדיקות חדשות; כל הסוויטה (9,792) עברה; `tsc`, `lint` ו-`worker:deps` נקיים. `supabase/migrations/20261004105957_payment_operations_expand.sql` (חולץ בסקריפט מהבלוק של 24.9 Task 1 Step 2, 295 שורות; נבדק רק סטטית: סוגריים וגרשיים מאוזנים, 5 פונקציות, 3 טריגרים, 5 אינדקסים ייחודיים), `supabase/migrations/20261004110000_payment_operation_kinds_package.sql`, `src/lib/payments/status.ts` ו-`status.test.ts` (34 בדיקות: 29 מ-24.9 ועוד 5 של חבילה; נכשלו לפני המימוש ועברו אחריו; `tsc` ו-`eslint` נקיים). נבדק מול המסד החי לפני הכתיבה: `uuid_generate_v7` ו-Vault קיימים, ואין אובייקט `payment_*`. עדיין לא נבנה: `resolvePaymentReview` (הכרעת אדמין בפעולה שב-`review`), וכל מסלולי P-B ואילך.

**Files:**
- Execute as written: Tasks 1 ו-2 של `2026-09-24-campaign-payment-domain-split.md` (טבלאות `payment_operation_kinds` ו-`payment_operations`, הטריגרים, האינדקסים, ה-ACL, ו-`src/lib/payments/status.ts` עם בדיקותיו).
- Create: `supabase/migrations/<ts>_payment_operation_kinds_package.sql`
- Modify: `src/lib/payments/status.test.ts`

**מה נשאר בלי שינוי מתוכנית 24.9:** כל הפירוט של Task 1 (כולל `once_slot`, `parent_slot`, `one_pending_uq`, `guard_update`) ושל Task 2.

**מה לא נעשה כאן, ומה ש-P-B עדיין צריך מ-24.9 (נקרא ב-4.10):** המודול `src/lib/payments/ledger.ts` (`beginOperation`, `completeOperation`, `recordOperation`, `loadOperations`) יושב ב-**Task 5** ולא ב-Tasks 1-2. ב-Task 5 יש גם Step 0 שמרחיב את `src/test/fake-table-client.ts` (אינדקסים ייחודיים), והמודול צורך את `CardDetails` מ-**Task 3** (Vault לפרטי כרטיס). לכן P-B נכנס רק אחרי שהמודול נחתך מ-Task 5 בלי הכתיבה הכפולה לכותבים הישנים; ו-Task 3 (שמירת הטוקן והת"ז ב-Vault) נדרש גם הוא, כי השדרוג מחייב את הטוקן השמור (D3). `card` נשאר NULL רק אם E1 מראה שהחיוב לא מחזיר טוקן. Task 4 (backfill) ו-Task 8 Contract (מחיקת העמודות) לא נדרשים לחבילה. הקוראים (Tasks 6-7) ושומר ההפעלה `campaigns_guard_activate` (Task 8): P-B מחליט אילו מהם נחוצים ומכניס אותם. שני אלה נחוצים בוודאי, כי בלעדיהם פעולה שנתקעה אחרי קריסה נשארת `pending` לנצח: ה-job `payment-orphans` (Task 5 Step 5א, מעביר `pending` ישן מ-10 דקות ל-`review`) ו-`resolvePaymentReview` (Task 7 Step 0א, הכרעה ידנית של אדמין אחרי בדיקה ב-SUMIT).

**Interfaces:**
- Produces: שני סוגי פעולה ברישום: `package_purchase` (`effect='collect'`, `once_per_campaign=true`) ו-`package_upgrade` (`effect='collect'`, ללא מגבלת פעם אחת; אינדקס `one_pending_uq` מבטיח ששדרוג אחד בלבד בתהליך). `refund` כבר ברישום של 24.9 (`effect='return'`).
- Consumes: Tasks 1-2 של 24.9 (טבלאות הסוגים והיומן, `OperationRow`, `deriveStatus`).

- [ ] **Step 1: בצע את Tasks 1 ו-2 של תוכנית 24.9 כפי שהם כתובים שם** (כולל dry-run של הבעלים והפעלה, `gen:types`, `advisors`).

- [ ] **Step 2: צור את מיגרציית הסוגים**

Run: `npx supabase migration new payment_operation_kinds_package`, וכתוב:

```sql
-- Kinds of the fixed-price package (docs/superpowers/plans/2026-10-04-package-payment-plan.md Task 4).
-- A kind is a ROW, not a migration-shaped change: effect drives the derived status, the flags drive
-- the uniqueness indexes (payment_operations_once_uq / payment_operations_one_pending_uq).
--
-- package_purchase  once per campaign — a package is bought once; failed attempts leave the slot.
-- package_upgrade   as many as the campaign needs, but one_pending_uq allows ONE in flight at a time.
-- Refunds use the existing 'refund' kind (effect 'return').
--
-- ROLLBACK: delete from public.payment_operation_kinds where kind in ('package_purchase', 'package_upgrade');
--           (only while no payment_operations row references them)
insert into public.payment_operation_kinds
  (kind, label_he, effect, once_per_campaign, once_per_parent, sort_order) values
  ('package_purchase', 'רכישת חבילה', 'collect', true,  false, 40),
  ('package_upgrade',  'שדרוג חבילה', 'collect', false, false, 45);
```

- [ ] **Step 3: טסטים נוספים ל-`deriveStatus`** (אחרי שהקובץ מתוכנית 24.9 קיים), ב-`src/lib/payments/status.test.ts` בתוך `describe('deriveStatus …')`:

```ts
  it('package purchase succeeded → collected for the package price', () =>
    expect(deriveStatus([op('package_purchase', 'collect', 'succeeded', 120)])).toMatchObject({ status: 'collected', collected: 120 }));
  it('purchase then a successful upgrade → collected sums both', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 120),
      op('package_upgrade', 'collect', 'succeeded', 80, '2026-09-02T00:00:00Z'),
    ])).toMatchObject({ status: 'collected', collected: 200 }));
  it('a FAILED upgrade changes nothing: still collected at the purchase amount', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 120),
      op('package_upgrade', 'collect', 'failed', 80, '2026-09-02T00:00:00Z'),
    ])).toMatchObject({ status: 'collected', collected: 120 }));
  it('an upgrade in flight beats the settled state (money may be moving)', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 120),
      op('package_upgrade', 'collect', 'pending', 80, '2026-09-02T00:00:00Z'),
    ]).status).toBe('pending'));
  it('purchase fully refunded → refunded; collected nets to 0', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 120),
      op('refund', 'return', 'succeeded', 120, '2026-09-02T00:00:00Z'),
    ])).toMatchObject({ status: 'refunded', collected: 0 }));
```

Run: `npx vitest run src/lib/payments/status.test.ts` → PASS. **מה הורץ בפועל (4.10):** חמשת התרחישים נבדקו (עם `tsx`, בסקרצ'פד) מול טקסט `status.ts` שחולץ מ-24.9 Task 2 Step 3: 5/5 עברו. הם לא הורצו ב-vitest, כי `src/lib/payments/status.ts` עדיין לא קיים בעץ. רשימת העמודות ב-`insert` של Step 2 זהה לזו של 24.9 Task 1 (`kind, label_he, effect, once_per_campaign, once_per_parent, sort_order`), והערכים 40 ו-45 לא מתנגשים עם 10/20/30/50.

- [ ] **Step 4: הודעת commit מוכנה**

```bash
git add supabase/migrations/*_payment_operation_kinds_package.sql src/lib/payments/status.test.ts
git commit -m "feat(payments): package_purchase and package_upgrade kinds in the operations ledger"
```

---

## תוכניות נפרדות (נכתבות אחרי שלב 0 ואישור הבעלים; בכל אחת תנאי כניסה, היקף ושער)

**P-B: רכישה.**
*תנאי כניסה:* תוצאות שלב 0; Tasks 2 ו-4 הופעלו; `ledger.ts` מ-24.9 Task 5 קיים בעץ (ראו Task 4); **מגן ה-SQL**: `campaigns_guard_cancel()`, `cancel_campaign()` ו-`test_event_purge_blocker()` קוראים את היומן (בגוף עם `security definer set search_path = ''` מחדש; `create or replace` מאבד תכונות שלא נכתבו) ו-`purge_test_event()` מוחקת שורות יומן של אירוע בדיקה; הטסט של המגן (parity עם גוף המיגרציה, כמו `campaign-status.test.ts`) ירוק. בלי זה אסור שיעבור חיוב אחד.
*היקף:* תיקון `chargeSumit` ב-`charge.ts` (היום קוד מת, ראו "מה כבר קיים") והפיכתו לפונקציית הרכישה, במקום פונקציה חדשה: בלי `VATIncluded`/`VATRate` (החלטה 2.9), גוף שמקיים `satisfies SumitChargeRequestBody` ובלי `CardTokenNotNeeded` (ברירת המחדל היא מה שיוצר את הטוקן הקבוע; טסט מוודא שהשדה לא נשלח), בלוק `Customer` מלא כמו ב-`authorizeHoldSumit` (`ID` מ-`getSumitCustomerId` של המשלם, `Name`, `EmailAddress`, `ExternalIdentifier`), `Items` עם `Item.Name`, `AutoCapture:true` וקבלה במייל; סיווג התשובה עם `sumitStatus()` ו-`Data.Payment.ValidPayment === true` (לא עותק נוסף, ולא נוגעים בעותקים החיים ב-`authorize.ts`/`capture.ts` באותו שינוי); פענוח טוקן, תוקף, ת"ז, `CustomerID` ומסמך לפי `authorizeHoldSumit`; `recordSumitCustomerId` אחרי הצלחה; ביומן נשמר סיכום דרך `safe-preview.ts` ולא גוף גולמי; **מספר הלקוח ב-SUMIT לא נכנס ליומן, ולא לטבלת `profiles`** (הוא מוצג בפרופיל כשדה קריאה בלבד "מספר לקוח", בלי להזכיר את הספק, דרך `readSumitCustomerNumber`; נבנה ב-4.10) (החלטת הבעלים 25.9: נשאר ב-`sumit_customers`, אחד לכל משלם): ברכישה `getSumitCustomerId(payerUserId)` נשלח כ-`Customer.ID` אם קיים, ואחרי הצלחה `recordSumitCustomerId` שומר את `Data.CustomerID` (שניהם קיימים); מזהה המשלם נרשם ב-`meta.payerUserId` של שורת הרכישה, כך ששדרוג והחזר משתמשים במספר הלקוח של מי שהזין את הכרטיס, גם אם חבר אחר בארגון לחץ עליהם; `AbortSignal.timeout(60_000)`; הטסטים הקיימים ב-`charge.test.ts` מתעדכנים; route `/api/campaigns/[id]/purchase` על מבנה route ה-authorize (אימות, דגלים, `beginOperation` לפני הקריאה, `completeOperation` אחריה, `declined`→`failed`, לא ידוע→`review`); הסכום נגזר בצד שרת מ-`campaigns.package_price` פחות קרדיטים, לעולם לא מהלקוח; טופס תשלום מבוסס `CampaignHoldForm` בלי נוסח "תפיסה"; תנאי הפעלה: פונקציית `campaign_payment_ready` ביומן, שימוש ב-`activateCampaign` ובטריגר; מתאושש אם הפעלה נכשלה אחרי תשלום (Review Focus 6); אירוע GA `purchase` בהצלחה; `tax-ceiling.ts` ו-`owner_agent_billing_sums` קוראים סכומים מהיומן (Task 7 של 24.9, החלק הזה בלבד).
*שער:* טסטי route על לחיצה כפולה (בלי קריאה שנייה ל-SUMIT), `review` על תשובה לא ודאית, מגן ביטול; חיוב ראשון אמיתי של ₪1 על האירוע של הבעלים, באישור מפורש.

**P-B, מה נבנה (4.10, ערב; קבצים בלבד, כבוי):**
- `src/lib/payments/package-purchase.ts`: `purchasePackage` (שערים fail-closed; המחיר הוא `campaigns.package_price` מהשרת; שורת `pending` ביומן לפני הקריאה ל-SUMIT; `declined` נסגר כ-`failed` ואפשר לנסות שוב; כל תשובה לא ודאית וחיוב שאושר אך לא נשמר הולכים ל-`review` ולעולם לא לניסיון אוטומטי; כשל בכספת, בעוגן מספר הלקוח או ביומן הפעילות לא מבטל חיוב שאושר) ו-`getPackagePaymentState` (מצב נגזר מהיומן). סדר הבדיקות: שערים, מחיר, **היומן**, מצב הקמפיין ותשלום ישן, קרדיט, נעילה. 55 טסטים מול `fake-table-client` עם האינדקסים הייחודיים האמיתיים.
- `src/app/api/campaigns/[id]/purchase/route.ts`: מעטפת HTTP דקה (מקור, התחברות, בעלות, אירוע פעיל ועתידי, טוקן בלבד מהדפדפן). קודי החזרה ונוסחיהם ב-`package-purchase-errors.ts`, אחד לכל קוד.
- `src/lib/payments/package-payment-screen.ts` + `payment/package-payment-view.tsx` + ענף ב-`payment/page.tsx`: המסך נקבע מהיומן ולא מ-`?paid=1`; קמפיין חבילה לא רואה טופס תפיסה, סיכום תפיסה או "הפעל עכשיו". `CampaignHoldForm` קיבל `purpose` (`hold` כברירת מחדל, בלי שינוי בנוסח).
- **שינוי בקמפיין החבילה במסלול הישן:** `authorize/route.ts` מסרב ל-`package_price != null` לפני הנעילה.
- בדיקה שנעשתה: כלי הבדיקה בניהול (`probePaymentReview`) תומכים ב-`package_purchase` (השורה היא `effect='collect'`), והמטאטא אינו תלוי בסוג.

**סטיות מהתוכנית שדורשות החלטת הבעלים:**
1. **קרדיט (D5):** התוכנית אמרה לנכות קרדיט ברכישה. הניכוי (וסימון הקרדיט כמנוצל) לא נבנה, ולכן לקוח עם קרדיט פתוח **נדחה** (`credit_unsupported`) ולא מחויב במחיר מלא. E7 עדיין לא הורץ.
2. **הפעלה:** התוכנית שייכה את תנאי ההפעלה (`campaign_payment_ready`) ל-P-B. הוא לא נבנה; קמפיין חבילה ששולם נשאר `approved`, ו-`activateCampaign` ממשיך לדרוש `capture_status='authorized'`, ולכן הוא **לא יכול להיות מופעל** עד P-C. זה fail-safe, אבל הלקוח ששילם לא יוכל להפעיל.

**אסור להפעיל את `package_model_enabled` לפני שכל אלה נכונים** (אין כפתור הפעלה בכוונה; מתג האדמין של D9 נבנה רק אחרי שהם מתקיימים):
- מגן ה-SQL (`campaigns_guard_cancel`, `cancel_campaign`, `test_event_purge_blocker`, `purge_test_event` קוראים את היומן): אחרת אפשר לבטל קמפיין ששולם בלי החזר.
- נתיב הפעלה לקמפיין חבילה (P-C: מילוי הרשימה, ואז `campaign_payment_ready`).
- ניסוי E1 חי (שהחיוב מחזיר טוקן ו-`CustomerID`) ושער ה-₪1 של P-B.
- הסכם v6 מאושר על ידי הבעלים ופעיל, ונוסח המסך (`package-purchase-errors.ts`, `FORM_PURPOSE.purchase`, סיכום "פרטי התשלום") עבר סקירת ציות.
- נותרו מחוץ לעץ: אירוע GA `purchase`, `tax-ceiling.ts` ו-`owner_agent_billing_sums` מהיומן, ותווית "מספר הקבלה" ללקוח.

**P-C: מילוי הרשימה בהפעלה, ממתינים והחלפה.**
*תנאי כניסה:* Task 1 הופעל; P-B לפחות ברמת התנאי להפעלה.
*היקף:* פונקציית SQL `fill_authorized_set(p_campaign uuid, p_actor text)` בסמנטיקת החלפה בנעילת שורת הקמפיין: הרשימה מסתיימת באנשי הקשר הכשירים הראשונים לפי המינימום של `guests.seq` עד המכסה, חברים חשופים (`has_service_exposure`) נשארים נעוצים, שורות audit עם `reason='snapshot'`; הקריאה ב-`activateCampaign` לפני המעבר; הוצאת `snapshotAuthorizedSet` ממסלול קמפיין חבילה; רשימת הממתינים (כשירים שאינם ברשימה) לפי `seq`; פעולת החלפה אחת (`repoint`) עם החריג של איש חשוף ומכסה מלאה כבר חי במיגרציה `20261004082517`; מסך אורחים שמציג "בחבילה" ו"ממתין".
*החלטה פתוחה לפני סיום P-C (8.1 בתוכנית המכסה):* האם `dispatchVoicePurposeCall` (שיחות "לפי מטרה": הן לא קשורות לקמפיין, ו-`eventId` שלהן יכול להיות null) נספרות במכסה כשהן פונות לאורח של אירוע. היום הן לא חסומות.
*שער:* מקרי אינטגרציה (מדולגים בלי DB בדיקה) ובדיקת קריאה בלבד על קמפיין בדיקה אחרי ההפעלה.
*תוכנית מימוש מפורטת (4.10, ערב):* `2026-10-04-package-activation-plan.md`. היא משנה שלושה דברים מהנוסח שלמעלה: מילוי בסמנטיקת **השלמה** ולא החלפה (כדי לא לבטל החלפות שהלקוח עשה), מילוי גם באישור התנאים, ותנאי מימון שנקרא ישירות מהיומן ב-TypeScript (`campaign_payment_ready` לא קיימת). הסטיות מחכות להחלטת הבעלים.

**P-D: שדרוג והתראות.**
*היקף:* מד שימוש (`count` על הרשימה מול `contact_quota`); job התראות ב-80% וב-100% לתוך `campaign_quota_alerts` (המפתח הייחודי כבר חי) ושליחת מייל; בחירת חבילה גדולה יותר; חיוב ההפרש (D4) בשורת `package_upgrade` שנפתחת `pending` לפני הקריאה, דרך `captureHeldCardSumit` על הטוקן השמור עם `Customer.ID` (נבדק חי 29.6); פונקציית SQL אידמפוטנטית שמעלה מכסה, רושמת ב-`campaign_quota_changes` (מפתח אידמפוטנטיות = מזהה פעולת היומן) ומקבלת את הממתינים לפי `seq` עד המכסה החדשה; אחרי הכשל בין תשלום לעדכון, ניסיון חוזר עם אותה פעולה משלים.
*חובה בקוד השדרוג (נמדד ב-4.10 על המסד החי):* לסרב כשיש לקמפיין פעולה ב-`review` (`deriveStatus` מחזיר `review`), כי המסד לא חוסם שדרוג חדש מאחורי שדרוג שאולי כבר חויב.
*תנאי כניסה:* P-B, P-C ושלב 0. לא תלוי ב-E2: חיוב על טוקן שמור נבדק חי, ו-E1 קובע אם הרכישה בכלל מניבה טוקן. אם E1 לא מחזיר טוקן, הלקוח מזין כרטיס שוב בשדרוג.

**P-E: ביטול והחזר.**
*היקף:* כלי זיכוי לצוות על סוג `refund` (תוכנית 29.9 `staff-initiated-refund`, מותאמת ליומן); `resolveCancellationRequest` לקמפיין חבילה (החזר מלא או חלקי לפי מדיניות, בלי ענף "לפני חיוב"); הגדרת "תחילת שירות" לפי השליחה הראשונה; פרמטרי דמים ב-`app_settings`; מעקב על תוך 14 יום להחזר.
*שני נתיבי החזר קיימים, ולא נבדק אף אחד מהם עם כסף:* זיכוי דרך נקודת החיוב (`creditHeldCardSumit`, מסומן UNTESTED; E5 ו-E6 בודקים אותו) וביטול מסמך (`/accounting/documents/cancel/`, במפרט בלבד). ביומן נשמר `provider_document_id`, שמאפשר את שניהם.
*תנאי כניסה:* תוצאות E5-E7; **החלטת הבעלים** על סיווג העסקה, גובה הדמים וההחזר על שדרוגים.

**P-F, חלק שנבנה (4.10, ערב; קבצים בלבד, בכפוף לאישור הבעלים "כן"): טופס ניהול החבילות.** `/admin/packages` מציג בורר "מודל התמחור": "חיוב לפי תוצאה" (כמו עד היום) או "חבילה במחיר קבוע עם מכסה". במודל הקבוע מוצג שדה `contact_quota` (חובה, שלם, 1 ומעלה) ונעלמים מה-DOM כל שדות הנוסחה (`price_per_reached`, `base_price`, `included_reached`) והתפיסה (`min_hold_floor`, `hold_buffer_pct`) ואזהרת ה-J5. השרת הוא הסמכות: `operationalFieldsSchema` מסרב למכסה יחד עם כל שדה נוסחה או תפיסה, חבילה עם מכסה נחשבת "קמפיין" (נדרשים ערוץ ולוח פניות, ותבניות הוואטסאפ נבדקות), והפעולות דורשות מחיר חיובי לחבילה כזו. המודל נגזר מנוכחות המכסה בלבד, לא משדה שהדפדפן שולח. `contact_quota` נקרא, נכתב ונרשם ב-`changedFields` של יומן הפעילות. **במכוון לא שונה:** הגדרת "חבילת קמפיין" אצל הלקוח (`listCampaignTemplates`, `getPublicBusinessFacts`, כלי התמחור של הסוכן הקולי, `createCampaign`) עדיין דורשת `price_per_reached`, ולכן חבילה עם מכסה נשמרת אך אינה מוצגת ללקוחות ואינה משפיעה על שום מסלול חי. עדיין חסר ב-P-F: בחירת חבילה בהקמה, `createCampaign(eventId, packageId)`, החלפת ההגדרה בקוראים האלה, מסך "החבילה שלי". אומת: `tsc`, `eslint`, 10,090 טסטים; **לא נבדק בדפדפן** (דורש פריסה).

**P-F, חלק שני שנבנה (4.10, ערב; קבצים בלבד): קטלוג ויצירת קמפיין.** `listPackageOffers()` / `getPackageOffer(id)` ב-`campaigns.ts`: חבילות פעילות עם מכסה ובלי מחיר למושג (חבילה היא מודל אחד או השני), ריקות כל עוד `package_model_enabled` כבוי (בלי קריאה לבסיס). `createCampaign(eventId, packageId?)`: בלי `packageId` הכול בדיוק כמו קודם (התבנית הקנונית); עם `packageId` נדרש שהחבילה תהיה הצעה, ושההסכם **הפעיל** יהיה גרסת החבילה (v6), ואז נשמרים בקמפיין `package_price` ו-`contact_quota` מהחבילה, ו-`price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling` = **0 ולא NULL**: `billed_results.locked_price` הוא NOT NULL ו-`try_record_billed_result` מעתיקה אליו את `price_per_reached`, כך שמחיר NULL היה גורם לכישלון ברישום המושג הראשון; ו-`recordSignedAgreement` דוחה קמפיין עם תנאים חסרים. **התאמת חוזה למודל**: `recordSignedAgreement` דוחה לפני ה-OTP קמפיין חבילה תחת חוזה לפי תוצאה (ולהפך), ו-`approveCampaign` אוכף אותו כשומר אחרון; כך אי אפשר לחתום על תנאים שלא נקנו. `listCampaignTemplates` ו-`resolveCanonicalTemplate` לא שונו. **עדיין חסר ולכן אין דרך ללקוח ליצור קמפיין חבילה:** מסך בחירת חבילה בהקמה שקורא ל-`createCampaign(eventId, packageId)` (היום `setupCampaignAction` קורא בלי `packageId`), טוקני החוזה v6 (`{{packagePrice}}`, `{{contactQuota}}`, P-G) כי `recordSignedAgreement` מעביר ל-v6 רק את שדות הנוסחה, והפעלת הקמפיין (P-C). אומת: `tsc`, `eslint`, 10,109 טסטים.

**P-F, חלק שלישי שנבנה (4.10, ערב; קבצים בלבד): שלב "בחירת חבילה" בהקמה, על ה-stepper הקיים (`@stepperize/react`, שכבר מציג את שלבי ההקמה).** `computeSetupSteps` מקבל `packageOffered` ומוסיף שלב `package` בין "אישור פרטי האירוע" ל"חתימה": הוא קיים כשיש חבילה מוצעת ואין עדיין קמפיין, ונשאר כל עוד הקמפיין הוא קמפיין חבילה; קמפיין לפי תוצאה שכבר בתהליך שומר על חמשת השלבים. בלי חבילה מוצעת (היום: המתג כבוי) הזרימה זהה לחלוטין. `choosePackageAction(eventId, …)` מקבלת רק `package_id` (uuid), קוראת `createCampaign(eventId, packageId)` (שמאמת בעלות, אירוע פתוח ועתידי, שהחבילה הצעה, ושההסכם הפעיל הוא v6), ורושמת `campaign.package_chosen`. **`setupCampaignAction` כבר לא יוצרת קמפיין לפי תוצאה באישור האירוע כשיש חבילה מוצעת** (הבחירה יוצרת אותו), וקטלוג שלא ניתן לקרוא נכשל בהודעה בטוחה ולא נופל חזרה לקמפיין הישן. ה-stepper ממספר לפי מיקום בפועל, בלי חור. כרטיס האירוע (`SetupSteps`) מציג אותה רשימה כמו עמוד ההקמה. הטופס (`package-choice-form.tsx`) שולח רק `package_id`; המחיר והמכסה מוצגים לקריאה בלבד. `formatAmount` הועבר ל-`lib/format.ts`. **עדיין חסר לפני שאפשר להפעיל את המתג:** שלב "תשלום" ו"הפעלה" לקמפיין חבילה ב-`computeSetupSteps` (היום נגזרים מ-`capture_status`, ולכן אחרי רכישה "תשלום" יישאר נוכחי; דורש מצב תשלום מהיומן), P-C והפעלה, טוקני v6 ו-P-G, ונוסח המסך שעובר סקירת ציות. אומת: `tsc`, `eslint`, 10,150 טסטים; לא נבדק בדפדפן.

**החלטות הבעלים (4.10, ערב) ומה נבנה בעקבותיהן:**
- **תנאי הביטול של החבילה = תנאי ההסכם הנוכחי (סעיף 5):** ביטול עד 14 יום, דמי ביטול עד 5% או ₪100 (הנמוך), החזר תוך 14 יום לאמצעי התשלום המקורי, ולאחר תחילת השירות אפשר לחייב על מה שניתן. **"תחילת שירות" = ההודעה או השיחה הראשונה לאורחים** (D10 הוכרע). לא הוכרע עדיין: איך מחשבים "מה שניתן" אחרי תחילת השירות בחבילה במחיר קבוע.
- **חבילה מאושרת באישור תנאים, לא בחתימה** (אין ציור חתימה, אין קוד SMS): הלקוח מסמן שתי תיבות (תנאי השירות ומדיניות הפרטיות). `recordPackageApproval` (agreements.ts) מייצרת PDF של התנאים עם בלוק "אישור תנאי החבילה" (שם, תאריך, IP, גרסה), שומרת שורה ב-`signed_agreements` בלי חתימה ובלי טלפון (כל מה שקורא את הגרסה החתומה, כולל מגן ה-close-charge וייצוא הארכיון, ממשיך לעבוד), מאשרת את הקמפיין, ושולחת ללקוח עותק במייל ("תנאי החבילה אושרו"). הטופס שולח את גרסת התנאים שהוצגה, והשרת דוחה אישור אם הנוסח הפעיל השתנה. `recordSignedAgreement` דוחה קמפיין חבילה.
- **נוסח v6 בקוד** (`pricingClausesPackage` ב-`template.ts`): מחיר אחד ותשלום אחד, מכסת אנשי קשר, ללא תפיסת מסגרת וללא דמי הפעלה או תשלום לפי תוצאות, וסעיף הכרטיס מתאר את מה שהמערכת שומרת בפועל (טוקן, ארבע ספרות, תוקף, ת"ז בכספת; לא מספר מלא ולא CVV). סעיפים 1, 7, 9, 10 מותאמים לאישור במקום חתימה. נשאר להפעלה: ליצור ב-`/admin/agreement` מסמך בגרסה `2026-10-v6` ולאשר אותו (הבעלים).

**P-F: שלב בחירת חבילה בהקמה וקטלוג בניהול.**
*היקף:* שלב "בחירת חבילה" בין "אישור פרטי האירוע" ל"חתימה" ב-`computeSetupSteps` וב-`/setup` (המחיר ננעל ב-`createCampaign`, ולכן הבחירה חייבת להקדים אותו; `setupCampaignAction` מתפצל ל-"פרסום האירוע" ו"יצירת הקמפיין עם החבילה"); `createCampaign(eventId, packageId)` מצלם `package_price` ו-`contact_quota` מהחבילה; הגדרת "חבילת קמפיין" לפי `contact_quota IS NOT NULL` ב-`listCampaignTemplates`, ב-`validation/admin.ts` ובטופס הניהול (שדה מכסה, והסתרת שדות הנוסחה הישנה); מסך "החבילה שלי" ומד השימוש.
*תנאי כניסה:* Task 2 ו-D9 (הדגל).

**P-G: משטחי מחיר והסכם v6.**
*היקף:* ענף שלישי ב-`buildBusinessFacts` (`model: 'package'`); טוקני שאלות נפוצות; `get_pricing` של סוכן המכירות הקולי; ה-primer של סוכן הבעלים; `event-stats.ts`; הרחבת `base-fee-disclosure.test.ts` (ולא מחיקתו) בגילוי החובה של מודל החבילה; `pricingClausesPackage` בתבנית ההסכם, אסימונים `{{packagePrice}}`, `{{packageName}}`, `{{contactQuota}}`, ותיקון "KALFA אינה שומרת את פרטי הכרטיס" בהתאם ל-D3; מתג `package_model_enabled`.
*תנאי כניסה:* ניסוח מאושר בסקירת ציות; **הבעלים מאשר את v6** (ללא אישור עו"ד, החלטת הבעלים 4.10; שאלות 14-18 בקטלוג המשפטי והשפעת תשלום מראש על זכות הביטול נשאלות אותו ישירות, אחת בכל פעם).

**P-H: פרישה, ניקוי אבטחה וסגירה אוטומטית.**
*היקף:* כיבוי מסלול `authorize` וה-hold לקמפיין חבילה והסרת הקוד אחרי תקופת ריצה; הגבלת `sumit-hold-reconcile` לשתי תפיסות היסטוריות; ניקוי ת"ז הלקוח שנשמרה בטקסט גלוי ב-`campaigns` (2 שורות היום) והסרת ההרשאות של `anon`/`authenticated` (נמדד ב-4.10: SELECT, INSERT, UPDATE ו-REFERENCES) על `card_citizen_id` ו-`card_token_ref` (בזהירות: `revoke` על עמודה בלבד הוא no-op כשיש grant ברמת הטבלה, ולכן revoke של הטבלה ו-grant חוזר לעמודות מותרות); job סגירה אוטומטית של קמפיין חבילה אחרי האירוע (היום שום job לא סוגר); עדכון תיעוד וזיכרון.
*תנאי כניסה:* P-B עד P-G חיים לפחות שבוע.

## בדיקה עצמית

**כיסוי החלטות הבעלים.** מחיר קבוע מקטלוג: Task 2 (עמודה), P-F (בחירה). מכסה בהיקף אנשי קשר: חי (מיגרציות 4.10), P-C, P-D. עצירה במכסה: חי (שער שיחות ותבנית, תקרת קבלה). ממתינים וסדר: Task 1, P-C. שדרוג: P-D. תשלום כחיוב: P-B. מילוי בהפעלה: P-C. ביטול והחזר: Task 2 (חסימה), P-E. הפסד פוטנציאלי מהפער בין הנתונים: שלב 0.

**סריקת placeholders.** אין "TBD" או "בהמשך" בתוך Task. Tasks 1 עד 3 כוללים קוד מלא; Task 4 מפנה לתוכנית 24.9 ומציין במפורש מה נשאר בלי שינוי ומה הדלתא. תוכניות P-B עד P-H הן תוכניות נפרדות במכוון, כל אחת עם תנאי כניסה: הן תלויות בתוצאות שלב 0 או בעו"ד, ולכן אין להן קוד כאן.

**עקביות שמות.** `guests.seq`; `contact_quota` (campaigns ו-packages); `package_price` (campaigns בלבד); `PACKAGE_AGREEMENT_VERSION`, `isPackageAgreementVersion`; תוצאת `not_applicable`; סיבת הדילוג `waiting_for_quota` (חי); פעולות הכלי `customer_charge` ו-`credit`; סוגי יומן `package_purchase`, `package_upgrade`, `refund`.

**Review Focus מול טסטים.** 1 (חיוב כפול): Task 2 Step 1, ארבעה טסטים. 2 (ביטול בלי החזר): Task 2 Step 1, טסט נתיב הבקשה; מגן SQL: תנאי כניסה ל-P-B. 3 (סדר ייבוא): Task 1 Step 1, שני טסטים, ו-Step 7. 4 (לחיצה כפולה): P-B ו-P-D. 5 (משטח מחיר): P-G. 6 (שילם ולא הופעל): P-B.

**מה לא אומת:** קבצי ה-SQL (לא הורצו); הטפסים בדפדפן; העובדה ש-RETURNING ו-identity שומרים סדר שורות ב-ייבוא אמיתי של PostgREST (נבדק רק בטסט האינטגרציה המדולג); בדיקות Task 4 (הורצו מול טקסט `status.ts` של 24.9, לא מול קובץ בעץ); שניסוי E1 באמת מחזיר `CustomerID` וטוקן (זה בדיוק מה ששלב 0 בודק); ו-E3 (דורש כלי שעוד לא נכתב).

**מה נקרא ב-4.10 אחרי הכתיבה הראשונה:** `plans/sumit-customer-id-reconciliation.md`, `docs/sumit-response-capture-and-audit.md`, `docs/sumit-request-parameters-audit.json`, `docs/sumit-payments-implementation.md`, `docs/campaign-billing-owner-decision-2026-07-12.md`, `src/lib/sumit/{charge,status,authorize,accounting}.ts`, `src/lib/data/sumit-customers.ts` וזיכרונות SUMIT והחיוב (`sumit-charge-verified-behavior`, `sumit-customer-id-plan-2026-08-27`, `sumit-api-react-packages-evaluated`, `billing-backhalf-workstream`, `pricing-base-overage-model-workstream`, `credits-close-charge-wiring`). **לא נקראו:** `docs/billing-backhalf-2026-06-26.md` ותוכניות `2026-06-26-*` (הן קודמות לתכנון 24.9; נקראו רק דרך הזיכרון).

**אומת מול ה-DB החי דרך ה-MCP של Supabase (4.10, SELECT בלבד; הפרויקט `cklpaxihpyjbhymqtduv` זהה לפרויקט שמקושר ב-CLI):**
- `guests`: 45 שורות, לא בפרסום, טריגר יחיד `trg_guests_updated` (BEFORE UPDATE), אין עמודה `seq` ואין את האינדקסים של Task 1. באירוע הגדול 39 מתוך 43 אורחים חולקים `created_at`.
- `packages.price_with_vat` הוא `numeric(10,2)`; חבילה אחת (200/200/4, מחיר 200); לאף קמפיין או חבילה אין עדיין `contact_quota`.
- `campaigns.package_price`, `payment_operations` ו-`payment_operation_kinds` לא קיימים, והמיגרציה האחרונה היא `20261004082517` (שלב המכסה 3): שום דבר מהתוכנית הזאת לא הופעל.
- `sumit_test_transactions`: כל 16 העמודות ש-Task 3 קורא קיימות, ואילוץ `operation` הוא בדיוק `charge/hold/capture`. אין עדיין חיוב בדיקה מוצלח עם מספר לקוח, ולכן טפסים 4 ו-5 יהיו ריקים עד E1.
- `campaigns_guard_cancel`, `cancel_campaign` ו-`test_event_purge_blocker` קוראים `capture_status`/`charge_status` ואף אחד מהם לא קורא את היומן; `campaigns_guard_activate` לא קיים.
- הדגלים `payments_enabled`, `campaign_holds_enabled`, `close_charge_enabled`, `base_overage_pricing_enabled` ו-`billing_exposure_gate` דולקים; `cancellation_fee_percent`=5, `cancellation_fee_cap`=100, `cancellation_refund_days`=14.
- ל-`campaigns` יש policy אחד, `camp_org_select` (SELECT ל-`authenticated`). ל-`anon` ול-`authenticated` יש הרשאות SELECT, INSERT, UPDATE ו-REFERENCES על `card_citizen_id` ו-`card_token_ref`, ו-2 מתוך 3 הקמפיינים מחזיקים בהם ערך.
- ההחלטה והביקורות של 24.9 מצוטטות מהמסמך (שורות 18 ו-64), לא מה-DB.
