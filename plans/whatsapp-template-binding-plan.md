# קשירת פרמטרים לתבניות WhatsApp בזמן שליחה — תוכנית מימוש

תאריך: 2026-07-02. המשך ישיר של `docs/whatsapp-templates-meta-submission.md`
(סוגר את פערים 1, 3, 4 שם; פער 2 — celebrants — ממומש במקביל).

## מצב מאומת (עובדות, לא הנחות)

- **כל 8 התבניות APPROVED** ב־Meta (Graph API, 2026-07-02).
  `kalfa_event_invite_v1` סווגה מחדש ל־MARKETING; השאר UTILITY.
- `message_templates` בחי: 4 שורות whatsapp (invite/reminder_1/reminder_2/final)
  מצביעות על השמות הגנריים, `active=false`, `components=NULL`; שורת call_1;
  **אין שורות wedding** (בכוונה — הווריאנט ייבחר דרך mapping, לא שורה נפרדת).
- `sendWhatsAppTemplate` (src/lib/whatsapp/client.ts:24) שולח תבנית חשופה —
  אין components; אין לו שום הקשר אירוע/מוזמן.
- `getTemplateByKey` (src/lib/data/message-templates.ts) בוחר רק
  `name, language, channel` — לא את `components`.
- מנוע השליחה קורא מהאירוע רק `event_date, status`
  (getCampaignContext, outreach-engine.ts:100) — אין name/event_type/venue/celebrants.
- `contacts` **ללא עמודת שם** (רק phone/consent/op_status); שמות ב־
  `guests.full_name` (NOT NULL), קישור דרך `guests.contact_id → contacts.id`
  (nullable; ייתכנו כמה guests לאותו contact — משפחה על טלפון אחד).
- `assertEventNotPast` מקבל `event_date: string | null` — null עובר היום
  (אין דרישת תאריך בהפעלת קמפיין).
- צורות celebrants מאושרות: זוג `{groom,bride}` (חתונה/חינה/אירוסין),
  יחיד `{name}` (בר/בת מצווה, יום הולדת), הורים `{parents,child?}` (ברית/בריתה),
  חופשי `{names}` (אחר). שער שלמות ב־createCampaign — בביצוע (wf_1981dd7f).

## חוזה הפרמטרים (קבוע, כפי שהוגש ל־Meta)

| # | משפחה גנרית (kalfa_event_*) | משפחת חתונה (kalfa_wedding_*) |
|---|---|---|
| {{1}} | שם פרטי של המוזמן | שם פרטי של המוזמן |
| {{2}} | EVENT_TYPE_LABELS[event_type] | שם מלא של החתן (celebrants.groom) |
| {{3}} | טקסט שמות בעלי השמחה | שם מלא של הכלה (celebrants.bride) |
| {{4}} | יום בשבוע (עברית, Asia/Jerusalem) | כנ"ל |
| {{5}} | תאריך | כנ"ל |
| {{6}} | שעה | כנ"ל |
| {{7}} | venue_name + ", " + venue_address | כנ"ל |

טקסט {{3}} גנרי לפי צורה: זוג → "X ו־Y"; יחיד → השם; הורים → "ההורים"
(+" — לכבוד "+child אם מולא); חופשי → כמו שהוזן.

## עיצוב

1. **`src/lib/whatsapp/template-spec.ts` (חדש)** — המודול שהובטח בהערת
   migration 202606300037. פונקציות טהורות (ניתנות לבדיקת יחידה מלאה):
   - `buildTemplateParams(family, ctx)` → `string[]` של {{1}}..{{7}} או
     `{ missing: string[] }` (fail-closed: אף פרמטר ריק לא נשלח ל־Meta).
   - `ctx` = `{ event: Pick<Row,'name'|'event_type'|'event_date'|'venue_name'|'venue_address'|'celebrants'>, guestFirstName: string | null }`.
   - נגזרות תאריך: `Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', ... })`
     — בלי תלות חדשה. celebrants נקרא הגנתית (Json|null) דרך הכלים של
     schemas.ts (`CELEBRANT_KIND_BY_EVENT_TYPE`/`celebrantsCompleteFor`) — לא שכפול.
   - fallback {{1}} כשאין שם guest: "אורחים יקרים" (החלטה: עדיף גנרי מנפילה).
2. **בחירת וריאנט חתונה — data-driven דרך `components` jsonb** (לא בקוד):
   על כל שורה גנרית: `{"variants": {"wedding": "kalfa_wedding_invite_v1"}}`.
   `resolveTemplateForEvent(messageKey, eventType)` חדש ב־message-templates.ts:
   מרחיב את ה־select גם ל־`components`, ואם `components.variants[event_type]`
   קיים — מחליף את ה־name (language/channel מהשורה). ללא mapping → גנרי.
   fail-closed נשמר. (עדכון ה־jsonb בחי = שינוי דאטה — **טעון אישור** לפני ביצוע;
   יבוצע ב־SQL חד־פעמי או דרך /admin/templates.)
3. **חיווט המנוע:**
   - getCampaignContext: הרחבת select של events ל־
     `name, event_type, venue_name, venue_address, celebrants` (+הטיפוס).
   - executeStep: שליפת שם guest — `guests.select('full_name').eq('event_id',...).eq('contact_id',...)`
     order by created_at asc limit 1 (דטרמיניסטי במשפחה על טלפון אחד);
     שם פרטי = הטוקן הראשון של full_name.
   - `sendWhatsAppTemplate` מקבל `bodyParams?: string[]` ובונה
     BodyComponent/BodyParameter של whatsapp-api-js (לאמת מול הגרסה המותקנת).
   - פרמטרים חסרים → דילוג + רישום ב־`outreach_template_failures` עם
     `reason='params_incomplete'` (עמודת text — אין CHECK; אותו upsert אטומי).
   - אותו חיווט גם במסלול הידני `sendCampaignWhatsApp` (outreach.ts).
4. **הקשחת שער הקמפיין (הצעה, החלטה פתוחה):** לחייב גם `event_date` ו־
   `venue_name` ב־createCampaign (היום null עובר) — בלעדיהם {{4}}–{{7}} ריקים
   וכל השליחות ידלגו. שגיאה עברית ייעודית. חלופה: להשאיר רק fail-closed בשליחה.

## סיכונים

- **MARKETING על ההזמנה הגנרית** — תמחור + הסכמה שיווקית (ר' עדכון במסמך
  ההגשה; לא חוסם את הקשירה, חוסם הפעלה של invite הגנרי בלי החלטה).
- ריבוי guests לאותו contact — נפתר בבחירה דטרמיניסטית (הוותיק ביותר).
- אזור זמן — כל הנגזרות דרך Asia/Jerusalem בלבד; בדיקות על קצוות (חצות, שעון קיץ).
- אין לגעת ב־billing/holds — הקשירה נוגעת רק בשכבת ההודעות.

## סדר ביצוע (אחרי נחיתת workflow ה־celebrants — להימנע מהתנגשויות tsc)

1. template-spec.ts + בדיקות יחידה מלאות (משפחות × סוגים × מטריצת חוסרים × תאריכים).
2. resolveTemplateForEvent + בדיקות (וריאנט קיים/חסר/לא־פעיל).
3. client bodyParams + חיווט engine/outreach + בדיקות (כולל params_incomplete sink).
4. אימות מלא: lint, tsc, vitest, build.
5. **באישור המשתמש:** עדכון components.variants בחי; הפעלת תבניות ב־/admin/templates;
   שליחת בדיקה אמיתית למספר בדיקה (הודעה אמיתית — אישור מפורש בלבד).
