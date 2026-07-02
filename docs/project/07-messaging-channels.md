# 07 — ערוצי הודעות: WhatsApp, SMS, Email

> מסמך זה מתעד את שלושת ערוצי ההודעות של KALFA כפי שהם ממומשים בקוד בפועל
> (נכון ל-2026-07-02). כל טענה אומתה מול הקבצים המצוטטים; פערים בין הקוד לבין
> מסמכי תכנון מצוינים במפורש. אין במסמך סודות, טוקנים או ערכי תצורה — שמות בלבד.

## סקירה כללית

| ערוץ | ספק | ספרייה/פרוטוקול | קובץ אדפטר | ייעוד |
|---|---|---|---|---|
| WhatsApp | Meta Cloud API (WABA) | `whatsapp-api-js` `^6.2.1` (`package.json:48`) | `src/lib/whatsapp/client.ts` | הזמנות/תזכורות RSVP לאורחים (outreach שיווקי-בהסכמה) |
| SMS | ExtrA (exm.co.il) | `fetch` + Bearer | `src/lib/sms/sender.ts` | קודי OTP לאימות זהות בחתימת הסכם |
| Email | SMTP (IONOS relay) | `nodemailer` `^9.0.1` (`package.json:36`) | `src/lib/email/sender.ts` | דוא"ל עסקי — קישור להסכם חתום |

עקרונות רוחביים המשותפים לכל הערוצים:

- **תצורה מנוהלת-אדמין, לא hardcoded**: כל פרטי הספקים נקראים משורת ה-singleton
  של `app_settings` (RLS אדמין-בלבד), לעולם לא מקוד או מ-`NEXT_PUBLIC_*`.
- **fail-closed**: ערוץ לא-מוגדר או כבוי ⇒ שום שליחה לא יוצאת
  (`SmsConfigError` / `EmailConfigError` / החזרת `null` מ-`getWhatsAppConfig`).
- **איסור לוג PII**: הכותרות של כל קבצי הערוצים אוסרות במפורש לוג של טוקן,
  טלפון, גוף הודעה או payload (למשל `src/lib/whatsapp/client.ts:6-8`,
  `src/lib/data/webhooks.ts:9-11`).

---

## 1. WhatsApp — צד השליחה (`src/lib/whatsapp/`)

### 1.1 אדפטר השליחה — `client.ts`

`sendWhatsAppTemplate` (`src/lib/whatsapp/client.ts:17-42`) הוא מעטפת דקה מעל
`whatsapp-api-js`:

- שולח **templates מאושרים בלבד** (`new Template(name, new Language(lang))`) —
  טקסט חופשי מותר רק בחלון שירות-הלקוחות של 24 שעות, ולכן לא ממומש בצד היוצא.
- נבנה עם `secure: false` לשליחה — ה-`appSecret` נדרש רק לאימות webhooks נכנסים
  (`client.ts:21-23`).
- מחזיר `{ providerId }` — ה-wamid של ההודעה היוצאת (`res.messages[0].id`),
  שהופך למפתח ההצלבה של כל ה-webhook events בהמשך.
- כשל ⇒ `WhatsAppSendError` עם הודעת עברית גנרית; שום פרט ספק לא דולף למשתמש.

### 1.2 ניהול templates — `message_templates`

אין שמות templates בקוד (בהתאם לכלל "אין עובדות עסקיות hardcoded"). הרזולוציה
נעשית דרך הטבלה `message_templates` (RLS אדמין-בלבד):

- `getTemplateByKey(messageKey)` (`src/lib/data/message-templates.ts:15-28`)
  ממפה `message_key` ⇒ `{ name, language, channel }`, ומחזיר רק שורות
  `active = true` — **fail-closed**: מפתח שלא הוגדר/הופעל לא שולח כלום.
- ניהול אדמין ב-`/admin/templates` דרך `listMessageTemplates` /
  `updateMessageTemplate` (`message-templates.ts:46-83`); `message_key` ו-`channel`
  קבועים (לוח הזמנים של ה-outreach מפנה אליהם), האדמין עורך name/language/body/active.

