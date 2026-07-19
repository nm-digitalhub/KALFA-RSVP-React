# Digest מאוחד — Pillar: kit-sdk (Voximplant Kit API + Client SDKs)

> הערת מיקום: היעד המקורי היה `<scratchpad>/vox-research/digest-kit-sdk.md`, אך plan mode פעיל בסשן זה ומתיר כתיבה רק לקובץ ה-plan. יש להעתיק קובץ זה ליעד לאחר היציאה מ-plan mode.
>
> ה-digest הזה מחליף את קריאת חמשת קבצי המחקר הגולמיים (kit-api-structure, kit-api-anchored, sdk-web, sdk-mobile, sdk-cross). מקורות: Postman collection של Kit API (149 בקשות), ומניפסטים של Web SDK v5/legacy (434 עמודים), Mobile SDKs (308), React Native + Flutter (166).

---

## מפת הפילר — קטגוריות

הפילר מכסה שני עולמות נפרדים לחלוטין:

1. **Voximplant Kit** — מוצר contact-center נפרד (no-code) מה-Platform ש-KALFA משתמשת בו כיום (Management API + VoxEngine). חשבון נפרד, hosts נפרדים, tokens נפרדים, billing נפרד.
   - Kit REST API: 149 בקשות ב-33 תיקיות — dialers (dialer 1.0 legacy, dialer 2.0, agentCampaigns/PDS), callbacks (webhooks), DNC, CTI, bot-service (WhatsApp), ניהול (numbers, SIP, queues, agents, reports, media, tags/topics).
2. **Client SDKs של ה-Platform** — ספריות צד-לקוח שהופכות אפליקציה/דפדפן ל-endpoint של Voximplant (user שמתחבר ומבצע/מקבל שיחות שמסתיימות ב-VoxEngine scenario):
   - Web SDK: legacy 4.x + v5 (הדור הנוכחי, 5.2.0 מיולי 2026).
   - Mobile: Android SDK v2 + v3 (rewrite), iOS SDK v2 + v3 (DocC חיצוני).
   - Cross-platform: React Native SDK (`react-native-voximplant`), Flutter SDK (`flutter_voximplant`).

אף אחד מה-Client SDKs לא מסוגל להתחיל שיחות PSTN בצד שרת — שיחת app יוצאת עדיין נוחתת ב-VoxEngine scenario דרך CallAlerting.

---

## Voximplant Kit API — מוסכמות כלל-מערכתיות

- **פורמט**: כל method הוא `POST` (למעט 2 GET helpers), body בפורמט `application/x-www-form-urlencoded` (העלאות קבצים: multipart). תשובות JSON `{success, result}`; רשימות מוסיפות `_meta {totalCount, pageCount, currentPage, perPage}` (Yii-style).
- **Auth**: API token סטטי שנוצר ב-Kit UI (Administration > Security > API tokens), נשלח כ-`access_token` + פרמטר `domain` (שם החשבון) בכל קריאה. אין JWT/OAuth.
- **Hosts** (3): `kitapi-<region>.voximplant.com` (ה-API הראשי), messaging-host נפרד (bot-service), `kit-cti-<region>.voximplant.com` (CTI). Regions: us, br, eu, kz, ru, ru2 — **אין Israel** (הקרוב: eu).
- **גרסאות API מעורבבות per-method**: v2 (legacy), v3 (הרוב), v4 (history/messaging).
- **Completion codes** (השדה `completion_code` ב-callbacks ובדוחות): **רק `Call_Answered` נחשב Successful**. כישלונות: `AMD` (משיבון), `No_Answer` (408), `Call_Busy` (486), `Invalid_Number` (404), `Insufficient_Funds` (402), `Call_Was_Rejected` (603), `Restricted_By_DNC`, `Abandoned` (לקוח ענה, אין agent), `Lost_By_Agent`, `Missed_By_Scenario`, `No_Agents`, `Temporary_Unavailable` (480), `Request_Terminated` (487), `Call_Prohibited` (403), `System_Error`, `Other_Error`.
- **שגיאות**: 402 = יתרה לא מספיקה, 403 = הרשאה/פיצ'ר כבוי ("Contact center not enabled"), 404 = ישות לא קיימת, 422 = validation או מעבר status לא חוקי.
- **קטלוג התיקיות** (33): account, agentCampaigns (12), agentStatus, bot-service, callback (4+16 events), callerid, calls (bindTags/bindTopics), campaigns-dialer 2.0 (14), cc, cti, dnc (4), helper, history, ip, media, messaging, outbound (7, dialer 1.0 legacy — לא להשתמש), phone, queues, realtime-metrics, report (9, מנוע דוחות async: export → getReportStatus → downloadReport), scenario (כולל `runScenario` — האנלוג של StartScenarios), sipNumber, sipTrunk, sipWhitelist, skills, tags, topics/topicSets, user, usergroup, whatsappHsmTemplates, wrapUpCodes, bulkMessaging (12, קמפייני WhatsApp עם אותו lifecycle כמו dialer 2.0).

