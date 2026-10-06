# תבניות WhatsApp: עמודות בשמות של Meta, סנכרון מלא, ניתוב ומשתנים כנתונים

**סטטוס:** גרסה 2 (30.9.2026), נכתבה מחדש אחרי מיפוי מלא של הזרימה (סוכן `template-flow-map`, קוד ו-DB חי). שלב 1 בוצע. שלב 2 כתוב בקוד, אבל לא נפרס ולא נכנס ל-commit. שאר השלבים מחכים לאישור, כל אחד בנפרד.

## המטרה (הבעלים, 30.9)

1. המסך מושך מ-Meta את כל התבניות ואת התוכן שלהן. בוחרים תבנית מרשימה ולא מקלידים שם.
2. **שמות העמודות הם המפתחות של Meta.** זה חל גם על הצד שלנו, כשהוא מתאר חלק ממבנה של Meta (למשל פרמטר).
3. **שום דבר לא קבוע בקוד.** תבנית חדשה, סוג אירוע חדש, או סדר משתנים חדש מוגדרים מהמסך. את המשתנים בוחרים מרשימה שנפתחת כשמקלידים `{`. הרשימה עצמה נבנית מהנתונים ולא מקוד קבוע.

## איך זה עובד היום (נמדד בקוד וב-DB, 30.9)

**הנתונים**
- ב-`message_templates` יש שורה לכל שלב (`message_key`). היא שומרת תבנית בסיס (`name`, `language`) ועמודת `components` בפורמט jsonb, שהתוכן שלה שלנו לגמרי:
  - `variants[event_type]`: תבנית אחרת לפי סוג האירוע.
  - `media_variant` / `media_variants[event_type]`: תבנית אחות עם תמונה בכותרת.
  - `param_contract[event_type]`: איזו פונקציה בונה את המשתנים.
  - `rsvp_quick_reply[event_type]`: האם להזריק את שלושת כפתורי אישור ההגעה.
- **שורות חיות:** 8 של WhatsApp פעילות, ועוד `call_1` כבויה (הערוץ `call` לא משתמש בטבלה בכלל).

**שליחה.** מי מפעיל שליחה:
- מנוע ה-drip: `worker/main.ts:344` → `prepareAndSendStep`.
- פעולות ידניות: gift, event_day_pay, thankyou (`campaign-actions.ts`).
- התודה האוטומטית.
- ה-node `action-send-template` בתהליכים האוטומטיים.
- `signup-link`.

כל ההפעלות מגיעות לפונקציית הרזולוציה, `message-templates-resolve.ts:144-166`, שבוחרת את התבנית כך:
1. בוחרת את השורה לפי `message_key` + `active`.
2. `name = variants[event_type] ?? name`.
3. אחר כך מחליפה לתבנית עם תמונה, אם יש תמונה לאירוע (`outreach.ts:131`).

**המשתנים נבנים בקוד, בחמישה מנגנונים שונים:**
- `param_contract` → `buildBodyParams` (`template-spec.ts:475`).
- בדיקה אם השם מתחיל ב-`kalfa_wedding_` (`outreach.ts:254`, `outreach-engine.ts:434,727`, `template-send.ts:109`, ושני סקריפטים).
- `messageKey === 'gift'` → `buildGiftParams` (`outreach.ts:266`).
- כפתור URL לפי `isGift || isEventDay`.
- `signup-link` מקודד ישירות.

**כפתורים ונתיב.** כפתורי RSVP מוזרקים לפי דגל ה-`rsvp_quick_reply` שחושב לפני ההחלפה לתבנית עם תמונה. ה-endpoint (`/messages` או `/marketing_messages`) נקבע מרשימה קבועה: `MARKETING_MESSAGE_KEYS` ב-`template-spec.ts:235`.

**מסך, בריאות וסנכרון**
- המסך עורך רק את `name`, `language`, `body` ו-`active`. אין בו עריכה של `components`, ולכן כל שינוי שם עובר היום דרך SQL, מיגרציה או ה-relocation G2 (`relocation/meta-templates.ts:274`).
- ה-webhooks והסנכרון הלילי מעדכנים את מצב הבריאות רק של תבנית הבסיס. תבניות לפי סוג אירוע ותבניות עם תמונה לא נבדקות.