**מצב ה-DB החי (אומת בשאילתה, 2026-07-02):** קיימות חמש שורות —
`invite`, `reminder_1`, `reminder_2`, `final` (ערוץ `whatsapp`, שפה `he`) ו-`call_1`
(ערוץ `call`) — **כולן `active=false` ועם `name` ריק**. כלומר: עד שהאדמין ימלא
את שם ה-template המאושר ב-WABA ויפעיל אותו, שום הודעת WhatsApp לא נשלחת.

> **פער תיעוד-מול-קוד:** מסמך המחקר `plans/whatsapp-templates-research.md`
> (שורות 590-592) מייעד את השם `kalfa_rsvp_invite_he` לשורת `message_key='invite'`.
> זהו שם מתוכנן בלבד — הוא אינו מופיע בקוד ואינו מוגדר עדיין ב-DB.

### 1.3 נרמול טלפונים — `src/lib/phone.ts`

`normalizePhone` (`phone.ts:11-16`) מבוסס `libphonenumber-js`:

- ברירת מחדל אזור `'IL'` — קלט מקומי `05x-xxxxxxx` מנורמל ל-`+972…`.
- מחזיר **E.164** או `null` (לא-חוקי = לא-נשלח = לא-חייב). זהו מפתח הדדופ של
  "contact" (טלפון ייחודי per-event, `contacts.normalized_phone`).
- פרסר לא-זורק בכל גבול קלט; `isValidPhone` נגזר ממנו.

### 1.4 זרימות שליחה

יש שני מסלולי שליחה, שניהם מתכנסים ל-`sendOneWhatsApp`
(`src/lib/data/outreach.ts:23-61`):

1. **שליחה ידנית של בעל האירוע** — `POST /api/campaigns/[id]/whatsapp-send`
   (`src/app/api/campaigns/[id]/whatsapp-send/route.ts`): בדיקת Origin/Referer מול
   `APP_ORIGIN` (CSRF), `requireUser`, `requireOwnedEvent`, חסימת אירוע שעבר
   (`isPastEventDay`, L1), ולידציית `message_key` ב-Zod, ושער fail-closed על
   `getOutreachEnabled()` + `getWhatsAppConfig()`. משם ל-`sendCampaignWhatsApp`.
2. **מנוע ה-outreach האוטומטי** — ה-worker (`worker/main.ts`) מריץ `executeStep`
   (`src/lib/data/outreach-engine.ts:232-295`) לכל contact לפי לוח הזמנים:
   בדיקת `removal_requested`, בדיקת `whatsapp_consent_at` per-contact
   (`outreach-engine.ts:249-251`), `claimStep` (at-most-once), ואז שליחה + עדכון
   `op_status='whatsapp_sent'`.

`sendCampaignWhatsApp` (`outreach.ts:71-120`) מאמת שוב **בצד השרת** את כל תנאי
§8.3: outreach מופעל, קמפיין `active`, `'whatsapp'` ב-`allowed_channels`, אירוע
`active` ולא-עבר, template פעיל, וזכאות per-contact דרך `listSendableContacts`
— כולל INNER JOIN ל-`campaign_authorized_contacts` (הסט המוקפא) כך ששליחה לעולם
לא חורגת מהסט המאושר (reached ⊆ authorized).

### 1.5 תיעוד השליחה

כל שליחה מוצלחת נרשמת כשורת `contact_interactions` (`outreach.ts:43-56`):
`event_id`, `campaign_id`, `contact_id`, `channel='whatsapp'`, `direction='out'`,
`kind='template'`, `provider_id=<wamid>`, `billable=false` — **אידמפוטנטית** על
`UNIQUE(channel, provider_id)`. גוף ההודעה, הטלפון והטוקן לא נרשמים ולא נלוגגים.

---

## 2. WhatsApp — צד הקליטה (webhook)