---

## Kit: campaigns — dialer 2.0 (קמפיינים אוטומטיים — הרלוונטי ל-KALFA)

הדור הנוכחי (`/api/v3/campaigns/*`), מחליף את `outbound` legacy. מטפל בשני סוגים: **automated** (מונחה scenario, בלי agents — האנלוג של השיחות של KALFA) ו-**operator/agent** (יורש agentCampaigns).

### create (קמפיין אוטומטי)
פרמטרים עיקריים: `title` (עד 40 תווים), `scenario_id` (Kit scenario — flow של Kit, לא VoxEngine), `max_lines` (1–3000 קווים במקביל = pacing), `max_attempts` (עד 140, ברירת מחדל 10), `dialing_strategy` (JSON per phone-type: סדר phone1/phone2, attempts, intervals, `dial_up_time_sec`), `working_time` (ברירת מחדל 24/7), `region` (usa|europe|south_america|singapore|russia|kazakhstan — אין Israel), `phone_numbers` (rotation של Caller IDs, **מקס' 500**; אסור לערבב sip_numbers עם השאר), `dnc_list_ids`, `timezone`, `task_priority_strategy` (first_attempts|repeated_attempts), `supervisors`, `planned_date_start/end`.

**תשובה חושפת `vox_call_list_id`** — dialer 2.0 בנוי מתחת למכסה על **call list של ה-Platform**; קמפיין רץ חושף `call_list_session_id` (UUID).

### Lifecycle
draft → (`schedule`|`start`) scheduled/ongoing → `pause`/`resume` → `stop` (completed) + חזרה ל-draft. 402 על start ללא יתרה; 422 על מעבר status לא חוקי ("Can not update status from X to Y").

### אנשי קשר
- `appendContacts`: **מקס' 5000 שורות/בקשה**; מפתחות `phone1` (+phone2…), `timezone`, `task_priority` אופציונלי; E.164; משתנים שרירותיים per-contact (אין תקרת 200 bytes!). תשובה: success/failed/invalid_phones/invalid_tz.
- `searchContacts`: statuses `sent|ongoing|paused|cancelled|success|failed|duplicated` (+error); כל contact עם `task_uuid`, `attempts_count`, `variables[]`.
- `cancelContact`: **מקס' 100 ids/בקשה**; `cancelLists` מבטל רשימות שלמות.
- `editCallListTasksPriority`: שינוי עדיפות לפי `task_uuid` (1–250000) תוך כדי ריצה.
- `search` (קמפיינים): **חובה להעביר `type: ["automated"]`** — ברירת המחדל היא ["operator"] ולא תראה קמפיינים אוטומטיים.
- `searchLists`: מצב עיבוד imports (`invalid_phone`, `invalid_timezone`), `tz_autodetection`, ספירות success/failed/canceled.

---

## Kit: agentCampaigns (PDS — dialer מבוסס agents אנושיים)

12 methods ב-`/api/v3/agentCampaigns/*` — קמפיינים predictive/progressive שמחברים שיחות שנענו ל-**agents אנושיים**. ה-anchor שנחקר (35cddb0a…) הוא ה-folder עצמו. **לא רלוונטי לשיחות AI של KALFA** (מניח contact center מאויש), אבל מודל reference טוב.

- **createCampaign** (~40 פרמטרים): בחירת מספר מחייג (phone_number_id | caller_id | sip_number_id | pool מסתובב עד 100 מספרים; עד 500 phones/קמפיין), `max_attempts` **1–5** בלבד, `interval` בדקות, `working_time` **בזמן המקומי של הלקוח** לפי שדה `UTC` חובה per-contact, שני מצבים: `predictive` (עם `abandonment_rate` 1–100, ברירת מחדל 3) או `progressive` (עם `task_multiplier` 1.0–25.0), voicemail detection (ראו מגבלות), הקלטה + notification (media/TTS), `dnc_lists`, `wrap_up_codes_set_id` + `wrap_up_dnc_list_id`.
- קמפיין נולד ב-`draft` ויוצר אוטומטית queue; **launch gates**: יתרה (402), agents ב-queue, מספר מחייג פעיל, Contact Center מופעל.
- `setCampaignStatus` (ongoing|paused|completed), `setListStatus` per-list (ongoing|paused|canceled); קמפיין completed הוא **immutable**; מחיקה רק ל-draft/completed/scheduled.
- `appendContacts`: מקס' 5000 שורות, `phone`+`UTC` חובה, **כל השורות בבקשה חייבות סט שדות זהה**; עמודות נוספות הופכות ל-`custom_data` per-contact (round-trip מלא). קובץ contacts ב-create: עד **20 MiB** (multipart).
- שליטה ברמת contact: `searchContacts` (status, `current_attempt`, `callback_at`, custom_data), `cancelContacts` (opt-out אמצע-קמפיין + comment/cancel_all), `addAttempts` (הוספת ניסיונות חוזרים עם interval/max_attempts חדשים בלי re-import).
- דיווח: `searchCampaigns` עם בלוק `stat` מוטמע (`call_item_count/ended/success/failed/canceled`, `cost`, `success_calls_duration`); `searchCampaignLists` — ולידציית import + cost per-list; `getStat` — ספירת קמפיינים לפי status.
- מטריצת 403 לפי role (Agent/Manager/Supervisor; Supervisor דורש queue-editor permission); ~30 ולידציות 422 מתועדות.

---

## Kit: callbacks (webhooks), cti, bot-service, DNC

### callback
- מנוי = `{name, url, salt, callbacks[], is_enabled}`; **מקס' 5 endpoints לחשבון**; Kit שולח JSON POST עם `hash = md5(salt + domainName + callbackType)` — **לא HMAC**; **3 retries במרווחי 5 דקות**.
- 16 סוגי אירועים: scenario_created/updated/deleted, caller_id_changed, numbers_changed, profile_email_updated, **`new_calls`** (ניסיון חיוג נספר — כולל `completion_code`, `call_cost`, `duration`, `record_url`, `session_id`, `attempt_num`, `call_data` = המשתנים של ה-contact), call_assigned_to_agent, wrap_up_code_set, finished_call, **`call_finalized`** (אחרי after-service — payload מלא + completion_code + log_path), ו-5 אירועי chat (chat_started/assigned/closed/unassigned/transfer).
- `new_calls`/`call_finalized` = דיווח push per-attempt של עלות/משך/הקלטה — אין צורך ב-polling.

### cti (host נפרד)
- `makeCall` — click-to-call **בשם user/agent של Kit** (`user_id` חובה — לא שמיש לשיחות אוטומטיות לגמרי); `makeTransfer` — blind|attended אל sip|pstn|extension.

### bot-service (messaging-host)
- `sendTemplateMessage` — פתיחת שיחת WhatsApp יוצאת עם HSM template מאושר (`channel_id`, `message_template_id`, משתני header/body/button; **rate limit 10 rps**) → `conversation_uuid`; `sendMessage` — הודעת bot לשיחה קיימת.

### dnc
- CRUD מלא לרשימות DNC + קישור per-campaign (`dnc_list_ids`, `wrap_up_dnc_list_id`) + completion code ‏`Restricted_By_DNC` — DNC הוא אובייקט first-class בכל שכבות Kit.

---

## Web SDK (v5 + legacy 4.x)

SDKs דפדפניים שהופכים דף web ל-endpoint (WebSocket/WebRTC אל הענן; השיחה מסתיימת ב-scenario).

### v5 (הדור הנוכחי, 5.2.0 — יולי 2026)
- **ארכיטקטורה מודולרית**: `Core.init()` + `registerModules([CallLoader, StreamLoader, …])` (tree-shaking); promise-based; error classes typed; state ריאקטיבי דרך `Watchable`/`ReadonlyWatchable` (strict-equality).
- **Client**: `connect/disconnect`, login ב-password / access token / one-time key → `LoginResult`; אירוע client יחיד (`Disconnected`); **`LoginMauAccessDeniedError`** — logins נספרים למכסת **Monthly Active Users** (מימד billing ייחודי ל-client SDKs).
- **Call**: start/answer/reject/hangup/hold/mute/sendDTMF/sendInfo/sendMessage (SIP INFO)/streams/screen sharing. **Gotcha**: resolve של `start()`/`answer()` ≠ מחובר — לחכות ל-`CallEvent.Connected`.
- חדש ב-5.2.0: מודול **PushService** (push לשיחה נכנסת גם כשה-tab סגור), שדרוג audio→video (CallUpgrade), ConnectionNode.NODE_13.
- **NoiseSuppression**: שני מודולים (Aggressive = CPU גבוה, desktop בלבד; Balanced = מתון, לא מומלץ למובייל) — שניהם כוללים echo cancellation + AGC. עיבוד mic בצד לקוח בלבד (לא רלוונטי ל-TTS).
- **Stream module** מחליף את Hardware legacy (StreamManager/RendererManager/DevicePermission/DeviceTrackerHelper). Gotcha ב-Firefox: סגירת popup הרשאות = דחייה זמנית.
- SmartQueue = ניהול status של agent בלבד (הלוגיקה בצד שרת); Messaging = אותו messenger cross-SDK.

### legacy 4.x
- Singleton (`VoxImplant.getInstance()`), event-driven (`Events.AuthResult` במקום promises). `Config.node` חובה; `progressToneCountry` תומך רק RU/US (אין IL).
- מיפוי ישיר ל-scenario: `ProgressToneStart` ↔ `Call.ring()`, `ProgressToneStop` ↔ `answer()`/`startEarlyMedia()`; `sendTone` → ToneReceived; `sendInfo` → InfoReceived; `Failed` עם קודי SIP (486 busy, 487 terminated).
- קוד חדש צריך לטרגט **v5 בלבד**.

---

## Mobile SDKs (Android v2/v3, iOS v2/v3)

SDKs ל-VoIP in-app (endpoint באפליקציה). מבנה אחיד: call / client(core) / hardware / messaging.

- **Android v2**: `Voximplant.getClientInstance(executor, ctx, config)` → IClient; connect(Node) → login → AuthParams tokens; push דרך FCM/HMS. `ICall`: start/answer/reject(RejectMode)/hangup/hold/sendAudio/sendDTMF/sendInfo/sendMessage.
- **Android v3**: rewrite מודולרי שובר תאימות — `VICore.initialize` + `VICalls.initialize`, `callbackExecutor` לכל האירועים, enums חדשים (CallState/CallDirection/CallDisconnectReason), אירועים ששונו שם (`onStartRinging`/`onStopRinging`), consent flow לשדרוג audio→video, Conference כ-class נפרד, Jetpack Compose `VideoRenderer`, אינטגרציית Telecom Connection (API 31+).
- **iOS v2**: VIClient/VICall/VICallDelegate; PushKit VoIP + IM tokens נפרדים; `handlePushNotification` → UUID מול `VICall.callKitUUID`; `VIAudioManager` עם lifecycle חובה ל-CallKit (callKitConfigureAudioSession/StartAudio/StopAudio/ReleaseAudioSession). מגבלות מתועדות: אי אפשר Receiver עם wired headset או Bluetooth A2DP; בעיות ידועות עם AirPods auto-ear-detection.
- **iOS v3**: במניפסט רק 5 עמודי stub — ה-API האמיתי ב-DocC bundles חיצוניים (VoximplantCore/Calls/Messaging) שלא נסרקו.
- **מיפוי ל-scenario** (זהה בכל הפלטפורמות): `onCallRinging` ↔ `Call.ring()`, `onCallAudioStarted` ↔ `Call.answer()`/`startEarlyMedia()`; `CallSettings.customData` נקרא ב-scenario דרך `CallAlerting` (התאום של `script_custom_data`); extraHeaders חייבים prefix ‏`X-`.
- Gotchas רוחביים: `statsCollectionInterval` ברירת מחדל 5000ms, חייב כפולה של 500; hold לא נתמך בשיחות conference (CallError.INCORRECT_OPERATION).

---

## Cross-platform SDKs (React Native + Flutter)

שני SDKs client-side עם ליבת calling מלאה (login בכל השיטות, שיחות/conference, hold, DTMF ‏`sendTone`, SIP INFO ‏`sendInfo`, ‏`sendMessage` אל VoxEngine, CallKit helpers, VoIP push, ניהול audio/camera, IM מלא).

- **תקרת 200 bytes ל-`CallSettings.customData` בשני ה-SDKs** — מועבר לענן דרך CallAlerting או Call History API. **זהה לתקרת `script_custom_data`** — התקרה כלל-פלטפורמית ולא עוקפים אותה בהחלפת נקודת כניסה. גם ל-extraHeaders תקרת 200 bytes נפרדת.
- סמנטיקת promises מתועדת: resolve של `call()` = השיחה הגיעה לענן בלבד; חיבור = אירוע `Connected` (עיכוב אפשרי 2–3 שניות אחרי אודיו ראשון); rejection = שגיאת app, אירוע `Failed` = שגיאת telecom.
- **Quality issues** אחיד: PacketLoss, HighMediaLatency (rtt+jitter), NoAudioSignal (mic), NoAudioReceive/NoVideoReceive, **IceDisconnected (CRITICAL — אין media)**, CodecMismatch, LocalVideoDegradation; רמות NONE…CRITICAL. RN דרך QualitySubscriber events, Flutter דרך `qualityIssuesStream`.
- **הבדלי API**: RN = emitter ‏`on(EventTypes.X)` + Promise rejections; Flutter = callback props + Dart Streams + ‏`VIException` עם קטלוגי שגיאות typed. **דלתות התנהגות**: duration בשניות (RN) מול מילישניות (Flutter); RN ‏`video` bool מול Flutter ‏`VIVideoFlags` כיווני (video כבוי כברירת מחדל); Flutter מחייב `VINode` מפורש ב-connect.
- `decline()` דוחה שיחה נכנסת **בכל המכשירים** של ה-user; `reject()` רק במכשיר הנוכחי.
- `receiveVideo()` הוא start-only (אין עצירה אמצע-שיחה מחוץ ל-conference). Hardware: אי אפשר Earpiece עם wired headset; Android ‏AudioFile מקומי חייב res/raw; ‏`releaseResources()` חובה גם אם לא נוגן.
- Changelogs ריקים ב-docs API לשני ה-SDKs (RN: כותרות גרסה בלבד 0.2.1–1.45.0) — היסטוריית releases רק ב-npm/pub.dev.

---

## מגבלות ו-gotchas — ריכוז

| תחום | מגבלה |
|---|---|
| Kit — עברית/ישראל | אין מודל AMD עברי (ru\|kz\|colombia\|br\|mx\|ph\|pe\|us\|cl בלבד); אין region ישראלי (הקרוב europe); TTS עברי בקטלוג Kit = **Microsoft Avri/Hila בלבד** — אין Google he-IL ואין ElevenLabs עברי (ElevenLabs מופיע ב~30 שפות אחרות) |
| Kit — קיבולות | appendContacts ≤5000 שורות (סט שדות אחיד); cancelContact ≤100 ids; קובץ contacts ≤20 MiB; Caller ID pool ≤100 (PDS)/500 (dialer 2.0) מספרים; title ≤40 (dialer 2.0)/255 (PDS); max_attempts ≤140 (dialer 2.0)/5 (PDS); webhook endpoints ≤5 |
| Kit — אבטחת webhooks | חתימה md5(salt+domain+type) — לא HMAC; 3 retries × 5 דקות |
| Kit — billing gates | 402 minimum-balance על create/launch/append |
| Kit — rate limits | לא מתועדים פרט ל-bot-service ‏sendTemplateMessage ‏(10 rps) |
| Kit — search קמפיינים | ברירת מחדל type=["operator"] — חובה ["automated"] |
| Client SDKs — payload | customData ≤200 bytes בכל SDK (וגם extraHeaders); עוקף: sendMessage/sendInfo בתוך שיחה (SIP INFO ↔ MessageReceived/InfoReceived) |
| Web SDK — billing | logins נספרים ל-MAU‏ (LoginMauAccessDeniedError) |
| Web SDK — legacy | progressToneCountry רק RU/US |
| כל ה-SDKs | connect/answer resolve ≠ Connected; statsInterval כפולת 500; hold אסור ב-conference |
| iOS v3 | הרפרנס האמיתי ב-DocC bundles חיצוניים — לא נסרק |

### פערי כיסוי (gaps מאוחדים)
- שלושה מסשני המחקר רצו ב-plan mode והנוטס שלהם נכתבו לקובצי plan במקום ל-`<scratchpad>/vox-research/` (kit-api-structure, kit-api-anchored, sdk-web, sdk-mobile) — יש להעתיק.
- קטלוג Kit: 27 מ-33 תיקיות תועדו בשורה-לבקשה בלבד (בלי params מלאים); rate limits של campaign API לא ידועים; enum ‏tts_language/tts_voice קטוע — **תמיכת עברית ב-Kit scenarios דורשת אימות מול Kit חי לפני החלטת אימוץ**.
- setListStatus/addAttempts/getStat ב-PDS ללא טבלאות שגיאות; שם שדה ה-multipart לקובץ contacts ב-createCampaign לא מתועד.
- STRUCTURAL depth: מאות עמודי leaf ‏(enums/interfaces/payloads) נמנו ולא נשלפו; changelogs חלקיים/ריקים.

---

## רלוונטיות ל-KALFA

### Kit כחלופה ל-CallList — הערכה מרכזית
1. **Kit הוא מוצר/חשבון נפרד** מה-Platform. אימוץ dialer 2.0 = **מיגרציה, לא add-on**: ה-agent העברי (VoxEngine + `call.say()` + Groq bridge) יצטרך להיבנות מחדש במערכת ה-scenarios של Kit. ה-ctx/cb bridge הקיים לא עובר כמו שהוא.
2. **dialer 2.0 automated מספק out-of-the-box את כל מה ש-KALFA שוקלת לבנות סביב CallList**: pacing ‏(`max_lines`), אסטרטגיית retries per-number ‏(`dialing_strategy`), חלונות `working_time`, רוטציית Caller IDs, אכיפת DNC, append תוך-כדי-ריצה (5000/בקשה) — **ובלי תקרת 200 bytes** (שורות contact נושאות משתנים שרירותיים). מתחת למכסה זה בעצם call list של ה-Platform ‏(`vox_call_list_id`).
3. **אבל עברית היא נקודת החולשה של Kit**: אין מודל AMD עברי, אין region ישראלי, TTS עברי = Microsoft Avri/Hila בלבד. הגישה הקיימת של KALFA ‏(Platform + Google he-IL + niqqud) מקדימה את מה ש-Kit מציע. איכות AMD ל-+972 לא מאומתת.
4. **ElevenLabs**: מופיע בקטלוג TTS של Kit לשפות רבות — **אך לא לעברית**. מסקנה להערכת ElevenLabs: עברית תדרוש אינטגרציה ישירה מול ElevenLabs, לא דרך Kit.

### Billing לפי reached contact
5. סמנטיקת `completion_code` — **`Call_Answered` הוא קוד ההצלחה היחיד** — ממופה ישירות למודל ה-billing של KALFA ("reached"). ה-callbacks ‏`new_calls`/`call_finalized` דוחפים per-attempt: עלות, משך, record_url, session_id — אין צורך ב-polling. ‏`stat` per-קמפיין ‏(call_success, cost, success_calls_duration) הוא בדיוק צורת ה-reconciliation שה-outcome-billing צריך.
6. שערי 402 minimum-balance על launch/append משקפים את בעיית היתרה ($2.88) שכבר במעקב — כל אימוץ Kit מחייב ניטור יתרה זהה.

### DNC ו-retries — תבניות לחיקוי
7. DNC first-class ‏(CRUD + ‏dnc_list_ids‏ + ‏wrap_up_dnc_list_id‏ + ‏Restricted_By_DNC) מתיישב עם שער ה-DNC המשפטי הישראלי (gate פתוח ב-voximplant-bridge plan) — תבנית טובה להעתקה, כולל `cancelContacts` כמנוף opt-out אמצע-קמפיין (mark_dnc).
8. מודל ה-retry של Kit ‏(per-contact ‏max_attempts + interval + ‏addAttempts סלקטיבי + שדה ‏callback_at) הוא סכימה מוכחת ש-KALFA יכולה לשקף בטבלאות הקמפיינים שלה ל-retries ול-schedule_callback.

### מה לא מתאים
9. **agentCampaigns (PDS) לא רלוונטי** — dialer ל-agents אנושיים; ל-KALFA אין agents. **cti/makeCall לא שמיש** — מחייב user של Kit כיוזם. **bot-service WhatsApp** חופף לאינטגרציית Meta הישירה הקיימת — אין סיבה להחליף; רלוונטי רק כ-fallback vendor.
10. **אבטחת webhooks של Kit חלשה** ‏(md5 salt, לא HMAC; 5 endpoints; 3×5-min retries) — אימוץ יחייב hardening עצמי בצד `/cb` ‏(IP allowlist, idempotency).

### Client SDKs — לא במסלול הקריטי
11. כל ארבע משפחות ה-Client SDKs ‏(Web/Android/iOS/RN/Flutter) הן endpoints של אפליקציה — **לא נדרשות** לזרימת KALFA (שרת → StartScenarios → VoxEngine → PSTN). אין בהן TTS/STT/LLM/CallList — הערכות CallList/ElevenLabs/Kit לא מושפעות.
12. **שימוש קרוב שכן שווה**: Web SDK v5 כ-**QA harness** — endpoint דפדפני שמחייג ל-scenario מאפשר איטרציה על שיחת ה-he-IL בלי לחייג PSTN ל-+972 (רגלי SDK↔scenario זולות/חינם).
13. **אישוש מודל מנטלי**: אירועי ה-SDK ממופים 1:1 לפעולות scenario ‏(ringing ↔ ‏Call.ring, audioStarted ↔ ‏answer/startEarlyMedia) — שימושי לדיבוג תזמוני call-progress וטריגרי billing.
14. **תקרת 200 bytes היא כלל-פלטפורמית** ‏(customData בכל SDK = אותו צינור CallAlerting כמו script_custom_data) — עיצוב ה-payload הקומפקטי של Branch A/B אינו עקיף. הערוץ ל->200 bytes: ‏in-call ‏sendMessage/sendInfo ‏(SIP INFO).
15. עתידיים אפשריים: escalation אנושי/softphone לבעל אירוע = Web SDK v5 ‏(Core+Call+Stream, אופציונלית SmartQueue) או React Native (מתיישר עם ה-stack הקיים) / Android v3 + iOS v3; keypad-fallback RSVP ‏(הקש 1/2) = DTMF ↔ ToneReceived; MAU הוא מימד עלות נפרד אם אי פעם יישלחו browser logins. טקסונומיית ה-quality-issues ‏(IceDisconnected, NoAudioReceive…) = אוצר מילים שימושי להגדרת "reached" מול שיחה מתה-media במחלוקות billing.
