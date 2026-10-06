# יכולות `@chat-adapter/whatsapp` 4.41.0 ו-Chat SDK על WhatsApp: קטלוג מלא, פערי תיעוד מול קוד, והתאמה ל-RSVP של אורחים

תאריך: 2026-09-30. סוג: מחקר לקריאה בלבד. לא שונה שום קוד.

גרסאות שנבדקו: `@chat-adapter/whatsapp` 4.41.0, `chat` 4.41.0, `@chat-adapter/shared` 4.41.0. הגרסאות נבדקו ב-`package.json` של כל חבילה. יש עותק אחד בלבד של `chat` ב-`node_modules/chat`, ואין `node_modules` מקונן תחת האדפטר.

## מוסכמות

- `dist:N` מפנה לשורה בקובץ `node_modules/@chat-adapter/whatsapp/dist/index.js`.
- `d.ts:N` מפנה לשורה בקובץ `dist/index.d.ts` של האדפטר.
- `chat/dist/...:N` מפנה לליבת ה-SDK. `shared:N` מפנה לקובץ `node_modules/@chat-adapter/shared/dist/index.js`.
- **MEASURED** פירושו שהטענה נקראה בקוד או בתיעוד. **MEASURED (probe)** פירושו שהיא גם אומתה בהרצה: סקריפט Node inline עם `fetch` מדומה, credentials מזויפים ו-`new WhatsAppAdapter` ישיר. לא נשלחה אף הודעה אמיתית ולא נוצר אף קובץ.
- **INFERRED** פירושו מסקנה שלא נמדדה ישירות.

---

## (A) רשימת כיסוי: כל מה שנקרא

### חבילת האדפטר (נקראה במלואה, שורה אחר שורה)

| קובץ | שורות |
|---|---|
| `node_modules/@chat-adapter/whatsapp/README.md` | 347 |
| `node_modules/@chat-adapter/whatsapp/dist/index.d.ts` | 917 |
| `node_modules/@chat-adapter/whatsapp/dist/index.js` | 2226 |
| `node_modules/@chat-adapter/whatsapp/package.json` | 67 |

### `node_modules/chat/docs/` (51 קבצים, כולם נקראו במלואם)

שורש התיקייה:

| קובץ | שורות |
|---|---|
| actions.mdx | 152 |
| adapters.mdx | 166 |
| approvals.mdx | 111 |
| cards.mdx | 380 |
| concurrency.mdx | 268 |
| create-chat-sdk.mdx | 171 |
| direct-messages.mdx | 74 |
| emoji.mdx | 81 |
| ephemeral-messages.mdx | 79 |
| error-handling.mdx | 182 |
| files.mdx | 98 |
| getting-started.mdx | 37 |
| handling-events.mdx | 567 |
| history.mdx | 256 |
| index.mdx | 89 |
| meta.json | 41 |
| modals.mdx | 363 |
| platform-adapters.mdx | 101 |
| posting-messages.mdx | 206 |
| slash-commands.mdx | 143 |
| state-adapters.mdx | 53 |
| streaming.mdx | 319 |
| subject.mdx | 54 |
| testing.mdx | 142 |
| threads-messages-channels.mdx | 389 |
| usage.mdx | 168 |
| vercel-connect.mdx | 243 |

תיקיית `ai/`:

| קובץ | שורות |
|---|---|
| ai-sdk-tools.mdx | 334 |
| index.mdx | 73 |
| meta.json | 4 |
| tanstack-ai.mdx | 204 |
| to-ai-messages.mdx | 209 |
| types.mdx | 282 |

תיקיית `api/`:

| קובץ | שורות |
|---|---|
| cards.mdx | 364 |
| channel.mdx | 196 |
| chat.mdx | 835 |
| history.mdx | 418 |
| index.mdx | 45 |
| markdown.mdx | 303 |
| message.mdx | 288 |
| meta.json | 16 |
| modals.mdx | 384 |
| postable-message.mdx | 235 |
| thread.mdx | 368 |
| transcripts.mdx | 231 |

תיקיית `contributing/`:

| קובץ | שורות |
|---|---|
| building.mdx | 719 |
| documenting.mdx | 219 |
| meta.json | 10 |
| publishing.mdx | 199 |
| testing.mdx | 499 |
| vendor-official.mdx | 115 |

סך הכול ב-`chat/docs`: 11,483 שורות.

### תיעוד מקוון

| כתובת | אופן הקריאה |
|---|---|
| https://chat-sdk.dev/adapters/official/whatsapp.md | 317 שורות, נקרא במלואו. זו גרסת ה-markdown של העמוד. |
| https://chat-sdk.dev/adapters/official/whatsapp | גרסת ה-HTML. חילצתי ממנה את טבלת `<FeatureSupport />`, כולל צבע הסטטוס של כל שורה. |
| Meta, `.../whatsapp/messages/contextual-replies/` | 78 שורות, **נקרא במלואו אחרי חילוץ מחדש** (ראו השיטה מתחת לטבלה). |
| Meta, `.../whatsapp/business-scoped-user-ids/` | 3,058 שורות, **נקרא במלואו אחרי חילוץ מחדש**, כולל ה-changelog עד 15.9.2026. |
| Meta, `.../whatsapp/support/error-codes/` | 654 שורות, **נקרא במלואו אחרי חילוץ מחדש**. |
| Meta, `.../whatsapp/messages/template-messages` (הקישור מה-README) | 2 שורות: "This page has moved. See Template fundamentals". נקרא במלואו. |
| Meta, `.../whatsapp/templates/overview` ("Template fundamentals", היעד של ההפניה) | 233 שורות, **נקרא במלואו**. |
| Meta, `.../whatsapp/templates/components/` | 799 שורות, **נקרא במלואו**. הכתובת נמצאה דרך `devtools_discovery` של Meta MCP. |
| Meta, `.../webhooks/reference/messages/button/` | 171 שורות, **נקרא במלואו**. לא קושר מהתיעוד, אבל זו הלחיצה על quick reply של תבנית. |
| Meta, `.../webhooks/reference/messages/interactive/` | 367 שורות, **נקרא במלואו**. |
| Meta, `.../webhooks/reference/messages/status/` | 366 שורות, **נקרא במלואו**. |
| Meta, `.../whatsapp/typing-indicators` | 93 שורות, **נקרא במלואו** (סבב 3). |
| Meta, `.../whatsapp/messages/mark-message-as-read` | 89 שורות, **נקרא במלואו** (סבב 3). הכתובת `.../whatsapp/read-receipts` לא החזירה עץ תוכן. |
| Meta, `.../whatsapp/messages/interactive-reply-buttons-messages` | 277 שורות, **נקרא במלואו** (סבב 3). |
| Meta, `.../whatsapp/messages/interactive-list-messages` | 283 שורות, **נקרא במלואו** (סבב 3). |
| Meta, `.../whatsapp/flows` (Flows overview) | 61 שורות, **נקרא במלואו** (סבב 3). `.../flows/overview` לא החזיר עץ תוכן. |
| Meta, `.../whatsapp/flows/guides/sendingaflow` | 378 שורות, **נקרא במלואו** (סבב 3). |
| Meta, `.../whatsapp/flows/guides/flowswebhooks` (כולל nfm_reply) | 467 שורות, **נקרא במלואו** (סבב 3). `.../receiveflowresponse` מפנה לאותו עמוד, עם תוכן זהה. |

**שיטת החילוץ לעמודי Meta:**
- לא הסתמכתי על סיכומי WebFetch. אלה מהסבב הקודם הוחלפו לגמרי.
- `curl` עם User-Agent `Mozilla/5.0` ו-`?locale=en_US` מחזיר HTML מלא (700KB–1MB). User-Agent של Chrome מלא נחסם בדף Error.
- גוף המאמר מוטמע בדף כעץ JSON של רכיבים (`DMC*`, `Developer*`), כמחרוזת JSON בתוך `<script type="application/json">`.
- סקריפט Python פירק את העץ לטקסט, לפי סדר הצמתים, כולל בלוקי הקוד (`DeveloperPre`/`DeveloperCode`).
- כל קובץ טקסט נקרא עד סופו עם Read (העמוד הארוך בחלקים: 1–1000, 1000–2000, 2000–3059).
- בדיקת שלמות: כל עמוד מסתיים בסעיף האחרון שמופיע בתפריט הניווט שלו (למשל Webhooks בעמוד components, ו-changelog בעמוד BSUID).
- מגבלה: הטקסט מכיל שאריות תוויות רכיבים (למשל `GalaxyHTMLEmString`) ואינו מציג תמונות. התוכן הטקסטואלי מלא.