### 2.1 ה-route — `src/app/api/webhooks/whatsapp/route.ts`

**GET (אימות מנוי של Meta)** (`route.ts:82-95`):

- מגודר על **נוכחות `verify_token` בלבד** (לא על `outreach_enabled`) — Meta
  רשאית לאמת את ה-callback לפני הפעלת המנוע. ללא token מוגדר ⇒ `404`.
- `hub.mode=subscribe` + `hub.verify_token` תואם ⇒ מחזיר את `hub.challenge`
  ב-`200`; **אי-התאמה ⇒ `403`** ("forbidden").

**POST (אירוע חתום)** (`route.ts:98-143`) — ארכיטקטורת **persist-then-process**:

1. שער fail-closed: `outreach_enabled` כבוי או `whatsapp_app_secret` חסר ⇒
   `200` בלי לכתוב כלום (ולא 5xx — כדי לא להצית retry storms של Meta).
2. אימות חתימה: `wa.verifyRequestSignature(raw, signature)` של הספרייה —
   HMAC-SHA256 (`X-Hub-Signature-256`) על ה-raw body (`request.text()`).
   חתימה לא-תקפה ⇒ `401`. זהו האימות היחיד (server-to-server, אין session/CSRF).
3. נרמול: `normalizeWebhookRows` (`route.ts:36-78`) עובר **בעצמו** על כל
   `entry[].changes[]` — בכוונה לא דרך ה-dispatcher של הספרייה, שקורא רק את
   `entry[0].changes[0]` ומפיל אירועים ב-batch (`route.ts:30-35`).
4. הכנסה עמידה ל-`webhook_inbox` והחזרת `200` מהר. **שום לוגיקה כלכלית ב-route**.

מפתחות דדופ (`route.ts:50,66`):

| `event_kind` | `dedupe_key` | הערה |
|---|---|---|
| `message` | `wa-msg:<wamid>` | הודעה נכנסת אחת = שורה אחת |
| `status` | `wa-status:<wamid>:<status>` | אותו wamid עובר `sent→delivered→read` — כל מעבר שורה נפרדת |

### 2.2 טבלת ה-inbox — `webhook_inbox`

`insertWebhookEvents` (`src/lib/data/webhooks.ts:21-30`) עושה upsert עם
`onConflict: 'provider,dedupe_key'` + `ignoreDuplicates` — retry של Meta על אותו
אירוע הוא no-op ברמת ה-DB. הסכמה המלאה מתועדת ב-`docs/webhook-inbox-data-contract.md`
ו**נמצאה תואמת לקוד** (עמודות, מפתחות דדופ, אינדקסים, RLS אדמין-בלבד).

### 2.3 העיבוד ב-worker — `worker/main.ts` + `webhook-processing.ts`

- ה-worker (pm2 `kalfa-worker`, pg-boss) מתזמן את תור `webhook-process` כל דקה
  (`worker/main.ts:187-193`; שמות התורים ב-`src/lib/queue/queues.ts:3-11`).
- `handleWebhook` (`main.ts:116-127`) קולט עד 50 שורות דרך
  `claimUnprocessedWebhookEvents` (`webhooks.ts:38-47`) — RPC
  `claim_webhook_events`: `SECURITY DEFINER`, `EXECUTE` ל-`service_role` בלבד,
  `FOR UPDATE SKIP LOCKED` (ריצות חופפות מקבלות קבוצות זרות), ותקרת dead-letter
  `attempts < 5`. הצלחה ⇒ `processed_at`; כשל ⇒ `attempts+1` + `last_error`
  (חתוך ל-500 תווים, לעולם לא payload).

`processWebhookEvent` (`src/lib/data/webhook-processing.ts:56-66`) מפצל לפי
`event_kind`:

**הודעה נכנסת** (`processMessage`, `webhook-processing.ts:79-164`):

