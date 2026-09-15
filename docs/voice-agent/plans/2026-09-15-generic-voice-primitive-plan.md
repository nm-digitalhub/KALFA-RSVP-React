# KALFA — תוכנית: Voice Call כ-primitive גנרי במנוע התהליכים

**סטטוס:** מסמך תכנון בלבד. אין בו קוד, ואין בו שינוי ב-ElevenLabs או ב-Voximplant.
**החלטת הבעלים 2026-09-15:** סוכן ElevenLabs **אחד גנרי** עם דריסות פר-שיחה,
ולא סוכן לכל ייעוד. תסריט Voximplant אחד גנרי. `purposeKey` בוחר
**קונפיגורציה**, לא קוד.
**מה זה לא:** זה לא "סוג רביעי של שיחה" לצד RSVP / Meeting-Confirm / Sales.
שלושת אלה נשארים כפי שהם — יש להם flow ייעודי, תאימות והתנהגות חיה שאין
סיבה לשבור. זו שכבה חדשה לכל מה שנוצר דרך ה-Workflow Builder.

---

## 0. עוגנים מאומתים

כל שורה כאן נבדקה מול קוד, מסד חי, או תיעוד ראשוני ב-2026-09-14/15.
**אין לסתור שורה כאן בלי לבדוק מחדש.**

