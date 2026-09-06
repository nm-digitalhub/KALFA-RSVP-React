# Runbook — `/admin/webhooks` (בדיקת Webhooks)

> מקור: `src/app/(admin)/admin/webhooks/{page.tsx,webhook-detail.tsx,actions.ts}`,
> `src/lib/data/admin/webhook-inbox.ts`, `src/lib/data/admin/labels.ts`,
> `src/lib/data/webhook-processing.ts`, `worker/main.ts`.
> חוזה-הטבלה: [`webhook-inbox-data-contract.md`](./webhook-inbox-data-contract.md).

## מטרה

מסך אדמין לבדיקת צינור-ה-webhook של Meta: לראות כל אירוע נכנס (הודעות + status
callbacks) כפי שנקלט ב-`webhook_inbox`, את מצב-העיבוד שלו, ולעבד-מחדש שורה תקועה.
**קריאה בלבד + reprocess** — אין כאן שינוי-תצורה (זה ב-`/admin/channels`).

מוגן ב-`requireAdmin()` (יורש מ-layout האדמין + נאכף שוב בכל reader/action).
NAV: "בדיקת Webhooks" תחת תפריט-האדמין (אייקון `Webhook`).

---

## מתי המסך ריק

הרשימה מציגה רק מה ש-**Meta שלחה בפועל**. ריק זה לרוב תקין:

- **אין נתונים עד ש-Meta מוסרת.** האירוע הראשון מופיע רק אחרי שמשתמש-קצה שולח/מקבל
  הודעה והקריאה מגיעה ל-`/api/webhooks/whatsapp`.
- **לנתוני-פרודקשן אמיתיים האפליקציה ב-Meta חייבת להיות PUBLISHED.** אפליקציה לא-מפורסמת
  מקבלת רק קריאות-בדיקה ידניות מה-Meta App Dashboard ("Test" webhook), לא תעבורת-משתמשים
  אמיתית.
- אם המסך ריק *למרות* שאתה מצפה לתעבורה — בדוק את ה-401 ב-`/admin/channels`
  (אי-התאמת App Secret דוחה כל callback לפני שהוא נקלט). ראה
  `plans/whatsapp-webhook-hardening-spec.md §9`.

ה-EmptyState מבחין בין "אין אירועים עדיין" ל"אין תואמים לסינון".

---

## רצועת-בריאות (ראש העמוד)

שלושה מצרפים מ-`getWebhookHealth` (agg על `webhook_inbox`):

- **התקבל לאחרונה** — `received_at` המקסימלי.
- **ממתינים לעיבוד** — `count WHERE processed_at IS NULL` (צהוב אם > 0).
- **נכשלו** — `count WHERE last_error IS NOT NULL` (אדום אם > 0).

---

## תגיות (Badges)

| תגית | מקור | ערכים |
|---|---|---|
| **סוג** (Kind) | `event_kind` (עמודה) | הודעה (`message`) · סטטוס (`status`) |
| **עיבוד** (Process) | **נגזר** ב-`webhookProcessState` — *לא* עמודה | ממתין · עובד · שגיאה |
| **מסירה** (Delivery) | **status rows בלבד**; join של ה-wamid ל-`contact_interactions.delivery_status` | נשלח · נמסר · נקרא · נכשל |

**עיבוד** נגזר מהשורה: `processed_at` → "עובד" (טרמינלי); אחרת `last_error` → "שגיאה"
(נכשל-ומנסה-שוב); אחרת "ממתין".

