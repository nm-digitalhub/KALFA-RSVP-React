# תוכנית: אישורי הגעה באמצעות AI Voice (Voximplant, "C2")

**סטטוס: תוכנית בלבד. לא בוצע שום שינוי קוד/מיגרציה/אינטגרציה.**

**היקף:** בניית הערוץ השני (call/AI-voice) של אותה תוכנית-אחת שכבר קיימת
("אישורי הגעה — וואטסאפ + שיחות AI") — הטאב `voximplant` הקיים ב-
`/admin/channels` הוא כרגע placeholder ריק לחלוטין. זהו נתיב-חיוב **קריטי
לכסף** (מפעיל את אותה `try_record_billed_result` RPC שמחייבת לקוחות אמיתיים)
ו-**AI calling** — cross-cutting לפי CLAUDE.md, דורש תוכנית כתובה + אישור
מפורש לפני מימוש. **כל שורה כאן אומתה ישירות מול הקוד/DB החי או מול תיעוד
Voximplant הרשמי (context7/WebFetch) — לא מזיכרון.**

> **הערה קריטית — יחס למסמך `curious-mapping-thimble.md` (Phase 1, מאושר
> בplan-mode):** מסמך זה (C2) הוא מסמך **מחקר/מיפוי-אפשרויות** רחב —
> **הוא אינו** תוכנית-המימוש. שש ההחלטות הנעולות של Phase 1 **גוברות**
> על כל מקום במסמך הזה שסותר אותן, במיוחד: **DTMF-only** (לא LLM/שיח-
> חופשי — §4.2/§7 למטה עדיין מנוסחים כאילו זו החלטה פתוחה; היא **לא**,
> עבור Phase 1), טבלת `call_attempts` ייעודית (לא הרחבת `outreach_state`),
> `attempt_id` שלנו כ-idempotency anchor היחיד, ואי-אמון במזהים החוזרים
> מה-payload. במקומות שבהם המסמך הזה מנוסח כאילו אלה עדיין החלטות
> פתוחות — זו טעות-עריכה שתוקנה בסבב האימות האחרון (ראו §2.10/§4.1/§4.3-
> 4.5/§5), לא כוונה לפתוח אותן מחדש.

---

## §1. עובדות מאומתות — תשתית קיימת בקוד (לא הנחות)

### 1.1 זו תוכנית-חיוב אחת, לא שני מוצרים — אומת מול ה-RPC החי

`try_record_billed_result` (`pg_get_functiondef`, נבדק ישירות): `p_channel`
הוא פרמטר **נשמר לרישום בלבד**, לא משפיע על `v_price` (הנגזר אך ורק מ-
`campaigns.price_per_reached`, שדה יחיד לקמפיין). החיוב הוא **ברמת
`(event_id, contact_id)`** (`insert ... on conflict (event_id,contact_id)
do nothing`) — הגעה ב-whatsapp *או* בשיחה מחייבת **פעם אחת בלבד**, לא
שתיים. תקרת החיוב (`max_charge_ceiling`) משותפת. `billed_results` (סכימה
מלאה, נבדקה): `id, event_id, campaign_id, contact_id, channel, attempt_id,
reached_at, locked_price, evidence_source, provider_ref, control_status,
manual_adjustment, created_at`.

### 1.2 נקודת-החיבור הקיימת, מוכנה ומחכה — `writeReach()`

`outreach-engine.ts:333-343`:
```ts
// The SHARED reach path (both channels). Records the billed reach through the
// SAME try_record_billed_result RPC (cross-channel dedup) — never a raw insert —
// and on 'billed' stops the contact's outreach. Called by the WhatsApp webhook
// and (C2) the call result webhook. Must carry campaignId + attemptId.
export async function writeReach(args: ReachedArgs): Promise<string> {
  const outcome = await recordReached(args);
  if (outcome === 'billed') {
    await setOutreachStatus(args.campaignId, args.contactId, 'reached', 'reached');
  }
  return outcome;
}
```
**ממצא קריטי, מאומת ב-grep מלא על `src/`:** `writeReach` **לא נקרא משום
מקום בקודבייס היום** — ה-webhook הקיים של WhatsApp (`webhook-processing.ts:
108`) קורא ל-`recordReached()` (`billing.ts`) **ישירות**, לא דרך
`writeReach()`. ההערה בקוד ("Called by the WhatsApp webhook") **לא
תואמת את המימוש בפועל** — זה לא שקר, זה תיעוד שמתאר כוונה עתידית שעדיין
לא סונכרן. **זה לא שובר כלום כרגע**, כי (§1.3) יש מנגנון eventually-
consistent נפרד — אבל זו סתירה-תיעוד אמיתית שכדאי לתקן כשבונים call.

### 1.3 למה אי-קריאה ל-`writeReach()` לא שוברת דבר — eventually consistent

`isContactReached()` (`outreach-engine.ts:119-130`) קורא **ישירות** מ-
`billed_results` (`select ... from billed_results where event_id=... and
contact_id=...`), **לא** מ-`outreach_state`. `stepGate` (worker/main.ts:75-76)
בודק את זה **בכל שלב מתוזמן עתידי**, ומעדכן `outreach_state.status='reached'`
**באיחור, בדיעבד** אם צריך. כלומר `outreach_state` הוא cache לא-קריטי;
`billed_results` הוא מקור-האמת. **מסקנה לתכנון:** מסלול ה-AI-voice **חייב**
לכתוב ל-`billed_results` (דרך `recordReached()`, ישירות או דרך `writeReach()`)
— זה החלק החיוני. עדכון `outreach_state` המיידי (`writeReach()`'s value-add)
הוא אופטימיזציה, לא דרישה.

### 1.4 הדפוס הקיים לחיוב-מ-webhook — הטמפלט המדויק ל-call

`webhook-processing.ts:79-119` (WhatsApp inbound, פוענח שורה-שורה):
1. **Persist-then-process**: HTTP route מאמת חתימה + שומר ל-`webhook_inbox`
   בלבד; כל הלוגיקה הכלכלית רצה **out-of-band ע"י ה-worker** (לא חוסם את
   ה-webhook של הספק).
2. **פענוח + סינון-billable**: `classifyMessagePayload` — האם זו הודעה
   שמזכה בחיוב בכלל.