| # | עובדה | מקור |
|---|---|---|
| A-1 | צד השרת של הייעודים **בנוי ותקין**: `purpose/[purpose]/ctx/[token]` ו-`purpose/[purpose]/cb/[token]`, כולל שער טוקן `guardPurposeToolRequest` שקיים ואינו בשימוש. | קריאת הקבצים |
| A-2 | ההמתנה, ההשכמה והשחזור עובדים: לחיצת היד REGISTER→CHECK ב-`enqueue.ts:248-313`, ושתי סריקות השחזור נקראות בפועל ב-`worker/main.ts:1187-1191`. | קריאת הקוד |
| A-3 | הדיספאצ'ר שולח `{to, from, tok, u, p}` — **127 בייט מתוך תקרת 200** של `customData`. `p` הוא מפתח הייעוד. | `voice-purpose-dispatch.ts:196-203` |
| A-4 | **אף אחת מתשע הסצנריות לא קוראת את `p` ולא בונה נתיב `purpose/`.** ההערה בדיספאצ'ר מתארת כוונה שאיש לא מימש. | grep על כל `voxfiles/**/src/*.js` |
| A-5 | **קונסקוונציה של A-4:** ייעוד שיצביע על כלל של סצנריה קיימת ייכשל לגמרי — לא רק הכלים. הטוקן שלו לא יימצא ב-`call_attempts`, ה-`ctx` יחזיר 404, ואין דיווח סיום. התהליך יישאר תקוע עד פקיעת הטוקן. | `agent-tool-guard.ts:110` → `getCallAttemptByAccessToken` → `from('call_attempts')` |
| A-6 | `AGENT_ID` **מקובע בקוד** בכל אחת משלוש הסצנריות (`RSVPAgent:92`, `MeetingConfirmAgent:95`, `SalesCloseAgent:61`). | קריאה |
| A-7 | **זו בחירה שלנו, לא מגבלת פלטפורמה.** `AgentsClientParameters` הוא `{ xiApiKey, agentId, includeConversationId?, baseUrl? }` — `agentId` הוא פרמטר רגיל. | `typings/voxengine.d.ts:3900` |
| A-8 | **מוכח משיחה חיה:** המחבר של Voximplant מעביר את אובייקט `conversationInitiationClientData` אל ElevenLabs. שיחה `conv_0201m2fyxhmgetfaqs0keg0b01ex` רשומה עם `dynamic_variables` שהתסריט שלח, והסוכן השתמש בהם בדיבור. | `agents_get_conversation` |
| A-9 | **באותה שיחה `conversation_config_override` מופיע כ-`{}`** — השדה מוכר בפריים שלנו, הוא פשוט לא מולא. הוא אינו "לא נתמך". | אותה שיחה |
| A-10 | ניתן לדריסה פר-שיחה: `agent.first_message`, `agent.language`, `agent.prompt.prompt`, `agent.prompt.tool_ids`, `agent.prompt.knowledge_base`, `agent.prompt.llm`, `tts.{voice_id,stability,speed,similarity_boost}`, `asr.keywords` (עד 50), `conversation.text_only`. | תיעוד ElevenLabs |
| A-11 | **"Tool and knowledge base overrides replace the default arrays for that conversation"** — דריסת כלים היא החלפה, לא מיזוג. | ציטוט מילולי, אותו עמוד |
| A-12 | **לא** ניתן לדריסה: `platform_settings` — קריטריוני הערכה, guardrails, בטיחות, איסוף נתונים. אלה רמת סוכן. | התיעוד + `agents.update(agent_id, platform_settings=…)` |
| A-13 | ⚠️⚠️ **תוקן — הכלל הפוך ממה שכתבתי.** רשמתי "soft disallow" ככלל הכללי. **הוא היוצא מן הכלל.** ציטוט מילולי: *"For most fields, **an error will be thrown** if an override is provided when that field does not have overrides enabled."* ומיד אחריו: *"**ASR keywords use soft disallow**: if the Security toggle is off and the client still sends asr.keywords, the conversation continues and the keywords are ignored (no error)."* כלומר **רוב השדות נכשלים בקול**, ורק `asr.keywords` (וכנראה `tts.supported_voices`, השדה השני עם הסימון — ראו A-69) נבלעים בשקט. | `personalization/overrides`, ציטוט |
| A-14 | ⚠️ **תוקן יחד עם A-13.** "כשל שקט בדריסה" אינו התרחיש הכללי. עבור `first_message`, `prompt`, `tool_ids`, `language`, `voice_id` וכו' — דגל כבוי + דריסה = **שגיאה**, לא שקט. זה הופך את שלב 0 לקל **יותר** לאבחון, ובו בזמן **מסוכן יותר לפריסה** (ראו A-109). | אותו עמוד |
| A-15 | כל דגלי הדריסה אצלנו `false`, בכל ארבעת הסוכנים. | `agent_configs/*.json` |
| A-16 | `voice_purposes` = 13 עמודות של **רישום**: `key, display_name, description, rule_id, enabled, is_builtin, lead_ms, min_delay_ms, token_ttl_sec, sort_order, active, created_at, updated_at`. אין `agent_id`, אין פרומפט, אין קול. | מסד חי |
| A-17 | שלוש השורות החיות — `rsvp`, `meeting_confirm`, `sales` — **כולן `is_builtin=true` ו-`rule_id=NULL`**, ולכן חסומות פעמיים. `voice_purpose_attempts` ריקה (0 שורות). | מסד חי |
| A-18 | אילוץ קיים: `CREATE UNIQUE INDEX voice_purposes_rule_id_unique ON voice_purposes (rule_id) WHERE rule_id IS NOT NULL AND is_builtin = false`. | `pg_indexes` |
| A-19 | **הבורר כבר קורא חי מה כל כלל מריץ** — `getRules(..., { with_scenarios: true })`, ו-`scenario_id` מוצהר בטיפוס אצלנו (`core.ts:501`) אך **נזרק** ב-`voximplant-channel.ts:474`. | קריאה |
| A-20 | מיפוי שם→מזהה תסריט מעוקב בגיט: `voxfiles/.voxengine-ci/applications/<app>/scenarios/dist/*.metadata.config.json`. | קריאת הקבצים |
| A-21 | דפוס גשר הכלים: `ElevenLabs.AgentsEvents.ClientToolCall` → POST → `clientToolResult({tool_call_id, result, is_error})`. **`is_error` חובה** — ראו A-28 למקור הראשוני. | `RSVPAgent:1368-1392` |
| A-22 | בנייה: `tsc` עם `{ allowJs: true, target: 'ES2020', lib: ['ES2020'], noEmitOnError: true }`. שגיאת טיפוס **חוסמת פריסה**. | `vox-scenario.entity.js:20` |
| A-23 | `MeetingConfirmAgent` טוען `ctx` **לפני** החיוג, וכישלון הוא פטלי — לא מחייג. `RSVP.voxengine.js` דווקא מחייג בכל מקרה. הראשון הוא התבנית הנכונה. | `MeetingConfirmAgent:696-752` |
| A-24 | `guardTokenGatedToolRequest` גנרי: `scope` הוא מחרוזת חופשית ל-rate-limit, והאימות הוא טוקן→שורה. יתמוך במסלול כלי גנרי בלי שינוי. | `agent-tool-guard.ts:58-104` |
| A-25 | פלט הצומת היום הוא **טלפוניה בלבד**: `dialed, status, reason, attemptId, outcome, concluded, finishReason, durationSec`. שום דבר ממה שקרה בשיחה. | `schemas.ts:1552` |
| A-26 | `follow_up_required` קיים ב-`VoiceBusinessOutcome` ו**שום מסלול לא מייצר אותו** — כי האות היחיד שיודע עליו הוא כלי בשיחה, ושום דבר לא מוביל אותו לתהליך. | `voice-outcome.ts:30` |
| A-27 | **חמישה סוגי כלים ב-ElevenLabs, לא שניים:** `client` (רץ אצלנו, דרך התסריט), `webhook` (הם קוראים ל-API שלנו), `code` (JS בארגז חול שלהם), `mcp`, ו-`system`. **כל 13 הכלים שלנו הם `client`** — ולכן כולם עוברים דרך `TOOL_ROUTES` המקובע. | `customization/tools` |
| A-28 | `ClientToolResult` במפרט ה-WebSocket: `required: [tool_call_id, result, is_error]`. **`tool_name` אינו שדה בפריים.** קיים גם `error_type` אופציונלי, ובו `user_rejected` שמסמן שהכלי **לא נקרא כלל** — נבדל מ"נקרא ונכשל". | מפרט ElevenLabs |
| A-29 | ⚠️ **הדוגמה הרשמית של Voximplant מפרה את המפרט** — היא משמיטה `is_error` ושולחת `tool_name`. ההשמטה נמדדה אצלנו כסוגרת את ה-WebSocket ב-1008 (סשן 6760041670). הקוד שלנו נכון; אין "לתקן" אותו לפי הדוגמה. | `voice-ai-orchestration/elevenlabs/function-calling` + מדידה |
| A-30 | ✅ **נסגר — החשיפה אינה קיימת, והתיקון לא בוצע בכוונה.** ElevenLabs מגדירים `secret__` כקידומת למשתנים ש-*"should only be used in dynamic variable headers and **never sent to an LLM provider** as part of an agent's system prompt or first message"*. **נמדד 2026-09-15: `kalfa_attempt_token` אינו מוזכר באף קונפיג סוכן** — לא בפרומפט, לא במשפט פתיחה, לא בסכמת כלי, 0 הפניות בארבעתם. משתנה שאיש אינו מַשְׁרֶה **אינו נכנס להקשר של המודל מלכתחילה**. שינוי השם היה משנה את המפתח ש-`elevenlabs-payloads.ts:257` קורא מה-webhook (`correlationToken`) ושובר קורלציה — בתמורה לאפס. **הבטיחות היא תכונה של הקונפיגים ולא של השם**, ולכן נוספה שמירה: `src/lib/data/agent-configs-correlation-token.test.ts` (אומת בהזרקת תקלה). | נמדד + `dynamic-variables` |
| A-31 | ✅ **כלים מעדכנים משתנים דינמיים — ובכל הסוגים.** `assignments` ("Configuration for extracting values from tool responses and assigning them to dynamic variables") קיים ב-**client, webhook ו-system** כאחד, לא רק ב-webhook כפי ששיערתי. כלומר כלי `client` שרץ בתסריט שלנו יכול לכתוב את תוצאתו חזרה למשתנה, והסוכן ממשיך בידיעה מה נשמר. אצלנו `tool_dynamic_variable_updates: {enabled:false}`. | `api-reference/tools/create` |
| A-34 | **Voximplant ממליצים על תסריט אחד**, לא על אחד לכל סוג שיחה: *"It is a best practice to start with one scenario and implement the logic of processing different types of calls within one scenario."* | `platform/voxengine/scenarios` |
| A-35 | **`rulePattern` חסר משמעות לשיחות יוצאות:** *"The patterns work for incoming calls only. For outgoing calls, it is enough to create a rule and attach a scenario."* שיחות הייעודים יוצאות (`StartScenarios`), ולכן הכלל הוא מצביע לתסריט בלבד — מה שהופך כלל גנרי משותף לשימוש הנכון בדיוק. | `platform/voxengine/routing-rules` |
| A-36 | ⚠️ *"If you attach more than one scenario to a routing rule, they **execute in one context**."* זה המקור הראשוני לכך שחלון שני-תסריטים-על-כלל-אחד הוא תקלה חיה ולא כפילות תמימה. | אותו עמוד |
| A-37 | ⚠️ מהסקיל הרשמי: *"Do not assume `SetRuleInfo` can rebind a rule to a scenario. It may accept `scenario_id` and return success without changing the binding."* לקשירה — `BindScenario` בלבד, ואימות אחריה. | `management-api/SKILL.md` |
| A-38 | מפתח ה-API נקרא מסוד פר-אפליקציה: `VoxEngine.getSecretValue(key)`. כך `ELEVENLABS_API_KEY` עובד היום, והתסריט הגנרי לא משנה זאת — הסוד לעולם לא עובר ב-`customData`. ⚠️ המתודה מחזירה `undefined` למפתח חסר **בלי לזרוק**; תסריט שלא בודק ייכשל רק כשה-WebSocket ייפתח. | `platform/voxengine/secrets` |
| A-39 | **`ApplicationStorage` נבחן ונדחה.** `require(Modules.ApplicationStorage)` נותן מפתח-ערך פר-אפליקציה, והפיתוי הוא לשמור בו את קונפיגורציית הייעודים. אסור: הקונפיגורציה חיה ב-`voice_purposes`, ועותק ב-Voximplant היה מקור אמת שני שדורש סנכרון ונכשל בשקט בדריפט. הקונפיגורציה מגיעה ב-`ctx` בלבד. | `api-reference/voxengine/application-storage` |
| A-40 | Voximplant ממליצים על אפליקציה נפרדת לבידוד: *"Use different applications for… intentional isolation — such as `voice-ai-staging` vs. `voice-ai-production`."* | `getting-started/configure-voximplant` |
| A-41 | ⚠️ **אין היום הפרדת סביבות.** `GetApplications` חי 2026-09-15 מחזיר **אפליקציה אחת**: `kalfa-rsvp` (11107202) עם 8 כללים. `kalfatest` (11107302), שהביקורת מ-20.7 מתארת כ-sandbox עם 4 כללים, **כבר לא קיים בחשבון** — וזה גם מסביר למה מיגרציית 36 יצרה ספרייה אחת תחת `applications/`. כל כלל חדש נוחת על האפליקציה שמחייגת לאורחים אמיתיים. | `mcp__voximplant__get_applications` |
| A-42 | ⚠️ **סשן בלי שיחות מת ב-60 שניות.** התסריט הגנרי טוען `ctx` **לפני** החיוג (A-23) — כלומר כל השרשרת ctx→createAgentsClient→callPSTN חייבת להתחיל בתוך 60 שניות מתחילת הסשן. | `platform/voxengine/limits` |
| A-43 | ⚠️ **זמן ריצה של callback מוגבל לשנייה אחת.** *"heavy computations should be moved to your own infrastructure"*. הגשר הגנרי לא יכול לנתח קונפיגורציה כבדה בתוך מטפל אירוע. | אותו עמוד |
| A-44 | **מקסימום 3 בקשות HTTP פעילות**, 35 בו-זמנית כולל תור. התסריט הגנרי צורך: ctx (1) + כל קריאת כלי (N) + cb (1). קריאות כלי מקבילות ייכנסו לתור. לפני `Terminating` VoxEngine ממתין עד 90 שניות לבקשות תלויות — **והשאר נזרקות בשקט בלי callback**. | אותו עמוד |
| A-45 | `callPSTN` מפעיל `Failed` עם קוד **408 אחרי 60 שניות** ללא מענה. זה, ולא ה-TTL של הטוקן, הוא גבול הצלצול. | `voxengine/overview` + limits |
| A-46 | ⚠️ **יעדים יקרים מ-20 סנט/דקה ואפריקה חסומים כברירת מחדל.** רלוונטי לייעוד שיחייג בחו"ל. | limits |
| A-47 | תקרת WebSocket: **מספר השיחות בסשן + 3**. לסשן עם שיחה אחת — 4. חיבור ה-ElevenLabs הוא אחד מהם. | limits |
| A-48 | **הדוגמה הרשמית קוראת `agentId` מסוד, לא מקבעת:** `agentId: VoxEngine.getSecretValue("ELEVENLABS_AGENT_ID")`. מאשר את A-7. ⚠️ אבל סוד הוא **פר-אפליקציה** — סוכן אחד לכל האפליקציה, לא לכל ייעוד. לרנטיים גנרי ה-`agentId` חייב להגיע מה-`ctx`. | `voice-ai-orchestration/elevenlabs/outbound` |
| A-49 | ארבעה יעדי חיוג, לא רק PSTN: `callPSTN`, `callSIP`, `callUser`, ו-**`callWhatsappUser`** (שיחת WhatsApp Business יזומה). כולם מחזירים `Call`, כך שהתסריט הגנרי יכול לבחור יעד לפי הקונפיגורציה בלי לשנות את שאר הזרימה. | אותו עמוד |
| A-50 | הדוגמה הרשמית מגבילה משך שיחה בעצמה — `MAX_CALL_MS` עם `setTimeout` → `call.hangup()`. אין תקרת משך מובנית ב-`callPSTN`; מי שלא מגביל, לא מוגבל. | אותו עמוד |
| A-51 | ⚠️⚠️ **סדר קריטי שאינו מתועד בשום מקום אצל Voximplant.** `conversationInitiationClientData` חייב להישלח **סינכרונית ברגע ש-`createAgentsClient` נפתר, לפני `sendMediaBetween` ולפני חיבור כל מאזין** — אחרת `{{guest_name}}` וכל שאר המשתנים **נפתרים ריקים**. נמדד בשיחה אמיתית (`docs/voice-agent/qa/call-6904838502-2026-07-21.md`). ⚠️ **שתי הדוגמאות הרשמיות (inbound + outbound) לא קוראות למתודה בכלל**, ו-MCP התיעוד מודה: *"The retrieved documentation does not provide an explicit code example showing the exact line ordering."* תסריט גנרי שייכתב לפי הדוגמה הרשמית — כל ההקשר שלו יגיע ריק. | דוח QA + הקוד |
| A-52 | ⚠️ **הדוגמה הרשמית ל-function calling לא עונה לכלי לא מוכר:** `if (toolName !== "get_weather") return;` — ה-`tool_call_id` נשאר תלוי בלי תשובה. הגשר הגנרי חייב לענות על **כל** קריאה, כולל כלי שאינו רשום אצלו (`error_type: 'user_rejected'`, A-28). | `elevenlabs/function-calling` |
| A-53 | **חלוקת האחריות, מקוד הדוגמאות הרשמיות ולא מהערה שלנו:** VoxEngine הוא הבעלים של הטלפוניה — ניתוק, תקרת משך, הקלטה, סיום סשן. ElevenLabs מנהל את הדיאלוג. השרשרת: **הסוכן סוגר WebSocket → `onWebSocketClose` → התסריט קורא `terminate()`**. הסוכן **אינו** מנתק את הרגל הטלפונית; הוא מאותת, והתסריט חייב לפעול. | `elevenlabs/outbound` + `inbound` |
| A-54 | ⚠️ **אין ערובת מסירה לדיווח הסיום.** *"There is no built-in retry mechanism or delivery guarantee for `Net.httpRequestAsync` calls made during `Terminating`"*, ובקשות שנותרו בתור נזרקות בשקט (A-44). **זה מאמת את העיצוב הקיים:** ההמתנה שלנו לא נשענת על הדיווח — `redeliverStuckWaitingRuns` ותקרת ה-TTL מכסות אובדן. | MCP + limits |
| A-55 | `VoxEngine.customData('value')` **כותב** בזמן ריצה, לא רק קורא. ו-`GetCallHistory` מקבל `call_session_history_custom_data` — מסלול מתאם בין שיחה לשורה שלנו שלא היה בשימוש. | `platform/voxengine/custom-data` |
| A-56 | ⚠️ **תזכורת מתודולוגית:** ה-MCP של התיעוד מייצר תשובה, לא מצטט. באותה שאלה הוא המליץ לקרוא סודות מ-`ApplicationStorage` — **סותר את עמוד ה-Secrets** שקובע `getSecretValue`. לאמת כל טענה שלו מול העמוד המצוטט. | נצפה 2026-09-15 |
| A-57 | **ביקורת נכסים 2026-09-15.** 11 קבצי מקור מקומיים, `rules.config.json` מפנה ל-**7** בלבד, והפלטפורמה מחזיקה **11** סצנריות. הפער: `KALFA.voxengine.js` מקומי בלבד (לא בכלל, לא בפלטפורמה — **קובץ מת**); `Outgoingcall-RSVPAI` (903860) בפלטפורמה ובאפליקציה אך **לא בשום כלל**; ו-`VoiceAgentTest` (918276) חיה בפלטפורמה **בלי קובץ מקור בגיט**. | `get_scenarios` + `rules.config.json` |
| A-58 | ⚠️ **שלוש סצנריות נשארו ב-Shared folder** — `RSVPPreview` (920390), `VoiceABTest` (918274), `VoiceAgentTest` (918276) חסרות `application_id`. שרידי מיגרציית 36, שהעבירה שש ולא נגעה בהן. Shared פירושו *"available in all existing applications"* ו-*"even if you delete all apps and all rules, the shared scenarios remain intact"*. | `get_scenarios` + `platform/voxengine/ci` |
| A-59 | **סצנריה יתומה אינה ניתנת להפעלה — ניקיון, לא סיכון.** `StartScenarios` מגדיר `rule_id` כ-**required**: *"the necessary scenario needs to be attached to the rule"*. בלי כלל אין דרך להריץ אותה. ⚠️ ה-MCP טען שכן ניתן — הרחבה מעבר למקור, הפעם השנייה באותו סבב (ראו A-56). | `start-scenarios` |
| A-60 | **ביקורת שלוש סצנריות הסוכן מול הכללים שאומתו:** הסדר הקריטי (A-51) **תקין בכולן** — `conversationInitiationClientData` לפני `sendMediaBetween` (1086<1116, 449<466, 351<366). `is_error` נשלח בכולן. `onWebSocketClose` מחובר בכולן. תקרת משך קיימת (`GLOBAL_TIMEOUT_MS` / `hangupTimer`), רק בשם אחר מהדוגמה הרשמית. | קריאה |
| A-61 | ⚠️ `SalesCloseAgent` שולח `tool_name` בפריים ה-`clientToolResult` — שדה שאינו במפרט (A-28), שנטע מהדוגמה הרשמית השגויה (A-29). לא מזיק, אך יש להסירו ולא לחקות אותו בגשר הגנרי. | `SalesCloseAgent:591` |
| A-62 | ⚠️ **תוקן — הניסוח הקודם שלי היה שגוי.** כתבתי ש-`MeetingConfirmAgent` הוא היחיד ששולח טוקן; **שלושת התסריטים שולחים אותו** (`RSVPAgent:1100`, `MeetingConfirmAgent:458`, `SalesCloseAgent:358`). הטעות נבעה מסקריפט שקרא חלון טקסט צר סביב הקריאה והחמיץ שניים — grep על כל העץ הראה את התמונה. המסקנה המעשית משתנה ממילא לפי A-30: אין מה לתקן. | grep על כל העץ |
| A-63 | **כלי webhook מזדהה ברמת הסוכן, לא ברמת השיחה.** חמש שיטות נתמכות: OAuth2 Client Credentials, OAuth2 JWT, Basic, Bearer, ו-**Custom Headers** — כולן מוגדרות בהגדרות הסוכן ומחוברות לכלי. כלומר כלי webhook מזדהה כ"הסוכן", ולא כ"השיחה הזו". | `tools/webhook-tools` |
| A-64 | ✅ **אומת מסכמת ה-API — טוקן פר-שיחה כן מגיע לכלי webhook.** לכלי יש `request_headers` (map), וערך כותרת יכול להיות מחרוזת **או** אחד משלושה מצביעים: `{secret_id}`, **`{variable_name}`**, `{env_var_label}`. כלומר:<br>`"X-Kalfa-Token": { "variable_name": "secret__kalfa_token" }`<br>יחד עם A-30 (הקידומת מונעת כניסה להקשר ה-LLM) — **הטוקן החד-פעמי שלנו מגיע ככותרת, והשער הקיים יכול לאמת אותו בלי שינוי.** | `api-reference/tools/create` |
| A-65 | **הנגזרת: הגשר הגנרי אינו הכרחי לכל כלי.** כלי `client` חייב לעבור בתסריט; כלי `webhook` יכול לפנות ישירות לשרת שלנו ולהזדהות בטוקן השיחה. סט הכלים לכל ייעוד נשלח בדריסה (A-11), כך שייעוד יכול לבחור כלי webhook והתסריט הגנרי לא יידע עליהם דבר. **התסריט עדיין נדרש** לטעינת ההקשר, גישור המדיה, וניתוק — ולכלי `client` שכן צריכים ריצה בתסריט. | הצלבת A-27 · A-11 · A-64 |
| A-66 | ✅ **הפער הגדול בבדיקות — נפתר.** `agents_run_tests` מקבל `agent_config_override` מסוג `AdhocAgentConfigOverrideForTestRequestModel` = `{conversation_config (חובה), platform_settings (חובה), workflow (אופציונלי)}`. כלומר **בדיקה כן רצה נגד הקונפיגורציה של ייעוד ספציפי**, ולא רק נגד פרומפט הבסיס. הסוכן הגנרי ניתן לבדיקה פר-ייעוד. גם `repeat_count` (עד 50) ו-`branch_id` נתמכים. | סכמת `agents_run_tests` |
| A-67 | ⚠️ **הבחנה שלא הייתה קודם:** A-12 נכון לשיחה חיה — `platform_settings` אינו ניתן לדריסה בשיחה. אבל **הרנטיים של הבדיקות כן מקבל אותו**. שתי דלתות שונות: קריטריוני הערכה וחילוץ נתונים אחידים בייצור, ניתנים להחלפה בבדיקה. | הצלבה |
| A-68 | **רשימת הדריסות המלאה מהסכמה — ארוכה מ-A-11.** `ConversationConfigClientOverrideConfig`: `agent.{first_message, language, max_conversation_duration_message, prompt.{prompt, llm, tool_ids, knowledge_base, native_mcp_server_ids}}`, `conversation.{max_duration_seconds, text_only}`, `tts.{voice_id, model_id, stability, speed, similarity_boost, pronunciation_dictionary_locators, supported_voices}`, `asr.keywords`, `turn.soft_timeout_config.{message, additional_soft_timeout_messages}`. **חדשים שלא היו בתוכנית:** `max_duration_seconds` (תקרת משך פר-שיחה!), `tts.model_id`, `pronunciation_dictionary_locators`, `native_mcp_server_ids`, ומסרי ה-soft-timeout. ⚠️ `prompt.tools` **אינו** ניתן לדריסה — רק `tool_ids`. | סכמת ה-API |
| A-69 | **אומת מהמפרט הרשמי (`elevenlabs --spec`, 2.1MB): בדיוק שני שדות** נושאים `x-convai-soft-override-disallowed` — `asr.keywords` ו-`tts.supported_voices`, על פני כל וריאנטי ה-Input/Output/Override (8 מופעים). לשם השוואה, `x-convai-client-override` מופיע **117** פעם. ⚠️ **הקוטביות נשארת לא ודאית** — המפרט אינו מגדיר את ההרחבה. הקריאה הטבעית: "התנהגות ה-soft-override אסורה לשדה הזה", כלומר דריסה אסורה **נדחית** במקום להיבלע. **אך זה אינו חוסם**: בשני הכיוונים שער שלב 0 הוא "מה שנשמע", ודחייה קולנית רק מקלה לאתר. | `elevenlabs --spec` |
| A-70 | ⚠️ **סיכון עלות:** `AgentCallLimits.bursting_enabled` **ברירת מחדל `true`** — *"exceeding workspace concurrency limit will be allowed up to 3 times the limit. **Calls will be charged at double rate** when exceeding the limit."* קמפיין גנרי שמחייג במקביל יכול להיכנס לתעריף כפול בלי אזהרה. `agent_concurrency_limit` ברירת מחדל `-1` (ללא הגבלה), `daily_limit` 100,000. | `AgentCallLimits` |
| A-71 | **`conversation_history_redaction` — מנגנון שלא הכרנו לצנזור PII.** `privacy.conversation_history_redaction: {enabled, entities[]}` מוחק ישויות מהתמליל, מהאודיו **ומהניתוח**, לפי טיפוסים מדורגים (`name.name_given`, `contact_number`, `location.location_address`, `financial_id.payment_card.*`…). אצלנו `retention_days: -1` (ללא הגבלה) ואנחנו שומרים שמות וטלפונים של אורחים. | `PrivacyConfig` |
| A-72 | `trust_context` הוא שדה אמיתי עם משמעות מוגדרת: **`low` = "serves untrusted external participants — outputs should be vetted and tool access scoped"**, `high` = משרת את הבעלים. סוכן שמחייג אורחים הוא `low`. | `AgentTrustContext` |
| A-73 | **פסק זמן של כלי `client` צר מזה של `webhook`:** client 1–120 שניות (ברירת מחדל 20), webhook 5–300. הגשר הגנרי חייב לסיים בתוך 120 — וזה מתחבר למגבלת 3 בקשות HTTP פעילות (A-44). | סכמות הכלים |
| A-74 | 🚫 **חוסם: דגלי הדריסה כבויים בכל ארבעת הסוכנים.** נבדק ב-`agent_configs/*.json` (2026-09-15) — `prompt` ו-`tool_ids` **אינם מופעלים באף אחד**. מה שכן דלוק: `conversation.text_only` (RSVP + שירות-לקוחות), `asr.keywords` ו-`agent.language` (RSVP בלבד). Meeting-Confirm ו-Sales-Close: **אפס דריסות**. כל הארכיטקטורה הגנרית נשענת על `prompt` + `tool_ids` — בלעדיהם שליחת פרומפט פר-שיחה **לא תעשה דבר, ובשקט** (A-13). **זה הצעד הראשון שיש לבצע, לפני כל קוד.** | קריאת הקונפיגים |
| A-75 | ⚠️ **מקביליות בלתי מוגבלת + burst בתעריף כפול, בכל ארבעת הסוכנים.** `agent_concurrency_limit: -1`, `bursting_enabled: true`, `daily_limit: 100000`. עם A-70 — קמפיין שמחייג במקביל יכול לעבור לתעריף כפול בלי אזהרה ובלי תקרה. | קריאת הקונפיגים |
| A-76 | **שלושה שדות פרטיות בברירת מחדל בכל הסוכנים:** `trust_context: "unknown"` (מעולם לא סווג — ראו A-72, הנכון הוא `low`), `retention_days: -1` (שמירה ללא הגבלה), ו-`conversation_history_redaction: {enabled: false}` — ואנחנו שומרים שמות וטלפונים של אורחים בתמלילים. | קריאת הקונפיגים |
| A-77 | ⚠️ **תוקן — לא התנגשות אלא שתי שכבות עוקבות.** כתבתי ששני מזהי משיבון "מחליטים בלי לדעת זה על זה". **שגוי.** הם נבדלים במנגנון ובשלב: **שלנו** = `Modules.AMD` של Voximplant, **מבוסס אות/אודיו**, רץ **לפני פתיחת ה-WebSocket** — אומת בקוד: `runVoicemailGate(call, bridgeAgent)` (RSVPAgent:1526) מקבל את הגישור כ-callback ל"אדם", ו-`createAgentsClient` יושב **בתוכו** (1004). כלומר על משיבון הסוכן לא נוצר כלל — *"zero credits on a machine"*. **שלהם** = כלי מערכת מבוסס-LLM: *"The LLM analyzes conversation patterns to identify voicemail systems based on automated greetings"*, כלומר **רק אחרי שהשיחה התחילה**. **הגנה לעומק, לא תחרות** — והשכבה השנייה חיונית דווקא כי שלנו fail-open ו-*"there is NO Hebrew/IL AMD model — EU_GENERAL is UNVALIDATED on +972 voicemail"*. | הקוד + `system-tools/voicemail-detection` |
| A-78 | **`language_detection` לא עקבי בין הסוכנים:** דלוק ב-Meeting-Confirm ו-Sales-Close, **כבוי ב-RSVP** — כולם `language: he`. כלומר שני סוכנים רשאים להחליף שפה באמצע שיחה עם אורח ישראלי ואחד לא. לסוכן גנרי זו החלטה אחת שחייבת להיות מפורשת. ⚠️ ולפי הסכמה יש `only_at_conversation_start` שמצמצם החלפה שגויה — לא בשימוש אצלנו. | הקונפיגים + `LanguageDetectionToolConfig` |
| A-79 | ⚠️ **`KALFA-RSVP-שירות-לקוחות`: כל 14 כלי המערכת כבויים, כולל `end_call`.** סוכן שאינו יכול לסיים שיחה בעצמו. | הקונפיגים |
| A-80 | ⚠️ **שלושה מקורות, שלוש רשימות שונות של כלי מערכת.** התיעוד מונה **8**; סכמת ה-MCP (`BuiltInTools-Input`) מונה **7** ואינה כוללת את `update_state` שהתיעוד כן מתאר; הקונפיג החי מחזיק **14** — ובהם `memory_entry_search`, `run_subagent`, `request_help` ו-ארבעה `transfer_to_genesys*` שאינם באף אחד מהשניים. **הקונפיג החי הוא המקור השלם ביותר**, ואף מסמך אינו ממצה. | הצלבת שלושתם |
| A-81 | ✅ **הדגלים ניתנים לקביעה בזרימה הרשמית — A-74 הוא מטלה, לא עיצוב מחדש.** הוכח מההיסטוריה בלי לכתוב לסוכן חי: `conversation.text_only` ו-`agent.language` נקבעו ב-`6121baf` (23.8) ו**שרדו `pull --update` חוזר** ב-`d75e1ea` (7.9); `asr.keywords` נוסף ב-`d75e1ea` וקיים ב-HEAD. כלומר `platform_settings.overrides` **אינו** שדה שהשרת בולע — הוא עושה round-trip. **המכניזם:** `elevenlabs agents pull --update` → עריכה → `agents push` → `pull --update` לאימות (§6.1; `agents status` **אינו** בודק drift). הפקודה לבעלים, לא לי. | היסטוריית גיט + §6.1 |
| A-82 | ⚠️ **MCP בשיחה יוצאת חוסם את עצמו בברירת מחדל.** `MCPApprovalPolicy` ברירת מחדל `require_approval_all` — *"the agent will request **your** permission before each tool use"*. **בשיחה יוצאת לאורח אין אדם ליד קונסולה שיאשר.** שלושת המצבים: `require_approval_all` (ברירת מחדל), `require_approval_per_tool` (פר-כלי: auto / approval / disabled), `auto_approve_all`. ייעוד שמשתמש ב-MCP חייב לקבוע מדיניות מפורשת. | `tools/mcp` + `MCPApprovalPolicy` |
| A-83 | ⚠️ **סט הכלים של שרת MCP יכול להשתנות בלי פריסה אצלנו.** *"The tools and capabilities available from an integrated MCP server are defined by that external server and **can change if the server's configuration is updated**."* לרנטיים גנרי זו הרחבת משטח שמחוץ לשליטתנו — בניגוד לכלי `client`/`webhook` שהסכמה שלהם קבועה אצלנו. | אותו עמוד |
| A-84 | **שני סוגי MCP, ורק אחד ניתן לדריסה פר-שיחה:** `native_mcp_server_ids` נמצא ב-`PromptAgentAPIModelOverride` (ולכן ניתן להחלפה פר-ייעוד), **`mcp_server_ids` אינו** — הוא רמת סוכן בלבד. שניהם מוגבלים ל-10. | סכמת ה-API |
| A-85 | **הבהרה:** `api.elevenlabs.io/v1/mcp` (*hosted MCP*) הוא לניהול הסוכנים **מ**-Claude — וזה מה שאני משתמש בו לקריאת הסכמות. `tools/mcp` הוא ההפך: מתן גישה לסוכן **אל** שרתים חיצוניים. שני דברים שונים לגמרי עם אותו שם. | `operate/hosted-mcp` |
| A-86 | ⚠️ **מלכודת: `npx voxengine-ci` מהשורש שובר את הבנייה; רק `npm run vox:upload` עובד.** voxengine-ci מריץ `npx tsc -p <temp>`, והקונפיג שהוא מייצר **אינו כולל `rootDir`**. TypeScript 6 דורש אותו כש-`outDir` מוגדר → `TS5011`, הבנייה נכשלת. הריפו מצהיר `typescript: ^6.0.3`, אבל **voxengine-ci מביא TypeScript 5.5.4 משלו** ב-`node_modules/@voximplant/voxengine-ci/node_modules/`, ו-`vox:upload` עושה `cd` לתיקייה שלו — כך ש-`npx tsc` נפתר ל-5.5.4 והבנייה עוברת. **נמדד 2026-09-15:** מהשורש `TS5011`/exit 1; דרך הסקריפט `Scenarios have been successfully built`/exit 0; והוספת `rootDir` ידנית ל-קונפיג משוחזר נתנה 0 שגיאות — מה שמאשר את האבחנה. **לעולם לא להריץ `npx voxengine-ci` ישירות.** | נמדד בבידוד |
| A-87 | ⚠️ **רק ל-RSVP יש נתיב קורלציה עצמאי — נבדק מול הסכמה החיה.** מארבע טבלאות הניסיונות, **רק `call_attempts` מחזיקה `el_correlation_nonce`**. ל-`callback_request_attempts`, `sales_call_attempts` ו-**`voice_purpose_attempts`** (הנתיב הגנרי!) יש רק `el_conversation_id`, שנכתב **בקריאה החוזרת הסופית בלבד**. עם A-54 (אין ערובת מסירה) — cb אבוד = שיחה שאי אפשר לקשר. **לתכנון הגנרי: `voice_purpose_attempts` יורשת בדיוק את הפער הזה**, ויש לשלוח מזהה שקיים בזמן `ctx`. | `pg_attribute` על ה-DB החי |
| A-88 | **`el_conversation_id` נוצר במהלך השיחה, לא לפניה** — ולכן קריאתו ב-`ctx` (שרץ לפני החיוג) מחזירה תמיד ריק. הוכח בשיחה חיה: `conv_0201m2fyxhmgetfaqs0keg0b01ex` נושאת `"kalfa_attempt_token": ""` בעוד שורת הניסיון שלה **כן** מקושרת — הקישור מגיע כולו מה-cb. תוקן ל-`ctx.attempt.id`. | שיחה חיה + הקוד |
| A-89 | **הנזק היפותטי, לא נצפה — נמדד.** 13 ניסיונות ב-`callback_request_attempts`: 10 מקושרים, ו-**3 הלא-מקושרים הם שיחות שלא נענו** (`sip_480`, `sip_408` ×2, כולן `call_duration_sec: 0`) — לא הייתה שיחה לקשר. **אפס מקרי cb אבוד.** התיקון הוא הגנה לעומק מפני התנהגות מתועדת, לא תיקון אובדן שקרה. | שאילתה על ה-DB החי |
| A-90 | 🚫 **הפגם החמור ביותר שנמצא הלילה — ארבע מחמש הפרסונות לא הגיעו למקשר בכלל.** נמדד: **22 מתוך 42 שורות `call_analysis` ללא `attempt_id`, ו-6 מהן הגיעו אחרי 14.9** — אחרי שנוסף `ATTEMPT_TABLES` עם כל חמש הטבלאות. ההרחבה נכונה אך **בלתי נגישה**: ל-`resolveAttempt` יש קורא אחד בלבד, `storeCallAnalysis` (נתיב RSVP). שיחת Meeting-Confirm לא מגיעה לשם — `isRsvpConversation` בודק רק `call_attempts` — ולכן היא נופלת ל-`storeSalesCallAnalysis`, שהעביר `{}` ככלינק. **תוקן.** | שאילתה על ה-DB החי |
| A-91 | **שלוש השערות שנבדקו ונפסלו לפני שהגעתי לשורש** — תיעוד השיטה: (1) **לא מרוץ** — הניתוחים מגיעים **27–71 שניות אחרי** שה-cb כתב `el_conversation_id`. (2) **לא הטוקן הריק** — `cb40b5b4` שלחה `""` ובכל זאת מקושרת. (3) **לא עמודה חסרה** — כל חמש הטבלאות מחזיקות `el_conversation_id`. ⚠️ כל אחת מהן נשמעה סבירה ושלושתן היו שגויות. | מדידה |
| A-92 | ⚠️ **ארבעת מסלולי ה-ctx לא מסכימים על שם המפתח.** RSVP/mtg/sls שולחים `kalfa_attempt_token`; **הנתיב הגנרי שולח `kalfa_attempt_id`** — ו-`elevenlabs-payloads.ts` קרא רק את הראשון, כך שערך הקורלציה של ייעוד נזרק לפני שהפך ל-`correlationToken`. תוקן לקרוא את שניהם. **לתכנון: לאחד על שם אחד.** | קריאת ארבעת המסלולים |
| A-93 | **ה-webhook של ElevenLabs הוא שולח נפרד מה-cb של VoxEngine.** לכן טוקן שנשלח ב-`ctx` וחוזר ב-webhook **שורד cb אבוד**, בעוד `el_conversation_id` (שנכתב רק ב-cb) לא. זו הסיבה ש-`resolveAttempt` מתאים עכשיו גם את הטוקן מול `id` בארבע הטבלאות ללא nonce. | הצלבת A-54 + הקוד |
| A-94 | ⚠️ **כל ה-webhooks של ElevenLabs נוחתים בנקודת המכירות — אף אחד ב-RSVP.** נמדד ב-`webhook_inbox`: **16 שורות `el_analysis_sales`, ו-0 שורות `el_analysis_rsvp`**. כלומר `processElevenLabsSalesAnalysisRow` הוא נתיב הקליטה של **כל** הפרסונות, ו-`isRsvpConversation` הוא ה"חילוץ" היחיד חזרה לחנות ה-RSVP. **לתכנון הגנרי: ייעוד חדש ייקלט שם, לא בנתיב RSVP.** | `webhook_inbox` החי |
| A-95 | **רק Sales-Close מוצמד ל-webhook מפורש** (`post_call_webhook_id`); RSVP, Meeting-Confirm ושירות-לקוחות רצים על ברירת המחדל של סביבת העבודה. ⚠️ **ושני ה-webhooks הפעילים מצביעים ל-`beta.kalfa.me`** — זה של הייצור (`kalfa.me/api/elevenlabs/rsvp/update`) **מושבת**. | `elevenlabs webhooks list` + הקונפיגים |
| A-96 | **השרשרת שהוכחה מקצה לקצה בנתונים חיים:** 6 שיחות Meeting-Confirm עם `token: ""` → `isRsvpConversation` false → `storeSalesCallAnalysis` עם `{}` → `attempt_id` NULL. מולן 2 שיחות RSVP עם nonce אמיתי → חולצו → **מקושרות**. אותו webhook, אותו מעבד, תוצאה הפוכה — **והמשתנה היחיד הוא הטוקן**. | `webhook_inbox` JOIN `call_analysis` |
| A-97 | ✅ **הוחל 2026-09-15 והתוצאה אומתה.** `20260914232506`: **22 יתומים → 8**. 10 שורות ל-`callback_request_attempts`, 4 ל-`sales_call_attempts` — בדיוק כפי שספירת היבש חזתה. **האינווריאנטה החזיקה: 0 `call_attempt_id` בשתי הטבלאות האלה**, ו-20/20 ב-`call_attempts`. `gen:types` + `types:check` עברו. 8 הנותרים ללא ניסיון בשום טבלה: 4 RSVP מ-21.07, 2 Sales-Close, 2 שירות-לקוחות. | אומת על ה-DB אחרי ההחלה |
| A-98 | ⚠️ **אי-עקביות מורשת, קוסמטית:** 4 מ-8 היתומים נושאים `linked_at` מלא בלי `attempt_table` — שורות מ-21.07 שקדמו לזוג הפולימורפי, שלא נגעתי בהן (ה-UPDATE רץ רק על שורות שהתאימו ל-JOIN). **אין השלכה:** `linked_at` נכתב בלבד; אף שאילתה באפליקציה אינה קוראת אותו. מתועד ולא תוקן — מיגרציה ל-4 שורות תצוגתיות אינה מוצדקת. | grep על כל src/ |
| A-99 | 🚫 **`voice_purpose_attempts` — הטבלה של הנתיב הגנרי — היחידה ללא אינדקס ייחודי על `el_conversation_id`.** ארבע האחרות מחזיקות `UNIQUE … WHERE el_conversation_id IS NOT NULL`; החדשה ביותר לא. `resolveAttempt` קורא אותה ב-`.maybeSingle()`, כך ששתי שורות שיטענו לאותה שיחה יזרקו **בזמן קריאה**, לא בזמן כתיבה. הטבלה ריקה היום — לתקן עכשיו זול, אחר כך יקר. | `pg_index` על ה-DB החי |
| A-100 | ✅ **הוחל ואומת בבדיקה שלילית — האילוצים נושכים.** `20260914233659` הוסיף: אינדקס ייחודי חלקי ל-`voice_purpose_attempts`; `call_attempt_id` מותר רק עם `attempt_table = 'call_attempts'`; `linked_at` צמוד לזוג. ⚠️ **אילוץ שקיים אינו אילוץ שנושך** — נבדק בבלוק PL/pgSQL עם rollback מכוון: שלוש הפרות מכוונות (מפתח זר על טבלה זרה, ניתוק הזוג תחת `linked_at` מלא, `attempt_table` בדוי) — **שלושתן נדחו**, והנתונים לא השתנו. PostgreSQL נרמל את `IS NOT DISTINCT FROM` ל-`NOT (… IS DISTINCT FROM …)` — אותה סמנטיקה. מצב: 20 `call_attempts` (20 FK), 10 Meeting-Confirm (0 FK), 4 Sales-Close (0 FK), 8 יתומים (0 `linked_at`). | אומת אחרי ההחלה |
| A-101 | **חידוד שהבעלים ניסח (2026-09-15):** אין כלל של Supabase נגד `linked_at` — 4 השורות שנמצאו **מוכיחות עובדתית** שהאינווריאנטה לא הייתה קיימת בסכימה, ולכן לא היה נכון להסיק ממנו קישור. הפתרון שנבחר אינו להימנע מהעמודה אלא **לאכוף את האינווריאנטה במסד ולהפוך אותה לאמינה**. | הכרעת הבעלים |
| A-102 | ✅ **נפרס ואומת 2026-09-15 ~02:45.** חמשת הסימנים של התיקון נמצאים ב-`dist/worker.cjs` (נבנה 02:44:32): `kalfa_attempt_id`, `attemptTable`, שתי הטבלאות החדשות ברשימה, ווקטור ההתאמה טוקן↔`id`. `kalfa-worker` עלה מחדש **אחרי** הבנייה (`↺ 57→58`). | אימות אחרי הפריסה |
| A-103 | ⚠️ **תוקן — הטענה הקודמת שלי הייתה שגויה.** כתבתי שהפריסה משאירה את הוורקר על קוד ישן. **לא נכון.** `npm run deploy` מריץ `scripts/worker-build-restart.mjs` **אחרי** `pm2 restart kalfa-beta`, והסקריפט מחשב sha256 לפני ואחרי הבנייה ומפעיל מחדש כשהחשיף השתנה **או** כשהתהליך אינו `online`. מה שראיתי ב-02:44 היה **פריסה באמצע ריצה**: beta כבר עלה (02:43:42), תור הוורקר עוד לא הגיע. ב-`pm2 status` שאחריו כל התהליכים היו ב-~42 שניות ו-`kalfa-worker` ב-`↺58` — השלב רץ כשורה. **הלקח האמיתי: לא לקרוא מצב פריסה בזמן שהיא רצה.** | `package.json` + `worker-build-restart.mjs` |
| A-104 | ✅ **נסגר — מעולם לא הייתה חריגה. הטענה שלי הייתה שגויה.** דיווחתי ששתי שיחות RSVP מראות `conversation_config_override` ריק בעוד משתנים דינמיים נרשמו, וקראתי לזה סתירה. **הכרונולוגיה מפריכה זאת:** `conv_8101m1ye` רצה ב-**07.09 20:20** ו-`conv_3001m1xx` ב-**07.09 15:30**, והקוד שמוסיף את `asr: {keywords}` ל-RSVPAgent נכנס ב-`d75e1ea` ב-**07.09 23:22** — **שעות אחרי שתיהן.** התסריט שרץ לא שלח שום דריסה, והרשומה דיווחה על כך נאמנה. ⚠️ **השורש: הנחתי שהתסריט שרץ תואם למקור של היום.** גם `conv_3001` חסרה `event_kind`, סימן נוסף לגרסה ישנה, ולא צירפתי אותו. | git log מול חותמות השיחות |
| A-105 | ✅ **נסגר יחד עם A-104.** לא נותרה שאלה פתוחה: אין ראיה שדריסה נבלעה. התיעוד (A-13) קובע שדגל כבוי + דריסה = **שגיאה** ברוב השדות, ו-`asr.keywords` הוא היוצא מן הכלל השקט — ושם הדגל דלוק ממילא. ⚠️ **מה שנשאר פתוח הוא A-8/A-9 בלבד:** טרם נצפתה דריסה שמשנה התנהגות בפועל. זה בדיוק שער שלב 0. | הצלבה |
| A-106 | **המסקנה המעשית לשלב 0 — והיא מחזקת את התכנון:** `asr.keywords` **אינו נשמע**, ולכן איש לא היה מבחין אם הוא נבלע. `first_message` **כן נשמע**. זו בדיוק הסיבה שהשער חייב להיות **מה שנשמע** ולא הרשומה ולא היעדר שגיאה. ⚠️ **ואל תשתמשו ברשומת השיחה כשער** — A-104 מראה שהיא עשויה להראות `null` גם כשנשלח משהו. | הצלבה |
| A-107 | **VAD רץ אצל ElevenLabs ומדווח ל-VoxEngine.** `AgentsEvents.VadScore` הוא אירוע שה**מחבר מקבל**: *"Voice Activity Detection score event. Indicates the probability that the user is speaking"*, והתיעוד מקשר לטקסונומיית ה-**client events של ElevenLabs**. גם `turn_model: turn_v3` יושב בקונפיג שלהם. **זיהוי הדיבור והתורות אינם בצד הטלפוניה.** | `api-reference/voxengine/elevenlabs` |
| A-108 | **DTMF הוא כולו באחריות VoxEngine — למחבר אין מסלול כלל.** אפס אזכורי DTMF/keypad/tone במפרט המודול, ואין אירוע כזה ב-`AgentsEvents`. לקליטה: `call.addEventListener(CallEvents.ToneReceived, …)` בתסריט; להעברת המשמעות לסוכן: `contextualUpdate()` / `userMessage()` / `clientToolResult()`; לשליחת צלילים החוצה: מתודות ה-`Call`, **לא דרך המחבר**. ⚠️ **נגזרת:** `play_keypad_touch_tone` ו-`dtmf_input_settings` בקונפיג הסוכן שייכים לאינטגרציות הטלפוניה **שלהם** (Twilio/SIP trunk) — **דרך המחבר הם ככל הנראה חסרי השפעה**. אצלנו הם כבויים. | MCP + מפרט המודול |
| A-109 | 🚫 **סיכון פריסה שנוצר הלילה — אל תעלו את `SalesCloseAgent` לפני שהדגל בשרת.** התסריט שולח עכשיו `conversation_config_override.agent.first_message` כש-`ctx.first_message_override` מלא. לפי A-13, **שדה מושבת + דריסה = שגיאה**. הדגל הודלק **מקומית בלבד**; בשרת הוא עדיין `false` (אומת: `override_first_message: false`). **הסדר המחייב:** (1) `agents push` + `pull --update` שמאשר `true` בשרת → (2) רק אז `vox:upload:salesclose`. ⓘ מיתון מובנה: כל עוד `ctx` אינו מחזיר `first_message_override`, הערך `''` והשדה מושמט לגמרי — כך שהעלאה מוקדמת אינה מזיקה **כל עוד מסלול ה-ctx לא עודכן**. | הצלבת A-13 + הקוד |
| A-110 | **A-104 מצטמצם ואינו מדאיג.** RSVP שולח `asr.keywords` — **בדיוק השדה עם soft disallow** — והדגל שלו דלוק, ולכן אין שגיאה בשום מקרה. הרשומה שמראה `asr: null` היא לכל היותר עניין של הֵדהוד ברשומה, לא דחייה. ⚠️ **עדיין לא אומת שהדריסה אכן משנה התנהגות** (A-8/A-9), אבל התרחיש המדאיג — "נשלח ונבלע בשקט למרות שהדגל דלוק" — **אינו נתמך בתיעוד**. | הצלבת A-13 |
| A-111 | ✅ **שלב 0, חצי ראשון — בוצע ואומת 2026-09-15 03:30.** `first_message` הודלק על `KALFA-Sales-Close` דרך `agents push`, ו-`pull --update` שאחריו מחזיר `true`. **הצורה הקנונית לא בלעה אותו.** שאר הדגלים נותרו `false` — הדיף הוא שורה אחת. **המכניזם מוכח מקצה לקצה:** `pull --update` → עריכת שדה בודד → `push` → `pull --update` מאשר. A-81 היה נכון, וכעת נמדד ולא מוסק. ⚠️ **A-109 אינו חוסם עוד** — הדגל בשרת, כך שהעלאת `SalesCloseAgent` בטוחה. | נמדד |
| A-112 | ✅ **נענה מהמקור הרשמי: ההחלפה נעשית בצד הלקוח, לא ב-`{{}}`.** כל דוגמאות הדריסה בתיעוד בונות את המחרוזת עם **f-string של Python** — `f"Hi {customer_name}, how can I help you today?"`, `f"The customer's bank account balance is {customer_balance}"`. כלומר הערך מוחלף **לפני השליחה**, ואין ולו דוגמה אחת של `{{משתנה}}` בתוך דריסה. ⚠️ זו ראיה לדפוס המיועד, לא הוכחה ש-`{{}}` ייכשל — אבל **לשלב 2 המסקנה חד-משמעית: מסלול ה-`ctx` יחליף את הערכים בשרת** ולא יישען על השראה לא מתועדת. הגבול אומת גם מצד Voximplant: המחבר מעביר את המטען ללא נגיעה. | `overrides.md` הרשמי |
| A-113 | **עיצוב ה-probe נגזר מ-A-112: טקסט פשוט, אפס משתנים.** probe שמכיל `{{prospect_name}}` ונשמע מילולית יהיה **דו-משמעי** — הדריסה נדחתה, או שרק ההשראה לא חלה? טקסט פשוט עונה על **שאלה אחת בדיוק**: האם הדריסה משנה התנהגות (A-8/A-9). ⚠️ שאלת ההשראה נשארת פתוחה ורלוונטית לשלב 2 — עמודת `first_message` ב-§3.1 תרצה משתנים. | נגזרת |
| A-114 | ⚠️⚠️ **הסקרייפר מחמיץ תוכן בעמודים עם לשוניות — הקורפוס המקומי אינו מלא.** `overrides.md` הרשמי הוא **13,135 בייט**; מה שהסקרייפר שמר היה **6,048**. החסר כולל מקטע שלם — **"Update via the CLI"** עם `pull → edit agent_configs/<name>.json → push`, בדיוק התהליך שאנחנו מריצים — וכל דוגמאות ה-Python/JS שבהן נמצאה התשובה ל-A-112. **הסיבה:** התיעוד מגיש לשוניות (dashboard / CLI / API), והסקרייפר קורא רק את ה-DOM הגלוי. **המסקנה התפעולית: להעדיף `curl <url>.md`** — ElevenLabs מגישים Markdown נקי לכל עמוד, ואינדקס מלא ב-`elevenlabs.io/docs/llms.txt`. | הושווה בפועל |
| A-115 | ✅ **כל שמונת עמודי ElevenLabs היו חלקיים — והעוגנים שרדו את האימות מחדש.** יחס `.md` מול הסרוק: `system-tools` **4.1×** (3,123 מתוך 12,778 — 24% בלבד), `data-collection` ו-`webhook-tools` 2.5×, `mcp` ו-`overrides` 2.2×, `dynamic-variables` 1.9×, `agent-testing` 1.7×, `post-call-webhooks` 1.5×. **אף אחד לא נתפס במלואו.** ✅ **ובכל זאת, שלושת העוגנים נושאי המשקל אומתו מילולית מהגרסה המלאה:** A-13 (*"For most fields, an error will be thrown…"*), A-11 (*"Tool and knowledge base overrides **replace** the default arrays"* + *"maximum 50 keywords"*), A-80 (שמונה כלי מערכת, אותה רשימה). | השוואה מלאה |
| A-116 | **A-64 אינו נשען על עמוד ה-webhook-tools — וטוב שכך.** המקטעים שהסקרייפר החמיץ (*Headers*, *Dynamic variable assignment*) הם משפט אחד + **צילום מסך**; הפרטים בתמונה, ו-Markdown אינו מגיש אותם. הביסוס של A-64 הוא **סכמת ה-API ליצירת כלי** — `request_headers` שערכו `{secret_id}` / `{variable_name}` / `{env_var_label}` — כלומר מקור מכונה, לא פרוזה. ⚠️ **מסקנה שיטתית: כשעמוד מפנה לתמונה, לרדת לסכמה.** | הצלבה |
| A-32 | `MCP.Client` של VoxEngine **אינו** דרך לעקוף את טיפול הכלים של המחבר. הספק מפורש: *"the client does not replace connector-specific tool handling by itself"*. הוא הסצנריה שקוראת החוצה לשרת MCP. | `voxengine-dev/reference.md` |