## המודל החדש

### טבלה 1: `whatsapp_message_templates`, עותק של Meta (נוצרה בשלב 1)

עמודה לכל מפתח של Meta: `id`, `name`, `language`, `status`, `category`, `sub_category`, `components`, `parameter_format`, `quality_score`, `rejected_reason`, `correct_category`, `previous_category`, `message_send_ttl_seconds`, `library_template_name`, `disable_ios_autofill`, `is_primary_device_delivery_only`. העמודה היחידה שאינה של Meta היא `synced_at`. הטבלה נכתבת רק מהסנכרון, מה-webhooks ומפעולת "סנכרן עכשיו".

### טבלה 2: `message_template_routes`, איזו תבנית נשלחת

| עמודה | משמעות |
|---|---|
| `message_key` | השלב (FK ל-`message_templates.message_key`) |
| `event_type` | סוג האירוע. `NULL` = ברירת המחדל של השלב |
| `with_media` | `true` = התבנית עם התמונה |
| `whatsapp_template_id` | FK ל-`whatsapp_message_templates.id` |

- הייחודיות היא על `(message_key, event_type, with_media)`.
- כמה שלבים יכולים להפנות לאותה תבנית. למשל `reminder_1` ו-`reminder_2` בברית.
- **סדר הבחירה** מקודד פעם אחת ונבדק בבדיקות. זה כלל ולא רשימה של שמות:
  1. סוג האירוע עם תמונה.
  2. ברירת המחדל עם תמונה.
  3. סוג האירוע בלי תמונה.
  4. ברירת המחדל בלי תמונה.
- **מתי מנסים תמונה:** רק כשלאירוע יש תמונה והחתימה שלה הצליחה. אחרת מדלגים ל-3 ול-4, כמו ה-fail-open של היום.

### טבלה 3: `whatsapp_template_parameters`, מה נכנס בכל משתנה, לכל תבנית

המשתנים מוגדרים לפי התבנית ולא לפי השלב, כי המשמעות של `{{1}}` נקבעת בגוף הטקסט של התבנית. שמות העמודות הם המפתחות של payload השליחה ב-Meta:

| עמודה | משמעות |
|---|---|
| `whatsapp_template_id` | FK לעותק |
| `type` | `header` / `body` / `button` |
| `sub_type` | `url` בכפתור URL |
| `index` | המיקום של הכפתור |
| `position` | המספר n ב-`{{n}}` בפורמט POSITIONAL |
| `parameter_name` | לפורמט NAMED (היום 0 תבניות, נמדד) |
| `source_path` | הנתיב בהקשר השליחה, למשל `guest.first_name` |

- **כפתור ה-URL** של gift ו-event_day_pay הופך לשורה עם `type=button`, `sub_type=url`, `index=0`, `source_path=event.gift_link_token`. הקוד לא מזהה יותר את השלב לפי השם.
- **בדיקת התאמה בכל סנכרון:** המשתנים שב-`components` של Meta (`{{n}}` ב-HEADER, ב-BODY ובכפתורי URL) מושווים לשורות בטבלה. אם יש פער, נשלחת התראה והתבנית חסומה לשליחה עד תיקון.

### הגדרות לכל תבנית: `whatsapp_template_settings`

- **`whatsapp_template_id`** (PK).
- **`requested_category`:** הקטגוריה שביקשנו. המידע עובר לכאן מהשלב, כדי שהתראת "ירידה לשיווקי" תכסה גם תבניות לפי סוג אירוע ותבניות עם תמונה.

### השלב (`message_templates`) נשאר עם מה שבאמת שלנו

`message_key`, `channel`, `label`, `active`, ועמודה של תסריט לשיחה (`call_1`).

### הקשר השליחה: מקור אחד לרשימת `{` ולשליחה

- **היום אין אובייקט אחד כזה.**
  - `TemplateParamsContext` (`template-spec.ts:52`) מכיל רק את `event` (`name`, `event_type`, `event_date`, `venue_name`, `venue_address`, `celebrants`) ואת `guestFirstName`.
  - ל-gift יש הקשר נפרד (`GiftParamsContext`, `:174`).
  - שדות מחושבים, כמו תאריך בעברית, ניסוח לברית וחלוקה לחתן וכלה, נבנים בתוך כל פונקציה בנפרד.
