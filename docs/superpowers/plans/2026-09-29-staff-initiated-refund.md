# זיכוי ביוזמת צוות — תוכנית

**סטטוס:** טיוטה לאישור (29.9.2026). שום דבר מהמסמך עוד לא מיושם.
**העובדות נמדדו בקוד ובמסד החי ב-29.9.2026.**

## המטרה

לאפשר לאיש צוות מורשה להחזיר ללקוח כסף שחויב בפועל — מלא או חלקי, מכל סיבה (טעות בחיוב, פיצוי, שירות שלא סופק) — בלי שהלקוח יצטרך לפתוח בקשת ביטול, ובלי שאפשר יהיה לזכות יותר ממה שחויב.

## המצב היום

- **הפונקציה קיימת:** `creditHeldCardSumit` (`src/lib/sumit/capture.ts`). `POST` ל-`https://api.sumit.co.il/billing/payments/charge/` עם `SupportCredit: true` ושורה בסכום שלילי, על הטוקן השמור של הכרטיס. SUMIT מפיק תעודת זיכוי ושולח אותה במייל. מ-29.9 היא לא שולחת `VATIncluded`/`VATRate` (החלטת הבעלים 2.9).
- **מסלול אחד בלבד מפעיל אותה:** טיפול בבקשת ביטול של לקוח (`resolveCancellationRequest`, `src/lib/data/event-cancellation.ts`), בהרשאת `manage_billing`. אחרי זיכוי הוא מעדכן את `campaigns.final_charge_amount` לסכום נטו, ורושם את מספר מסמך הזיכוי על בקשת הביטול.
- **הזיכוי מעולם לא נשלח ל-SUMIT.** ההערה בקוד: "UNTESTED against the live SUMIT API". גם החיוב הסופי עצמו עוד לא בוצע אף פעם על כסף אמיתי (שלושת הקמפיינים נסגרו על ₪0).
- **פערים בפונקציה:**
  - לא שולחת `Customer.ID` (החיוב כן שולח `campaigns.sumit_customer_id`), כך שתעודת הזיכוי עלולה להירשם על לקוח כפול ב-SUMIT.
  - שם השורה קבוע: "KALFA — זיכוי ביטול אירוע", גם כשהזיכוי אינו ביטול.
- **אין תיעוד לזיכויים:** אין טבלה שרושמת כל זיכוי. מה שנשאר הוא רק `final_charge_amount` אחרי ההפחתה, כך שאי אפשר לדעת כמה זיכויים היו, מתי, על ידי מי ולמה.
- **בדף הקמפיין:** בקמפיין שחויב אין שום פעולת כסף לאיש צוות. (הכפתור "ביטול קמפיין", שהופיע ונכשל תמיד, הוסר ב-29.9.)

## ההחלטות המוצעות

1. **זיכוי הוא פעולה נפרדת מביטול.** הוא לא משנה את סטטוס הקמפיין או האירוע, ולא משנה את `charge_status` (החיוב נשאר עובדה היסטורית, כמו במסלול הביטול).
2. **הרשאה ייעודית:** `billing.refund`, משויכת בהתחלה לתפקיד הבעלים בלבד. לא `manage_billing` — זיכוי הוא הוצאת כסף, ורוב מחזיקי `manage_billing` לא צריכים אותה.
3. **תקרה:** סכום הזיכוי חייב להיות > 0 ולא יותר מ-`final_charge_amount` הנוכחי (הסכום נטו אחרי זיכויים קודמים). נבדק בתוך פונקציה במסד, תחת נעילת שורת הקמפיין — לא בקוד האפליקציה.
4. **סיבה חובה**, מתוך רשימה סגורה + הערה חופשית: טעות בחיוב, פיצוי ללקוח, שירות שלא סופק, אחר.
5. **כל זיכוי נרשם כשורה**, עם מצב (`pending` → `succeeded` / `failed` / `review`), סכום, סיבה, מי ביצע, ומספר מסמך הזיכוי מ-SUMIT.
6. **לעולם לא לזכות פעמיים באותה בקשה.** אם SUMIT לא החזיר תשובה חד-משמעית (נפילת רשת אחרי שליחה), השורה עוברת ל-`review` ולא לניסיון חוזר אוטומטי. בודקים ב-SUMIT ידנית.
7. **מסלול הביטול משתמש באותו מנגנון.** `resolveCancellationRequest` יקרא לאותה פונקציה, כך שגם זיכויי ביטול נרשמים ונבדקים מול התקרה.