---

## 1. הארכיטקטורה

```
Workflow Builder
      ↓  action.start_voice_call (purposeKey)
KALFA server
      ↓  StartScenarios(rule_id, {to, from, tok, u, p})
כלל גנרי אחד  →  תסריט גנרי אחד
      ↓  GET /api/voximplant/purpose/{p}/ctx/{tok}
      ←  { agent_id, dynamic_variables, overrides, tools }
      ↓  createAgentsClient({ agentId })
      ↓  conversationInitiationClientData({ conversation_config_override, dynamic_variables })
ElevenLabs — סוכן גנרי אחד
      ↕  ClientToolCall  →  POST /api/voximplant/purpose/{p}/tool/{name}/{tok}
      ↓  POST /api/voximplant/purpose/{p}/cb/{tok}
KALFA server  →  מעיר את התהליך  →  הצומת מחזיר תוצאה + מה שהכלים עשו
```

**החלוקה הקבועה:**

| שכבה | אחריות |
|---|---|
| Workflow | מה העסק רוצה שיקרה |
| KALFA server | למי, באיזה הקשר, איזה סוכן, ניסיונות, אבטחה, התמדה, השכמה |
| תסריט Voximplant גנרי | לבצע את השיחה |
| ElevenLabs | לנהל את השיחה |
| Callback | להחזיר עובדות |
| Workflow outcome | מה עושים אחר כך |

