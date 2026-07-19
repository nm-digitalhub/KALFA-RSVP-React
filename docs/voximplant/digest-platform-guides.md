# Voximplant — Platform Guides: תקציר מאוחד (pillar: platform-guides)

> **מטא**: סינתזה של 15 קבוצות מחקר (~149 עמודי תיעוד, נאספו 2026-07-19 דרך `voximplant.com/api/v2/getDoc`). התקציר הזה מחליף את קריאת ה-notes הגולמיים.
> **מיקום**: היעד המקורי היה `<scratchpad>/vox-research/digest-platform-guides.md`, אך ה-session רץ ב-plan mode (כתיבה מותרת רק לקובץ ה-plan הזה). התוכן שלם; יש להעתיק לנתיב המיועד ב-session ללא plan mode. גם כל 15 קבצי ה-notes המקוריים יושבים בקבצי plan תחת `/var/www/vhosts/kalfa.me/.claude/plans/floofy-cooking-thompson-agent-*.md` מאותה סיבה.

---

## מפת הקטגוריות של ה-pillar

| קבוצה | עמודים | נושא |
|---|---|---|
| getting-started | 23 | מושגי יסוד: applications, scenarios, routing rules, numbers, sessions, Management API, billing, firewall |
| guides-calls | 12 | callPSTN/callUser/callSIP, customData, הקלטות, transfers, AMD/beep detection, DTMF |
| guides-conferences | 5 | Conference module, gateway PSTN→conference, הקלטת ועידה, viewer mode |
| guides-contact-center | 9 | SmartQueue (ACD v2), agents/skills, supervisors, reporting, PDS, ACD v1 |
| guides-speech | 10 | TTS (רגיל + realtime), ASR, VAD/turn detection, media players, IVR, external ASR |
| guides-media-streams | 3 | WebSocket audio transport + פורמט ה-wire המדויק (BYO ASR/LLM/TTS) |
| guides-sms | 4 | A2PSendSms, SendSmsMessage, ControlSms, IncomingSmsCallback |
| guides-voxengine | 13 | Runtime, limits, IDE, voxengine-ci, Net, KV storage, secrets, custom data, remote sessions, MCP |
| guides-sdk | 11 | Client SDKs (Web v5 / Android v3 / iOS), auth, push, CallKit — לא במסלול KALFA |
| guides-management-api | 7 | Control/Provisioning/Number API, JWT, callbacks/webhooks, secure objects, Billing API |
| guides-integrations | 10 | ChatGPT (BYO-LLM קנוני), Dialogflow CX/ES, S3, Dasha, Jitsi, VoiceIt, WhatsApp Calling |
| guides-solutions | 9 | **Call lists** (עומק מלא), editable call lists, masking, call tracking, 2FA, PBX |
| guides-troubleshooting | 8 | Logger.write, cloud debugger, softphone, mic status, לוגים כ-PII |
| voice-ai-a | 13 | Bring-your-own-LLM, OpenAI (Realtime/Responses/ChatCompletions), Gemini/Vertex, Ultravox |
| voice-ai-b | 12 | ElevenLabs Agents, Deepgram Voice Agent, Yandex, Cartesia, xAI Grok, Inworld |

---

## Getting started (מושגי יסוד + billing)

**יכולות עיקריות**
- מודל הפלטפורמה: **application** = מיכל (scenarios, users, routing rules, numbers, call lists, KV storage). כל שיחה = **session** נפרד; VoxEngine הוא runtime serverless אסינכרוני מלא (קריאת `say()` שנייה מחליפה מיד את הראשונה; רצף רק דרך אירועים כמו `PlaybackFinished`).
- **Routing rules**: הרצת scenario תמיד דורשת rule. ה-**Pattern** (regex על `e.destination`) חל רק על שיחות נכנסות, מוערך מלמעלה למטה — ההתאמה הראשונה מנצחת. ל-outbound דרך `StartScenarios` לא צריך pattern בכלל. כמה scenarios על אותו rule רצים ב-**context משותף אחד** (פונקציות/משתנים/מודולים משותפים, בלי import).
- **script_custom_data** הוא ערוץ הנתונים המתועד להרצה דרך Management API (בעמודי getting-started אין תיעוד לתקרת הגודל).
- **MediaUnit**: כל אובייקט עם stream (Call, Conference, ASR, Player, Recorder). Call שולח כמה streams אך **מקבל אחד בלבד בו-זמנית** (sendMediaTo חדש מחליף את הקודם); מיקסים דרך Conference.
- **Management API** דורש service account עם מפתח JSON ל-JWT; **roles** קובעות הרשאות — חשבון בלי role מקבל ~14 מתודות בסיסיות בלבד.
- **Firewall**: `api.voximplant.com/getMediaResources` — `with_jsservers` = כתובות המקור של בקשות HTTP **מתוך** scenarios; `with_nodes` = יעדי Management API; `with_sbcs` = SIP.
- **Billing**: יתרה prepaid אחת; היתרה יכולה לרדת **לשלילי** באמצע שיחה ואז השירותים נעצרים; התראת יתרה נמוכה ברירת מחדל **$5**; auto top-up קיים אך דורש טיקט support. מנוי מספר: setup חד-פעמי + דמי חודש הנשמרים ביום השנה, חיוב סופי ב-1 לחודש; כשל תשלום → השעיה חודש → שחרור המספר לפול הציבורי. חלק מהמדינות דורשות KYC/רכישה דרך support.

**מגבלות ו-gotchas**
- לוגי session נשמרים **חודש אחד בלבד** (TTL).
- מספרי בדיקה: חינם, 100 שיחות/יום, 3/דקה, **אסורים כ-caller ID**.
- מתג "Video conference" על rule: אם דולק — כל שיחות SDK על ה-rule מחויבות כוועידת וידאו (מלכודת עלות). להשאיר כבוי.
- IM/MAU subscription רלוונטי רק ל-messaging/SDK logins — לא לשיחות PSTN.

---

## Calls (עיבוד שיחות)