**לא נקראו:**
- עמודי adapter של Redis ו-PostgreSQL שהעמוד המקוון מקשר אליהם. הם לא ספציפיים ל-WhatsApp.
- מתחום Flows לא נקראו Flow JSON, ה-endpoint, מדריך ה-Get Started וה-changelog. טענות שנשענות עליהם מסומנות INFERRED.

### קבצי החבילה עצמה

`find` על `node_modules/@chat-adapter/whatsapp` מחזיר חמישה קבצים בלבד: `LICENSE` (9 שורות, MIT, נקרא), `README.md`, `dist/index.d.ts`, `dist/index.js` ו-`package.json`. כולם נקראו במלואם. `index.js` נקרא בארבעה חלקים רציפים (1–560, 560–1119, 1119–1678, 1678–2227), בלי פער ביניהם.

### קוד ליבה שנבדק כדי לאמת טענות תיעוד (קטעים ממוקדים, לא קבצים מלאים)

- `chat/dist/index.js`: שורות 1200–1240 (`processAction`), 1656–1805 (`handleActionEvent`, **כל הפונקציה עד סופה**), 2118–2170 (`routeIncomingMessage` ו-`dispatchIncomingMessage`).
- `chat/dist/chunk-TZYBST6B.js`: שורות 339–350 (callback token), 662–673 (fallback ל-`postChannelMessage` ו-append להיסטוריה).
- `chat/dist/workflow/index.js`: שורות 60–140 (`requestApproval`).
- `@chat-adapter/shared/dist/index.js`: שורות 179–216 (`cardToFallbackText`) ו-375–400 (מגבלות הורדה). בוצע גם grep על redirect ועל חסימת IP.

### הקוד שלנו (נקרא במלואו)

| קובץ | שורות |
|---|---|
| `src/lib/owner-agent/whatsapp/adapter.ts` | 237 |
| `src/lib/owner-agent/whatsapp/media.ts` | 129 |
| `src/lib/owner-agent/whatsapp/send.ts` | 343 |
| `src/lib/owner-agent/whatsapp/send.test.ts` | 371 |
| `src/lib/owner-agent/whatsapp/media.test.ts` | 207 |

### אימות קריאה מלאה (בדיקת קטיעות)

| פריט | סטטוס |
|---|---|
| חמשת קבצי האדפטר | נקרא במלואו. Read החזיר את כל השורות, ו-index.js נקרא ב-4 חלקים רציפים. |
| 51 קבצי `chat/docs` | נקרא במלואו. קבצים גדולים (chat.mdx 835, handling-events 567, building 719) נקראו ב-Read מלא, מתחת למגבלת 2000 השורות. אצוות `cat` שחרגו מ-30KB נשמרו לקובץ ונקראו ממנו עד הסוף (אצווה ראשונה 781 שורות, ai-sdk-tools ו-tanstack 541 שורות). שאר האצוות הודפסו במלואן בלי סימן קטיעה. |
| העמוד המקוון `.md` | נקרא במלואו (317 שורות, `cat -n`). |
| טבלת FeatureSupport | חולצה במלואה מה-HTML: כל 41 השורות עם צבע הסטטוס. |
| עמודי Meta מהסבב הקודם (4 עמודים) | **נקראו מחדש אחרי קטיעה.** קודם היו סיכומי WebFetch; הוחלפו בטקסט מלא. |
| עמוד template components | **נקרא מחדש.** קודם לא נקרא; עכשיו נקרא במלואו. |
| קוד שלנו (5 קבצים) | נקרא במלואו. |
| קוד הליבה | קריאה ממוקדת של פונקציות שלמות בלבד, מסומנת למעלה. זו לא קריאה של הקובץ כולו. |

grep על כל `src` מראה שרק `adapter.ts` מייבא את `@chat-adapter/whatsapp`. **אף קובץ ב-`src` לא מייבא את `chat`.** גם החבילה `@chat-adapter/state-pg` מופיעה ב-package.json ואינה מיובאת בשום מקום. מבחינת WhatsApp, אנחנו משתמשים היום רק במחלקה `WhatsAppAdapter` כ-HTTP client לשליחה ולהורדת מדיה. `Chat`, handlers ו-state אינם בשימוש.

---

## (B) קטלוג יכולות

### B.1 תצורה ומשתני סביבה

- **API:** `createWhatsAppAdapter(config?)` (dist:2177-2218) או `new WhatsAppAdapter({...})` (dist:680-690).
- **שדות:**
  - `accessToken`, `appSecret`, `phoneNumberId`, `verifyToken`: חובה. ה-factory זורק `ValidationError` אם אחד מהם חסר.
  - `apiVersion`: ברירת מחדל `v25.0` (dist:538).
  - `apiUrl`: ברירת מחדל `https://graph.facebook.com`.
  - `userName`: ברירת מחדל `whatsapp-bot`.
  - `logger`: ב-factory ברירת המחדל היא `ConsoleLogger("info")`. בבנאי הישיר אין ברירת מחדל.