- **החדש:** פונקציה אחת, `buildSendContext(event, guest, campaign)`, מחזירה אובייקט אחד:
  - `event.*` ו-`guest.*`: השדות הגולמיים.
  - `computed.*`: השדות המחושבים. מחושבים באותן פונקציות עיצוב שקיימות היום, בלי לכתוב אותן מחדש.
  - `links.*`: קישור ה-RSVP, קישור המתנה (`gift_link_token`).
- **הרשימה שנפתחת ב-`{`:** האובייקט עובר "שיטוח" לנתיבים עם `outputPaths()`, אותה פונקציה שמשמשת ב-workflows (`output-paths.ts`). שדה חדש בהקשר מופיע ברשימה לבד.
- **אחרי המעבר:** הפונקציות הישנות קוראות מאותו אובייקט. כך בדיקת השקילות משווה בין שתי דרכים שמשתמשות באותו מקור.

## החלטות שהקוד מקבל היום בלי שהן כתובות, ואיך הן נשמרות

| היום | בחדש |
|---|---|
| תבנית לסוג אירוע חסרה → תבנית הבסיס | שלבים 3 ו-4 בסדר הבחירה |
| תמונה לפי סוג אירוע → תמונה כללית → טקסט (כולל fail-open) | שלבים 1 עד 4, ודילוג על שלבי התמונה כשאין תמונה |
| ה-prefix `kalfa_wedding_` → 7 משתנים בנוסח חתונה | שורות משתנים לכל תבנית `kalfa_wedding_*` |
| `gift` → `buildGiftParams` ו-`isGift \|\| isEventDay` → כפתור URL | שורות משתנים, כולל `button/url` |
| `signup-link` מקודד | שורות משתנים לתבנית `kalfa_sales_signup_link_v1` |
| כפתורי RSVP לפי דגל ידני | נגזר מהתבנית **הסופית** (אחרי בחירת סוג האירוע והתמונה): 3 כפתורי `QUICK_REPLY` בסדר של `RSVP_QUICK_REPLY`, בלי כפתור URL. אם העותק ריק או שהשורה חסרה, **לא שולחים**, כי שליחה בלי payloads משתיקה את אישור ההגעה |
| שלב לא פעיל → sink של `template_missing` | ללא שינוי |
| ה-endpoint לפי `MARKETING_MESSAGE_KEYS` | **ללא שינוי במעבר.** ראו "מחוץ לתוכנית" |

## בדיקת שקילות לפני המעבר

לכל שלב, 9 סוגי אירועים, עם תמונה ובלי: בונים את בקשת השליחה המלאה פעמיים, בדרך הישנה ובדרך החדשה, ומשווים את:
- שם התבנית והשפה,
- כל המשתנים (header, body, button),
- ה-payloads של הכפתורים,
- ה-endpoint.

עוברים רק אם אין אף הבדל. כל הבדל נבדק לפני שממשיכים.

## שלבים

1. **(בוצע 30.9)** נוצרו הטבלה `whatsapp_message_templates`, העמודה `whatsapp_template_id` והעמודה `kalfa_send_config`. שתי העמודות התבררו כמיותרות במודל הזה, ומוסרות בשלב 3.
2. **סנכרון העותק (בוצע 30.9: נפרס, רץ ב-03:59, 80 תבניות נשמרו עם תוכן וציון איכות; תיקון ה-DELETED והאינדקס החלקי במיגרציה 20260930004036).**
   - **חוסם לפני פריסה:** אם Meta מחקה תבנית ויצרה אחרת עם אותו `name`+`language` ו-`id` חדש, ה-upsert לפי `id` נכשל על `UNIQUE(name, language)`, וכל ה-batch נופל. **תיקון:** upsert לכל שורה בנפרד. שורה שנכשלת מקבלת התראה ולא עוצרת את השאר. ייחודיות `(name, language)` נשארת רק על תבניות שלא נמחקו, דרך partial unique index על `status <> 'DELETED'`. אחר כך הבדיקות.
   - אחרי פריסה: הרצה אחת. בדיקה: 80 שורות.