## החלטה פתוחה לבעלים: איפה נרשמת שורת הזיכוי

תוכנית `2026-09-24-campaign-payment-domain-split` כבר מגדירה את `payment_operations` עם סוג פעולה `refund` (effect `return`, מקושר לחיוב, מצבים `pending|succeeded|failed|review`). היא עוד לא מיושמת.

**ההמלצה:** טבלה קטנה עכשיו, `campaign_refunds`, עם **אותו אוצר מילים של מצבים** כמו ב-`payment_operations`. כשתוכנית 24.9 תגיע למשימה 4 (backfill), כל שורה תעבור אחד-לאחד לשורת `refund` ביומן, והטבלה תימחק במשימה 8. כך הזיכוי זמין עכשיו בלי לחכות לכל תשע המשימות, ובלי לבנות מודל מתחרה.

החלופה: לבנות קודם את משימה 1 של תוכנית 24.9 (הטבלאות, Vault, הטריגרים) ולרשום את הזיכוי ישר ביומן. נכון יותר לטווח ארוך, אבל גדול בהרבה.

## שינויי מסד (מיגרציה אחת)

### 1. `campaign_refunds`

| עמודה | סוג | הערה |
|---|---|---|
| `id` | uuid PK | |
| `campaign_id` | uuid FK → `campaigns` **on delete restrict** | זיכוי הוא רישום כספי |
| `event_id` | uuid | בלי FK, להיסטוריה |
| `amount` | numeric, `check (amount > 0)` | |
| `reason` | text, `check (reason in (...))` | |
| `note` | text | |
| `outcome` | text, `check (outcome in ('pending','succeeded','failed','review'))` | |
| `requested_by` | uuid not null | איש הצוות |
| `source` | text, `check (source in ('staff','cancellation_request'))` | |
| `cancellation_request_id` | uuid null | כשהמקור הוא בקשת ביטול |
| `sumit_document_id`, `sumit_document_number`, `sumit_document_url`, `sumit_payment_id`, `sumit_auth_number` | | מהתשובה של SUMIT |
| `error` | text | הודעה בטוחה בלבד, בלי פרטי ספק גולמיים |
| `created_at`, `completed_at` | timestamptz | |

- אינדקס ייחודי חלקי: **זיכוי `pending` אחד לכל קמפיין** (`unique (campaign_id) where outcome = 'pending'`).
- RLS דלוק, בלי policies, בלי הרשאות ל-`anon`/`authenticated`.

### 2. פונקציות (SECURITY DEFINER, `search_path = ''`, רק `service_role`)

- **`begin_campaign_refund(p_campaign, p_amount, p_reason, p_note, p_actor, p_source, p_request)`:** נועלת את שורת הקמפיין; בודקת `charge_status = 'charged'`, שהמבצע ב-`platform_staff`, שאין זיכוי `pending`, ושה-`amount` ≤ `final_charge_amount` פחות זיכויים ב-`review`; מוסיפה שורה `pending` ומחזירה את המזהה. אחרת מחזירה סיבה (`not_charged`, `exceeds_refundable`, `refund_in_progress`, `not_staff`).
- **`complete_campaign_refund(p_refund, p_outcome, p_document..., p_error)`:** נועלת את שורת הקמפיין ואת שורת הזיכוי; מותר רק `pending` → `succeeded`/`failed`/`review`. ב-`succeeded` מפחיתה את `final_charge_amount` באותה טרנזקציה.
- **`resolve_campaign_refund_review(p_refund, p_outcome, p_actor)`:** איש צוות סוגר `review` ל-`succeeded` (נמצא ב-SUMIT) או ל-`failed` (לא נמצא).

### 3. הרשאה

`billing.refund` ב-`platform_permission_definitions`, משויכת לתפקיד `is_owner_role`.

## שינויי קוד

- **`src/lib/sumit/capture.ts` — `creditHeldCardSumit`:**
  - שולחת `Customer.ID` כשידוע (כמו החיוב).
  - שם שורה ותיאור לפי הסיבה, במקום "זיכוי ביטול אירוע" קבוע.
- **`src/lib/data/refunds.ts` (`server-only`) — `refundCampaignCharge`:** המנגנון היחיד לזיכוי.
  1. `rpc('begin_campaign_refund')`.
  2. `creditHeldCardSumit`.
  3. `rpc('complete_campaign_refund')`: `succeeded` עם פרטי המסמך; `failed` על דחייה ברורה (`SumitDeclinedError`); `review` על תשובה לא ודאית (`SumitNetworkError`).
  4. רישום ב-`activity_log` והתראת Slack (בלי פרטים אישיים).
