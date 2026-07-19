# דוח סופי — מחקר תיעוד Voximplant עבור KALFA

> **הערת מיקום (systemic)**: היעד המיועד היה `<scratchpad>/vox-research/FINAL-voximplant-docs-research.md`, אך plan mode פעיל בסשן ומתיר כתיבה רק לקובץ ה-plan הזה (אותה סטייה שפגעה בכל 26 קבצי ה-notes ו-4 ה-digests). יש להעתיק קובץ זה — יחד עם 28 קבצי ה-plan של הפליט — אל `<scratchpad>/vox-research/` בסשן ללא plan mode. ה-base path בהוראת המשימה היה literal `undefined` (באג תבנית של ה-orchestrator).
>
> **מקורות**: כל התוכן מבוסס אך ורק על 4 ה-digests של עמודי-התווך ועל קבצי ה-notes של 28 קבוצות המחקר (נשלפו מ-`voximplant.com/api/v2/getDoc` ב-2026-07-19). אין עובדות מומצאות; פערים מסומנים במפורש.

---

## 1. תקציר מנהלים

**מה נחקר**: סריקה שיטתית של כל עץ התיעוד הרשמי של Voximplant — קורפוס של ~2,147 עמודים (ground truth של ה-critic) — בארבעה עמודי-תווך: platform-guides (מדריכים, 15 קבוצות), voxengine-ref (רפרנס VoxEngine מלא, 6 קבוצות), management-api (HTTP Management API, 2 קבוצות), kit-sdk (מוצר Kit + Client SDKs, 5 קבוצות). סה"כ 28 קבוצות מחקר, ~878 עמודים נקראו לעומק מלא והשאר בכיסוי מבני (inventory) מכוון — למעט חור אחד מהותי של 138 עמודי רפרנס voxengine שלא שויכו לאף קבוצה (ראו פרק 4).

**המסקנות המרכזיות**:

1. **הארכיטקטורה הקיימת של KALFA מאוששת כדפוס הקנוני**: StartScenarios על rule בלי pattern + `script_custom_data` מינימלי + ctx fetch + cb דיווח + ניתוק על `PlaybackFinished` — זהו בדיוק המבנה שהתיעוד עצמו מדגים (getting-started, ChatGPT tutorial, 2FA, call tracking, Ultravox SIP).
2. **CallList הוא התשובה הפלטפורמית לחיוג קמפיינים** — וההמלצה המפורשת של הדוקס (מגבלות סשן: 50 ניסיונות שיחה / 10 progressing). הוא גם עוקף לחלוטין את תקרת 200 הבתים: כל שורת CSV נושאת `custom_data` פר-אורח ומגיעה ל-scenario דרך `VoxEngine.customData()`. גוצ'ה קריטית: תרחיש שמסתיים בלי `reportResult`/`reportError` נספר כהצלחה שקטה בלי retry.
3. **תקרת ~200 בתים של `script_custom_data` אינה מתועדת בשום מקום** (ממצא אמפירי של KALFA בלבד; יש אף סתירה פנימית בדוקס — עמוד אחד טוען 2000 תווים). היא כלל-פלטפורמית (זהה ב-customData של כל Client SDK). שלושה עוקפים נטיביים: KeyValueStorage/ApplicationStorage (value ≤ 2000 תווים, TTL 90 יום), POST אל `media_session_access_secure_url` (מרים `AppEvents.HttpRequest` בסשן חי), ו-CallList per-row custom_data.
4. **אין AMD (זיהוי משיבון) לישראל** — מודלים רק ל-BR/CL/CO/ES/EU_GENERAL/KZ/MX/PE/PH/RU/US; `AI.detectVoicemail` רק ru/colombia. חלופות: beep detection מבוסס-תדרים, DTMF ("הקש 1"), `handleMicStatus`, זיהוי שיחתי ב-LLM. חובה A/B אמפירי לפני הסתמכות לחיוב.
5. **ElevenLabs הוא first-class בשלושה מסלולים** (קול ב-VoiceList; RealtimeTTSPlayer עם BYO `xi-api-key`; AgentsClient מלא עם ClientToolCall) — אבל תמיכת עברית אינה מתועדת אצל Voximplant וטעונה אימות מול ElevenLabs עצמם.
6. **שדרוג הגשר ל-Groq קיים כ-first-class**: `OpenAI.ChatCompletionsAPIClient` עם `baseUrl` הוא התחליף המתועד ל-fetch הידני (text-only, streaming, function-calls) — בלי לגעת במסלול האודיו; מפתחות עוברים ל-`VoxEngine.getSecretValue` / Secrets API (סוגר את הגשת המפתח דרך ctx ואת רוטציית המפתח שדלף).
7. **Voximplant Kit אינו מומלץ ל-KALFA**: מוצר/חשבון נפרד; אימוץ = מיגרציה מלאה של ה-agent העברי, ועברית היא נקודת החולשה שלו (אין AMD עברי, אין region ישראלי, TTS עברי = Microsoft Avri/Hila בלבד, ElevenLabs ב-Kit בלי עברית). dialer 2.0 שלו בנוי ממילא על call list של ה-Platform. ערכו העיקרי: תבניות reference ל-DNC, retries ו-completion codes.
8. **רקונסיליאציית חיוב per-reached**: לשמור `call_session_history_id` מ-StartScenarios → batch `GetCallHistory` (≤1000 IDs) → `CallInfoType.successful` + duration + cost הם אמת החיוב; לוגי session פגים אחרי **חודש** — ההתמדה של KALFA היא המקור היחיד לטווח ארוך.
9. **תפעול וכסף**: היתרה ($2.88) מתחת להתראת ברירת המחדל ($5) ומסוכן מול שער ה-$1 של call lists; יעדים > $0.20/דקה חסומים כברירת מחדל; מספר +972 = KYC + מנוי חודשי; `MinBalanceCallback` מתחבר ישירות ל-Slack alerting הקיים; `getMediaResources?with_jsservers` = ה-allowlist ל-IONOS firewall.
10. **עברית**: SSML מאושש ככושל (שגיאה 400) — הניקוד נשאר; הכוונון המתועד: `request` passthrough (Google `audioConfig`). קולות he-IL: 38 של Google (מהם 30 Chirp3-HD) + Microsoft Hila/Avri + YandexV3 Naomi. ASR עברי: Google בפרופיל **`iw_IL`** (קוד legacy!) עם מודל `phone_call`, או Microsoft `he_IL`; **Deepgram פסול לעברית לגמרי**.

