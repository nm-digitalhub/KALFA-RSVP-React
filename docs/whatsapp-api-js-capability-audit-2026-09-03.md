# ביקורת יכולות: `whatsapp-api-js` 6.2.2 מול השימוש בפועל ב-kalfa.me

תאריך: 2026-09-03 · היקף: קריאה בלבד (ללא שינויי קוד, ללא התקנות, ללא שליחות) · מחבר: whatsapp-meta-expert (agent)

## תיוג ראיות

| תג | משמעות |
|---|---|
| MEASURED | נמדד בסשן הזה מקבצי `node_modules`, מהריפו, מלוגי pm2 או מהרצת בדיקות |
| VERIFIED-LIVE | אומת מול מערכת חיה בעבר ומתועד בזיכרון הפרויקט |
| DOCS-ONLY | נלקח מתיעוד רשמי (Meta / GitHub / npm) בלי אימות חי |
| INFERRED | מסקנה מהקוד או מהערות שחרור, לא נמדדה |

## תקציר מנהלים

1. ה-SDK משמש ב-kalfa.me בדיוק בשלושה מקומות ריצה: `src/lib/whatsapp/client.ts` (שליחה), `src/app/api/webhooks/whatsapp/route.ts` (אימות חתימה + טיפוס `PostData`) ו-`client.test.ts`. כל שאר הצרכנים עוברים דרך `client.ts`.
2. השימוש נכון מבחינה ארכיטקטונית: הודעות נבנות עם מחלקות ה-SDK (לא JSON ידני), החתימה מאומתת עם `verifyRequestSignature` (אין HMAC ידני), ו-`/marketing_messages` מגיע דרך פתח המילוט המתועד `$$apiFetch$$`.
3. ההחלטה לא להשתמש ב-`post()`/emitters נכונה ונמדדה: `post()` קורא רק `entry[0].changes[0]` ו-`messages[0]`/`statuses[0]` וזורק על שדות template-health. הטיפול הידני ב-`PostData` שומר כל אירוע.
4. ממצא תפעולי מדוד: ה-route יוצר `WhatsAppAPI` בלי `v`, ולכן כל POST של webhook כותב אזהרה ל-stderr. נספרו 57 מופעים ב-`kalfa-beta-error.log`, האחרון היום 18:04.
5. כפילות ידנית אחת אמיתית: הורדת מסמך CSV ב-`whatsapp-import.ts` בעזרת `fetch` גולמי ל-`v23.0`, בעוד ל-SDK יש `retrieveMedia(id, phoneID)` + `fetchMedia(url)`.
6. גרסאות Graph מפוזרות: ה-SDK מפנה ל-`v24.0`, ארבעה קבצים ל-`v23.0`, שניים ל-`v21.0`. Meta כבר ב-`v26.0`. אין פקיעה קרובה, אבל אין קבוע אחד בבעלות kalfa.
7. `package.json` ב-HEAD מצביע על `^6.2.1`; בעץ העבודה יש עריכה לא-מחויבת ל-`^6.2.2`. ה-lockfile כבר על 6.2.2 מאז 2026-07-22. אין הבדל פונקציונלי.
8. `6.2.1 → 6.2.2` הוא שחרור תלויות בלבד. אין שינויים שוברים מאז האימוץ (26.6.2026). ה-beta הבא נושא "BSUID support", שראוי לעקוב אחריו.
9. יכולות לא מנוצלות ורלוונטיות: הודעות Interactive (רשימות/כפתורים) בתוך חלון 24 השעות, `retrieveMedia`/`fetchMedia`, סימון `held_for_quality_assessment`, שער גודל 3MB לפני קריאת הגוף.
10. אין ממצא P0. יש 3 המלצות P1 קטנות ו-6 המלצות P2. אין המלצה להחליף SDK, לשנות סיווג UTILITY/MARKETING, או למחוק תבניות.

---

## חלק 1 — החבילה המותקנת (MEASURED מ-`node_modules/whatsapp-api-js/`)

### 1.1 מטא-דאטה

| פריט | ערך |
|---|---|
| גרסה מותקנת | 6.2.2 (`node_modules/whatsapp-api-js/package.json`), lockfile `whatsapp-api-js-6.2.2.tgz` |
| פורמט | ESM בלבד (`"type": "module"`); `exports` מפנה גם `require` לאותם קבצי `.js` |
| `engines` | `node >= 16` (README וה-changelog מציינים ש-Node 18 הוסר מהבדיקות) |
| Node כאן | 24.20.0 |
| מפת `exports` | `.`, `./messages`, `./messages/*`, `./setup/*`, `./middleware/*`, `./emitters` (טיפוסים בלבד), `./types`, `./errors`. שים לב: `./setup` ו-`./middleware` (ללא תת-נתיב) מוגדרים `null` |
| תיעוד | https://whatsappapijs.web.app/ ; שחרורים ב-GitHub `Secreto31126/whatsapp-api-js` |
| קבצים | `lib/index.js` (המחלקה), `lib/types.d.ts`, `lib/emitters.d.ts`, `lib/errors.js`, `lib/messages/*`, `lib/middleware/*`, `lib/setup/*`, `lib/utils.js` |

### 1.2 `WhatsAppAPI` — בנאי

חתימה: `new WhatsAppAPI<EmittersReturnType = void>({ token, appSecret?, webhookVerifyToken?, v?, secure?, ponyfill? })`

| אופציה | התנהגות (MEASURED, `lib/index.js:103-136`) |
|---|---|
| `token` | חובה. מוזרק כ-`Authorization: Bearer` בכל קריאה דרך `$$apiFetch$$` |
| `appSecret` | נשמר רק כאשר `secure` אמת. הטיפוס `SecureLightSwitch` אוסר להעביר `appSecret` יחד עם `secure:false` |
| `secure` | ברירת מחדל `true`. כשאמת: נדרש `crypto.subtle` (או ponyfill) כבר בבנאי, אחרת זריקה. כשלא: `appSecret` נזרק, `verifyRequestSignature`/`post()` יזרקו `WhatsAppAPIMissingAppSecretError` אם ייקראו. שליחה לא מושפעת |
| `webhookVerifyToken` | משמש רק את `get()` |
| `v` | גרסת Graph. כשחסר: `console.warn` בכל בנייה + ברירת מחדל `DEFAULT_API_VERSION = "v24.0"` (`lib/types.d.ts:11`) |
| `ponyfill` | `{ fetch?, subtle? }`. מיותר ב-Node 24 |

אין אופציה בשם `offload_functions`. מה שקיים: מתודה סטטית `WhatsAppAPI.offload(f)` (`lib/index.js:695`, `Promise.resolve().then(f)`) והארגומנט `offload` שמועבר לכל emitter.

### 1.3 מתודות ציבוריות