- **`src/lib/data/admin/refunds.ts`:** `requirePlatformPermission('billing.refund')`, אימות Zod (מזהה, סכום עד אגורות, סיבה מהרשימה), ואז `refundCampaignCharge`. גם קריאת היסטוריית הזיכויים של קמפיין.
- **`resolveCancellationRequest`:** קורא ל-`refundCampaignCharge` במקום ל-`creditHeldCardSumit` ישירות, עם `source = 'cancellation_request'`. ההתנהגות מול הלקוח לא משתנה.
- **דף הקמפיין (`manage-client.tsx`):** בחלק "פעולות מנהל", למחזיק `billing.refund`, כשהקמפיין `charged` ו-`final_charge_amount > 0`:
  - "זיכוי ללקוח": סכום (ברירת מחדל: היתרה), סיבה, הערה, ואישור בתוך הדף שמציג את הסכום ואת שם הלקוח. (4 הספרות האחרונות של הכרטיס לא נשמרות אצלנו — נמדד 29.9.)
  - רשימת הזיכויים הקודמים עם קישור לתעודת הזיכוי.
  - זיכוי במצב `review` מוצג עם הנחיה לבדוק ב-SUMIT וכפתורי סגירה.

## השפעות

- **תקרת העוסק הפטור (`tax-ceiling.ts`):** מסכמת את `final_charge_amount` של השנה, והוא נטו אחרי זיכוי — נשאר נכון. חריג: זיכוי בשנה קלנדרית אחרת מהחיוב יוריד את הסכום של השנה הקודמת. מסומן לבדיקה של `israeli-tax-advisor`.
- **דוחות / סוכן הבעלים:** כל מה שקורא `final_charge_amount` יראה נטו, כמו היום אחרי זיכוי ביטול.
- **המייל ללקוח:** SUMIT שולח את תעודת הזיכוי. אין מייל נוסף שלנו בגרסה הראשונה.

## אימות

1. **הרצה ניסיונית במסד בתוך `BEGIN … ROLLBACK`:** זיכוי מעל היתרה נדחה; שני זיכויים במקביל — אחד נדחה (`refund_in_progress`); `succeeded` מפחית את `final_charge_amount`; מעבר אסור (למשל `succeeded` → `failed`) נחסם; `authenticated` בלי גישה לטבלה ולפונקציות.
2. **בדיקות יחידה:** גוף הבקשה ל-SUMIT (`Customer.ID`, בלי שדות מע"מ, `SupportCredit`, סכום שלילי); מיפוי דחייה → `failed`, שגיאת רשת → `review`; סירוב בלי `billing.refund`; מסלול הביטול עובר דרך `refundCampaignCharge`.
3. **`lint`, `tsc`, `build`, `gen:types`, `types:check`.**
4. **בדפדפן/בטלפון:** הכפתור מופיע רק בקמפיין שחויב ורק עם ההרשאה.
5. **בדיקה חיה אחת מול SUMIT — מזיזה כסף אמיתי, רק באישור מפורש של הבעלים:** חיוב ₪1 על הכרטיס של הבעלים באירוע בדיקה, ואז זיכוי ₪1. בודקים: תעודת זיכוי נוצרה על אותו לקוח ב-SUMIT, הכסף חזר, ושורת הזיכוי `succeeded`. עד לבדיקה הזו הכפתור מאחורי דגל כבוי ב-`app_settings`.

## גבולות

- זיכוי אפשרי רק כשיש טוקן כרטיס שמור. בלעדיו — אותו מצב כמו היום: "נדרש זיכוי ידני ב-SUMIT", שנרשם כשורה `failed` עם ההסבר.
- לא מטפל בזיכוי תפיסת מסגרת (J5). מסגרת לא מחייבת כסף, ולכן אין מה לזכות; שחרור מסגרת נעשה בלוח הבקרה של SUMIT.

## החזרה לאחור

כיבוי הדגל ב-`app_settings` מסתיר את הפעולה מיד. המיגרציה: `drop function` לשלוש הפונקציות ו-`drop table campaign_refunds` — רק אם לא נרשם בה אף זיכוי אמיתי. אחרי זיכוי אמיתי הטבלה נשארת (רישום כספי).