---

## 2. עמודי התווך

### 2.1 platform-guides (מדריכים; ~149 עמודים, 15 קבוצות)

**מפת קטגוריות**: getting-started (23) · guides-calls (12) · guides-conferences (5) · guides-contact-center (9) · guides-speech (10) · guides-media-streams (3) · guides-sms (4) · guides-voxengine (13) · guides-sdk (11) · guides-management-api (7) · guides-integrations (10) · guides-solutions (9, כולל call lists בעומק מלא) · guides-troubleshooting (8) · voice-ai-a (13) · voice-ai-b (12).

**יכולות מרכזיות**:
- מודל הפלטפורמה: application ← rules ← scenarios; כל שיחה = session serverless (ES2022 על SpiderMonkey); ל-outbound דרך StartScenarios לא נדרש rule pattern.
- Call lists בעומק מלא: חוזה CSV (delimiter `;`, עמודות קסומות `__start/__end_execution_time` ב-UTC+0, `call_schedule`, `task_priority`, `next_attempt_time`), חוזה scenario (`reportResult`/`reportError`/`reportProgress`/`requestNextAttempt`), ניהול מ-Management API.
- Speech: TTS קלאסי + realtime (Google/ElevenLabs/Cartesia/Inworld/xAI), ASR עם `phraseHints` (Google בלבד), Silero VAD + Pipecat TurnDetector (אגנוסטיים לשפה), IVR DTMF, External-ASR escape hatch דרך WebSocket.
- Media Streams: פרוטוקול ה-WS הרשמי ל-BYO ASR/LLM/TTS; ה-backend יכול להתחבר ב-wss לסשן רץ דרך ה-media URL (https→wss) — אפס בתים מתקציב ה-customData; `clearMediaBuffer()` = פרימיטיב ה-barge-in.
- Voice AI: Bring-your-own-LLM מתועד עם דוגמה מלאה; `baseUrl` על מחברי OpenAI לכל backend תואם-OpenAI; ElevenLabs Agents, Deepgram Voice Agent (think=groq + speak=eleven_labs — ה-stack המדויק של KALFA כאורקסטרציה מנוהלת), Gemini/Vertex, Ultravox, Grok (ה-reference היחיד ל-outbound + voxengine-ci).
- ChatGPT tutorial = דפוס ה-BYO-LLM הקנוני, מבנית זהה לגשר Groq של KALFA (כולל `addMarker(-300)` + `PlaybackMarkerReached` לניהול תורות).
- Remote sessions: POST ל-`media_session_access_url` מרים `AppEvents.HttpRequest` בסשן חי — ערוץ push/kill מתועד.
- WhatsApp Business Calling: `callWhatsappUser` יוצא (מותנה בהרשאת שיחה פר-משתמש) — ערוץ עתידי ללא PSTN.

**מגבלות עיקריות**: המעטפת הקשיחה של סשן — HTTP 3 פעילות / 35 סה"כ, תשובה ≤ 2MB, event handler ≤ 1 שנייה, בדיוק בקשת HTTP אחת ב-`Terminating` (עודף נזרק בשקט), 10 media players, 50 ניסיונות שיחה / 10 progressing, 100 טיימרים, זיכרון 16MB. AMD לא לישראל; early media ≤ 60s; לוגי session נשמרים חודש; call lists נעצרות מתחת ל-$1; יעדים > $0.20/דקה חסומים; Voice AI docs עוברים ל-**docs.voximplant.ai** — לבדוק שם לפני קיבוע החלטות.

### 2.2 voxengine-ref (רפרנס VoxEngine; 6 קבוצות, 715 עמודים בהיקף)

**מפת קטגוריות**: vox-ref-core (69 — root, AppEvents, CallEvents, ASR/Player/Recorder/WebSocket events, VoxEngine namespace, Net, ApplicationStorage, Crypto, Logger, PhoneNumber) · vox-ref-callflow (92 — CallList, AMD, IVR, VoiceList, ASRModelList/ASRProfileList, ACD/SmartQueue/Conference events) · vox-ref-ai-core (70 — AI/detectVoicemail, OpenAI GA+Beta+ChatCompletions+Responses, Gemini, Grok, CCAI) · vox-ref-ai-providers (55 — Cartesia, Deepgram, ElevenLabs, Google, Inworld, Pipecat, Silero, Ultravox) · vox-ref-voximplantapi (295, כיסוי מבני 40) · vox-ref-avatar (134, כיסוי מבני 40).