| מתודה | חתימה | מה עושה | תפיסות (MEASURED) |
|---|---|---|---|
| `sendMessage` | `(phoneID, to, message: ClientMessage, context?, biz_opaque_callback_data?) → Promise<ServerMessageResponse>` | `POST /{v}/{phoneID}/messages` עם `{messaging_product, type, to, [type]: message, context?, biz_opaque_callback_data?}` | לא שולח `recipient_type`. הגוף מפוענח ב-`getBody` = `.json()` בלבד (`lib/index.js:687`), לכן שגיאת Graph חוזרת כ-`{ error: {...} }` ולא נזרקת; זריקה קורית רק על רשת/timeout או גוף לא-JSON. אחרי הקריאה מופעל `on.sent` ושגיאותיו נבלעות ב-`console.error` (`lib/index.js:173`). מחזיר `response ?? promise` (`lib/index.js:177`) |
| `broadcastMessage` | `(phoneID, to[] \| T[], message \| builder, batch_size=50, delay=1000)` | `setTimeout` בקבוצות; מחזיר מערך Promises | אין backpressure, אין idempotency, Promise לעולם לא נדחה |
| `markAsRead` | `(phoneID, messageId, indicator?: "text")` | `status: "read"` + `typing_indicator` אופציונלי | דורש חלון פתוח (הודעה נכנסת) |
| `initiateCall` / `preacceptCall` / `rejectCall` / `acceptCall` / `terminateCall` | beta | `/{phoneID}/calls` | ה-URL **ללא גרסה** (`https://graph.facebook.com/{phoneID}/calls`) |
| `createQR` / `retrieveQR` / `updateQR` / `deleteQR` | `(phoneID, message, format?)` וכו' | `/{v}/{phoneID}/message_qrdls` | `prefilled_message=${message}` מוזרק ל-query **בלי `encodeURIComponent`** |
| `retrieveMedia` | `(id, phoneID?) → {url, mime_type, sha256, file_size: string, id}` | `GET /{v}/{id}?phone_number_id=` | `phoneID` מגביל את הפעולה למדיה של אותו מספר עסקי (`lib/apis/media.d.ts:639`). `file_size` מוטפס כמחרוזת |
| `uploadMedia` | `(phoneID, form: FormData, check=true)` | `POST /{v}/{phoneID}/media` | בודק mime מותרים וגדלים (image 5MB, video/audio 16MB, document 100MB). זה ה-endpoint למדיה של הודעות, **לא** ה-resumable upload (`/{APP_ID}/uploads`) שמשמש ל-header handle של תבניות |
| `fetchMedia` | `(url) → Promise<Response>` | `GET` מאומת ל-URL ה-CDN | מוסיף `User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; …)` (`lib/index.js:434`) — עקיפה שה-SDK מייחס למשתמש בשם tecoad; הסיבה לא מתועדת ב-Meta (INFERRED) |
| `deleteMedia` | `(id, phoneID?)` | `DELETE /{v}/{id}` | |
| `blockUser` / `unblockUser` | `(phoneID, ...users)` | `/{phoneID}/block_users` | **ללא גרסה** ב-URL. אין `retrieveBlockedUsers` ב-6.2.2 |
| `post` | `(data: PostData, raw_body, signature)` או `(data)` כש-`secure:false` | מאמת חתימה, ואז מפזר ל-emitter אחד | ראו 1.4. מחזיר את ערך ההחזרה של ה-emitter (או `undefined`) |
| `get` | `(params: GetParams) → string` | מאמת `hub.verify_token`, מחזיר `hub.challenge` | השוואה עם `===` (לא constant-time). זורק `WhatsAppAPIMissingVerifyTokenError` (500) / `MissingSearchParams` (400) / `FailedToVerifyToken` (403) |
| `$$apiFetch$$` | `(url, options?) → Promise<Response>` | `fetch` עם `Authorization` מוזרק | מתועד כ"פתח מילוט למבצע שה-SDK לא מממש". מחזיר `Response` גולמי, לא JSON |
| `verifyRequestSignature` | `(raw_body, signature) → Promise<boolean>` | HMAC-SHA256 דרך WebCrypto | ראו 1.5 |

### 1.4 `post()` ו-emitters (MEASURED, `lib/index.js:482-610`)

- מפרק **רק** `data.entry[0].changes[0]` (שורה 493). כל entry/change נוסף באותו payload נזרק בשקט.
- מתוך ה-value לוקח **רק** `messages[0]` (שורה 497) או `statuses[0]` (שורה 521). הודעה/סטטוס שני באותו value נזרקים.
- `field` שאינו `messages` או `calls` (למשל `message_template_status_update`) מסתיים ב-`throw new WhatsAppAPIUnexpectedError("Unexpected payload", 200)` (שורה 609). ה-middleware ממפה זאת ל-200, כלומר Meta לא תנסה שוב, אך שום דבר לא נשמר.
- `phoneID` נלקח מ-`value.metadata.phone_number_id` ומועבר לכל emitter.
- ארגומנטים ל-`on.message`: `{ phoneID, from, message: ServerMessage, name?, raw: PostData, reply(), received(), block(), offload, Whatsapp }`. `from` הוא `contacts[0].wa_id` עם נפילה ל-`message.from`.
- ארגומנטים ל-`on.status`: `{ phoneID, phone (recipient_id), status, id, timestamp, conversation?, pricing?, error? (errors[0]), biz_opaque_callback_data?, raw, offload, Whatsapp }`.
- ארגומנטים ל-`on.sent` (נורה אחרי כל `sendMessage`): `{ phoneID, to, type, message, request, id?, held_for_quality_assessment?, response, offload, Whatsapp }`.
- `on.call.connect` / `on.call.terminate` / `on.call.status` — לשיחות.
- `raw` **כן** נחשף (ה-`PostData` המלא, לא ההודעה הבודדת), ו-`phoneID` **כן** נחשף.

### 1.5 `verifyRequestSignature` (MEASURED, `lib/index.js:658-679`)

- זורק `WhatsAppAPIMissingAppSecretError` (500) בלי `appSecret`, ו-`WhatsAppAPIMissingCryptoSubtleError` (501) בלי `subtle`.
- מפצל על `"sha256="`; אם אין סיומת מחזיר `false`.
- מייבא את המפתח פעם אחת לכל מופע (`this.key`), כלומר מופע חדש לכל בקשה מייבא מחדש.
- מאמת עם `crypto.subtle.verify` (הגלובלי, לא `this.subtle`) מול `Buffer.from(signature, "hex")` — תלות ב-`Buffer` של Node למרות ההצהרה "server agnostic".
- **מחשב את ה-HMAC על `escapeUnicode(raw_body)`** (`lib/utils.js`): כל תו מעל `~` הופך ל-`\uXXXX`. בדיקת ה-route של kalfa משכפלת בדיוק את זה (`route.test.ts:23-39`). המשמעות: אימות עברית עובר דרך הבריחה הזו. הבסיס התיעודי אצל Meta לא נמצא בעמודים שנבדקו היום (DOCS-ONLY: עמוד ה-getting-started וה-overview לא מזכירים escaped unicode); העובדה שה-webhook החי מעבד תשובות בעברית (VERIFIED-LIVE, זיכרון `whatsapp-webhook-state`) היא הראיה המעשית.