1. **סיווג** — `classifyMessagePayload` (`src/lib/whatsapp/inbound.ts:110-119`),
   מסווג טהור ללא I/O: `billable` (סוגים `text`/`button`/`interactive`/`reaction`
   בלבד — statuses ומערכת אינם billable), `removal` (מילות הסרה מפורשות בעברית
   ואנגלית, התאמת token שלם, `inbound.ts:22-37,90-96`), ו-`replyId` (המזהה
   האטום של כפתור quick-reply). הטקסט הגולמי לעולם לא יוצא מהמודול.
2. **רזולוציה** — קודם `resolveByContextId(context.id)`
   (`src/lib/data/interactions.ts:89-110`): התאמה מדויקת של התגובה ל-wamid
   היוצא ששמרנו כ-`provider_id` (direction `out`). **fallback לפי טלפון** —
   `resolveInboundContact(payload.from)` (`interactions.ts:49-81`): נרמול E.164 ⇒
   כל ה-contacts עם אותו `normalized_phone` ⇒ האינטראקציה היוצאת האחרונה שפנתה
   אליהם. ה-fallback נחוץ כי תגובה מוקלדת רגילה ("כן אגיע"/"הסר") לא נושאת
   `context.id`. לא זוהה ⇒ מסומן processed בלי חיוב (fail-closed).
3. **אידמפוטנטיות** — `insertInteraction` (`interactions.ts:34-43`) קודם:
   `UNIQUE(channel, provider_id)` על ה-wamid הנכנס; רק `fresh === true` ממשיך
   ל-`recordReached` (RPC `try_record_billed_result`, `src/lib/data/billing.ts:30-32`)
   — retry של Meta לא יכול לחייב פעמיים.
4. **opt-out (D4)** — תגובת הסרה **מחייבת קודם** (זו הגעה אנושית) ורק אז
   `markContactRemovalRequested` (`interactions.ts:152-161`) עוצר outreach עתידי.
5. **RSVP מכפתור (C9)** — `RSVP_BUTTON_MAP` (`webhook-processing.ts:27-31`):
   `rsvp_attending`/`rsvp_declined`/`rsvp_maybe` ⇒ `submit_rsvp` (אותו RPC אטומי
   של הטופס הציבורי), **רק כשמאחורי ה-contact עומד בדיוק אורח אחד** — לעולם לא
   מנחשים אורח בטלפון משותף (`webhook-processing.ts:139-163`). נרשם marker
   נטול-PII `rsvp.from_whatsapp` ב-`activity_log` (`interactions.ts:200-220`).
   הקונבנציה מתועדת ב-`docs/whatsapp-rsvp-button-convention.md` ותואמת לקוד;
   ה-payloads מוגדרים ב-template הרשום ב-WABA (צעד תפעולי בצד Meta, לא קוד).

**status יוצא** (`processStatus`, `webhook-processing.ts:170-190`):

- `setDeliveryStatus` (`interactions.ts:116-132`) מעדכן latest-wins את
  `delivery_status` + `delivery_error_code` על שורת האינטראקציה היוצאת
  (ההיסטוריה המלאה נשמרת ב-`webhook_inbox` בזכות הדדופ per-status).
- `failed` עם קוד `131026` בלבד (`WRONG_NUMBER_CODES`,
  `webhook-processing.ts:47`) ⇒ `op_status='wrong_number'` — שמרני בכוונה, וקוד
  השגיאה הגולמי נשמר תמיד כך שסיווג שגוי ניתן לביקורת ולתיקון.

### 2.4 הצלבה מול מסמכי התכנון

- `docs/webhook-inbox-data-contract.md` — **תואם לקוד** אחד-לאחד (עמודות,
  dedupe, אינדקסים, RLS, שתי שכבות הדדופ הנפרדות).
- `plans/whatsapp-webhook-hardening-spec.md` — הספק מומש כמעט במלואו
  (persist-then-process, context.id, statuses, RSVP-מכפתורים, wrong_number,
  gating של GET על verify_token). **סטייה אחת מהמפרט:** §4 ממליץ לקרוא את הגוף
  כ-`arrayBuffer()` לפני האימות; הקוד משתמש ב-`request.text()`
  (`route.ts:109`) ומאמת על המחרוזת — פונקציונלית תקין מול
  `verifyRequestSignature` של הספרייה, אך שונה מהניסוח במפרט.

