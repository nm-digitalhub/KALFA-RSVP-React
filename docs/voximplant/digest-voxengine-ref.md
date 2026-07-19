# דייג'סט מאוחד — Pillar: voxengine-ref (רפרנס VoxEngine המלא)

סינתזה של 6 קבוצות מחקר שכיסו את כל עץ הרפרנס של VoxEngine בתיעוד Voximplant (נשלף מ-`https://voximplant.com/api/v2/getDoc` ב-2026-07-19). הדייג'סט הזה מחליף את קריאת הפתקים הגולמיים.

הערת נתיב: הקובץ נכתב לנתיב ה-plan המורשה כי הסשן רץ ב-plan mode (כמו אצל 5 מתוך 6 סוכני המחקר); הנתיב המיועד היה `<scratchpad>/vox-research/digest-voxengine-ref.md`, וה-base path שהועבר מה-orchestrator היה literal `undefined` (באג תבנית).

---

## מפת הקטגוריות של ה-Pillar

| קבוצה | היקף | עמודים (נקראו/סה"כ) | קובץ מקור |
|---|---|---|---|
| vox-ref-core | ליבת VoxEngine: root, AppEvents, CallEvents, ASREvents, PlayerEvents, RecorderEvents, WebSocketEvents, VoxEngine namespace, Net, ApplicationStorage, Crypto, Logger, PhoneNumber | 69/69 | plans/…a20cce30a28d43769.md |
| vox-ref-callflow | CallList, AMD, IVR, VoiceList (קולות TTS), VoxTTS, ASRModelList/ASRProfileList, ACD/SmartQueue/Conference/SequencePlayer/StreamingAgent events, MeasurementProtocol | 92/92 | plans/…a9252a68c17a405ba.md |
| vox-ref-ai-core | מחברי LLM: AI (detectVoicemail + Dialogflow ES), CCAI, OpenAI (GA+Beta, ChatCompletions, Responses), Gemini, Grok | 70/70 | plans/…a68a8e3f057a0125f.md |
| vox-ref-ai-providers | מחברי ספקי קול: Cartesia, Deepgram, ElevenLabs, Google, Inworld, Pipecat, Silero, Ultravox | 55/55 | plans/…a3f1569e811226f73.md |
| vox-ref-voximplantapi | VoximplantAPI — wrapper של ה-Management API מתוך תרחיש | 40/295 (structural) | plans/…a44b3990fe2011f0f.md |
| vox-ref-avatar | Voximplant Avatar: מודול VoxEngine + Avatar HTTP API + AvatarEngine | 40/134 (structural) | scratchpad/vox-research/vox-ref-avatar.md |

---

## ליבת VoxEngine — session, namespace ופונקציות גלובליות

**גלובלים זמינים בכל תרחיש (בלי require):** `base64_*`, `bytes2hex/str2bytes` וכו', `setTimeout/setInterval` (מינימום interval = **100ms**), `getLocalTime(timezone, date)` — קריטי כי **`new Date()` הוא תמיד UTC**, `uuidgen()`, `levenshtein_distance(a,b)`, `trace()`. מודולים שדורשים `require(Modules.X)`: ACD, ASR, AI, AMD, ApplicationStorage, Conference, IVR, Recorder, SmartQueue, StreamingAgent, Avatar.

**VoxEngine namespace (36 פונקציות) — העיקר:**
- `customData(str?)` — **מוגבל ל-200 bytes** (זהו ה-cap המתועד של script_custom_data), scoped ל-session, נפרד מ-`Call.customData`, וניתן לשליפה בדיעבד מ-call history (audit trail).
- `getSecretValue(name)` — קריאת secrets המאוחסנים בפאנל Voximplant (undefined אם חסר) — אחסון מפתחות נטיבי.
- `terminate()` — **לא עוצר את הבלוק הנוכחי; חובה `return;` אחריו**. אחרי terminate נורים רק Terminating/Terminated.
- `callPSTN(number, callerid, params?)` — שיחות מעל 20¢/דקה ולאפריקה חסומות כברירת מחדל; **CallerID חייב להיות מספר Voximplant שכור אמיתי, מספר מאומת (verification call), או caller ID של שיחה נכנסת — מספרי test אסורים**. Failed עשוי להיירות ב-60s.
- `createTTSPlayer(text)` — **מעל 1500 תווים ⇒ PlaybackFinished עם error**; קאשינג של פרייזים עד **שבועיים**, keyed by URL בלבד, **משותף בין כל האפליקציות והסשנים**.
- `createURLPlayer` — timeout הורדה 12s, קובץ עד 10MB, פורמטים mp3/ogg/flac/wav; media unit מקבל **רק stream נכנס אחד** (חדש מחליף ישן).
- `createWebSocket(url)` — **`wss://` מקבל רק דומיין, לא IP**; חובה `allowWebSocketConnections()` לחיבורים נכנסים.
- `sendMediaBetween/stopMediaBetween` — חיווט דו-כיווני בין שתי media units.
- עזרי חיוג: `easyProcess`, `forwardCallTo*`, `playSoundAndHangup`; וגם `callSIP/callUser/callConference/callWhatsappUser`.
- `addEventListener` — **handler שאינו פונקציה ⇒ שגיאה וסיום התרחיש** (חוזר בכל המודולים).

**AppEvents (מחזור חיי session):**
- `Started` — האירוע הראשון; ה-payload כולל **`accessURL`/`accessSecureURL`** (ה-media_session_access_url שחוזר מ-StartScenarios), `sessionId`, `logURL`.
- `HttpRequest` — נורה כשבקשת Management API פוגעת ב-access URL של הסשן (method/path/content/כותרות X- בלבד) — **הערוץ הרשמי לדחוף מידע לתוך תרחיש רץ**.
- `Terminating` — טיימרים ומשאבים חיצוניים מתים, אבל **מותרת בדיוק בקשת HTTP אחת אחרונה** בתוך ה-handler.
- `Terminated` — רק `Logger.write` שמיש.
- `NewWebSocketFailed` — WS נכנסים מוגבלים ל-**(מספר השיחות בסשן + 3)**.
- שים לב: `Disconnected` של שיחה **לא מסיים את סשן ה-JS** — חובה `VoxEngine.terminate()` מפורש.

## CallEvents — מחזור חיי שיחה (40 אירועים)

- **Failed** — ניתוק לפני חיבור; קודים שכיחים: **486 busy, 408 no-answer תוך 60s, 404 מספר לא תקין, 480 unavailable, 402 insufficient funds, 603 rejected, 487 terminated**.
- **Connected** ואז **Disconnected** — Disconnected נושא **`cost` (מטבע החשבון), `duration` (שניות), `direction` (billing), `internalCode`, `reason`**.
- `AudioStarted` נורה על SIP 183 גם בלי מדיה בפועל.
- Playback: `PlaybackReady/Started/Finished`; **`Call.stopPlayback` מדכא את `PlaybackFinished`** — משפיע ישירות על תבנית hangup-on-PlaybackFinished.
- DTMF: `ToneReceived` רק אחרי `Call.handleTones`; `ToneDetected` (voicemail/busy tones) — **פעם אחת בלבד ורק אחרי Connected** (מסלול legacy; AMD הוא המודרני); `BeepDetectionComplete` אחרי `enableBeepDetection`.
- מדיה: **`RtpStopped` נורה תוך 7 שניות מהפסקת RTP** (שומר dead-air מצוין), `RtpResumed`, `AudioQualityDetected`, `MediaStatisticsReceived`.
- הקלטה: `RecordStarted` (url), `RecordStopped` (cost+duration; אחרי Disconnected), `RecordError`.

## ASR, Player, Recorder, WebSocket events

- **ASREvents.Result**: `text`, `confidence` — **הסקאלה תלוית-ספק (0..1 או 0..100)**, `languageCode`. שני כללים מתועדים: (א) לבנות recognition timeout ידני; (ב) להחליט בתוך ה-handler אם להמשיך — אחרת **הזיהוי ממשיך אוטומטית וממשיך לחייב**. `Stopped` מדווח cost+duration. `InterimResult` רק עם `interimResults:true`.
- **PlayerEvents**: `AudioChunksPlaybackFinished` — רק ל-RealtimeTTSPlayer, כולל **`timeToFirstByte`** (טלמטריית TTFB חינם); `PlaybackMarkerReached` via addMarker.
- **WebSocketEvents**: `MEDIA_ENDED` נורה אחרי **שנייה אחת של שקט** בזרם הנכנס (לא end-of-stream מפורש); שדה `tag` ממלטפלקס כמה זרמי אודיו על WS אחד.

## Net, ApplicationStorage, Crypto, Logger, PhoneNumber

- **Net.httpRequest / httpRequestAsync**: ברירת מחדל GET; **TCP connect 6s / total 90s — ניתנים רק להקטנה**; **תקרת תשובה 2MB (קוד -9)**; קודי שגיאה פנימיים 0..-9 כאשר **0 = חריגה ממכסת בקשות HTTP פר-session**; `enableSystemLog` ברירת מחדל false (גוף POST לא נרשם ללוג); UA ברירת מחדל `VoxEngine/1.0`. יש גם `sendMail` (SMTP ישיר).
- **ApplicationStorage** (KV פר-אפליקציה): מפתח ≤200 תווים (קונבנציית namespace `ns:`), **ערך ≤2000 תווים**, TTL 0..7,776,000s (**90 יום**; תמחור מדורג 0-30/31-60/61-90), `keys()` לפי namespace (ברירת מחדל 1000).
- **Crypto**: `hmac_sha256`, `sha256`, `sha1`, `md5` — חתימת payloads של callbacks.
- **Logger**: `write` (עד 15,000 תווים; הלוגים נשמרים ב-call history!), `hideTones(true)` לכיבוי רישום DTMF.
- **PhoneNumber.getInfo(number, country?)**: ולידציית E.164, `isValidNumber`, `numberType` (MOBILE/FIXED_LINE/…), region, location.

## CallList — חיוג קמפיינים מנוהל-פלטפורמה

מודול בתוך התרחיש לדיווח תוצאות למנוע ה-call list (הרשימה עצמה נוצרת ב-Management API):
- `reportResult(Async)` — הצלחה; נשמר ב-`result_data`; **עוצר ניסיונות נוספים** לטסק.
- `reportError(Async)` — ניסיון כושל; הטסק נשאר זכאי ל-retry.
- **GOTCHA קריטי:** תרחיש שמסתיים **בלי לקרוא ל-reportResult או reportError — הטסק נחשב מוצלח בשקט ואין retry**. כל מסלול יציאה (busy/no-answer/crash/timeout) חייב לדווח מפורשות.
- `requestNextAttempt(Async)` — "editable call lists": שכתוב בזמן ריצה של `start_at`, `attempts_left` (מתמעט אוטומטית ב-1 אם לא הוגדר ידנית), `custom_data`, `start/end_execution_time`, `next_attempt_time`; אחרי כישלון יש לספק שדה `error`.
- `reportProgress(Async)` — פינג ביניים.
- **כל שורת CSV נושאת `custom_data` פר-טסק** — ההקשר הקמפייני לא עובר דרך script_custom_data (עוקף את תקרת ה-200 bytes פר-אורח).

## AMD ו-detectVoicemail — זיהוי משיבון

שני פרימיטיבים נפרדים:
1. **מודול AMD**: `AMD.create({model, thresholds?{human,mimic,voicemail 0-1}, timeout? default 6500ms, max 20000, נספר מ-CallEvents.Connected})`; `detect()` ⇒ `DetectionComplete` עם `ResultClass` HUMAN|VOICEMAIL|TIMEOUT|CALL_ENDED ו-`ResultSubtype` **MIMIC** (משיבון-AI שמחקה אדם)|NONE; `confidence` 0-100 — מתועד מפורשות כ"לא מובטח מדויק". **מודלים פר-מדינה בלבד: BR, CL, CO, ES, EU_GENERAL, KZ, MX, PE, PH, RU, US — אין מודל ישראל/עברית**; EU_GENERAL (רב-לשוני אירופי) הוא המועמד הקרוב ביותר.
2. **AI.detectVoicemail(call, params)** ⇒ `VoicemailDetected` (confidence 0-100, לא אמין) או `VoicemailNotDetected`; **מודלים: רק 'ru' (ברירת מחדל) ו-'colombia'**; ה-docs לא עקביים (threshold "רק עם מודל latam", יחידת "milliseconds" לערך 0-1 — באגים בתיעוד).

## TTS — VoiceList, קולות עברית, ו-Realtime players

**קולות he-IL בפלטפורמה (התמונה המלאה):**
- **Google: 38 קולות** — `he_IL_Chirp3_HD_*` **30 קולות** (16 גברים / 14 נשים), `he_IL_Wavenet_A-D` (4), `he_IL_Standard_A-D` (4). אין he-IL Neural2/Studio/Journey.
- **Microsoft Neural**: `he_IL_AvriNeural` (גבר) + `he_IL_HilaNeural` (אישה) — היחידים.
- **YandexV3**: `he_IL_naomi` (אישה) — רק תחת YandexV3, לא Yandex.Neural.
- **אין עברית בכלל**: Amazon, IBM, Default (freemium), SaluteSpeech, TBank, VoxTTS.
- **ElevenLabs הוא ספק VoiceList נטיבי**: 20 קולות בשמות (Aria, Brian, Sarah…), שמישים ישירות ב-`call.say`/`createTTSPlayer` — **שינוי של שורה אחת**; התיעוד לא מציין כיסוי-שפות; `createBrandVoice` דורש פניית support.
- **VoxTTS** (streaming TTS של Voximplant: contextId + send_text + clearBuffer/pause/resume) — רק 2 קולות (Anna, Sergey), **אין עברית**; רלוונטי רק כתבנית ארכיטקטונית.

**RealtimeTTSPlayers (namespace פר-ספק, streaming input):**
- **ElevenLabs.createRealtimeTTSPlayer(text, params)**: `pathParameters` (voice_id), `queryParameters` (model_id/output_format — חובה), BYO key דרך `headers:[{name:'xi-api-key', value}]`; `initializeConnectionParameters` אסור שיכיל text/xi-api-key/authorization; `append(text, endOfTurn?)` להזרמת טקסט אינקרמנטלית; `keepAlive` ברירת מחדל true. **GOTCHA: `PlaybackFinished` נורה רק אם `append()` נקרא לפחות פעם אחת.**
- **Google.RealtimeTTSPlayer**: רק player (אין agent client); `language_code` (BCP-47) + `voice` חובה; **קולות הדוגמה הם בסגנון Gemini (Aoede/Puck/Charon/Kore…)** — זמינות he-IL לא מאומתת מהתיעוד; `send()` ממופה ל-`google.cloud.texttospeech.v1.SynthesisInput`; **אין שכבת SSML** (עקבי עם הממצא החי — ניקוד נשאר האסטרטגיה).
- Cartesia/Inworld — players מקבילים (passthrough גולמי לפרוטוקול הספק).
- **TTSOptions**: אופציות ברוח SSML, או העברת פרמטרי ספק ישירות כ-JSON דרך פרמטר `request` — המנוף המתועד לכוונון עברית פר-ספק.

## ASR — ספקים ופרופילים לעברית

- **Google**: פרופיל **`iw_IL`** (קוד ISO legacy — לא `he`!) + `ar_IL` (ערבית-ישראל); מודלים: `phone_call`/`phone_call_enhanced` מכווני 8kHz טלפוניה (**מודלי `_enhanced` מתומחרים מעל התעריף הרגיל**).
- **Microsoft**: `he_IL` קיים.
- **Yandex/YandexV3**: `he_IL` + מצב `auto` (זיהוי שפה אוטומטי).
- **Deepgram — אין עברית בכלל** (כל 27 המודלים כולל nova3); Amazon — אין; SaluteSpeech/TBank — רק ru_RU.

## IVR — מכונת מצבים DTMF

`require(Modules.IVR)`: `IVRState(name, settings, onInputComplete, onInputTimeout)` + `enter(call)`; `IVRSettings.type`: `select` (ספרה אחת + מפת nextStates) / `inputfixed` / `inputunknown` (terminateOn + inputValidator) / `noinput`; `prompt` = `{say, lang}` או `{play}`; timeout ברירת מחדל **5000ms**; `IVR.reset()` לניקוי. Fallback דטרמיניסטי זול ("הקישו 1 לאישור, 2 לסירוב").

## מחברי LLM — OpenAI / Gemini / Grok (ai-core)

**צורה אחידה לכל המחברים המודרניים:** `createXxxClient(params)` ⇒ **Promise**<Client> (חובה await); הקליינט הוא VoxMediaUnit peer (`sendMediaTo/stopMediaTo` — רק לקליינטים קוליים); `clearMediaBuffer` = פרימיטיב ה-barge-in; `close/id/webSocketId`; פרמטרים משותפים: **`privacy` (default false — מכבה לגמרי רישום WS), `trace` (מעלה את כל תעבורת ה-WS בטקסט גלוי ל-S3! URL ב-websocket.created), `statistics`, `onWebSocketClose`**. אירועי ספק מגיעים כ-`{client, data:{customEvent?, payload}}` כשה-payload הוא JSON גולמי של הספק.

- **OpenAI.RealtimeAPIClient (GA)**: מודל ברירת מחדל **`gpt-realtime`**, `baseUrl` קונפיגורבילי (endpoints תואמי-Realtime), **`type: REALTIME | TRANSCRIPTION`** (סשן תמלול-בלבד!); 44 אירועים כולל MCP tools, server-VAD (`InputAudioBufferSpeechStarted/Stopped`), `InputAudioBufferTimeoutTriggered`.
- **OpenAI.Beta.RealtimeAPIClient (legacy)**: מודל `gpt-4o-realtime-preview-2024-10-01`, שמות אירועים ישנים (אין לערבב namespaces), **`input_audio_format` נזרק — Voximplant שולט בפורמט האודיו על הקו**.
- **ChatCompletionsAPIClient** — **text-only** (אין sendMediaTo), מתועד מפורשות לספקים תואמי-OpenAI דרך `baseUrl` (Azure ועוד; `chat_template_kwargs` להגדרות ספק) — **מסלול bring-your-own-LLM ממדרגה ראשונה**. אירועים: `ContentDelta`, `FunctionToolCallArguments{Delta,Done}` ועוד. **`storeContext:true`** = זיכרון שיחה בצד המחבר עם סיכומים מתגלגלים אוטומטיים — **`summaryModel` ברירת מחדל gpt-4o גם כש-baseUrl מצביע לספק אחר** (להגדיר מפורשות!).
- **ResponsesAPIClient** — משטח ה-Responses API המלא (~50 אירועים, built-in tools, reasoning deltas); text-only.
- **Gemini.LiveAPIClient**: עוטף Google Gen AI Go SDK **v1.61.0 pinned**; backend `GEMINI_API` (apiKey) או `VERTEX_AI` (project+location+תוכן קובץ credentials — זווית data-residency); מודל ברירת מחדל `gemini-2.0-flash-exp` (**ניסיוני — להצמיד מודל מפורש**); `connectConfig` = passthrough גולמי; `httpOptions.baseUrl` נזרק. אירועים: ServerContent/ToolCall/ToolCallCancellation.
- **Grok.VoiceAgentAPIClient**: `xAIApiKey` חובה, מודל `grok-voice-fast-1.0`; דמוי-OpenAI-Realtime עם server VAD ו-`ResponseFunctionCallArgumentsDone`; אין baseUrl.
- **Legacy**: Dialogflow ES connector (סינכרוני, אישורי agent בפאנל, sendQuery ≤256 תווים, כוונון קול speakingRate/pitch/volumeGainDb) ו-CCAI (Google Contact Center AI; מחייב obfuscated user ids) — לא רלוונטיים ל-KALFA.

## מחברי ספקי קול — ElevenLabs / Deepgram / Ultravox / Inworld / Cartesia + VAD/Turn

**שתי צורות אינטגרציה:** (1) **voice-agent clients** מלאים (הספק מריץ ASR+LLM+TTS): Cartesia.AgentsClient, Deepgram.VoiceAgentClient, ElevenLabs.AgentsClient, Inworld.RealtimeAPIClient, Ultravox.WebSocketAPIClient; (2) **RealtimeTTSPlayers** (ראה סעיף TTS). מתודות פרוטוקול-ספק מקבלות Object גולמי בהעברה ישירה — הסכימה בתיעוד הספק, לא של Voximplant.

- **ElevenLabs.AgentsClient** (`agentId` + `xiApiKey`): פלטפורמת Agents — `ClientToolCall` ⇒ `clientToolResult()` (כלים בצד הלקוח), `UserTranscript`, `AgentResponse/Correction`, `Interruption`, `VadScore`, `ContextualUpdate`, `conversationInitiationClientData` (overrides פר-שיחה).
- **Deepgram.VoiceAgentClient**: המחבר היחיד עם **`accessToken` קצר-מועד מתועד (עדיף על apiKey)**; כל הקונפיג ב-`settingsOptions` גולמי (AgentV1Settings); עדכון חי של prompt/voice (`sendUpdatePrompt`/`sendUpdateSpeak`), הזרקת הודעות agent/user, `FunctionCallRequest/Response`. (זכור: אין ASR עברית ב-Deepgram — רלוונטי רק כ-agent עם קונפיג משלו.)
- **Ultravox.WebSocketAPIClient**: המחבר עצמו יוצר את שיחת Ultravox דרך `HTTPEndpoint` (CREATE_CALL / CREATE_AGENT_CALL / JOIN_CALL) או `joinUrl` (חובה `medium: serverWebSocket`); `hangUp(farewell?)`, `forcedAgentMessage`, `setOutputMedium` (text|voice), `Transcript`/`State`/`ClientToolInvocation`.
- **Inworld.RealtimeAPIClient**: פרוטוקול בסגנון OpenAI-Realtime (30 אירועים, server-VAD, streaming transcripts/function-calls); auth = apiKey + sessionKey, `authScheme` basic|bearer.
- **Silero.createVAD**: VAD צד-שרת — `threshold` 0.5, `minSilenceDurationMs` 300, `speechPadMs` 0; `VADEvents.Result {speechStartAt/speechEndAt בשניות}`; `reset()/close()`.
- **Pipecat.TurnDetector**: מודל end-of-turn חכם — `predict()` ⇒ `TurnEvents.Result {endOfTurn: boolean, probability 0..1}`; threshold 0.5, maxDurationSecs 8.
- באגי copy-paste בתיעוד (תיאורי HTTPResponse/WebSocketError של Deepgram מפנים ל-ElevenLabs/Cartesia) — לא מהותיים.

## VoximplantAPI — Management API מתוך התרחיש

`new Client()` עם 24 property-interfaces פר-דומיין; כל מתודה `(request) => Promise<response>` עם `error: APIError{code,msg}`. עמודי root/constructor ריקים (auth מתועד במקום אחר).

- **ScenariosInterface מכיל רק `startConference`** — **אין StartScenarios/reStartScenario מתוך תרחיש**; fan-out של סשנים חייב לעבור דרך ה-HTTP Management API החיצוני (הארכיטקטורה הקיימת של KALFA מאושררת). `StartConferenceRequest.scriptCustomData` מזין את אותו ערוץ customData (אותן מגבלות).
- **CallListsInterface**: `createCallList` (ruleId, priority, maxSimultaneous, **numAttempts 1..5**, intervalSeconds, CSV כ-`fileContent` ב-HTTP body — לא ב-URL), `appendToCallList` (הוספת אורחים מאוחרים), `getCallLists`, `editCallList` (startAt, taskPriorityStrategy first_attempts|repeated_attempts), `editCallListTasksPriority`, `cancelCallListTask` (עד 1000 ids), `cancelCallListBatch` (batchId UUID), `deleteCallList`; חלון יומי פר-רשומה דרך עמודת CSV `__start_execution_time` (UTC). **חסרים בwrapper: GetCallListDetails ו-StartNextCallListTask** — תוצאות פר-טסק ומצב manual דורשים את ה-API החיצוני.
- **HistoryInterface**: `getCallHistory` מסנן לפי **`callSessionHistoryCustomData`**, מספרים, rule, session ids; count≤1000, offset≤10000; גרסאות async ל-exports גדולים. `CallSessionInfo.logFileUrl` — **retention חודש אחד**; `finishReason` כולל Insufficient funds / Timeout / JS session error; `CallInfo` נושא `successful`, `duration`, `cost`, `endReason`, `recordUrl`, `transactionId`.
- **KeyValueStorage**: אותן מגבלות כמו ApplicationStorage (מפתח ≤200, ערך ≤2000, TTL עד 90 יום, default 30) — state משותף בין backend לתרחיש.
- **SecretsInterface**: CRUD מלא של secrets פר-אפליקציה כולל getSecretValue.
- **PSTNBlacklist**: חוסם **שיחות נכנסות בלבד** למספרי Voximplant — **לא מנגנון DNC יוצא**.
- **SMSInterface**: `a2PSendSms` (SenderID מותקן ע"י support בלבד, ≤100 יעדים, ≤1600 תווים, חיוב פר-segment >160 GSM-7 / >70 UTF-16), `sendSmsMessage` (P2P, מספר Voximplant עם SMS).
- Accounts.getAccountInfo (ניטור יתרה), OutboundTestNumbers (מספרי בדיקה מאומתים ליוצא), SmartQueue/ACD (מכונות contact-center אנושי — 23 מתודות; לא רלוונטי לבוט).

## Avatar — הבוט NLU המובנה של Voximplant

שלושה משטחים: (1) מודול VoxEngine `require(Modules.Avatar)` שמצמיד avatar לשיחה; (2) Avatar HTTP API (ערוץ טקסט חיצוני); (3) AvatarEngine — סביבת הריצה בתוך סקריפט הדיאלוג שנכתב בפורטל.

- **הצמדה לשיחה**: `createVoiceAvatar({avatarConfig:{avatarId, customData}, call, asrParameters, …})` — אוגד אוטומטית ASR+TTS+Player סביב ה-Call (barge-in דרך `interruptableAfter`, listen timeouts, end-of-phrase tuning); `createAvatar` = NLU חשוף לבנדל custom.
- **customData דו-כיווני**: AvatarConfig.customData ⇒ `getCustomData()` בסקריפט; `AvatarResponseParameters.customData` חוזר ל-VoxEngine באירועי Reply/Finish — ערוץ פרסונליזציה פר-אורח **שלא כפוף לתקרת 200 bytes** (זו חלה רק על StartScenarios).
- **כללי חובה**: `start()` רק אחרי `Events.Loaded`; **`AvatarState.onTimeout` חובה** (שגיאת runtime אם חסר); **ברירת המחדל של onErrorCallback היא `VoxEngine.terminate()`** — בפרודקשן חובה override (משפט התנצלות / התראת owner).
- **מודל הדיאלוג**: `addState`/`setStartState` + `generateResponse({utterance, nextState, listen, listenTimeout, interruptableAfter, isFinal, customData, nluHint})`; `listen` נזרק כש-nextState מוגדר; `isFinal` מתעלם מהכול חוץ מ-customData.
- **NLU**: `AvatarUtteranceEvent {text, intent|'unknown', intents, confidence, entities}`; ישויות מערכת ו-location hints בפורמט **DaData (שירות רוסי)** — הטיה RU-market; איכות עברית לא מאומתת.
- **AvatarEngine utilities**: `httpRequest` משלו (יכול לקרוא ל-ctx/cb של KALFA מתוך סקריפט הדיאלוג), טיימרים, base64/levenshtein/uuid, `SleepManager` (hibernation לסשני טקסט).
- **Avatar HTTP API**: Login ⇒ Bearer token, ואז `Conversation` עם header avatarId, מחליף `UserUtterance{text}` ב-`AvatarResponse{utterance, isFinal, customData}` — אותו avatar כבוט טקסט (WhatsApp?).

## קטגוריות שאינן רלוונטיות (מיפוי מלא, לידיעה)

- **ACD (legacy) / SmartQueue** — תורים לסוכנים אנושיים; הדפוס המתועד אם אי פעם תתווסף העברה לאדם. שים לב: `ClientDisconnected` ב-SmartQueue דורש `e.cancel()` ידני; `Waiting.ewt` — דקות ב-ACD אך אלפיות-שנייה ב-SmartQueue.
- **Conference / StreamingAgent / SequencePlayer** — ועידות/הזרמה; SequencePlayer markers שמישים לתפירת קטעי אודיו מנוקדים מוקלטים מראש.
- **MeasurementProtocol** — מימוש Google Universal Analytics MP v1 — **טכנולוגיה מתה** (Google פרשה מ-UA); לא לבנות אנליטיקות עליו.
- **CCAI + Dialogflow ES** — לא בשימוש בסטאק KALFA.

## מגבלות ו-Gotchas מרכזיים (מאוחד)

1. `VoxEngine.customData` — **200 bytes** (קבוע פלטפורמה); נפרד מ-Call.customData; שניהם נשלפים בדיעבד מ-call history.
2. **CallList: אי-דיווח = הצלחה שקטה בלי retry** — לדווח בכל מסלול יציאה.
3. `terminate()` לא שובר את הבלוק — `return;` אחריו; Disconnected לא מסיים את סשן ה-JS.
4. `Call.stopPlayback` מדכא PlaybackFinished; ElevenLabs RealtimeTTSPlayer — PlaybackFinished רק אחרי `append()`.
5. Net: timeouts 6s/90s ניתנים רק להקטנה; תקרת 2MB; מכסת בקשות פר-session (קוד 0); `Terminating` = בקשת HTTP אחת בלבד.
6. TTS cache: שבועיים, keyed by URL, **חוצה אפליקציות** — אודיו דינמי פר-אורח חייב URL משתנה; `say()` עד 1500 תווים.
7. ASR: confidence תלוי-ספק (0..1 מול 0..100); זיהוי ממשיך ומחייב אם לא נעצר ב-handler; Google עברית = `iw_IL` (קוד legacy); **Deepgram בלי עברית**; `_enhanced` יקר יותר.
8. AMD/detectVoicemail: אין מודל ישראל (AMD: EU_GENERAL הקרוב; detectVoicemail: רק ru/colombia); confidence לא אמין; תיעוד detectVoicemail לא עקבי.
9. `trace:true` מעלה את כל תעבורת ה-WS בטקסט גלוי ל-S3 — לעולם לא בפרודקשן; `privacy:true` מכבה רישום WS (חובה עם PII).
10. `WebSocketMediaEnded` = שנייה של שקט (רצפת latency); WS נכנסים ≤ שיחות+3; `wss://` דומיין בלבד.
11. handler שאינו פונקציה ⇒ סיום התרחיש (בכל המודולים); כל factories של מחברי AI מחזירים Promise (חוץ מ-createDialogflow).
12. `new Date()` = UTC — חלונות שיחה דרך `getLocalTime('Asia/Jerusalem')`; setInterval מינימום 100ms.
13. ChatCompletions `storeContext`: summaryModel ברירת מחדל gpt-4o גם עם baseUrl אחר — להגדיר מפורשות.
14. לוגים של סשנים פגים אחרי **חודש** (logFileUrl) — לייצא בתוך 30 יום.
15. PSTNBlacklist = נכנסות בלבד; DNC יוצא נשאר באחריות האפליקציה.
16. Avatar: onTimeout חובה פר-state; onErrorCallback ברירת מחדל מפילה את כל הסשן; NLU מוטה-RU.

---

## רלוונטיות ל-KALFA (מאוחד ומנוקה מכפילויות)

### תקרת 200 bytes של script_custom_data — שלושה עוקפים נטיביים
1. **ApplicationStorage / KeyValueStorage**: ה-backend כותב את מלוא הקשר השיחה (≤2000 תווים; שם אורח מנוקד, פרטי אירוע, טוקן callback) תחת מפתח קצר, מעביר רק את המפתח ב-script_custom_data, והתרחיש עושה `get` בפתיחה. TTL של ימים בודדים = המדרגה הזולה.
2. **Started.accessSecureURL + AppEvents.HttpRequest**: דחיפת הקשר מלא לתוך הסשן הרץ ב-POST מה-backend — הערוץ הרשמי.
3. **CallList**: `custom_data` פר-שורת CSV — ההקשר בכלל לא עובר דרך StartScenarios.
כמו כן: התקרה חלה רק על StartScenarios — לא על AvatarConfig.customData ולא על ערוצי in-scenario אחרים. ה-wrapper הפנימי (VoximplantAPI) לא מכיל StartScenarios — ארכיטקטורת ההפעלה מה-backend של KALFA היא הדרך היחידה ומאושררת.

### חיוב פר-נענה (per-reached-contact)
- מיפוי ישיר לאירועים: `Failed` + קוד (486/408/404/402/603) = לא הושג; `Connected`→`Disconnected` (עם cost/duration/internalCode) = הושג.
- `Terminating` מתיר בדיוק בקשת HTTP אחת — cb אחרון מובטח ל-KALFA לרקונסיליאציית תוצאה (משלים את ה-stuck-call reconciler).
- `getCallHistory` עם פילטר `callSessionHistoryCustomData` = מסלול רקונסיליאציה מ-campaign/guest id לתוצאות session (`successful`, duration, cost, endReason); לוגים פגים אחרי חודש.
- AMD יכול לחסום חיוב על משיבונים (+MIMIC נגד משיבוני-AI), אבל **אין מודל IL** — חובה ולידציה אמפירית של EU_GENERAL על משיבונים ישראליים אמיתיים לפני שמסתמכים; confidence מייעץ בלבד.
- `WebSocketMediaEnded` (שנייה שקט) ו-keepAlive מנפחים מעט duration — שוליים בחיוב.

### CallList — ההתאמה הנטיבית לקמפיינים
custom_data פר-אורח בשורה, retry בשליטת runtime (`requestNextAttempt` — "תתקשרו מחר" ⇒ start_at חדש), `result_data` כארטיפקט audit לחיוב, `numAttempts` עד 5, `__start_execution_time` פר-רשומה לחלונות שיחה (ציות לשעות חיוג בישראל), append לאורחים מאוחרים, cancel פר-טסק/batch. **חובה הנדסית: דיווח בכל מסלול יציאה** (אחרת כשל נחשב הצלחה). תוצאות פר-טסק (GetCallListDetails) — רק ב-API החיצוני.

### סודות ואבטחה
- `VoxEngine.getSecretValue` / SecretsInterface יכולים להחזיק את מפתח Groq בפאנל/אפליקציה במקום הזרמתו דרך ctx endpoint (קשור ל-open item של רוטציית המפתח שדלף).
- `Crypto.hmac_sha256` + secret משותף = חתימת payloads של cb ל-KALFA.
- דפוס עדיף כשקיים: **טוקנים קצרי-מועד** (Deepgram accessToken) שה-backend מנפיק.
- היגיינת PII: `privacy:true` בכל client/player בפרודקשן; לעולם לא `trace:true`; `enableSystemLog` נשאר false; אין Logger.write של PII (הלוגים ב-call history); `Logger.hideTones(true)` אם DTMF רגיש.

### מסלול ה-Groq (bring-your-own-LLM) — שדרוג נטיבי
- **ChatCompletionsAPIClient + baseUrl הוא תחליף מתועד ל-bridge הידני** (Groq תואם-OpenAI): streaming ContentDelta, FunctionToolCallArguments לכלים כמו save_rsvp/mark_dnc/notify_owner, ו-storeContext אופציונלי (להגדיר summaryModel מפורשות!). נשאר text-only — תואם בדיוק לארכיטקטורה הנוכחית (ASR בתרחיש + say() he-IL עם ניקוד) בלי לגעת במסלול האודיו.
- envelope ה-HTTP ל-ctx/cb: 6s connect / 90s total (הקטנה בלבד), 2MB, מכסת בקשות פר-session — ה-latency של Groq + callbacks חייב להיכנס בתוכו.
- **Silero VAD + Pipecat TurnDetector** פותרים את שתי בעיות התזמון הקשות של הצינור: קטיעה מהירה (barge-in) ו-turn-taking עברי טבעי בלי silence timeouts קבועים — יחידות WS זולות שנוצרות בתרחיש.
- חלונות שיחה: `getLocalTime('Asia/Jerusalem')` (לא Date()); `levenshtein_distance` לפאזי-מאצ'ינג של תשובות כן/לא/אולי בעברית; `PhoneNumber.getInfo` לולידציית +972 ו-MOBILE לפני חיוג בתשלום.

### הערכת ElevenLabs — שלוש רמות אימוץ
1. **קול ב-say()**: ElevenLabs הוא ספק VoiceList נטיבי — ניסוי קולות לעברית הוא שינוי שורה אחת ב-`call.say()`; איכות עברית לא מתועדת — חובה בדיקה. brand voice דרך support.
2. **Streaming TTS**: `ElevenLabs.createRealtimeTTSPlayer` + `append()` מוזן מטוקני Groq; xi-api-key מוגש דרך ctx endpoint (תקדים מפתח Groq); **PlaybackFinished רק אחרי append()** — ה-fallback מבוסס-duration לניתוק נשאר הכרחי.
3. **Agent מלא**: ElevenLabs.AgentsClient (וגם Ultravox/Deepgram) = תחליף לכל שרשרת ASR+Groq+TTS; אירועי tool-call (`ClientToolCall`/`FunctionCallRequest`/`ClientToolInvocation`) קוראים ל-ctx/cb של KALFA; Ultravox `hangUp(farewell)` + `Transcript` ממופים נקי ל-teardown ולוגינג התמלול.

### קולות ו-ASR לעברית — עובדות סגורות
- A/B קולות: 30 מועמדי `he_IL_Chirp3_HD`; מחוץ ל-Google רק Microsoft Hila/Avri ו-YandexV3 Naomi.
- ASR עברית: Google `iw_IL` + מודל `phone_call` (או Microsoft `he_IL`); **Deepgram פסול לעברית**; `ar_IL` פותח מסלול אורחים דוברי ערבית בעתיד.
- TTS caching (שבועיים, keyed-by-URL, חוצה-אפליקציות) הופך פרומפטים מנוקדים חוזרים לכמעט-חינם; אודיו דינמי פר-אורח חייב URL ייחודי.
- אין SSML בשום משטח (say(), Google RealtimeTTSPlayer) — אסטרטגיית הניקוד נשארת; `TTSOptions.request` (JSON גולמי לספק) הוא מנוף הכוונון.
- זמינות he-IL ב-Google.RealtimeTTSPlayer לא מאומתת (קולות הדוגמה בסגנון Gemini) — לאמת מול רשימת הקולות החיה של Google.

### חלופות ריאל-טיים (עתיד)
- OpenAI GA RealtimeAPIClient (gpt-realtime) = מסלול שדרוג ל-speech-to-speech עברי מלא (מחליף say()+ASR; barge-in = InputAudioBufferSpeechStarted + clearMediaBuffer); `type:TRANSCRIPTION` = STT חי בתוך התרחיש.
- Gemini Live (Vertex backend = region pinning / data residency) ו-Grok VoiceAgent — חלופות; איכות עברית לא מאומתת בכולן.
- חוזה ה-WS לכל bridge: MEDIA_ENDED אחרי שנייה שקט, tag multiplexing, wss דומיין-בלבד, מגבלת שיחות+3, TTFB דרך AudioChunksPlaybackFinished.

### Avatar — הערכה
חלופה מובנית ל-bridge של KALFA (NLU מבוסס-intents בפורטל, barge-in/timeouts מובנים), אבל ישויות המערכת מוטות-RU/DaData ואיכות עברית לא מאומתת — כנראה חלש מגישת ה-LLM prompt הנוכחית. שימושים נקודתיים: Avatar HTTP API יכול להריץ דיאלוג RSVP מאושר-קול כבוט טקסט; AvatarEngine.httpRequest משתלב בארכיטקטורת ctx/cb.

### תפעול ותשתית
- חיוג פרודקשן ל-+972 מחייב CallerID שכור/מאומת (מספרי test אסורים); OutboundTestNumbers = מסלול בדיקות מאומת בלי לרכוש מספר.
- `Accounts.getAccountInfo` = ניטור יתרה (רלוונטי ל-gate של $2.88).
- IVR DTMF = שכבת fallback זולה ואמינה ל-RSVP ("הקישו 1/2") כשמסלול ASR/LLM נכשל — נגישות + דטרמיניזם.
- SMS של Voximplant אפשרי כ-fallback אבל A2P דורש SenderID דרך support — ExtrA SMS הקיים פשוט יותר לישראל.
- לא לבנות אנליטיקות על MeasurementProtocol (UA v1 מת) — להישאר עם ctx/cb + DB + Slack alerting.
- RtpStopped (7s) = שומר dead-air; RecorderEvents חושפים cost/duration של הקלטה (והקלטה = שער משפטי ישראלי קיים).

---

### פערים שנשארו פתוחים (מכל הקבוצות)
- זמינות קולות he-IL ב-Google.RealtimeTTSPlayer — לאמת מול Google Cloud TTS החי.
- התנהגות AMD (EU_GENERAL) ו-detectVoicemail (ru/colombia) על משיבונים ישראליים — דורש A/B חי.
- איכות עברית ב-ElevenLabs voices / gpt-realtime / gemini-2.0-flash-exp / grok-voice-fast-1.0 — לא מתועדת, דורשת בדיקה.
- auth/אתחול של VoximplantAPI Client בתוך תרחיש — מתועד מחוץ ל-scope שנסרק (מדריכי Modules/Management API).
- סכימות פרוטוקול-ספק (ElevenLabs/Deepgram/Ultravox/Inworld/Cartesia) — passthrough; בתיעוד הספקים בלבד.
- קיום פרופיל ASR עברי בבנדל ה-Avatar — לא אומת (עמודי vendor לא נשלפו).
- תוצאות פר-טסק של CallList (GetCallListDetails) — מחוץ ל-namespace שנסרק; שייך לקבוצת ה-Management API החיצוני.