### 1.6 מחלקות הודעה (`whatsapp-api-js/messages`)

| משפחה | מחלקות | הערות |
|---|---|---|
| Text | `Text(body, preview_url?)` | עד 4096 תווים |
| Template | `Template(name, language \| Language, ...components)`, `Template.OTP(name, lang, code)`, `Language(code, policy="deterministic")` | ללא components → המפתח `components` נעדר לגמרי. `theres_only_body` קובע אם מגבלת פרמטר-גוף היא 1024 (יש עוד components) או 32768 |
| Template — components | `HeaderComponent(...HeaderParameter)`, `BodyComponent(...BodyParameter)`, `URLComponent(text)`, `PayloadComponent(payload)`, `CopyComponent(code)`, `CatalogComponent(thumbnail)`, `MPMComponent(thumbnail, ...sections)`, `FlowComponent(token, data)`, `SkipButtonComponent()`, `CarouselComponent(...CarouselCard)`, `LTOComponent(expiration_ms)`, `TapTargetComponent(title, url)` | אינדקס כפתור נקבע לפי סדר הבנאי (`button_counter`, `lib/messages/template.js`). `HeaderParameter` טקסט עד 60 תווים; מקבל `Image`/`Document`/`Video`/`Location`/`CatalogProduct`/`Currency`/`DateTime`. תמיכה בפרמטרים בשם (`parameter_name`, `^[a-z_]{1,20}$`) |
| Interactive | `Interactive(action, body?, header?, footer?)`, `Body`, `Header`, `Footer`, `ActionButtons(...Button)` (עד 3), `Button(id, title)` (title עד 20), `ActionList(button, ...ListSection)` (עד 10 sections), `ListSection(title, ...Row)` (עד 10 rows), `Row(id, title, description?)`, `ActionCTA(text, url)`, `ActionFlow({...})`, `ActionCatalog`, `ActionProduct`, `ActionProductList`, `ActionLocation`, `ActionCallPermission` | הודעות session (ללא תבנית) — מותרות רק בתוך חלון 24 השעות |
| Media | `Image`, `Document(file, isId?, caption?, filename?)`, `Video`, `Audio(file, isId?, voice?)`, `Sticker` | `isItAnID` בוחר בין `id` ל-`link` |
| אחר | `Location(long, lat, name?, address?)`, `Contacts(...)` עם `Name`/`Phone`/`Email`/`Address`/`Organization`/`Url`/`Birthday`, `Reaction(message_id, emoji?)` | |

### 1.7 טיפוסים (`whatsapp-api-js/types`, `lib/types.d.ts`)

- `PostData` (שורה 740): `{ object, entry: { id, changes: ({ value: { messaging_product, metadata: { display_phone_number, phone_number_id } } } & (PostDataMessageField | PostDataCallField))[] }[] }`.
  - **אין** שדות template-health (`message_template_status_update`, `template_category_update`, `template_correct_category_detection`, `message_template_quality_update`) — החריג `RawPostData` ב-route מוצדק.
  - **אין** `entry[].time` בטיפוס (ה-route קורא אותו מ-`RawEntry`).
  - `messages` ו-`statuses` מוטפסים כ-tuple של איבר אחד (`[ServerMessage]`), למרות ש-Meta יכולה לשלוח יותר. איטרציה בזמן ריצה עובדת.
- `ServerMessage` = שדות משותפים (`from`, `id`, `timestamp`, `context?`, `referral?`, `errors?`) & איחוד: text / audio / document / image / sticker / video / location / contacts / interactive (button_reply / list_reply / nfm_reply / call_permission_reply) / button / reaction / order / system / request_welcome / unknown / unsupported.
- `ServerStatus` = `"sent" | "delivered" | "read" | "played" | "failed"` (שורה 666).
- `ServerPricing.category` כולל `"marketing_lite"` (שורה 674) — הקטגוריה של MM Lite.
- `ServerSentMessageResponse.messages[0].message_status?: "accepted" | "held_for_quality_assessment"` (שורה 788).
- `ServerErrorResponse = { error: { message, type, code, error_data, error_subcode, fbtrace_id } }`; `ServerMessageResponse = Sent | ErrorResponse`.
- `GetParams = { "hub.mode", "hub.verify_token", "hub.challenge" }`.

### 1.8 שגיאות (`whatsapp-api-js/errors`, MEASURED מ-`lib/errors.js`)

| מחלקה | `httpStatus` |
|---|---|
| `WhatsAppAPIMissingRawBodyError` | 400 |
| `WhatsAppAPIMissingSignatureError` | 401 |
| `WhatsAppAPIMissingAppSecretError` | 500 |
| `WhatsAppAPIMissingCryptoSubtleError` | 501 |
| `WhatsAppAPIFailedToVerifyError` | 401 |
| `WhatsAppAPIMissingVerifyTokenError` | 500 |
| `WhatsAppAPIMissingSearchParamsError` | 400 |
| `WhatsAppAPIFailedToVerifyTokenError` | 403 |
| `WhatsAppAPIPayloadTooLargeError` | 413 |
| `WhatsAppAPIUnexpectedError` | לפי הקריאה (400 ל-payload חסר `object`, 200 לשדה לא מוכר) |

כולן יורשות מ-`WhatsAppAPIError` (אבסטרקטית, `httpStatus` + getter `docs`). **אף אחת לא נזרקת מ-`sendMessage`** — הן שייכות למסלול ה-webhook בלבד.

### 1.9 `setup/*`

`NodeNext`, `Node18` (deprecated), `Node15` (deprecated), `Bun`, `Deno`, `Web`. ב-Node 24 כולן no-op (`NodeNext` מחזיר את האובייקט כמו שהוא).

### 1.10 `middleware/*` — כולל Next.js App Router

- קיים adapter בשם `NextAppMiddleware` (`whatsapp-api-js/middleware/next`). הוא **תת-מחלקה דקה של `WebStandardMiddleware`** (`lib/middleware/next.js` רק קורא ל-`super`).
- `handle_post(req: Request)` (`lib/middleware/web-standard.js:15-33`): קורא `Content-Length` (חסר → `MissingRawBody` → 400), `> 3MB` → 413 (`_MAX_PAYLOAD_SIZE = 3*1024*1024`, `lib/middleware/globals.js:16`), `await req.text()`, `this.post(JSON.parse(body), body, x-hub-signature-256)`, מחזיר 200 או `e.httpStatus` או 500.
- `handle_get(req: Request)`: `this.get(searchParams)`; זורק **מספר** (לא Error) בכישלון.
- שאר ה-adapters: Express, Adonis, Vercel, Deno, Bun, SvelteKit, Cloudflare, WebStandard, NodeHTTP, Azure.
- מסקנה: ה-adapter ל-App Router הוא "טפל בהכל" — הוא צורך את הגוף ומפזר ל-emitters עם כל המגבלות של `post()` (1.4). הוא לא ניתן להפעלה כשלב פרסור בלבד שמאכיל inbox.