---

## 3. SMS — ExtrA (exm.co.il), `src/lib/sms/`

### 3.1 האדפטר — `sender.ts`

- כתובת קבועה: `https://www.exm.co.il/api/v1/sms/send/` (`sender.ts:7`).
- `createExtraSmsSender` (`sender.ts:28-76`): `POST` עם
  `Authorization: Bearer <token>` וגוף `{ message, destination, sender }`;
  תגובה `{ success, id, messages_count, errors[] }` — כשל ⇒ `SmsSendError` עם
  סטטוס HTTP/פירוט שגיאת ספק **ללוג שרת בלבד** (בלי token ובלי טלפון).
- הממשק `SmsSender` מופשט-ספק בכוונה: החלפת ספק = אדפטר חדש בלבד.
- `getSmsSender` (`sender.ts:80-95`) בונה את השולח מ-`app_settings`
  (`sms_enabled`, `extra_sms_token`, `extra_sms_sender`) — כבוי/חסר ⇒
  `SmsConfigError`, שום שליחה.

### 3.2 זרימת ה-OTP — `src/lib/data/otp.ts`

השימוש **היחיד** ב-SMS כיום הוא אימות זהות בחתימת הסכם הקמפיין (purpose
`'agreement_signing'`, `src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts:25`).
ה-OTP **אינו** משמש להתחברות (login נעשה דרך Supabase Auth) ואינו חלק ממסלול
התשלום B עצמו — הוא שלב בזרימת אישור-הקמפיין (חתימה ⇒ ואז שלב אמצעי-תשלום).

מנגנון (`otp.ts`):

- קוד בן 6 ספרות מ-`randomInt` קריפטוגרפי; **נשמר רק** `sha256(code:phone)`
  ב-`otp_challenges` — הקוד עצמו לעולם לא נשמר ולא נלוגג (`otp.ts:19-21,49-56`).
- תוקף 5 דקות (`CODE_TTL_MS`), עד 5 ניסיונות אימות (`MAX_VERIFY_ATTEMPTS`),
  ו-rate-limit שרתי: עד 5 קודים לשעה per phone+purpose (`otp.ts:14-17,37-47`).
- `verifyOtp` (`otp.ts:78-113`) מאמת מול האתגר האחרון שטרם נוצל, מגדיל `attempts`
  בכשל, ומסמן `consumed_at` בהצלחה (חד-פעמי).
- הטלפון נגזר **מהפרופיל בצד השרת** (`requestSigningOtpAction`,
  `campaign-actions.ts:70-92`) — לא מהלקוח.

**קירור 60 שניות:** `OTP_COOLDOWN_SECONDS = 60` ממומש **בצד הלקוח בלבד** כחוויית
אנטי-הצפה על כפתור השליחה (`.../approve/sign-agreement-form.tsx:17,79-87`);
המגבלה הקשיחה היא ה-rate-limit השרתי של 5 לשעה. כשל שליחה נלוגג עם ה-purpose
והודעת השגיאה בלבד — לא קוד ולא טלפון מלא (`otp.ts:61-71`).

---

## 4. Email — SMTP דרך IONOS, `src/lib/email/`

### 4.1 הטרנספורט — `sender.ts`

`getEmailSender` (`sender.ts:40-95`) בונה `nodemailer.createTransport` מתצורת
`app_settings` (`email_enabled`, `smtp_host`, `smtp_port`, `smtp_secure`,
`smtp_user`, `smtp_password`, `smtp_from`); `smtp_secure` — `true`=465/SSL,
`false`=587/STARTTLS. חסר/כבוי ⇒ `EmailConfigError`.

**אילוצי deliverability (מאומתים, מתועדים בקוד `sender.ts:61-65`):**