3. **מיגרציה (בוצע 30.9, 20260930011039: שלוש הטבלאות ריקות, RLS דלוק, בלי grants ל-anon/authenticated; שתי העמודות הוסרו).**
   - יצירת `message_template_routes`, `whatsapp_template_parameters` ו-`whatsapp_template_settings`.
   - הסרת `whatsapp_template_id` ו-`kalfa_send_config` מ-`message_templates`. אין להן קוראים וגם לא כותבים (נמדד).
   - RLS דלוק, `revoke` מ-`anon` ו-`authenticated`.
4. **(בוצע 30.9, בלי שינוי בשליחה)** `buildSendContext` + `resolveParams` + `PARAM_CONTRACT_PATHS` ב-`template-spec.ts`: כל 8 הצורות (generic, wedding, gift, thankyou, event_day_pay, ושלוש של ברית) כנתונים. `send-context.test.ts` מוכיח זהות מלאה מול הבונים הקיימים, כולל סדר מפתחות החסר, על 4,752 צירופים (9 סוגי אירוע × 11 צורות חוגגים × 4 תאריכים × 4 מקומות × 3 אורחים). הבונים הקיימים עדיין בשימוש, וההחלפה בשלב 7. לא כלול: `signup-link` (הקשר של ליד מכירה, לא אירוע), שיטופל בשלב 5 או 7. המקור הקודם: **`buildSendContext`**, והפונקציות הישנות עוברות לקרוא ממנו. בלי שינוי בשליחה. הבדיקות הקיימות צריכות להישאר ירוקות.
5. **Backfill (בוצע 30.9, מיגרציה 20260930024008):** 36 שיוכים ל-32 תבניות, 137 משתנים (123 גוף, 11 כפתור URL, 3 תמונת כותרת), 32 שורות הגדרה. ערכי הגוף נוצרו אוטומטית מ-`PARAM_CONTRACT_PATHS`, בלי הקלדה ידנית. המיגרציה בודקת את עצמה מול הטקסט של Meta: מספר ה-{{n}} בגוף ובכותרת, וכפתור URL עם {{1}}. היא עברה ריצה ניסיונית בטרנזקציה שבוטלה לפני ההחלה. **פגם רדום שנסגר:** שיוך ברירת המחדל של `event_day_pay` היה נבנה כ-generic עם 7 ערכים לתבנית עם 2. הוא לא היה בשימוש, כי לכל 9 הסוגים יש תבנית משלהם. עכשיו הצורה נשמרת לכל תבנית. **נתיבים שעוד אין להם ערך בהקשר, ויתווספו בשלב 7:** `event.invite_image`, `lead.full_name`, `lead.signup_ref`. המקור הקודם: **Backfill.**
   - הניתוב נגזר מ-`name` ומ-`components` של כל שלב.
   - המשתנים של כל תבנית נגזרים מהמנגנון שבונה אותם היום.
   - `requested_category` מועבר.
   - בדיקה: כל שם תבנית קיים בעותק. אם חסר, עוצרים.
