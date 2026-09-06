# ביקורת שיוך וחיוב WhatsApp — עובדות פלטפורמת Meta (2026-09-04)

מסמך זה הוא **חלק העובדות החיצוניות** של חקירת השיוך/החיוב (ראו `docs/whatsapp-billing-audit-goal.md`).
הוא עונה על שאלות Q9–Q12 ועל שתי שאלות נלוות (ייחודיות `wamid`, סמנטיקת מסירה של webhooks),
**אך ורק** על סמך התיעוד הרשמי העדכני של Meta כפי שנשלף דרך `ctx7` ביום 2026-09-04.
המסמך לא נוגע בקוד, ב-DB או בקונפיגורציה, ולא בוצעו שליחות.

## 0. מתודולוגיה ותיוג

**מזהי ספרייה שנפתרו ב-ctx7** (שתי שאילתות ה-`library` החזירו אותו מזהה במקום הראשון):

| שאילתה | מזהה שנבחר | ציון benchmark | snippets |
|---|---|---|---|
| `"Meta WhatsApp Business Platform"` | `/websites/developers_facebook_business-messaging_whatsapp` | 74.31 | 6551 |
| `"Facebook Business Messaging WhatsApp"` | `/websites/developers_facebook_business-messaging_whatsapp` | 74.31 | 6551 |

כל שאילתות ה-`docs` רצו נגד המזהה הזה בלבד. לא התקבלה שגיאת quota.

**תיוג כל טענה:**

- **DOCUMENTED (Meta)** — מופיע במפורש בפלט ctx7, עם URL של Meta. ציטוטים באנגלית, עד 25 מילים.
- **INFERENCE** — מסקנה שלי מתוך מה שמתועד (למשל: שדה שאינו מופיע באף payload נכנס).
- **UNVERIFIED** — ctx7 לא החזיר תיעוד לנקודה; ניתן URL כמצביע בלבד, לא כראיה.

**הערת URL:** ctx7 מדווח כל מקור עם סיומת `.md` (מראה markdown של אותו עמוד). נבדק ב-`curl`
ששתי הצורות מחזירות 200; במסמך מצוטט העמוד הקנוני ללא `.md`.

**כלל ניסוח:** endpoint השליחה מצוטט אך ורק בצורה
`POST https://graph.facebook.com/{API_VERSION}/{PHONE_NUMBER_ID}/messages`.

---

## 1. מבנה webhook נכנס (`field: "messages"`)

**DOCUMENTED (Meta).** המעטפת הקבועה: `object: "whatsapp_business_account"` → `entry[]` (עם `id` = WABA ID) →
`changes[]` → `value` שמכיל `messaging_product`, `metadata.display_phone_number`, `metadata.phone_number_id`,
`contacts[]` (עם `profile.name`, `wa_id`) ו-`messages[]`. הודעה נכנסת מזוהה לפי נוכחות מערך `messages`;
לכל סוג הודעה עמוד reference נפרד.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/contacts

**DOCUMENTED (Meta).** `metadata.phone_number_id` הוא מזהה מספר העסק המקבל, ו-`display_phone_number` הוא
המספר המוצג. שניהם מופיעים בכל payload נכנס וגם ב-payload של סטטוסים (ראו §5).
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text

**INFERENCE.** מאחר ש-`metadata.phone_number_id` קיים בכל `value`, הוא זמין תמיד לצורך מפתח
`(phone_number_id, inbound_message_id)` בלי תלות בסוג ההודעה.

**DOCUMENTED (Meta).** קיימת משפחת webhooks נוספת, `field: "standby"`, כשהאפליקציה **אינה** ה-handler הפעיל
(למשל Meta Business Agent). היא משתמשת באותה סכמה של `messages`. לא רלוונטי ל-KALFA כיום, אך מסביר מדוע
`field` חייב להיבדק ולא להניח `"messages"`.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/standby

---

## 2. מזהים: `messages[].id` (wamid), `messages[].from`, `contacts[].wa_id`

### 2.1 פורמט וייחודיות `wamid`

**DOCUMENTED (Meta).** תשובת API השליחה מחזירה `messages[].id` שמתחיל ב-`wamid.`:
> "The message ID, which begins with 'wamid.', can be used to track the status of the sent message."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates

**DOCUMENTED (Meta).** ב-reference של standby: "Unique message ID (wamid.*) assigned at send time."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/standby