- **אין חתימת DKIM בצד האפליקציה** — ה-relay של IONOS Exchange משכתב את גוף
  ההודעה ומפסיל כל חתימה מוקדמת (נצפה אצל נמענים: `dkim=neutral`,
  "body hash did not verify").
- **DMARC מסופק דרך SPF**: דומיין ה-From/Return-Path (kalfa.me) מיושר, ורשומת
  ה-SPF של הדומיין חייבת לכלול את שרתי IONOS — `include:_spf.perfora.net`
  (ולא `include:ionos.com`).
- כל שליחה כוללת חלופת plain-text (multipart) לשיפור מיקום-בתיבה
  (`sender.ts:83`).

### 4.2 מה נשלח בפועל

**דוא"ל אחד בלבד נשלח מהמערכת כיום** — הודעת "ההסכם נחתם" ללקוח:

- Template ב-`src/lib/email/templates.ts:16-47` (`agreementEmail`) — HTML עברי
  RTL עם inline styles + חלופת טקסט; escaping מלא של קלט.
- ההסכם מסופק כ**קישור מאובטח** (דורש התחברות לחשבון) ולא כקובץ PDF מצורף —
  כדי לא להיתפס בסורקי-צרופות של נמענים (`templates.ts:12-14`); ממלא את חובת
  §14ג(ב) (מסירת המסמך + יכולת שמירה).
- נשלח best-effort מתוך `recordSignedAgreement`
  (`src/lib/data/agreements.ts:201-220`): כשל SMTP חולף אינו מבטל חתימה שכבר
  נשמרה ואושרה.

> **הסתייגות קטנה:** בניית ה-URL שם משתמשת ב-`process.env.APP_ORIGIN ?? ''`
> ישירות (`agreements.ts:206`) ולא ב-helper `getAppUrl` מ-`src/lib/url.ts` —
> `APP_ORIGIN` חסר יפיק קישור יחסי שבור בדוא"ל.

**מסמכי חשבונית/קבלה של SUMIT נשלחים על-ידי SUMIT, לא על-ידינו**: דגל
`SendDocumentByEmail` ב-payload ל-SUMIT — `true` כשיש אימייל לקוח בחיוב/לכידה
(`src/lib/sumit/charge.ts:49`, `capture.ts:69`), `true` קבוע במסלול B
(`raw-charge.ts:68`), ו-`false` בשלב ה-authorize/hold (`authorize.ts:61` — אין
מסמך בשלב J5). ה-SMTP שלנו אינו מעורב במסמכים אלה.

---

## 5. מודל ההסכמה (consent)

- **הסכמה שיווקית היא per-ערוץ per-contact**: העמודה
  `contacts.whatsapp_consent_at` (timestamptz, מיגרציה
  `supabase/migrations/202606290028_billing_backhalf.sql:37`) מתעדת הסכמת
  WhatsApp מפורשת עם חותמת זמן.
- **אכיפה בשליחה (שתי שכבות):**
  - `listSendableContacts` (`src/lib/data/contacts.ts:265-302`) מחזיר רק
    contacts עם `removal_requested=false` **וגם** `whatsapp_consent_at IS NOT NULL`,
    ובמסלול קמפיין — רק חברי הסט המוקפא (`campaign_authorized_contacts`).
  - מנוע ה-outreach בודק שוב per-contact לפני כל step
    (`outreach-engine.ts:244-251`).
- **הסרה**: תגובת opt-out נכנסת מציבה `removal_requested=true` (ראו §2.3) —
  נבדק בכל מסלולי השליחה וההקפאה (`contacts.ts:281,295,357`).
- **הסכמות ברמת הלקוח (בעל האירוע)** נאספות בחתימת ההסכם: שלוש הצהרות מפורשות
  (`terms_accepted`, `privacy_accepted`, `authorization_accepted`) + `tos_version`
  שנקבע בצד השרת מהמסמך הפעיל (`campaign-actions.ts:109-118`), ונשמרות עם ראיות
  (`signed_agreements`: חתימה, hash, IP, user-agent, `verified_phone`,
  `otp_verified_at` — `agreements.ts:182-195`).