**יכולות עיקריות**
- Outbound: `VoxEngine.callPSTN(number, callerid)`. **Caller ID חוקי**: מספר Voximplant שכור אמיתי, או מספר חיצוני מאומת (שיחת אימות + קוד), או שימוש חוזר ב-CID נכנס (`followDiversion:true`). מספרי בדיקה — פסולים.
- אבחון כשל: `CallEvents.Failed` עם `e.code`; timeout חיוג עצמי דרך `setTimeout` + fallback; כל מתודות `call*` נופלות עם **408 אחרי 60 שניות** ללא מענה.
- **customData בשני מקומות נוספים** מעבר ל-script_custom_data: `VoxEngine.customData()` (session) ו-`call.customData()` (פר-Call, נגיש גם מ-SDK). *סתירה בתיעוד*: עמוד ה-features טוען עד 2000 תווים לכל אחד; עמוד custom-data (voxengine) קובע **200 בתים** — האימות החי של KALFA תומך ב-200; להתייחס ל-200 כאמת.
- **הקלטה**: `call.record(params)` לענן Voximplant או ל-S3-compatible משלך; פרמטרים: `expire` (3/6 חודשים, 1/2/3 שנים — מקס' 3 שנים), `hd_audio` (192kbps/48kHz מול ברירת מחדל 32kbps/8kHz), `lossless` (FLAC), `stereo`, `transcribe`. ה-URL מגיע ב-`CallEvents.RecordStarted` (`e.url`). שגיאות גישה: 401 auth / 403 קישור שבור / 404 נמחק / 416 range.
- Headers: `extraHeaders` על callPSTN/callUser/callSIP/answer; in-call messaging דרך `call.sendMessage`/`MessageReceived` ו-`sendInfo` (SIP INFO).
- **DTMF**: `CallEvents.ToneReceived` בצד ה-scenario — בסיס ל-fallback מקלדת.
- Blind transfer: `call.handleBlindTransfer(true)` שומר את הרגל השלישית באותו session (`BlindTransferRequested` → `notifyBlindTransferSuccess/Failed`); mode ישן יוצר session שני.
- SIP registrations (Voximplant כ-softphone מול ספק/PBX): יצירה בפאנל/API, outbound עם `regId`, סטטוסים מדווחים במייל + HTTP callback.
- `CallEvents.AudioQualityDetected` — HD/STANDARD פר שיחה.

**מגבלות ו-gotchas**
- **AMD (זיהוי תא קולי) רשמית רק ל: ברזיל, קולומביה, קזחסטן, מקסיקו, רוסיה** — ישראל דורשת פנייה ל-support. **Beep detection** (`call.enableBeepDetection({frequencies, timeout})` + `BeepDetectionComplete/Error`) מבוסס-תדרים ואינו מוגבל-מדינה.
- Early media (`startEarlyMedia`) מוגבל ל-**60 שניות**.
- יעדים יקרים מ-**$0.20/דקה** וכל השיחות לאפריקה **חסומים כברירת מחדל** (שחרור דרך support).
- SIP registration מחויב בדמי חודש **מיידית**, גם אם נמחק מיד; whitelist ל-PBX לפי **IP** בלבד (לא domain).

---

## Conferences (ועידות)

**יכולות עיקריות**
- `require(Modules.Conference)` + `VoxEngine.createConference({hd_audio:true})`; צירוף רגל קול: `sendMediaBetween(call, conf)`; וידאו: `conf.add({...})`.
- **חיוג החוצה לתוך ועידה**: `callPSTN(...)` → ב-`Connected` → `sendMediaBetween(conf, call)` — המתכון הקנוני ל"חייג N משתתפים".
- **פרימיטיב הכרזה**: `VoxEngine.createTTSPlayer(text).sendMediaTo(conf)` משמיע מקור אחד לכל המשתתפים.
- Gateway scenario ל-PSTN/SIP: `VoxEngine.callConference('confId', callerid, name)` + `easyProcess`; ה-pattern של ה-rule חייב להתאים למחרוזת ה-confId.
- מצב צפייה בלבד: Web SDK `joinAsViewer` (ללא שליחת מדיה) / `joinAsSharing`.
- הקלטת ועידה: `createRecorder` + `conf.sendMediaTo(recorder)`; layouts (grid/tribune/custom), פרופילים HD–4K, פלט תמיד MP4/H.264; `recorder.update()` בזמן אמת; ברירת retention: `RecordExpireTime.THREEMONTHS` (יותר = בתשלום).
- דפוס כיבוי אוטומטי: מונה משתתפים → אחרי אחרון + ~10s → `conf.stop()` → `Stopped` → `terminate()`.

**מגבלות ו-gotchas**
- קיבולת: 100 משתתפי קול; 50 וידאו (ריאלי 10–15 במכשירים נפוצים).
- וידאו דורש את מתג "video conference" על ה-rule (המתג עם מלכודת החיוב).
- וידאו מוקלט זמין רק אחרי עיבוד (~1/5 ממשך הוועידה).
- Auto-disable של איכות חל רק על וידאו — אודיו ו-screen-share לעולם לא מנוטרלים.

---

## Contact center (SmartQueue / PDS)

**יכולות עיקריות**
- **SmartQueue (ACD v2)** = queues + agents + scenario שמכניס משימות עם `VoxEngine.enqueueTask` (+`SmartQueueTaskParameters`: `extraHeaders` לצירוף נתונים ל-SDK של agent, `timeout` פר משימה). מכונת סטטוסים קבועה (אי אפשר לדלג על AfterService/Ready); עד 10 סטטוסי custom דרך `SQ_Set/Get/DeleteAgentCustomStatusMapping`.
- Skills: שם + רמה 1–5, עד 5 לכל agent, ניהול כולו ב-Management API (`SQ_AddSkill`, `SQ_BindSkill`...).
- **Supervisors**: האזנה שקטה / whispering / ועידה מלאה — הכול דרך Conference module (עובד גם בלי SmartQueue).
- Reporting: `GetSQState` (עכשיו), `GetSmartQueueRealtimeMetrics` (30 דק'), `GetSmartQueueDayHistory` (יומיים), `RequestSmartQueueHistory` (חצי שנה, CSV, עד שעה ליצירה). Voximplant עצמם ממליצים לשמור מדדים ב-backend שלך.
- Live dashboard: scenario כותב ל-KV storage (`ApplicationStorage.put`), חיצוני קורא `GetKeyValueItems` (billed, polling).
- **PDS**: חייגן predictive/progressive למרכזי שירות אנושיים; דורש SmartQueue + לקוח Go חיצוני. הגדרת "שיחה מוצלחת": **הלקוח ענה ואין הודעת תא קולי אחרי המענה** (+סינון voicemail ב-AI). ניהול buffer: ברירת מחדל 500 רשומות / threshold 250, גם דינמי לפי agents פעילים.
- ACD v1 legacy; מתעד את דפוס ה-callback queue דרך `StartScenarios` + `media_session_access_url` לשאילת מצב session רץ.

**מגבלות ו-gotchas**
- כל הסקשן מניח **agents אנושיים** — לא רלוונטי ל-flow ה-agentless של KALFA; PDS הוא הכלי הלא-נכון לקמפיינים של AI (CallList הוא הנכון).
- דוחות SmartQueue לא רואים שיחות `callPSTN` ישירות.

---

## Speech (TTS / ASR / VAD / IVR)

**יכולות עיקריות**
- **TTS קלאסי**: `createTTSPlayer` / `Call.say` עם `ttsOptions` (pitch/rate/volume) או **`request` passthrough** נטיבי לספק — Google `SynthesizeSpeechRequest` (`audioConfig.speakingRate/pitch/volumeGainDb`), ElevenLabs `{text, model_id, voice_settings}`, ועוד. קול ברירת מחדל: `VoiceList.Amazon.en_US_Joanna`.
- **SSML**: תמיכת תגים תלוית-ספק; תג לא נתמך → `PlaybackFinished` עם **שגיאה 400** — מאשש את הממצא החי של KALFA על Google he-IL. הכוונון המתועד ללא SSML: ה-`request` passthrough.
- **Realtime TTS** (מיועד במפורש לפלט LLM מקוטע): מודולים ל-Google (StreamingSynthesize), **ElevenLabs** (`createRealtimeTTSPlayer` עם `voice_id`, `model_id` כמו `eleven_flash_v2_5`, מפתח אישי דרך header `xi-api-key`, `sendText({text, flush})`), Cartesia, Inworld, xAI, VoxTTS (רוסית בלבד).
- **ASR**: `createASR({profile: ASRProfileList.*, phraseHints})`; אירועים `Result`(text, confidence)/`SpeechCaptured`/`InterimResult`. **Phrase hints — פרופילי Google בלבד** (מטים, לא מגבילים). `request` passthrough: `config.speech_contexts.phrases`, `single_utterance`, `interim_results`; Google beta מוסיף diarization, word timings, פיסוק אוטומטי.
- **תמלול שיחה**: `call.record({transcribe:true,...})` — לעולם לא בזמן אמת; שליפה רק דרך `GetCallHistory?with_records=true` → `transcription_url` (טקסט עם קידומות Left/Right).
- **VAD + Turn detection**: `Modules.Silero` (`await Silero.createVAD({threshold, minSilenceDurationMs, speechPadMs})`, אירוע `Result` עם `speechEndAt`) + `Modules.Pipecat` (`createTurnDetector({threshold})`, `predict()`, `TurnEvents.Result`) — הבחנה בין הפסקה באמצע משפט לסוף תור. שניהם אגנוסטיים לשפה.
- **Media players**: URL player תומך POST עם headers/body (כל HTTP TTS API, כולל OpenAI) + `progressivePlayback:true`; `SequencePlayer` לשרשור קטעים.
- **External ASR escape hatch**: `createWebSocket` + `call.sendMediaTo(ws, {encoding: ULAW,...})` — סטרימינג ל-backend שלך שמחזיר תמלולים (חריץ ל-Hebrew STT עצמאי, למשל Whisper/Groq).
- **IVR**: `Modules.IVR`, `IVRState` בסוגי noinput/select/inputfixed/inputunknown (+`terminateOn:'#'`, `inputValidator`, timeouts).

**מגבלות ו-gotchas**
- **מקסימום 10 media players לכל session** — agent רב-תורות שיוצר player לכל תשובה יתקע; לעדיף realtime player אחד.
- קולות custom דורשים הפעלה דרך support; `Silero.createVAD`/`createTurnDetector` הם async (await).
- זמינות he-IL בפועל (VoiceList/ASRProfileList) מתועדת ב-references — מחוץ ל-pillar הזה.

---

## Media Streams (WebSocket audio)

**יכולות עיקריות**
- הטרנספורט הרשמי ל-BYO ASR/LLM/TTS: scenario פותח WS יוצא (`VoxEngine.createWebSocket('wss://...')`) או מקבל נכנס (`allowWebSocketConnections()` + `AppEvents.WebSocket`). **ה-URL הנכנס = media URL מתשובת StartScenarios (או `accessSecureURL` ב-`AppEvents.Started`) עם https→wss** — ה-backend יכול להתחבר לסשן רץ בלי לצרוך אף בית מ-script_custom_data.
- פרוטוקול JSON: `StartEvent` (mediaFormat + tag + customParameters) → `MediaInfo` (base64, chunk/timestamp כמו RTP ב-uint64) → `StopEvent`; מפורט פורמלית גם ב-`github.com/voximplant/protobuf/websockets.proto`.
- שליחה אל Voximplant מותרת **מהר מהזמן האמיתי**: buffering ו-playback ב-20ms chunks; `webSocket.clearMediaBuffer()` קוטע playback שנצבר — **פרימיטיב ה-barge-in**.
- ריבוי streams במקביל דרך `tag` ייחודי; ניתוב ל-call/conference/recorder/WS אחר.

**מגבלות ו-gotchas**
- **ברירת מחדל encoding = PCM8** אם לא הוגדר — מלכודת איכות שקטה; להגדיר מפורשות (PCM16 16kHz לכיוון ASR, ULAW/ALAW 8kHz לכיוון הטלפוניה).
- **Buffer שליחה מוגבל ל-10 שניות — עודף נזרק**; cap חיבורי WS נכנסים = מספר השיחות בסשן + 3 (`NewWebSocketFailed` מעבר).
- `customParameters` מגיע **כמחרוזת JSON** (חובה parse); ה-codec קבוע במהלך stream (החלפה = Stop ואז Start חדש); chunks עלולים ללכת לאיבוד — אחריות PLC על המקבל.

---

## SMS

**יכולות עיקריות**
- SMS מנוהל ב-Management API (לא VoxEngine): **A2PSendSms** חד-כיווני (src_number = SenderID שדורש טיקט support; `dst_numbers` מרובי-יעדים ב-`;`; טקסט עד 1600; תשובה עם transaction_id פר יעד + מערך `failed[]`), **SendSmsMessage** דו-כיווני (עד 765), **ControlSms** להפעלה פר מספר, **IncomingSmsCallback** לקבלה (webhook + Security salt).

**מגבלות ו-gotchas**
- **מספרים וירטואליים לא תומכים SMS**; תמיכה תלוית אזור+קטגוריה — לבדוק `GetPhoneNumberRegions` עם `is_sms_supported=true` (הטקסט בדוקס מפנה בטעות ל-GetPhoneNumbers).
- SMS כבוי כברירת מחדל על מספרים שנרכשו.
- סגמנטציה: 160 GSM-7 / **70 UTF-16** — עברית מתפצלת ב-70 תווים וכל סגמנט מחויב כהודעה; גם נכנסות מחויבות.
- שמירת טקסט ההודעות בפאנל היא opt-in (פרטיות — להשאיר כבוי).

---

## VoxEngine runtime (concepts / limits / tooling)

**יכולות עיקריות**
- Runtime: **ECMAScript 2022 על SpiderMonkey (Firefox 115)**; JS בלבד בענן (TS מקומפל מראש).
- מחזור חיים: `Started` → `CallAlerting` (שיחה) או `HttpRequest` (טריגר HTTP) → ... → `Terminating` (טיימרים מתים; **מותרת בדיוק בקשת HTTP אחת אחרונה**) → `Terminated`.
- HTTP: `Net.httpRequest` / `httpRequestAsync` (Promise) עם `HttpRequestResult` (code/data/text/headers); מייל דרך `Net.sendMail(Async)`.
- **Custom data**: `VoxEngine.customData()` = 200 בתים = בדיוק הערך של `script_custom_data`; `Call.customData()` = slot נפרד; חיפוש בהיסטוריה דרך `GetCallHistory` עם `call_session_history_custom_data`.
- **Remote sessions**: תשובת StartScenarios כוללת `media_session_access_url`; POST אליו מפעיל `AppEvents.HttpRequest` בסשן החי (גוף ב-`e.content`) — ערוץ push/kill מתועד לתוך שיחה רצה.
- **ApplicationStorage** (KV): זוגות ללא הגבלה, key ≤ 200 תווים, value ≤ 2000, `put(key,value,ttl)`/`get` — app-wide, billed.
- **Secrets**: פאנל פר-application + `VoxEngine.getSecretValue(name)` (סינכרוני) — רוטציה בלי redeploy.
- `Logger.write` — לוג session זמין מיד בסיום דרך Call history / GetCallHistory; Management API מתוך scenario דרך `Modules.VoximplantAPI` (מפתח קשור ל-rule ב-`SetRuleInfo bind_key_id`).
- **MCP client**: `Modules.MCP` (transport sse, `listTools`/`callTool`, אירועי ServerEvents).
- **voxengine-ci**: `init` / `upload --dry-run/--force`, typings מגורסים, תבניות CI ל-GitLab/GitHub/Jenkins.

**מגבלות ו-gotchas (המעטפת הקשיחה)**
- **HTTP: 3 פעילות / 35 סה"כ** (מעבר — exception), תשובה ≤ **2MB**; ב-Terminating המתנה ≤ 90s לבקשות תלויות, והתור הנותר **נזרק בשקט בלי callbacks**.
- **זמן ריצה של event handler ≤ 1 שנייה** — חישוב כבד חייב לצאת ל-HTTP חיצוני.
- **50 ניסיונות שיחה לסשן; מקס' 10 שיחות "progressing"** (Failed 403 מעבר) — הדוקס ממליצים במפורש על **CallList** ל-outbound רחב.
- 60s ללא מענה → Failed 408; session בלי שיחות מסתיים ב-60s; 100 טיימרים; 10 media players; scenario ≤ 256K תווים; זיכרון JS ≤ 16MB; `sendInfo/sendMessage` ≤ 8192B.
- יעדים > $0.20/דקה + אפריקה חסומים כברירת מחדל.

---

## Client SDKs (Web / Android / iOS)

**תמצית**: כל הסקשן עוסק ב-client endpoints (אפליקציות שבהן משתמש אנושי מתחבר כ-user). **אישור שלילי ל-KALFA**: שום דבר כאן לא נדרש ל-flow ה-outbound (StartScenarios → VoxEngine → callPSTN).
- Web SDK v5 = ארכיטקטורה מודולרית (`registerModules`, טיפוס `Watchable`), החלפה ל-v4; Android v3 = שכתוב שובר (BoM, `VICore.initialize`, Client singleton עם `node`).
- Auth: סיסמה / **one-time key** (ה-hash MD5 מחושב חובה ב-backend) / **טוקנים מתחדשים** (accessToken ~חודש + refreshToken).
- Push לשיחות נכנסות דורש גם תעודה בפאנל וגם **push helper module בתוך ה-scenario**; `VoxEngine.callUser()` שולח push אוטומטית; iOS 13+ מחייב דיווח ל-CallKit.
- אם ייבנה קונסול "האזנה/השתלטות" ל-owner — היעד הוא Web SDK v5 (לא v4 שבדוגמאות ישנות), עם one-time key דרך ה-Next.js backend.

---

## Management API (auth / callbacks / secure objects / billing)

**יכולות עיקריות**
- שלושה חלקים: Control API (StartScenarios/StartConference, שליטה בסשנים חיים, CreateCallList), Provisioning API (חשבונות/אפליקציות/users/rules), Phone Number API (מספרים, SMS, SIP registrations, היסטוריית שיחות CSV).
- **JWT**: RS256; header `kid`=key_id; claims `iss`=account_id, `iat`, `exp ≤ iat+3600`; נשלח `Authorization: Bearer`. Voximplant לא שומרת מפתחות פרטיים. עם JWT אין צורך ב-api_key/account_id בפרמטרים, והתשובה כוללת גם `media_session_access_secure_url`.
- **Roles = least privilege**: service account עם role של Scenarios בלבד מספיק להרצת scenarios.
- **CreateCallList**: מקבל רשימת נתונים ויוצר סשנים מקבילים, עם פריט נתונים אישי לכל סשן.
- **Webhooks**: POST עם `callbacks[]` של AccountCallback; אימות `hash = MD5(security_salt + account_id + api_key + callback_id)`; דוגמה: `MinBalanceCallback`.
- **Secure objects**: מצב secure לאפליקציה (או `secure` פר-recorder); גישה ללוגים דורשת role מתוך owner/developer/admin/supervisor/support; להקלטות — כל role (או בלי); תמיכה ב-HTTP Range.
- **Billing API**: `GetResourcePrice`/`GetSubscriptionPrice`; decks ליציאה: `PSTN_OUT_INCOUNTRY` → `PSTNOUT_EEA` → `PSTN_INTERNATIONAL` (יש מדינות בלי deck מקומי — fallback).
- Child accounts: כבויים כברירת מחדל (הפעלה דרך support); ניהול ילד ע"י `iss`=child-id בחתימת מפתח ההורה. לא רלוונטי ל-KALFA.

**מגבלות ו-gotchas**
- **Rate limits לא מתועדים בשום מקום בסקשן** — וגם תקרת 200 הבתים לא מוזכרת כאן (שניהם בעץ references/httpapi, מחוץ ל-pillar).
- `DownloadHistoryReport` עשוי לחזור gzip (curl `--compressed`).

---

## Integrations (ChatGPT / Dialogflow / S3 / WhatsApp ועוד)

**יכולות עיקריות**
- **ChatGPT tutorial = דפוס ה-BYO-LLM הקנוני**, זהה מבנית ל-Groq bridge של KALFA: ASR (`singleUtterance`) → `Net.httpRequestAsync` ל-LLM → `createTTSPlayer(..., progressivePlayback)` → `addMarker(-300)` → `PlaybackMarkerReached` פותח מיקרופון מחדש; הסרת listener פר תור; מדידת latency עם `Date.now()`; fallback דיבור על שגיאה.
- **שלד ה-outbound אחיד בכל הפלטפורמה**: `AppEvents.Started` → `VoxEngine.customData()` (מספר היעד) → `callPSTN(number, realCallerId)` → Connected/Failed/Disconnected → `terminate()`.
- **CallList במאמר CX**: כל שורת CSV (`;`) נמסרת ל-scenario כמחרוזת JSON דרך `customData()`; חובה `CallList.reportResult({result, duration})` או `reportError({result, msg, code})` — מניע retry או כתיבה ל-`result_data`.
- Dialogflow CX דרך מודול CCAI (analyzeContent, eventInput, liveAgentHandoff → `callPSTN`+`easyProcess`); ES דרך מודול AI הישן (פלט MP3/OGG בלבד).
- **S3-compatible storage** להקלטות: AWS (`s3:PutObject`) / GCS (HMAC) / Yandex / MinIO; חיבור פר-application + Test מובנה; רוטציית מפתח — להשאיר את הישן חי עד 12 שעות.
- Dasha AI = תבנית לחיבור כל vendor קולי חיצוני דרך SIP (`callSIP` + `easyProcess`).
- Jitsi = ה-reference העשיר ביותר ל-IVR/DTMF: מכונת `IVRState`, retry-once ל-`Net.httpRequest`, שליטת SIP INFO, ו-**מלכודת סדר rules** (rule catch-all ראשון בולע שיחות נכנסות).
- **WhatsApp Business Calling**: חיבור מספר WABA כ-endpoint קולי (Graph API register → SIP password → פאנל), ושיחות יזומות-עסק דרך `VoxEngine.callWhatsappUser({number, callerid})` — **מותנה בהרשאת שיחה מפורשת פר-משתמש**. הדוגמה הרשמית משתמשת ב-`VoiceList.ElevenLabs.Jessica` — אישור ש-ElevenLabs first-class ב-VoiceList.

---

## Solutions (Call lists ועוד)

**Call lists — מנוע החיוג לקמפיינים (עומק מלא)**
- CSV: delimiter ברירת מחדל `;`, שורה ראשונה = שמות עמודות; עמודות מיוחדות: `__start/__end_execution_time` (חלון יומי **UTC+0**, עוטף חצות אם start>end), `call_schedule` (JSON פר-יום-בשבוע), `task_priority` (0=הגבוה, ברירת מחדל 50), `next_attempt_time` (ISO 8601).
- חוזה ה-scenario: `AppEvents.Started` פר שורה; `JSON.parse(VoxEngine.customData())`; `reportResult(Async)` להצלחה (אובייקט שרירותי → `result_data`), `reportError(Async)` לכשל (מפעיל retry לפי `num_attempts`+`interval_seconds`), `reportProgress(Async)` לביניים, **`requestNextAttempt(Async)`** לעריכת המשימה + תזמון ניסיון נוסף (שדות: `custom_data`, `attempts_left` [ירידה אוטומטית ב-1 אם לא הוגדר; 0=סופי], `start_at`, חלונות יומיים, `next_attempt_time`, `error` מומלץ מאוד).
- ניהול: `CreateCallList` (`rule_id`, `priority`, `max_simultaneous`, `num_attempts`, `interval_seconds`, `file_content`, `encoding`, `delimiter`), תוצאות ב-`GetCallListDetails`; עריכת משימה מה-backend ב-`EditCallListTask`; ביטול ב-`CancelCallListTask`.
- **Gotchas**: רשימות **נעצרות כשהיתרה < $1** (חידוש אוטומטי אחרי טעינה); אי אפשר למחוק רשימה בתהליך; `next_attempt_time` — לא בעבר, מקס' **9 חודשים** קדימה (ערך שגוי נופל בשקט ל-request+interval); "ManageQueue" **לא קיים** בשום מקום בעץ הדוקס (משפחת הניהול היא `references.httpapi.calllists`).

**שאר ה-solutions**
- Phone number masking: מדגים את **גשר ה-KVS** — backend כותב `SetKeyValueItem` (Management API), scenario קורא `ApplicationStorage.get`; + UX DTMF ייצורי (טיימרים, reprompt) ו-helper של `say()` כ-promise.
- 2FA: תקדים מיני של הטריגר המדויק של KALFA (StartScenarios + JSON ב-script_custom_data) + טריק ריווח ספרות ל-TTS: `String(code).replace(/(\d)/g,'$1 ')`.
- Call tracking: מאשש fetch פרמטרים ב-HTTP בתחילת שיחה (כמו ctx) ו-`AppEvents.Terminating` כ-hook דיווח אחרון.
- Caller ID shuffler: לא רלוונטי (סיכון משפטי בישראל) — אבל דפוס ה-ApplicationStorage עם TTL להיסטוריית יעדים שימושי; בדוגמת הדוקס יש באג (`array.length`).

---

## Troubleshooting

**יכולות עיקריות**
- **`Logger.write()`** — הערוץ העמיד לדיבוג/audit פר שיחה; נשמר עם היסטוריית השיחות (פאנל / GetCallHistory), מקבל אובייקטים.
- **Cloud IDE debugger**: DevTools-like (breakpoints/watch/call stack), נצמד לסשנים לפי rule + קריטריון (IP מסוים / מספר טלפון / כל השיחות) **+ שדה custom data** — אפשר לשחזר payload של StartScenarios תחת debugger. דרישות: ES6, לא ממוזער/מעורפל. `debugger` ו-`trace()` נתמכים.
- **Softphone מובנה** (Debug menu / Routing→Test tools) לבדיקות ידניות בלי עלות PSTN.
- **`call.handleMicStatus(true)` + `CallEvents.MicStatusChange`** (`e.active`) — אירועי פעילות מיקרופון בצד השרת (VAD קל, מדידת אורך דיבור).
- תבנית echo-test עם Recorder; אירועים מובנים (כמו `Call.PushSent`) נוחתים בלוג הסשן.

**מגבלות ו-gotchas**
- לוגים = **משטח PII**: הדוקס מזהירים במפורש שלוגים מכילים טקסטים שנשלחו מה-scenario, שם חשבון ו-IPים.
- אופציית "Secure storage for recordings and logs" ברמת האפליקציה מגדרת גישה מאחורי הרשאה (ר' secure-objects).

---

## Voice AI — חלק א' (BYO-LLM, OpenAI, Google, Ultravox)

**יכולות עיקריות**
- **התיעוד עובר לאתר ייעודי — docs.voximplant.ai** (העץ הנוכחי transitional; לבדוק שם לפני החלטות).
- **Bring-your-own-LLM**: ה-LLM הטקסטואלי שלך + שכבת קול של Voximplant (ASR רב-ספקי, Silero VAD + Pipecat, realtime TTS). דוגמה מלאה עובדת.
- **`baseUrl` על ה-OpenAI connectors** — הרכב המתועד לכל backend תואם-OpenAI (הודגם עם Azure). כל הדוגמאות מושכות מפתחות עם `VoxEngine.getSecretValue()`.
- **OpenAI.createRealtimeAPIClient** (REALTIME/TRANSCRIPTION): `sessionUpdate` (instructions, voice, whisper transcription, `server_vad` turn_detection); `responseCreate({})` = ה-agent מדבר ראשון (חיוני ל-outbound); barge-in: `InputAudioBufferSpeechStarted` → `clearMediaBuffer()`; **מצב 3rd-party TTS**: `output_modalities:['text']` + הזרמת `ResponseOutputTextDelta` ל-realtime TTS חיצוני (שומרים קול he-IL/ElevenLabs עם ניהול תורות realtime).
- **Function calling בתוך ה-scenario**: `tools` ב-sessionUpdate; זיהוי `function_call` ב-`ResponseDone` — ביצוע הכלי ב-VoxEngine ללא webhook חיצוני.
- **Chat Completions client** = ההתאמה הקרובה ביותר ל-API של Groq; streaming deltas (`ContentDelta/Done`) + streaming של function-call arguments.
- Gemini (`Gemini.createLiveAPIClient`) בשני backends: Gemini API (apiKey) או **Vertex AI** (service account + project/location — מסלול governance); **Preview API + TTL לסשנים** (סיכון תפעולי).
- Ultravox = LLM שמעכל דיבור ישירות (בלי ASR); דרישה קשיחה: `medium: serverWebSocket` + sample rates **16000** או שהאודיו משובש. עמוד ה-SIP שלו מאשש בדיוק את דפוס ה-outbound של KALFA.
- דפוס TTS מוזרם אחיד: buffer של deltas → flush על `[.!?\n]` או >40 תווים → realtime player; interrupt = ניקוי buffer + עצירת player.
- מלכודת ברכה: לחבר call→AI רק אחרי `WebSocketMediaEnded` של הברכה (אחרת המודל שומע את עצמו).

---

## Voice AI — חלק ב' (ElevenLabs, Deepgram, Yandex, Cartesia, xAI, Inworld)

**דפוס משותף לכל ששת הספקים**: `require(Modules.X)` → `await X.create*Client(params)` → `VoxEngine.sendMediaBetween(call, client)` → אירועים; **barge-in ידני בכולם** — חובה `clearMediaBuffer()` על אירוע ה-interruption של הספק; cleanup ב-`onWebSocketClose` + Disconnected/Failed (בלעדיו סשן שנותק ממשיך לרוץ ולהתחייב — בדיוק דאגת ה-stuck-call reconciler).

- **ElevenLabs Agents Client (המועמד החזק)**: `createAgentsClient({xiApiKey, agentId, onWebSocketClose, baseUrl?})` — ה-agent (prompt/קול/LLM: Gemini/Claude/OpenAI) מוגדר בדשבורד של ElevenLabs. **Override פר-שיחה**: `conversationInitiationClientData({conversation_config_override:{agent:{prompt, first_message, language}}})` — מחייב הפעלת override בהגדרות ה-agent. אירועים: `UserTranscript`, `AgentResponse(+Correction)`, **`ClientToolCall`** (כלי בצד הלקוח), `Interruption`, `VadScore`, `ContextualUpdate`. **Gotcha חבוי**: חובה להגדיר **16000 Hz PCM** בצד ה-agent ב-ElevenLabs.
- **Deepgram VoiceAgentClient (הקונפיגורבילי ביותר)**: listen/think/speak מודולריים — `agent.think.provider` תומך **groq** (עם `endpoint` חובה לספקי 3rd-party), `agent.speak.provider` תומך `eleven_labs` — כלומר בדיוק ה-stack הנוכחי של KALFA עם אורקסטרציה מנוהלת. Caveats: תחת Flux — `agent.language` נאכף רק ל-TTS; `smart_format` לא תואם Flux; `keyterms` = nova-3 אנגלית בלבד.
- **Yandex**: לא מתאים כספק ל-IL, אבל מקור הדפוס ל-**ניתוק ביוזמת LLM**: כלי `hangup_call` → `function_call_output` → פרידה → `WebSocketMediaEnded` → `call.hangup()` באיחור ~1s.
- **Cartesia** (Line, hosted agents): פרוטוקול דק, `start({metadata})` ייחודי, אירועי DTMF/Custom; אין שליטת prompt ב-scenario.
- **xAI Grok**: repo `github.com/voximplant/grok-voice-agent-example` — ה-reference היחיד ב-scope לשיחות **outbound** של voice agent שנפרס ב-voxengine-ci (תואם בדיוק ל-flow של KALFA).
- **Inworld**: multi-model routing (`session.model: 'openai/gpt-4o-mini'` וכו') + `semantic_vad` עם `eagerness` — מעניין לתורות טבעיים אם תהיה תמיכה בעברית.
- **אין מטריצות שפה/עברית באף עמוד** — אימות he מול כל ספק בנפרד; העמודים משוכפלים מתבנית (עמוד Yandex כתוב עליו "ElevenLabs"); reference הפרמטרים מרוכז תחת `references/voxengine/openai/*`.

---

## רלוונטיות ל-KALFA (מאוחד, ללא כפילויות)

### 1. אימות הארכיטקטורה הקיימת
- הארכיטקטורה של KALFA — StartScenarios על rule בלי pattern + `script_custom_data` מינימלי + ctx fetch + cb דיווח + ניתוק על PlaybackFinished — היא **בדיוק הדפוס הקנוני המתועד** (מאושש בנפרד ב-getting-started, ChatGPT tutorial, 2FA, call tracking, Ultravox SIP).
- תקרת **200 הבתים מאוששת בתיעוד** (`guides.voxengine.custom-data`: `script_custom_data` = ה-slot של `VoxEngine.customData`). *הערה*: עמוד guides.calls.features טוען 2000 תווים — סתירה פנימית בדוקס; האימות החי של KALFA (200~) גובר. בונוס: הכנסת ה-call token ל-customData הופכת סשנים לחיפושים ב-`GetCallHistory` (`call_session_history_custom_data`) לצורכי reconciliation.
- תרגיל ה-turn-taking (`addMarker(-300)` + `PlaybackMarkerReached` + הסרת listener פר תור) הוא בדיוק מה שהדוקס ממליצים.

### 2. ערוצי נתונים מעבר ל-200 בתים
- **CallList**: שורת CSV שלמה מגיעה כ-JSON דרך `customData()` — עוקף את התקרה לחלוטין בקמפיינים.
- **ApplicationStorage (KVS)**: backend כותב `SetKeyValueItem`, scenario קורא `ApplicationStorage.get` (key ≤ 200, value ≤ 2000, TTL) — payload מלא פר-אורח מאחורי token קצר; גם counters חוצי-סשנים ו-DNC state. שירות billed.
- **`media_session_access_url`** (מתשובת StartScenarios): POST מפעיל `AppEvents.HttpRequest` בסשן חי — ערוץ push לעדכוני אמצע-שיחה **ו-kill switch ל-stuck-call reconciler** (לסיים סשן תקוע מרחוק במקום רק polling). כדאי להתחיל להתמיד את ה-URL.
- **Media Streams**: ה-backend יכול להתחבר ב-wss לסשן רץ (https→wss על אותו URL) — אפס בתים מהתקציב.
- **Secrets**: `VoxEngine.getSecretValue` = הבית הנטיבי למפתח Groq/ElevenLabs — סוגר את ה-workaround של הגשת המפתח דרך ctx ואת רוטציית המפתח שדלף (עדכון בפאנל בלי redeploy).

### 3. CallList — חיוג קמפיינים (ההערכה נענתה)
- CallList הוא **ההמלצה המפורשת של הדוקס** ל-outbound רחב (מגבלות סשן: 50 ניסיונות / 10 progressing). נותן: retries מובנים (`num_attempts`/`interval_seconds`), שליטת קצב (`max_simultaneous`), תזמון פר-אורח (`call_schedule`, `task_priority`, `next_attempt_time`), קציר תוצאות (`GetCallListDetails`/`GetCallHistory`) לחיוב פר-reached.
- **schedule_callback** ("תתקשרו מחר") — החלטת מוצר פתוחה — ממופה ישירות ל-`requestNextAttempt` עם `next_attempt_time`, או מה-backend דרך `EditCallListTask`/`CancelCallListTask` (למשל כשהאורח ענה בינתיים ב-WhatsApp).
- **כל חלונות הזמן ב-UTC+0** — ישראל UTC+2/+3 כולל DST: להמיר חלונות שעות-שיחה חוקיים לפני כתיבת ה-CSV.
- "ManageQueue" לא קיים; משפחת הניהול היא `references.httpapi.calllists`.

### 4. הגדרת "reached" וחיוב
- **AMD לא זמין לישראל** בלי בקשת support (רק BR/CO/KZ/MX/RU). אלטרנטיבות: beep detection מכוון לתדרי תא קולי ישראליים; זיהוי שיחתי ב-Groq bridge; `handleMicStatus`/`MicStatusChange` כראיית דיבור; DTMF ("הקש 1 לאישור") דרך `Modules.IVR`/`ToneReceived` — סיגנל דטרמיניסטי חסין-ASR.
- ההגדרה של PDS — "ענה **ואין** הודעת תא קולי אחרי מענה" — קריטריון reached מוכן; בדוגמת ה-CallList הרשמית voicemail מדווח כ-`reportError` ולא נספר.
- `CallEvents.Failed e.code` ממופה ל-reached/not-reached; ה-cb הסופי חייב להיות **בקשת ה-HTTP היחידה של Terminating** (או קודם) — עודף בתור נזרק בשקט.
- לוגי Voximplant נשמרים **חודש בלבד** — reconciliation חיוב חייב להישען רק על ההתמדה של KALFA (כבר כך).

### 5. ElevenLabs (ההערכה נענתה — שלושה מסלולים)
1. **החלפת קול בלבד**: קולות ElevenLabs first-class ב-`VoiceList` (הוכח בדוגמה רשמית) — פוטנציאל swap של שורה ב-`call.say`/TTSPlayer.
2. **Realtime TTS module**: `ElevenLabs.createRealtimeTTSPlayer` עם מפתח אישי (`xi-api-key`) ו-`sendText({flush})` — התחליף המתועד ל-`call.say()` במורד פלט ה-Groq המקוטע.
3. **Agents Client (הכי רחוק)**: agent מתארח ב-ElevenLabs; ה-scenario צריך רק `agentId`+`xiApiKey`; פרסונליזציה פר-אורח דרך `conversation_config_override` (כולל `language:'he'` ו-first_message מ-ctx); `ClientToolCall` ממופה ל-save_rsvp/mark_dnc/notify_owner; `UserTranscript`/`AgentResponse` = ראיות תמלול ל-cb.
- **חובה**: 16kHz PCM בצד ה-agent; הפעלת overrides ב-security settings; **תמיכת עברית (eleven_flash_v2_5 וכו') לאימות מול ElevenLabs — לא מתועדת אצל Voximplant**.

### 6. שדרוג ה-Groq bridge
- **`Modules.OpenAI` Chat Completions client עם `baseUrl`** → endpoint תואם-OpenAI של Groq: streaming deltas, function-call streaming, שגיאות מנוהלות — פרישת ה-fetch הידני. תאימות Groq לא מוצהרת במפורש — **לבדוק חי**. (`storeContext` דו-משמעי בדוקס — לאמת אמפירית.)
- **סטאק ה-latency**: Silero VAD (`speechEndAt`) + Pipecat `predict()` (שניהם אגנוסטיים לשפה) + TTS מוזרם עם buffer-משפטים; barge-in אחיד = `clearMediaBuffer()`.
- **Deepgram Voice Agent** = היחיד שמריץ את ה-stack המדויק של KALFA כאורקסטרציה מנוהלת (think=groq + speak=eleven_labs) — לוודא איכות nova-3 בעברית מול Deepgram.
- מגבלות שהגשר חי בתוכן: HTTP 3/35, תשובה ≤ 2MB, callback ≤ 1s (LLM חייב להיות מחוץ ל-VoxEngine), 10 media players (להעדיף realtime player אחד לשיחה).
- מסלול full-duplex עתידי: Media Streams WebSocket (טופולוגיה: scenario מתקשר ל-wss של KALFA, או KALFA נכנס דרך ה-media URL); מלכודות: PCM8 ברירת מחדל, buffer 10s, cap = שיחות+3, customParameters כמחרוזת JSON; ElevenLabs ulaw_8000/pcm_16000 מתלבש ישירות.
- דפוס ניתוק-ביוזמת-LLM (Yandex): כלי hangup → פרידה → `call.hangup()` מושהה — פורט לכל connector; `grok-voice-agent-example` = reference ל-outbound+voxengine-ci.
- MCP client (`Modules.MCP`) — מסלול עתידי לחשוף save_rsvp/mark_dnc/notify_owner ככלים במקום חוזי ctx/cb ייעודיים.
- Voice AI docs עוברים ל-**docs.voximplant.ai** — לבדוק שם לפני קיבוע החלטות.

### 7. תפעול, כסף ומספרים
- **יתרה $2.88**: מתחת להתראת ברירת המחדל ($5); call lists **נעצרים מתחת ל-$1**; שיחה פעילה יכולה לגרור יתרה שלילית ואז חסימה — טעינה + auto top-up (טיקט support) הם תנאי מקדים לקמפיינים. `MinBalanceCallback` (webhook עם אימות MD5-salt) יכול להזין את ה-Slack ops-alerting הקיים בלי polling (דורש שמירת api_key legacy לאימות).
- **caller ID ‎+972**: מספר שכור/מאומת בלבד; רכישת מספר ישראלי צפויה לכלול KYC/סיוע support (זמן הובלה), דמי מנוי חודשיים, וסיכון השעיה→שחרור בכשל חידוש — ליומן התפעול או ניטור `grace_credit` ב-`GetAccountInfo`.
- **יעדים > $0.20/דקה חסומים כברירת מחדל** — לוודא תעריפי סלולר IL לפני קמפיינים; תעריפים programmatically דרך Billing API (`PSTN_OUT_INCOUNTRY`/`PSTN_INTERNATIONAL`, country IL) לחישובי מרווח.
- **IONOS firewall**: `getMediaResources?with_jsservers` = ה-allowlist המדויק של כתובות המקור לבקשות ל-ctx/cb; לרענן תקופתית. `with_sbcs` אם יידרש SIP.
- **Least privilege**: service account עם role של Scenarios בלבד; גישה ללוגים תדרוש role נוסף (owner/developer/admin/supervisor/support); הקלטות — בלי role.
- דיבוג: cloud debugger עם שדה custom data משחזר payload של StartScenarios עם breakpoints; להשאיר scenario פרוס לא-ממוזער (ES6); Softphone מובנה לבדיקות בלי עלות PSTN.

### 8. הקלטות, לוגים ופרטיות
- הקלטת שיחות אישור: `call.record` עם `stereo` (+`hd_audio` לאיכות אנליזה), `RecordStarted.e.url` אל ה-cb; `expire` מיושר למדיניות שמירה (מקס' 3 שנים); **S3-compatible storage** משאיר הקלטות (PII של אורחים) בשליטת KALFA — רוטציית מפתח עם חפיפה של 12 שעות.
- להפעיל **Secure storage for recordings and logs** — הדוקס מזהירים שלוגים מכילים טקסטים מה-scenario/שם חשבון/IPים; `Logger.write` = משטח PII, לא לרשום נתוני אורח.
- תמלול post-hoc דרך `GetCallHistory?with_records=true` → `transcription_url` יכול להזין את מסלול ה-audit.
- SMS: להשאיר את שמירת טקסט ההודעות בפאנל כבויה.

### 9. עברית — TTS/ASR
- SSML: מאושש כתלוי-ספק עם שגיאה 400 — ה-**`request` passthrough** (Google `audioConfig.speakingRate/pitch`) הוא הכוונון המתועד ללא תגים; גישת הניקוד תקפה.
- ASR עברי: phrase hints רק בפרופילי Google — `phraseHints` בעברית (כן/לא/מספרים) או `speech_contexts`; `interimResults` + `singleUtterance` = ידיות ה-latency. אם he-IL המובנה מאכזב — external ASR ב-WebSocket (חריץ ל-Whisper/Groq STT, אותה ארכיטקטורה כמו גשר ה-LLM).
- זמינות he-IL בפועל (VoiceList/ASRProfileList) — בקבוצת references, לא ב-pillar זה; אין מטריצות שפה באף עמוד voice-ai.

### 10. ערוצים משלימים
- **WhatsApp voice**: מספרי WABA קיימים של KALFA יכולים להפוך ל-endpoint קולי (נכנס) ו-`callWhatsappUser` יוצא בלי עלות PSTN — אבל שיחות יזומות-עסק דורשות **הרשאת שיחה מפורשת פר-משתמש** (שער consent מקביל ל-blocker B1).
- **SMS**: עברית = 70 תווים לסגמנט (2–3 סגמנטים מחויבים להזמנה טיפוסית); לפני כל תוכנית IL — לבדוק `GetPhoneNumberRegions` country IL עם `is_sms_supported` (וירטואליים לא תומכים); SenderID ממותג = טיקט support; דו-כיווני דרך `IncomingSmsCallback` באותו דפוס webhook. רלוונטי רק אם עובר את ExtrA במחיר/יכולת.
- **הכרזה קבוצתית** (עתידי): callPSTN-לתוך-conference + `TTSPlayer.sendMediaTo(conf)` = "חייג N אורחים, השמע הודעה אחת"; `joinAsViewer`/supervision = האזנת admin חיה לשיחות AI.

### 11. מה לא רלוונטי (אישור שלילי)
- SmartQueue/PDS/ACD (מניחים agents אנושיים; PDS דורש Go client), כל ה-client SDKs (Web/Android/iOS, push, CallKit), וידאו/screen-share, child accounts (gated-support, מודל PBX), caller-ID shuffling (סיכון משפטי IL), Yandex/Cartesia/xAI/Inworld כספקים (אין ראיות עברית). אם אי-פעם תתווסף אסקלציה לאדם — `enqueueTask`+`extraHeaders` הוא ה-hand-off הקנוני, אבל גשר in-session (`callPSTN` owner + `easyProcess`) פשוט יותר.

### 12. פערים פתוחים לאימות
1. תאימות `baseUrl` → Groq (לא מוצהרת; לבדוק חי) + סמנטיקת `storeContext`.
2. תמיכת עברית: ElevenLabs (flash_v2_5 / Agents ASR), Deepgram nova-3 STT, Pipecat turn detection.
3. he-IL ב-VoiceList/ASRProfileList — בקבוצת references (pillar אחר).
4. Rate limits של Management API + אישור רשמי לתקרת 200 בתים — רק ב-references/httpapi (pillar אחר).
5. בקשת AMD לישראל מול support / כיול beep detection לתדרי carriers ישראליים.
6. תעריפי IL בפועל מול חסימת $0.20/דקה; עלות מספר ‎+972 ולוח זמני KYC.
7. סתירת 200/2000 תווים ב-customData (features מול custom-data) — לאמת אמפירית אם אי-פעם נשענים על יותר מ-200.
