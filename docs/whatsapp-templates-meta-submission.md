# תבניות WhatsApp — הגשה לאישור Meta (2026-07-02)

8 תבניות הוגשו ל־WABA (Graph v23.0, `POST /{waba_id}/message_templates`) —
סטטוס בעת ההגשה: **PENDING**, קטגוריה UTILITY (`allow_category_change=true`,
כך ש־Meta רשאית לסווג מחדש ל־MARKETING).

## שתי משפחות × 4 שלבי outreach

שלבי ה־outreach ממופים 1:1 ל־`message_key` שהמנוע פותר
(`getTemplateByKey`): `invite` / `reminder_1` / `reminder_2` / `final`.

| message_key | משפחה גנרית (name ב־DB) | וריאנט חתונה (טרם מחווט) |
|---|---|---|
| invite | `kalfa_event_invite_v1` | `kalfa_wedding_invite_v1` |
| reminder_1 | `kalfa_event_reminder_v1` | `kalfa_wedding_reminder_v1` |
| reminder_2 | `kalfa_event_reminder2_v1` | `kalfa_wedding_reminder2_v1` |
| final | `kalfa_event_final_v1` | `kalfa_wedding_final_v1` |

`message_templates.name` עודכן לשמות המשפחה **הגנרית** (עובדת לכל 9 סוגי
האירועים). כל השורות נשארו `active=false` (fail-closed) — הפעלה רק אחרי
אישור Meta, דרך `/admin/templates`.

## חוזה הפרמטרים (POSITIONAL, שפה `he`)

| # | משפחה גנרית | משפחת חתונה |
|---|---|---|
| {{1}} | שם פרטי של המוזמן | שם פרטי של המוזמן |
| {{2}} | תווית סוג האירוע (עברית, מ־`EVENT_TYPE_LABELS`) | שם מלא של החתן |
| {{3}} | שמות בעלי השמחה | שם מלא של הכלה |
| {{4}} | יום בשבוע | יום בשבוע |
| {{5}} | תאריך | תאריך |
| {{6}} | שעה | שעה |
| {{7}} | מיקום (venue_name + venue_address) | מיקום |

כפתורי QUICK_REPLY בכל תבנית (ללא אמוג'י — מגבלת Meta, error 2388060):
`מגיע/ה` / `לא מגיע/ה` / `אולי` — תואמים ל־RSVP statuses
(`attending`/`declined`/`maybe`) שה־webhook הנכנס פותר.

## פערים שנותרו לפני שליחה אמיתית (חובה לממש)

1. **קשירת פרמטרים בזמן שליחה:** `sendWhatsAppTemplate`
   (`src/lib/whatsapp/client.ts`) שולח היום תבנית *חשופה* —
   `new Template(name, new Language(lang))` בלי components. יש לממש בניית
   body parameters מ־context השליחה (אירוע + מוזמן) לפי החוזה למעלה.
   עמודת `message_templates.components` (jsonb, migration 202606300037)
   נועדה לזה; ה־spec המוזכר שם (`src/lib/whatsapp/template-spec.ts`)
   **טרם נכתב**.
2. **נתוני בעלי שמחה:** לטבלת `events` אין שדות מובנים לחתן/כלה/חתן־בר־מצווה
   וכו' — רק `name` חופשי. נדרשת החלטת מוצר: שדות ייעודיים (מומלץ —
   `celebrant_*`) או גזירה משם האירוע. בלי זה אין ערך אמין ל־{{2}}/{{3}}.
3. **בחירת וריאנט חתונה:** לוגיקת send שבוחרת `kalfa_wedding_*` כאשר
   `event_type='wedding'`, אחרת `kalfa_event_*`. מנגנון מוצע: mapping
   ב־`components` jsonb או עמודה ייעודית — יוחלט עם מימוש (1).