**ה-business logic לא חי בתסריט הטלפוניה.** התסריט לא יודע אם זו שיחת משוב,
תזכורת תשלום או אישור הגעה — הוא מריץ פרוטוקול.

---

## 2. הגבול שהארכיטקטורה הזו לא חוצה

לפי A-12 ו-A-13, תחת סוכן גנרי יחיד:

| | |
|---|---|
| ✅ שונה לכל ייעוד | פרומפט, משפט פתיחה, קול, שפה, LLM, סט כלים, בסיס ידע, מילות ASR — **ולפי A-68 גם** תקרת משך השיחה (`max_duration_seconds`), מודל ה-TTS, מילון הגייה, ו-MCP servers |
| ❌ משותף לכולם **בשיחה חיה** | קריטריוני הערכה, guardrails, בטיחות, איסוף נתונים |
| ⚠️ אבל **בבדיקות כן ניתן לדרוס** | A-66: `agents_run_tests` מקבל `agent_config_override` הכולל `platform_settings` מלא — כך שכל ייעוד נבדק מול הקונפיגורציה שלו |

**זה לא תיאורטי.** הסוכנים הקיימים מחזיקים קריטריונים ספציפיים לפרסונה —
*"לא נקרא זמן קונקרטי אחרי reschedule"* (Meeting-Confirm), *"הגילוי המשפטי
נמסר במלואו לפני מחויבות"* (Sales-Close). אלה **לא ניתנים להעברה** לרמת
הייעוד.