**UNVERIFIED.** אף עמוד שהוחזר ב-ctx7 **אינו מגדיר את היקף הייחודיות** של `wamid` (גלובלי לעומת לכל
`phone_number_id`). המילה "unique" מופיעה ללא scope. חיפושים ממוקדים ("wamid format unique identifier
per message globally unique") החזירו רק דוגמאות תשובה. מצביע בלבד:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages

**INFERENCE (הכרעה תכנונית).** בהיעדר הבטחה מתועדת לייחודיות גלובלית, מפתח idempotency בטוח הוא
`unique (phone_number_id, inbound_message_id)`. אם Meta אכן מבטיחה ייחודיות גלובלית, המפתח המורכב
עדיין נכון (רק מחמיר יותר); אם אינה מבטיחה, מפתח על `inbound_message_id` בלבד עלול להתנגש בין מספרי
עסק. לכן המפתח המורכב דומיננטי בכל מקרה.

### 2.2 `messages[].from` ו-`contacts[].wa_id` — אינם מובטחים

**DOCUMENTED (Meta).** בעידן BSUID:
- `messages.from` — "Optional - The user's phone number, subject to privacy conditions."
- `messages.from_user_id` — "Required - The user's BSUID."
- `contacts.wa_id` — Optional באותו תנאי; `contacts.user_id` — Required.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids

**DOCUMENTED (Meta).** ה-payload לדוגמה עם BSUID מציג הודעת `text` שבה **אין** `from` ו**אין** `wa_id`
כלל, רק `from_user_id` ו-`user_id` (פורמט `US.<digits>` ו-`US.ENT.<digits>` ל-parent).
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids

**DOCUMENTED (Meta).** מתי המספר נשאר גלוי:
> "remain visible in webhooks if there has been interaction within the last 30 days or if the user is in the business contact book"
> "These 30-day lookback conditions are evaluated per individual business phone number."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids

**DOCUMENTED (Meta).** גם כשמספר קיים, `wa_id` ו-`from` אינם בהכרח זהים:
> "Note that a WhatsApp user's ID and their phone number may not always match."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button

**INFERENCE.** "זהות השולח" לצורך שיוך חייבת להיות `from_user_id` (או `user_id`) כעוגן ראשי, עם `from`
כעוגן משני שאינו מובטח. fallback שמבוסס על טלפון מנורמל בלבד ייכשל בשקט למשתמשי usernames.

---

## 3. `messages[].context` — מתי קיים (→ Q9)

**DOCUMENTED (Meta).** אובייקט `context` עם `from` (מספר העסק) ו-`id` (ה-`wamid` של ההודעה היוצאת המקורית)
מופיע ב-reference payloads של:

| סוג הודעה נכנסת | `context.id` | מקור |
|---|---|---|
| `type: "button"` (לחיצה על quick-reply של **תבנית**) | כן | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button |
| `type: "interactive"` / `button_reply` | כן | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/interactive |
| `type: "interactive"` / `list_reply` | כן | https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages |
| `type: "location"` כמענה ל-location request | כן | https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages |
| `type: "text"` שנוצר מכפתור "Message business" (קטלוג) | כן, עם `referred_product` | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text |

עבור כפתור תבנית התיעוד מפורש:
> "It also provides a contextual message ID, which identifies the original template message that contained the button the user interacted with."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button

**DOCUMENTED (Meta).** ב-reference של `text`, ה-payload הבסיסי (משתמש שהקליד הודעה) **אינו כולל** `context`.
שני מופעי `context` בעמוד מסומנים בתנאי: "only if message originated from a 'Message business' button"
ו-"only if message forwarded to business by a user". במקרה ההעברה `context` מכיל רק
`forwarded` / `frequently_forwarded` **ללא `id`**.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/image (אותו דפוס למדיה)

**DOCUMENTED (Meta).** `reaction` **אינו** נושא `context`; ההפניה להודעה המקורית נמצאת ב-`reaction.message_id`:
> "The ID of the original message being reacted to."
כשהמשתמש מסיר ריאקציה, `emoji` מושמט אך `message_id` נשאר.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/reaction

**UNVERIFIED.** המקרה "משתמש ציטט (swipe-reply) הודעה של העסק והקליד טקסט חופשי": ה-reference הנוכחי של
`text` **לא מציג** דוגמה כזו; הוא מציג `context.id` רק לכפתור "Message business". ההתנהגות בפועל
(שציטוט מייצר `context.id`) מוכרת מהשטח אך לא אושרה ב-ctx7 היום. מצביע:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text

**INFERENCE.** לכן הכלל האמין היחיד: `context.id` **מובטח** רק כאשר המשתמש הגיב דרך רכיב שהעסק שלח
(כפתור תבנית, כפתור/רשימה אינטראקטיביים, בקשת מיקום). הודעה חופשית שהוקלדה מאפס **אינה** נושאת
`context.id`; הודעה מועברת נושאת `context` **ללא** `id`; ריאקציה נושאת `reaction.message_id` במקום.
מימוש שמחפש `context?.id` בלבד יפספס ריאקציות ויטפל נכון בהודעות מועברות (id חסר → fallback).

### תשובה ל-Q9

**סוגים שנושאים `context.id` באופן אמין:** `button` (תבנית), `interactive.button_reply`,
`interactive.list_reply`, `location` כמענה לבקשה, `text` מכפתור קטלוג. — **DOCUMENTED (Meta)**.

**מתי נעדר:** `text`/מדיה שהוקלדו מאפס (אין `context`); הודעה מועברת (`context` בלי `id`); `reaction`
(משתמש ב-`reaction.message_id`); ציטוט ידני של הודעת עסק — **UNVERIFIED** בתיעוד הנוכחי.

---

## 4. תשובות אינטראקטיביות ו-payload של כפתורים (→ Q11)

### 4.1 כפתורי reply אינטראקטיביים (`interactive.type: "button"`)

**DOCUMENTED (Meta).**
> "Each button requires a unique identifier of up to 256 characters and a label of up to 20 characters."
עד 3 כפתורים בהודעה; ה-`id` שהעסק שלח חוזר ב-webhook כ-`interactive.button_reply.id`, לצד `title`.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/interactive

### 4.2 הודעות רשימה (`interactive.type: "list"`)

**DOCUMENTED (Meta).** `rows[].id` — "Unique row identifier." (Required); חוזר כ-`interactive.list_reply.id`
לצד `title` ו-`description`.
> "Interactive list messages support a maximum of 10 sections, with a total limit of 10 rows across all sections combined."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/v25.0

**UNVERIFIED.** אורך מקסימלי ל-`rows[].id` לא הופיע בפלט ctx7 (שתי שאילתות ממוקדות). מצביע:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages

### 4.3 כפתורי quick-reply של תבניות

**DOCUMENTED (Meta).** בהגדרת התבנית: `{"type":"QUICK_REPLY","text":"<TEXT>"}` — "Button label text
(25 characters maximum)"; עד 10 כפתורי quick-reply בתבנית.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components

**DOCUMENTED (Meta).** בזמן השליחה ניתן לצרף payload:
> "Quick reply buttons can include an optional payload string, which is returned in the webhook notification when a user interacts with the button."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates

**DOCUMENTED (Meta).** ב-webhook: `type: "button"`, `button.payload` ו-`button.text`, בצירוף `context.id`
של הודעת התבנית. בדוגמה ללא payload מותאם, `payload` שווה ל-`text` (למשל `"Unsubscribe"`).
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button

**UNVERIFIED.** אורך מקסימלי ל-payload של quick-reply בתבנית ומגבלת charset לא הופיעו בפלט ctx7
(שלוש שאילתות ממוקדות). מצביע:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/send-template-messages

**DOCUMENTED (Meta).** תקדים בתוך אותו API: ל-`payload` של כפתור שיחה קולית בתבנית מתועד
"arbitrary string of up to 512 characters for tracking purposes" שאינו מעובד על ידי Cloud API.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/call-button-messages-deep-links

**INFERENCE.** בכל שלושת המנגנונים המפתח (העסק) שולט במלואו בערך המזהה שחוזר: `button_reply.id` (≤256),
`list_reply.id`, `button.payload`. לכן ניתן להטמיע **token אטום צד-שרת** (למשל מזהה חשיפה/`exposure_id`
או HMAC קצר) שמצביע על רשומת outbound יחידה, ובכך לקבל שיוך מדויק **גם בלי** להסתמך על `context.id`.
המגבלה המתועדת היחידה שנמצאה היא 256 תווים ל-`button_reply.id`; לשאר יש להניח שמרנית ≤128 עד אימות.

**INFERENCE (הסתייגות ידועה ב-KALFA).** בהערות ה-doctrine של הפרויקט מתועד שהשליחות היוצאות משתמשות
ב-URLComponent ולא ב-PayloadComponent, כך שכיום `button.payload` שחוזר שווה ל-`text` ואינו אטום.
מעבר ל-PayloadComponent הוא תנאי מוקדם לניצול Q11. נדרש אימות בקוד על ידי סוכן הקוד, לא כאן.

### תשובה ל-Q11

**כן.** מזהי reply של כפתורים/רשימות ו-payload של quick-reply הם מחרוזות בשליטת המפתח שחוזרות
כמות שהן ב-webhook — **DOCUMENTED (Meta)**. מגבלת אורך מתועדת: 256 ל-`button_reply.id`; לרשימה
ולתבנית האורך **UNVERIFIED** בפלט של היום. charset לא מתועד בפלט; token אלפאנומרי קצר הוא הבחירה הבטוחה.

---

## 5. Status webhooks ו-`biz_opaque_callback_data` (→ Q10)

**DOCUMENTED (Meta).** תחביר `statuses[]`: `id` (ה-`wamid` של ההודעה היוצאת), `status`, `timestamp`,
`recipient_id`, ובאופן מותנה: `recipient_type`/`recipient_participant_id` (קבוצות),
`recipient_identity_key_hash`, `biz_opaque_callback_data`, `conversation`, `pricing`, `errors`.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status

**DOCUMENTED (Meta).** על `biz_opaque_callback_data` בתחביר הסטטוס: "Only included if message sent with
biz_opaque_callback_data". כלומר הוא **הד** של ערך שהעסק צירף לבקשת השליחה, והוא מוחזר על סטטוסי
**אותה הודעה יוצאת**.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status

**DOCUMENTED (Meta).** מגבלת אורך מתועדת עבור Calling API: "arbitrary string of up to 512 characters for
tracking and logging purposes", לא מעובד על ידי Cloud API.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/reference

**UNVERIFIED.** אותה מגבלת 512 עבור **בקשת שליחת הודעה** (לא שיחה) לא הופיעה בפלט ctx7 למרות שלוש
שאילתות. מצביע:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages

**INFERENCE (חזק).** באף אחד מה-reference payloads של הודעות **נכנסות** שנשלפו (`text`, `image`,
`interactive`, `button`, `reaction`, `contacts`, `location`) **לא מופיע** השדה `biz_opaque_callback_data`.
הוא מופיע אך ורק תחת `statuses[]`. לכן הוא **אינו** יכול לתאם תשובה חופשית של משתמש.

**DOCUMENTED (Meta).** שינויים ב-v24.0+ שמשפיעים על "הוכחת חיוב" מתוך סטטוסים:
> "In version 24.0 webhooks, the conversation object may be omitted from status updates."
> "the pricing object is only included in one status webhook per message, typically appearing in the delivered status notification rather than the read status notification"
בתחביר: `pricing` מופיע רק עם `sent` ועם אחד מ-`delivered`/`read`; `conversation` מושמט ב-v24.0+ אלא
אם free entry point.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status

**INFERENCE.** ראיית חיוב של Meta (`pricing.billable`, `pricing.category`) מתייחסת ל**הודעה היוצאת** ואינה
קשורה לשאלה אם המשתמש ענה. השיוך של תשובה נכנסת לקמפיין הוא בעיה נפרדת שסטטוסים לא פותרים.

### תשובה ל-Q10

**מוגבל לסטטוסים יוצאים.** `biz_opaque_callback_data` מוחזר רק ב-`statuses[]` של ההודעה שנשלחה איתו
(**DOCUMENTED (Meta)**), ואינו קיים באף payload של הודעה נכנסת (**INFERENCE** מהיעדרו בכל ה-references).
הוא מתאים לקישור `wamid`→רשומת קמפיין בצד היוצא, לא לשיוך תשובה חופשית.

---

## 6. סמנטיקת מסירה: retries, כפילויות, סדר, batching, גודל

**DOCUMENTED (Meta).** retries:
> "If a webhook delivery fails or returns a non-200 HTTP status code, Meta will retry the delivery with decreasing frequency for up to 7 days."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview

**DOCUMENTED (Meta).** כפילויות הן תוצאה מתועדת של retries:
> "these retries are sent to all subscribed apps and may result in the receipt of duplicate webhook notifications"
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview

**DOCUMENTED (Meta).** batching והמלצת dedup:
> "aggregated into batches of up to 1000 updates, though batching is not guaranteed"
> "your server implementation should include logic to handle request deduplication"
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint

**DOCUMENTED (Meta).** גודל: "Webhook payloads are limited to a maximum size of 3 MB."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview

**DOCUMENTED (Meta).** סדר — הצהרה כללית על webhooks (בעמוד ה-FAQ של Calling):
> "Webhook ordering is not guaranteed due to the distributed nature of Meta's architecture and retry mechanisms."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/faq

**DOCUMENTED (Meta).** גם סדר מסירת ההודעות היוצאות אינו מובטח:
> "The Cloud API does not guarantee that messages will be delivered in the same order they were requested."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages

**INFERENCE.** הצהרת אי-הסדר מנוסחת על webhooks באופן כללי ("Meta's architecture and retry mechanisms")
ולא רק על שיחות; אין בסיס להניח ש-`field: "messages"` מקבל הבטחת סדר. יש להניח: סטטוס `delivered` לפני
`sent`, ותשובה נכנסת לפני סטטוס `sent` של ההודעה שהיא עונה עליה.

**DOCUMENTED (Meta).** קצה: במספרים עם No Storage, אם webhook נכנס לא נמסר בחלון השמירה, ההודעה נזרקת
ונשלח error webhook עם קוד `131035`:
> "While the Cloud API typically retries incoming message webhook deliveries for up to 7 days"
- https://developers.facebook.com/documentation/business-messaging/whatsapp/no-storage

**DOCUMENTED (Meta).** אימות מקור: יש לאמת חתימת `X-Hub-Signature-256` עם app secret (מתועד בעמוד
endpoint של Flows; אותו מנגנון חתימה של פלטפורמת Meta).
- https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint

**INFERENCE.** לא מתועד רשימת קודי HTTP "טובים" מלבד 200; כל non-200 (וגם timeout/כשל חיבור) מתפרש
ככישלון ומייצר retry. לכן persist-then-process חייב להחזיר 200 **מיד אחרי ה-persist**, לפני עיבוד.

### מה ה-persist-then-process חייב לסבול (INFERENCE מסכם, מבוסס על ה-DOCUMENTED לעיל)

1. **אותו `messages[].id` מגיע יותר מפעם אחת** (retry, ריבוי אפליקציות) — לעיתים ימים אחרי המקור.
2. **POST אחד מכיל כמה `entry`/`changes`/`messages`** — ה-dedup הוא ברמת הודעה בודדת, לא ברמת בקשה.
3. **אין סדר** — שיוך לא יכול להסתמך על "ההודעה היוצאת האחרונה נוצרה לפני התשובה"; ה-retry עלול להגיע
   אחרי שנוצרו outbound חדשים, ולכן החלטת השיוך חייבת להיות **immutable** ונשמרת בפעם הראשונה.
4. **payload עד 3 MB** — גבול לגודל שורת inbox.
5. **`from`/`wa_id` עלולים להיעדר** — מפתח השולח חייב לכלול `from_user_id`.

---

## 7. `referral`, `automatic_events`, `tracking_events` (→ Q12)

**DOCUMENTED (Meta).** `referral` על הודעה נכנסת: "Only included if message via a Click to WhatsApp ad."
שדות: `source_url`, `source_id`, `source_type` (`ad`/`post`), `body`, `headline`, `media_type`,
`image_url`/`video_url`/`thumbnail_url`, `ctwa_clid` (מושמט במיקום Status ad), `welcome_message`.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/v25.0
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text

**DOCUMENTED (Meta).** בעמוד welcome-message-sequences מופיע שדה `ref` בתוך `referral` ("New field in
referral") — פרמטר הפניה של המודעה, לא של תבנית.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/ctwa/welcome-message-sequences

**DOCUMENTED (Meta).** `automatic_events`:
> "notifies the business when a lead or purchase event is detected in a chat thread originating from a Click to WhatsApp ad"
> "available for businesses that have opted into Automatic Events reporting and are communicating with users who initiated contact via a Click to WhatsApp ad"
שדות: `id` (WhatsApp message ID), `event_name` (`LeadSubmitted`/`Purchase`), `timestamp`, `ctwa_clid`,
`custom_data{currency,value}`.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/automatic_events

**DOCUMENTED (Meta).** הצד השני של המנגנון הוא דיווח ל-Conversions API עם `user_data.ctwa_clid` ו-
`messaging_outcome_data.outcome_type: "automatic_events"` — כלומר מדידת המרות של מודעות.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/automatic-events-api

**UNVERIFIED.** `tracking_events`: שאילתה ישירה ("tracking_events") ושאילתת רשימת שדות ה-webhook לא החזירו
עמוד reference לשדה כזה; רשימת השדות בעמוד overview שהוחזרה מונה `account_alerts`,
`account_review_update`, `account_update`, `automatic_events`, `business_capability_update`, `history`,
`message_template_*`, `messages`, `smb_message_echoes`, `smb_app_state_sync`. מצביע (לא אומת):
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview

**INFERENCE.** שני המנגנונים מפותחים סביב `ctwa_clid` — מזהה קליק על **מודעה**. שיחה שנפתחת על ידי העסק
בתבנית (business-initiated) **אינה** מקבלת `referral` ואינה מייצרת `automatic_events`, כי אין קליק מודעה.
אין בהם שדה שמצביע על תבנית, קמפיין או `wamid` יוצא של העסק.

### תשובה ל-Q12

**לא.** `automatic_events` מוגבל לזיהוי ליד/רכישה בשרשורים שמקורם ב-Click-to-WhatsApp, עבור עסקים
שעשו opt-in — **DOCUMENTED (Meta)**. הוא אינו מכיל שדה שיוך לתבנית/קמפיין ואינו נורה על שיחות
שהעסק פתח בתבנית — **INFERENCE**. `tracking_events` — **UNVERIFIED** (לא נמצא reference).

---

## 8. Business-scoped user IDs / usernames (סיכום; נקרא ישירות היום ואומת ב-ctx7)

**DOCUMENTED (Meta).** ראו §2.2 לשדות. תוספות מה-ctx7:
- בשליחה ניתן לציין `to` (טלפון) **או** `recipient` (BSUID / parent BSUID); "If both are provided, the phone
  number takes precedence." שגיאה `131062` כשהתבנית אינה תומכת בנמען BSUID.
- תשובת השליחה מחזירה `contacts[]` עם `input`, `wa_id`, `user_id`.
- ב-`block_users` ניתן לחסום לפי `user` (טלפון) או `user_id` (BSUID).
- ב-`smb_message_echoes` מופיעים `to_user_id`/`to_parent_user_id` לצד `to`.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids

**DOCUMENTED (Meta).** בסטטוסי שיחות מופיע גם `recipient_user_id`/`recipient_parent_user_id` לצד
`recipient_id`.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/reference

**UNVERIFIED.** האם `statuses[]` של **הודעות** (לא שיחות) כולל כבר `recipient_user_id` — לא הופיע בתחביר
הסטטוס שנשלף. מצביע:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status

**INFERENCE.** לדיוק שיוך לאורך זמן, טבלת ה-ledger צריכה עמודת `sender_id` שמכילה BSUID כשקיים, ולא רק
טלפון מנורמל; ו-`contact_interactions` היוצאות צריכות לשמור `user_id` מתשובת השליחה כדי לאפשר התאמה
גם כשהטלפון נעלם מה-webhook.

---

## 9. Endpoint השליחה ומחזור חיי ה-`wamid`

**DOCUMENTED (Meta).** Endpoint:
`POST https://graph.facebook.com/<API_VERSION>/<BUSINESS_PHONE_NUMBER_ID>/messages`
(בעמוד BSUID). דוגמאות cURL בעמודי הודעות אינטראקטיביות משתמשות באותה צורה עם `v25.0`.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages

**DOCUMENTED (Meta).** התשובה: `messages[].id` = `wamid.…` (לעיתים עם `message_status: "accepted"`), ו-
`contacts[].wa_id`. ה-`wamid` משמש למעקב סטטוס.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-media
- https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-br/payment-request-cta

**DOCUMENTED (Meta).** אותו `wamid` מופיע כ-`statuses[].id` בסטטוסים, וכ-`context.id` בתשובת כפתור/רשימה
(ה-reference של `button` מגדיר את `context.id` כמזהה הודעת התבנית המקורית).
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button

**DOCUMENTED (Meta).** קיים גם `messaging_account_id` אופציונלי בגוף הבקשה "to specify which account to use
for billing and analytics" (מודל החשבונות החדש). לא רלוונטי ישירות לשיוך נכנס, אך רלוונטי לחיוב Meta.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging

**INFERENCE.** שרשרת הזהות המלאה: תשובת שליחה `messages[].id` → `statuses[].id` (אותו ערך, אותו
`metadata.phone_number_id`) → `context.id` בתשובה אינטראקטיבית. זהו הצמד היחיד שמאפשר התאמה **מדויקת**
ללא היוריסטיקה; כל השאר (טלפון, זמן) הוא candidate lookup.

---

## 10. טבלת תשובות מרוכזת

| שאלה | תשובה בשורה | תיוג | URL עיקרי |
|---|---|---|---|
| **Q9** אילו סוגים נושאים `context.id`, ומתי נעדר | מובטח ב-`button` (תבנית), `interactive.button_reply`/`list_reply`, `location` כמענה, `text` מכפתור קטלוג. נעדר ב-`text`/מדיה שהוקלדו מאפס; הודעה מועברת = `context` בלי `id`; `reaction` משתמש ב-`reaction.message_id`; ציטוט ידני לא מתועד. | DOCUMENTED (Meta) לנוכחות/היעדר ב-references; UNVERIFIED לציטוט ידני | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text · …/button · …/reaction |
| **Q10** האם `biz_opaque_callback_data` מתאם תשובה חופשית | לא. מוחזר רק ב-`statuses[]` של ההודעה שנשלחה איתו; לא קיים באף payload נכנס. | DOCUMENTED (Meta) להד בסטטוס; INFERENCE להיעדר בנכנס | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status |
| **Q11** האם מזהי reply/payload יכולים לשאת token אטום | כן. `button_reply.id` ≤256 תווים, `list_reply.id` ו-`button.payload` בשליטת המפתח וחוזרים כמות שהם; אורך לרשימה/תבנית ו-charset לא נמצאו. | DOCUMENTED (Meta) ל-256 ולהחזרה; UNVERIFIED לאורך רשימה/תבנית | https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages · …/webhooks/reference/messages/button |
| **Q12** האם `automatic_events` פותר שיוך RSVP | לא. מוגבל לליד/רכישה בשרשורי Click-to-WhatsApp עם opt-in; מבוסס `ctwa_clid`; אין שדה תבנית/קמפיין. `tracking_events` לא נמצא. | DOCUMENTED (Meta) להיקף; INFERENCE לאי-התאמה; UNVERIFIED ל-`tracking_events` | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/automatic_events |
| **ייחודיות `wamid`** גלובלית או לכל `phone_number_id` | לא מתועד scope; "unique" ללא הגדרה. מפתח בטוח: `unique (phone_number_id, inbound_message_id)`. | UNVERIFIED (scope); INFERENCE (מפתח מורכב) | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/standby (ציון "unique") · …/messages/send-messages (מצביע) |
| **Retries / כפילויות / סדר** | non-200 → retry בתדירות יורדת עד 7 ימים; retries לכל האפליקציות ⇒ כפילויות; batching עד 1000 לא מובטח; 3 MB; dedup מומלץ; סדר לא מובטח. | DOCUMENTED (Meta); INFERENCE להחלת אי-הסדר על `messages` | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview · …/webhooks/create-webhook-endpoint · …/calling/faq |

---

## 11. השלכות תכנוניות (INFERENCE בלבד — לשיקול סוכני הקוד/DB)

1. **מפתח idempotency:** `unique (phone_number_id, inbound_message_id)` — נגזר מ-§2.1 ו-§6. לא להסתפק
   ב-`inbound_message_id` לבד.
2. **מדרג שיוך:** `context.id` → `provider_id` יוצא הוא ההתאמה המדויקת היחידה שמתועדת (§3, §9). token אטום
   ב-`button.payload`/`button_reply.id` הוא ההתאמה המדויקת השנייה (§4), אך דורש PayloadComponent.
3. **תשובה חופשית:** אין ל-Meta שום מנגנון (לא `context`, לא `biz_opaque_callback_data`, לא `referral`,
   לא `automatic_events`) שמצמיד "Hi" לקמפיין ספציפי. שיוך כזה הוא היוריסטיקה בלבד ומחייב fail-closed
   בריבוי מועמדים.
4. **החלטה immutable:** בגלל retries עד 7 ימים ואי-סדר (§6), החלטת השיוך הראשונה חייבת להישמר ולהיות
   מוחזרת ב-retry, ולא לחושב מחדש נגד outbound חדשים.
5. **זהות שולח:** לשמור `from_user_id` לצד `from` (§2.2); fallback טלפוני בלבד ישבור עם usernames.
6. **`reaction`:** לטפל ב-`reaction.message_id` כמקבילה של `context.id` אם ריאקציות אמורות להיחשב
   תגובה (החלטה מוצרית, לא של Meta).

---

## נספח א — פקודות ctx7 שהורצו (2026-09-04, לפי סדר)

```
npx ctx7@latest library "Meta WhatsApp Business Platform" "incoming messages webhook payload context id"
npx ctx7@latest library "Facebook Business Messaging WhatsApp" "webhooks messages"

# סבב 1 — נושא לכל שאילתה (a–i)
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "incoming messages webhook payload structure entry changes value metadata phone_number_id display_phone_number contacts messages"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "messages id wamid uniqueness from wa_id metadata phone_number_id from_user_id omitted from"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "messages context object when present reply quoted message button tap template context id free-form message reaction message_id"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "interactive button_reply id title list_reply id title quick reply button payload maximum length characters"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "statuses webhook recipient_id conversation pricing biz_opaque_callback_data"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "webhook delivery retries duplicate notifications ordering batching payload size limit 3MB idempotency respond 200"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "referral object click to WhatsApp ads automatic_events tracking_events webhook lead purchase detection"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "business-scoped user IDs usernames from_user_id recipient_user_id contacts user_id phone number omitted 30-day lookback contact book"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "send message endpoint POST graph.facebook.com PHONE_NUMBER_ID messages response messages id wamid statuses id"

# סבב 2 — השלמות ממוקדות
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "template quick reply button webhook payload button.payload button.text type button context"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "reaction message webhook payload reaction.message_id emoji incoming"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "text message webhook payload user replies to quoted message context id forwarded frequently_forwarded"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "biz_opaque_callback_data send message request parameter arbitrary string 512 characters returned in status webhook"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "interactive list message row id maximum 200 characters title 24 characters sections rows"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "quick reply button template component payload parameter maximum 128 characters developer-defined"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "tracking_events webhook reference field"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "webhooks may arrive out of order not guaranteed sequence status delivered before sent"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "WhatsApp message ID wamid format unique identifier per message globally unique base64"

# סבב 3 — reference objects ושדות ספציפיים
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "StatusObject incoming webhook payload reference v25.0 biz_opaque_callback_data recipient_id conversation pricing errors"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "message-api v25.0 request body biz_opaque_callback_data property arbitrary string"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "ContextObject MessageObject incoming webhook payload reference v25.0 context id from forwarded referred_product"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "interactive list messages request parameters row id maximum length title 24 description 72 rows 10"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "send template message button component sub_type quick_reply index parameters type payload string"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "webhook subscription fields list messages account_update tracking_events smb_message_echoes history"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "webhooks overview respond 200 OK quickly asynchronous processing verify X-Hub-Signature-256 app secret"

# סבב 4 — ניסיונות אחרונים לנקודות UNVERIFIED
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "send messages request body biz_opaque_callback_data included in status webhook tracking"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "template message quick reply button payload 128 characters returned in webhook developer-defined"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "list message row id 200 characters unique identifier limit"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "tracking_events"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "context object only included when user replies to or interacts with one of your messages webhook messages reference"
npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "send-messages message ID response track status statuses webhook id same wamid"
```

## נספח ב — נקודות שנותרו UNVERIFIED (לסגירה מול העמוד החי, לא מול ctx7)

| נקודה | מצביע |
|---|---|
| scope ייחודיות `wamid` (גלובלי / לכל `phone_number_id`) | https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages |
| `context.id` בציטוט ידני (swipe-reply) של הודעת עסק בטקסט חופשי | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text |
| אורך מקסימלי ל-`rows[].id` ברשימה | https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages |
| אורך מקסימלי ו-charset ל-`payload` של quick-reply בתבנית | https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/send-template-messages |
| מגבלת 512 ל-`biz_opaque_callback_data` בבקשת **הודעה** (מתועד רק ל-Calling) | https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages |
| קיום reference ל-`tracking_events` | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview |
| `recipient_user_id` ב-`statuses[]` של הודעות (לא שיחות) | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status |
