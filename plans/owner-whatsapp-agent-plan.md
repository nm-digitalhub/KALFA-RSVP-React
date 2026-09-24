# תוכנית: סוכן נתונים עסקיים לבעלים בוואטסאפ (Mastra) — KALFA

תאריך: 2026-09-24 · מצב: טיוטה לאישור הבעלים. עודכן באותו יום לפי החלטת הבעלים: **המספר נבחר בממשק הניהול**, מכל מספרי ה-WABA, כולל מספר שמשרת אורחים. אין override של Meta, אין קריאת Graph ואין route קליטה נפרד.

**מה קיים בריפו (24.9, 07:55):** המיגרציה `supabase/migrations/20260924034054_owner_agent_whatsapp.sql` **הוחלה על ה-DB החי** (שלב 1 ✅), ו-`types.generated.ts` נוצר מחדש ב-worktree המבודד `agent-a4b04504ddd685a17`. שלב 2 (ממשק ניהול) ✅ בקוד (commit `d14b8c8` ב-worktree), ממתין למיזוג ולבדיקת דפדפן. אין עדיין הסטה ב-route, אין תהליך סוכן, אין התקנת חבילות ולא נשלחה הודעה.

מקרא:
- **[נמדד]**: נבדק ישירות בקובץ, במסמך מקומי, ב-DB החי (קריאה בלבד) או במסמך רשמי שנשלף היום.
- **[מוסק]**: הסקה. צריך לאמת אותה בשלב שמצוין לידה.

מקורות Mastra: המסמכים שמותקנים עם הגרסה, `node_modules/@mastra/core/dist/docs/references/*.md` (core 1.69.0). בהמשך הם מקוצרים ל-`docs/<קובץ>:<שורה>`.

---

## 1. מטרה ותחום

**המטרה.** הבעלים שולח שאלה בעברית בוואטסאפ, למשל "כמה אירועים פעילים יש השבוע?", "כמה פניות פתוחות?" או "מה מצב השיחות הקוליות היום?". סוכן שבנוי על `@mastra/core` מחזיר תשובה קצרה, שמבוססת על נתוני KALFA ונשלפת בכלים לקריאה בלבד.

**עקרונות מחייבים:**
1. רק מספרים שהבעלים הגדיר בממשק הניהול יכולים להגיע לסוכן. כל שולח אחר לא נוגע בסוכן בכלל: אין קריאה למודל, אין תשובה, **ואין שום שורה בצד הסוכן**, גם לא שורת audit. ההודעה שלו ממשיכה במסלול של היום, בלי שינוי. אם המספר הנבחר משרת גם אורחים, שורות האורחים ב-`webhook_inbox` נכתבות בדיוק כמו היום.
1א. **לאורחים זה לא עולה כלום.** כל אירוע שאינו הודעה משולח מורשה על המספר הנבחר עובר ב-route בדיוק כמו היום, בשני המצבים של `outreach_enabled` (סעיף 2.3).
2. קריאה בלבד. לסוכן אין אף כלי שכותב, שולח או מחייב.
3. ברירת המחדל היא נתונים מצטברים (ספירות וסכומים). לא יוצאים שמות אורחים, טלפונים, שמות אירועים (הם כוללים לעתים קרובות שמות של בני זוג), תוכן פניות או הערות.
4. אין שום חיבור למנוע ה-workflow: לא `src/lib/workflow`, לא nodes, לא triggers ולא runs.
5. שימוש מ-Mastra רק במה שהוא מספק בעצמו: `Agent`, tools, processors, memory ו-storage, יחד עם שכבת הנתונים הקיימת.

**לא בגרסה הראשונה (v1):**
- פעולות כתיבה מכל סוג: שליחה לאורחים, עצירת קמפיין, חיוב, עריכה.
- הודעות יזומות מהסוכן (התראות או סיכום בוקר). הן דורשות תבנית מאושרת מחוץ לחלון 24 השעות.
- מדיה והודעות קוליות. ב-v1 רק טקסט.
- שליפות ברמת אורח בודד או לקוח מזוהה. אין שמות אירועים ואין תוכן פניות.
- כלי SQL חופשי.
- קבוצות וואטסאפ.
- Mastra Studio, או חשיפה של ה-HTTP API של Mastra.
- `@chat-adapter/whatsapp` ו-channels של Mastra. הסיבה בסעיף 2.5.
- ה-processors שמבוססים על מודל, `PIIDetector` ו-`PromptInjectionDetector`. הם החלטה פתוחה בסעיף 9.

---

## 2. חיבור וואטסאפ: הסטה בתוך ה-webhook הקיים

### 2.1 המצב היום [נמדד]

**ה-route הקיים** (`src/app/api/webhooks/whatsapp/route.ts`, נקרא במלואו):
- **Webhook אחד לכל המספרים שלנו.** כל מספרי ה-WABA מגיעים ל-route הזה, שמטפל ב-GET וב-POST.
- **GET** (שורות 255–268) מאמת את ה-`verify_token`, ואינו תלוי במתג. הוא לא משתנה.
- **POST** (`:271`):
  - `Promise.all` של `getOutreachEnabled()` ו-`getWhatsAppConfig()` (`:272–275`).
  - **השער של `outreach_enabled`** (`:278–280`). כשהמתג כבוי, או שאין `appSecret`, מוחזר 200 `ok`. זה קורה **לפני קריאת הגוף ולפני אימות החתימה**: אין כתיבה ואין התראה.
  - קריאת הגוף (`:282`) וכותרת החתימה (`:283`).
  - אימות `X-Hub-Signature-256` עם `whatsapp-api-js` (`:287–300`). חתימה שגויה: `alertRejectedDelivery` ו-401 (`:301–304`).
  - JSON לא תקין: התראה ו-400 (`:306–312`).
  - `insertWebhookDelivery` (`:318–322`), אחריו `normalizeWebhookRows` ו-`delivery_id` (`:324–327`), אחריו `insertWebhookEvents` (`:328–330`), ולבסוף 200 (`:331`).
- **`normalizeWebhookRows`** (`:153–226`):
  - שורה לכל הודעה, עם `dedupe_key = wa-msg:<wamid>` (`:184–200`).
  - שורה לכל status (`:201–219`).
  - שורות template-health (`:223`) ושאר שדות (`:224`).
  - `phone_number_id` נלקח מ-`value.metadata` (`:159`). `value.messages` הוא מערך (`:185`), ולכן delivery אחת יכולה להכיל כמה הודעות.

**קריאות ההגדרות והכתיבה:**
- `getOutreachEnabled` ו-`getWhatsAppConfig` מבצעות כל אחת `select('*')` על `app_settings` (`src/lib/data/outreach-config.ts:27–40, 64–100`). כלומר ה-route כבר קורא את השורה הזאת פעמיים בכל POST. שתיהן fail-safe: בשגיאה הן מחזירות false או null.
- `insertWebhookEvents` זורק בשגיאה (`src/lib/data/webhooks.ts:22–31`). ה-route מחזיר אז 500, ו-Meta שולחת שוב.
- `insertWebhookDelivery` לא זורק ומחזיר null. הוא שומר את `body` כ-jsonb (`webhooks.ts:40–69`).

**ה-worker:**
- `handleWebhook` קורא ל-`processWebhookEvent`, ואחריו ל-`startWorkflowRuns` על כל שורה (`worker/main.ts:544–575`).
- `classifyInboundChannel` מחזיר `'import'`, `'rsvp'` או `'unknown'` (`src/lib/whatsapp/channel-routing.ts:38–48`).
- המסלול `'rsvp'` מחייב: `resolveInboundContact`, אחריו `insertInteraction(billable:true)` ואחריו `recordReached` (`src/lib/data/webhook-processing.ts:285–329`).
- **status של הודעה שאינה של קמפיין לא עושה כלום:**
  - `setDeliveryStatus` מעדכן לפי `provider_id` ומחזיר `contactId: null` (`src/lib/data/interactions.ts:139–155`).
  - `createRunsForInboundMessage` מחזיר `[]` לכל מה שאינו הודעה (`src/lib/workflow/inbound.ts:46`).

**מספרים ב-DB החי** (שאילתת קריאה, בלי ערכים): 5 מספרי `meta_whatsapp`:
- אחד עם `whatsapp_rsvp_sender`, והוא גם `app_settings.whatsapp_phone_number_id`;
- אחד עם `whatsapp_import_sender`;
- שניים פעילים בלי תפקיד;
- אחד לא פעיל.

ב-`provider_numbers.provider_ref` נשמר ה-phone_number_id של Meta, מחרוזת ספרות באורך 16.

**שליחה והרשאות Meta:**
- `sendWhatsAppText(cfg, {to, body})` (`src/lib/whatsapp/client.ts:295–308`) לא מתעד טלפון או תוכן.
- יש app אחד, WABA אחד ו-token אחד (`channel-routing.ts:8–10`, `outreach-config.ts:64–100`).

### 2.2 ההחלטה (הבעלים, 2026-09-24): מספר נבחר + רשימת היתר, בתוך `route.ts`

**כלל ההסטה.** הודעה נכנסת (`event_kind = 'message'`) עוברת לסוכן **רק אם שני התנאים מתקיימים:**
1. `app_settings.owner_agent_phone_number_id` אינו null, והוא שווה ל-`value.metadata.phone_number_id` של ה-change שבו ההודעה נמצאת.
2. `from` תואם `^[1-9][0-9]{6,14}$`, ו-`normalizePhone('+' + from)` שווה ל-`e164` של רשומה ב-`owner_agent_allowlist` עם `enabled = true`.

**כל השאר לא מוסט:**
- statuses, כולל ה-statuses של תשובות הסוכן עצמו;
- template-health ושאר שדות;
- הודעות על מספרים אחרים;
- הודעות משולחים שאינם ברשימה, **גם על המספר הנבחר**.

כל אלה עוברים במסלול של היום, בלי שינוי.