- **משתני סביבה (רק דרך ה-factory):** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_BOT_USERNAME`, `WHATSAPP_API_URL`.
- **credentials:** מחרוזת סטטית בלבד. אין צורת פונקציה (d.ts:69-86).
- **סטטוס:** נתמך. MEASURED.
- **אצלנו:** `adapter.ts` בונה ישירות ולעולם לא דרך ה-factory, כדי שמשתני `WHATSAPP_*` לא ייכנסו. זה נבדק בטסט sentinels.

### B.2 Webhook ואימות חתימה

- **API:** `handleWebhook(request, options)` (dist:708-778), או `bot.webhooks.whatsapp`.
- **GET:** `hub.mode=subscribe` עם השוואה ל-`verifyToken`. בהצלחה מוחזר ה-challenge, ובכישלון 403 (dist:784-798).
- **POST:** HMAC-SHA256 של הגוף הגולמי עם `appSecret`. ההשוואה ל-`x-hub-signature-256` נעשית ב-`timingSafeEqual` (dist:804-817). חתימה חסרה או שגויה מחזירה 401. JSON לא תקין מחזיר 400.
- **עיבוד:** מעובדים רק `field === "messages"` ו-`field === "user_id_update"` (dist:732-737).
- **`value.statuses` לא נקרא בכלל.** זה כולל sent, delivered, read ו-failed, וגם את שגיאות המסירה האסינכרוניות כמו 131049 ו-131026. MEASURED (probe): status מסוג failed לא יצר אף קריאה.
  - לפי Status messages webhook reference (נקרא במלואו), statuses כוללים:
    - `sent`, `delivered`, `read`, `failed` ו-`played`.
    - `errors[]` עם `code`, `title`, `message`, `error_data.details` ו-`href`.
    - `biz_opaque_callback_data`, אם נשלח.
    - `pricing` ו-`recipient_id`.
  - Meta מציינת ש-delivered לא נשלח כשההודעה נקראה מיד; במקרה כזה מגיע רק read.
  - כל המידע הזה לא מגיע לאדפטר. MEASURED.
- **תגובה:** 200 `ok` מוחזר אחרי שכל ההודעות נשלחו ל-`chat.process*`. ה-handlers עצמם רצים דרך `waitUntil`.
- **גוף בלי `entry`:** גוף חתום כמו `{}` זורק `TypeError`, כי `payload.entry` אינו iterable (dist:730). MEASURED (probe). המשמעות: 500 מה-framework ולא 400.
- **סטטוס:** נתמך חלקית. אין persist-then-process ואין קליטת statuses.

### B.3 סוגי הודעות נכנסות

| סוג | מה נוצר | טקסט (`extractTextContent`, dist:1122-1155) | attachment (dist:1190-1264) |
|---|---|---|---|
| text | message | גוף ההודעה | — |
| image | message | caption, או `[Image]` | image עם `fetchData` עצל |
| document | message | caption, או `[Document: name]` | file |
| audio / voice | message | `[Audio message]` / `[Voice message]` | audio |
| video | message | `[Video]` | video |
| sticker | message | `[Sticker]` | image בשם "sticker" |
| location | message | `[Location: ...]` | file עם URL של Google Maps |
| reaction | `processReaction` (dist:876-902) | — | — |
| interactive button_reply / list_reply | `processAction` (dist:906-943) | — | — |
| button (quick reply של תבנית) | `processAction` (dist:947-971) | — | — |
| system | מעדכן זהות בלבד ולא מגיע ל-handler (dist:757-759) | — | — |
| contacts, order, template, unsupported | **נזרק בשקט** (return null) | — | — |
| interactive `nfm_reply` (Flows; המבנה לפי Meta ב-D.4) | **נזרק בשקט** (dist:927-929) | — | — |

כל השורות בטבלה נבדקו ב-probe: nfm_reply ו-contacts לא יצרו אף קריאה. MEASURED (probe).

**`message.replyTo` לעולם לא מאוכלס** (`buildMessage` ב-dist:1159-1186). כשאורח מצטט הודעה, מזהה ההודעה המצוטטת זמין רק דרך `message.raw.message.context.id`. MEASURED (probe). המסמך המקוון מודה בכך במפורש.

### B.4 זהות משתמש, BSUID ו-threads

- **thread ID:** `whatsapp:{phoneNumberId}:{userId}` (dist:1793-1826). בכל שיחה, channel === thread (dist:1831-1833). `isDM` תמיד true.
- **זיהוי המשתמש:** `fields()` (dist:981-987) בוחר את הטלפון תחילה. אם אין טלפון הוא לוקח BSUID, ואם אין BSUID הוא לוקח parent BSUID.
- **aliasים ומסלולים:** `resolve()` ו-`link()` (dist:988-1093) שומרים ב-state את `whatsapp:identity:alias:*` ואת `whatsapp:identity:route:*`.
- **`user_id_update`:** מטופל ב-dist:1033-1068. ה-BSUID הקודם והנוכחי מקושרים לאותו משתמש קנוני. **אבל לפי Meta אין field כזה** (ראו C.16), כך שהקוד הזה לא יופעל אף פעם.
- **רוטציית BSUID בפועל:** Meta שולחת הודעת `system` מסוג `user_changed_number` או `user_changed_user_id`, עם `system.previous_user_id`.
  - הטיפוס של האדפטר (d.ts:256-262) לא כולל `previous_user_id`, ו-`resolve()` (dist:988-1024) לא קורא אותו.
  - הקישור לזהות הישנה נעשה רק דרך `inbound.from`, וב-`user_changed_user_id` אין `from` כשאין טלפון.
  - **MEASURED (probe):** משתמש BSUID-only ‏`IL.OLD1`, אחריו system בצורת Meta עם `previous_user_id: IL.OLD1` ו-`user_id: IL.NEW2`, ואחריו הודעה חדשה. התוצאה: שני threads נפרדים (`whatsapp:111:IL.OLD1` ו-`whatsapp:111:IL.NEW2`). הרציפות נשברה.
- **בחירת נמען:** `recipient()` (dist:1094-1114) קורא את ה-route מ-state. יש route: נשלחים גם `to` וגם `recipient`. אין route ואין Chat: מזהה בתבנית BSUID (dist:561) נשלח ב-`recipient`, וכל השאר ב-`to`.
- **מגבלת Meta:** תבניות אימות מסוג one-tap, zero-tap ו-copy-code דורשות טלפון. הנוסח מופיע ב-README ובעמוד BSUID של Meta, שנקרא במלואו. MEASURED.
- **מתי Meta משמיטה את הטלפון** (עמוד BSUID, סעיף Phone numbers, נקרא במלואו): רק כשהמשתמש אימץ username **וגם** אף אחד מהתנאים הבאים לא מתקיים:
  - שלחנו אליו הודעה או שיחה ב-30 הימים האחרונים;
  - קיבלנו ממנו הודעה או שיחה ב-30 הימים האחרונים;
  - הוא נמצא ב-contact book של Meta.
  - תנאי 30 הימים נבדק **לפי מספר עסקי**, ולא לפי כל התיק העסקי.
  - MEASURED מהתיעוד.
- **שגיאה חדשה 131062:** "BSUID recipients are not supported for this message". MEASURED מהתיעוד.
- **כפתור `REQUEST_CONTACT_INFO`:** כפתור בתבנית, או interactive מסוג `request_contact_info`, שמבקש מהמשתמש לשתף טלפון. ה-webhook חוזר כהודעת `contacts` עם `origin: contact_request`. **האדפטר לא יכול לשלוח אותו**, כי זה לא אחד מסוגי ה-interactive שלו. הוא גם זורק בשקט את הודעת ה-`contacts` שחוזרת (dist:1152-1153). MEASURED.
- **סטטוס:** נתמך. דורש state מתמיד, כי בלי Chat אין aliasים. MEASURED.

### B.5 שליחת טקסט, תגובה לציטוט ופיצול

- **API:** `postMessage(threadId, msg)` (dist:1344), `reply(threadId, messageId, msg)` (dist:1398-1400), ובליבה `thread.post` ו-`thread.reply`.
- **מגבלה:** 4096 תווים (dist:539). טקסט ארוך יותר מפוצל ב-`splitMessage` (dist:639-661): קודם בגבול פסקה `\n\n`, אחר כך בגבול שורה `\n`, ורק בסוף חיתוך קשיח. הפיצול נעשה רק כשנקודת הפיצול נמצאת אחרי אמצע החלון.
- **הודעה שפוצלה:** נשלחת כסדרה, ומוחזר המזהה של החלק האחרון בלבד (dist:1534-1548).
- **`preview_url`:** תמיד false (dist:1506). אין אפשרות לתצוגה מקדימה של קישור.
- **ציטוט:** `context.message_id` מצורף רק להודעה הראשונה בסדרה (dist:1543).
- **מחרוזת פשוטה:** נשלחת כפי שהיא, בלי המרת markdown (dist:494-496). MEASURED (probe): `**עולם**` יצא כפי שהוא.
- **`{markdown}` ו-`{ast}`:** עוברים דרך `WhatsAppFormatConverter` (dist:435-534). כותרת הופכת לטקסט מודגש. `---` הופך ל-`━━━`. טבלה הופכת לבלוק קוד ASCII. `**x**` הופך ל-`*x*`, ו-`~~x~~` הופך ל-`~x~`.
- **emoji:** placeholders מומרים בכל נתיב (`convertEmojiPlaceholders`).
- **סטטוס:** נתמך. תגובה לציטוט עובדת ביציאה בלבד.

### B.6 Streaming

- **API:** `stream()` (dist:1660-1670), או `thread.post(asyncIterable)`.
- **התנהגות:** כל ה-chunks נצברים ונשלחת הודעה אחת בסוף. רק מחרוזות ו-chunks מסוג `markdown_text` נאספים. `task_update` ו-`plan_update` נזרקים.
- **`Plan`:** לפי streaming.mdx:291 הוא נשלח כטקסט fallback, ושינויים שנעשים אחר כך לא מגיעים לנמען. זה כתוב בתיעוד ולא נבדק בקוד, ולכן INFERRED.
- **סטטוס:** חלקי (buffered). MEASURED.

### B.7 Cards: מה כל רכיב הופך להיות ב-WhatsApp

המיפוי נעשה ב-`cardToWhatsApp` (dist:58-106). יש שלושה נתיבי פלט אפשריים בלבד:

1. `interactive` מסוג `button`: כשיש לפחות `Button` אחד עם `id` ב-**Actions הראשון** שנמצא.
2. `interactive` מסוג `cta_url`.
3. טקסט.

**אין נתיב שמייצר `interactive` מסוג `list`.**

| רכיב | בנתיב interactive (כשיש Button) | בנתיב טקסט (dist:107-183) | סטטוס |
|---|---|---|---|
| `Card.title` | header מסוג text, נחתך ל-60 (dist:224-236) | `*title*` | נתמך |
| `Card.subtitle` | שורה ראשונה ב-body | שורה רגילה | נתמך |
| `Card.imageUrl` | **נזרק** | ה-URL כשורת טקסט | חלקי |
| `CardText` (plain, bold, muted) | טקסט גולמי ב-body; הסגנון **נזרק** (dist:184-197) | `*bold*` / `_muted_` | נתמך |
| `Fields` / `Field` | `label: value` | `*label:* value` | נתמך כטקסט |
| `Section` | שטוח | שטוח | נתמך |
| `Divider` | **נזרק** | `---` | חלקי |
| `Image` | **נזרק**. MEASURED (probe) | `alt: url` | חלקי |
| `Button` (≤3) | כפתורי reply. הכותרת נחתכת ל-20; ה-id הוא `chat:{"a":id,"v":value}` (dist:30-36) | `[label]` | נתמך |
| `Button` (>3) | **רק 3 הראשונים נשלחים, והשאר נזרקים** (dist:222). MEASURED (probe) | — | חלקי (ראו C.1) |
| `LinkButton` | שורת `Label: url` בתוך ה-body (dist:134-138) | `Label: url` | חלקי |
| `LinkButton` יחיד בכל הכרטיס | `cta_url` ל-http או https בלבד (dist:237-273). MEASURED (probe) | — | נתמך בתנאים |
| `Select` / `RadioSelect` | **נזרקים בשקט.** אם יש גם Button, יוצא רק הכפתור. MEASURED (probe) | `[label]`; **כל האפשרויות אובדות**. MEASURED (probe) | לא נתמך |
| `Table` | **נזרק** | **נזרק**: אין case ב-`renderChild`, dist:139-159. MEASURED (probe) | לא נתמך (ראו C.4) |
| `Chart` | **נזרק** | **נזרק**. MEASURED (probe) | לא נתמך |
| `CardLink` | **נזרק** | **נזרק**. MEASURED (probe) | לא נתמך |
| Actions שני ואילך | **נזרקים**: `findActions` מחזיר רק את הראשון (dist:198-211). MEASURED (probe) | מוצגים | חלקי |
| `style`, `tooltip`, `actionType`, `width` | מתעלמים | מתעלמים | לא רלוונטי |
| `callbackUrl` ב-Button | הליבה מחליפה את `value` ב-`__cb:<16hex>` (chunk-TZYBST6B.js:339-350). ה-token נכנס ל-id | — | נתמך |

**מגבלות וחיתוכים:**
- body: 1024. header: 60. כותרת כפתור: 20 (dist:26-29).
- אין footer בכלל: הוא לא נבנה אף פעם.
- החיתוך סופר יחידות UTF-16 ולא code points (dist:311-316). אם emoji נופל על נקודת החיתוך, **נשאר surrogate בודד ושבור.** MEASURED (probe): כותרת בת 20 תווים הסתיימה ב-`\ud83c…`.
- אורך ה-id לא נבדק מול מגבלת Meta. לפי `send.ts:36` המגבלה היא 256. ה-id לא נחתך ולא נדחה.

**כרטיס עם files או attachments** (dist:1404-1484):
- המדיה נשלחת תחילה, בלי CTA.
- אם הכרטיס ממופה לכפתורים, המדיה יוצאת בלי caption והכפתורים יוצאים אחריה.
- אם הכרטיס ממופה לטקסט, הוא הופך ל-caption של המדיה הראשונה. הטקסט נבנה דרך `cardToFallbackText` של shared (shared:179-216), **שבו טבלה ו-CardLink כן מוצגים.** כלומר, בנתיב המדיה ובנתיב בלי מדיה הרינדור שונה.

### B.8 כפתורי reply ורשימות (lists)

- **שליחת כפתורי reply:** נתמכת, עד 3 כפתורים. MEASURED (probe).
- **שליחת רשימה:** אין שום נתיב ציבורי שמייצר אותה.
  - `WhatsAppInteractiveMessage` מגדיר גם `list` (d.ts:377-389), אבל אין קוד שבונה אותו.
  - הדרך היחידה היא לקרוא למתודה המוגנת `sendInteractiveMessage` (dist:1552-1583) עם payload מוכן. כך בדיוק עושה `sendOwnerAgentList` אצלנו (send.ts:222-270, דרך adapter.ts:164-171).
  - MEASURED.
- **קבלת רשימה:** נתמכת. `list_reply` מפוענח ומגיע ל-onAction (dist:924-926). MEASURED (probe): `{"a":"count","v":"3"}` הגיע כ-`actionId=count` ו-`value=3`.
- **מגבלות רשימה של Meta** (עמוד Interactive list messages, נקרא במלואו, MEASURED):
  - עד 10 sections, ועד 10 שורות **בסך הכול** בכל ה-sections יחד.
  - body עד 4096. header טקסט בלבד, עד 60. footer עד 60. כפתור הפתיחה עד 20.
  - כותרת section עד 24. id של שורה עד 200. כותרת שורה עד 24. תיאור שורה עד 72.
  - ה-webhook ‏`list_reply` נושא `id`, `title` ו-`description`, ו-`context.id` של הודעת הרשימה.
  - `WA_LIMITS` ב-`send.ts:32-48` תואם את כל הערכים האלה. האדפטר עצמו לא אוכף אותם.
- **מגבלות כפתורי reply של Meta** (עמוד Interactive reply buttons messages, נקרא במלואו, MEASURED):
  - עד 3 כפתורים.
  - id עד 256. תווית עד 20, ו-"**Must be unique if using multiple buttons**".
  - body עד 1024. footer עד 60.
  - **header יכול להיות image, video, document או text.**
  - פערים באדפטר:
    - האדפטר תומך רק ב-header טקסט (d.ts:355-357).
    - הוא לא בונה footer.
    - הוא לא בודק ייחודיות תוויות או אורך id.
    - לכן תמונה יחד עם כפתורים יוצאת כשתי הודעות נפרדות (B.7), למרות ש-Meta מאפשרת הודעה אחת.
  - `sendOwnerAgentButtons` שלנו בודק ייחודיות **ids** (send.ts:191) ולא ייחודיות **תוויות**, שהיא הדרישה של Meta.

### B.9 CTA URL

- **API:** כרטיס שבו `LinkButton` יחיד (dist:83-101 ו-237-273).
- **תנאים:**
  - http או https בלבד.
  - תווית לא ריקה.
  - אין `imageUrl`, Image, Table, Chart או CardLink.
  - אין files.
  - אין Actions נוסף שיש בו תוכן.
- **חיתוך:** תווית 20, header 60, body 1024.
- **אין בנתיב זה:** header מדיה, footer, או כפתור חזרה ל-flow.
- **סטטוס:** חלקי. MEASURED (probe).

### B.10 תבניות (`sendTemplate`)

- **API:** `adapter.sendTemplate(threadId, { name, language, components? })` (dist:1609-1645). זו מתודה ציבורית של האדפטר, ואין לה מקבילה ב-`thread`.
- **header ו-body (d.ts:405-439):** פרמטרים מסוג text, currency, date_time, image, document ו-video. image, document ו-video מקבלים `id` או `link`.
  - **אין location.** Meta תומכת ב-header מסוג location עם `latitude`, `longitude`, `name` ו-`address`, בתבניות UTILITY ו-MARKETING (עמוד components, סעיף Location header). זה יכול להתאים למיקום האירוע. MEASURED.
- **button (d.ts:456-467):** `{ index: number, sub_type: "url" | "quick_reply", parameters: [{type:"text"} | {type:"payload"}] }`.
  - **אין בטיפוסים:** `copy_code`, `flow`, `catalog`, `mpm`, `voice_call`, `REQUEST_CONTACT_INFO`, footer, ו-`biz_opaque_callback_data`.
  - **אין `parameter_name`:** Meta תומכת בפרמטרים בעלי שם (`parameter_format: "named"`), ובהם שליחה עם `parameter_name` בכל פרמטר (עמוד Template fundamentals, סעיף Parameter formats). MEASURED.
  - **`index`:** בדוגמה של Meta לכפתור URL הוא מופיע כמחרוזת (`"index": "0"`), בעוד האדפטר מגדיר אותו כ-number. INFERRED שגם number מתקבל.
  - בזמן ריצה הרכיבים מועברים כמעט כפי שהם, דרך spread ב-`convertTemplateComponentEmoji` (dist:620-638). לכן שדות נוספים כמו `parameter_name` יעברו ל-Meta, אבל TypeScript יחסום אותם. זה INFERRED מקריאת הקוד ולא נבדק.
- **מגבלות Meta ליצירת תבנית** (עמוד components, MEASURED):
  - header טקסט: עד 60 תווים ופרמטר אחד.
  - body: עד 1024 תווים.
  - footer: עד 60 תווים.
  - עד 10 כפתורים בסך הכול, ומתוכם עד 10 מסוג quick reply. תווית כפתור עד 25 תווים.
  - כפתורי quick reply וכפתורים מסוג אחר חייבים להופיע כשתי קבוצות רציפות.
  - מעל 3 כפתורים, רק 2 מוצגים וכפתור "See all options" מחליף את השאר.
  - 4 כפתורים ומעלה, או quick reply בשילוב סוג אחר, לא מוצגים ב-WhatsApp desktop.
  - עד 2 כפתורי URL, וכל URL עד 2000 תווים עם משתנה אחד בסופו. ערך המשתנה חייב להיות percent-encoded.
- **סדר מסירה:** לפי Template fundamentals, סדר המסירה של כמה הודעות לא מובטח לפי סדר הבקשות. מי שצריך סדר צריך להמתין ל-status מסוג delivered. האדפטר לא קורא statuses בכלל (B.2). MEASURED.
- **ציטוט:** אין `replyId`. Meta ממילא לא מציגה את בועת הציטוט כשמגיבים בתבנית (עמוד contextual replies, סעיף Limitations, נקרא במלואו). MEASURED.
- **חלון 24 שעות:** האדפטר לא מחליף טקסט בתבנית אוטומטית (d.ts:736-743), ואינו יודע אם החלון פתוח.
- **לחיצה על quick reply של תבנית:** מגיעה כ-`type:"button"` ועוברת ל-`processAction` (dist:947-971).
  - `actionId` = ה-payload הגולמי, **בלי פענוח `chat:`**.
  - `value` = טקסט הכפתור.
  - `messageId` = ה-wamid של הלחיצה עצמה, **ולא** של ההזמנה.
  - ה-wamid של ההזמנה זמין רק ב-`event.raw.context.id`.
  - MEASURED (probe): `actionId=rsvp_yes_abc`, `value=מגיע/ה`, `messageId=wamid.TAP`, `raw.context.id=wamid.INVITE`. payload בצורה `chat:{...}` הגיע כמחרוזת מילולית.
  - **אישור מ-Meta** (Button messages webhook reference, נקרא במלואו): `context.id` מוגדר שם כ-"WhatsApp message ID of the message containing the button the WhatsApp user tapped". ה-webhook נושא `button.payload` ו-`button.text`. MEASURED.
- **סטטוס:** חלקי. MEASURED.

### B.11 מדיה יוצאת

- **API:** `thread.post({ markdown, files: [...] })` או `attachments: [...]` (dist:1347-1365 ו-2002-2073).
- **מיפוי סוג (dist:573-588):**
  - `image/jpeg` ו-`image/png` נשלחים כ-image.
  - **כל image אחר (webp, gif) נשלח כ-document.** לכן אי אפשר לשלוח sticker.
  - `video/mp4` ו-`video/3gpp` נשלחים כ-video.
  - `audio/*` נשלח כ-audio.
  - כל השאר נשלח כ-document.
- **מגבלות גודל (dist:555-560):** image 5MB, audio 16MB, video 16MB, document 100MB. חריגה זורקת `ValidationError` לפני ההעלאה.
- **Buffer:** מועלה ל-`/{phoneNumberId}/media` (dist:1934-1950).
- **URL:** חובה `https://` (dist:2057-2062), והוא נשלח כ-link בלי העלאה.
- **caption:** עד 1024 תווים (dist:540). אין caption ל-audio; במקרה כזה, או כשהטקסט ארוך מדי, נשלחת הודעת טקסט נפרדת לפני המדיה (dist:1427-1437).
- **כמה קבצים:** נשלחים כהודעות נפרדות, ומוחזר המזהה האחרון.
- **סטטוס:** נתמך. MEASURED.

### B.12 מדיה נכנסת

- **API:** `attachment.fetchData()`, שקורא ל-`downloadMedia(mediaId, transport?)` (dist:1299-1338).
- **שלב 1:** lookup של ה-metadata. **ה-lookup נעשה בלי `phone_number_id` ובלי timeout** (dist:1300). זה אותו פער שמתועד כבר ב-`media.ts:18-23`.
- **שלב 2:** `downloadAttachment` של shared.
  - hosts מותרים: `fbcdn.net`, `fbsbx.com` ו-origin של ה-Graph (dist:541-554).
  - הטוקן לא עובר ל-host אחר (dist:1315-1323).
  - חסימת כתובות פרטיות (shared:383 ואילך).
  - מגבלה של 25MB, timeout של 30 שניות ו-5 הפניות לכל היותר (shared:383-386).
- **שחזור אחרי סריאליזציה:** `rehydrateAttachment` (dist:1277-1286) משחזר את `fetchData` מ-`fetchMetadata.mediaId`.
- **סטטוס:** נתמך. MEASURED.

### B.13 תגובות emoji, typing ו-markAsRead

- **תגובות:**
  - `addReaction` ו-`removeReaction` (dist:1682-1713). הסרה = emoji ריק.
  - תגובה נכנסת עוברת ל-`onReaction`, עם `added=false` כשה-emoji ריק (dist:888-890).
  - סטטוס: נתמך.
- **typing:**
  - `startTyping(threadId)` (dist:1722-1763) שולח `status:"read"` יחד עם `typing_indicator` עבור **ההודעה הנכנסת האחרונה בהיסטוריית ה-state** (dist:2094-2107).
  - בלי Chat או בלי היסטוריה המתודה לא עושה כלום.
  - טקסט status מותאם מקבל warn ומתעלמים ממנו.
  - `success:false` זורק `AdapterError`.
  - אצלנו `markReadWithTyping` עוקף את זה עם wamid מפורש (adapter.ts:205-214).
  - סטטוס: חלקי.
- **markAsRead:**
  - `markAsRead(threadIdOrMessageId, messageId?)` (dist:1898-1910).
  - `success:false` זורק `AdapterError`.
  - Meta: רק הודעות נכנסות, ומומלץ לסמן תוך 30 יום מהקבלה. wamid לא תקין מחזיר 131009. **MEASURED** מעמוד Mark messages as read (C.18).
  - חיווי ההקלדה נעלם עם התשובה או אחרי 25 שניות, המוקדם מביניהם. **MEASURED** מעמוד Typing indicators (C.19).
  - סטטוס: נתמך.

### B.14 Actions, onAction וקידוד callback data

- **שליחה:** `id = "chat:" + JSON.stringify({a: actionId, v?: value})` (dist:30-36).
- **קבלה:** `decodeWhatsAppCallbackData` (dist:37-57). מחרוזת בלי קידומת `chat:`, או JSON שבור, הופכת ל-`{actionId: raw, value: raw}`. **כל מחרוזת שהלקוח שולח הופכת ל-action.**
- **ב-interactive:** אם אין `v`, ה-value נלקח מכותרת הכפתור (dist:935).
- **בליבה:**
  - `processAction` (chat/dist/index.js:1206-1221) ו-`handleActionEvent` (1656 ואילך).
  - **אין deduplication של actions.** dedupe קיים רק ב-`routeIncomingMessage` של הודעות (index.js:2122-2147, מפתח `dedupe:{adapter}:{message.id}`).
  - **אין lock ואין אסטרטגיית concurrency ל-actions.**
  - MEASURED בקריאה ולא ב-probe, כי probe כזה דורש state adapter ולא הותקן כאן state-memory.
- **`thread`:** נוצר על ה-thread של הלוחץ.
- **`openModal`:** לא קיים ב-WhatsApp, ולכן מחזיר undefined.
- **סטטוס:** נתמך. idempotency היא באחריות האפליקציה.

### B.15 Modals, ephemeral, slash commands, approvals, mentions ו-getUser

- **Modals:** לא נתמכים. אין `openModal` באדפטר. modals.mdx:13 מציין Slack ו-Teams בלבד.
- **Ephemeral:** לא נתמך. עם `fallbackToDM:true` ההודעה תישלח כ-DM, שב-WhatsApp הוא אותו thread. INFERRED מ-ephemeral-messages.mdx.
- **Slash commands:** לא נתמכים. `/x` מגיע כטקסט רגיל.
- **Approvals (`chat/workflow`):**
  - `requestApproval` מחכה ל-`finalizeApprovalCard`, שקורא ל-`adapter.editMessage` **לפני** שהוא מחזיר את ההחלטה (workflow/index.js:70-73 ו-97-123).
  - ב-WhatsApp `editMessage` זורק (dist:1651-1655), כך ש-**ההחלטה אובדת והפונקציה זורקת.**
  - בנוסף הכפתורים יוצאים עם `callbackUrl`, וזה מחייב workflow SDK, שלא מותקן אצלנו.
  - סטטוס: לא נתמך. MEASURED בקריאה.
- **Mentions:** ל-WhatsApp אין mentions. DM בלי `onDirectMessage` נחשב mention (handling-events.mdx:22).
- **getUser:** לא נתמך. ב-api/chat.mdx:726 WhatsApp מופיע במפורש כ-`NOT_SUPPORTED`. `author.fullName` נלקח מ-`contacts[].profile.name`.

### B.16 היסטוריה, subject ו-thread info

- **`persistThreadHistory = true`** (dist:665).
- **שמירה ב-state:** הליבה שומרת כל הודעה **נכנסת** ב-`msg-history:{threadId}` (chat/dist/index.js:2159-2166), וכל הודעה **יוצאת** שנשלחה דרך thread (chunk-TZYBST6B.js:672-673).
- **`adapter.fetchMessages`:** תמיד מחזיר `[]` (dist:1769-1774). `bot.history.thread.list` ממלא את החסר מה-cache.
- **`fetchThread`:** מחזיר מבנה סינתטי (dist:1778-1787).
- **`listThreads` ו-`channel.threads()`:** לא נתמכים.
- **subject:** מחזיר null.
- **סטטוס:** חלקי (cache בלבד). MEASURED.

### B.17 Concurrency ו-state

- **`lockScope = "channel"`** (dist:664). ב-WhatsApp נעילה ברמת channel שקולה לנעילה ברמת השיחה.
- **אסטרטגיות** (concurrency.mdx): drop (ברירת מחדל), queue, burst, debounce ו-concurrent. debounce מוצג שם כמתאים ל-WhatsApp.
- **על מה הן חלות:** רק על הודעות. לא על actions (ראו B.14).
- **state:**
  - מחזיק subscriptions, locks, dedupe, aliasים של זהות ומטמון היסטוריה.
  - ל-queue, debounce ו-burst נדרשים `enqueue`, `dequeue` ו-`queueDepth`.
  - `@chat-adapter/state-pg` מותקן אצלנו ולא בשימוש.

### B.18 שגיאות

- **`WhatsAppApiError`** (dist:379-423) מחזיק:
  - `status`
  - `errorCode`
  - `providerMessage`
  - `type`
  - `details`
  - `subcode`
  - `traceId`
  - `raw`, שבו נשמר גם `is_transient`
- **טקסונומיה** (dist:322-378):
  - `RATE_LIMITED`: HTTP 429, או הקודים 4, 17, 32, 613, 80007, 130429, 131048 ו-131056.
  - `AUTH_FAILED`: HTTP 401, או 0 ו-190.
  - `PERMISSION_DENIED`: HTTP 403, או 3, 10 ו-200–299.
  - `NOT_FOUND`: HTTP 404.
- **כשל רשת או JSON לא תקין:** `NetworkError` (dist:2134-2169).
- **תשובת 2xx בלי message id:** `Error` רגיל.
- **הודעת השגיאה:** מכילה את `error.message` של Meta (dist:407-409). **ה-logger מקבל את גוף השגיאה המלא** (dist:2148-2152).
- **השוואה לעמוד error codes של Meta** (נקרא במלואו):
  - ב-Throttling errors של Meta מופיעים 4, 80007, 130429, 131048, 131056, 133016 ו-131064.
  - האדפטר ממפה גם 17, 32 ו-613 ל-RATE_LIMITED. אלה קודי Graph כלליים, והם לא מופיעים בעמוד של WhatsApp.
  - **האדפטר לא ממפה 133016 ו-131064.**
  - Meta ממליצה לבנות טיפול בשגיאות על `code` ועל `details`. `error_subcode` "Deprecated. Will not be returned in v16.0+". זה עקבי עם האדפטר.
  - Meta: "Cloud API errors are returned either synchronously … asynchronously via Webhook, or sometimes through both". החלק האסינכרוני לא מגיע לאדפטר (B.2).
  - MEASURED.
- **סטטוס:** נתמך.

### B.19 Emoji ו-markdown

- **`resolveEmoji`:** משתמש ב-`defaultEmojiResolver.toGChat`, כלומר מחזיר unicode (dist:2173-2175).
- **`convertEmojiPlaceholders(…, "whatsapp")`:** רץ בכל נתיב שליחה, כולל פרמטרי text של תבניות.

### B.20 AI

- **`toAiMessages` ו-`createChatTools`** מ-`chat/ai` עובדים מעל ההיסטוריה ב-cache.
- **כלים שלא יעבדו ב-WhatsApp:** `editMessage` ו-`deleteMessage` יזרקו, `getUser` לא נתמך, ו-`listThreads` זורק. INFERRED משילוב של B.15 ו-B.16.
- **ב-toAiMessages:** אודיו ווידאו מדולגים (to-ai-messages.mdx:197-205), ולכן הקלטות קוליות של אורחים לא נכנסות להקשר.

### B.21 כלי בדיקה

- **`@chat-adapter/tests`:** לא מותקן אצלנו. כולל `createMockAdapter`, `createMockChatInstance` ו-matchers.
- **ל-WhatsApp אין subpath `/testing`:** ב-package.json יש export ל-`.` בלבד.
- **הטסטים שלנו:** עוקפים את כל זה עם `fetch` מדומה (send.test.ts ו-media.test.ts).

---

## (C) פערים בין תיעוד לקוד

כלל ההכרעה: במקרה של סתירה, הקוד מנצח.

1. **יותר מ-3 כפתורים.**
   - **התיעוד:** README:150 ו-216, וגם המסמך המקוון ("Cards with more than 3 buttons fall back to formatted text"), אומרים שהכרטיס יורד לטקסט.
   - **הקוד:** `extractReplyButtons` חותך ל-3 הראשונים ושולח interactive (dist:222). הכפתור הרביעי נעלם בשקט.
   - MEASURED (probe).

2. **"List messages: Yes".**
   - **התיעוד:** README:149. גם המסמך המקוון בסעיף File uploads מזכיר "reply buttons or a list".
   - **הקוד:** אין נתיב שמייצר list (dist:58-106).
   - **גם בין מסמכים יש סתירה:** טבלת FeatureSupport המקוונת מסמנת "Select menus" באדום.
   - MEASURED (probe).

3. **"Images in cards".**
   - **התיעוד:** טבלת FeatureSupport מסמנת ירוק.
   - **הקוד:** `Image` ו-`imageUrl` נשלחים כשורת URL בנתיב הטקסט, ונזרקים בנתיב הכפתורים (dist:118-121, 149-153 ו-184-197).
   - **המסמך המקוון עצמו** (File uploads) אומר: "Card-embedded images … are not sent as native media".
   - MEASURED (probe).

4. **Table, Chart ו-CardLink.**
   - **התיעוד:**
     - cards.mdx:226 אומר על Table: "padded ASCII text elsewhere".
     - cards.mdx:278 ו-api/cards.mdx:340 אומרים על Chart: "fall back … as a text table".
     - cards.mdx:155 אומר ש-CardLink "renders as a platform-native link".
   - **הקוד:** ב-`renderChild` של WhatsApp אין case ל-`table`, `chart` או `link`, ולכן כולם מחזירים `[]` (dist:139-159). ב-`childToPlainText` הם מחזירים null.
   - **תוצאת ה-probe:** כרטיס עם שלושתם יצא כ-`"*t*\n\nbody\n"`.
   - רק בנתיב עם מדיה (`cardToFallbackText`, shared:179-216) טבלה ו-CardLink מוצגים.
   - MEASURED (probe).

5. **`userName` "for self-message detection".**
   - **התיעוד:** README:91 והמסמך המקוון.
   - **הקוד:** `isMe` מושווה ל-`_botUserId`, שהוא `phoneNumberId` (dist:696 ו-978). `userName` לא משמש לזיהוי.
   - MEASURED.

6. **היסטוריה: שלוש גרסאות סותרות.**
   - README:208 אומר "Fetch messages: No".
   - ה-FeatureSupport המקוון אומר "Cached sent only".
   - **הקוד:** הליבה שומרת ב-cache גם הודעות נכנסות (chat/dist/index.js:2159-2166) וגם יוצאות (chunk-TZYBST6B.js:672-673). `startTyping` אף מסתמך על הודעה *נכנסת* מה-cache (dist:2094-2107).
   - **המסקנה:** "Cached sent only" שגוי. MEASURED.

7. **quick reply של תבנית.**
   - **התיעוד:** README:251 אומר ש-"dispatched to your onAction handlers". זה נכון.
   - **מה שלא כתוב:** `actionId` הוא ה-payload הגולמי בלי פענוח `chat:`, בניגוד לכפתורי interactive. `messageId` הוא ה-wamid של הלחיצה ולא של ההזמנה.
   - MEASURED (probe).

8. **חובת validation לאורך נתוני כפתור.**
   - **התיעוד:** contributing/building.mdx:467-475 אומר שאדפטר צריך לזרוק `ValidationError` כשהנתונים המקודדים חורגים ממגבלת הפלטפורמה.
   - **הקוד:** האדפטר לא בודק את אורך ה-id מול 256 (dist:30-36), וגם לא את מגבלות הרשימה.
   - MEASURED.

9. **חיתוך טקסט.**
   - **התיעוד:** README:230 אומר ש-"truncated to 20 characters".
   - **הקוד:** `truncate` סופר יחידות UTF-16 ולא תווים. emoji בנקודת החיתוך משאיר surrogate שבור (dist:311-316).
   - MEASURED (probe).

10. **Approvals.**
    - **התיעוד:** approvals.mdx:77 אומר ש-"the card is edited in place".
    - **הקוד:** ב-WhatsApp העריכה זורקת (dist:1651-1655), ו-`requestApproval` לא מחזיר את ההחלטה.
    - MEASURED בקריאה.

11. **ייבוא של `Text` מהליבה.** זה פער בליבה ולא באדפטר.
    - **התיעוד:** api/cards.mdx:13, posting-messages.mdx:109 ו-api/cards.mdx:59-62 מראים `import { …, Text } from "chat"`.
    - **הקוד:** ה-export בזמן ריצה הוא `CardText` בלבד. `Text` גורם ל-`SyntaxError: does not provide an export named 'Text'`.
    - MEASURED (probe).

12. **"signature verification silently rejects".**
    - **התיעוד:** README:312.
    - **הקוד:** מחזיר 401 עם `Invalid signature` (dist:717-719). ההתנהגות לא שקטה. זה פער קטן.
    - MEASURED.

13. **"Post channel message".**
    - **התיעוד:** טבלת FeatureSupport מסמנת ירוק.
    - **הקוד:** לאדפטר אין `postChannelMessage`. הליבה נופלת בחזרה ל-`postMessage` (chunk-TZYBST6B.js:662 ו-666). התוצאה בפועל תקינה, כי channel === thread, אבל אין מימוש ייעודי.
    - MEASURED.

14. **typing "displays for up to 25 seconds".**
    - **התיעוד:** README:157.
    - **הקוד:** אין קוד שקשור לזה. זו התנהגות של Meta. INFERRED.

15. **הקישור לתיעוד תבניות ב-README:234** מוביל לעמוד ש-Meta העבירה ("This page has moved"). MEASURED.

16. **`user_id_update`: ה-field לא קיים לפי Meta.** פער בין האדפטר לבין Meta.
    - **התיעוד:**
      - README:290 אומר "Subscribe your Meta app to the `user_id_update` webhook field".
      - המסמך המקוון (Configure webhooks, שלב 4) אומר "Also subscribe to `user_id_update`".
      - הקוד מטפל ב-`change.field === "user_id_update"` (dist:732-735 ו-1033-1068).
    - **Meta:** עמוד BSUID, סעיף user_id_update webhooks, וה-changelog מ-11.8.2026:
      - "There is no user_id_update webhook field."
      - "user_id_update is not a subscribable webhook field, so it does not appear in the App Dashboard and you cannot subscribe your app to it."
      - שינויי BSUID מגיעים כהודעת `system` על field ‏`messages`, עם `system.previous_user_id`.
    - **המשמעות:** הענף של `user_id_update` הוא קוד מת. ההנחיה ב-README אינה ניתנת לביצוע. MEASURED.

17. **`previous_user_id` מתעלמים ממנו.**
    - **Meta:** מאז 11.8.2026 הודעות system מסוג `user_changed_number` ו-`user_changed_user_id` נושאות את `previous_user_id` ואת `previous_parent_user_id`. ב-`user_changed_user_id` "wa_id … will be omitted … This is the usual case", ו-`from` מושמט כשאין טלפון.
    - **הקוד:**
      - הטיפוס `system` (d.ts:256-262) לא כולל את השדות האלה.
      - `resolve()` מקשר רק דרך `inbound.from` (dist:994-1002).
      - **התוצאה: רוטציית BSUID של משתמש בלי טלפון פותחת thread חדש.**
    - MEASURED (probe, B.4).

18. **README:188: "recommends acknowledging inbound messages within 30 days". MEASURED, ואין סתירה.**
    - עמוד Mark messages as read: "Mark incoming messages as read within 30 days of receipt. When you mark a message as read, the API also marks earlier messages in the conversation as read."
    - תוספת מאותו עמוד: wamid לא תקין מחזיר שגיאה 131009.

19. **README:157: typing "displays for up to 25 seconds". MEASURED, ואין סתירה.**
    - עמוד Typing indicators: "The typing indicator will be dismissed once you respond, or after 25 seconds, whichever comes first."
    - ה-payload של האדפטר (dist:1742-1752) זהה ל-request syntax של Meta: `status:"read"`, `message_id` ו-`typing_indicator:{type:"text"}`. גם של `markReadWithTyping` שלנו זהה.
    - Meta ממליצה: "only display a typing indicator if you are going to respond".

---

## (D) מה מתאים ל-RSVP של אורחים ב-KALFA

הזרימה שנבחנת: הזמנה בתבנית, האורח לוחץ על כפתור quick reply, ואחר כך נשאלת שאלת מספר המגיעים.

> הערה: לא קראתי במסגרת המשימה הזו את זרימת האורחים הנוכחית (`src/lib/whatsapp/**` ו-route של ה-webhook). כל השוואה לזרימה הקיימת מסומנת INFERRED.

### אפשרי עם האדפטר

1. **שליחת ההזמנה בתבנית:** `sendTemplate` עם header מדיה (image, document או video לפי id או link), פרמטרי body, וכפתורי `quick_reply` עם `payload` לפי `index`. MEASURED.
   - **בלי `parameter_name`:** תבניות עם פרמטרים בשם לא מוגדרות בטיפוסים (d.ts:405-467). INFERRED שיעברו בזמן ריצה.
   - **בלי `biz_opaque_callback_data`:** אי אפשר להדביק מזהה פנימי שיחזור אלינו ב-statuses. ממילא האדפטר לא קורא statuses.

2. **קליטת הלחיצה על "מגיע/ה":** מגיעה ל-`onAction`, עם `actionId` = ה-payload שלנו ו-`value` = טקסט הכפתור. ה-wamid של ההזמנה המקורית נמצא ב-`event.raw.context.id`. לכן אפשר לקשור את הלחיצה להזמנה ספציפית. MEASURED (probe).

3. **אישור קבלה מיידי:** תגובת ✅ על ה-wamid של הלחיצה, או read+typing. MEASURED.
   - `startTyping` הציבורי דורש Chat והיסטוריה.
   - הדרך העוקפת כבר קיימת אצלנו (`markReadWithTyping`).

4. **שאלת מספר המגיעים אחרי הלחיצה:** הלחיצה פותחת חלון 24 שעות. זה כלל של Meta, INFERRED ולא נמדד כאן.
   - **כפתורי reply:** אפשר דרך Card או דרך `sendInteractiveMessage`, עד 3 כפתורים (לדוגמה "1", "2", "3+").
   - **רשימה עד 10 שורות:** אפשרית **רק** דרך המתודה המוגנת `sendInteractiveMessage`, בדיוק כמו `sendOwnerAgentList`. ה-`list_reply` חוזר מפוענח. MEASURED (probe).
   - **Card עם Select לא עובד:** הוא יוצא כטקסט `[label]` בלי האפשרויות. MEASURED (probe).

5. **מספר שהאורח כותב בטקסט חופשי ("אנחנו 4"):** מגיע כ-message. אם האורח ציטט את השאלה, ה-wamid שלה נמצא ב-`raw.message.context.id`. `replyTo` ריק. MEASURED (probe).

6. **כמה הודעות מהירות ברצף:** אסטרטגיית `debounce` או `burst` עם `lockScope="channel"`. חלה רק על הודעות ולא על לחיצות. MEASURED (תיעוד וקוד).

7. **קישור לעריכת הפרטים ב-`/r/[token]`:** כרטיס עם `LinkButton` יחיד הופך ל-CTA URL נייטיבי. MEASURED (probe).
   - header טקסט בלבד, תווית עד 20 תווים.
   - לא אם מצורפת מדיה.

8. **הודעות קוליות או מסמכים מאורחים:** הורדה מאובטחת עד 25MB או 30 שניות. `media.ts` כבר עוטף אותה עם lookup תחום למספר שלנו. MEASURED.

### לא אפשרי, או מחייב עבודה משלנו

1. **statuses:** delivered, read ו-failed, כולל 131049, 131026 ו-131047 אסינכרוני.
   - האדפטר מתעלם מהם לגמרי (dist:730-776). MEASURED (probe).
   - מעקב מסירה של הזמנות חייב להישאר ב-pipeline הקיים שלנו.

2. **כפילויות בלחיצות:** אין deduplication של actions בליבה (chat/dist/index.js:1656 ואילך). כש-Meta שולחת את אותו webhook שוב, `onAction` ירוץ פעמיים. MEASURED בקריאה.
   - **מסקנה:** עדכון RSVP חייב להיות idempotent בשכבת הדומיין, לפי wamid הלחיצה או לפי ה-invite. INFERRED.

3. **אבטחת מזהי כפתורים:** כל מחרוזת שהלקוח שולח הופכת ל-action (dist:37-57). MEASURED.
   - גם payload של תבנית ניתן לזיוף מצד הלקוח.
   - **מסקנה:** אסור להכניס ל-payload הרשאה או מזהה אורח אמין. צריך לאמת בשרת מול הנמען, ה-invite וה-`context.id`. זה עולה בקנה אחד עם כללי ה-RSVP הציבורי ב-CLAUDE.md. INFERRED.

4. **WhatsApp Flows** (טופס בתוך הצ'אט לספירת מגיעים, העדפות מזון ועוד):
   - אין שליחה: אין sub_type `flow` ואין interactive מסוג flow.
   - קבלת `nfm_reply` נזרקת (dist:927-929).
   - MEASURED (probe).
   - **מה Meta מאפשרת** (עמודי Sending a Flow ו-Flows Webhooks, נקראו במלואם, MEASURED):
     - **מחוץ לחלון 24 השעות:** תבנית עם כפתור מסוג `FLOW`. התווית עד 25 תווים, והכפתור מפנה ל-`flow_id`, ל-`flow_name` או ל-`flow_json`. בשליחה נכתב רכיב `{type:"button", sub_type:"flow", index:"0", parameters:[{type:"action", action:{flow_token, flow_action_data}}]}`.
     - **בתוך החלון:** interactive מסוג `flow`, עם `action.name:"flow"`, `flow_message_version:"3"`, `flow_id` או `flow_name`, ו-`flow_cta`. מומלץ עד 30 תווים ובלי emoji. אפשר גם `flow_token`, `flow_action` ו-`flow_action_payload`.
     - **תנאי מוקדם:** "You will need to verify your business and maintain a high message quality."
     - **קבלה:** מגיעה כ-`interactive.type:"nfm_reply"`, עם `nfm_reply.name:"flow"`, `body:"Sent"` ו-`response_json`. זו מחרוזת JSON שנושאת את ה-`flow_token` ואת שדות הטופס. `context.id` הוא ה-wamid של הודעת ה-Flow.
     - "The Flow response does not include the Flow ID". מזהים את ה-Flow דרך `flow_token` שהעסק קובע.
     - **רישום:** צריך להירשם ל-webhook fields ‏`flows` ו-`messages`.
   - **פער מול האדפטר:**
     - `sub_type` מוגבל ל-`url` ו-`quick_reply`, ו-`parameters` רק ל-`text` ו-`payload` (d.ts:446-467).
     - ה-union של interactive לא כולל `flow` (d.ts:366-399).
     - `nfm_reply` נזרק.
     - שלושת החלקים — שליחה בתבנית, שליחה בחלון וקבלה — לא נתמכים. MEASURED.
   - **מה זה אומר ל-RSVP:** `flow_token` נוצר אצל העסק, ולכן אפשר להכניס בו מזהה אטום של ההזמנה. Flow יחיד יכול לאסוף מספר מגיעים והעדפות. INFERRED: זה לא נבדק, ומבנה ה-Flow JSON לא נקרא.
   - **אם בונים את זה אצלנו:** שליחה אפשרית דרך המתודות המוגנות, כמו רשימה. קבלה מחייבת את נתיב ה-webhook שלנו, כי האדפטר זורק את `nfm_reply`. INFERRED.

5. **עריכה או מחיקה של הודעה** (למשל הסרת כפתורים אחרי שהאורח ענה): לא אפשרי. זו מגבלה של WhatsApp, והקוד זורק (dist:1651-1655 ו-1674-1676).

6. **Approvals, modals, ephemeral, slash commands ו-getUser:** לא רלוונטיים או לא נתמכים (B.15).

7. **webhook ציבורי דרך האדפטר:**
   - `handleWebhook` מעבד בתוך הבקשה, בלי persist-then-process.
   - הוא מתעלם מ-statuses.
   - גוף בלי `entry` זורק.
   - `adapter.ts` כבר קובע: "route.ts stays the only public webhook".
   - **מסקנה:** להפעיל את `handleWebhook` על זרימת האורחים יתנגש בדפוס הקיים. INFERRED.

8. **מספור וחיתוך בעברית:** חיתוך ב-UTF-16 משבר emoji. לכן הכותרות והטקסטים צריכים להיבדק אצלנו לפני השליחה, כמו ש-`send.ts` כבר עושה עם code points. MEASURED (probe).

9. **BSUID:**
   - שליחה לפי BSUID נתמכת.
   - **תבניות אימות מסוג one-tap, zero-tap ו-copy-code דורשות טלפון.** MEASURED מ-Meta.
   - אורחי KALFA מזוהים לפי טלפון. לפי Meta, הטלפון נשמט רק אם האורח אימץ username **וגם** המספר העסקי ששלח את ההזמנה לא החליף איתו הודעה ב-30 הימים האחרונים **וגם** הוא לא ב-contact book. MEASURED מ-Meta.
   - **מסקנה:** אורח שקיבל מאיתנו הזמנה ועונה תוך 30 יום, מאותו מספר עסקי, יגיע עם טלפון. INFERRED, כי זו הסקה מהכלל של Meta ולא מדידה.
   - אורח שעונה אחרי יותר מ-30 יום, או למספר עסקי אחר, עלול להגיע עם BSUID בלבד. לחיצה כזו לא תתאים לאורח לפי טלפון. INFERRED.
   - **רוטציית BSUID שוברת רציפות thread באדפטר** (C.17). MEASURED (probe).
   - **`REQUEST_CONTACT_INFO`**, הכפתור של Meta לבקשת טלפון, לא נתמך באדפטר. גם תשובת ה-`contacts` נזרקת. MEASURED.
   - aliasים של זהות דורשים state מתמיד.

10. **header מסוג location בתבנית** (מיקום האירוע כמפה בראש ההזמנה): Meta תומכת בזה בתבניות UTILITY ו-MARKETING. האדפטר לא מגדיר את זה בטיפוסים. אפשר לעקוף דרך הטיפוסים, והשדות יעברו בזמן ריצה, אבל זה לא נבדק ולכן INFERRED.

11. **סדר מסירה:** Meta לא מבטיחה שכמה הודעות יימסרו לפי סדר השליחה. אם השאלה על מספר המגיעים חייבת להגיע אחרי אישור, צריך להמתין ל-status מסוג delivered, והאדפטר לא מספק statuses. MEASURED.

### שורה תחתונה

MEASURED ו-INFERRED מסומנים גם כאן:

- **מה האדפטר נותן שעובד ל-RSVP:**
  - שליחת תבנית עם quick reply.
  - קליטת לחיצות, כולל wamid ההזמנה ב-raw.
  - שליחת כפתורים, ורשימה דרך המתודה המוגנת.
  - קליטת `list_reply`.
  - תגובות emoji, read+typing ו-CTA URL.
  - כל אלה MEASURED.
- **מה חסר ומחייב קוד שלנו:**
  - statuses.
  - deduplication של לחיצות.
  - אימות מזהים בשרת.
  - Flows.
  - רשימה דרך Card.
  - persist-then-process.
  - רציפות זהות ברוטציית BSUID (`previous_user_id`).
  - `REQUEST_CONTACT_INFO`.
  - header מסוג location ופרמטרים בעלי שם בטיפוסי התבנית.
  - כל אלה MEASURED כחסרים. הדרישה לקוד שלנו היא INFERRED.
- **הערה על הקוד שלנו:** אנחנו כבר משתמשים באדפטר רק כ-HTTP client מבוקר (subclass ב-`adapter.ts`). אותו דפוס מתאים גם לזרימת האורחים. INFERRED.