6. **(בוצע 30.9) בדיקת השקילות:** `npm run whatsapp:template-gate` (`scripts/whatsapp-template-gate.ts`, קריאה בלבד מול ה-DB החי) בונה כל בקשה פעמיים. הדרך הישנה: `resolveTemplateForEvent` + הבונים. הדרך החדשה: `template-route.ts` + הטבלאות. ההשוואה כוללת שם תבנית, שפה, כל ערכי הגוף, תמונת כותרת, סיומת כפתור URL, הזרקת כפתורי RSVP ו-endpoint. **תוצאה: 144 בקשות (8 שלבים × 9 סוגי אירוע × עם/בלי תמונה), 0 הבדלים.** בדיקת תקינות של הכלי עצמו: השחתה מכוונת (`GATE_CORRUPT=final`) נתפסה כ-18 הבדלים, כלומר 9 × 2. המקור הקודם: **בדיקת השקילות** (למעלה). אפס הבדלים.
7. **מעבר.** כל הקוראים עוברים למודל החדש:
   - הרזולוציה, מנוע השליחה, `outreach.ts`, `template-send.ts`, `signup-link`, הסקריפטים.
   - ה-webhooks והסנכרון: כותבים לעותק.
   - הבריאות: לכל התבניות שיש להן ניתוב.
   - `admin/packages.ts`.
   - relocation G2: כותב לניתוב.
   - **מחיקת פיגום המעבר:** הבונים הישנים (`buildTemplateParams` וכו'), `PARAM_CONTRACT_PATHS` ו-`send-context.test.ts`. אחרי שלב זה המקור היחיד לצורת ההודעה הוא `whatsapp_template_parameters`.
8. **המסך (בוצע 30.9, בעיצוב שאושר בהדמיה).**
   - `/admin/templates`: **מסע האורח**. בוחרים סוג אירוע (`?event=`) ועם או בלי תמונה (`?media=1`), ורואים מה כל שלב שולח. לכל שלב: התבנית, האם היא של סוג האירוע או ברירת המחדל, מצב, בעיות, מתג הפעלה, והחלפת תבנית או חזרה לברירת המחדל.
   - `/admin/templates?view=catalog`: **כל התבניות**. חיפוש, סינון לפי מצב, ועימוד בצד השרת. המצבים: ממתינות, נדחו, מושהות או מושבתות, נמחקו ב-Meta, לא בשימוש, ודורשות טיפול.
   - `/admin/templates/[templateId]`: **תבנית אחת**. תצוגה מקדימה עם הדוגמאות שהוגשו ל-Meta, מצב ובעיות, אישור קטגוריה, המשתנים ברכיב ה-`{` (JSON Forms + `ValuePathControl`), ואיפה היא נשלחת.
   - **המצבים מחושבים בכלל של השליחה.** `decideRoutedTemplate` ב-`template-route.ts` משותף לשליחה ולמסך. `stepOutcome` ב-`template-status.ts` מחשב מה אורח מקבל. סטטוס ש-Meta תוסיף בעתיד מוצג בשמו ונחשב "לא נשלח".
   - שתי פעולות חדשות:
     - `setWhatsAppStepActive`: לא מפעילה שלב שלא היה נשלח בפועל.
     - `acknowledgeWhatsAppTemplateCategory`: כותבת ל-`whatsapp_template_settings`, מוצמדת לקטגוריה שהוצגה.
   - המסך הישן (`TemplatesClient`) נשאר רק לתסריט השיחה, עד שלב 9.
   - **עוד לא:** ההסברים של הערכים עדיין בקוד (`value-labels.ts`). העברה שלהם למסד דורשת מיגרציה ואישור.
9. **ניקוי.** אחרי שבוע של שליחות תקינות: הסרת `name`, `language`, `body`, `components` וכל עמודות הבריאות מ-`message_templates`.

כל שלב מסתיים ב-`lint`, `tsc`, בדיקות רלוונטיות ו-`build`, וכשרלוונטי גם `gen:types` ובדיקה בדפדפן. כל שלב שמוחק דורש אישור נפרד.

## קבצים שמושפעים (נמדד)

- **בדיקות ב-§ה של המיפוי (דורשות עדכון):** `template-spec`, `outreach`, `outreach-engine`, `outreach.worker-cookies`, `message-templates`, `template-health-processing`, `template-health-sync`, `client`, `rsvp-buttons`, relocation, admin templates, packages, `admin-data-layer-coverage`.
- **קוראים וכותבים:**
  - `message-templates-resolve.ts:41,150`
  - `message-templates.ts:47,71,111,129`
  - `template-health-processing.ts:33,50,91,119,155,190`
  - `template-health-sync.ts:94,140,68`
  - `admin/packages.ts:214`
  - `relocation/steps.ts:187`
  - `relocation/meta-templates.ts:274`
- **שמות שכתובים בקוד:**
  - ה-prefix `kalfa_wedding_` (5 מקומות ב-`src` ועוד 2 סקריפטים)
  - `outreach.ts:266-276`
  - `template-spec.ts:218,235,354`
  - `route.ts` של `signup-link`
  - הקטלוג של workflows (`reminder_1`)
  - `action-send-template/definition.ts:53-59`

## המסך בנוי על JSON Forms (הבעלים, 30.9)

JSON Forms 3.8.0 (`@jsonforms/core` + `@jsonforms/react`) כבר נמצא בפרויקט. כרגע הוא מגיע רק כתלות של `@workflowbuilder/sdk` 2.3.0 (`npm ls`, נמדד). ה-workflows כבר משתמשים בו: יש שם controls שלנו שנבחרים עם `rankWith` + `optionIs('format', …)` (`checkbox-list-control.tsx:133`, `trigger-switch-control.tsx:187`).

**למה זה מתאים:** הטופס נבנה מתוך JSON Schema, והסכמה נבנית בזמן ריצה מהנתונים. אין בקוד טופס קבוע.

- **טופס המשתנים של תבנית:** בונים את הסכמה מתוך `components` של התבנית בעותק. לכל `{{n}}` ב-HEADER וב-BODY, ולכל משתנה של כפתור URL, יש property אחד. התבנית משתנה ב-Meta, והטופס משתנה איתה בלי קוד.
- **רשימת ה-`{`:** control אחד שלנו, שמזוהה עם `rankWith(…, optionIs('format', 'template-variable'))`, כמו ה-controls הקיימים. הערכים המותרים הם הנתיבים של `outputPaths(buildSendContext(...))`, והם מגיעים לסכמה כ-`enum`. בגלל זה JSON Forms דוחה נתיב שלא קיים. אותו control יתאים גם ל-workflows בעתיד.
- **טופס הניתוב של שלב:**
  - מערך של `{event_type, with_media, whatsapp_template_id}`.
  - `event_type` מקבל `enum` מערכי ה-enum ב-DB.
  - `whatsapp_template_id` מקבל `oneOf` מתבניות ה-`APPROVED` בעותק, עם השם כ-`title`.
  - סוג אירוע חדש ב-DB או תבנית חדשה שאושרה מופיעים בטופס לבד.
- **בדיקת תקינות בדפדפן:** ה-AJV שמובנה ב-JSON Forms בודק את הסכמה. בשרת הבדיקה נשארת ב-Zod, כמו שכתוב ב-CLAUDE.md, עם אותם ערכים מותרים שנבנים מאותו מקור. הבדיקה בדפדפן לא מחליפה את הבדיקה בשרת.

**מה צריך:**
- להוסיף את `@jsonforms/core` ו-`@jsonforms/react` כתלות ישירה, בדיוק ב-3.8.0 כמו ה-SDK, כדי שלא יהיו שני עותקים. לא סומכים על תלות עקיפה.
- renderers:
  - אפשרות א': סט קטן של renderers שלנו מעל shadcn (טקסט, בחירה, תיבת סימון, מערך), עם `dir` ו-logical CSS בשביל RTL.
  - אפשרות ב': ה-renderers של ה-SDK. זה מצמיד את המסך ל-SDK של ה-workflows, ולכן ההמלצה היא אפשרות א'.
- Client Component אחד. הנתונים (העותק, הניתוב, רשימת הנתיבים) נטענים בשרת ונשמרים דרך Server Action: הרשאה, Zod, ואז שכבת הנתונים.

**מה זה משנה בשלבים:** שלב 8 (המסך) נבנה על JSON Forms. שלבים 1 עד 7 לא משתנים.

## מחוץ לתוכנית: באגים שנמצאו, שאלות נפרדות לבעלים

1. **`gift` מסווגת MARKETING אבל נשלחת ב-`/messages`.** גזירת ה-endpoint מהקטגוריה תשנה את ההתנהגות החיה, ולכן לא עושים את זה במעבר.
2. **ה-node `action-send-template` לא בטוח ל-gift ול-event_day_pay.** אין בו כפתור URL, אין סינון למאשרי הגעה בלבד, ואין בדיקה שהאירוע כבר עבר.
3. **route `whatsapp-send` שאף טופס לא קורא לו.** `executeStep` הוא קוד מת. ל-`outreach_template_failures` כותבים, אבל אף אחד לא קורא ממנה.
4. **RLS של `message_templates` רחב מההרשאה באפליקציה** (`is_platform_staff` מול `manage_settings`), ול-`anon` יש grants מלאים.
5. **המשתנה המקודד של תבניות הדוח לבעלים** (`owner_agent_*_template_name`) נמצא מחוץ לטבלה. מקור שני לשמות.

## החזרה לאחור

- **שלבים 1 עד 6:** הוספה בלבד, והשליחה לא משתנה.
- **שלב 7:** העמודות הישנות עדיין קיימות, ולכן מחזירים את הקוד.
- **שלב 9:** היחיד שמוחק, ורץ רק אחרי שבוע תקין.