**מסקנה שצריכה להיכנס להחלטה במפורש:** הסוכן הגנרי יישא סט קריטימיונים אחד,
משותף, שמנוסח ברמת "כל שיחה יוצאת מטעם קלפה" ולא ברמת פרסונה. ייעוד שדורש
רף איכות משלו — יישאר עם סוכן נפרד, וזה נתיב לגיטימי שהארכיטקטורה תומכת בו
(A-7: `agentId` מגיע מהקונפיגורציה, אז ייעוד יכול להצביע על סוכן אחר).

---

## 3. מה משתנה, איפה

### 3.1 מסד — `voice_purposes` מרישום לקונפיגורציה

עמודות חדשות, **כולן nullable**, ובלי CHECK ובלי enum (ראו החלטת הבעלים
10.9 על סכמות נוקשות):

| עמודה | טיפוס | תפקיד |
|---|---|---|
| `agent_id` | text | סוכן ElevenLabs. ברירת מחדל = הגנרי. |
| `prompt` | text | דריסת `agent.prompt.prompt` |
| `first_message` | text | דריסת `agent.first_message` |
| `language` | text | דריסת `agent.language` |
| `voice_id` | text | דריסת `tts.voice_id` |
| `llm` | text | דריסת `agent.prompt.llm` |
| `tool_ids` | jsonb | דריסת `agent.prompt.tool_ids` — **מחליף מערך** (A-11) |
| `knowledge_base` | jsonb | דריסת `agent.prompt.knowledge_base` |
| `asr_keywords` | jsonb | עד 50 (A-10) |
| `variables` | jsonb | מפת משתנים דינמיים |
| `max_duration_seconds` | int | דריסת `conversation.max_duration_seconds` — **ל-`callPSTN` אין תקרת משך משלו** (A-50), אז זו התקרה היחידה בצד ElevenLabs |
| `tts_model_id` | text | דריסת `tts.model_id` |
| `pronunciation_dictionary_locators` | jsonb | דריסת `tts.pronunciation_dictionary_locators` — **הגייה עברית פר-ייעוד** |