---

## חלק 2 — כל שימוש ב-kalfa.me (MEASURED)

### 2.1 ייבוא ישיר של החבילה

`grep -rn "whatsapp-api-js" src worker scripts supabase` (כל הסיומות) מחזיר:

| קובץ | מה מיובא | איך משמש |
|---|---|---|
| `src/lib/whatsapp/client.ts:4-17` | `WhatsAppAPI`; `DEFAULT_API_VERSION` מ-`/types`; `Text, Template, Language, BodyComponent, BodyParameter, HeaderComponent, HeaderParameter, URLComponent, PayloadComponent, Image` מ-`/messages` | ראו 2.2 |
| `src/app/api/webhooks/whatsapp/route.ts:2-3` | `WhatsAppAPI`; `type PostData` מ-`/types` | ראו 2.3 |
| `src/lib/whatsapp/client.test.ts:12-17` | mock ל-`WhatsAppAPI` (`sendMessage`, `$$apiFetch$$`), מחלקות ההודעה נשארות אמיתיות | בדיקות |
| `src/lib/validation/whatsapp-template-health.ts:6`, `route.test.ts:276` | הערות בלבד | — |

אין ייבוא ב-`worker/`, ב-`scripts/` או ב-`supabase/`. ה-worker מגיע ל-SDK רק דרך `client.ts` (esbuild bundle).

### 2.2 `src/lib/whatsapp/client.ts` — מתאם השליחה

| פונקציה | משטח SDK | פרטים |
|---|---|---|
| `buildTemplateMessage` (160-203) | `Template`, `Language`, `HeaderComponent`+`HeaderParameter`+`Image`, `BodyComponent`+`BodyParameter`, `URLComponent`, `PayloadComponent` | סדר: header → body → URL button → quick-reply payloads. מסתמך נכון על `button_counter`. ללא components → תבנית "ערומה" (הבדיקה ב-`client.test.ts:54-70` מאשרת שאין מפתח `components`). `Image` נבנה מ-`link` או מ-`mediaId` (`isItAnID=true`); בפועל הקוראים מעבירים רק `link` (`outreach.ts:132`) |
| `sendWhatsAppTemplate` (205-231) | `new WhatsAppAPI({ token, secure:false, v: DEFAULT_API_VERSION })`, `sendMessage(phoneNumberId, to, message)` | מופע חדש לכל שליחה. שער fail-closed על URL+RSVP יחד (שיתוף מרחב אינדקסים). לא מעביר `context` ולא `biz_opaque_callback_data` |
| `sendWhatsAppMarketingTemplate` (245-289) | `$$apiFetch$$` ל-`https://graph.facebook.com/${DEFAULT_API_VERSION}/${phoneNumberId}/marketing_messages` | גוף ידני: `{messaging_product, recipient_type:'individual', to, type: message._type, [message._type]: message, product_policy:'CLOUD_API_FALLBACK'}`. משתמש ב-getter הפנימי `_type` (מסומן `@internal`). מפענח `res.json()` בעצמו |
| `sendWhatsAppText` (295-308) | `sendMessage` עם `new Text(body)` | הודעת session |
| `classifyResponse` (83-98) | — | מקבל `unknown`, קורא `messages[0].id` ואז `error.code`. תואם לסמנטיקה של `getBody` (שגיאת Graph חוזרת בגוף). **מתעלם מ-`message_status: 'held_for_quality_assessment'`** — הודעה מוחזקת מסווגת כ-`accepted` רגילה |
| `classifyThrow` (105-111) | — | קורא `httpStatus` בצורה duck-typed. `sendMessage` לעולם לא זורק `WhatsAppAPIError`, כך שהשדה יתמלא רק אם קוד אחר יזרוק אובייקט כזה. לא מזיק |
| גרסה | `DEFAULT_API_VERSION` = `v24.0` | ההערה בשורות 217-219 אומרת "never ride the library's own default silently". בפועל הערך **הוא** ברירת המחדל של הספרייה, רק מועבר במפורש. עדכון minor של ה-SDK ישנה את גרסת Graph של kalfa בלי שינוי בריפו |

### 2.3 `src/app/api/webhooks/whatsapp/route.ts` — קליטת webhook

| קטע | משטח SDK | פרטים |
|---|---|---|
| `POST` (161-206) | `new WhatsAppAPI({ token, appSecret, secure:true })` בלי `v` (177-181); `verifyRequestSignature(raw, signature ?? '')` (184) | **בלי `v` → `console.warn` בכל בקשה** (`lib/index.js:130`). MEASURED: 57 מופעים ב-`/var/www/vhosts/kalfa.me/.pm2/logs/kalfa-beta-error.log`, האחרון `2026-09-03 18:04:16 +03:00`; 0 ב-`-out.log`. אותה אזהרה מודפסת בכל בדיקת route ב-vitest. מופע חדש לכל בקשה → ייבוא מפתח HMAC מחדש בכל בקשה |
| `normalizeWebhookRows` (98-141) | `PostData` | איטרציה ידנית על **כל** entry/change/message/status; שומר `value.metadata.phone_number_id` בעמודה `phone_number_id` של כל שורה (104, 115, 131). ההערה בשורות 92-97 מתעדת במדויק למה לא `post()` |
| `normalizeTemplateHealthRows` (64-90) | — (`RawPostData`) | ארבעת שדות ה-template-health. החריג מאומת: אינם ב-`PostData` של 6.2.2 |
| `GET` (145-158) | — | אימות `hub.verify_token` ידני (`===`), לא `wa.get()`. שקול פונקציונלית |
| קריאת גוף (172) | — | `await request.text()` **ללא שער גודל**. ה-middleware של ה-SDK בודק `Content-Length > 3MB` לפני הקריאה |
| טיפוסים | `payload: message as unknown as WebhookInboxInsert['payload']` (117, 133), `data as unknown as RawPostData` (139) | ה-cast ל-`Json` נדרש (`ServerMessage` אינו assignable ל-`Json`) |

`insertWebhookEvents` (`src/lib/data/webhooks.ts:20-29`) עושה upsert עם `ignoreDuplicates` על `(provider, dedupe_key)`. עמודות `webhook_inbox` (MEASURED מ-`types.generated.ts:5161-5176`): `attempts, context_message_id, dedupe_key, event_at, event_kind, id, last_error, message_id, payload, phone_number_id, processed_at, provider, received_at`.

### 2.4 צרכנים עקיפים (דרך `client.ts`)