**למה `'+' + from` ולא `normalizePhone(from)`** [נמדד: הרצה של `libphonenumber-js` עם מספרים סינתטיים]:
- ה-`from` של Meta הוא wa_id: המספר הבינלאומי המלא, בלי `+`.
- `normalizePhone` מניח `IL` כברירת מחדל, ולכן הוא מפרש wa_id זר כמספר ישראלי. לדוגמה, `508412345` (סן פייר, `+508412345`) הופך ל-`+972508412345`, שהוא נייד ישראלי תקין. באותו אופן `15417543010` (ארה"ב) הופך ל-`+97215417543010`.
- תוספת ה-`+` נותנת זהות מדויקת. בלעדיה, שולח זר יכול להתחזות למספר ישראלי ברשימה.

**ההסטה נעשית להודעה בודדת, לא ל-delivery שלמה.** delivery אחת יכולה להכיל הודעות מכמה שולחים על אותו מספר. [מוסק מהמבנה, `:185`]

**מתג הכיבוי לא משפיע על ההסטה.** הודעה מוסטת כשהמתג כבוי מקבלת שורת audit עם מזהים בלבד (`gated`/`kill_switch_off`). אין שורת קליטה, אין enqueue ואין תשובה.

**ההסטה לא תלויה ב-`outreach_enabled`.** עצירת החירום של השליחה לאורחים לא מכבה את הסוכן. זה מכוון, כי הסוכן עונה רק לאנשי צוות.

**מה קורה להודעה מוסטת.** מודול חדש, `src/lib/owner-agent/intake.ts` (`server-only`, בלי ייבוא Mastra):
1. מריץ את השער (3.1).
2. מבצע insert ל-`owner_agent_intake` עם `ON CONFLICT (wamid) DO NOTHING`.
3. **רק אם השורה נוצרה:** enqueue ל-pg-boss עם `deterministicJobId(wamid)`.
4. כותב שורת audit.

### 2.3 נקודות ההכנסה ב-`route.ts`, ולמה האורחים לא מושפעים

**A. קריאת ההגדרות: פריט שלישי ב-`Promise.all` בשורות 272–275.**
- `getOwnerAgentRouting()` היא פונקציה חדשה. היא בוחרת **רק** `owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap`, לא `select('*')`.
- היא fail-safe: כל שגיאה מחזירה `null`, כלומר "אין הסטה".
- היא רצה במקביל לשתי הקריאות הקיימות, ולכן לא מוסיפה השהיה טורית.

**B. מתג `outreach_enabled` כבוי: בתוך ה-`if` של שורה 278, לפני ה-`return` של שורה 279.**
```ts
if (!enabled || !config?.appSecret) {
  if (config?.appSecret && ownerAgent?.phoneNumberId) {
    await divertWhileOutreachOff(request, config, ownerAgent); // לעולם לא זורק
  }
  return new NextResponse('ok', { status: 200 }); // בדיוק כמו היום
}
```
`divertWhileOutreachOff` עושה "אמת קודם, בדוק אחר כך", **ומשרת רק את ענף הסוכן:**
1. קורא את הגוף ומאמת חתימה באותה קריאה של `:287–300`.
2. חתימה שגויה או JSON לא תקין: חזרה שקטה. **אין** `alertRejectedDelivery`, **אין** 401 או 400, כי במצב "כבוי" של היום אלה לא קורים.
3. בוחר רק הודעות שעומדות בכלל ההסטה ומעביר אותן ל-`handleOwnerAgentMessages`. **כל השאר נזרק כמו היום, בלי שום כתיבה.**
4. הכול עטוף ב-try/catch. שגיאה שולחת התראה עם מזהים בלבד, והתשובה נשארת 200 `ok`.

**C. מתג `outreach_enabled` דלוק: בין סוף בלוק ה-parse (שורה 312) לבין `insertWebhookDelivery` (שורה 318).**
1. `const diversion = await planOwnerAgentDiversion(data, ownerAgent);` מחזיר את ה-wamid-ים המוסטים ואת ההודעות עצמן. שגיאה בקריאה, למשל ברשימת ההיתר, מחזירה קבוצה ריקה: **אין הסטה, וה-delivery עוברת במסלול של היום.**
2. בשורה 324: `normalizeWebhookRows(data).filter(r => !(r.event_kind === 'message' && r.message_id != null && diversion.wamids.has(r.message_id)))`.
3. `insertWebhookDelivery` (`:318`):
   - אם כל האירועים ב-delivery מוסטים, מדלגים עליו. אין שם שום אירוע של אורח.
   - אחרת הוא נשמר **כמו היום, כלשונו** (החלטה 9.13).
4. `insertWebhookEvents` (`:328–330`) רץ כמו היום, על השורות שנשארו.
5. **רק אחרי שהאורחים נשמרו,** ולפני ה-`return` של שורה 331: `await handleOwnerAgentMessages(diversion.messages, ownerAgent)` בתוך try/catch. כשל שולח התראה עם מזהים בלבד, והתשובה נשארת 200.

**אינווריאנט:** תשובת ה-HTTP של ה-route לעולם לא תלויה בקוד הסוכן. לכן הכלל הקודם, "שגיאת DB בשער מחזירה 503", **בוטל ב-route**. ב-route משותף, 503 היה גורם ל-Meta לשלוח שוב גם אירועי אורחים. הכלל נשאר בתהליך הסוכן (3.1, שלב 3).

**למה אורחים לא מושפעים, בשני מצבי המתג:**
- **כשהמתג דלוק:**
  - חתימה שגויה ו-JSON לא תקין: הקוד החדש רץ אחרי שורה 312, ולכן 401 או 400 וההתראה לא משתנים.
  - כל שורה שאינה הודעה מוסטת נוצרת באותה `normalizeWebhookRows` ונכתבת באותה `insertWebhookEvents`. wamid נכנס לקבוצת ההסטה רק אם שני התנאים מתקיימים. אורח שאינו ברשימה לא עומד בתנאי 2.
  - ה-delivery נשמרת כלשונה בכל פעם שיש בה לפחות שורה אחת שלא הוסטה.
  - שגיאה בצד הסוכן לפני ההחלטה פירושה אין הסטה, כלומר המסלול של היום. שגיאה אחרי ההחלטה מגיעה רק אחרי שהאורחים נשמרו.
  - שורות מוסטות לא נכנסות ל-`webhook_inbox`. לכן אין להן סיווג, חיוב, headcount, ייבוא או `startWorkflowRuns`.
- **כשהמתג כבוי:**
  - התשובה זהה (200 `ok`) ואין כתיבה לשום אירוע שאינו מוסט.
  - ה-branch החדש לא שולח התראות על חתימה או על JSON.
  - כש-`owner_agent_phone_number_id` הוא null (ברירת המחדל), הגוף לא נקרא בכלל. ההתנהגות **זהה בייט לבייט** להיום.
- **ה-statuses של תשובות הסוכן** נכנסים ל-`webhook_inbox` כ-status רגיל. `processStatus` לא מוצא התאמה, ולכן זה no-op (`interactions.ts:139–155`, `inbound.ts:46`). אין חיוב.

**מה כן עולה, בפועל:**
- קריאת `app_settings` שלישית בכל POST, במקביל לשתיים הקיימות. [נמדד שהקיימות קיימות]
- **על המספר הנבחר בלבד:** שאילתת רשימת היתר אחת לכל delivery שיש בה הודעות, טורית לפני השמירה. כמה מילישניות. [מוסק]
- **כשהמתג כבוי ועל המספר הנבחר:** קריאת גוף, HMAC ואותה שאילתה, בלי כתיבה.
- **אדם שגם ברשימת ההיתר וגם אורח** באירוע: כל ההודעות שלו למספר הנבחר מוסטות לסוכן, כולל לחיצה על כפתור RSVP. הוא לא יוכל לאשר הגעה בוואטסאפ על המספר הזה (החלטה 9.15).
- **delivery מעורבת** (אורח + איש צוות באותו POST): טקסט השאלה של איש הצוות נשמר גם ב-`webhook_deliveries.body` (החלטה 9.13).

### 2.4 חלון 24 השעות

- הודעה של איש הצוות פותחת חלון שירות של 24 שעות. בתוך חלון פתוח, הודעה שאינה תבנית היא בחינם. מחוץ לחלון היא לא נשלחת. [נמדד: developers.facebook.com/docs/whatsapp/pricing]
- הסוכן רק **עונה**, ולעולם לא יוזם. התשובה יוצאת **מהמספר שקיבל את ההודעה**, לפי `intake.phone_number_id`, באותו עיקרון כמו `importSender` (`channel-routing.ts:75–84`). לכן גם אם המספר הנבחר הוא מספר האורחים, התשובה היא הודעת שירות חינמית בחלון שאיש הצוות פתח.
- ההשפעה על דירוג האיכות ועל מגבלת ההודעות של מספר האורחים זניחה [מוסק]. המגבלה חלה על שיחות שהעסק יוזם.
- אם ריצה מתעכבת מעבר לחלון, Meta מחזירה 131047. `client.ts:62` מסווג את הקוד הזה כ-`definitely_not_sent` [נמדד]. במקרה כזה רושמים `send_failed`/`window_closed` ב-audit ולא מנסים שוב.
- תשובה ארוכה מפוצלת ל-4096 תווים לכל הודעה. זה לפי README של ה-adapter ב-npm, ויש לאמת מול Meta בשלב 6. [מוסק]

### 2.5 חלופות שנדחו

**(a) מספר ו-Meta app נפרדים + channel של Mastra.** נדחתה מהסיבות האלה:
- **התנגשות משתני סביבה.** ב-`.env.local` כבר קיימים `WHATSAPP_ACCESS_TOKEN` ו-`WHATSAPP_PHONE_NUMBER_ID` (בדקתי שמות בלבד) [נמדד]. אלה בדיוק השמות שה-adapter קורא (`docs/integrations-channels-whatsapp.md:73–80`) [נמדד]. `createWhatsAppAdapter()` בלי ארגומנטים, בתהליך שטוען את `.env.local`, יתחבר בשקט ל-token ולמספר של הייצור. הקביעה שבלי ארגומנטים ה-adapter מזהה את הערכים אוטומטית מבוססת על README של `@chat-adapter/whatsapp@4.41.0` ב-npm. [נמדד]
- **ברירות המחדל של ה-channel מסוכנות לשימוש הזה,** וכולן היו צריכות דריסה:
  - `toolDisplay: 'cards'` (`docs/reference-agents-channels.md:109`);
  - `formatError` מחזיר `"❌ Error: <error.message>"` לצ'אט (`:101`);
  - `inlineMedia` כולל `application/pdf` (`:40`);
  - `typingStatus: true` (`:111`). לפי README של ה-adapter, typing גם מסמן את ההודעה כנקראה.
  
  [נמדד]
- **ה-channel חייב שרת HTTP של Mastra.** `@mastra/next` כ-catch-all חושף את כל ה-API, כולל `/api/agents/<id>/generate` (`docs/integrations-frameworks-next-js.md:342–415`) [נמדד]. endpoint כזה **עוקף לגמרי את רשימת ההיתר**. כלל קשיח: **לעולם לא להרכיב את `@mastra/next` או שרת Mastra ציבורי** בשביל הסוכן הזה.
- ה-webhook של channel מחזיר 200 לפני שה-agent רץ (`docs/docs-channels.md:87, 245`) [נמדד]. מה שה-Chat SDK עושה לפני ה-handler לא מתועד [מוסק].

**(b) override של Meta לכל מספר + route קליטה נפרד.** זו הייתה ההמלצה הקודמת. **הוסרה בהחלטת הבעלים מ-2026-09-24.** מה שהיא הצריכה והוסר איתה:
- קריאת Graph;
- `verify_token` נפרד;
- אי-ודאות אם זה עובד בחיבור ישיר;
- האיסור לבחור מספר אורחים;
- שלב ההגנה על "נפילה חזרה" ב-`worker/main.ts`.

---

## 3. אבטחה והרשאות

### 3.1 הסטה ושער

**שלב 0: ההסטה עצמה (ב-route, 2.2–2.3).** היא לא שער. הודעה שלא עומדת בשני התנאים (מספר נבחר, ושולח ברשימה ופעיל) **לא נוגעת בסוכן בכלל:**
- אין שורת audit;
- אין התראה;
- אין שאילתה נוספת מעבר לבדיקת הרשימה;
- ההודעה ממשיכה במסלול של היום.

הכלל הקודם, "שורת gated על כל POST והתראת 'שולח לא מורשה'", **בוטל.** על מספר משותף הוא היה נכתב לכל הודעת אורח. גם קודי הסיבה `not_allowlisted` ו-`non_phone_from` בוטלו: הודעה כזאת פשוט לא מוסטת.

**השער רץ שלוש פעמים, רק על הודעות מוסטות:**

1. **ב-route, ב-`handleOwnerAgentMessages`, אחרי שהאורחים נשמרו.** הבדיקות, לפי הסדר:
   - המתג `owner_agent_enabled` דלוק. אם לא: `kill_switch_off`.
   - `is_platform_staff_for_user(staff_user_id)`. אם לא: `not_staff`.
   - ה-`e164` ברשימה שווה ל-`profiles.phone_verified_e164` של אותו משתמש [נמדד שהעמודה קיימת]. אם לא: `phone_unverified`. זה קשר זהות כפול: אי אפשר למפות מספר זר לזהות של איש צוות.
   - מגבלת קצב לפי איש צוות (3.4). אם נחצתה: `rate_limited`.
   - התקרה היומית: ספירת שורות `owner_agent_intake` של היום לאותו `staff_user_id`, מול `owner_agent_daily_cap`. אם נחצתה: `daily_cap`.
   - סוג ההודעה הוא טקסט. אם לא: `non_text`, וראו בהמשך.

   **כל כישלון:** שורת audit אחת עם `stage='route'`, `outcome='gated'` וקוד סיבה. אין שורת קליטה, אין enqueue ואין תשובה.

   **מעבר:** insert ל-`owner_agent_intake` עם `ON CONFLICT (wamid) DO NOTHING`.
   - אם השורה נוצרה: enqueue ושורת audit `intake_queued`.
   - אם היא כבר הייתה קיימת (Meta שלחה שוב): audit `duplicate`, בלי enqueue.

   **שגיאת DB בשלב הזה:** התראת Slack עם מזהים בלבד. תשובת ה-route נשארת 200, ואיש הצוות שולח שוב. **לא 503** (2.3).
2. **בתהליך הסוכן, לפני `agent.generate()`.** אותן בדיקות, מול המצב הנוכחי. זה סוגר מצב TOCTOU: רשומה שבוטלה, מתג שכובה, או מספר נבחר שהשתנה. **כאן שגיאת DB מכשילה את ה-job**, ו-pg-boss מנסה שוב. לעולם לא ממשיכים כאילו השער עבר. זה אותו עיקרון כמו `resolveNumberForRoleStrict`, `provider-numbers-resolve.ts:60–99` [נמדד].
3. **בשליחה.** בדיקה סופית:
   - הנמען עדיין ברשימה ופעיל;
   - ה-`phoneNumberId` השולח שווה ל-`intake.phone_number_id`;
   - וגם שווה ל-`owner_agent_phone_number_id` הנוכחי.

   זה נחוץ כי ה-token מכסה את כל ה-WABA.

**משמעות:** שולח שאינו ברשימה לא מגיע לאף אחד מהשלבים. אין קריאה למודל, אין תשובה ואין שורה בצד הסוכן. ב-v1 אין channel של Mastra, ולכן אין typing, סימון כנקרא או הודעת שגיאה אוטומטית.

**הודעה שאינה טקסט (מדיה, קובץ, קול) משולח מורשה:**
- נכתבת שורת audit `gated`/`non_text`;
- מתבצע enqueue של job מסוג "תשובה קבועה", **בלי תוכן**;
- תהליך הסוכן בודק שוב את השער ושולח נוסח קבוע כמו "כרגע אני עונה על טקסט בלבד". אין קריאה למודל.

**כשל בריצה** (מודל, כלי, timeout): איש הצוות המורשה מקבל נוסח קבוע וכללי כמו "לא הצלחתי לענות כרגע, נסה שוב בעוד רגע". **לעולם לא** טקסט השגיאה, שם הספק או פרט תשתית. הסיבה נרשמת ב-audit כקוד בלבד.

### 3.2 מיפוי מספר מורשה לזהות צוות ולהרשאות

**העובדות:**
- `has_platform_permission(_key)` בודק רק את `auth.uid()` (`supabase/migrations/20260719215138_platform_permission_matrix_by_role.sql:25–49`).
- `hasPlatformPermission` ב-DAL קורא לו עם סשן cookie (`src/lib/auth/dal.ts:209–219`).
- לבקשה שמגיעה מוואטסאפ אין סשן.
- `has_role(_user_id uuid, _role app_role)` כן מקבל מזהה משתמש, אבל הוא הציר הישן.

[נמדד]

**התוכנית:**
- **שתי פונקציות חדשות, SECDEF ותוספתיות:**
  - `has_platform_permission_for_user(_user_id uuid, _key text)`, שמשכפלת את לוגיקת הבעלים והמטריצה של הפונקציה הקיימת;
  - `is_platform_staff_for_user(_user_id uuid)`, לבדיקה בשער שהמשתמש עדיין איש צוות. `is_platform_staff()` הקיימת נשענת על הסשן (`dal.ts:141`) [נמדד].
  
  הרשאת EXECUTE לשתיהן ניתנת **ל-`service_role` בלבד**.
- **ACL ב-dry run:** לוודא ש-`anon`, `authenticated` ו-`public` לא יכולים להריץ אותה. [נמדד ב-DB החי:]
  - ה-default privileges של סכמת `public` נותנים EXECUTE ל-`anon` ול-`authenticated` על כל פונקציה חדשה, ו-Postgres נותן EXECUTE ל-PUBLIC ב-CREATE. לכן המיגרציה מבצעת `revoke all … from public, anon, authenticated` ואז `grant execute … to service_role`. זה כמו `signup_reminder_candidates` (`20260906123802_signup_confirmation_reminder.sql:78–79`).
  - הגופים הם העתק של הפונקציות החיות, עם `auth.uid()` שהוחלף ב-`_user_id`.
  - הפונקציות הקיימות רצות עם `search_path=public`, והחדשות עם `search_path = ''` ושמות מלאים. זה כמו 20 פונקציות SECDEF חיות אחרות.
- ההרשאות נפתרות **בצד השרת** לפני הריצה ומועברות ב-`requestContext`.
- **סט הכלים נבנה דינמית:** `tools: ({ requestContext }) => …` (`docs/docs-server-request-context.md:146`) [נמדד]. כלי שאיש הצוות לא מורשה אליו לא מוצג למודל בכלל.
- **המודל לא יכול לבחור זהות או הרשאה.** אין בכלים פרמטר של user או של permission.
- **ב-v1 הבעלים בלבד** (החלטה 9.5). ה-schema כבר תומך בכמה אנשי צוות, כל אחד עם ההרשאות שלו. זה לפי הכלל "לא לתכנן לפי הצוות של היום".

### 3.3 ממשק ניהול: מתג, בחירת מספר ורשימת היתר

**מקום:** `/admin/integrations/owner-agent`, כרטיס חדש במסך האינטגרציות.

**הממשק כולל:**
- **מתג כיבוי:** `app_settings.owner_agent_enabled`, ברירת מחדל `false`.
- **בורר מספר:**
  - מציג את **כל** מספרי ה-WABA מ-`provider_numbers` (`provider = 'meta_whatsapp'`), כולל מספרים שמשרתים אורחים.
  - לכל מספר מוצגים תווית, המספר במיסוך, ותגים של תפקידים קיימים, למשל "משמש גם לאורחים (`whatsapp_rsvp_sender`)" או "ייבוא". מספר לא פעיל מסומן.
  - הערך שנשמר הוא `provider_ref`, כלומר ה-phone_number_id של Meta, ב-`app_settings.owner_agent_phone_number_id`.
  - האפשרות "ללא" שומרת null, ואז אין הסטה בכלל.
  - כשנבחר מספר אורחים, מוצגת הערה: "הודעות מהטלפונים ברשימת ההיתר למספר הזה יגיעו לסוכן. אורחים אחרים לא מושפעים."
  - **אין תפקיד חדש, אין שינוי ב-enum `provider_number_role` ואין שינוי ב-`ROLE_PERMISSION`.**
- **רשימת היתר:** מספר E.164, בחירת איש צוות, תווית, ופעיל/לא פעיל. לצד כל רשומה מוצג אם המספר תואם ל-`profiles.phone_verified_e164` של איש הצוות.
- **תקרה יומית:** `owner_agent_daily_cap`, ברירת מחדל 50.
- **רשימת ה-audit האחרונה:** זמן, איש צוות, שלב, תוצאה, קוד וכלים. בלי תוכן. טקסט השאלות **לא נגיש** ל-`authenticated` גם דרך ה-Data API, כי ב-`owner_agent_intake` יש grant ברמת עמודה בלי `message_text`.

**הרשאת עריכה: `requirePlatformOwner` בלבד.** עריכת הרשימה בפועל מעניקה גישה לנתונים דרך וואטסאפ. זו לא הגדרת מערכת רגילה, ולכן לא מספיק `manage_settings`.

**פער ב-DB [נמדד]:** ל-`app_settings` יש policy אחת בלבד, `app_settings_admin_all`: `ALL` ל-`authenticated` בתנאי `is_platform_staff()`, ו-grant של `SELECT,UPDATE`. המשמעות:
- כל איש צוות יכול לשנות את `owner_agent_enabled`, את `owner_agent_phone_number_id` ואת `owner_agent_daily_cap` ישירות דרך ה-Data API עם הסשן שלו. ההגבלה ל-owner בלבד נאכפת רק ב-DAL. זה המצב היום לכל עמודות `app_settings`, כולל ה-tokens.
- **רשימת ההיתר עצמה,** שהיא ההרשאה בפועל, נמצאת בטבלה נפרדת: קריאה לבעלים בלבד, ואין policy כתיבה. לכן רק service role כותב אליה.
- איש צוות לא-בעלים יכול להדליק או לכבות, להזיז את המספר או לשנות את התקרה. הוא **לא** יכול להוסיף את עצמו לרשימה. החלטה 9.14.

**מודול DAL:** קובץ חדש, `src/lib/data/admin/owner-agent.ts`, שנבדק אוטומטית בחיפוש הרקורסיבי של `admin-data-layer-coverage.test.ts`. הוא יוצמד שם כ-owner-only (`[]`) ב-`EXPECTED_PERMISSION`. [נמדד מבנה הבדיקה]

**הסוכן עצמו לא פעיל** עד שהבעלים בוחר מספר ומדליק את המתג.

### 3.4 הגבלת קצב ותקציב

- **ב-route, רק על הודעות מוסטות:** `rateLimit()` מ-`src/lib/security/rate-limit.ts:72–98`, לפי `staff_user_id`, למשל 10 הודעות בדקה [נמדד]. **הודעות אורחים לא עוברות דרכו.** המונה נשמר בזיכרון התהליך (`:1–8`), ולכן הוא קו הגנה ראשון בלבד.
- **ב-DB:** `app_settings.owner_agent_daily_cap` (ברירת מחדל 50, בטווח 0–10000). זה לפי התקדים של `callback_intake_sms_daily_cap` [נמדד]. הספירה היא של שורות אמיתיות ב-`owner_agent_intake`, לפי `(staff_user_id, received_at)`, ויש לה אינדקס. זה לפי התקדים ב-`src/lib/data/call-attempts.ts:420–426`: "A per-process rate limiter is not sufficient … so these count real rows". [נמדד]
- **בריצה:**
  - `maxSteps` קטן (`docs/reference-agents-generate.md:25`).
  - `modelSettings` עם תקרת טוקנים ליציאה (`:155`).
  - `abortSignal` עם timeout (`:89`).
  
  [נמדד]
- **`TokenCostControl` לא בשימוש ב-v1.** הוא נשען על observability, והמסמך מגדיר אותו כ"approximate" (`docs/reference-processors-token-cost-control.md`). [נמדד]

### 3.5 פרטיות: מה מגיע למודל ומה חוזר

- **הכלים מחזירים ספירות וסכומים בלבד.** אין שמות אירועים, אין תוכן פניות ואין טלפונים או אימיילים. זו ההגנה העיקרית.
- **`RegexFilterProcessor` על היציאה:** `presets: ['pii']`, `strategy: 'redact'`, `phase: 'output'`. הוא לא מבצע קריאת LLM (`docs/reference-processors-regex-filter-processor.md`) [נמדד]. מוסיפים חוקים מותאמים לפורמטים ישראליים (`05X-XXXXXXX`, `+972…`), כי לא ידוע אם ה-preset מכסה אותם [מוסק]. יש לבדוק בשלב 5 עם בדיקות יחידה.
- **`PIIDetector` ו-`PromptInjectionDetector`:**
  - כל אחד מוסיף קריאת מודל.
  - ברירת המחדל של `errorStrategy` בשניהם היא `'warn'`, כלומר fail-open. זה נמדד בקוד (`node_modules/@mastra/core/dist/agent-DwtTO5Px.js:12365, 12650`) ובמסמכים (`reference-processors-pii-detector.md:29`; `reference-processors-prompt-injection-detector.md:29`). אם מפעילים אותם, חובה `errorStrategy: 'strict'` ו-`model` אמיתי, כי הדוגמאות במסמכים משתמשות ב-`openrouter/…` (`:15` בשני הקבצים). [נמדד]
  - `PromptInjectionDetector` הוא input processor ובודק את ההודעות הנכנסות, לא את תוצאות הכלים (`:53`) [נמדד]. לכן הוא לא מגן מהזרקה עקיפה דרך טקסט של לקוחות.
  - ההגנה האמיתית היא בתכנון: **אין כלי כתיבה ואין טקסט חופשי של לקוחות בתוצאות הכלים.**
  - ב-v1 הם כבויים, והנושא בהחלטה 9.9.
- **כלל מה-fleet:** אסור לחבר (join) ל-`auth.users` באף כלי. זה אותו איסור כמו ב-`.claude/fleet/roles/business-ops.md`. [נמדד]
- **מה נשלח ל-Anthropic:** שאלת הבעלים, ההוראות, וספירות מהכלים. אין נתוני אורחים.

### 3.6 זיכרון ואחסון

- **חבילות:** `@mastra/memory` ו-`@mastra/pg` לא מותקנות [נמדד]. הגרסאות העדכניות ב-npm: `@mastra/pg@1.26.0` עם peer ל-`@mastra/core >=1.68`, ו-`@mastra/memory@1.31.0` [נמדד npm view]. ההתקנה בהצמדת גרסה ובאישור.
- **`PostgresStore` יוצר טבלאות לבד** (`docs/integrations-databases-postgresql.md:128–139`), וברירת המחדל היא `public` (`:64`). [נמדד] ב-Supabase, `public` חשוף ל-Data API. **לכן:**
  - `schemaName: 'owner_agent_mastra'`. הסכמה נוצרת במיגרציה, לפי התקדים של `pgboss` [נמדד: owner `postgres`, ACL ריק, לא חשופה]. אין grant ל-`anon`, ל-`authenticated` או ל-`service_role`. התהליך מתחבר כמו ה-worker, כתפקיד שמחזיק ב-`pgboss` [מוסק מהבעלות על `pgboss`]. **לעולם לא להוסיף את הסכמה לרשימת הסכמות החשופות ב-API.**
  - ריצת `init()` אחת באישור, או לכידת ה-DDL כמיגרציה.
  - לאחר מכן `disableInit: true` (`:72`). [נמדד]
- **חיבור:** פרמטרים של host, port, database, user ו-password (`:52–60`) [נמדד], עם שמות המשתנים הקיימים `SUPABASE_DB_*` [נמדד], דרך ה-session pooler. `max` נמוך.
- **Memory:**
  - `resource = owner-agent:<staff_user_id>`, ו-thread אחד מתגלגל לכל איש צוות.
  - היסטוריית הודעות פועלת כברירת מחדל (`docs/docs-memory-overview.md:179`) [נמדד]. מגבילים אותה ל-`lastMessages` קטן.
  - `generateTitle: false`: אחרת זו קריאת מודל נוספת (`reference-memory-memory-class.md:54`).
  - בלי `semanticRecall` ובלי `workingMemory`.
- **שמירה (retention):** job יומי שמוחק הודעות Mastra ושורות קליטה ישנות מ-N ימים (החלטה 9.8).
- **אין observability או exporters ב-v1,** כי הם היו שומרים prompts ותוצאות כלים. יש לוודא בשלב 6 שהם לא פעילים כברירת מחדל. [מוסק]
- **טלמטריה:** `@mastra/core` שולח טלמטריית שימוש ל-PostHog כברירת מחדל. הנתונים הם ספירות ו-hostname מגובב, בלי תוכן. זה כבוי רק עם `MASTRA_TELEMETRY_DISABLED=true` (`node_modules/@mastra/core/dist/feature-telemetry-C4P71GGd.js:5–17`). [נמדד] **מגדירים אותו.**

### 3.7 רישום ביקורת בלי PII

**טבלה `owner_agent_audit`,** כמו במיגרציה. כל שורה מכילה:
- `staff_user_id`, `intake_id` ו-`wamid_sha256`;
- `occurred_at`;
- `stage`: `route`, `agent` או `send`;
- `outcome`: `intake_queued`, `duplicate`, `gated`, `answered`, `refused`, `send_failed`;
- `reason_code`, למשל `kill_switch_off`, `not_staff`, `phone_unverified`, `rate_limited`, `daily_cap`, `non_text`, `window_closed`, `run_failed`;
- `tool_names`, `steps`, `input_tokens`, `output_tokens` ו-`latency_ms`.

**בלי** תוכן שאלה, בלי תשובה ובלי טלפון.

**איך זה נאכף:**
- כל שדות הקוד מוגבלים לתבנית `^[a-z][a-z0-9_]…$`, ולכן לא יכולים להכיל טלפון, שם או טקסט.
- זו תבנית, **לא רשימה סגורה**, כך שקוד חדש לא דורש מיגרציה.
- **שורות audit נכתבות רק על הודעות מוסטות,** אף פעם לא על תעבורת אורחים.

**למה לא הכלים הקיימים:**
- `logActivity` דורש סשן (`src/lib/data/activity.ts:34–35`) ולא מתאים. [נמדד]
- `recordStaffAccess` לא תלוי בבקשה (`src/lib/data/admin/access-log.ts:3,57`) [נמדד]. הוא יידרש רק אם בעתיד יתווסף כלי שקורא נתונים של לקוח מזוהה, ואינו ב-v1.

---

## 4. גישה למודל

**בקצרה: הרצה על טוקן ה-OAuth של Claude Code אינה מותרת, וגם אינה ישימה טכנית. הדרך היא `ANTHROPIC_API_KEY` עם מחרוזת `anthropic/…`.**

**מה אומרים התנאים.** מדף "Legal and compliance" הנוכחי של Claude Code (code.claude.com/docs/en/legal-and-compliance, נשלף היום) [נמדד]:
> "OAuth authentication … is designed to support ordinary use of Claude Code and other native Anthropic applications."

> "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider."

סוכן שרת שרץ תמיד ומופעל מהודעות וואטסאפ הוא שירות שמפתח בנה. הוא לא "שימוש רגיל ב-Claude Code". [מוסק, על בסיס הציטוט]

**מה אומר הצד הטכני.**
- `ai-sdk-provider-claude-code@4.3.2` קיים, הוא provider ל-AI SDK v7, ותלוי ב-`@anthropic-ai/claude-agent-sdk` [נמדד npm].
- ה-README שלו אומר שכלי AI SDK שמועברים ב-`tools` **נזנחים**: "AI SDK tools passed to generateText/streamText via the tools option are ignored", שורה 634 ב-README [נמדד]. כל ה-tools של הסוכן היו נעלמים.
- בנוסף, Claude Code CLI מריץ **כלים מובנים משלו** (shell, קבצים) על השרת. זה סיכון אבטחה.

**מה קיים היום.**
- `run-role.sh:123` מייצא `CLAUDE_CODE_OAUTH_TOKEN`, ושורה 140 מריצה את `claude -p` [נמדד].
- זה שימוש של ה-fleet ב-CLI עצמו. **התוכנית הזאת לא פותחת מחדש את השאלה הזאת.**
- הסוכן החדש לא יקרא את `.claude/fleet/.token.env` ולא ישתמש בו.

**החלופה:**
- מודל `anthropic/claude-sonnet-4-6`, או `anthropic/claude-haiku-4-5` לחיסכון. שתי המחרוזות מופיעות ב-`docs/docs-agents-overview.md:75`, ושורה 66 מציינת את `ANTHROPIC_API_KEY` [נמדד].
- "No provider import is needed for this format" (`:66`) [נמדד]. אין צורך ב-`@ai-sdk/anthropic`.
- **המפתח** נשמר בקובץ env נפרד לתהליך הסוכן בלבד, למשל `.env.owner-agent`. התקדים הוא `.env.pgboss-dashboard` [נמדד שהקובץ קיים]. כך kalfa-beta וה-worker לא רואים אותו.
- **הבעלים מזין את המפתח בעצמו.** לא מדפיסים ערכים.

**שמות משתני סביבה קיימים (שמות בלבד) [נמדד]:**
- **`.env.local`:** `APP_ORIGIN, DEVICE_TELEMETRY_ENABLED, ELEVENLABS_API_KEY, ELEVENLABS_SALES_WEBHOOK, ELEVENLABS_WEBHOOK, EMAIL_PROVIDER, EXCHANGE_EWS_ENCRYPTION_KEY, EXCHANGE_PROVIDER, GA4_CHANNEL_GROUP_ID, GA4_PROPERTY_ID, GA4_STREAM_ID, GOOGLE_APPLICATION_CREDENTIALS, INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID, INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET, KALFA_CONSOLE_SECRET, META_ADS_ACCESS_TOKEN, META_APP_ID, META_APP_ID_WA, META_APP_SECRET, META_APP_SECRET_WA, META_IG_ACCESS_TOKEN, META_IG_ACCESS_TOKEN_EXPIRES_AT, META_INSTAGRAM_BUSINESS_ACCOUNT_ID, MS_ARCHIVE_*, MS_GRAPH_*, NEXT_PUBLIC_*, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, OPS_AGENT_TOKEN, PGBOSS_DASHBOARD_URL, RECONCILE_AUTHORIZED_SET_ENABLED, RESEND_API_KEY, RESEND_WEBHOOK_SECRET, SEARCH_CONSOLE_SITE_URL, SEND_SMS_HOOK_SECRETS, SHAREPOINT_ARCHIVE_SITE, SUMIT_API_KEY, SUPABASE_DB_HOST, SUPABASE_DB_NAME, SUPABASE_DB_PASSWORD, SUPABASE_DB_PORT, SUPABASE_DB_USER, SUPABASE_SERVICE_ROLE_KEY, VAPID_*, VOX_CI_CREDENTIALS, WEBHOOK_ID, WEBHOOK_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_PHONE_NUMBER_ID`.
- **`.env.pgboss-dashboard`:** `DATABASE_URL, PGBOSS_SCHEMA, PORT, HOST, PGBOSS_DASHBOARD_AUTH_*`.
- **אין בשום קובץ `.env*`:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` או `MASTRA_*`.
- ב-`package.json` יש `@ai-sdk/openai`, אבל אין מפתח OpenAI.

**עלות:** זו הוצאה חדשה, ולכן נדרש אישור מפורש של הבעלים ותקציב (החלטה 9.3).

---

## 5. טבלת כלים

**ממצא רוחבי.** כל ה-readers של הניהול שבדקתי פותחים ב-`requirePlatformStaff`, `requirePlatformPermission` או `requireEventAccess`, כלומר בסשן cookie:
- `dashboard.ts:47–48`
- `nav-counts.ts:69–70`
- `voice-ops.ts:132–135`
- `campaigns.ts:249–250`
- `analytics.ts:188–192`
- `event-stats.ts:191–193`

[נמדד]

בתהליך בלי בקשה הם לא יעבדו. גם הייבוא של `nav-counts.ts` מושך את `dal.ts`, ואיתו את `next/headers`, כבר בראש המודול (`nav-counts.ts:1–5`). [נמדד]

**הפתרון:** לחלץ **ליבות שלא תלויות בבקשה**. זה לפי התקדים של `message-templates-resolve.ts` (`admin-data-layer-coverage.test.ts`, בהערה על EXEMPT) [נמדד]:
- הליבה מקבלת admin client ומחזירה מספרים.
- עטיפת הניהול הקיימת ממשיכה לבדוק הרשאה ולקרוא לאותה ליבה. לכן הסוכן ודף הניהול מציגים תמיד אותו מספר.
- כלל ה-dependency-cruiser `worker-no-request-scoped-next` (`.dependency-cruiser.cjs:88–93`) חל היום רק על `worker/` ו-`scripts/` [נמדד]. **מרחיבים אותו לנקודת הכניסה של הסוכן.**

**בכל הכלים:** אין קלט חופשי, רק enum של טווח (`today`, `7d`, `30d`). אין שדות טקסט של לקוחות בתוצאה.

| # | כלי (id) | מקור קיים | שער היום | תלוי סשן? | הרשאה לסוכן | רמת PII בתוצאה |
|---|---|---|---|---|---|---|
| 1 | `inquiries_summary` | `countNewContacts`, `countNewCallbacks` (`nav-counts.ts:32–51`) | `requirePlatformStaff` + `view_customer_data` ב-wrapper (`dashboard.ts:53–60`) | ה-wrapper כן. הליבות לא, אבל צריך להעביר אותן למודול שלא מייבא את `dal.ts` | `view_customer_data` | אין: ספירות לפי סטטוס. לעולם לא תוכן, שם או אימייל |
| 2 | `campaigns_status_summary` | `listCampaignsForAdmin` (`campaigns.ts:249–276`) ו-`countWinddownCampaigns` (`nav-counts.ts:53–59`) | `manage_billing` | כן. ליבה חדשה שמחזירה ספירות לפי `status`/`capture_status` | `manage_billing` | אין. ב-wrapper יש `eventName` ו-URL של מסמך, **ושניהם לא נחשפים** |
| 3 | `billing_summary` | ליבה מצטברת חדשה (sum/count ב-DB) מעל `campaigns` (`charge_status`, `final_charge_amount`, `credit_applied`, `capture_status`) ומעל `billing_credits`. `getCampaignBillingSummary` (`billing.ts:66–89`) הוא פר-קמפיין: אין לקרוא לו בלולאה (N+1) | אין שער בליבה. היא service-role | לא | `view_billing` | אין: סכומים וספירות. לעולם לא שדות token או כרטיס |
| 4 | `voice_calls_summary` | `getVoiceDashboardSummary` (`voice-ops.ts:132–181`) ו-`countActiveCalls` (`call-attempts.ts:427–436`, ליבה נקייה) | `manage_voice` | ה-wrapper כן. ליבה חלקית קיימת | `manage_voice` | אין: ספירות ושיעור מענה |
| 5 | `events_pipeline` | ליבה חדשה: ספירת אירועים לפי `status`, `event_type` ודליי תאריך. אין reader מצטבר קיים ברמת פלטפורמה [מוסק לפי הסריקה] | — | לא | `view_events` | נמוכה: ספירות. **לא שמות**. תאריכים דרך העזרים של `event-date`, לא דרך `slice(0,10)` על `timestamptz` |
| 6 | `rsvp_totals` | ליבה חדשה: ספירת אורחים לפי סטטוס RSVP באירועים פעילים. `getEventStats` הוא פר-אירוע ותחת `requireEventAccess` (`event-stats.ts:191–193`) | — | לא | `view_events` | אין: ספירות וסכום צפי |
| 7 | `whatsapp_delivery_summary` | ליבה חדשה מעל `contact_interactions` (`direction`, `delivery_status`, `delivery_error_code`) | — | לא | `view_webhooks` (הצעה, החלטה 9.10) | אין: ספירות וקודי שגיאה |
| 8 | `web_traffic_summary` | `getAnalyticsDashboard` (`analytics.ts:188–192`) מעל `src/lib/analytics/ga4-*` | `requirePlatformStaff` + `view_customer_data` | ה-wrapper כן. הלקוח (`ga4-client.ts`) ו-config הם `server-only` ובלי סשן [מוסק לפי הייבוא] | `view_customer_data`, כמו הדף | אין: סשנים, משתמשים והמרות. **בלי** דמוגרפיה |
| 9 | `system_health` | ליבה חדשה: ספירות של `webhook_inbox` שלא עובדו או נכשלו, וזמן העיבוד האחרון | — | לא | `view_webhooks` | אין: ספירות בלבד, לעולם לא `payload` |

**עוד הערות:**
- **כלי 9 לא מריץ `runWhatsAppHealthCheck`.** זו ריצה חיה מול Graph ששולחת התראות, ולכן אינה קריאה בלבד.
- **חפיפה עם `business-ops` של ה-fleet.** לתפקיד הזה יש שאילתות כספיות משלו (`.claude/fleet/roles/business-ops.md`) [נמדד]. אם הליבות ישמשו גם אותו, יש הגדרה אחת לכל מספר. זה לא תנאי ל-v1.
- **Zod:** ה-repo על `zod ^4.5.4`, ו-peer של core הוא `"^3.25.0 || ^4.0.0"` [נמדד]. לא להשתמש ב-`z.uuid()` בקלט. הכלים מקבלים enum בלבד.

---

## 6. אירוח

**ההחלטה:** ההסטה והקליטה נעשות בתוך `route.ts` הקיים (2.3), בלי ייבוא Mastra, והסוכן רץ בתהליך pm2 נפרד (`kalfa-owner-agent`). אין route קליטה נפרד.

| | בתוך route של Next (`after()`) | **תהליך נפרד (נבחר)** | בתוך `kalfa-worker` |
|---|---|---|---|
| בידוד תקלות וזיכרון | ריצת מודל של 10–60 שניות בתהליך האתר, ו-deploy קוטע אותה | מלא | מסכן את ה-worker שמטפל בחיוב |
| ייבוא Mastra ל-bundle של Next | נדרש, עם `serverExternalPackages` | לא. ה-route לא מייבא Mastra | bundle CJS של esbuild, ראו מתחת |
| חלוקת סודות | kalfa-beta היה רואה את `ANTHROPIC_API_KEY` | קובץ env נפרד | ה-worker היה רואה את המפתח |

**פרטים:**
- **Enqueue מה-route:** `getWebJobSender()` (`src/lib/queue/web-sender.ts:19–49`, עם `migrate:false`) ו-`deterministicJobId` (`src/lib/queue/deterministic-id.ts:20`), מה-wamid. [נמדד] תור חדש ב-`QUEUES`. בתהליך הסוכן `boss.work` עם `supervise:false` ו-`schedule:false`.
- **ESM ו-bundling:**
  - `@mastra/core` הוא `"type":"module"` ומספק גם בנייה ל-`require` (exports). נדרש `node >=22.13.0`, והשרת על `v24.21.0`. [נמדד]
  - בגרסת ה-CJS יש שימוש מוגן ב-`__filename` במקום `import.meta.url` (`provider-registry-*.cjs:18491`) [נמדד]. ה-bundle של ה-worker כבר קרס בעבר על `import.meta.url` (זיכרון הפרויקט).
  - **לכן:** esbuild ל-ESM (`--format=esm --platform=node`), כש-`node_modules` חיצוניים ו-Mastra לא נכנס ל-bundle. אותם alias של `server-only` ו-`next/*` אל `worker/empty.js` כמו בשאר הסקריפטים ב-`package.json` [נמדד].
  - לא ידוע אם `tsconfig paths` (`@/*`) נפתרים לפני `--packages=external` [מוסק]. בודקים את זה בשלב 6, יחד עם סקריפט בדיקת bundle דומה ל-`check-worker-bundle.mjs`.
- **TypeScript:** ה-`tsconfig` של ה-repo עם `"module":"esnext"` ו-`"moduleResolution":"bundler"` [נמדד]. זה עונה על הדרישה של Mastra (`docs/docs-server-overview.md:83–100`) [נמדד].
- **pm2 ו-deploy:**
  - רשומה חדשה ב-ecosystem.
  - שורת `pm2 restart kalfa-owner-agent` בסקריפט `deploy`. היום הוא מאתחל את kalfa-beta, worker, fleet ו-ops-agent [נמדד].
  - `pm2 restart` רק אחרי build תקין. אין לעולם `next build` מקביל (זיכרון הפרויקט).
- **npm:** בכל התקנה של חבילה (`@mastra/memory`, `@mastra/pg`) להריץ אחר כך `npm run browser:check`, כי puppeteer נעלם בהתקנות (זיכרון הפרויקט).
- **בדיקות:** ל-Mastra יש mock מודל שמיוצא בנתיב `@mastra/core/test-utils/llm-mock` (`package.json` exports) [נמדד]. משתמשים בו כדי להוכיח שאין `generate` לשולח לא מורשה, בלי לקרוא למודל אמיתי.

---

## 7. סיכונים והתנגשויות

**ביצוע במקביל ובמאגר הקוד:**
1. **סוכן אחר עושה עכשיו refactor ל-`src/lib/workflow`.** התוכנית המעודכנת **לא נוגעת** ב-`worker/main.ts` וגם לא ב-`src/lib/workflow`. שורות מוסטות לא נכנסות ל-`webhook_inbox`, ולכן `startWorkflowRuns` לא רואה אותן. שלב ההגנה הקודם (שלב 3) בוטל.
2. **`@mastra/core` נוסף ב-commit `6404eee` ואין לו עדיין אף importer** ב-`src`, `worker` או `scripts` [נמדד]. לוודא שה-refactor של ה-workflow לא מאמץ את Mastra בכיוון שמתנגש.
3. **הענף הנוכחי הוא `feat/admin-integrations-consolidation`.** כרטיס הניהול החדש נכנס לאזור שמאוחד עכשיו. לתאם.

**ה-route המשותף (החלטת 2026-09-24):**

4. **נגיעה בנתיב החם של האורחים.** `route.ts` הוא הקובץ שממנו מתחיל החיוב. ההגנות:
   - ההסטה פעילה רק כש-`owner_agent_phone_number_id` אינו null. כשהוא null, הקוד זהה בייט לבייט להיום.
   - תשובת ה-HTTP לעולם לא תלויה בקוד הסוכן.
   - שגיאה בצד הסוכן לפני ההחלטה פירושה אין הסטה.
   - בדיקות golden לשני מצבי `outreach_enabled` (שלב 4).
5. **הסוכן עונה גם כש-`outreach_enabled` כבוי.** זה מכוון: הוא עונה רק לאנשי צוות, יש לו מתג משלו (`owner_agent_enabled`), ועצירת החירום של האורחים לא משפיעה עליו.
5א. **איש צוות שהוא גם אורח.** טלפון ברשימת ההיתר מוסט **תמיד** על המספר הנבחר, כולל לחיצה על כפתור RSVP. אם הוא גם אורח באירוע, הוא לא יוכל לאשר הגעה בוואטסאפ על המספר הזה. הוא עדיין יכול דרך הקישור (`/r/…`) או במספר אחר. החלטה 9.15.
5ב. **delivery מעורבת.** אם באותו POST יש הודעה של אורח והודעה של איש צוות, המעטפה נשמרת כלשונה. לכן טקסט השאלה נכנס גם ל-`webhook_deliveries.body`, שגלוי ב-`/admin/webhooks`. זה [מוסק] כנדיר. החלטה 9.13.
5ג. **עלות תשתית לכל POST:**
   - קריאת `app_settings` שלישית, במקביל לשתיים הקיימות;
   - על המספר הנבחר, שאילתת רשימת היתר אחת לכל delivery עם הודעות;
   - כשהמתג כבוי ועל המספר הנבחר, גם קריאת גוף ו-HMAC.
   
   אין כתיבה נוספת עבור אורחים.
5ד. **נרמול `from`.** `normalizePhone(from)` על wa_id זר מחזיר מספר ישראלי שגוי [נמדד: `508412345` הופך ל-`+972508412345`]. לכן השער חייב `normalizePhone('+' + from)`, וזה חייב להיות מכוסה בבדיקת יחידה.
   - **ממצא נפרד, שכבר קיים היום ולא נגרם מהתוכנית הזאת:** `resolveInboundContact` מנרמל את ה-wa_id הגולמי (`interactions.ts:75`). לכן שולח זר יכול להיות משויך לאיש קשר ישראלי ולחיוב שלו. להעביר ל-`events-guests-expert` או ל-`campaign-outreach-engineer`.
5ה. **`app_settings` פתוחה לכל הצוות** [נמדד: `app_settings_admin_all`]. איש צוות שאינו בעלים יכול להדליק או לכבות את הסוכן, להזיז את המספר או לשנות את התקרה דרך ה-Data API. הוא לא יכול להוסיף טלפון לרשימה. החלטה 9.14.

**Mastra:**

6. **BSUID ושמות משתמש ב-Meta** (route.ts:170–174). `from` עשוי להפסיק להיות טלפון. במקרה כזה ההודעה לא מוסטת וממשיכה במסלול של היום, ואיש הצוות לא יגיע לסוכן. זו תקלה של זמינות, לא של אבטחה.
7. **Mastra יוצר DDL לבד.** זה מתנגש עם מדיניות המיגרציות של הפרויקט (3.6). המיגרציה יוצרת את הסכמה `owner_agent_mastra`. הטבלאות עצמן נוצרות ב-`init()` אחד באישור, או במיגרציה שתלכוד את ה-DDL.
8. **טלמטריה של Mastra ל-PostHog** פועלת כברירת מחדל [נמדד]. לכבות אותה.
9. **התנגשות בשמות `WHATSAPP_*`** אם מישהו יוסיף בעתיד את ה-adapter של Mastra (2.5).

**מודל ועלויות:**

10. **עלות API** חדשה. נדרשים אישור ותקרה.
11. **הזרקה עקיפה** דרך טקסט של לקוחות. היא מנוטרלת ב-v1 כי אין טקסט חופשי בתוצאות הכלים ואין כלי כתיבה. כל כלי עתידי שמחזיר טקסט של לקוח פותח אותה מחדש.

**שמירת נתונים:**

12. **שאלות הבעלים נשמרות** בטבלת הקליטה ובזיכרון של Mastra. זה מידע עסקי, לא נתוני אורחים, ויש retention (החלטה 9.8).

**`whatsapp-claude-agent` שכבר רץ על השרת.** לא לעצור אותו.

מה ידוע עליו [נמדד, אלא אם כתוב אחרת]:
- **איפה הוא רץ:** container של Docker בשם `whatsapp-claude-agent`, מ-image `node:20-bookworm-slim`, ב-compose project `claude-agent`. הוא רץ מ-2026-09-18 18:10 עם `restart: unless-stopped`.
- **Mounts:** `/opt/psa/var/modules/docker/stacks/claude-agent` ל-`/workspace` במצב rw, ו-volume `claude-agent_whatsapp-session` ל-`/data/session`.
- **רשת והרשאות:** רשת `claude-agent_default`, **בלי פורטים מפורסמים**, `Privileged=false`. התהליך רץ כ-root בתוך ה-container. במשתני הסביבה של ה-container יש רק `PATH`, `NODE_VERSION` ו-`YARN_VERSION`.
- **מה הוא:** `dsebastien/whatsapp-claude-agent`, שבנוי על `@whiskeysockets/baileys` ו-`@anthropic-ai/claude-agent-sdk` (package.json ב-GitHub). כלומר **לקוח WhatsApp Web לא רשמי**, שמחובר כמכשיר מקושר, ולא Cloud API.
- **ההפעלה:** `-w <מספר מורשה אחד, <masked>> -d /workspace -m plan -s /data/session`. לפי ה-README, מצב `plan` הוא "read-only".
- **פקודת ההפעלה** מתקינה את `@anthropic-ai/claude-code` ומורידה את `releases/latest` של הבינארי **בכל הפעלה מחדש**. זו שרשרת אספקה לא מוצמדת.

מה עולה מזה:
- **גישה ל-KALFA:** אין mount של ה-repo של KALFA ואין פורטים. לכן הוא לא רואה את הקוד או את ה-DB, אלא אם יש אישורים בתוך תיקיית ה-stack, שאין לי הרשאה לקרוא אותה [מוסק].
- **אימות מול Claude:** אין `ANTHROPIC_API_KEY` בסביבת ה-container, ולכן סביר שהוא עובד עם התחברות של Claude Code בתוך ה-container [מוסק].
- **התנגשות עם KALFA:** אין. מספר שרשום ל-Cloud API לא יכול לשמש גם כמכשיר מקושר [מוסק].
- **סיכונים שלו עצמו:** תנאי השימוש של WhatsApp לגבי לקוחות לא רשמיים, וחסימה אפשרית של המספר המקושר. הוא חופף בתפקידו לסוכן החדש. הצעה: להחליט אם להוריד אותו רק אחרי שבועיים של הסוכן החדש (החלטה 9.11).

**חפיפה עם ה-fleet:**
- `kalfa-ops-agent` הוא שרת probe על loopback, בלי LLM (`ops/probe-server.mjs:1–24`) [נמדד]. אין חפיפה.
- `kalfa-fleet`/`business-ops` מייצר דוחות כספיים מתוזמנים ל-Slack ולדחיפה, בקריאה בלבד [נמדד]. חפיפה חלקית בתוכן: דוחות מתוזמנים לעומת שאלות לפי דרישה. ההמלצה היא ליבות משותפות (סעיף 5), לא איחוד.

---

## 8. שלבי מימוש קטנים, עם אימות לכל שלב

**כל שלב מסתיים** ב-`npm run lint`, `npx tsc --noEmit`, הבדיקות הרלוונטיות ו-`npm run build` (לעולם לא במקביל ל-build אחר). כל שינוי DB, Meta, התקנת חבילה או deploy **ממתין לאישור מפורש**.

**שלב 0: החלטות.** אין קוד. הבעלים עונה על סעיף 9. אם מאושר, הוא מזין בעצמו את `ANTHROPIC_API_KEY` לקובץ env נפרד.
*אימות:* רשימת ההחלטות מתועדת.

**שלב 1: מיגרציה.** **הקובץ קיים:** `supabase/migrations/20260924034054_owner_agent_whatsapp.sql`, שנוצר ב-`supabase migration new`. הוא ב-commit נפרד (`591ef13`) ב-worktree `agent-a4b04504ddd685a17`.

**סטטוס: ✅ הוחל, 24.9.2026 ~07:47**, מה-worktree (הקישור `supabase/.temp` הועתק אליו מהעץ הראשי, ו-`.env.local` מקושר ב-symlink כי `config.toml` קורא את `SEND_SMS_HOOK_SECRETS`). הבעלים הריץ בעצמו: `db push --linked --dry-run` (הציג רק את הקובץ הזה), ואז `db push --linked`. אחרי ההחלה, בקריאה בלבד מול ה-DB החי:
- בדיקות a–f שבסוף הקובץ: כולן כצפוי. הפונקציות: EXECUTE ל-`service_role` בלבד, SECDEF, `search_path=""`. התאמה לסגל: 3/3 אנשי צוות, 2/2 בעלים, null → false. RLS דלוק ב-3 הטבלאות, `authenticated` בלי כתיבה, בלי `message_text`. 3 policies. הסכמה `owner_agent_mastra` בלי הרשאות. ברירות מחדל: false, אין מספר, 50.
- `supabase gen types --linked` ב-worktree: 147 שורות נוספו, 0 נמחקו, כולן של האובייקטים החדשים. `check-supabase-types.mjs`: תואם.
- `db advisors --type security`: 45 ממצאים, **אף אחד לא נוגע באובייקטים החדשים** (כולם קיימים מקודם).
- **השלכה ידועה:** עד שהמיגרציה ו-`types.generated.ts` יאוחדו לענף הראשי, `npm run deploy` בעץ הראשי נעצר בבדיקת `types:check`, לפני הבנייה.

**מה הוא יוצר.** כל מזהה נגזר מהסכמה החיה, בשאילתות קריאה בלבד:
- `app_settings`:
  - `owner_agent_enabled` (`false`);
  - `owner_agent_phone_number_id` (text nullable, ספרות בלבד);
  - `owner_agent_daily_cap` (50, בטווח 0–10000).
- `owner_agent_allowlist`:
  - `e164` ייחודי, עם אותו check של `provider_numbers_e164_chk`;
  - `staff_user_id` עם FK ל-`platform_staff(user_id)` ו-on delete cascade;
  - `enabled`, `label`, `created_by`, `created_at`.
- `owner_agent_intake`: `wamid` ייחודי, `phone_number_id`, `staff_user_id`, `message_text` (1–4096), `status` מוגבל לתבנית, וזמנים עם trigger ל-`set_updated_at`.
- `owner_agent_audit`: מזהים וקודים בלבד (3.7).
- **RLS דלוק בשלוש הטבלאות:**
  - `revoke all` מ-`public`, `anon` ו-`authenticated`;
  - `select` ל-`authenticated` עם policy `*_owner_select` שבודקת `(select public.is_platform_owner())`, לפי התקדים של `ops_errors`;
  - ב-intake ה-grant הוא ברמת עמודה, **בלי `message_text`**;
  - אין policy כתיבה, כך שרק service role כותב.
- SECDEF `is_platform_staff_for_user(uuid)` ו-`has_platform_permission_for_user(uuid, text)`:
  - העתק של הגופים החיים;
  - `set search_path = ''`;
  - `revoke all from public, anon, authenticated` ו-`grant execute to service_role`.
- סכמה `owner_agent_mastra`: owner-only, בלי grants.
- **אין שינוי ב-enum `provider_number_role`.**

*אימות. כל השלבים רצים מהעץ הראשי, אחרי שהקובץ נכנס אליו בשמו הנוכחי, בלי שינוי, ורק באישור:*
- ה-dry-run שכתוב כהערה בסוף הקובץ, `begin … rollback` בחיבור pg ישיר. `db query` לא יכול להריץ אותו. הוא בודק:
  - `has_function_privilege` ל-`anon`, ל-`authenticated` ול-`public`;
  - `aclexplode … grantee = 0`;
  - הרשאות טבלאות ועמודות;
  - `pg_policies`;
  - הרשאות הסכמה;
  - ברירות המחדל.
- `npx supabase db push --linked --dry-run` מציג **רק** את הקובץ הזה. אחריו `db push --linked`.
- `npx supabase db advisors --linked --type security`.
- `npm run gen:types` ואחריו `npm run types:check`. **`types.ts` רק דרך gen types.**

**שלב 2: ממשק ניהול.** כרטיס `/admin/integrations/owner-agent`:
- DAL עם `requirePlatformOwner`;
- מתג;
- **בורר מספר שמציג את כל מספרי ה-WABA,** כולל מספרי אורחים עם תג, ושומר `provider_ref` ב-`owner_agent_phone_number_id`;
- רשימת היתר עם חיווי התאמה ל-`profiles.phone_verified_e164`;
- תקרה יומית.

אין תפקיד חדש ואין שינוי ב-`ROLE_PERMISSION`.

*אימות:*
- `admin-data-layer-coverage.test.ts` ירוק, עם ההצמדה החדשה;
- בדיקת יחידה ל-DAL;
- בדיקת דפדפן (RTL, מקלדת, מצבי ריק ושגיאה).

**סטטוס: ✅ בקוד, 24.9.2026** (commit `d14b8c8` ב-worktree `agent-a4b04504ddd685a17`). **בדיקת הדפדפן ממתינה** למיזוג ול-deploy.
- **קבצים חדשים:** `src/lib/data/admin/owner-agent.ts` (DAL, כל export עם `requirePlatformOwner`), `src/lib/validation/owner-agent.ts`, `src/app/(admin)/admin/integrations/owner-agent/` (`page.tsx`, `actions.ts`, `number-picker.tsx`, `allowlist-panel.tsx`, `owner-agent-settings-forms.tsx`, `audit-table.tsx`), ובדיקות לכל אחד.
- **קבצים ששונו:** `src/lib/data/admin/integrations/index.ts` (כרטיס עם הסמן `OWNER`; המצב נקרא משתי עמודות `app_settings`, כי ב-RPC `integrations_configured_flags` אין דגל לסוכן), `admin-data-layer-coverage.test.ts` (הצמדה `[]` ובדיקה לכל export), `docs/project/09-admin-panel.md`.
- **שערים:** `tsc` 0 שגיאות; `lint` 0; `worker:deps` בלי הפרות; בדיקות ממוקדות 387/387; `npm test` מלא 7228 עברו, 5 נכשלו בשלושה קבצים שקוראים את `node_modules` ואת `voxfiles/.../scenarios/dist`, שאינם קיימים ב-worktree (לא קשור לשינוי). `next build` לא הורץ, לפי ההנחיה.
- **נוסף מעבר לתוכנית:** קלט הטלפון לרשימה מתקבל רק כ-`+…` או כמספר ישראלי שמתחיל ב-0, כי ספרות זרות בלי `+` מתנרמלות למספר ישראלי אחר (אותו ממצא כמו 5ד). תקרה ריקה נדחית ולא הופכת ל-0.

**שלב 3 (בוטל): הגנה על נפילה חזרה.** לא נדרש יותר. שורות מוסטות לא נכנסות ל-`webhook_inbox`, ולכן אין צורך:
- ב-class `'owner_agent'` ב-router;
- או בדילוג על `startWorkflowRuns` ב-`worker/main.ts`.

אין נגיעה ב-worker או ב-`src/lib/workflow`.

**שלב 4: הסטה ב-`route.ts`, ובדיקות שמוכיחות שמסלולי האורחים לא השתנו בכלל, כולל כשהמתג כבוי.**
1. **הקוד:**
   - `getOwnerAgentRouting()`, כפריט שלישי ב-`Promise.all` בשורות 272–275;
   - `divertWhileOutreachOff` בתוך ה-`if` של שורה 278, לפני ה-`return` של 279;
   - `planOwnerAgentDiversion`, בין שורה 312 לשורה 318;
   - הסינון בשורה 324;
   - `handleOwnerAgentMessages` אחרי שורה 330.
   
   המודול `src/lib/owner-agent/intake.ts` כולל את השער, ה-insert, ה-enqueue עם `deterministicJobId(wamid)` וה-audit. בשלב הזה **אין עדיין צרכן**.
2. **מטריצת golden** ב-`route.test.ts`. הבדיקות הקיימות לא משתנות.
   - **fixtures:**
     - status בלבד;
     - הודעת אורח על מספר אחר;
     - הודעה משולח שאינו ברשימה על המספר הנבחר;
     - הודעה משולח מורשה;
     - delivery מעורבת;
     - template-health;
     - שדה אחר;
     - חתימה שגויה;
     - JSON לא תקין;
     - wa_id זר שמתנרמל בטעות למספר ישראלי שברשימה.
   - **הצלבה עם:** `outreach_enabled` דלוק או כבוי, מספר נבחר או null, מתג הסוכן דלוק או כבוי, ושגיאת DB בקריאת רשימת ההיתר.
   - **מה נבדק:** לכל fixture שאין בו הודעה מורשית, הסטטוס והגוף של התשובה, ולוג הקריאות המלא ל-`insertWebhookDelivery`, `insertWebhookEvents` ו-`sendSlackAlert`, **שווים בדיוק (deep-equal)** לריצה שבה הפיצ'ר לא מוגדר. מה שעובר ל-`insertWebhookEvents` זהה עד הבייט.
   - **כשהמתג כבוי:** אפס כתיבות לכל אירוע שאינו מוסט, ואפס התראות על חתימה או JSON.
   - **הודעה מורשית:** אין שורה ב-`webhook_inbox`. יש שורת audit אחת עם קוד. יש insert או enqueue רק כשהשער עובר.
3. **deploy כש-`owner_agent_phone_number_id` = null.** אין שינוי בהתנהגות. אחר כך, באישור, בוחרים מספר, והמתג של הסוכן **כבוי**.

*אימות בחיים:*
- הודעה אחת מטלפון מורשה: שורת audit עם `gated`/`kill_switch_off`, ואין שורה ב-`webhook_inbox` עם ה-wamid שלה.
- הודעה אחת מטלפון שאינו ברשימה, לאותו מספר: אין שורת audit. כשהמתג דלוק, נוצרת שורה ב-`webhook_inbox` בדיוק כמו היום. כשהוא כבוי, לא נוצר כלום.

**שלב 5: ליבות וכלים לקריאה בלבד, בלי מודל.**
- חילוץ ליבות שלא תלויות בבקשה. העטיפות הקיימות קוראות להן.
- 9 כלים עם `createTool`: `inputSchema` שהוא enum בלבד, ו-`outputSchema` של מספרים בלבד.
- הרחבת כלל ה-dependency-cruiser.

*אימות:*
- בדיקת יחידה לכל ליבה;
- בדיקה שהעטיפה והליבה מחזירות אותו מספר;
- השוואה ידנית מול דפי `/admin`;
- בדיקה שאין אף שדה טקסט בתוצאה.

**שלב 6: תהליך הסוכן.**
- התקנה מוצמדת של `@mastra/memory` ו-`@mastra/pg`, באישור.
- `PostgresStore` עם `schemaName`, ו-`init` אחד באישור. אחר כך `disableInit: true`.
- `Agent` עם:
  - `model: 'anthropic/claude-sonnet-4-6'`;
  - `tools` דינמי לפי `requestContext`;
  - `outputProcessors: [RegexFilterProcessor]`;
  - memory מוגבל.
- צרכן pg-boss, בדיקה חוזרת של השער, `generate`, פיצול ל-4096 תווים, `sendWhatsAppText` מהמספר שקיבל את ההודעה, audit.
- `MASTRA_TELEMETRY_DISABLED=true`, רשומת pm2 ושורה ב-`deploy`.

*אימות:*
- בדיקות עם `llm-mock`: אין `generate` לשולח לא מורשה או כשהמתג כבוי. כלי שאינו בהרשאה לא מוצע. redaction של טלפון ישראלי בתשובה.
- `node --check` ובדיקת bundle.
- `pm2 logs` בלי תוכן ובלי טלפונים.

**שלב 7: עלייה לאוויר.** המתג נדלק, רק לבעלים.

*אימות:*
- 5 שאלות אמיתיות, שהתשובות שלהן מושוות לדפי הניהול;
- שורות audit תקינות;
- הודעה ממספר לא מורשה: אין תשובה, אין שורת קליטה ואין שורת audit. היא ממשיכה במסלול של היום.

**שלב 8: שמירה (retention).**
- job יומי שמוחק שורות `owner_agent_intake` ישנות מ-7 ימים (האינדקס `received_at` קיים במיגרציה);
- מחיקת הודעות Mastra מעבר ל-N ימים.

*אימות:* בדיקת יחידה, וספירת שורות לפני ואחרי.

---

## 9. החלטות פתוחות לבעלים

**כל שאלה נענית בכן או לא. ברירת המחדל המומלצת כתובה בסוגריים.**

1. ~~האם הסוכן יקבל מספר וואטסאפ משלו?~~ **נענתה, הבעלים, 2026-09-24:**
   - המספר **נבחר בממשק הניהול** מכל מספרי ה-WABA, כולל מספר שמשרת אורחים;
   - אין override ואין route נפרד;
   - ההסטה נעשית ב-`route.ts` לפי מספר נבחר + רשימת היתר (2.2–2.3).
2. ~~האם לאשר את קריאת ה-Graph של Meta (override)?~~ **הוסרה.** אין קריאת Graph.
3. **האם לאשר מפתח Anthropic API בתשלום** לסוכן, עם תקרה יומית של 50 הודעות? (כן, עם תקרה)
4. ~~האם רק הבעלים יכול לערוך את רשימת ההיתר?~~ **נענתה, הבעלים, 2026-09-24: כן.** עריכה רק עם `requirePlatformOwner`, בלי `manage_settings`.
5. **האם בגרסה הראשונה רק הבעלים עצמו מורשה?** (כן)
6. **כשהמתג כבוי, האם שולח מורשה לא מקבל שום תשובה?** (כן, שקט מוחלט)
7. **האם התשובות יכילו שמות של אירועים?** (לא)
8. **האם לשמור היסטוריית שיחה 14 יום, ואת טקסט השאלות בטבלת הקליטה 7 ימים?** (כן)
9. **האם להפעיל כבר בגרסה הראשונה את מסנני ה-AI של Mastra** (`PIIDetector` ו-`PromptInjectionDetector`)? כל אחד מהם הוא קריאת מודל נוספת. (לא. מסנן regex כן)
10. **האם ספירות מסירת וואטסאפ ובריאות webhooks יהיו תחת ההרשאה `view_webhooks`?** (כן)
11. **האם להשאיר את `whatsapp-claude-agent` רץ כמו שהוא, ולהחליט עליו רק אחרי שבועיים של הסוכן החדש?** (כן)
12. ~~האם לאשר את שלב ההגנה ב-`worker/main.ts`?~~ **לא רלוונטית יותר.** שורות מוסטות לא נכנסות ל-`webhook_inbox` (שלב 3 בוטל).
13. **delivery מעורבת** (אורח + איש צוות באותו POST): האם לשמור את המעטפה ב-`webhook_deliveries` כלשונה, כך שהנתונים של האורח נשארים זהים לגמרי, גם אם טקסט השאלה נכנס אליה? (כן. זה נדיר, והטבלה גלויה רק לצוות)
14. **האם להוסיף trigger ב-DB** שחוסם שינוי של `owner_agent_*` ב-`app_settings` למי שאינו בעלים? היום כל איש צוות יכול לשנות כל עמודה ב-`app_settings` (5ה). (לא ב-v1. ההרשאה בפועל, רשימת ההיתר, כבר מוגבלת לבעלים)
15. **האם לקבל שטלפון ברשימת ההיתר מוסט תמיד לסוכן על המספר הנבחר,** גם כשבעליו אורח באירוע? אז הוא לא יוכל לאשר הגעה בוואטסאפ על המספר הזה, רק דרך הקישור או מספר אחר. (כן)
