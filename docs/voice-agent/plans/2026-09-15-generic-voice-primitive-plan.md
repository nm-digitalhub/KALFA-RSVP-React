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
| A-13 | **ענף לא פותר את A-12.** ענף הוא מבנה בקרת-גרסאות (commits, protection, `current_live_percentage`), גוף יצירתו מכיל רק `conversation_config`, ו-`deployments.create` מחלק תנועה **באחוזים** — כלי ל-A/B, לא לבחירת ייעוד. | `agents_list_branches` חי + API reference |
| A-14 | ⚠️ **soft disallow:** שדה שהדגל שלו כבוי **נבלע בשקט** — *"if the Security toggle is off and the client still sends asr.keywords, the conversation continues and keywords are ignored"*. אין שגיאה. | ציטוט מילולי |
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
| A-30 | ⚠️ **פער אבטחה קיים.** ElevenLabs מגדירים `secret__` כקידומת למשתנים ש"should only be used in dynamic variable headers and **never sent to an LLM provider**", וממליצים עליה ל-auth tokens. `MeetingConfirmAgent` מזריק `kalfa_attempt_token` **בלי** הקידומת, ואומת חי שהשדה מגיע כרגיל. | `personalization/dynamic-variables` + שיחה `conv_0201m2…` |
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
| A-62 | **הפער של `secret__` מצומצם לסצנריה אחת.** `MeetingConfirmAgent` הוא היחיד ששולח טוקן (`kalfa_attempt_token`), ובלי הקידומת. `RSVPAgent` ו-`SalesCloseAgent` לא שולחים טוקן כלל. | קריאה + A-30 |
| A-63 | **כלי webhook מזדהה ברמת הסוכן, לא ברמת השיחה.** חמש שיטות נתמכות: OAuth2 Client Credentials, OAuth2 JWT, Basic, Bearer, ו-**Custom Headers** — כולן מוגדרות בהגדרות הסוכן ומחוברות לכלי. כלומר כלי webhook מזדהה כ"הסוכן", ולא כ"השיחה הזו". | `tools/webhook-tools` |
| A-64 | ✅ **אומת מסכמת ה-API — טוקן פר-שיחה כן מגיע לכלי webhook.** לכלי יש `request_headers` (map), וערך כותרת יכול להיות מחרוזת **או** אחד משלושה מצביעים: `{secret_id}`, **`{variable_name}`**, `{env_var_label}`. כלומר:<br>`"X-Kalfa-Token": { "variable_name": "secret__kalfa_token" }`<br>יחד עם A-30 (הקידומת מונעת כניסה להקשר ה-LLM) — **הטוקן החד-פעמי שלנו מגיע ככותרת, והשער הקיים יכול לאמת אותו בלי שינוי.** | `api-reference/tools/create` |
| A-65 | **הנגזרת: הגשר הגנרי אינו הכרחי לכל כלי.** כלי `client` חייב לעבור בתסריט; כלי `webhook` יכול לפנות ישירות לשרת שלנו ולהזדהות בטוקן השיחה. סט הכלים לכל ייעוד נשלח בדריסה (A-11), כך שייעוד יכול לבחור כלי webhook והתסריט הגנרי לא יידע עליהם דבר. **התסריט עדיין נדרש** לטעינת ההקשר, גישור המדיה, וניתוק — ולכלי `client` שכן צריכים ריצה בתסריט. | הצלבת A-27 · A-11 · A-64 |
| A-66 | ✅ **הפער הגדול בבדיקות — נפתר.** `agents_run_tests` מקבל `agent_config_override` מסוג `AdhocAgentConfigOverrideForTestRequestModel` = `{conversation_config (חובה), platform_settings (חובה), workflow (אופציונלי)}`. כלומר **בדיקה כן רצה נגד הקונפיגורציה של ייעוד ספציפי**, ולא רק נגד פרומפט הבסיס. הסוכן הגנרי ניתן לבדיקה פר-ייעוד. גם `repeat_count` (עד 50) ו-`branch_id` נתמכים. | סכמת `agents_run_tests` |
| A-67 | ⚠️ **הבחנה שלא הייתה קודם:** A-12 נכון לשיחה חיה — `platform_settings` אינו ניתן לדריסה בשיחה. אבל **הרנטיים של הבדיקות כן מקבל אותו**. שתי דלתות שונות: קריטריוני הערכה וחילוץ נתונים אחידים בייצור, ניתנים להחלפה בבדיקה. | הצלבה |
| A-68 | **רשימת הדריסות המלאה מהסכמה — ארוכה מ-A-11.** `ConversationConfigClientOverrideConfig`: `agent.{first_message, language, max_conversation_duration_message, prompt.{prompt, llm, tool_ids, knowledge_base, native_mcp_server_ids}}`, `conversation.{max_duration_seconds, text_only}`, `tts.{voice_id, model_id, stability, speed, similarity_boost, pronunciation_dictionary_locators, supported_voices}`, `asr.keywords`, `turn.soft_timeout_config.{message, additional_soft_timeout_messages}`. **חדשים שלא היו בתוכנית:** `max_duration_seconds` (תקרת משך פר-שיחה!), `tts.model_id`, `pronunciation_dictionary_locators`, `native_mcp_server_ids`, ומסרי ה-soft-timeout. ⚠️ `prompt.tools` **אינו** ניתן לדריסה — רק `tool_ids`. | סכמת ה-API |
| A-69 | **סימון ה-soft-disallow קיים בסכמה עצמה:** `x-convai-soft-override-disallowed: true` על `asr.keywords` ו-`tts.supported_voices`. מאשר את A-13 ומזהה בדיוק אילו שדות נבלעים בשקט. | אותה סכמה |
| A-70 | ⚠️ **סיכון עלות:** `AgentCallLimits.bursting_enabled` **ברירת מחדל `true`** — *"exceeding workspace concurrency limit will be allowed up to 3 times the limit. **Calls will be charged at double rate** when exceeding the limit."* קמפיין גנרי שמחייג במקביל יכול להיכנס לתעריף כפול בלי אזהרה. `agent_concurrency_limit` ברירת מחדל `-1` (ללא הגבלה), `daily_limit` 100,000. | `AgentCallLimits` |
| A-71 | **`conversation_history_redaction` — מנגנון שלא הכרנו לצנזור PII.** `privacy.conversation_history_redaction: {enabled, entities[]}` מוחק ישויות מהתמליל, מהאודיו **ומהניתוח**, לפי טיפוסים מדורגים (`name.name_given`, `contact_number`, `location.location_address`, `financial_id.payment_card.*`…). אצלנו `retention_days: -1` (ללא הגבלה) ואנחנו שומרים שמות וטלפונים של אורחים. | `PrivacyConfig` |
| A-72 | `trust_context` הוא שדה אמיתי עם משמעות מוגדרת: **`low` = "serves untrusted external participants — outputs should be vetted and tool access scoped"**, `high` = משרת את הבעלים. סוכן שמחייג אורחים הוא `low`. | `AgentTrustContext` |
| A-73 | **פסק זמן של כלי `client` צר מזה של `webhook`:** client 1–120 שניות (ברירת מחדל 20), webhook 5–300. הגשר הגנרי חייב לסיים בתוך 120 — וזה מתחבר למגבלת 3 בקשות HTTP פעילות (A-44). | סכמות הכלים |
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
| ✅ שונה לכל ייעוד | פרומפט, משפט פתיחה, קול, שפה, LLM, סט כלים, בסיס ידע, מילות ASR |
| ❌ משותף לכולם | קריטריוני הערכה, guardrails, בטיחות, איסוף נתונים |

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