**יכולות מרכזיות**:
- ליבה: `customData()` (200 בתים — ה-cap המתועד היחיד, ב-VoxEngine namespace), `getSecretValue`, `getLocalTime` (כי `new Date()` תמיד UTC), `PhoneNumber.getInfo` (ולידציית E.164 + MOBILE/FIXED_LINE), `levenshtein_distance` (פאזי-מאצ'ינג כן/לא/אולי בעברית), Crypto (hmac_sha256 לחתימת cb).
- CallEvents: `Failed` עם קודים (486 busy / 408 no-answer / 404 / 402 funds / 603 rejected), `Disconnected` נושא **cost + duration** — מיפוי ישיר לחיוב per-reached; `RtpStopped` תוך 7 שניות = שומר dead-air.
- קולות עברית (התמונה הסגורה): Google 38 (30 Chirp3-HD + 4 Wavenet + 4 Standard), Microsoft AvriNeural/HilaNeural, YandexV3 naomi. ElevenLabs = ספק VoiceList נטיבי (20 קולות, שינוי שורה אחת ב-`call.say`). אין SSML בשום משטח; `TTSOptions.request` = מנוף הכוונון. TTS cache: שבועיים, keyed-by-URL, חוצה-אפליקציות.
- ASR עברי: Google `iw_IL` + מודל `phone_call` (מודלי `_enhanced` יקרים יותר); Microsoft `he_IL`; Yandex he_IL; **Deepgram — אפס עברית** (כל 27 המודלים).
- מחברי LLM: צורה אחידה (`await createXxxClient` → media unit peer → `clearMediaBuffer` ל-barge-in; `privacy:true` חובה בפרודקשן, `trace:true` אסור — מעלה תעבורת WS בטקסט גלוי ל-S3). ChatCompletionsAPIClient text-only עם baseUrl; `storeContext:true` מסכם עם gpt-4o כברירת מחדל גם מול ספק אחר (להגדיר `summaryModel` מפורשות).
- VoximplantAPI (wrapper פנימי): **אין StartScenarios** (רק startConference) — ההפעלה מה-backend היא הדרך היחידה ומאושררת; `getCallHistory` עם `callSessionHistoryCustomData` = מסלול רקונסיליאציה; PSTNBlacklist = נכנסות בלבד (לא DNC יוצא).
- Avatar: בוט NLU מובנה; customData דו-כיווני שלא כפוף ל-200 בתים; אבל NLU מוטה-RU (ישויות DaData) ואיכות עברית לא מאומתת — כנראה חלש מגישת ה-LLM הנוכחית.

**גוצ'ות ליבה**: `terminate()` דורש `return;` אחריו; `Disconnected` לא מסיים את סשן ה-JS; `stopPlayback` מדכא `PlaybackFinished` (ה-fallback מבוסס-duration לניתוק נשאר הכרחי); ElevenLabs RealtimeTTSPlayer — `PlaybackFinished` רק אחרי `append()`; CallList בלי דיווח = הצלחה שקטה; `WebSocketMediaEnded` = שנייה של שקט; `wss://` דומיין בלבד; Net timeouts 6s/90s הקטנה-בלבד; `say()` ≤ 1500 תווים; handler שאינו פונקציה מפיל את התרחיש.

### 2.3 management-api (HTTP Management API; 296 עמודים בהיקף, 2 קבוצות)

**מפת קטגוריות** (עיקרי): Structure+Errors (199 structs + 458 קודי שגיאה) · Accounts (15, ניטור יתרה + ~40 סוגי callbacks) · RoleSystem (16, service accounts + JWT) · Secrets (5) · KeyValueStorage (5) · Scenarios+StartScenarios (8) · Rules (5) · **CallLists (12)** · History (11, רקונסיליאציה) · PhoneNumbers (15) · CallerIDs (2) · OutboundTestNumbers (5) · SMS (5) · SmartQueue/ACD (35, לא רלוונטי) · AuthorizedIPs (4) · ועוד (PSTNBlacklist, Invoices, RecordStorages, RegulationAddress...).

**יכולות מרכזיות**:
- Auth: service-account JWT (RS256, `kid`=key_id, `exp ≤ iat+3600`); `CreateKey` עם roles מינימליים (Developer + Call list manager); `bind_key_id` קושר מפתח ל-rule יחיד; AuthorizedIPs לנעיצת IP.
- StartScenarios: מחזיר `call_session_history_id` (מפתח ה-join לחיוב) + `media_session_access_secure_url` (ערוץ דחיפה mid-call); **מקס' 200 בקשות מקביליות → HTTP 429**; ההמלצה הרשמית — POST עם body (לא URL).
- CallLists: `CreateCallList` (rule_id, priority, max_simultaneous, `num_attempts` ≤ 5, interval_seconds, CSV ב-body), `AppendToCallList` (אורחים מאוחרים, batch_id חדש), `GetCallListDetails(output=json)` (סטטוס פר-task: New/In progress/Processed/Error/Canceled + result_data), `EditCallListTask`, `CancelCallListTask` (≤1000), `StopCallListProcessing`/`RecoverCallList` (pause/resume קמפיין). **יתרה חייבת ≥ $1**.
- History: `GetCallHistory` בסינון `call_session_history_id` (≤1000 IDs) או `call_session_history_custom_data`; `finish_reason` כולל 'Insufficient funds'; `CallInfoType.successful`+duration+cost+end_reason; ייצוא bulk async (gzip); `GetAuditLog` (Owner) ל-auditability; `DeleteRecord` למחיקות פרטיות.
- ניטור: `GetAccountInfo(return_live_balance)` + `SetAccountInfo(callback_url)` + `MinBalanceCallback` (אימות MD5-salt).
- OutboundTestNumbers: מספר בדיקה אישי מאומת (+972 של המפתח) לבדיקות outbound בחינם.

**מגבלות עיקריות**: rate limits (340 RATE_LIMIT_EXCEED, 515 SAME_OPERATION_LIMIT) מחייבים backoff — גם ב-stuck-call reconciler; JWT 456 TOKEN_EXPIRED מחייב re-mint; תקרת 200 הבתים **לא מתועדת בשום מקום ב-API**; `log_file_url` חודש בלבד; דוחות async פגים (`store_until`); CallerID מאומת פג (`verified_until`, האימות עצמו כנראה Control-Panel בלבד); PSTN blacklist inbound-only — DNC יוצא נשאר באחריות KALFA.

### 2.4 kit-sdk (Voximplant Kit + Client SDKs; ~1,057 עמודים בהיקף, 5 קבוצות)

**מפת קטגוריות**: Kit REST API (149 בקשות ב-33 תיקיות: dialer 2.0, agentCampaigns/PDS, callbacks, DNC, CTI, bot-service, reports...) · Web SDK v5/legacy (434) · Mobile SDKs Android v2/v3 + iOS v2/v3 (308) · React Native + Flutter (166).

**יכולות מרכזיות**:
- Kit = מוצר contact-center נפרד (חשבון/hosts/tokens/billing נפרדים; regions: us/br/eu/kz/ru — אין Israel). dialer 2.0 automated נותן out-of-the-box: `max_lines` (pacing), `dialing_strategy` פר-מספר, `working_time`, רוטציית עד 500 Caller IDs, DNC first-class, `appendContacts` ≤ 5000/בקשה עם משתנים שרירותיים (בלי תקרת 200 בתים) — ומתחת למכסה זה call list של ה-Platform (`vox_call_list_id`).
- Completion codes: **רק `Call_Answered` = Successful** — מיפוי ישיר ל-billing per-reached; callbacks `new_calls`/`call_finalized` דוחפים per-attempt עלות/משך/record_url בלי polling.
- מודל retry מוכח: max_attempts + interval + `addAttempts` סלקטיבי + `callback_at` — תבנית לשיקוף בטבלאות KALFA.
- Client SDKs: כולם app-endpoints — לא במסלול הקריטי; אין בהם TTS/LLM/CallList. שימוש מיידי שווה: **Web SDK v5 כ-QA harness** לשיחת he-IL בלי עלות PSTN. תקרת 200 בתים ל-customData אושרה בכל SDK (אותו צינור CallAlerting) — כלל-פלטפורמית.

**מגבלות עיקריות**: עברית = החולשה של Kit (אין AMD עברי, אין region ישראלי, TTS עברי = Microsoft Avri/Hila בלבד; ElevenLabs בקטלוג Kit ל~30 שפות אך לא לעברית); אבטחת webhooks חלשה — `md5(salt+domain+type)` ולא HMAC, ≤5 endpoints, 3 retries × 5 דקות; auth = API token סטטי (אין JWT); rate limits של campaign API לא מתועדים; `search` קמפיינים דורש `type:["automated"]` מפורש; agentCampaigns (PDS) ו-cti/makeCall לא רלוונטיים (מניחים agents אנושיים / Kit user).

---

## 3. ממצאים קריטיים ל-KALFA

### 3.1 Call Lists — המנגנון המלא וההתאמה לקמפיינים

**המנגנון**:
- יצירה: `CreateCallList` עם `rule_id` (ה-rule של תרחיש ה-outbound), CSV ב-POST body — כל שורה = אורח = task. שדות שליטה: `priority` (0=הגבוה), `max_simultaneous` (pacing), `num_attempts` (≤5), `interval_seconds`, `task_priority_strategy` (first_attempts|repeated_attempts).
- עמודות CSV "קסומות" פר-שורה: `__start_execution_time`/`__end_execution_time` (חלון קריאה יומי, **UTC+0** — ישראל UTC+2/+3 כולל DST, להמיר לפני כתיבת ה-CSV), `__start_at` (UNIX ts), `__task_uuid`, `call_schedule` (JSON פר-יום-בשבוע), `task_priority`, `next_attempt_time` (ISO 8601, לא בעבר, ≤9 חודשים; ערך שגוי נופל בשקט ל-request+interval).
- חוזה ה-scenario: `AppEvents.Started` פר שורה; `JSON.parse(VoxEngine.customData())` מקבל את **כל שורת ה-CSV** — עוקף לחלוטין את תקרת 200 הבתים. דיווח: `reportResult(Async)` (הצלחה; האובייקט נשמר ב-`result_data`; עוצר retries), `reportError(Async)` (כשל; מפעיל retry), `reportProgress(Async)`, `requestNextAttempt(Async)` (עריכת task בזמן ריצה: `custom_data`, `attempts_left`, `start_at`, חלונות, `next_attempt_time`).
- ניהול מה-backend: `AppendToCallList` (אורחים מאוחרים — פותר ברמת החיוג את בעיית ה-late-added guests), `EditCallListTask`, `CancelCallListTask` (אורח ענה בינתיים ב-WhatsApp), `StopCallListProcessing`/`RecoverCallList` (pause/resume קמפיין), `GetCallListDetails(output=json)` (סטטוס + result_data פר-אורח — דשבורד בעלים בלי state צד-KALFA לכל ניסיון).

**ההתאמה ל-KALFA**:
- זו ההמלצה המפורשת של הדוקס ל-outbound רחב (בגלל מגבלות סשן: 50 ניסיונות / 10 progressing) — תחליף פוטנציאלי מלא ל-pacing מבוסס pg-boss.
- `requestNextAttempt` עם `next_attempt_time` = פתרון מתועד ל-`schedule_callback` ("תתקשרו מחר") — החלטת מוצר פתוחה בעיצוב השיחה.
- `result_data` = ארטיפקט audit לחיוב per-reached; `__start/__end_execution_time` = אכיפת שעות חיוג חוקיות בישראל.
- **שלוש גוצ'ות מחייבות**: (א) תרחיש שיוצא בלי לדווח = הצלחה שקטה בלי retry — חובה `reportResult`/`reportError` בכל מסלול יציאה (busy/no-answer/crash/timeout); (ב) הרשימה נעצרת כשהיתרה < $1 (עם $2.88 נוכחיים — גבול מסוכן); (ג) כל חלונות הזמן ב-UTC+0.
- "ManageQueue" לא קיים בשום מקום בעץ הדוקס; משפחת הניהול היא `references.httpapi.calllists`.

### 3.2 מודול ה-AI ב-VoxEngine

- **AMD (`Modules.AMD`)**: `AMD.create({model, thresholds, timeout ≤ 20000ms})` → `DetectionComplete` עם HUMAN|VOICEMAIL|TIMEOUT|CALL_ENDED + subtype MIMIC (משיבון-AI). **אין מודל ישראל/עברית** (BR/CL/CO/ES/EU_GENERAL/KZ/MX/PE/PH/RU/US); EU_GENERAL הוא הקרוב ביותר; `confidence` מוצהר כלא-מובטח. `AI.detectVoicemail` — רק ru/colombia, תיעוד לא עקבי. **מסקנה**: אין להסתמך לזיהוי-משיבון לחיוב בלי A/B אמפירי על משיבונים ישראליים; חלופות — beep detection (`enableBeepDetection`, מבוסס תדרים, לא מוגבל-מדינה), DTMF דרך `Modules.IVR`, `handleMicStatus`, זיהוי שיחתי בגשר ה-LLM. קריטריון ה-reached של PDS ("ענה ואין הודעת תא קולי אחרי המענה") מוכן לאימוץ.
- **מחברי LLM** (`Modules.OpenAI`/`Gemini`/`Grok`): צורה אחידה — `await create*Client` → media unit → אירועים; `privacy:true` חובה, `trace:true` אסור. OpenAI GA RealtimeAPIClient (gpt-realtime, `type: REALTIME|TRANSCRIPTION`, server-VAD, מצב 3rd-party-TTS עם `output_modalities:['text']`); **ChatCompletionsAPIClient + baseUrl = מסלול ה-BYO-LLM ממדרגה ראשונה** (ראו 3.3); ResponsesAPIClient; Gemini Live (backend Vertex AI = זווית data-residency; מודל ברירת מחדל ניסיוני — להצמיד); Grok VoiceAgent (ה-repo `grok-voice-agent-example` = ה-reference היחיד ל-outbound voice agent עם voxengine-ci).
- **מחברי ספקי קול** (`Modules.ElevenLabs`/`Deepgram`/`Ultravox`/`Inworld`/`Cartesia`): voice-agent clients מלאים (הספק מריץ ASR+LLM+TTS) לצד RealtimeTTSPlayers; פרוטוקול-הספק ב-passthrough גולמי.
- **Silero VAD + Pipecat TurnDetector**: יחידות WS זולות בתוך התרחיש — `Silero.createVAD` (speechStartAt/speechEndAt) ו-`Pipecat.createTurnDetector` (`predict()` → endOfTurn+probability) — פותרות barge-in ו-end-of-turn עברי טבעי בלי silence timeouts קבועים; אגנוסטיות לשפה.

### 3.3 Voice AI / BYO-LLM מול הגשר הקיים (Groq)

**שדרוג מיידי בלי לגעת במסלול האודיו**:
- `OpenAI.ChatCompletionsAPIClient({baseUrl: <Groq OpenAI-compatible endpoint>})` — text-only, streaming `ContentDelta`, streaming של function-call arguments (`FunctionToolCallArgumentsDelta/Done` — ממופה ל-save_rsvp/mark_dnc/notify_owner), שגיאות מנוהלות. תאימות Groq לא מוצהרת מפורשות — **לאמת חי**. זהירות: `storeContext:true` מסכם עם gpt-4o כברירת מחדל — להגדיר `summaryModel` מפורשות.
- מפתחות: `VoxEngine.getSecretValue` + Secrets API = הבית הנטיבי למפתח Groq (ובעתיד ElevenLabs) — סוגר את הגשת המפתח דרך ctx endpoint ואת רמדיאציית מפתח ה-Groq שדלף (רוטציה בפאנל בלי redeploy).
- ה-envelope שהגשר חי בתוכו: HTTP 3/35, תשובה ≤2MB, handler ≤1s (ה-LLM חייב להישאר מחוץ ל-VoxEngine), 10 media players — להעדיף realtime player אחד לשיחה.

**ElevenLabs — שלוש רמות אימוץ**:
1. קול בלבד: ElevenLabs ב-VoiceList — שינוי שורה אחת ב-`call.say()`; איכות עברית לא מתועדת — חובה בדיקה.
2. Streaming TTS: `ElevenLabs.createRealtimeTTSPlayer` (voice_id, model_id כמו eleven_flash_v2_5, BYO `xi-api-key`, `append(text)` מוזן מטוקני Groq); גוצ'ה: `PlaybackFinished` רק אחרי `append()` — ה-fallback מבוסס-duration נשאר.
3. Agent מלא: `ElevenLabs.AgentsClient({agentId, xiApiKey})` — ה-agent (prompt/קול/LLM) בדשבורד ElevenLabs; פרסונליזציה פר-אורח דרך `conversationInitiationClientData` (כולל `language:'he'` ו-first_message מ-ctx; מחייב הפעלת overrides); `ClientToolCall` → הכלים של KALFA; `UserTranscript`/`AgentResponse` = ראיות תמלול ל-cb. **חובה 16kHz PCM בצד ה-agent**. תמיכת עברית — לאימות מול ElevenLabs.

**חלופות נוספות**: Deepgram VoiceAgentClient הוא היחיד שמריץ את ה-stack המדויק של KALFA כאורקסטרציה מנוהלת (think.provider=groq + speak.provider=eleven_labs; היחיד עם accessToken קצר-מועד) — אבל ל-Deepgram אין ASR עברי; OpenAI gpt-realtime = מסלול speech-to-speech מלא עתידי; Media Streams WebSocket = מסלול full-duplex ל-backend (מלכודות: PCM8 ברירת מחדל, buffer שליחה 10s, WS נכנסים ≤ שיחות+3). דפוס ניתוק-ביוזמת-LLM (מ-Yandex): כלי hangup → פרידה → `call.hangup()` מושהה. `Modules.MCP` = מסלול עתידי לחשוף כלים במקום חוזי ctx/cb ייעודיים.

### 3.4 Kit API — מה נותן מעבר לפלטפורמה

- **מה נותן**: dialer 2.0 automated = כל שכבת הקמפיינים שמעל CallList כמוצר מנוהל (pacing, dialing_strategy פר-מספר, working_time עם timezone, רוטציית Caller IDs, DNC first-class, appendContacts בלי תקרת בתים, דוחות + callbacks push per-attempt עם completion_code/עלות/הקלטה). `completion_code=Call_Answered` כקוד הצלחה יחיד = מיפוי ישיר ל-billing per-reached.
- **מה המחיר**: מוצר/חשבון/billing נפרדים; ה-scenario הוא Kit-flow ולא VoxEngine — **מיגרציה מלאה של ה-agent העברי, לא add-on**; ה-ctx/cb bridge לא עובר כמו שהוא.
- **למה לא עכשיו**: עברית היא החולשה — אין AMD עברי, אין region ישראלי, TTS עברי = Microsoft Avri/Hila בלבד, ElevenLabs ב-Kit בלי עברית; webhooks ב-md5 (לא HMAC); rate limits לא מתועדים. הגישה הקיימת (Platform + Google he-IL + ניקוד) מקדימה את מה ש-Kit מציע לעברית.
- **מה כן לקחת**: תבניות ה-DNC (רשימות + קישור פר-קמפיין + `Restricted_By_DNC` + `cancelContacts` כ-opt-out אמצע-קמפיין) ומודל ה-retry (`max_attempts`/`interval`/`addAttempts`/`callback_at`) — סכימות מוכחות לשיקוף בטבלאות KALFA ולשער ה-DNC המשפטי.
- Client SDKs: לא במסלול הקריטי; Web SDK v5 שווה אימוץ כ-QA harness (חיוג לתרחיש he-IL מהדפדפן בלי עלות PSTN).

### 3.5 המלצות אינטגרציה קונקרטיות

1. **אימוץ CallList לקמפיינים** (מחליף/משלים את pg-boss pacing): CSV פר-אורח עם `custom_data` מלא (סוגר את מגבלת 200 הבתים ואת Branch A/B), `reportResult`/`reportError` בכל מסלול יציאה, `requestNextAttempt` ל-schedule_callback, `AppendToCallList` לאורחים מאוחרים, חלונות UTC מומרים מ-Asia/Jerusalem.
2. **client.ts**: מפתח `CreateKey` ייעודי עם roles מינימליים (Developer + Call list manager) + `bind_key_id` ל-rule היחיד; טיפול ב-456 TOKEN_EXPIRED (re-mint) ו-backoff על 340/515/429; AuthorizedIPs לנעיצת IP של IONOS; throttle מתחת ל-200 StartScenarios מקביליות.
3. **מפתח Groq → Secrets** (`getSecretValue`), לא דרך ctx — כולל רוטציית המפתח שדלף; חתימת cb עם `Crypto.hmac_sha256`.
4. **התמדת `call_session_history_id` + `media_session_access_secure_url`** מכל StartScenarios: הראשון לרקונסיליאציית חיוב (batch GetCallHistory, `successful`+cost+duration; לתפוס `finish_reason='Insufficient funds'`), השני כ-kill/push channel ל-stuck-call reconciler ולעדכוני mid-call.
5. **ניטור יתרה**: `GetAccountInfo(return_live_balance)` + `MinBalanceCallback` → Slack ops-alerting הקיים; טעינה + auto top-up (טיקט support) כתנאי מקדים לקמפיינים ($2.88 < $5 alert < גבול ה-$1 של call lists); לוודא תעריפי IL מול חסימת $0.20/דקה.
6. **שדרוג הגשר**: ניסוי חי של ChatCompletionsAPIClient + baseUrl מול Groq; Silero VAD + Pipecat ל-barge-in/turn-taking; `getLocalTime('Asia/Jerusalem')` לחלונות; `PhoneNumber.getInfo` לולידציית +972 לפני חיוג בתשלום.
7. **ElevenLabs**: להתחיל מרמה 1 (VoiceList swap) כ-A/B מול he_IL_Chirp3_HD; במקביל לאמת עברית מול ElevenLabs עצמם לפני רמות 2–3.
8. **"reached" לחיוב**: לא להסתמך על AMD (אין IL); שילוב `Connected/Disconnected` + beep detection + DTMF fallback ("הקש 1") + זיהוי שיחתי; קריטריון PDS כבסיס.
9. **פרטיות**: להפעיל Secure storage for recordings and logs; `privacy:true` בכל client; לעולם לא `trace:true`; אין `Logger.write` של PII; הקלטות stereo ל-S3 בשליטת KALFA; `DeleteRecord` למחיקות פרטיות; `GetAuditLog` ל-audit אדמין.
10. **תשתית**: `getMediaResources?with_jsservers` → IONOS firewall allowlist (לרענן תקופתית); OutboundTestNumbers ל-QA +972 בחינם; Web SDK v5 כ-QA harness; לוגי session — לייצא בתוך 30 יום.
11. **לא לאמץ עכשיו**: Kit (מיגרציה + עברית חלשה), Avatar (NLU מוטה-RU), SmartQueue/PDS (agents אנושיים), Deepgram כ-ASR (אין עברית), SMS של Voximplant (ExtrA עדיפה), MeasurementProtocol (UA מת).

---

## 4. פערים ומגבלות המחקר

**פסיקת ה-completeness critic: coverageOk = false**. הפערים, לפי חומרה:

1. **138 עמודי references/voxengine לא שויכו לאף קבוצה** (הפער המהותי היחיד; אומת אריתמטית: 727 בעץ מול 589 שכוסו ב-6 הקבוצות). כולל את **עמוד ה-Call class עצמו** + 12 ממשקי Call*Parameters, ASR class + 5 ממשקיו, Player/Recorder(+15)/Conference(+4)/WebSocket(+6)/SmartQueue(+6)/StreamingAgent/Endpoint, כל ממשקי פרמטרי TTS/URL/Sequence/ToneScript players, RichContent (9), ה-namespaces yandex (6) ו-xai (4), Dialogflow enums, וכל הפונקציות הגלובליות (require, getLocalTime, setTimeout, uuidgen, base64/hex utils, levenshtein_distance — תוכנן מוכר מעמודים אחרים אך עמודיהם לא נשלפו). ה-digest של voxengine-ref טוען בטעות כיסוי מלא של העץ. **רמדיאציה**: סוכן המשך שישלוף את 138 העמודים (הרשימה נגזרת מ-references_voxengine.txt פחות שש רשימות המלאי) ויעדכן את ה-digest.
2. **מיקום ה-deliverables (סיסטמי, לא תוכני)**: 24 מ-26 קבצי notes + כל 4 ה-digests + הדוח הזה נכתבו לקובצי plan תחת `/var/www/vhosts/kalfa.me/.claude/plans/` בגלל plan mode פעיל בכל הפליט; רק vox-ref-avatar.md ו-sdk-cross.md יושבים ב-`<scratchpad>/vox-research/`. כל הקבצים אומתו כקיימים ומהותיים; **חוב פתוח: העתקה מרוכזת ל-`<scratchpad>/vox-research/`**.
3. **אובדני קוד verbatim**: ה-getDoc API מגיש code fences ריקים בחלק מהעמודים — Dialogflow ES scenarios קטועים, iOS push/CallKit ו-Android push snippets חסרים, snippets של contact-center סוכמו ולא צוטטו, דוגמאות ה-quickstart של getting-started ריקות ב-API.
4. **Avatar בעומק מבני בלבד** (94/134 עמודים enumerated-only), כולל כל רשימות ה-ASRProfileList/voices של ה-vendors — **קיום פרופיל ASR עברי לבנדל ה-Avatar לא אומת** (שאלה שהוגדרה כמוקד), וגם ה-endpoints של Avatar API Conversation לא נלכדו במלואם.
5. **iOS SDK v3**: רק 4 עמודי stub — הרפרנס האמיתי ב-DocC bundles מחוץ למניפסט של getTree ולא נשלף כלל; שמות selectors של iOS v2 הוסקו ולא נלכדו verbatim.
6. **זוטות**: שני עמודי landing (/docs/guides root, /docs/references root) לא שויכו; changelog של Web SDK legacy 4.x לא חולץ, v5 רק עד 5.2.0; changelogs של RN/Flutter ריקים בצד הפלטפורמה.

**שאלות פתוחות שאינן ניתנות להכרעה מהתיעוד (דורשות אימות אמפירי/ספק)**:
- תאימות `baseUrl` → Groq + סמנטיקת `storeContext` המדויקת.
- תמיכת עברית: ElevenLabs (voices/flash_v2_5/Agents ASR), Kit TTS מול מערכת חיה, Google RealtimeTTSPlayer he-IL, gpt-realtime/Gemini/Grok בעברית, Pipecat turn-detection בעברית.
- התנהגות AMD (EU_GENERAL) ו-beep detection על משיבונים ישראליים אמיתיים; בקשת AMD-IL מול support.
- תקרת 200 הבתים — לא מתועדת בשום מקום (וסתירה פנימית 200/2000 בדוקס); rate limits של Kit campaign API.
- תעריפי IL בפועל מול חסימת $0.20/דקה; עלות מספר +972 ולוחות זמני KYC.
- אימות CallerID (Add/Verify) לא קיים ב-HTTP API — כנראה Control-Panel בלבד.

---

## 5. נספח: מלאי כיסוי

Σ בהיקף: 2,229 שורות-עמוד ב-28 קבוצות (ground truth של ה-critic: 2,147 עמודים ייחודיים; הדלתא = עמודי folder/root וחפיפות מניפסט). Σ נקראו לעומק: 878; השאר כיסוי מבני מכוון (enumerated + עמודי parent), למעט פער 1 בפרק 4.

| קבוצה | pagesRead / pagesTotal | קובץ notes |
|---|---|---|
| getting-started | 23/23 | vox-research/getting-started.md |
| guides-calls | 12/12 | vox-research/guides-calls.md |
| guides-conferences | 5/5 | vox-research/guides-conferences.md |
| guides-contact-center | 9/9 | vox-research/guides-contact-center.md |
| guides-speech | 10/10 | vox-research/guides-speech.md |
| guides-media-streams | 3/3 | vox-research/guides-media-streams.md |
| guides-sms | 4/4 | vox-research/guides-sms.md |
| guides-voxengine | 13/13 | vox-research/guides-voxengine.md |
| guides-sdk | 11/11 | vox-research/guides-sdk.md |
| guides-management-api | 7/7 | vox-research/guides-management-api.md |
| guides-integrations | 10/10 | vox-research/guides-integrations.md |
| guides-solutions | 9/9 | vox-research/guides-solutions.md |
| guides-troubleshooting | 8/8 | vox-research/guides-troubleshooting.md |
| voice-ai-a | 13/13 | vox-research/voice-ai-a.md |
| voice-ai-b | 12/12 | vox-research/voice-ai-b.md |
| vox-ref-core | 69/69 | vox-research/vox-ref-core.md |
| vox-ref-callflow | 92/92 | vox-research/vox-ref-callflow.md |
| vox-ref-ai-core | 70/70 | vox-research/vox-ref-ai-core.md |
| vox-ref-ai-providers | 55/55 | vox-research/vox-ref-ai-providers.md |
| vox-ref-voximplantapi | 40/295 (structural) | vox-research/vox-ref-voximplantapi.md |
| vox-ref-avatar | 40/134 (structural) | vox-research/vox-ref-avatar.md |
| httpapi-platform | 27/221 (structural) | vox-research/httpapi-platform.md |
| httpapi-calling | 75/75 | vox-research/httpapi-calling.md |
| kit-api-structure | 149/149 | vox-research/kit-api-structure.md |
| kit-api-anchored | 12/12 | vox-research/kit-api-anchored.md |
| sdk-web | 33/434 (structural) | vox-research/sdk-web.md |
| sdk-mobile | 39/308 (structural) | vox-research/sdk-mobile.md |
| sdk-cross | 28/166 (structural) | vox-research/sdk-cross.md |

**קבצי ה-digests** (מקורות הדוח, נתיבים מלאים):
- platform-guides: `/var/www/vhosts/kalfa.me/.claude/vox-research/digest-platform-guides.md`
- voxengine-ref: `/var/www/vhosts/kalfa.me/.claude/vox-research/digest-voxengine-ref.md`
- management-api: `/var/www/vhosts/kalfa.me/.claude/vox-research/digest-management-api.md`
- kit-sdk: `/var/www/vhosts/kalfa.me/.claude/vox-research/digest-kit-sdk.md`

נתיבי `plans/` בטבלה = `/var/www/vhosts/kalfa.me/.claude/plans/`; `scratchpad/` = `/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/269356ba-ade0-4bc0-981a-f198fee3744f/scratchpad/`. dump מלא של 458 קודי השגיאה: `<scratchpad-parent>/tool-results/be6tugb9p.txt` (ר' digest management-api).

---

## 6. נספח־השלמה: סגירת פער 138 העמודים (בוצע לאחר ה־critic)

הפער המהותי היחיד (פרק 4, סעיף 1) **נסגר**: הרשימה האריתמטית המדויקת — **143 עמודים** (`vox-manifests/voxengine-orphans.txt`) — נשלפה ותועדה בשני קבצים:

- `vox-research/vox-ref-gap-a.md` (72/72) — מחלקות Call/ASR/Player/Recorder/Conference/WebSocket/StreamingAgent/SequencePlayer/Endpoint/SmartQueueTask/IVRState/ACDRequest/Voice + ממשקי הפרמטרים שלהן + yandex/xai
- `vox-research/vox-ref-gap-b.md` (71/71) — RichContent, ממשקי TTS/URL/Sequence/ToneScript players, פונקציות גלובליות, וכל ה־enums

**תיקון מחלץ תוך כדי**: התגלה שחברי מחלקות (methods/props) יושבים ב־`children` בתוך ה־JSON של עמוד המחלקה ולא הודפסו ע"י `extract.js`; המחלץ תוקן והקורפוס נשלף מחדש (עמוד Call לבדו: 0.1KB → 18KB). שיור מתועד: עמודי class בתחומי הקבוצות המקוריות (למשל `DialogflowInstance`, `AnsweringMachineDetector`, `RealtimeAPIClient`) כוסו ע"י הסוכנים במעברי raw-JSON ידניים ולא דרך המחלץ — התוכן קיים ב־notes אך לא באחידות מלאה.

**ממצאי מפתח מההשלמה**:
1. `Call.customData()` מוגבל 200 בתים גם ברמת אובייקט ה־Call (לא רק ב־script_custom_data).
2. `Call.say()` נכשל בקול רם (לא בשקט) מעל 1,500 תווים; כל שולחי המדיה (say/startPlayback/ring/sendMediaTo) חולקים סלוט stream יחיד — שכבוב מחליף בשקט, לא נערם בתור.
3. `ASRParameters.singleUtterance` ברירת מחדל **false** — לשיחת תורות כמו RSVP כנראה נדרש `true`; לבדוק מול התרחיש החי. `phraseHints`/`speechContexts` — Google בלבד.
4. `Call.record({stereo:true})` מתועד כמפריד אורח/בוט לערוצי L/R (מודול Recorder מתעלם מ־stereo) — מסלול מוכן להקלטות QA מופרדות־ערוץ; ברירת שמירה 3 חודשים, לבחון `secure` + PII.
5. `CallEnableBeepDetectionParameters` (frequencies[], timeout) הוא מנגנון נפרד מ־AMD — ה־beep לזיהוי טון משיבון, AMD לסיווג אדם/מכונה.
6. `CallSayParameters.voice` ברירת מחדל Amazon en_US_Joanna — קול עברי חייב להיות מפורש תמיד.
7. `Yandex.RealtimeAPIClient` = wrapper נטיבי מלא בסגנון OpenAI-Realtime (conversation items, VAD turns, DTMF, ואף MCP tools) — ראיה שהפלטפורמה מציעה נטיבית את דפוס גשר ה־Branch B.
8. `VoxEngine.callWhatsappUser()` + `CallWhatsappUserParameters` — שיחת **קול** על גבי WhatsApp כ־API ממדרגה ראשונה (מסלול עוקף־PSTN עתידי).
9. `IVRState`/`IVRSettings` — מנגנון "הקש 1/2" מוכן כ־fallback כש־ASR עברי נכשל שוב ושוב (משרת את יעד ה־anti-hangup).

**סטטוס כיסוי סופי: כל 2,147 עמודי העץ + אוסף Kit (149 בקשות) מכוסים** — עומק מלא או מבני־מכוון, ללא עמוד לא־משויך. coverageOk המעודכן: **true** (בכפוף לשיורים המתועדים בפרק 4, סעיפים 3–6).