*שלוש האחרונות התגלו ב-A-68 מתוך `ConversationConfigClientOverrideConfig`
במפרט הרשמי; הן לא היו בגרסה הראשונה של הטבלה.*

**שני תנאים, לא אחד — ושליחה שגויה מפילה את השיחה.**

`NULL` = אל תשלח את השדה. לא "שלח ריק" — A-11: דריסת כלים **מחליפה** את
המערך, אז מערך ריק בטעות ישאיר את הסוכן בלי כלים.

⚠️ **אבל זה לא מספיק.** לפי A-13, ציטוט מילולי מהתיעוד: *"For most fields,
**an error will be thrown** if an override is provided when that field does
not have overrides enabled."* כלומר שדה שהדגל שלו כבוי בסוכן + ערך שנשלח =
**שגיאה שמפילה את השיחה**, לא בליעה שקטה. היוצא מן הכלל היחיד הוא
`asr.keywords` (ו-`tts.supported_voices`), שנבלעים בשקט.

**הכלל המחייב לבניית הפריים:**

> שלח שדה רק אם `value IS NOT NULL` **וגם** הדגל המתאים ב-
> `platform_settings.overrides.conversation_config_override` של אותו
> `agent_id` הוא `true`.

**נגזרת תפעולית:** הדגלים אינם חלק מהשורה במסד — הם חיים על הסוכן ב-
ElevenLabs. ⚠️ **ייעוד שמצביע על `agent_id` שדגליו כבויים ישבור כל שיחה
שלו**, ולכן שלב 1 חייב לוודא שכל דגל שהטבלה הזו יכולה לאכלס דלוק על הסוכן
הגנרי — ו-A-74 מדד שהיום **`prompt` ו-`tool_ids` כבויים בכל ארבעת
הסוכנים**.

### 3.1א ⚠️ שינוי כיוון: הקונפיגורציה על הצומת, לא בטבלה

**החלטת הבעלים 2026-09-15.** במקום להרחיב את `voice_purposes` ל-13 עמודות,
הצומת `action.start_voice_call` יישא את **כל** הפרמטרים שבונים את השיחה,
כל אחד כבורר מרשימה **חיה**.

**שלוש סיבות, שתיים מהן כללים קיימים:**

1. **13 עמודות DB בלי מסך אדמין הן "לא גמור"** — הכלל מ-22.8
   (`kill-switches-need-admin-ui-not-db-only`). **עורך התהליכים הוא ה-UI.**
2. ⚠️ **תצלום נכון יותר משליפה.** קונפיג על הצומת, **מצולם לשורת הניסיון
   בזמן החיוג** — עריכת התהליך אחר כך אינה יכולה לשנות שיחה שכבר רצה.
   שליפה מ-`voice_purposes` בזמן `ctx` סובלת בדיוק מהסיכון הזה.
3. זה כיוון הריפו ממילא: בורר הכללים (14.9) ובורר מספרי WhatsApp כבר שמים
   בחירות מרשימה חיה על צמתים.

✅ **מכניזמית זה כבר נגיש:** `dispatchVoicePurposeCall` **מקבל `nodeId`**
(וגם `runId`), כך שקריאת קונפיג הצומת בזמן החיוג אינה דורשת צנרת חדשה.
וה-`purposeKey` כבר בורר חי (`voiceCallSchemaFor`) — אותו דפוס בדיוק.

#### הפרמטרים, לפי שכבה — כל אחד ומקורו החי

| פרמטר | מקור הרשימה | קיים היום |
|---|---|---|
| **טלפוניה** | | |
| `toSource` | שדה של איש הקשר, או מספר מפורש | — |
| `callerId` | `GetPhoneNumbers` | **1**: `97237219347` |
| `ruleId` | `GetRules` (הבורר נבנה 14.9) | **8** |
| **סוכן** | | |
| `agentId` | `agents_list` | **4** |
| **דריסות** (A-68) | ⚠️ ראו האילוץ מתחת | |
| `firstMessage` · `prompt` · `language` · `voiceId` · `llm` · `toolIds` · `knowledgeBase` · `asrKeywords` · `maxDurationSeconds` · `ttsModelId` · `pronunciationDictionaries` | | |
| **מדיניות** | | |
| `waitForOutcome` | כבר על הצומת | ✓ |
| `leadMs` · `minDelayMs` · `tokenTtlSec` | היום ב-`voice_purposes` | |

#### ✅ כלום לא hardcoded — וזה כבר הדפוס

כל בורר נבנה מרשימה **חיה** ב-`buildPaletteItems`, בדיוק כפי ש-`purposeKey`
עובד היום דרך `voiceCallSchemaFor(purposes)`. ה-SDK חושף `fetchData` על
`PaletteState` שבונה את הפלטה מחדש — כך שמספר חדש, כלל חדש או סוכן חדש
מופיעים **בלי פריסה**.

#### 🚫 אבל A-13 לא נאכף בטופס — ה-SDK לא תומך בכך