- **תיחום טרנזקציוני**: כל שליחה כבולה לקמפיין⇒אירוע⇒contact של אותו אירוע
  (`contacts` ייחודי per `(event_id, normalized_phone)`); אין שליחה גלובלית.

> **פער שיש להכיר:** הפונקציה לרישום ההסכמה — `recordWhatsAppConsent`
> (`contacts.ts:245-256`) — קיימת ומכוסה בבדיקות, אך **אין לה כיום caller בקוד
> הייצור** (אומת ב-grep על כל `src/`). כלומר אין עדיין UI/זרימה שמציבה
> `whatsapp_consent_at`; עד שתחווט, `listSendableContacts` יחזיר אפס אנשי קשר
> והמנוע ידלג על כולם (fail-closed לטובת פרטיות).

---

## 6. תצורת ספקים — מפתחות `app_settings` וממשקי אדמין

כל התצורה יושבת בשורת singleton של `app_settings` (`id = true`, RLS
`app_settings_admin_all`). **שמות מפתחות בלבד** (ללא ערכים):

| ערוץ | מפתחות | קורא production | טופס אדמין |
|---|---|---|---|
| WhatsApp / outreach | `outreach_enabled`, `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token` | `src/lib/data/outreach-config.ts:21-74` | `/admin/channels` (`src/lib/data/admin/channels.ts:25-76`) |
| SMS (ExtrA) | `sms_enabled`, `extra_sms_sender`, `extra_sms_token` | `src/lib/sms/sender.ts:80-95` | `/admin/settings` (`src/lib/data/admin/settings.ts:35-119`) |
| Email (SMTP) | `email_enabled`, `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password`, `smtp_from` | `src/lib/email/sender.ts:40-72` | `/admin/settings` (אותו קובץ) |

הערות:

- `outreach_enabled` הוא **מתג-העל** לכל ערוצי ה-outreach (WhatsApp + שיחות
  עתידיות); `sms_enabled`/`email_enabled` עצמאיים לערוצים התפעוליים.
- הסודות (access token, app secret, SMS token, SMTP password) מוצגים בטפסי
  האדמין **ממוסכים עם reveal** (דפוס gateway-plugin), נשלחים רק לעמוד
  `requireAdmin` על HTTPS, ולעולם לא נלוגגים (`channels.ts:6-11`,
  `settings.ts:10-13`).
- `/admin/channels` כולל בדיקת חיבור read-only — `testWhatsAppConnection`
  (`channels.ts:83-113`): GET ל-Graph API על שדות התצוגה בלבד, בלי לשלוח הודעה;
  גרסת ה-Graph נשלטת ב-env `WHATSAPP_GRAPH_VERSION` (ברירת מחדל `v23.0`).
- הקוראים ב-`outreach-config.ts` משתמשים ב-`select('*')` בכוונה — עמידים לעמודות
  שטרם הוגרו (fail-closed ל-off), בעוד שקוראי האדמין בוחרים עמודות מפורשות.
- שני מפתחות תשתית נשארים ב-env בלבד (מוצגים כ"מוגדר/לא מוגדר" בלבד):
  `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN` (`settings.ts:183-205`).

---

## 7. תיעוד, audit ומדיניות PII

### 7.1 מה נרשם על כל ניסיון שליחה/קליטה