**מסירה** אינו עמודה ב-`webhook_inbox`. עבור שורת-status, `resolveWebhookAssociations`
מאתרת את ה-wamid ב-`contact_interactions` (batched, שתי שאילתות סה"כ — לא N+1) ומחזירה
את `delivery_status` הנוכחי של ההודעה היוצאת + שם-האירוע (רמז לא-PII). שורת `delivery_status='failed'`
מקבלת פס-צד צהוב; שורת-שגיאת-עיבוד מקבלת פס-צד אדום.

---

## סיווג `wrong_number` שמרני (קוד 131026)

ב-`status` מסוג `failed`, ה-`errors[0].code` הגולמי נשמר תמיד. **רק** קוד `131026`
("Message undeliverable") מסווג כ"מספר שגוי" ומקפיץ `op_status='wrong_number'`; כל קוד
אחר נשאר "כשל מסירה" גנרי (`src/lib/data/webhook-processing.ts`, `WRONG_NUMBER_CODES`).

131026 **לא מושלם** — Meta מאגדת תחתיו כמה סיבות (הנמען לא ב-WhatsApp / גרסת-אפליקציה
ישנה / לא אישר ToS עדכני). אנו מקבלים את העמימות **רק** משום שהקוד הגולמי
(`delivery_error_code`) נשמר תמיד → כל סיווג-שגוי ניתן לביקורת והפיך מתוך ה-inspector,
וה-set ניתן לכוונון אם שיעור ה-false-positive גבוה מדי. (האיתות הוודאי למספר-שגוי מגיע
מ-Voximplant 404, לא מ-WhatsApp.) ב-detail מוצגים גם הקוד הגולמי וגם הסיווג.

---

## עיבוד-מחדש (Reprocess)

כפתור ב-detail (`reprocessWebhookEventAction`, `requireAdmin` + Zod על `id`). הפעולה
מבצעת על השורה:

```
processed_at = null,  last_error = null,  attempts = 0
```

איפוס `attempts` ל-**0** (לא הגדלה) הוא מה שמחזיר את השורה לטווח ה-claim
(`processed_at IS NULL AND attempts < 5`) — כולל **חילוץ שורת dead-letter** שכבר הגיעה
ל-`attempts >= 5` ולא הייתה נאספת אחרת. ה-worker מנקז שוב תוך עד דקה (cron `webhook`,
`* * * * *`).

בטוח להריץ על שורה שכבר עובדה: ה-worker אידמפוטנטי וה-`UNIQUE(channel, provider_id)` על
`contact_interactions` מונע חיוב-כפול. נרשם `logActivity('webhook.reprocess', {webhookId})`
(לא-PII — רק ה-id).

**הודעות ייבוא מוזמנים (CSV / כרטיסי קשר) — מאז 4.9.2026:** ה-importer אידמפוטנטי לפי ה-wamid
(`guest_import_staging.source_message_id`, unique). עיבוד-מחדש של הודעה שכבר הניבה רשימה =
no-op (בלי רשימה כפולה ובלי תשובה נוספת לבעל האירוע). הדיאלוג (AlertDialog, לא
`window.confirm`) אומר זאת במפורש. אם הרשימה נמחקה בינתיים — היא תיווצר מחדש.

---

## מה הפופאפ (detail) מציג — מאז 4.9.2026

| סעיף | תוכן | מקור |
|---|---|---|
| תגיות | סוג אירוע · מצב עיבוד · **"הגיע ללא מספר טלפון (BSUID בלבד)"** כשאין `from`/`wa_id` | `webhook_inbox` + payload |
| סיכום | זמני Meta/קליטה **עם שניות** · סוג · טקסט/כפתור/קובץ/מס' כרטיסי קשר · **איזה מספר עסקי קיבל** (שם מ-`/admin/channels`, לא רק id) · dedupe_key | payload, `app_settings.whatsapp_phone_number_id` |
| זהות השולח/הנמען | טלפון (מוסווה) או "לא נמסר ע"י Meta" · **BSUID** · Parent BSUID · שם פרופיל · username | `from`/`recipient_id`, `from_user_id`/`recipient_user_id`, `sender_contact`/`recipient_contact` |
| מסירה (סטטוס) | סטטוס · קוד + **תיאור** השגיאה · **תמחור Meta** (billable/category/type) · לאיזה אירוע שייכת ההודעה היוצאת | payload, `contact_interactions` (out) |
| **תוצאה — מה המערכת עשתה** (הודעה) | אירוע + סטטוסו · סטטוס קמפיין · סיווג billable · **חיוב בפועל** (`billed_results` / `billing_outcome` עם הסבר) · הסרה · **ייבוא מוזמנים** (רשימה שנקלטה, כמה שורות, סטטוס) | `contact_interactions.billing_outcome`, `billed_results.provider_ref`, `guest_import_staging.source_message_id` |
| עיבוד | ניסיונות · זמן · שגיאה · wamid/context | `webhook_inbox` |
| האירוע כפי שנשמר (מנורמל) | עץ JSON (`react-json-view-lite`), reveal-gated | `webhook_inbox.payload` |
| **מה ש-Meta שלחה בפועל** | המעטפה המלאה + גודל + זמן קליטה; "לא נשמרה" לשורות מלפני 3.9.2026 | `webhook_deliveries` דרך `delivery_id` |

הפרשנות של "חיוב בפועל": `billed` = נוצרה שורת `billed_results`; כל ערך אחר = ה-RPC סירב והסיבה
מוצגת (קמפיין לא פעיל, לא ברשימת הנמענים, כבר חויב, …). `billable=true` בלי `billing_outcome`
= שורה שעובדה לפני 4.9.2026.

---

## PII ואיסור-לוגינג

- `payload` גולמי מכיל טלפונים/שמות. מוצג רק ב-detail; טלפון מאחורי `PhoneReveal`
  (reveal-gated). **אסור ללוגג** payload / dedupe_key / message_id / טלפון בשום מקום.
- חיפוש (`q`) תואם **מזהים-טכניים בלבד** — `message_id` / `context_message_id` /
  `phone_number_id` — לעולם לא טלפון של אורח.

---

## ה-worker וחיבור-ה-DB (תפעול)

תהליך pm2 `kalfa-worker` (`worker/main.ts`) מריץ pg-boss; ה-queue `webhook` קורא
`claim_webhook_events` ומעביר כל שורה ל-`processWebhookEvent`. תזמון: כל דקה (`* * * * *`).

חיבור-ה-DB של ה-worker עובר דרך ה-**Session Pooler** (לא ה-host הישיר):

```
host = aws-1-ap-south-1.pooler.supabase.com
port = 5432
user = postgres.<project-ref>        # למשל postgres.cklpaxihpyjbhymqtduv
```

ה-host הישיר של Supabase חושף רק AAAA/IPv6 ואינו נגיש מסביבת-ה-worker — לכן ה-pooler
הוא החובה, לא העדפה (`docs/schema-and-architecture.md §4`). הערכים מוגדרים ב-`.env.local`
(`SUPABASE_DB_HOST/PORT/USER/PASSWORD`); הסיסמה היא סוד — לא ללוגג.