⚠️ **תיקון לניסוח קודם שלי.** כתבתי "בחירת סוכן → הטופס מציג רק את הדריסות
המותרות". **זה לא ניתן לביטוי ב-SDK 2.3.0:** האפשרויות נצרבות לסכמה בזמן
בניית הפלטה, ו-`fetchData` בונה את **כל** הפלטה — אין טוען אפשרויות
פר-שדה שמגיב לערך של שדה אחר.

**הבית הנכון הוא `arm-check.ts`** — הקובץ ששואל *"Is this workflow
CONFIGURED, as opposed to merely well-formed?"*, וכבר מחזיק מקרה ל-
`action.start_voice_call`:

> לכל שדה דריסה שהוגדר על הצומת, לאמת מול `agentId` שנבחר שהדגל המתאים
> ב-`platform_settings.overrides.conversation_config_override` הוא `true`.
> אחרת — **לסרב לחמש**, עם הודעה שנוקבת בשם השדה ובתיקון.

⚠️ **וזה עדיף על הסתרת שדות:** הבעלים מקבל את **הסיבה**, לא היעדר אפשרות.
A-13 הופך מכשל-שיחה בזמן ריצה לסירוב-חימוש עם הסבר — אותה גישה בדיוק
שההודעה הקיימת של `purposeKey` נוקטת.

#### מה קורה ל-`voice_purposes`

**נשארת רישום, כפי שהיא היום** — `key`, `display_name`, `rule_id`, `enabled`.
⚠️ **אין להוסיף לה את 13 העמודות.** שימוש חוזר (חמישה תהליכים שמחייגים אותו
דבר) הוא הטיעון היחיד לטובת טבלה, והוא אינו כואב עד שיש חמישה — **והיום יש
אפס**. להוסיף טבלה אחר כך קל; למחוק 13 עמודות שלא בשימוש — לא.

---

### 3.2 כלל גנרי — בלי לשנות את האינדקס

האילוץ ב-A-18 נכון היום ונוסף אחרי כשל אמיתי. **לא מבטלים אותו — מחדדים.**

לפי A-19, הבורר כבר יודע איזה תסריט כל כלל מריץ. השאלה הופכת מ*"האם ייעוד
אחר תפס את הכלל?"* ל*"איזה תסריט הכלל מריץ?"*:

- מריץ תסריט **פרסונה** → נשאר בלעדי. התקלה עדיין אמיתית.
- מריץ את התסריט **הגנרי** → משותף לכולם.

**שינוי נדרש:** `voximplant-channel.ts:474` לשמור גם `scenario_id` (הוא כבר
מגיע, A-19), והאימות יזהה את התסריט הגנרי לפי מזהה יציב ולא לפי שם שאפשר
לשנות בפלטפורמה.

### 3.3 ctx — מקונטקסט לקונפיגורציה מלאה

`purpose/[purpose]/ctx` מחזיר היום 8 שדות של הקשר. הוא יחזיר גם:

```json
{
  "agent_id": "agent_…",
  "dynamic_variables": { … },
  "conversation_config_override": { … },
  "tools": { "save_rsvp": "rsvp", … }
}
```

**נקודת אבטחה:** ה-`ctx` כבר מחזיר שמות פרטיים בלבד ומ-404 גנרי לכל כשל.
הקונפיגורציה החדשה אינה PII, אבל היא כן חושפת את הפרומפט — ה-404 הגנרי
והטוקן החד-פעמי הם ההגנה, כמו היום.

⚠️ **שלוש תוספות מהממצאים:**

**(א) `conversation_config_override` נבנה בשרת, לא בתסריט.** לפי A-13 שדה
שהדגל שלו כבוי מפיל את השיחה בשגיאה, ולכן **ה-`ctx` הוא שחייב לסנן** —
הוא היחיד שיודע גם את שורת הייעוד וגם (דרך `agents pull`) אילו דגלים
דלוקים. התסריט מעביר את האובייקט כמו שהוא ולא מחליט דבר.

**(ב) שם המפתח לקורלציה — לאחד.** A-92: הנתיב הגנרי שולח היום
`kalfa_attempt_id` בעוד RSVP/mtg/sls שולחים `kalfa_attempt_token`, ו-
`elevenlabs-payloads.ts` קרא רק את השני. הקורא תוקן לקרוא את שניהם, אבל
**הייעוד הגנרי צריך להתייצב על שם אחד** — `kalfa_attempt_token`, כמו
השלושה האחרים.

**(ג) הערך חייב להתקיים בזמן ctx.** A-87/A-88: ל-`voice_purpose_attempts`
אין עמודת nonce, ו-`el_conversation_id` נוצר **במהלך** השיחה. לכן
`kalfa_attempt_token` של ייעוד = `attempt.id`, בדיוק כמו `sls/ctx` — כך
הוא חוזר ב-webhook גם אם ה-cb הסופי אובד (A-54).

### 3.4 תסריט גנרי — `PurposeAgent.voxengine.ts`

TypeScript, לא JS (A-22 — `tsc` רץ ממילא, ו-`noEmitOnError` הופך טיפוסים
לשער אמיתי). הפרוטוקול:

1. קריאת `customData` → `{to, from, tok, u, p}`
2. `GET {u}/api/voximplant/purpose/{p}/ctx/{tok}` — **לפני החיוג**
3. כישלון = **פטלי**, דיווח `ctx_fetch_failed_<code>`, בלי לחייג (A-23)
4. `createAgentsClient({ agentId: ctx.agent_id })`
5. `conversationInitiationClientData({ conversation_config_override, dynamic_variables })` — **סינכרוני, לפני `sendMediaBetween`**
6. `callPSTN` → גישור מדיה
7. `ClientToolCall` → POST לנתיב הכלי → `clientToolResult` עם `is_error` (A-21)
8. סיום → `POST …/cb/{tok}` עם `call_status` + `error_reason` בנפרד

**חמש מגבלות פלטפורמה שהפרוטוקול חייב לכבד:**

| | |
|---|---|
| **A-42** | סשן בלי שיחות מת ב-**60 שניות**. שלבים 1–6 (ctx → createAgentsClient → callPSTN) כולם בתוך החלון הזה |
| **A-45** | `callPSTN` נכשל עם **408 אחרי 60 שניות** ללא מענה — זה גבול הצלצול, לא ה-TTL של הטוקן |
| **A-50** | ל-`callPSTN` **אין תקרת משך משלו**. חובה `setTimeout` → `call.hangup()`, עם `clearTimeout` ב-`Disconnected` |
| **A-44** | מקסימום **3 בקשות HTTP פעילות**: ctx + כל קריאת כלי + cb. בקשות בתור ב-`Terminating` **נזרקות בלי callback** |
| **A-53** | `onWebSocketClose` → `VoxEngine.terminate()`. **הסוכן אינו מנתק את הטלפון** — בלי החיבור הזה נשאר אוויר מת |

⚠️ **שלב 5 הוא הקריטי, והוא אינו מתועד אצל Voximplant (A-51).** ההזרקה
חייבת להיות **סינכרונית ברגע ש-`createAgentsClient` נפתר, לפני
`sendMediaBetween` ולפני חיבור כל מאזין** — אחרת המשתנים נפתרים **ריקים**.
נמדד בשיחה אמיתית (`qa/call-6904838502`); **שתי הדוגמאות הרשמיות של
Voximplant לא קוראות למתודה בכלל.**

**זיהוי משיבון — החלטה שצריכה להתקבל במפורש (A-77).** שתי שכבות אפשריות
ושונות במהותן: `Modules.AMD` מבוסס-אות **לפני** פתיחת ה-WebSocket (אפס
קרדיטים על משיבון, אבל fail-open וללא מודל עברי), מול `voicemail_detection`
מבוסס-LLM **אחרי** תחילת השיחה. RSVPAgent מריץ את שתיהן; meeting-confirm ו-
sales-close רק את השנייה. **הייעוד הגנרי צריך לבחור, לא לרשת במקרה.**

⚠️ **פריסה: `npm run vox:upload:<rule>` בלבד (A-86).** `npx voxengine-ci`
מהשורש נכשל ב-`TS5011` — הקונפיג הזמני שהכלי מייצר חסר `rootDir`, ו-
TypeScript 6 דורש אותו. החבילה מביאה TypeScript 5.5.4 משלה, וה-npm script
נכנס לתיקייה שלה.

### 3.5 מסלול כלים גנרי

`POST /api/voximplant/purpose/[purpose]/tool/[name]/[token]`

השער הקיים תומך בזה בלי שינוי (A-24). הניתוב מ-`name` לפעולה הוא **רישום
בשרת**, לא מיפוי בתסריט — התסריט מעביר את השם כמות שהוא.

**החלטת עיצוב:** מסלול אחד עם `name` כפרמטר, ולא מסלול לכל כלי. הסיבה: כלי
חדש לא אמור לדרוש פריסת תסריט. הקטלוג נשאר IaC (רישום ב-ElevenLabs), הבחירה
נשארת קונפיגורציה, והניתוב נשאר קוד שרת.

✅ **הגשר אינו הכרחי לכל כלי (A-64/A-65).** לכלי `webhook` יש
`request_headers` שערכו יכול להיות `{ "variable_name": "secret__…" }` —
כלומר **הטוקן החד-פעמי מגיע ככותרת, והשער הקיים מאמת אותו בלי שינוי**,
ובלי שהערך ייכנס להקשר של ה-LLM. כלי `client` הם היחידים שחייבים לעבור
בתסריט. ייעוד יכול לבחור webhook, והתסריט הגנרי לא יידע עליהם דבר.

⚠️ **שלוש מגבלות על מסלול הכלים:**

**(א) לענות על כל קריאה, גם לכלי לא מוכר (A-52).** הדוגמה הרשמית של
Voximplant עושה `if (toolName !== "get_weather") return;` ומשאירה את ה-
`tool_call_id` תלוי בלי תשובה. הגשר הגנרי חייב להשיב תמיד —
`error_type: 'user_rejected'` הוא האוצר מילים ל"לא הורץ", להבדיל מ"רץ ונכשל".

**(ב) פריים התוצאה הוא שלושה שדות בדיוק** — `tool_call_id`, `result`,
`is_error`. `tool_name` **אינו במפרט** (A-61 — הוסר מ-SalesCloseAgent
ב-2026-09-15), ו-`result` חייב להיות **מחרוזת**.

**(ג) תקרת זמן: כלי `client` 1–120 שניות, `webhook` 5–300 (A-73).** הגשר
הגנרי חייב לסיים בתוך 120, וזה מצטרף למגבלת 3 הבקשות המקבילות (A-44).

🚫 **MCP חוסם את עצמו בשיחה יוצאת (A-82).** `MCPApprovalPolicy` ברירת מחדל
`require_approval_all` — *"the agent will request **your** permission before
each tool use"*, ואין אדם ליד קונסולה בשיחה לאורח. ייעוד שישתמש ב-MCP חייב
לקבוע מדיניות מפורשת, וזו החלטת אבטחה. ⚠️ בנוסף, סט הכלים של שרת MCP יכול
להשתנות בלי פריסה אצלנו (A-83).

### 3.6 פלט הצומת

לפי A-25/A-26 — הצומת יחזיר גם מה שהכלים עשו, כדי ש-`follow_up_required`
יפסיק להיות ערך שאיש לא מייצר.

---

## 4. שלבים ושערים

**כל שלב נגמר בשער מדיד. שלב לא מתחיל לפני שהקודם עבר.**

### שלב 0 — אימות הדריסה (חוסם הכול)

הזול והקריטי. A-8/A-9 הוכיחו שהאובייקט עובר ושהשדה מוכר; **לא הוכח**
שדריסה בפועל משנה התנהגות.