| קובץ | קריאה | הערות |
|---|---|---|
| `src/lib/data/outreach.ts:38-110` `sendOneWhatsApp` | `sendWhatsAppTemplate` או `sendWhatsAppMarketingTemplate` לפי `MARKETING_MESSAGE_KEYS` | מעביר `bodyParams`, `headerImage` (link חתום), `urlButtonParam`, `rsvpButtonPayloads` (`RSVP_QUICK_REPLY_PAYLOADS`) |
| `src/lib/data/outreach.ts:202-471` `sendCampaignWhatsApp` | → `sendOneWhatsApp` | מסלול ידני + auto-thankyou (worker) |
| `src/lib/data/outreach-engine.ts:440, 731` | → `sendOneWhatsApp` | `executeStep` ו-`prepareAndSendStep` (M1 serial flow) |
| `src/lib/data/headcount.ts:62, 114, 145` | `sendWhatsAppText` ×3 | שאלת headcount, שאלה חוזרת, אישור. טקסט חופשי בחלון 24h |
| `src/lib/data/whatsapp-import.ts:382` | `sendWhatsAppText` | תשובות ליבוא. **וגם** `downloadDocument` (247-267) עם `fetch` גולמי — ראו 2.5 |
| `src/app/api/voximplant/sls/tool/signup-link/[token]/route.ts:135-155` | `sendWhatsAppMarketingTemplate` | `bodyParams:[fullName]`, `urlButtonParam: attemptId`; נפילה ל-SMS |
| `src/app/api/campaigns/[id]/whatsapp-send/route.ts:75` | → `sendCampaignWhatsApp` | |
| `scripts/send-one-invite.ts:80` | → `sendOneWhatsApp` | one-off |
| `src/lib/outreach/enqueue.ts:20` | `type DeliveryOutcome` בלבד | |
| `src/lib/whatsapp/template-spec.ts`, `rsvp-buttons.ts`, `inbound.ts` | ללא SDK | טהורים. `inbound.ts:45-58` מטפס ידנית תת-קבוצה של `ServerMessage`; `webhook-processing.ts:71-74` מטפס ידנית `StatusPayload` |
| `src/lib/data/webhook-processing.ts` | ללא SDK | קורא `row.payload` (Json מה-DB). `stageWhatsAppImport` מנתב לפי `payload.from` בלבד ומתעלם מ-`row.phone_number_id` |

### 2.5 קריאות Graph גולמיות הקשורות ל-WhatsApp (ללא SDK)

| קובץ:שורה | endpoint | גרסה | האם ל-SDK יש מקבילה |
|---|---|---|---|
| `src/lib/data/whatsapp-import.ts:253, 258` | `GET /{mediaId}` ואז `GET {url}` | `v23.0` קשיח | **כן**: `retrieveMedia(id, phoneID?)` + `fetchMedia(url)` |
| `src/lib/whatsapp/template-health.ts:16, 50` | `GET /{wabaId}/message_templates?fields=…` | `v23.0` קשיח | לא (WABA node; ה-SDK לא מממש template management) |
| `src/lib/data/admin/channels.ts:89-96` | `GET /{phoneNumberId}?fields=display_phone_number,verified_name` | `env WHATSAPP_GRAPH_VERSION \|\| 'v23.0'` | לא (phone-number node) |
| `src/lib/relocation/meta-templates.ts:34, 279, 304` | `GET`/`POST /{wabaId}/message_templates` | `v23.0` קשיח | לא |
| `src/lib/relocation/preflight.ts:720` | `GET /{wabaId}/message_templates` | `v21.0` קשיח | לא |
| `src/lib/relocation/external.ts:201` | `POST /{appId}/subscriptions` | `v21.0` קשיח | לא (app node) |
| `src/lib/relocation/env-validation.ts:238` | `GET /debug_token` | ללא גרסה | לא |

ה-resumable upload למדיה של תבניות (`POST /{APP_ID}/uploads`, זיכרון `whatsapp-media-template-submission`) **אינו קיים כקוד בריפו** (grep על `/uploads`, `resumable`, `subscribed_apps` ב-`src`/`scripts` לא מחזיר קוד WhatsApp). זה היה צעד תפעולי חד-פעמי. `uploadMedia` של ה-SDK הוא endpoint אחר ואינו תחליף לו.

### 2.6 גרסאות Graph — תמונת מצב

| מקור | גרסה | פקיעה (DOCS-ONLY, changelog של Meta, נקרא 2026-09-03) |
|---|---|---|
| Meta — האחרונה | `v26.0` (שוחררה 2026-07-29) | טרם נקבעה |
| דיווח team-lead על שדות ה-webhook של האפליקציה | `v25.0` | 2028-07-29 — **לא אומת על ידי** |
| SDK `DEFAULT_API_VERSION` → `client.ts` (שני ה-endpoints) + `route.ts` (משתמע) | `v24.0` | 2028-02-18 |
| `whatsapp-import.ts`, `template-health.ts`, `meta-templates.ts`, `channels.ts` (fallback) | `v23.0` | 2027-10-08 |
| `preflight.ts`, `external.ts` | `v21.0` | 2027-01-21 (הפקיעה הקרובה ביותר) |

---

## חלק 3 — מטריצה וממצאים

### 3.1 מטריצת יכולת × שימוש

סטטוסים: **U** = בשימוש · **P** = בשימוש חלקי · **R** = לא בשימוש אך רלוונטי · **N** = לא בשימוש ולא רלוונטי