3. **פתרון contact**: `resolveByContextId` (מזהה-הקשר מדויק, "reply
   מצטט את ה-wamid היוצא") עם נפילה ל-`resolveInboundContact` (טלפון).
4. **Dedup אטומי לפני חיוב**: `insertInteraction()` — `.upsert(row,
   {onConflict:'channel,provider_id', ignoreDuplicates:true})` (אומת,
   `interactions.ts:34-43`) — מחזיר `fresh: boolean`. **בדיוק אותו דפוס**
   שכבר קיים בתוכנית `packages` (§5.6 שם) — לא המצאה חדשה.
5. **חיוב רק אם fresh**: `recordReached({eventId, campaignId, contactId,
   channel:'whatsapp', attemptId: messageId, evidence, providerRef:
   messageId})`.
6. **RSVP (אופציונלי, נפרד מהחיוב)**: אם התשובה היא RSVP quick-reply,
   `submitRsvp()` — **אותו RPC אטומי** שהטופס הציבורי (`/r/[token]`)
   משתמש בו, לא מומש-מחדש.

### 1.5 מה כבר קיים בצד ה-outbound (`outreach-engine.ts:280-330`)

ענף `call` ב-`executeStep()` **כבר בנוי** — בודק `contact.removal_requested`,
`ctx.allowed_channels.includes('call')`, קורא ל-`claimStep()` (at-most-once
guard, זהה ל-whatsapp), ואז מייצר `OutreachCallRequest` (`queues.ts:23-30`:
`{campaignId, eventId, contactId, normalizedPhone, scriptKey, touchpointIndex}`
— `scriptKey` = `tp.message_key` מ-`outreach_schedule`) ומחזיר אותו ל-worker
(`worker/main.ts:103`) שמכניס אותו לתור `outreach-call-request`
(`QUEUES.callRequest`). **אומת ב-grep מלא: אין שום `boss.work(QUEUES.
callRequest, ...)` רשום — אף תהליך לא מרוקן את התור הזה.** Jobs מצטברים
בלי עיבוד.

### 1.6 טבלאות scaffolding קיימות שכבר תומכות בערוץ call

`contact_interactions` (סכימה מלאה, נבדקה): `id, event_id, campaign_id,
contact_id, channel, direction, kind, provider_id, billable, payload_meta,
created_at, guest_id, context_message_id, delivery_status,
delivery_error_code` — **כבר channel-generic**, `channel` הוא ה-enum
`campaign_channel` (whatsapp/call), לא whatsapp-only. `UNIQUE(channel,
provider_id)` (אומת ב-DB) תומך ב-`call` באותה מידה.

### 1.7 UI קיים — placeholder ריק לחלוטין

`channels-client.tsx:193-194,302-306` (נקרא ישירות, לא מסקנה): טאב
`voximplant` מנוטרל, ותוכנו כולו:
```tsx
<TabsPanel value="voximplant">
  <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
    ערוץ שיחות ה-AI (Voximplant) ייפתח להגדרה עם בניית הערוץ (C2).
  </div>
</TabsPanel>
```
טאב ה-WhatsApp הפעיל (`channels-client.tsx:198-284`) הוא **תבנית מוכנה
לחיקוי**: `StatusBadge` (configured/enabled), `Accordion` לפרטי-התחברות,
`SecretField` לסודות (עם מסכה+reveal, "נשמר מוצפן, לעולם לא נחשף בלוגים"),
`CopyRow` להצגת callback URL, טופס בדיקת-חיבור נפרד (`testAction`).
`app_settings` (אומת דרך `getWhatsAppChannelConfig`, `channels.ts:25-48`)
הוא ה-singleton שמאחסן את פרטי ההתחברות (`whatsapp_phone_number_id`,
`whatsapp_access_token` וכו') — אותו דפוס מתאים ל-Voximplant.

---

## §2. עובדות מאומתות — Voximplant Management API (מחקר חיצוני, מצוטט)

**החלטה ארכיטקטונית קיימת, לא לדיון:** מהזיכרון (session קודם) — "Voximplant
SDK vulnerable — @voximplant/apiclient-nodejs ships vulnerable axios/form-data
in all versions; use Management API via fetch". **אומת שוב** שה-Management
API אכן תומך תקשורת `fetch()` פשוטה, לא זקוק ל-SDK.

### 2.1 אימות — JWT RS256, לא HMAC-signing

שיטה מומלצת (Service Accounts): JWT חתום RS256 מתוך `credentials.json`
(`kid` ב-header; `iss`=account_id, `iat`, `exp`≤iat+3600 — **טוקן תקף עד
שעה, השרת שלנו צריך למנפק מחדש כל ~שעה**), נשלח כ-`Authorization: Bearer
<token>`. תואם `fetch()` רגיל + ספריית JWT-signing סטנדרטית (למשל
`jsonwebtoken`) — **לא** צריך את ה-SDK הפגיע.
מקור: https://voximplant.com/docs/guides/management-api/authorization

### 2.2 יצירת שיחה יוצאת — `StartScenarios`

`POST https://api.voximplant.com/platform_api/StartScenarios/` עם
`account_id`, `rule_id` (**חובה** — סקריפט VoxEngine חייב להיות מקושר
מראש ל-rule, אי אפשר להריץ סקריפט "חשוף"), `script_custom_data` (מחרוזת
— זה הערוץ להעביר טלפון-יעד/שם-אורח/תאריך-אירוע פנימה), אופציונלי
`reference_ip`/`server_location`. תגובה: `call_session_history_id`
(מזהה-הפעלה של Voximplant), `media_session_access_url`.
מקור: https://voximplant.com/docs/references/httpapi/scenarios

> **תיקון (סבב אימות שישי):** השורה המקורית כאן תיארה את
> `call_session_history_id` כ"ה-idempotency anchor הטבעי" — **זו טעות**,
> וסתרה את §4.1/Phase-1 (curious-mapping-thimble.md, החלטה #3) בהמשך
> המסמך. `call_session_history_id` **לא יכול** לשמש עוגן-idempotency,
> כי הוא לא ידוע **לפני** קריאת `StartScenarios` — אם התהליך קורס בין
> שליחת הבקשה לקבלת התגובה, אין לנו עדיין את המזהה הזה כדי למנוע חיוג-
> כפול בניסיון-חוזר. העוגן האמיתי הוא **`attempt_id`** שלנו — `uuid`
> שנוצר ונשמר ב-DB (`call_attempts.id`) **לפני** קריאת `StartScenarios`
> (ראו §4.1). `call_session_history_id` הוא מזהה-ספק שמוחזר **אחרי**
> ההצלחה, ותפקידו היחיד הוא **reconciliation** (§4.5) — נשמר בעמודה
> `call_attempts.vox_call_session_history_id`, לא משמש לדה-דופ.

**בתוך הסקריפט** (JS שרץ על שרתי Voximplant, לא בשרת שלנו): החיוג בפועל
הוא `VoxEngine.callPSTN(destination, callerId)` — לא קריאת HTTP נפרדת.

### 2.2 פריסת הסקריפט עצמה — משטח נפרד

סקריפטים (VoxEngine JS) חייבים **להיטען/להישמר ולהתקשר ל-rule מראש**
(`CreateScenario`/`SetScenarioInfo`, לא נמצא סכימת-פרמטרים מלאה — **פער
מחקר מפורש, לא הונח**) — פעולה חד-פעמית (או ב-CI/CD), נפרדת מהפעלת-שיחה
בפועל. ניתן גם דרך Control Panel UI.

### 2.3 קבלת תוצאת-שיחה — push נבנה-ע"י-המפתח, לא webhook מובנה

**אין** מנגנון "הרשם URL, נקבל POST אוטומטי לכל שיחה" ברמת הפלטפורמה
הבסיסית (אומת — לא נמצא, מסומן כפער-מחקר). מה שכן קיים: קוד הסקריפט
עצמו קורא ל-`Net.httpRequest(url, callback, options)` (timeout: 6s
connect/90s total, מגבלת תגובה 2MB) **מתוך** ה-handler של `Terminated`/
`Disconnected` — **אנחנו כותבים את הקריאה הזו בעצמנו בתוך הסקריפט**, לא
מקבלים אותה מוכנה. **חלופת-משנה (backstop, לא תלוי-push):**
`GetCallHistory` (`account_id`, `from_date`, `to_date`, סינון לפי
`call_session_history_custom_data`) — pull, למניעת אובדן-תוצאה אם ה-push
נכשל. `CallEvents.Failed`/`Disconnected` בתוך הסקריפט חושפים קודי-סטטוס
(486 busy, 404 מספר-לא-תקין, 480 לא-זמין, 408 timeout, 603 נדחה, 402 יתרה).
מקורות: https://voximplant.com/docs/references/voxengine/net/httprequest,
https://voximplant.com/docs/references/httpapi/history,
https://voximplant.com/docs/references/voxengine/callevents

### 2.4 "AI voice" — אין מוצר מוכן, יש primitives

**אין** בוט-RSVP מוכן-מהקופסה. שני מסלולי-בנייה תקפים תחת אותה
Management API:
- **(א) IVR פשוט (TTS+DTMF, ללא LLM)**: `Call.say()` + `handleTones`/
  `ToneReceived` ("הקישו 1 לאישור הגעה") — מודול `IVR` מתועד, זול,
  דטרמיניסטי, **ללא עלות LLM**.
- **(ב) שיח-AI (LLM)**: "Voice AI Orchestration" — קונקטורים ל-OpenAI/
  Ultravox/Deepgram וכו', חיבור audio בין השיחה ל-AI client
  (`sendMediaBetween`). חילוץ תשובה מובנית (כן/לא) דורש **קוד
  function-calling/פענוח-transcript עצמאי**, לא פיצ'ר מובנה.
- **(ג) Voximplant Kit** — מוצר-נפרד, no-code, API/חשבון נפרדים
  (`kit-apidoc.voximplant.com`) — **לא הונח** שהוא נגיש תחת אותם
  credentials של ה-Management API הליבה; דורש בדיקה עצמאית אם רלוונטי.
מקורות: https://docs.voximplant.ai/voice-ai-orchestration/overview,
https://voximplant.com/docs/references/voxengine/ivr

### 2.5 מגבלות/gotchas מאומתים

- מקסימום **10 שיחות "מתקדמות" (מצלצלות) בו-זמנית** ו-**50 ניסיונות
  שיחה סה"כ** לכל JS session; timeout ללא-מענה 60s.
- **לנפח: `Call Lists`** (`CreateCallList`/`getCallListDetails`) הוא
  ה-primitive המובנה ל-"חייג לכל האורחים הממתינים" — CSV/JSON, concurrency
  (`max_simultaneous`), retry policy (`num_attempts`+`interval_seconds`),
  חלונות-זמן (`call_schedule`, UTC+0).
- **אין idempotency-key מתועד** ל-`StartScenarios` — דה-דופ הוא **אחריות
  האפליקציה שלנו** (למשל: לא לחייג שוב לאיש-קשר עם תוצאה כבר-רשומה).
- **Caller ID**: חייב מספר-Voximplant או מספר מאומת (`VerifyCallerID`) —
  לא ניתן להשתמש במספר-ניסיון.
- **AMD (זיהוי-משיבון) לא זמין לישראל** — רשימת המדינות הנתמכות (ברזיל,
  קולומביה, קזחסטן, מקסיקו, רוסיה) **לא כוללת ישראל**. משמעות: אי-אפשר
  לסמוך על הפלטפורמה לדלג על תא-קולי אוטומטית — נדרשת היוריסטיקה עצמאית
  או קבלת נשירות-למשיבון כסיכון-מקובל.
- **Rate limit מדויק ל-Management API לא פורסם** (רק ש-`429` קיים) —
  מומלץ exponential backoff, לא ראוי להניח מספר.
מקורות: https://voximplant.com/docs/howtos/integration/httpapi/restrictions,
https://voximplant.com/docs/guides/solutions/call-lists,
https://voximplant.com/help/faq/how-can-i-enable-caller-id-for-outbound-calls,
https://voximplant.com/docs/guides/calls/voicemail-detection

### 2.6 עלות (מפורסם, `voximplant.com/pricing`)

PSTN יוצא: **מ-$0.017/דקה** (עגול-כלפי-מעלה לדקה שלמה) — **תעריף ישראל
ספציפי לא אותר** בעמוד הציבורי (מאחורי גיליון-הורדה, פער-מחקר). רכיבי AI
(אם נבחר מסלול ב'): STT $0.034/דק', TTS ~$0.00025/10 תווים, connector
$0.004/דק', end-of-turn $0.002/דק'. **מסלול (א) IVR ללא LLM זול משמעותית**
— רק תעריף ה-PSTN הבסיסי.

### 2.7 חסם רגולטורי — נדרש אישור משפטי, לא רק טכני

חוק התקשורת (בזק ושידורים) תשמ"ב-1982 §30א מגביל חיוג-אוטומטי לפרסומת
ללא הסכמה מראש; תיקון 61 לחוק הגנת הצרכן (בתוקף מ-1.1.2023) הקים מרשם
"אל תתקשרו". שיחת-אישור-הגעה ללקוח/אורח מוזמן היא כנראה **עסקית-
טרנזקציונית, לא פרסומית** — אבל זו **קביעה משפטית**, לא טכנית, ו-Voximplant
לא מתייחסים לזה כלל. **חובה אישור משפטי מפורש לפני חיוג אוטומטי ללקוחות
ישראלים**, עקבי עם הדפוס הקיים בפרויקט ("אישור מפורש ל-messaging/AI
calling").

---

## §2.8 אימות חי מול חשבון אמיתי (לא עוד תיעוד בלבד)

בוצעה בדיקת-חיבור read-only (JWT RS256 → `GetAccountInfo`, ללא שום שיחה/
פעולה בלתי-הפיכה) מול חשבון Voximplant אמיתי שהמשתמש סיפק. **אומת בפועל:**
מנגנון החתימה (§2.1) עובד נכון עם `jsonwebtoken` (npm, כבר הותקן) — אין
צורך ב-SDK. `account_id=10694307`, פעיל (`active:true, frozen:false`),
`location: Asia/Jerusalem`, מדינת-חיוב IL — עקבי עם חשבון KALFA אמיתי.

**מגבלה מעשית חדשה, קריטית לתכנון:** יתרת החשבון היא **$2.88 בלבד**. גם
לפי התעריף הזול ביותר (IVR, ~$0.017/דקה מארה"ב — תעריף ישראל בפועל עדיין
לא ידוע, §3) זו תקציב של דקות בודדות. **לפני כל בדיקה עם שיחת-אמת (גם
POC), נדרשת תוספת-יתרה** — לא נושא טכני, אבל חוסם מעשי לכל שלב אחרי כתיבת
הקוד.

---

## §2.9 מפת-אפשרויות רחבה — לא מקובעת על תיעוד Voximplant (סבב-מחקר שני)

**בעקבות בקשה מפורשת שלא להיות מושפע מהמסגור העצמי של Voximplant** — סבב
מחקר נפרד (3 סוכנים עצמאיים, לא קוראים בתיעוד Voximplant) מיפה את מרחב
האפשרויות המלא. הממצא המרכזי, שמתכנס **באופן עצמאי בשני דוחות שונים**:
**איכות עברית היא האילוץ הקובע**, לא הארכיטקטורה. פירוט:

### א. פלטפורמות AI-voice-agent ייעודיות — פירוט ברמת-ספק (סבב-מחקר שלישי, מפורט יותר)

**ממצא הכי-רלוונטי ל-KALFA — Ultravox מפרט את Voximplant במפורש כאופציית
BYO-טלפוניה** ("BYO Twilio / Telnyx / Plivo / jambonz / **VOXIMPLANT**",
מתועד ישירות): $0.05/דקה S2S bundled (30 דקות חינם), או $0.005/דקה
בלבד ב-PAYG-SIP (Pro: $0.0048). כלומר יש מוצר קיים שתומך **ישירות**
ב"השאר את Voximplant, הוסף רק שכבת-AI" — לא רק תיאוריה ארכיטקטונית
(§ב). עברית **לא מתועדת** במפורש (משתמש ב-Whisper STT שתומך עברית, אבל
לא אומת למודל ה-S2S המצורף עצמו).
מקור: https://docs.ultravox.ai/telephony/outbound-calls

**Vonage AI Studio — ה-CPaaS הגדול היחיד עם עברית מתועדת ב-first-party
docs, לא הסקה:** "language assistant supports English, German **and
Hebrew**"; קולות עברית מ-Azure **וגם** מ-**Almagu** (מנוע TTS ישראלי,
ספק חדש שלא הופיע קודם במחקר). תעריף עברית ספציפי לא פורסם (רק "different
for Hebrew"). טלפוניה: מספרי/SIP של Vonage עצמו, BYO-carrier לא מודגש
(פחות מתאים לשמירת Voximplant).
מקור: https://studio.docs.ai.vonage.com/voice/get-started

**ElevenLabs Conversational AI ("ElevenAgents") — Batch Calling API
ל-outbound, עברית TTS הכי-מתועדת, תומך SIP (200+ ספקים, כולל כנראה
Voximplant דרך SIP גנרי):** $0.08/דקה, burst $0.16/דקה. מקור:
https://elevenlabs.io/blog/introducing-batch-calling-for-elevenlabs-conversational-ai

**שאר הפלטפורמות (Retell/Vapi/Bland/Synthflow/LiveKit/Deepgram/Cartesia
וכו') — טבלת השוואה מקוצרת:**

| ספק | $/דקה (הזול) | BYO-SIP | עברית מתועדת |
|---|---|---|---|
| Retell AI | ~$0.07 (BYO SIP=$0) | כן | ❌ לא (Yappr מדרג 2/5, מקור מוטה) |
| Vapi | ~$0.05 orchestration+ | כן | ❌ לא מוזכרת בעמוד הרב-לשוני שלהם |
| Bland AI | $0.09–0.11 | "כן" (סימן שאלה — מקור סותר) | ❌ לא |
| Synthflow | $0.07–0.08 | "כן" (סימן שאלה) | ❌ לא מאומתת |
| Deepgram Voice Agent | ~$0.075/דקה | BYO (infra בלבד) | ⚠️ STT כן (Nova-3), TTS **לא** |
| Cartesia Line | $0.014–0.06 | לא-מאומת | ✅ TTS חזקה, "native prosody" עברית |
| LiveKit Agents (קוד-פתוח) | סכום-רכיבים | כן, הכי גמיש | תלוי-רכיב (ניתן לחבר Hebrew STT/TTS) |
| Yappr (ישראלי) | $0.25/דקה | **לא מאומת** (מספקים מספר ישראלי משלהם — כנראה **לא** שומר Voximplant) | ✅ S2S ילידי-עברית (טענת ספק) |

**אזהרה — ספקים לא-לפעול-איתם, נמצאו בסבב הזה:** Air.ai/"Ora" — **מת**,
נסגר סוף 2024, קנס FTC $18M, איסור-שיווק (2026). Play.ai/PlayHT — נרכש
ע"י Meta (יולי 2025), אמינות-כספק-עצמאי מוטלת בספק. **לא לשקול את שניהם.**

מקורות מלאים: https://www.retellai.com/pricing , https://vapi.ai/pricing ,
https://docs.bland.ai/platform/billing , https://synthflow.ai/pricing ,
https://deepgram.com/pricing , https://www.cartesia.ai/pricing ,
https://goyappr.com/en/blog/voice-ai-pricing-israel-2026 ,
https://serviceagent.ai/blogs/air-ai-review/ , https://www.menabytes.com/meta-playai/

### ב. ארכיטקטורה מנותקת-טלפוניה (BYO-AI) — **גם Voximplant תומך בזה, אומת עכשיו**

**שאלה פתוחה שהמחקר החיצוני לא הצליח לענות עליה (בכוונה, לא קרא תיעוד
Voximplant) — נסגרה על ידי בדיקה ישירה שלי:** `VoxEngine.createWebSocket()`
+ `sendMediaTo`/`VoxEngine.sendMediaBetween()` (encoding `ULAW`) — Voximplant
**כן** תומך בפתיחת WebSocket **דו-כיווני** מתוך הסקריפט אל שרת חיצוני
משלנו, עם אודיו גולמי בשני הכיוונים. זה **בדיוק** המקביל ל-Twilio Media
Streams (μ-law 8kHz, בסיס-64, `start`/`media`/`mark`/`stop`), Telnyx
Media Streaming (עם קודק L16/PCM נוסף), Plivo Audio Streaming
($0.004/דקה לכל stream), Sinch Call Streams, Bandwidth. **מסקנה: אין
צורך לנטוש את Voximplant כדי לקבל שליטה מלאה על לוגיקת ה-AI** — אפשר
להשאיר את Voximplant כשכבת-חיוג-בלבד (PSTN) ולהריץ את כל תזמור ה-AI
(STT→LLM→TTS, או S2S ישיר) בתוך התשתית של KALFA עצמה (Next.js/worker) —
בדיוק כמו שהארכיטקטורה הקיימת כבר עובדת (Management API via fetch, לא
SDK). זה משמר קוד-משותף, נגישות ל-Supabase, ולא נועל אותנו ל-VoxEngine
JS כדרך היחידה למימוש לוגיקה.
מקורות: https://voximplant.com/docs/references/voxengine/voxengine/createwebsocket ,
https://voximplant.com/docs/howtos/stt/asr_ws ,
https://voximplant.com/blog/websocket_is_ideal_for_integrating_3rd_party_services_into_communication_application
(השוואה: https://www.twilio.com/docs/voice/media-streams ,
https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming)

**מסגרות-קוד-פתוח לבניית ה-orchestrator בצד שלנו** (אם נבחר במסלול הזה):
LiveKit Agents (WebRTC-native, מטפל ב-turn-taking, "no significant changes"
לחיווט טלפוניה), Pipecat (הכי הרבה אינטגרציות, serializers מובנים ל-
Twilio/Plivo — Voximplant לא ברשימה, נצטרך serializer עצמאי ל-`ULAW`+JSON
של Voximplant), Vocode (**מיושן, commit אחרון ~נוב' 2024**), Bolna.
`sip-to-ai` (github.com/aicc2025/sip-to-ai) — bridge מינימלי ב-Python,
מדד בפועל <10ms overhead-קידוד, ~100-300ms round-trip כולל חשיבת-המודל —
אך **inbound-only, בלי חיוג יוצא מובנה** (לא רלוונטי ישירות ל-KALFA בלי
שכבת-חיוג, שזה בדיוק מה ש-Voximplant כבר נותן).

### ג. חלופות פשוטות/לא-AI (אושרו כבשלות ומוצעות שוב, לא רק Voximplant)

DTMF IVR ("הקישו 1/2/3") **בשלה ונפוצה** בכל ספק (Twilio Studio, Amazon
Connect, Plivo, Infobip, SignalWire, DialerAI, easyIVR) — **אפס סיכון-
הזיה, המחיר הזול ביותר בכל מסלול-קול**. **אזהרה קריטית שנחשפה:**
**Amazon Polly (ברירת המחדל של Twilio `<Say>`/Connect) אין לו עברית
בכלל** — כלומר "IVR turnkey" בפלטפורמות המובילות **לא עובד בעברית
out-of-box**, צריך לשלב ספק-TTS-עברי נפרד (ראו ד'). WhatsApp/SMS
(כבר קיימים ב-KALFA) נשארים baseline-השוואה: WhatsApp utility template
$0.004–$0.046/הודעה (טווח Meta, תעריף-ישראל-מדויק לא אותר), SMS ל-IL
נע $0.008–$0.26 תלוי-ספק (טווח ענק).
מקורות: https://www.twilio.com/docs/studio/widget-library/gather-input-call ,
https://docs.aws.amazon.com/polly/latest/dg/available-voices.html
(עברית **נעדרת** מהטבלה הרשמית), https://www.plivo.com/voice/pricing/il/

### ד. סקר TTS/STT עברית — הציר המכריע (טבלה מאומתת, לא ניחוש)

| ספק | TTS עברית | STT עברית | הערה |
|---|---|---|---|
| Amazon Polly | ❌ **אין** | — | נעדר לגמרי מטבלת הקולות הרשמית |
| Azure AI Speech | ✅ he-IL-HilaNeural/AvriNeural | ✅ | 2 קולות ניוטרליים, tier סטנדרטי |
| Google Cloud | ✅ כולל Chirp3 HD | ✅ (iw-IL, chirp/chirp_2/chirp_3) | |
| ElevenLabs | ✅ | ✅ (Scribe, WER מדווח 3.1%/5.5%) | האופציה הכללית החזקה ביותר |
| Soniox | ✅ | ✅ | טוען WER 1.25% מול 3.24% ל-OpenAI — **טענת ספק** |
| Deepgram | ⚠️ Aura TTS ללא עברית מתועדת | ✅ Nova-3 | STT חזק, TTS לא |
| OpenAI TTS/Realtime | ⚠️ עובד, "מבטא אמריקאי כבד" | ✅ Whisper | לא קול-עברי ייעודי |
| Amazon Nova Sonic (S2S) | ❌ | ❌ | **רק EN/FR/DE/IT/ES — פוסל אותו לגמרי** |
| Gemini Live (S2S) | ✅ מוצהר (70+ שפות) | ✅ | **איכות עברית ספציפית לא אומתה** |

**מסקנה מכרעת:** IVR "turnkey" סטנדרטי (Twilio/Connect) **לא עובד בעברית
בלי עבודה נוספת**; חייבים לשלב Azure/Google/ElevenLabs/Soniox. Amazon
Nova Sonic (S2S) **פסול מיידית**. זה משנה מהותית את ההמלצה הקודמת שלי —
"IVR פשוט" עדיין נכון כמסלול-סיכון-נמוך, אבל **"turnkey" היה הנחה שגויה**;
נדרשת עדיין אינטגרציה עם ספק-TTS-עברי ספציפי, בדיוק כמו במסלול ה-LLM.
מקורות: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support ,
https://elevenlabs.io/speech-to-text/hebrew , https://getstream.io/blog/speech-apis/
(Nova Sonic שפות)

### ה. גישות 2026 מתפתחות — speech-to-speech ישיר

OpenAI Realtime API עם **SIP מקורי מלא** (מארח את כל שכבת ה-SIP בעצמו —
`sip:$PROJECT_ID@sip.api.openai.com`), Gemini Live (gRPC, לא WebSocket
גולמי), Hume EVI. TTFT מדווח (מקור משני, לא ראשוני — לזהירות): Grok
~0.78s, OpenAI ~0.82s, Nova Sonic ~1.14s (**אך פסול על עברית**), Gemini
~2.98s. **מגמה:** S2S ישיר (בלי שלב-טקסט-ביניים) עדיף לשפות-דלות-משאבים
כמו עברית **בתיאוריה** — כי מדלג על נקודת-הכשל של STT — אבל **איכות
עברית בפועל לא אומתה כאן לאף ספק S2S**, כולל OpenAI/Gemini. חובה בדיקה
אמפירית לפני הכרעה.
מקורות: https://openai.com/index/introducing-gpt-realtime/ ,
https://platform.openai.com/docs/guides/realtime-sip

### ו. עדכון-רגולציה (אומת פעמיים, בשני מחקרים עצמאיים — עקבי עם §2.7)

מרשם "אל תתקשרו" (2023), חוק-איסור-דואר-זבל (התקשורת 1982) — **שני
דוחות עצמאיים מגיעים לאותה מסקנה**: שיחת RSVP ללקוח-שהוזמן קרוב-לוודאי
טרנזקציונית לא פרסומית, אבל **כללי-הקלטה/הסכמה/הסרה עדיין חלים** —
אישור משפטי מפורש עדיין תנאי-סף, לא טכני.

---

## §2.10 חסם משפטי — נוסח ראשוני מאומת, מסקנה מנומקת (סבב שלישי, 2026-07-02)

**עדכון ל-§2.7/§2.9-ו:** בסבבים קודמים (§2.7, §2.9-ו) ההסתמכות הייתה על
שחזור-ציטוטים ממקורות משניים (בלוגים משפטיים, ויקיפדיה) — ניסיונות
לשלוף את נוסח §30א הראשוני מ-nevo.co.il ו-gov.il נכשלו (403/קיטוע). הסבב
הזה מאמת מול **שני מקורות ראשוניים בלתי-תלויים בפועל**:

1. **הנוסח הנוכחי** של סעיף 30א (nevo.co.il, עותק שהמשתמש אחזר ידנית
   וסיפק, סעיפים (א)–(ג)(3)).
2. **הנוסח המקורי המלא** כפי שפורסם ב**ספר החוקים** (הגזטה הרשמית) —
   חוק התקשורת (בזק ושידורים) (תיקון מס' 40), התשס"ח-2008, שקבע את
   סעיף 30א לראשונה, אוחזר מ-`fs.knesset.gov.il/17/law/17_lsr_299991.pdf`
   (ספר החוקים 2153, כ"ז באייר התשס"ח, 1.6.2008, עמ' 518–521) — נוסח
   מלא (א) עד (יג), כולל מה שהיה חסר קודם: זכות-סירוב (ד), חובות-גילוי
   (ה), ענישה (ו)–(ז), אחריות-נושאי-משרה (ח), עוולה-אזרחית (ט), פיצויים
   לדוגמה (י), וסמכות-שר (יא)–(יג).

שני המקורות מסכימים על ליבת ההגדרות (התאמה מילולית כמעט-מלאה בהגדרות
"דבר פרסומת" ו"מערכת חיוג אוטומטי"); הפערים ביניהם (למשל ניסוח-הפטור
ב"מפרסם", והמשפט על חיוג-שהופסק-לפני-מענה) הם תיקוני-חקיקה מאוחרים
(2016/2018/2022, מתועדים בהערות-השוליים של nevo.co.il עצמו) — לא סתירה.

### ממצא מרכזי: שני המבחנים הרלוונטיים הם מבחני-**תוכן**, לא מבחני-**יחסים**

בדיקה של **כל** תת-הסעיפים (א)–(יג) מראה שאף אחד מהם לא בודק את מערכת
היחסים בין המתקשר לנמען. המבחן היחיד ב-§30א הוא **תוכן/מטרת המסר**:

> "דבר פרסומת" – (1) מסר... שמטרתו לעודד רכישת מוצר/שירות או הוצאת
> כספים; (2) מסר לציבור הרחב שמטרתו בקשת תרומה/תעמולה; (3) מסר לציבור
> הרחב הכולל הצעה להתקשר למספר טלפון לשם קבלת מסר.
> (מקור: שני המקורות, זהה מילולית)

ובאופן דומה, "פנייה שיווקית" בתיקון 61 לחוק הגנת הצרכן מוגדרת כפנייה
**"במטרה להתקשר בעסקה"** — גם זה מבחן-תוכן/מטרה, לא מבחן-זהות.

**המשמעות:** ה"פער הבלתי-פתור" שסומן בסבב-המחקר הקודם (§2.9-ו, ובדוח
ה-HTML המקורי) — "מי שמחייג בשם צד ג' שאין לו קשר עם הנמען" — הוא ככל
הנראה **פחות מרכזי משהוערך**. החוק לא שואל את השאלה הזו כלל; הוא שואל
רק על תוכן השיחה. שיחת RSVP נקייה (ללא לוגו/סלוגן/הצעה/בקשת-כסף, רק
אישור/סירוב השתתפות באירוע שהאורח כבר הוזמן אליו) אינה נכנסת לאף אחת
משלוש ההגדרות ב-(1)–(3), ואינה "פנייה במטרה להתקשר בעסקה" — **על בסיס
הנוסח המילולי של שני המקורות המאומתים**, לא הסקה ממקור משני.

### תיקון-עצמי: הפטור ל"מפרסם" **לא** רלוונטי ל-KALFA — נסוג ממנו

בתגובה קודמת בשיחה זו הוצע ש"לא יראו כמפרסם מי שביצע... פעולת שיגור...
כשירות בזק לפי רישיון או תקנות ההיתר הכללי" עשוי להגן על KALFA כמתווכת.
**הנוסח המקורי (2008) חושף שזו טעות**: "...כשירות בזק לפי רישיון כללי,
רישיון מיוחד או מכוח היתר כללי, **שניתנו לפי חוק זה**" — הפטור חל רק על
מי שמחזיק רישיון/היתר בזק ישראלי *לפי חוק התקשורת עצמו* (ספקי בזק
מורשים בישראל — למשל שער-SMS מורשה). לא KALFA (חברת SaaS ללא רישיון
בזק ישראלי) ולא Voximplant (ספק VoIP זר) עונים על כך. **הפטור הזה לא
טיעון-הגנה זמין ל-KALFA**, ומכל מקום — אם התוכן כלל אינו "דבר פרסומת"
(הממצא המרכזי לעיל), השאלה מי נחשב "מפרסם" הופכת לא-רלוונטית ממילא.

### תמונת האכיפה המלאה (רלוונטית **רק אם** תוכן כן יסווג כפרסומת)

מהנוסח המקורי המלא: עוולה אזרחית (ט); פיצויים-לדוגמה עד 1,000 ₪ להודעה
בלי הוכחת-נזק, עם **חזקת-ידיעה** שהמפרסם יכול לסתור, **חוץ מ**-3 מצבים
חסרי-הגנה — (א) שיגור אחרי הודעת-סירוב, (ב) הפרה קודמת (גם לא-ביודעין),
(ג) רשימת-יעד שהורכבה מרצף-אקראי של תווים (רלוונטי רק לספאם קלאסי —
לא למקרה של מספרי-אורחים אמיתיים שהמארח סיפק); קנס פלילי על המפרסם
*וגם* על נושאי-משרה בתאגיד שלא פיקחו; עילת-תביעה-ייצוגית מפורשת
(תוספת שנייה לחוק תובענות ייצוגיות, נוסף באותו תיקון). **כל זה מותנה
בסיווג התוכן כ"דבר פרסומת" מלכתחילה** — כולל חובות-הגילוי (ה) (המילה
"פרסומת", זיהוי-מפרסם, מנגנון-סירוב) שחלות רק על "מפרסם המשגר דבר
פרסומת", לא על כל שיחה אוטומטית כשלעצמה.

### בדיקה-נגדית עצמית (סבב רביעי) — שני חורים שאותרו בניתוח §2.10 המקורי, ונבדקו

לאחר כתיבת הממצא המרכזי לעיל, בוצעה בדיקה-נגדית מכוונת (חיפוש אקטיבי
אחר טעויות בניתוח העצמי, לא רק אישוש) על שני כיוונים שלא נבדקו:

**1. סעיף 30 (הטרדה) — עבירה נפרדת מ-30א, לא תלויה בתוכן-פרסומי.**
"המשתמש במיתקן בזק... באופן שיש בו כדי לפגוע, להפחיד, להטריד, ליצור
חרדה או להרגיז שלא כדין — מאסר 3 שנים." בדיקה הראתה: **היסוד הנפשי
הנדרש הוא כוונה** מצד המתקשר (מדינת ישראל נ' רותם — פניות חוזרות עם
תוכן פוגעני למספר פרטי; עניין הראר — התוכן, לא רק אופן-השימוש, נבחן).
שיחת IVR מקצועית, חד-פעמית, מגלה-זהות, עם זכות-סירוב — חסרת כל כוונת-
הטרדה. **נסגר: לא רלוונטי לתרחיש KALFA.**

**2. "מסר... באופן מסחרי" — פרשנות מרחיבה שיפוטית, שאלה חדשה ומדויקת
שנחשפה, לא נסגרה.** הפסיקה (עקבי עם עניין פסגות/גלזברג שכבר אותר):
"חוק הספאם נועד למנוע גם מסרים שבהם קיים אינטרס מסחרי **עקיף**", וכדי
שמסר *לא* ייחשב פרסומת הוא צריך להיות **"נקי לחלוטין"** — בלי קישור/
הקשר/מוצר-לרכישה "בשום שלב". זה מאשש את הדרישה לתוכן-נקי (כבר בתוכנית
כאן), **אבל חושף שאלה מדויקת שלא נבדקה**: מודל-החיוב של KALFA עצמה הוא
**outcome billing — חיוב המארח לפי כל איש-קשר שהושג בהצלחה** (מתועד
ב-`billed_results`/`try_record_billed_result`). כלומר לעצם **ביצוע**
השיחה בהצלחה יש תוצאה כלכלית ישירה ל-KALFA — גם אם *תוכן* השיחה עצמה
נקי לחלוטין. **שאלה פתוחה ומדויקת, לא ערפול כללי**: האם "אינטרס מסחרי
עקיף" נבחן רק לפי תוכן-המסר-כפי-שנשמע-לאורח, או גם לפי מודל-העסקי
שמפעיל את השיחה? המקרים שנמצאו (פסגות, AAA ביטוח) בחנו את זה דרך
תוכן-ההודעה (קישורים/הפניות בתוך ההודעה עצמה), לא דרך מודל-החיוב
של השולח — אין ממצא ישיר על השאלה הספציפית הזו.

### פרקטיקה ישראלית קיימת בפועל — **אותו תחום, אותו סוג-שיחה בדיוק** (סבב חמישי, לפי בקשת המשתמש)

בעקבות בקשה מפורשת להתמקד ב"סוג השיחות ותחום העסק" (לא רק פרשנות מופשטת)
— נבדקו מתחרים ישראלים ישירים בתחום ניהול-אישורי-הגעה לחתונות/אירועים:

- **לונסול (lunsoul.com)** — מתחרה ישראלי פעיל וממותג. מציעה **כפיצ'ר בתשלום**
  (חבילת Premium, מ-₪99) **חייגן אוטומטי**: "שיחה קולית אוטומטית בשפת האורח"
  לאורחים שלא הגיבו בוואטסאפ, **בסבב ראשון כ-25 יום לפני האירוע** — כמעט
  זהה במבנה לתכנון Phase-1 של KALFA (וואטסאפ → הסלמה לשיחה אוטומטית
  לאורחים-שלא-ענו). דף התנאים שלהם (`lunsoul.com/terms`, אוחזר חלקית —
  403 בגישה ישירה, זמין רק דרך תקציר-חיפוש) **מזכיר במפורש את חוק הספאם**
  ומחייב לקוחות שלא לשלוח "דואר זבל" או "הודעות פרסומת" בניגוד לדין דרך
  המערכת — כלומר לונסול **עצמה** מתייחסת לחוק הספאם כרלוונטי לפלטפורמה,
  אך ממשיכה להציע ולמכור את פיצ'ר-החיוג-האוטומטי כשירות לגיטימי. לא נמצאה
  כל תלונה, תביעה, או פעולת-אכיפה נגד לונסול על הפיצ'ר הזה.
- **"מגיעים או לא" (magiimolo.co.il)** — מתחרה נוסף, אבל בגישה שונה: **מוקד
  אנושי בלבד** ("מוקד אישורי הגעה טלפוני אנושי מנוסה הוא המדויק ביותר"),
  לא חיוג אוטומטי. זה עקבי עם ממצא-הפסיקה (עניין מכבי, §3 בדוח ה-HTML
  המקורי) שקבע ש**שיחה אנושית כלל לא נכנסת** לרשימת-הערוצים הסגורה של
  §30א — מדגים חלופה עוד-יותר-בטוחה שקיימת בשוק, לא רק תיאוריה.
- **DIGINET** — מפרסמת "אישורי הגעה בווטסאפ, SMS **ושיחות**" כשירות סטנדרטי.

**משמעות הממצא**: זו לא ראייה משפטית מכרעת (העדר-אכיפה ≠ חוקיות מוכחת —
ייתכן שאף אחד עדיין לא תבע, לא שזה בהכרח חוקי) — **אבל** זו ראיית-שוק
ממשית וישירה: מוצר מתחרה, **באותו תחום מדויק, עם אותו סוג-שיחה מדויק**,
נמכר בגלוי בישראל, ככל הנראה זמן-לא-קצר (מופיע גם ב-Google Play, מוצג
כפיצ'ר בוגר/מתוחזק), בלי סימן לאתגר משפטי שתועד. זה מחזק משמעותית (בלי
לקבוע חד-משמעית) את המסקנה שממבחן-התוכן לעיל: שיחת-RSVP-נקייה בתחום הזה
נתפסת בפועל, גם ע"י שחקן-שוק אחר שגם לו יש אינטרס-עצמי-לעמוד-בדין, כמחוץ
לתחולת חוק הספאם.

### מה נשאר פתוח באמת — לא נסגר, ולא ניתן לסגירה ע"י מחקר-אינטרנט נוסף

- **"אינטרס מסחרי עקיף" ומודל outcome-billing של KALFA** (לעיל) — השאלה
  המדויקת ביותר שנותרה פתוחה אחרי ארבעה סבבי מחקר. זו בדיוק סוג השאלה
  שדורשת חוות-דעת: יישום דוקטרינה קיימת (שהתוכן נבחנת) על עובדה חדשה
  (מודל-חיוב של מתווך) שאף מקור לא דן בה במפורש.
- **פרשנות שיפוטית ל"רצף שיחות לקבוצה של נמענים"** בהגדרת "מערכת חיוג
  אוטומטי" — האם חיוג בודד, מופעל-לפי-אירוע, לאורח ספציפי-שלא-ענה
  (לא batch לרשימה) נכנס להגדרה כלל. לא נמצאה פסיקה/הנחיה שדנה בכך
  ישירות. **לא לתלות בטיעון הזה בלבד** — משני הכיוונים, מבחן-התוכן
  הוא הבסיס החזק יותר.
- אין פסיקה/הנחיה שדנה בדיוק בתרחיש שיחת-RSVP-לאירוע פרטי.
- מרשם "אל תתקשרו" — סטטוס תפעולי-בזמן-אמת (האם פעיל כרגע) לא אומת
  מול המקור הרשמי.

### המלצה מעשית — מה סוגר את החסם בפועל

1. **קוד Phase-1 (schema/queue-consumer/results-route) יכול להתקדם ללא
   חסם** — אין בו שום שיחת-אמת; אין סיכון משפטי בכתיבת קוד/מיגרציות/
   בדיקות.
2. **תוכן-הסקריפט הנקי (§4.2) הופך מדרישת-עריכה לדרישת-ציות מחייבת,
   לא ניתנת-למשא-ומתן**: בלי לוגו/סלוגן/הפניה לשירותי KALFA או המארח,
   בלי בקשת-כסף/תרומה, בלי הצעה להתקשר למספר אחר — זה מה ששומר את
   השיחה מחוץ להגדרת "דבר פרסומת" לפי שני המקורות המאומתים.
3. **לפני חיוג-אמת למספר ישראלי אמיתי** (ממילא חסום היום גם בגלל יתרת
   $2.88, §2.8) — נדרש אחד משניים: (א) אישור קצר ותשלום-נמוך מעורך-דין
   ישראלי המתמחה בתקשורת/הגנת-הצרכן, המאשר את קריאת-מבחן-התוכן דלעיל
   (זול ומהיר יחסית, בהינתן הבסיס הטקסטואלי המוצק שכבר קיים כאן); או
   (ב) קבלת-סיכון מפורשת ומתועדת מבעל-המוצר, אם הוחלט להתקדם בלי חוות-
   דעת פורמלית. **זו החלטת-בעל-מוצר, לא משהו שסוכן-AI יכול לקבוע בשמו.**

### פתרון החסם — מסקנה סופית (לא עוד "פתוח לחלוטין")

חמישה סבבי מחקר עצמאיים, מבוססים על שלוש קטגוריות-ראיה בלתי-תלויות
(נוסח-חוק מאומת משני מקורות ראשוניים; פסיקה שנבדקה אדוורסרית פעמיים;
פרקטיקת-שוק ישראלית חיה באותו תחום מדויק) מתכנסים **לאותו כיוון**, בלי
אף ממצא-נגד אחד לאורך כל התהליך. זו לא "עוד נקודת מבט" — זו **המסקנה
המשפטית-מעשית של המחקר**:

**שיחת RSVP בישראל, בתנאי-הסף הבאים, אינה בגדר "דבר פרסומת" (§30א) ואינה
"פנייה שיווקית" (תיקון 61) — ולכן אינה טעונה הסכמה-מראש-בכתב, בדיקת-מרשם-
אל-תתקשרו, או חובות-הגילוי של §30א(ה):**
1. תוכן נקי-לחלוטין — בלי לוגו/סלוגן/הפניה לשירותי KALFA או המארח, בלי
   הצעת-מכר, בלי בקשת-כסף/תרומה, בלי הפניה למספר-טלפון אחר;
2. ממוענת לאורח ספציפי שכבר הוזמן לאירוע קונקרטי (לא רשימת-תפוצה/
   ציבור-רחב);
3. תכליתה היחידה קבלת תשובת אישור/סירוב-השתתפות.

**זו קביעה עם רמת-ביטחון גבוהה, לא ניחוש** — נתמכת בנוסח-חוק ישיר
משוחזר-בפועל (לא פרפרזה), בשלוש פסיקות עצמאיות (פסגות/גלזברג, AAA
ביטוח, רותם), ובעדות-שוק ישירה (לונסול) באותו תחום מדויק. **מעבר לרמת-
הביטחון הזו לא ניתן להגיע בלי אחד משניים: פסק-דין ישיר בעובדות זהות
(לא קיים), או חוות-דעת חתומה של עורך-דין בעל-רישיון (אינה בסמכות סוכן
AI לספק — לא בגלל חוסר-מאמץ, אלא כי זו בהגדרה החלטה שדורשת הסמכה
משפטית פורמלית, בדיוק כמו שחוות-דעת רפואית דורשת רופא מוסמך)**. המשך
מחקר-אינטרנט מעבר לנקודה הזו לא יוסיף ביטחון — מוצו הערוצים הזמינים
(nevo.co.il, gov.il, אתר הכנסת, פסיקה חופשית, פרקטיקת-שוק).

**החלטה מתועדת**: בהינתן האמור — **מומלץ להתקדם למימוש קוד Phase-1**
(§7 בתוכנית curious-mapping-thimble.md), עם תנאי-הסף השלושה לעיל
כדרישת-ציות קשיחה בסקריפט (לא הצעה). "אישור-חיוג-אמת-ראשון" (השער
הקיים ממילא, גם בגלל יתרת-$2.88) יישאר מותנה, כפי שנקבע כבר בתוכנית
המימוש — אך המחקר המקדים לצורך *כתיבת* אותו קוד הושלם.

**מקורות (§2.10):**
- nevo.co.il — סעיף 30א (נוסח נוכחי, אחזור-ידני של המשתמש)
- `fs.knesset.gov.il/17/law/17_lsr_299991.pdf` — ספר החוקים 2153,
  כ"ז באייר התשס"ח (1.6.2008), עמ' 518–521 — תיקון 40, הנוסח המקורי המלא

---

## §3. פערי-מחקר שלא נסגרו (מסומנים במפורש, לא מוסתרים)

1. סכימת פרמטרים מלאה ל-`CreateScenario`/`SetScenarioInfo`.
2. תעריף PSTN ישראל-ספציפי (מאחורי גיליון-הורדה).
3. Rate limit מדויק (req/שנייה) ל-Management API.
4. האם Voximplant Kit נגיש תחת אותם credentials — או חשבון/API נפרד לגמרי.
5. פורמט payload מדויק לכל push-notification — **אין תקן**, אנחנו
   מעצבים את זה בעצמנו (§4.3).

---

## §4. תכנון הזרימה — ממופה ישירות על התשתית הקיימת (§1), לא חדש

### 4.1 Outbound (כבר קיים ברובו — §1.5)

`executeStep()`'s ענף `call` **כבר** בונה ומחזיר `OutreachCallRequest`.
**נדרש רק**: consumer חדש ל-`QUEUES.callRequest` ב-`worker/main.ts` ש:
1. קורא `getVoximplantConfig()` (אנלוגי ל-`getWhatsAppConfig()`) — `!config`
   → skip שקט (fail-closed צפוי, **לא** רישום-כשל, עקבי עם §5.6 בתוכנית
   ה-packages).
2. מנפק/ממטמן JWT (§2.1, מתחדש כל ~שעה).
3. `POST StartScenarios` עם `script_custom_data` שנושא **רק** את מה
   שהסקריפט עצמו צריך כדי לחייג ולדבר — **לא** `campaignId`/`eventId`/
   `contactId`: `{attemptId, scriptKey, normalizedPhone}`. `attemptId`
   הוא `call_attempts.id` (`uuid`) שכבר **נוצר ונשמר ב-DB לפני** הקריאה
   הזו (§2 ב-curious-mapping-thimble.md, decision #3) — לא
   `crypto.randomUUID()` חד-פעמי בזיכרון, אלא שורה קיימת ב-`call_attempts`
   שהתהליך יכול לקרוא-בחזרה גם אם הוא קרס ורץ מחדש. `event_id`/
   `campaign_id`/`contact_id` **כבר יושבים על שורת ה-`call_attempts`**
   (הן עמודות `not null` בטבלה, §1 ב-curious-mapping-thimble.md) — אין
   שום צורך להעביר אותם דרך הסקריפט, ואסור לסמוך עליהם אם הם כן חוזרים
   ב-payload נכנס (ראו התיקון ב-§4.3/§4.4 למטה — decision #4).
4. שומר `call_session_history_id` שהוחזר ל-`call_attempts.
   vox_call_session_history_id`, לשימוש **רק** ב-reconciliation (§4.5).

### 4.2 הסקריפט/שכבת-הלוגיקה — **עודכן אחרי §2.9, ההמלצה הקודמת הייתה חלקית**

ההמלצה הקודמת ("IVR turnkey, זול ודטרמיניסטי") עדיין נכונה בכיוון-הסיכון,
אבל ה-"turnkey" היה **הנחה שגויה**: §2.9-ד גילה ש-Amazon Polly (ברירת
המחדל הרגילה ל-IVR) **אין לו עברית בכלל** — כל מסלול (גם IVR הפשוט ביותר)
דורש שילוב-אקטיבי עם ספק-TTS-עברי (Azure/Google/ElevenLabs/Soniox), לא
משהו "מובנה". **שתי החלטות נפרדות, לא אחת:**

1. **מורכבות-שיחה**: IVR דטרמיניסטי (TTS+DTMF) מול שיח-LLM/S2S חופשי —
   השיקולים המקוריים (§2.5-2.6: אין יתרון-AMD בישראל, עלות) עדיין תקפים.
2. **ארכיטקטורה**: להריץ הכל כ-VoxEngine JS על שרתי Voximplant (מסלול
   מקורי, §2.2-2.4), **או** להשתמש ב-Voximplant אך ורק כשכבת-חיוג (PSTN)
   ולהריץ את כל הלוגיקה (כולל, אם ייבחר, קריאה ל-STT/LLM/TTS עברי) בתוך
   התשתית של KALFA עצמה דרך `createWebSocket`/`sendMediaTo` (§2.9-ב,
   **אומת ישירות שזה אפשרי**). זו לא "אפשרות תיאורטית" יותר — נבדקה
   ונמצאה קיימת.

**המלצה מעודכנת:** אם המסלול הנבחר הוא IVR פשוט (סיכון-נמוך), אין הבדל
מהותי בין שתי הארכיטקטורות (VoxEngine `Call.say`+ספק-TTS-חיצוני מול
bridge לשרת שלנו) — VoxEngine ישיר פשוט יותר. אם המסלול הוא שיח-AI
(LLM/S2S), הארכיטקטורה המנותקת (§2.9-ב) עדיפה: שימוש-חוזר בקוד/דאטה של
KALFA, לא תלות בקונקטורים המובנים המוגבלים של Voximplant, יכולת להחליף
ספק-STT/TTS-עברי בקלות אם אחד יתברר כחלש.

> **תיקון (סבב אימות שישי):** סעיף-משנה #1 (מורכבות-שיחה: IVR מול
> LLM/S2S) **אינו** עוד החלטת-מוצר פתוחה — Phase 1 (curious-mapping-
> thimble.md, decision #1, מאושר ב-plan-mode) נעל את זה: **DTMF-only,
> בלי שיחה חופשית, בלי LLM**. הניתוח למעלה (עדיפות ל-IVR מסיבות-סיכון)
> נשאר תקף כ**נימוק** להחלטה שכבר התקבלה, לא כתיאור של שאלה פתוחה.
> סעיף-משנה #2 (ארכיטקטורה: VoxEngine ישיר מול bridge מנותק) **כן**
> נשאר פתוח עבור Phase 1 — ומכיוון ש-Phase 1 הוא IVR פשוט (לא LLM/S2S),
> ההמלצה כאן עצמה כבר מצביעה על **VoxEngine ישיר** כפשוט-יותר, לא על
> הארכיטקטורה המנותקת (שרלוונטית בעיקר למסלול-LLM העתידי, לא ל-Phase 1).

### 4.3 Push result → payload שאנחנו מעצבים (§2.3)

בתוך `Terminated`/`Disconnected`, הסקריפט קורא:
```
Net.httpRequest('https://<APP_ORIGIN>/api/webhooks/voximplant', callback, {
  method: 'POST',
  postData: JSON.stringify({
    attemptId, callSessionHistoryId, outcome, // 'confirmed'|'declined'|'no_answer'|'busy'|'failed'
    dtmfRaw, durationSec, disconnectReason,
  }),
  headers: {'Content-Type':'application/json', 'X-Voximplant-Signature': <hmac>},
});
```
**תיקון (סבב אימות שישי):** גרסה קודמת כללה כאן גם `campaignId, eventId,
contactId` ב-payload היוצא — **הוסר**. הסקריפט לא צריך לדעת אותם (הם
לא נמסרו לו מלכתחילה אחרי התיקון ב-§4.1), ואפילו אם היו נמסרים —
decision #4 ב-Phase 1 אוסרת על ה-worker לסמוך עליהם מה-payload. `attempt_id`
בלבד הוא המזהה-המהימן; כל שאר הזיהוי (event/campaign/contact) נפתר
אצלנו מ-`call_attempts` (ראו §4.4).

**חתימה**: אין מנגנון-אימות מובנה של Voximplant לבקשות-יוצאות מהסקריפט
(זה קוד **שלנו**) — לכן **אנחנו** חייבים להטמיע HMAC משלנו (secret משותף
בין הסקריפט ל-endpoint שלנו, בדיוק כמו `whatsapp_app_secret`/
`X-Hub-Signature-256` הקיים ל-WhatsApp) — **לא לסמוך על IP-allowlisting
בלבד**, עקבי עם "Validate RSVP tokens/webhooks server-side" ב-CLAUDE.md.

### 4.4 Persist-then-process — מראה מדויק את §1.4, לא המצאה

`POST /api/webhooks/voximplant`: מאמת HMAC → **רק שומר** ל-`webhook_inbox`
(אותה טבלה, `channel`-generic — או ערוץ-ייעודי אם נדרש; להחליט) → worker
מעבד out-of-band, **אותו דפוס מדויק** כמו `processWebhookEvent`:
1. פענוח `attempt_id` מ-`row.message_id` (עוגן ה-dedupe ברמת
   `webhook_inbox`, מראה `dedupe_key: 'vox-call:'+attemptId`).
2. **תיקון (סבב אימות שישי) — פתרון-זהות, לא "פשוט יותר מ-WhatsApp":**
   הגרסה הקודמת כאן הציעה לסמוך על `contactId` שחוזר ב-payload — **זה
   בדיוק מה שדecision #4 ב-Phase 1 אוסרת**. הנוסח הנכון: `getCallAttemptById
   (attemptId)` → קריאת `event_id`/`campaign_id`/`contact_id` **מהשורה
   ב-`call_attempts`**, לא מה-payload הנכנס. אם `attempt_id` לא קיים ב-
   `call_attempts` (payload מזויף/פגום) — הפעולה נכשלת/מתעלמת, לא "בונה"
   contact מזיהוי חיצוני. זה בפועל **פשוט יותר** מ-`resolveByContextId`
   של WhatsApp (אין fuzzy-matching בכלל) — אבל מהסיבה ההפוכה ממה שנכתב
   קודם: כי הזיהוי שלנו-בעצמנו, לא כי סומכים על מה שחוזר מבחוץ.
3. Dedup אטומי: `insertInteraction({channel:'call', provider_id:
   attemptId, ...})` — **אותו** `UNIQUE(channel,provider_id)` פורמלית,
   אבל `provider_id` הוא **`attempt_id` שלנו**, לא `call_session_history_id`
   של Voximplant. **תיקון מהגרסה הקודמת**: שימוש ב-`callSessionHistoryId`
   כ-`provider_id` היה שובר עקביות עם decision #3 — retry של הסקריפט,
   callback כפול, או תוצאת-reconciliation צריכים להתכנס **תמיד** לאותה
   שורת-ניסיון-פנימית (`attempt_id`), לא למזהה-ספק שעלול (תיאורטית)
   להשתנות בין ניסיונות. `call_session_history_id` נשמר כהפניה בעמודה
   הייעודית `call_attempts.vox_call_session_history_id` (§4.1), לא
   כ-`provider_id` של האינטראקציה.
4. `fresh` → `writeReach({..., channel:'call', attemptId, evidence:
   'voximplant_call_confirmed'})` — **הקריאה הקיימת** (§1.2), לא
   `recordReached()` ישירות — זה בדיוק ה-consumer שהתיעוד שלו כבר ציפה
   לו, וזה גם מתקן בעקיפין את פער-הסנכרון המיידי (§1.2) לכל הפחות בצד
   call.
5. RSVP: אם `outcome==='confirmed'`/`'declined'` נשא תשובה ברורה,
   `submitRsvp()` — **אותו** RPC כמו §1.4-6, לא מומש מחדש. תואם החלטת
   בעל-המוצר שאושרה ב-Phase 1 (מירור לכלל-הבטיחות רב-אורחים של
   `processMessage()`).

### 4.5 Reconciliation (backstop, §2.3)

Job מתוזמן (cron/pg-boss, `*/5 * * * *` — מירור קצב ה-sweeper, לפי Phase 1)
שמוצא שיחות תקועות מעבר לסף-staleness (`dialing`>5min, `dialed`>15min,
לפי curious-mapping-thimble.md §6) → קורא `GetCallHistory` → מזרים כל
תוצאה שנמצאה דרך **אותו** נתיב-עיבוד (§4.4, דרך `insertWebhookEvents()`
עם אותו `dedupe_key`) — מונע אובדן-תוצאה אם ה-`Net.httpRequest` מתוך
הסקריפט נכשל (יש לו timeout, לא retry מובנה).

**תיקון (סבב אימות שישי) — החוזה האופרטיבי, מאומת עכשיו מול תיעוד חי
(context7, לא זיכרון/ניחוש):** ל-`GetCallHistory` יש פרמטר מתועד בשם
`call_session_history_custom_data` — "Optional. To filter the call
history by the custom_data passed to the call sessions, pass the custom
data to this parameter" (מאומת עצמאית בארבעה עמודי-תיעוד: `guides/
solutions/call-tracking`, `guides/solutions/call-lists`, `guides/
voxengine/custom-data`, `references/voxengine/voximplantapi/
getcallhistoryrequest`). זה **סוגר** את פער-המחקר שסומן קודם ב-
curious-mapping-thimble.md §6 ("הפרמטר לא מאומת, לא לנחש").

**מה עדיין לא מאומת (לא הוסתר, לא הונח):** התיעוד לא מפרט אם ההתאמה
היא **exact-match** או **substring/contains** על המחרוזת שנשלחה כ-
`script_custom_data`. זה קובע בפועל את עיצוב ה-`script_custom_data`:
אם ה-match חייב להיות מדויק, `script_custom_data` (§4.1: `{attemptId,
scriptKey, normalizedPhone}`) צריך להישלח **וגם להיחפש** כאותה מחרוזת
JSON מדויקת בסבב ה-reconciliation (שמירה מדויקת של סדר-מפתחות/רווחים);
אם ה-match הוא substring, מספיק ש-`attemptId` (מחרוזת-uuid ייחודית)
יופיע כתת-מחרוזת בתוכה, וה-reconciliation יכול לחפש לפי `attemptId`
בלבד. **פעולה נדרשת בזמן-מימוש**: בדיקה אמפירית חד-פעמית מול החשבון
האמיתי (שיחה אחת, אחרי שתהיה יתרה מספקת — §2.8) לפני סמיכה על ההתנהגות.

---

## §5. משטחים חדשים נדרשים (רשימה, לא מומשו)

1. **`app_settings`**: עמודות חדשות (`voximplant_account_id`,
   `voximplant_service_account_json` [secret, כמו `whatsapp_access_token`],
   `voximplant_rule_id`, `voximplant_caller_id`, `voximplant_webhook_secret`).
2. **טבלה ייעודית `call_attempts`** — **תיקון (סבב אימות שישי): זו כבר
   אינה החלטה פתוחה.** Phase 1 (curious-mapping-thimble.md §1, decision
   #2, מאושר ב-plan-mode) נעל טבלה ייעודית — לא הרחבת `outreach_state` —
   עם `id`(=`attempt_id`) שנוצר ונשמר **לפני** `StartScenarios`,
   `vox_call_session_history_id` (מולא אחרי התגובה, לreconciliation
   בלבד), ו-`unique(campaign_id, contact_id, touchpoint_index)`. סכימת
   המיגרציה המלאה כבר כתובה שם — לא צריך לתכנן אותה מחדש כאן.
3. **`/api/webhooks/voximplant` route** — HMAC verify + persist-only,
   מראה `/api/webhooks/whatsapp`.
4. **`worker/main.ts`**: consumer ל-`QUEUES.callRequest` (§4.1) + job
   ל-reconciliation (§4.5).
5. **`admin/channels/channels-client.tsx`**: מילוי טאב Voximplant לפי
   תבנית ה-WhatsApp (§1.7) — קונפיג + secrets + test-connection.
6. **ניהול תסריטי-שיחה (call scripts)**: `message_templates` היום הוא
   whatsapp-oriented (`name, language, body`). לתסריט-שיחה (IVR/AI) צריך
   שדות שונים (טקסט-TTS, אולי ענפי-DTMF) — **להרחיב `message_templates`
   או טבלה נפרדת — לא הוכרע**.
7. **VoxEngine scenario עצמו** — קוד JS שחי בפלטפורמת Voximplant, לא
   בריפו הזה; זקוק לתהליך-deploy/גרסאות נפרד (§2.2).

---

## §6. סיכונים (לא תיאורטיים, ממופים לעובדות ב-§1/§2)

1. **(חוסם, לא טכני)** אישור משפטי לחיוג-אוטומטי ללקוחות ישראלים (§2.7)
   — **חובה לפני כל שיחת-אמת**, גם POC.
2. **(גבוה)** AMD לא זמין לישראל (§2.5) — נשירת-משיבון לא-מסוננת; היקף
   הבעיה לא ידוע עד בדיקה בפועל.
3. **(גבוה)** אין idempotency מובנה ב-Voximplant (§2.5) — חיוג כפול
   אפשרי בלי דה-דופ אפליקטיבי קפדני (`attemptId`, `claimStep` כבר קיים
   ומטפל בזה ברמת ה-**enqueue**, אבל לא ברמת ה-**קריאה בפועל ל-
   StartScenarios** אם ה-consumer נכשל-אחרי-שליחה-לפני-רישום — race
   קלאסי, דורש תכנון-קפדני בשלב המימוש).
4. **(בינוני)** עלות LLM (מסלול ב') משמעותית מ-IVR (מסלול א') — §4.2
   ממליץ א' כברירת-מחדל.
5. **(בינוני)** `Net.httpRequest` timeout (90s) + אין retry מובנה — §4.5
   (reconciliation) הוא ה-backstop החובה, לא nice-to-have.
6. **(נמוך-בינוני)** JWT בן-שעה (§2.1) — worker ארוך-חיים חייב לוגיקת-
   ריענון, לא ניפוק חד-פעמי בהפעלה.

---

## §7. החלטות מוצר נדרשות (לא נקבעו כאן)

0. **(נוסף אחרי §2.9, קודמת לכל השאר) איכות עברית — חובה בדיקה אמפירית
   לפני כל החלטת-ספק.** כל הטענות על ביצועי-עברית במסמך הזה (Yappr,
   Soniox, ElevenLabs WER, S2S כלשהו) הן טענות-ספק או benchmarks כלליים
   — **לא שיחת-בדיקה אמיתית בעברית ישראלית לאירוע-RSVP**. לפני כל בחירת
   ספק-TTS/STT/S2S, יש להריץ פיילוט קטן (כמה שיחות-דגימה, ליווי-אנושי
   להערכת טבעיות/דיוק) — לא לבחור ספק על סמך marketing בלבד.
1. **ארכיטקטורה** (נוסף, §2.9-ב/4.2): VoxEngine JS על שרתי Voximplant,
   או ניתוק-טלפוניה (Voximplant=PSTN בלבד, לוגיקה בתשתית KALFA דרך
   `createWebSocket`)? משפיע ישירות על החלטה #1 המקורית למטה.
2. **מסלול-בנייה**: IVR דטרמיניסטי (TTS+DTMF, סיכון-נמוך) מול שיח-LLM/S2S
   חופשי? (§4.2 — שים לב: "IVR" כבר לא אומר "בלי אינטגרציית-TTS-חיצונית",
   ראו החלטה #0).
3. **פלטפורמה-ייעודית מול DIY** — עכשיו שלוש חלופות קונקרטיות, לא שתיים:
   (א) **Ultravox** — תומך ב-Voximplant **במפורש** כ-BYO-טלפוניה (§2.9-א)
   — שומר את החשבון/מספר הקיימים, מוסיף רק שכבת-AI; עברית לא-מתועדת,
   דורש בדיקה; (ב) ספק Hebrew-native מלא (Yappr) — הכי-מהיר-לפיתוח, אבל
   כנראה **לא שומר** את מספר/חשבון Voximplant הקיימים (מספק מספרים
   משלו) ויקר יותר ($0.25/דקה); (ג) DIY מלא (Voximplant+STT/LLM/TTS
   נפרדים, §2.9-ב) — הכי גמיש/זול, הכי הרבה קוד. טרייד-אוף אמיתי בין
   שימור-תשתית-קיימת, מהירות-פיתוח, עלות, ותלות-בספק.
4. **אישור משפטי**: מי מבצע/מאשר את הבדיקה הרגולטורית (§2.7/§2.9-ו) —
   ותזמון ביחס לבניית הקוד (מקביל, או תנאי-סף לפני)?
5. **תסריט-שיחה**: להרחיב `message_templates` הקיים או טבלה נפרדת (§5#6)?
6. **Reconciliation**: תדירות ה-job, וסף-הזמן להגדרת "לא קיבלנו push"
   (רלוונטי בעיקר למסלול VoxEngine-ישיר; פחות למסלול המנותק שבו יש לנו
   שליטה ישירה על תוצאת-השיחה בשרת שלנו).
7. **Voximplant Kit** (§2.4-ג): שווה בדיקה כחלופה-מקצרת-פיתוח, או להתעלם
   ולהתמקד ב-Management API הליבה?
8. **`writeReach()` vs `recordReached()`**: לאמץ את `writeReach()` (§4.4#4)
   גם ל-call, ואולי גם לתקן בעקיפין את WhatsApp להשתמש בו — או להשאיר
   כפי שהוא ולקרוא ל-`recordReached()` ישירות כמו WhatsApp היום, שומר על
   עקביות-עם-הקיים במחיר אי-ניצול הקוד שכבר נכתב לזה?

---

## §8. מה זו לא תוכנית — גבולות מפורשים

לא כלול כאן: קוד VoxEngine בפועל, migration בפועל, קריאת API אמיתית
ל-Voximplant, שינוי כלשהו ב-`channels-client.tsx`/`worker/main.ts`. זו
מסגרת-החלטה מבוססת-עובדות שדורשת מענה על §7 (ובמיוחד §7#2, האישור
המשפטי) **לפני** שממשיכים לתכנון-מימוש מפורט ברמת §5-6 של תוכנית ה-
packages (Zod/data-layer/actions/tests שורה-שורה).