4. **ערכי הפרמטרים:** יום/תאריך/שעה נגזרים מ־`events.event_date`
   (timestamptz, אזור זמן ישראל); מיקום מ־`venue_name`+`venue_address`;
   תווית סוג האירוע מ־`EVENT_TYPE_LABELS` (`src/lib/data/event-labels.ts`).

## מזהי ההגשה (למעקב סטטוס)

kalfa_wedding_invite_v1=2242454863237927, kalfa_wedding_reminder_v1=1404309351521855,
kalfa_wedding_reminder2_v1=2907749902907737, kalfa_wedding_final_v1=1621710799957102,
kalfa_event_invite_v1=2084768359589084, kalfa_event_reminder_v1=1540017484257696,
kalfa_event_reminder2_v1=2706423303091390, kalfa_event_final_v1=1014417967839590.

בדיקת סטטוס: `GET /{waba_id}/message_templates?fields=name,status,category`
(או ב־WhatsApp Manager). עדכוני סטטוס מגיעים גם ב־webhook
`message_template_status_update` אם מנוי.

## סטטוס אישור (נבדק 2026-07-02, Graph API)

**כל 8 התבניות אושרו (APPROVED).** אבל Meta מימשה את
`allow_category_change` על אחת:

| תבנית | קטגוריה בפועל |
|---|---|
| kalfa_event_invite_v1 | **MARKETING** (סווגה מחדש!) |
| 7 האחרות (כולל kalfa_wedding_invite_v1) | UTILITY |

השלכות הסיווג MARKETING של הזמנת האירוע הגנרית: תמחור Meta שונה,
ודרישת הסכמה שיווקית מפורשת (CLAUDE.md). אפשרויות: (א) להסתמך על
`whatsapp_consent_at` הקיים שנרשם בייבוא; (ב) להגיש `kalfa_event_invite_v2`
בניסוח Utility מובהק יותר (בקשת אישור הגעה פר־מוזמן, בלי שיווק).

**בוצע (2026-07-03): הוגשה `kalfa_event_invite_v2`** — מזהה `874905142328467`,
category=UTILITY, **`allow_category_change=false`** (אם Meta תחלוק — דחייה
מפורשת במקום סיווג שקט). **אושרה (2026-07-03) — APPROVED בקטגוריית UTILITY.**
בעיית ה־MARKETING פתורה: המסלול הגנרי ישתמש ב־v2. נוסח v2 ממוקד־פעולה, בלי אימוג'י חגיגי, בהשראת
התזכורת הגנרית שכן עברה כ־UTILITY:
`שלום {{1}}, קיבלת הזמנה ל{{2}} של {{3}}. / האירוע יתקיים ביום {{4}}, {{5}}, בשעה {{6}}, ב{{7}}. / נא אשר/י הגעה באמצעות הכפתורים למטה.`
אותו חוזה פרמטרים ואותם כפתורי QUICK_REPLY — תחליף ישיר. אם תאושר:
לעדכן את `message_templates.name` של `invite` ל־v2 (שינוי דאטה, באישור),
ו־v1 הגנרית תישאר לא בשימוש (אפשר למחוק בהמשך).

שאר השורות ב־`message_templates` נשארו `active=false` (fail-closed, נכון) —
**אין להפעיל עד שקשירת הפרמטרים ממומשת**, אחרת שליחה תיכשל על אי־התאמת
פרמטרים (התבניות מצפות ל־{{1}}–{{7}} וה־client שולח תבנית חשופה).
תוכנית המימוש: `plans/whatsapp-template-binding-plan.md`.

עדכון הקשר (2026-07-02, מאוחר יותר): עמודת `events.celebrants` (jsonb) נוצרה
והוחלה על ה־DB החי (migration 20260702201958) — סוגרת את פער #2 לעיל;
מטריצת הצורות אושרה מוצרית (זוג/יחיד/הורים/חופשי לפי `event_type`)
והמימוש (ולידציה, טפסים, שער קמפיין) בביצוע.