| # | יכולת | סטטוס | ראיה / הערה |
|---|---|---|---|
| 1 | `new WhatsAppAPI({token, secure:false, v})` לשליחה | U | `client.ts:221, 257, 300` |
| 2 | `new WhatsAppAPI({token, appSecret, secure:true})` לאימות | U | `route.ts:177-181` |
| 3 | `sendMessage` | U | `client.ts:225, 302` |
| 4 | `$$apiFetch$$` | U | `client.ts:274` (MM Lite) |
| 5 | `verifyRequestSignature` | U | `route.ts:184` |
| 6 | `PostData` + איטרציה ידנית + `metadata.phone_number_id` | U | `route.ts:3, 98-141` |
| 7 | `DEFAULT_API_VERSION` | U | `client.ts:5` |
| 8 | `Template` / `Language` | U | `client.ts:196-203` |
| 9 | `BodyComponent` / `BodyParameter` | U | `client.ts:176-180` |
| 10 | `HeaderComponent` / `HeaderParameter` / `Image` | U | `client.ts:168-173` |
| 11 | `URLComponent` | U | `client.ts:183` |
| 12 | `PayloadComponent` | U | `client.ts:191` |
| 13 | `Text` | U | `client.ts:302` |
| 14 | הצמדת `v` בבנאי | P | ה-route משמיט → אזהרה לכל POST (MEASURED 57) |
| 15 | `ServerMessageResponse` (כולל `message_status`) | P | `classifyResponse` על `unknown`; `held_for_quality_assessment` לא נקרא (`client.ts:83-98`) |
| 16 | `WhatsAppAPIError` / `httpStatus` | P | duck-typing ב-`client.ts:105`; `catch {}` גנרי ב-`route.ts:185` |
| 17 | `ServerMessage` / סטטוסים כטיפוסי עזר | P | תת-קבוצות ידניות ב-`inbound.ts:45-58`, `webhook-processing.ts:71-74` (גבול `Json` — מוצדק) |
| 18 | `retrieveMedia(id, phoneID)` + `fetchMedia(url)` | R | `whatsapp-import.ts:247-267` עושה זאת ידנית ב-`v23.0` |
| 19 | `Interactive` + `ActionList` / `ActionButtons` / `Body` | R | שאלת headcount (`headcount.ts:16-28`, 1–10) ותשובת "כמה אירועים" (`whatsapp-import.ts:157-170`); הקלט כבר מפוענח: `inbound.ts:79-86` קורא `list_reply.id` / `button_reply.id` |
| 20 | `sendMessage(..., context)` (תשובה מצוטטת) | R | שאלת headcount יכולה לצטט את הלחיצה; ערך UX נמוך |
| 21 | `biz_opaque_callback_data` | R | קורלציה ללא PII שחוזרת בסטטוסים; היום הצירוף הוא לפי wamid ועובד |
| 22 | `on.sent` emitter | R | נקודת audit מרכזית ללא PII + דגל `held_for_quality_assessment` |
| 23 | `markAsRead` + typing indicator | R | וי כחול על תשובות נכנסות; דורש `phone_number_id` + message id (שניהם ב-inbox) |
| 24 | שער 3MB (`_MAX_PAYLOAD_SIZE`, `PayloadTooLargeError`) | R | `route.ts:172` קורא גוף בלי גבול לפני אימות |
| 25 | `get()` / `GetParams` / `webhookVerifyToken` | R | מקבילה ידנית שקולה ב-`route.ts:145-158`; אין צורך לשנות |
| 26 | `ServerPricing.category` כולל `marketing_lite` | R | `pricing` נשמר גולמי ב-`webhook_inbox.payload` אך לא נקרא; מדידת אפקט MM Lite |
| 27 | `uploadMedia` | R | media id רב-שימושי במקום link חתום; רק אם Meta תיכשל למשוך את הקישור |
| 28 | `post()` + `on.message` / `on.status` | N | מפיל אחים ב-batch; זורק על template-health (1.4) |
| 29 | `NextAppMiddleware` / `WebStandardMiddleware` וכו' | N | צורך את הגוף; אותן מגבלות (1.10) |
| 30 | `broadcastMessage` | N | ל-kalfa יש serial flow (M1) עם idempotency; ל-SDK אין |
| 31 | Call APIs + `on.call.*` | N | קול דרך Voximplant/ElevenLabs |
| 32 | QR APIs | N | |
| 33 | `blockUser` / `unblockUser` | N | אין `retrieveBlockedUsers`; הגנת fraud-flood נעשית בדחייה קשיחה (זיכרון 17.8) |
| 34 | `deleteMedia` | N | |
| 35 | `Audio` / `Video` / `Sticker` / `Document` (יוצא), `Location`, `Contacts`, `Reaction` | N | |
| 36 | `Carousel` / `LTO` / `Copy` / `Catalog` / `MPM` / `Flow` / `TapTarget` / `Currency` / `DateTime` / פרמטרים בשם | N | תוכן שיווקי; החוזה המאושר הוא positional |
| 37 | `Template.OTP` | N | OTP דרך ExtrA SMS |
| 38 | `ActionCatalog` / `ActionProduct` / `ActionProductList` / `ActionFlow` / `ActionCTA` / `ActionLocation` / `ActionCallPermission` | N | |
| 39 | `setup/*` + `ponyfill` | N | no-op ב-Node 24 |
| 40 | `WhatsAppAPI.offload` | N | |
| 41 | `escapeUnicode` (פנימי) | N | משוכפל בבדיקה בלבד |