⚠️ **נקודת הפתיחה נמדדה (A-74): דגלי `prompt` ו-`tool_ids` כבויים בכל ארבעת הסוכנים.**
מה שכן דלוק היום: `conversation.text_only` (RSVP + שירות-לקוחות), `asr.keywords` ו-`agent.language`
(RSVP בלבד). Meeting-Confirm ו-Sales-Close — אפס דריסות. **ו-A-81 הוכיח שהדגלים שורדים
`pull → push → pull`**, אז זו מטלה ולא עיצוב מחדש.

1. להפעיל `first_message: true` בלבד — **על `KALFA-Sales-Close`**, היעד הבטוח (אפס דריסות היום,
   ואינו נתיב ה-RSVP בייצור) — `agents pull --update` → עריכה → `agents push` → `pull --update` לאימות.
   ⚠️ `agents status` **אינו** בודק drift (§6.1). הפקודה לבעלים.
2. שיחה אחת עם `conversation_config_override.agent.first_message` שונה
3. **שער:** משפט הפתיחה שנשמע ≠ המוגדר בקונסולה

⚠️ **A-14 — soft disallow.** אם הדגל לא נדלק, השדה נבלע בשקט והשיחה תישמע
תקינה. לכן השער הוא **מה שנשמע**, לא "לא הייתה שגיאה". אימות דרך תמלול
האודיו האמיתי, לא דרך התמליל של הסוכן (נוהל §6.4).

**אם נכשל:** הארכיטקטורה מתהפכת לסוכן-לכל-ייעוד. `voice_purposes` שומרת
`agent_id` בלבד, §3.1 מצטמצם, וכל השאר נשאר.

### שלב 1 — הסוכן הגנרי

- יצירה דרך ה-CLI, כל דגלי הדריסה שב-A-10 **ו-A-68** ל-`true`
  ⚠️ **זה לא ניסוח — זה חוסם.** A-74 מדד ש-`prompt` ו-`tool_ids` כבויים
  בכל ארבעת הסוכנים היום, ולפי A-13 ייעוד ששולח שדה שדגלו כבוי **מפיל את
  השיחה בשגיאה**. כל שדה ש-§3.1 יכולה לאכלס חייב דגל דלוק כאן.
- פרומפט בסיס מינימלי (הפרומפט האמיתי מגיע בדריסה)
- קריטריוני הערכה משותפים (§2)
- **שער:** `pull --update` חוזר ומאשר שכל הדגלים נשמרו

### שלב 2 — ctx + מסד

- מיגרציה: עמודות §3.1
- `ctx` מחזיר קונפיגורציה
- **שער:** `tsc`, `lint`, `types:check`, מבחנים; ו-`ctx` מוחזר נכון לייעוד בדיקה

### שלב 3 — התסריט הגנרי

- `PurposeAgent.voxengine.ts`
- כלל חדש, בלעדי לו
- **שער:** `vox:upload --dry-run`, ואז שיחה אחת שמגיעה לסוכן עם ההקשר הנכון

### שלב 4 — הגשר והכלים

- מסלול כלי גנרי
- ניתוב בשרת
- **שער:** שיחה שבה כלי נקרא, נרשם, ו-`is_error:false` חוזר

✅ **השלב הצטמצם מהותית (A-64/A-65):** כלי `webhook` יכולים לפנות ישירות
לשרת ולהזדהות בטוקן השיחה דרך `request_headers`. הגשר בתסריט נדרש **רק
לכלי `client`**. אם הייעוד הראשון מסתפק ב-webhook — השלב הזה כמעט ריק.

### שלב 5 — פלט הצומת

- מה שהכלים עשו מגיע לתהליך
- `follow_up_required` מיוצר בפועל
- **שער:** תהליך שמסתעף על תוצאת כלי

### שלב 6 — הכלל הגנרי המשותף

- `scenario_id` נשמר (§3.2)
- האימות מחדד
- **שער:** שני ייעודים על הכלל הגנרי נשמרים; ייעוד על כלל פרסונה נדחה

---

## 4א. מה שהממצאים החדשים משנים בתכנון

### הגשר — לא בהכרח דרך התסריט

A-27 מגלה חמישה סוגי כלים, ולא שניים. כל 13 הכלים שלנו הם `client`, ולכן
כולם עוברים דרך `TOOL_ROUTES` המקובע בכל סצנריה — וזה מה שהפך גשר גנרי
למורכב.

`webhook` ו-`mcp` **לא עוברים דרך התסריט בכלל** — ElevenLabs פונים לשרת שלנו
ישירות. יחד עם A-11 (דריסת כלים מחליפה את המערך), זה אומר שסט הכלים לכל ייעוד
יכול להישלח בדריסה, והתסריט הגנרי לא יידע עליהם דבר.

⚠️ **זו הסקה מהיררכיית הסוגים, לא בדיקה.** החסם שלא בדקתי: כלי `webhook` לא
עובר דרך התסריט, ולכן **אין לו את הטוקן** שהשער שלנו מאמת. איך הוא מזדהה — זו
השאלה שמכריעה בין "הגשר מיותר" ל"הגשר הכרחי", ויש לענות עליה לפני שלב 4.

`MCP.Client` של VoxEngine **אינו** תשובה לזה (A-32).

### `secret__` — תיקון שאינו חלק מהתסריט הגנרי

A-30 הוא פער אבטחה **בקוד שרץ היום**, לא בתכנון. `kalfa_attempt_token` נשלח
ל-LLM בלי הקידומת שElevenLabs מגדירים בדיוק למקרה הזה. זה תיקון נפרד, קטן,
ולא צריך לחכות לכלום.

### הגשר חייב לשלוח `is_error` — ולא `tool_name`

A-28 ו-A-29 יחד: המפרט דורש `is_error`, לא מכיר `tool_name`, והדוגמה הרשמית
של Voximplant מפרה את שניהם. התסריט הגנרי ייכתב מול המפרט, והעובדה הזו נרשמת
כאן כדי שאיש לא "יתקן" אותו לפי הדוגמה.

`error_type: 'user_rejected'` (A-28) שימושי לשער: כלי שנחסם — טוקן פג,
rate-limit — **לא נקרא**, ואינו אותו דבר ככלי שרץ ונכשל.

### התשתית נוצרת דרך Management API

יצירת הכלל הגנרי, העלאת התסריט וקשירתו הן פעולות פלטפורמה:
`AddRule`, `AddScenario`, `BindScenario`, `SetScenarioInfo` — כולן מתועדות
ב-`api-reference/management-api/reference/{rules,scenarios}`.

⚠️ מהסקיל הרשמי: *"Do not assume `SetRuleInfo` can rebind a rule to a scenario.
It may accept `scenario_id` and return success without changing the binding."*
לקשירה — `BindScenario` בלבד, ואימות אחריה.

---

## 5. סיכונים

| סיכון | חומרה | מענה |
|---|---|---|
| **A-14 — כשל שקט בדריסה** | גבוהה | שער שלב 0 הוא מה שנשמע, לא היעדר שגיאה |
| **A-11 — דריסת כלים מחליפה** | גבוהה | `NULL` ≠ `[]`. מערך ריק בטעות = סוכן בלי כלים |
| **A-5 — ייעוד על כלל פרסונה** | גבוהה | קיים היום; שלב 6 מחדד במקום לבטל |
| **§2 — קריטריונים משותפים** | בינונית | החלטה מודעת; ייעוד שדורש רף משלו מקבל סוכן |
| **A-3 — תקרת 200 בייט** | נמוכה | 127 היום, ותוספות הולכות ל-`ctx` שאינו מוגבל |
| **A-41 — אין sandbox** | בינונית | שלב 3 מייצר כלל חדש על אפליקציית הייצור. מיתון: `rulePattern` לא חל על שיחות יוצאות (A-35), אז כלל חדש **אינו** יכול ליירט תנועה נכנסת; הוא נגיש רק ל-`StartScenarios` עם ה-`rule_id` שלו. עדיין — לשקול אפליקציית staging לפני שלב 3, כפי ש-A-40 ממליץ |
| **A-75/A-70 — burst בתעריף כפול** | גבוהה | `bursting_enabled: true` + `concurrency: -1` בכל ארבעת הסוכנים. קמפיין מקבילי חוצה את הגבול בשקט ומחויב כפול. לקבוע `agent_concurrency_limit` לפני הייעוד הראשון |
| **A-77 — שני מזהי משיבון** | גבוהה | `voicemail_detection` בסוכן + שער AMD בתסריט, בלי שאף אחד יודע על השני. לפי A-53 הבעלות היא של VoxEngine — להכריע במפורש |
| **A-44 — 3 בקשות HTTP פעילות** | בינונית | ctx + כל קריאת כלי + cb. בקשות בתור בזמן `Terminating` **נזרקות בלי callback** |
| **A-22 — `noEmitOnError`** | נמוכה | שער, לא סיכון |

---

## 6. החלטות פתוחות לבעלים

1. **קריטריוני ההערכה המשותפים** — מה הרף שכל שיחה יוצאת מטעם קלפה נמדדת בו?
   ⓘ **הוקל ב-A-66:** בייצור הם משותפים, אבל `agents_run_tests` מקבל
   `agent_config_override` הכולל `platform_settings` מלא — כך שכל ייעוד
   **כן** נבדק מול הקריטריונים שלו. ההחלטה נוגעת רק לרף הייצור.
2. **הפרומפט הבסיסי של הסוכן הגנרי** — מה נשאר בקונסולה כשכל ייעוד דורס?
3. **הייעוד הראשון** — איזה תהליך אמיתי מריצים בשלב 3?
4. **זיהוי משיבון** (A-77) — שכבת ה-AMD המקדימה, שכבת ה-LLM, או שתיהן?
   ⓘ הן אינן מתנגשות, אבל גם אינן אותו דבר: הראשונה חוסכת קרדיטים ונכשלת
   פתוח ללא מודל עברי, השנייה עולה כסף ופועלת רק אחרי שהשיחה התחילה.
5. **`first_message_override` — מאיפה הערך** (חוסם את שלב 0 בפועל):
   הגדרת אדמין? קבוע זמני? או להמתין לשלב 2 ולקחת אותו מקונפיג הייעוד?

---

## 7. סיכונים תפעוליים שנוספו מהממצאים

| | |
|---|---|
| **A-75/A-70** | `bursting_enabled: true` + `agent_concurrency_limit: -1` **בכל ארבעת הסוכנים** — קמפיין מקבילי עלול לעבור לתעריף כפול בלי תקרה. לקבוע גבול לפני הייעוד הראשון |
| **A-76** | `trust_context: "unknown"` בכולם (הנכון ל-outbound: `low`), `retention_days: -1`, וצנזור PII כבוי — בעוד התמלילים מחזיקים שמות וטלפונים של אורחים |
| **A-46** | יעדים יקרים מ-20 סנט/דקה ואפריקה **חסומים כברירת מחדל** — רלוונטי לייעוד שיחייג לחו"ל |
| **A-99** | `voice_purpose_attempts` קיבלה אינדקס ייחודי חלקי על `el_conversation_id` ב-2026-09-15; לפני כן הייתה **היחידה מבין החמש בלעדיו** |
| **A-109** | ⚠️ `SalesCloseAgent` כבר שולח דריסת `first_message`. **אין להעלותו לפני ש-`agents push` + `pull --update` מאשרים `true` בשרת** — אחרת כל שיחת מכירה תיכשל |