| טבלה | מה נרשם | מה לא נרשם |
|---|---|---|
| `contact_interactions` | כיוון, `kind`, `provider_id` (wamid), `context_message_id`, `billable`, `delivery_status` + `delivery_error_code` (latest-wins), שיוך event/campaign/contact | גוף ההודעה — אין עמודת body; הטלפון קיים רק ב-`contacts` |
| `webhook_inbox` | האירוע הגולמי המלא (`payload` — PII) + מטא-נתונים טכניים, `attempts`, `last_error` | — (זהו ה-audit הגולמי; מוגן RLS אדמין-בלבד) |
| `activity_log` | markers נטולי-PII, למשל `rsvp.from_whatsapp` עם `{guest_id, status}` בלבד | שמות, טלפונים, טוקנים, הערות |
| `otp_challenges` | `phone`, `purpose`, `code_hash` (sha256), `attempts`, `consumed_at` | הקוד עצמו — לעולם לא |
| `signed_agreements` | הפניות (refs) לחתימה/PDF, `content_hash`, `verified_phone`, `otp_verified_at`, IP, user-agent | בייטים של המסמך אינם בטבלה (storage refs) |
| `billed_results` (דרך RPC `try_record_billed_result`) | ראיית חיוב: ערוץ, `attemptId`/`providerRef` (wamid), evidence (`whatsapp_inbound_message`/`whatsapp_inbound_removal`) | תוכן ההודעה |

### 7.2 כללי עריכת PII (redaction)

- **בלוגים**: אסור ללוגג payload, `dedupe_key`, `message_id`, טלפון, token,
  או גוף הודעה — הכלל חוזר בכותרות `route.ts:16-17`, `webhooks.ts:9-11`,
  `interactions.ts:9-11`, `client.ts:6-8`, `otp.ts:10-12`. לוג השגיאות של OTP
  כולל purpose והודעת ספק בלבד (`otp.ts:65-69`).
- **ב-UI ללקוח**: ה-timeline של אינטראקציות לאורח
  (`listInteractionsForContact`, `interactions.ts:252-277`) בוחר רק מטא-נתונים
  (כיוון/סטטוס/מזהים) — אף פעם לא גוף הודעה; רץ על ה-cookie client עם RLS בעלות
  + `requireOwnedEvent`.
- **ב-UI לאדמין** (Webhook Inspector, `/admin/webhooks`): הרשימה מקרינה עמודות
  תצוגה בלבד — `payload` נשלף רק במסך detail
  (`src/lib/data/admin/webhook-inbox.ts:17-49,103`); חיפוש `q` מוגבל למזהים
  טכניים (`message_id`/`context_message_id`/`phone_number_id`) ולא לטלפון אורח.
- **הודעות שגיאה למשתמש**: תמיד גנריות בעברית; פרטי ספק (HTTP status, errors)
  נשמרים להודעת ה-Error שנועדה ללוג שרת בלבד (`sms/sender.ts:51-57`).

---

## 8. פערים ומגבלות ידועות (קוד ⇄ תיעוד)

1. **templates לא מוגדרים ב-DB החי** — כל שורות `message_templates` כרגע
   `active=false` עם `name` ריק; שליחת WhatsApp לא תפעל עד שהאדמין יזין את שמות
   ה-templates המאושרים ב-WABA ויפעילם. השם המתוכנן `kalfa_rsvp_invite_he` קיים
   רק ב-`plans/whatsapp-templates-research.md`.
2. **אין caller ל-`recordWhatsAppConsent`** — מנגנון ההסכמה נאכף בשליחה אך אין
   עדיין זרימת-מוצר שמציבה אותו (ראו §5).
3. **סטיית hardening-spec**: אימות החתימה רץ על `request.text()` ולא על
   `arrayBuffer()` כפי שהמליץ המפרט (§2.4).
4. **`APP_ORIGIN` ישיר בדוא"ל ההסכם** במקום ה-helper `getAppUrl` (§4.2).
5. **RSVP-מכפתור תלוי תפעולית ב-Meta**: ה-payloads (`rsvp_attending` וכו')
   חייבים להיות מוגדרים ב-template הרשום ב-WABA; קוד השליחה שולח לפי שם בלבד
   (`docs/whatsapp-rsvp-button-convention.md`).
6. **קירור ה-OTP של 60 שניות הוא client-side בלבד**; ההגנה השרתית היא
   rate-limit של 5 קודים לשעה per phone+purpose (§3.2).