**סיכום:** בשימוש 13 · חלקי 4 · לא בשימוש-רלוונטי 10 · לא בשימוש-לא רלוונטי 14 (סה"כ 41 שורות).

### 3.2 כפילויות ידניות של יכולות SDK

1. **הורדת מדיה** — `whatsapp-import.ts:247-267`. תחליף: `api.retrieveMedia(mediaId, row.phone_number_id ?? undefined)` ואז `api.fetchMedia(meta.url)`. הבדלי התנהגות: (א) גרסה `v24.0` (ה-`v` של המופע) במקום `v23.0`; (ב) `phoneID` מגביל את הפעולה למדיה של אותו מספר — שימושי לתוכנית המספר השני; (ג) `fetchMedia` מוסיף UA של Googlebot; (ד) `file_size` מוטפס `string` ב-SDK ואילו הקוד משווה כמספר (עובד בגלל coercion, אבל טיפוס שקרי); (ה) לשניהם אין timeout — צריך להוסיף `AbortSignal.timeout` בכל מקרה (כמו ב-`template-health.ts:56`). צורת השגיאה זהה (`{error}` בגוף).
2. **אימות GET** — `route.ts:145-158` מול `wa.get()`. שקול. המעבר היה דורש `webhookVerifyToken` בבנאי ותרגום זריקות למספרים. לא שווה שינוי. הקשחה אופציונלית שאינה קשורה ל-SDK: השוואה constant-time דרך `src/lib/security/token-compare.ts`.
3. **מעטפת MM Lite** — `client.ts:265-272`. אין מתודה ב-SDK (אומת מול `lib/index.js` וה-changelog). המימוש דרך `$$apiFetch$$` נכון. נקודת שבירות: `message._type` הוא getter `@internal`; עדיף ליטרל `'template'`.
4. **טיפוסי payload נכנס** — `inbound.ts`, `webhook-processing.ts`. הגבול הוא `Json` מה-DB, ולכן סכימת ריצה (zod, כפי שנעשה ל-template-health) עדיפה על טיפוס SDK. אין שינוי מומלץ.
5. **HMAC ידני** — אין. **JSON תבנית ידני** — אין. שני הדברים נעשים דרך ה-SDK.
6. **קריאות WABA / app / phone-number node** (`template-health.ts`, `meta-templates.ts`, `preflight.ts`, `external.ts`, `channels.ts`) — אין מקבילה ב-SDK. `$$apiFetch$$` היה חוסך את כותרת ה-Authorization בלבד, במחיר יצירת מופע; אין תועלת מהותית. מה שכן חסר: קבוע גרסה משותף.

### 3.3 פערי בטיחות טיפוסים

| מקום | מצב | הערכה |
|---|---|---|
| `route.ts:37-46, 139` `RawPostData` | `data as unknown as RawPostData` | **מוצדק** — אומת ש-`PostData` ב-6.2.2 מטפס רק `messages` ו-`calls`, בלי `entry[].time` |
| `route.ts:117, 133` | `message as unknown as WebhookInboxInsert['payload']` | נדרש; `ServerMessage` אינו `Json`-assignable. חלופה טובה יותר לא קיימת בלי סכימה |
| `client.ts:83-88` `classifyResponse(res: unknown)` | cast מקומי | אפשר לטפס כ-`ServerMessageResponse` מ-`whatsapp-api-js/types` ולקבל `message_status` בחינם |
| `client.ts:269-270` | `message._type` | שימוש ב-API פנימי; להחליף ב-`'template'` |
| `client.ts:105` `classifyThrow` | `httpStatus` duck-typed | `sendMessage` לא זורק `WhatsAppAPIError`; ההגנה כמעט לעולם לא תופסת. תיעוד, לא באג |
| `whatsapp-import.ts:256` | `file_size?: number` | ה-SDK מטפס `string`. הקוד עובד בזכות coercion |
| `inbound.ts:45-58`, `webhook-processing.ts:71-74` | טיפוסים ידניים | תקין כגבול `Json`; אפשר להוסיף `satisfies Partial<ServerMessage>` כבדיקת התאמה בקומפילציה — עדיפות נמוכה |

### 3.4 הערת ארכיטקטורה — persist-then-process מול `post()`/emitters

**השאלה:** האם להשתמש ב-`post()` + `on.message`/`on.status` בתוך ה-route רק כפרסר מוטפס שמאכיל את `webhook_inbox`, תוך שמירה על persist-then-process?

**ממצאים (MEASURED):**
- `post()` מפרק `entry[0].changes[0]` בלבד ו-`messages[0]`/`statuses[0]` בלבד (`lib/index.js:493, 497, 521`). כל אירוע נוסף באותו POST אובד. הבדיקות של kalfa מכסות במפורש ריבוי entries/changes/messages/statuses (`route.test.ts:133-222`).
- שדות template-health גורמים ל-`WhatsAppAPIUnexpectedError(…, 200)` (`lib/index.js:609`). דרך `post()` הם לעולם לא יגיעו ל-inbox.
- ה-emitters חושפים `phoneID` = `value.metadata.phone_number_id` ו-`raw` = ה-`PostData` המלא. אותו שדה בדיוק כבר נשמר היום בעמודה `webhook_inbox.phone_number_id` על **כל** שורה (`route.ts:104, 115, 131`). כלומר, לתוכנית "מספר שני = ערוץ ייבוא" המידע כבר קיים בטבלה ואין צורך ב-emitters כדי לקבל אותו.
- `NextAppMiddleware` צורך את הגוף ומחזיר קוד סטטוס; אי אפשר להכניס בין הפרסור לבין ה-emitters שלב שמירה.

**מסקנה:** להישאר על איטרציה ידנית מעל `PostData`. זו האפשרות השלמה יותר, וה-SDK ממשיך לשמש כמאמת חתימה וכמקור טיפוסים. מה שכן נדרש לתוכנית המספר השני, מחוץ ל-SDK:
- ב-`webhook-processing.ts` / `stageWhatsAppImport`: לנתב לפי `row.phone_number_id` (היום מתעלם ממנו ומנתב לפי `payload.from` בלבד).
- ב-`outreach-config.ts`: `getWhatsAppConfig` הוא singleton עם `phoneNumberId` אחד. תשובה לשולח צריכה לצאת **מאותו** `phone_number_id` שבו הגיע המסמך; `sendWhatsAppText(cfg, …)` כבר מקבל `cfg.phoneNumberId`, כך שהקורא צריך להעביר את ערך השורה (אותו token של ה-WABA משרת את שני המספרים — DOCS-ONLY).
- `retrieveMedia(mediaId, phone_number_id)` נותן הגנה נוספת: משיכת מדיה תיכשל אם המדיה אינה של אותו מספר.

**עובדות webhook נוספות (DOCS-ONLY, עמוד overview של Meta, נקרא היום):** גודל payload עד 3MB; ניסיונות חוזרים בתדירות יורדת עד 7 ימים על כל תשובה שאינה 200; תמיכה ב-mTLS. השלכה: ה-route מחזיר 401 על חתימה שגויה — בקשה אמיתית של Meta עם secret לא תואם תיצור ניסיונות חוזרים במשך שבוע (fail-closed מכוון).

### 3.5 גרסה ותחזוקה

| פריט | ממצא |
|---|---|
| אימוץ | 2026-06-26 ב-`^6.2.1` (commit `258b5ba`; `client.ts` ב-`ab23184`, route ב-`181a6f3`, אותו יום) — MEASURED מ-git |
| lockfile | עבר ל-6.2.2 ב-`abf80e1` 2026-07-22 ("chore(deps): refresh project dependencies") |
| `package.json` היום | HEAD: `^6.2.1`; עץ עבודה: `^6.2.2` **לא מחויב** (`git diff HEAD -- package.json`). אין הבדל בגרסה המותקנת |
| שחרורים (MEASURED מ-`gh api` + `npm view time`) | 6.1.1 — 2025-10-13 (שיפור ביצועי `verifyRequestSignature`, `this` גלובלי) · 6.2.0 — 2025-11-21 (**ברירת מחדל `v24.0`**, Cloudflare middleware, עדכון טיפוסים) · 6.2.1 — 2025-11-23 (voice notes) · 6.2.2-beta.0 — 2026-03-23 (BSUID support, pnpm, eslint 10) · **6.2.2 — 2026-07-17** ("Non-breaking update, doesn't include BSUID support": תלויות בלבד) · 6.2.3-beta.0 — 2026-07-17 (תיאור חבילה + תלויות) |
| שינויים שוברים | האחרונים ב-6.0.0 (הסרת `parsed`, טיפוסי pricing, הסרת Node 18, ברירת מחדל `v23.0`) — DOCS-ONLY מ-BREAKING.md. **אין שינוי שובר מאז האימוץ** |
| BSUID | ה-beta נושא "Add BSUIDs support" (Business-Scoped User IDs). אם Meta תחליף `wa_id`/`from` במזהה שאינו מספר טלפון, שני מסלולים ב-kalfa שמניחים E.164 ייפגעו: `resolveInboundContact(payload.from)` (`webhook-processing.ts:197`) ו-`normalizePhone(p.from)` בייבוא (`whatsapp-import.ts:295`). INFERRED מהערות השחרור — לאמת מול תיעוד Meta לפני החלטה |
| תחזוקה | מתחזק יחיד; זרם renovate פעיל; שחרור יציב אחרון לפני 7 שבועות; ESM בלבד — נבנה היטב ל-worker דרך esbuild (הראיה: `outreach-engine.ts` מייבא `client.ts` והמסלול חי) |
| Graph drift | ראו 2.6. הפקיעה הקרובה ביותר: `v21.0` ב-2027-01-21 (relocation בלבד). אין דחיפות, אבל אין קבוע אחד בבעלות kalfa: הגרסה של השליחה נקבעת על ידי ה-SDK, ושאר הקבצים מקודדים ידנית |

בדיקות (MEASURED, סשן זה): `npx vitest run src/lib/whatsapp src/app/api/webhooks/whatsapp src/lib/data/whatsapp-import.test.ts` → 6 קבצים, 122 בדיקות עוברות. הפלט כולל את אזהרת ה-`v` בכל בדיקת route.

### 3.6 המלצות מדורגות

כללי בית שחלים על כולן: שימוש חוזר בקיים ולא SDK חדש; סיווג UTILITY/MARKETING של Meta לא נוגעים בו; תבניות לעולם לא נמחקות (רק שם חדש בגרסה); שינוי שליחה אמיתי דורש אישור בעלים.

**P0 — אין.** לא נמצא ממצא שמסכן ייצור.

**P1 — לאמץ עכשיו**

| # | המלצה | מאמץ | סיכון | כללים |
|---|---|---|---|---|
| 1 | להעביר `v` בבנאי של `route.ts:177` ולהגדיר קבוע אחד בבעלות kalfa (למשל `GRAPH_API_VERSION` ב-`src/lib/whatsapp/`) שמוזן גם ל-`client.ts` (במקום `DEFAULT_API_VERSION` של ה-SDK) וגם לכל ה-`fetch` הגולמיים ב-2.5. `WHATSAPP_GRAPH_VERSION` ב-`channels.ts:89` הוא הזרע הקיים | XS–S | אפסי; מבטל את 57+ האזהרות ומנתק את גרסת Graph מעדכוני minor של ה-SDK | "אזהרות = חובה לטפל"; reuse existing |
| 2 | `whatsapp-import.ts` `downloadDocument`: להחליף את שני ה-`fetch` ב-`retrieveMedia(mediaId, row.phone_number_id)` + `fetchMedia(url)`, להוסיף `AbortSignal.timeout`, לשמור את תקרת 1MB | S | נמוך; שינוי התנהגות = כותרת UA + גרסה. לבדוק פעם אחת עם קובץ אמיתי אחרי פריסה | מתחבר ישירות לתוכנית ערוץ הייבוא |
| 3 | לטפס את תוצאת השליחה כ-`ServerMessageResponse` ולקרוא `message_status`; להחליף `message._type` בליטרל `'template'` | XS | אפסי; הכנה ל-#5 | |

**P2 — כשנוגעים באזור**

| # | המלצה | מאמץ | סיכון |
|---|---|---|---|
| 4 | שער `Content-Length > 3MB → 413` ב-`route.ts` לפני `request.text()` (שיקוף `_MAX_PAYLOAD_SIZE`); אופציונלי: מופע `WhatsAppAPI` ממוזכר לפי `appSecret` כדי לא לייבא מפתח HMAC בכל בקשה | XS | אפסי |
| 5 | לרשום `held_for_quality_assessment` כדגל על ה-outcome (עדיין `accepted` מבחינת ה-serial flow, אבל גלוי ב-`contact_interactions`/לוג) | XS–S | דורש החלטה סמנטית קטנה; לא משנה resend |
| 6 | הודעות Interactive בחלון 24h: שאלת headcount כ-`ActionList` עם 10 שורות ("1".."10") במקום פרסור טקסט; תשובת "כמה אירועים פעילים" בייבוא כ-`ActionList` של אירועים. הצד הנכנס כבר מפוענח (`inbound.ts:79-86`) | M | נמוך; אלו הודעות session ללא תבנית, ללא 131049. חוב המוצר "1–10 מול expected_count>10" נשאר |
| 7 | `markAsRead` על תשובות אנושיות נכנסות (+ typing indicator לפני שאלת headcount) | S | קוסמטי; דורש `phone_number_id` + message id מה-inbox |
| 8 | יישור פינים `v21.0` ב-relocation ל-קבוע מ-#1 | XS | אפסי |
| 9 | לסגור את העריכה התלויה ב-`package.json` (`^6.2.1` → `^6.2.2`): לחייב יחד עם ה-lockfile או לבטל. החלטת בעלים | XS | אפסי |

**לא שווה — ולמה**

| יכולת | סיבה |
|---|---|
| `post()` / emitters / `NextAppMiddleware` | מפילים אירועים ב-batch וזורקים על template-health; ה-route הידני מכסה יותר |
| `broadcastMessage` | ה-serial flow (M1) הוא מנגנון הקצב וה-idempotency; ל-SDK אין אף אחד מהם |
| `biz_opaque_callback_data` | הצירוף לפי wamid עובד; להוסיף רק אם יימצא כשל בצירוף |
| `uploadMedia` להדר תמונה | link חתום עובד; media id יעזור רק אם Meta תיכשל למשוך |
| `Carousel`/`LTO`/`Copy`/`Flow`/`Template.OTP`/commerce | תוכן שיווקי או מחוץ למוצר; לא משנים סיווג |
| QR / block / call APIs | לא במוצר; `blockUser` דורש inbound בחלון 24h, וההגנה מפני fraud-flood נעשית אחרת |
| החלפת `fetch` גולמי ל-WABA/app nodes ב-`$$apiFetch$$` | אין רווח פונקציונלי; רק לחלוק את קבוע הגרסה |
| שדרוג ל-6.2.3-beta | beta; אבל לעקוב אחרי BSUID |
| `setup/*`, `ponyfill` | no-op ב-Node 24 |

---

## מה לא אומת בסשן זה

- ~~גרסת ה-Graph שמדווחת בשדות ה-webhook של האפליקציה (`v25.0`)~~ — **אומת ע"י team-lead ב-2026-09-03** (MEASURED): `GET /{app-id}/subscriptions` עם app token החזיר מנוי פעיל על `whatsapp_business_account` → `https://beta.kalfa.me/api/webhooks/whatsapp`, וכל השדות (`messages`, `message_template_status_update`, …) ב-`version: v25.0`.
- הבסיס התיעודי אצל Meta לחתימה על גוף escaped-unicode — לא נמצא בעמודי ה-webhooks שנקראו היום; ה-SDK מיישם זאת וה-webhook החי עובד (VERIFIED-LIVE בעבר).
- הסיבה ל-UA של Googlebot ב-`fetchMedia` — הערת קוד בלבד.
- מצב ה-rollout של BSUID אצל Meta והשפעתו על `from`/`wa_id`.
- האם התרחשה אי פעם תשובת `held_for_quality_assessment` בפועל — אין כלי שאילתה DB לקריאה בלבד בריפו, לא נמדד.
- קבלת `recipient_type` ב-`/marketing_messages` — מכוסה בבדיקות יחידה בלבד.