**`NULL` = אל תשלח את השדה.** לא "שלח ריק" — A-11 אומר שדריסת כלים מחליפה
את המערך, אז מערך ריק בטעות ישאיר את הסוכן בלי כלים.

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

### 3.5 מסלול כלים גנרי

`POST /api/voximplant/purpose/[purpose]/tool/[name]/[token]`

השער הקיים תומך בזה בלי שינוי (A-24). הניתוב מ-`name` לפעולה הוא **רישום
בשרת**, לא מיפוי בתסריט — התסריט מעביר את השם כמות שהוא.

**החלטת עיצוב:** מסלול אחד עם `name` כפרמטר, ולא מסלול לכל כלי. הסיבה: כלי
חדש לא אמור לדרוש פריסת תסריט. הקטלוג נשאר IaC (רישום ב-ElevenLabs), הבחירה
נשארת קונפיגורציה, והניתוב נשאר קוד שרת.

### 3.6 פלט הצומת

לפי A-25/A-26 — הצומת יחזיר גם מה שהכלים עשו, כדי ש-`follow_up_required`
יפסיק להיות ערך שאיש לא מייצר.

---

## 4. שלבים ושערים

**כל שלב נגמר בשער מדיד. שלב לא מתחיל לפני שהקודם עבר.**

### שלב 0 — אימות הדריסה (חוסם הכול)

הזול והקריטי. A-8/A-9 הוכיחו שהאובייקט עובר ושהשדה מוכר; **לא הוכח**
שדריסה בפועל משנה התנהגות.

1. להפעיל `first_message: true` בלבד על סוכן קיים — `agents pull --update` → עריכה → `agents push` → `pull --update` לאימות
2. שיחה אחת עם `conversation_config_override.agent.first_message` שונה
3. **שער:** משפט הפתיחה שנשמע ≠ המוגדר בקונסולה

⚠️ **A-14 — soft disallow.** אם הדגל לא נדלק, השדה נבלע בשקט והשיחה תישמע
תקינה. לכן השער הוא **מה שנשמע**, לא "לא הייתה שגיאה". אימות דרך תמלול
האודיו האמיתי, לא דרך התמליל של הסוכן (נוהל §6.4).

**אם נכשל:** הארכיטקטורה מתהפכת לסוכן-לכל-ייעוד. `voice_purposes` שומרת
`agent_id` בלבד, §3.1 מצטמצם, וכל השאר נשאר.

### שלב 1 — הסוכן הגנרי

- יצירה דרך ה-CLI, כל דגלי הדריסה שב-A-10 ל-`true`
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
| **A-22 — `noEmitOnError`** | נמוכה | שער, לא סיכון |

---

## 6. החלטות פתוחות לבעלים

1. **קריטריוני ההערכה המשותפים** — מה הרף שכל שיחה יוצאת מטעם קלפה נמדדת בו?
2. **הפרומפט הבסיסי של הסוכן הגנרי** — מה נשאר בקונסולה כשכל ייעוד דורס?
3. **הייעוד הראשון** — איזה תהליך אמיתי מריצים בשלב 3?
