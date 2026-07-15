# KALFA RSVP — ElevenLabs Agent Testing: מתודולוגיה

> מקור-אמת ל**איך בודקים** את סוכן ה-RSVP הקולי. נלמד מהתיעוד הרשמי **ואומת אמפירית מול ה-API החי**
> ב-2026-07-15 (יצירה + הרצה + משיכת-תוצאה של simulation ושל tool test; create+delete ל-llm ול-verify_absence).
> סוכן: `agent_9701kxj3n54ye518a3s518cexd48`. חבילת הבדיקות המוכנה: `docs/voice-agent/tests/`.
> משלים את `elevenlabs-json-reference.md` (מבנה הסוכן) ו-`rsvp-conversation-design.md` (הקטלוג S-001…S-118).

---

## TL;DR — ההכרעה

1. **ברירת המחדל היא Simulation test.** הוא מייצר את השיחה **דינמית** מפרסונה (`simulation_scenario`).
   **מפסיקים לכתוב `chat_history` ידני** בתור הדרך לבדוק התנהגות — זו הייתה הגישה הלא-נכונה.
2. **`chat_history` ידני נשאר רק ל-unit tests** (`type:"tool"` / `type:"llm"`) — כשרוצים לבודד **תור אחד**
   ולפַנֵּן את המצב ההתחלתי בדיוק, כדי לבדוק *קריאת-כלי אחת* או *ניסוח-תשובה אחד* בלי רעש.
3. **`simulate-conversation` הישן deprecated.** ElevenLabs מפנים ל-`agent-testing/create` + `run-tests`.
   כל שלושת הסוגים (simulation / tool / llm) חיים תחת אותו endpoint `agent-testing`.
4. **Simulation לא בודק קול/פרוזודיה** — טקסט בלבד. איכות-קול/אינטונציה/turn-taking דורשים שיחה אמיתית
   (Voximplant + `voice-call-qa-analyst` + `scripts/analyze-call-pitch.ts`).

---

## 1. מתי כל סוג בדיקה (הכרעה, לא תיאוריה)

| | **Simulation** (`type:"simulation"`) | **Tool unit** (`type:"tool"`) | **Response unit** (`type:"llm"`) |
|---|---|---|---|
| מה בודק | **התוצאה של שיחה שלמה** רב-תורית | האם **הכלי הנכון** נקרא עם הפרמטרים הנכונים | האם **ניסוח תשובה** בודדת עומד בקריטריון |
| מי מייצר את השיחה | **הסימולטור, דינמית**, מפרסונה | אתה — `chat_history` קבוע | אתה — `chat_history` קבוע (בד"כ תור-פתיחה 1) |
| `chat_history` ידני? | **לא** (אופציונלי לזריעה חלקית בלבד) | **כן** — זו כל הנקודה | **כן** — תור אחד לפני התשובה הנבדקת |
| מודד | outcome + התנהגות לאורך תורות | קריאת-כלי בודדת (או היעדרה) | טקסט תגובה בודד |
| דטרמיניסטי? | לא (מומלץ `repeat_count`) | כמעט (תלוי LLM) | כמעט |
| עלות/זמן | הכי יקר/איטי (שיחה מלאה) | זול/מהיר | זול/מהיר |
| דוגמאות בחבילה | 13 (`sim-*`) | 3 (`unit-tool-*`) | 2 (`unit-llm-*`) |

**כלל האצבע — מתי *לא* לכתוב `chat_history` ידני:**
כשאתה רוצה לבדוק **"איך הסוכן מנהל את השיחה"** (זיהוי → הגעה → ספירה → שמירה, טיפול בהתנגדות,
אנטי-הזיה, de-escalation) — זו **התנהגות רב-תורית** ולכן **Simulation**. פרסונה + `success_conditions`,
לא תסריט. `chat_history` ידני בתוך simulation גורם לבדוק תסריט מומצא במקום את ההיגיון של הסוכן.

**מתי כן ידני:** רק כשמבודדים אירוע נקודתי שתלוי במצב-פתיחה מדויק — "בהינתן שהאורח *כבר* אישר וספר,
האם `save_rsvp` נקרא עם הערכים הנכונים?" (tool) או "בהינתן שאלת חניה, האם התשובה לא ממציאה?" (llm).

---

## 2. Simulation flow — מלא ומאומת

### 2.1 מבנה בקשה (המאומת מול ה-API)
```jsonc
{
  "name": "SIM-02 decline …",
  "type": "simulation",
  "simulation_scenario": "You role-play Zehava, a polite guest who CANNOT attend … decline warmly in Hebrew …",
  "simulation_max_turns": 6,
  "success_conditions": [                     // מערך; כל איבר = prompt-הערכה עצמאי (AND)
    "The agent acknowledged the decline warmly and did NOT pressure the guest …",
    "The agent recorded the decline by calling save_rsvp with attending:false …"
  ],
  "tool_mock_config": {
    "mocking_strategy": "all",                 // "none" | "all" | "selected"
    "fallback_strategy": "raise_error",        // "raise_error" | "call_real_tool"
    "mocked_tool_ids": []                       // רלוונטי כש-strategy="selected"
  },
  "dynamic_variables": { "guest_name":"זְהָבָה", "event_name":"…", "event_date":"…", "event_venue":"…" },

  // אופציונליים (מושמטים → ברירות-מחדל של ElevenLabs; אומת שהשמטה מתקבלת):
  "simulated_user_model": null,                // מי "מגלם" את האורח (LLM enum); null = ברירת מחדל
  "evaluation_model": null,                    // מי מעריך הצלחה; null = ברירת מחדל
  "simulation_environment": null,
  "chat_history": [],                          // זריעה חלקית בלבד; ריק = שיחה מאפס
  "success_condition": null,                   // legacy יחיד — deprecated; להשתמש ב-success_conditions[]
  "from_conversation_metadata": null,          // ה-UI מוסיף; לבנייה ידנית null
  "conversation_initiation_source": null,
  "parent_folder_id": null
}
```

### 2.2 איך מנסחים פרסונת-אורח (`simulation_scenario`)
זה ה-prompt שמניע את **המשתמש המדומה** (לא את הסוכן). ככל שהוא **מפורט וקונקרטי** — הבדיקה טובה יותר
(ElevenLabs: "detailed and verbose simulated user prompts enhance effectiveness"). מרכיבים:
- **מי** ("You role-play Zehava, a warm cooperative guest / an irritated guest / the guest's husband").
- **כוונה** ("you DO plan to attend" / "you cannot attend" / "you want to be removed").
- **התנהגות תור-אחר-תור** ("when asked about children say 'ילד אחד'; when read back, confirm").
- **שפה ורגיסטר**: "answer naturally in **spoken Hebrew**" + שורות-דגימה עבריות (מעגן את הפלט לעברית).
- **מלכודות** ("do NOT volunteer the count before asked", "stay unclear again on the second ask").
> ה-`success_conditions` נכתבות ב**אנגלית** (prompt ל-evaluator; מדויק ויציב יותר), אבל הן מתייחסות
> להתנהגות **עברית** של הסוכן — בדיוק כפי שהבדיקה החיה הקיימת עשתה.

### 2.3 `tool_mock_config` — האסטרטגיה שאומתה
- **`mocking_strategy`**: `"none"` (קורא לכלים אמיתיים!) · `"all"` (מדמה את **כל** הכלים) · `"selected"`
  (מדמה רק את `mocked_tool_ids`). **בחבילה שלנו תמיד `"all"`** — כדי ש**שום שיחת-בדיקה לא תיגע ב-DB
  האמיתי** (לא `submit_rsvp`, לא `call_dnc_list`, לא התראת בעלים).
- **`fallback_strategy`**: `"raise_error"` (כשל רועש אם כלי לא-מדומה נקרא — ברירת המחדל שלנו, בטוח)
  · `"call_real_tool"` (**מסוכן** — נופל לייצור; אין להשתמש בבדיקות).
- **ערך-החזרה של כלי מדומה:** התיעוד **אינו** מגדיר שדה שבו קובעים ידנית מה הכלי המדומה מחזיר;
  הסימולטור **מפברק החזרה סבירה** אוטומטית. **מסקנה מעשית:** אל תבנה `success_conditions` שתלויים
  ב-payload המדויק שהכלי החזיר (למשל "הכלי החזיר saved") — בדוק **שהכלי נקרא** ו**שהסוכן הגיב נכון**,
  לא מה בדיוק חזר. אם *חייבים* החזרה ספציפית (למשל error-path S-055/S-112) — זה מגיע ל-**live call**, לא ל-simulation.
- **דוגמה שרצה בפועל:** `sim-02-decline.json` (`mocking_strategy:"all"`) — נוצר, הורץ, **עבר**. תמליל
  שהסימולטור ייצר דינמית:
  > agent: "מטעם נטלי קלפה, לגבי הברית של הבן שלה. רציתי לשאול אם אתם מגיעים?" → user: "לא, לצערי לא נוכל
  > להגיע." → agent: "אין שום בעיה, אני מעדכנת שלא תגיעו. תודה על העדכון ויום נהדר!"

### 2.4 `success_conditions[]` — סמנטיקה
מערך של prompt-ים; ה-evaluator מריץ כל אחד ומחזיר **תוצאה כוללת אחת** (`condition_result.result`)
עם **נימוק פר-קריטריון** ב-`rationale.messages[]`. נסח כל קריטריון **חד וממוקד** (הגעה / ספירה /
read-back / כלי / סגירה) — כך הכשל מצביע על הסעיף הבעייתי.

### 2.5 `simulation_max_turns`, `dynamic_variables`, מודלים
- **`simulation_max_turns`**: תקציב תורות (ברירת מחדל 5). happy-path מלא ≈ 10; opt-out/decline ≈ 5-6.
- **`dynamic_variables`**: בדיוק ה-4 שהתרחיש מזריק (E-2): `guest_name` (**מנוקד**, E-3), `event_name`,
  `event_date`, `event_venue`. חייבים להתאים למה שה-prompt של הסוכן צורך (`{{...}}`).
- **`simulated_user_model` / `evaluation_model`**: `null` = ברירות-מחדל של ElevenLabs (אומת שעובד).
  להשוואת-מודלים אפשר לקבע (`gpt-4o` וכו') כדי לנטרל שונות ה-evaluator בין ריצות.

---

## 3. מבנה JSON מאומת — שלושת הסוגים

> כל השלושה תחת `POST /v1/convai/agent-testing/create`. השדות שה-**UI מוסיף** (ומופיעים ב-GET):
> `from_conversation_metadata`, `conversation_initiation_source`, `is_auto_generated`,
> `auto_generation_metadata`, ובכל הודעת `chat_history` ~25 שדות-מטא (`agent_metadata`, `tool_calls`,
> `interrupted`, `reasoning`, …). לבנייה ידנית מספיק `role`+`message`(+`time_in_call_secs`) — השאר null.

### 3A. Response unit (`type:"llm"`) — אומת שמתקבל (create 200 + delete 204)
```jsonc
{
  "name": "…", "type": "llm",
  "chat_history": [ { "role":"user", "time_in_call_secs":0, "message":"יש חניה באולם?" } ],
  "success_condition": "The response must NOT invent parking info … offer to pass to hosts …",
  "success_examples": [ { "type":"success", "response":"אין לי את הפרט הזה, אעביר לבעלי האירוע. מגיעים?" } ],
  "failure_examples": [ { "type":"failure", "response":"כן, יש חניה חינם ליד האולם." } ],
  "dynamic_variables": { … }
}
```

### 3B. Tool unit (`type:"tool"`) — אומת (create+run+result)
```jsonc
{
  "name": "…", "type": "tool",
  "chat_history": [ …, { "role":"user", "time_in_call_secs":10, "message":"נכון" } ],
  "tool_call_parameters": {
    "referenced_tool": { "id": "tool_1501kxjzme3zf3htm544kyjfwkzg", "type": "client" },
    "parameters": [
      { "path":"status",   "eval": { "type":"llm", "description":"means attending" } },
      { "path":"adults",   "eval": { "type":"exact", "expected_value":"2" } },
      { "path":"children", "eval": { "type":"exact", "expected_value":"1" } }
    ],
    "verify_absence": false            // true = הבדיקה עוברת אם הכלי *לא* נקרא
  },
  "dynamic_variables": { … }
}
```
- מזהי כלים (client): save_rsvp=`tool_1501kxjzme3zf3htm544kyjfwkzg` · mark_dnc=`tool_0501kxjzme40e93bjg2vh4ah9cvb`
  · notify_owner=`tool_1901kxjzme41em68xms7w4e69m2k`. `referenced_tool.type` = **`"client"`** (לא webhook).
- `eval.type`: `"exact"` (`expected_value`) · `"regex"` (`pattern`) · `"llm"` (`description`) · `"anything"`.
- `parameters: []` + `verify_absence:false` → מוודא רק **שהכלי נקרא** (טוב ל-`mark_dnc` חסר-פרמטרים).
- `parameters: []` + `verify_absence:true` → מוודא ש**אף** קריאה לכלי הזה **לא** קרתה (S-032 anti-premature).

> **⚠ קריטי — client-tool unit test חייב `tool_mock_config` (אומת חי 2026-07-15).** בלי `tool_mock_config:
> {mocking_strategy:"all", …}` ה-client tool **אינו ניתן-לקריאה** בהארנס של ה-tool-unit, והבדיקה נכשלת עם
> *"Expected exactly 1 tool call, but found 0"* **ללא קשר ל-LLM ולסוכן** — כשל-שווא. הוכח: אותה בדיקה בלי
> mock נכשלה תחת gemini **וגם** gpt-4o **וגם** claude-sonnet-4; **עם** `tool_mock_config` היא עוברת (save_rsvp
> נורה עם `adults=2, children=1`), וגם `verify_absence` הופך לבדיקה אמיתית (בלי mock הוא "עובר" תמיד — false pass).
> **מסקנה:** כל בדיקת client-tool (כולל `verify_absence`) חייבת `tool_mock_config` — בדיוק כמו simulation.

### 3C. Simulation (`type:"simulation"`) — אומת (create+run+result) — ר' §2.1.

---

## 4. הרצה ותוצאות

### 4.1 Endpoints (מאומתים)
| פעולה | HTTP |
|---|---|
| יצירה | `POST /v1/convai/agent-testing/create` → `{ "id": "test_…" }` |
| קריאה | `GET /v1/convai/agent-testing/{test_id}` (מחזיר את כל השדות + ה-UI-added) |
| רשימה | `GET /v1/convai/agent-testing?page_size=30` |
| מחיקה | `DELETE /v1/convai/agent-testing/{test_id}` → 204 |
| **הרצה (חבילה)** | `POST /v1/convai/agents/{agent_id}/run-tests` — body `{"tests":[{"test_id":"…"}, …]}` |
| משיכת-תוצאה | `GET /v1/convai/test-invocations/{invocation_id}` |

**כן — אפשר להריץ חבילה שלמה** בקריאה אחת: `tests` הוא מערך. חוזר `invocation` יחיד עם `test_runs[]`.
אפשר `agent_config_override` (first_message / language / prompt) כדי לבדוק **וריאנט prompt/LLM בלי לשנות
את הסוכן החי** — קריטי לדיסציפלינת-הייצור וללבנצ'מרק §7.

### 4.2 מבנה דוח (מאומת מריצה חיה)
```jsonc
{ "id":"suite_…", "agent_id":"…", "repeat_count":1, "bucketing_status":"completed",
  "test_runs":[ {
    "test_run_id":"trun_…", "test_id":"test_…", "test_name":"…",
    "status":"passed",                                  // "pending" | "passed" | "failed"
    "condition_result":{
      "result":"success",                               // "success" | "failure" | "unknown"
      "rationale":{ "summary":"…", "messages":[ "Criterion 1: …", "Criterion 2: …" ] }
    },
    "agent_responses":[ { "role":"agent","message":"…","tool_calls":[…],"time_in_call_secs":0 }, … ],
    "metadata":{ "test_type":"simulation","ran_by_user_email":"…" } } ] }
```
- **פולינג:** אחרי `run-tests` הסטטוס `pending`; משכו את ה-invocation עד `passed`/`failed` (~15-25ש').
- **`agent_responses`** = התמליל שהסימולטור ייצר, **כולל `tool_calls`** — כאן רואים אילו כלים נקראו ובאילו פרמטרים.
- **הצלחה מרובת-ריצות:** `repeat_count` נותן pass-rate (UI: ירוק 100% · כתום ≥80% · אדום <80%) — כך
  מנטרלים אי-דטרמיניזם של LLM. הרץ בדיקות-מפתח עם `repeat_count`≥3.

### 4.3 ראיה אמפירית שנאספה (2026-07-15)
| ריצה | test | תוצאה | מה למדנו |
|---|---|---|---|
| simulation | decline (mock all) | **passed** (`result:success`) | הפייפליין השלם עובד; הסימולטור מייצר עברית טבעית; מבנה תוצאה אומת |
| tool exact | save_rsvp(attending,2,1) **בלי** mock | **failed** — *"found 0"* | **כשל-שווא**: client tool לא ניתן-לקריאה בהארנס בלי `tool_mock_config` (ר' §3B) |
| tool exact | save_rsvp **עם** `tool_mock_config` | **passed** ("All parameter evaluations passed") | הכלי נורה `adults=2,children=1` — **הסוכן תקין** |
| simulation | sim-01 happy-path (mock:all) | **passed** — `save_rsvp` נורה, read-back לפניו | הזרימה המלאה עובדת תחת gemini |
| **LLM comparison** (`agent_config_override.conversation_config.agent.prompt.llm`) | save-test בלי mock: gemini / gpt-4o / claude-sonnet-4 | **כל השלושה failed זהה** | **ה-LLM אינו המנוף** — הכשל היה הבדיקה, לא המודל. אין צורך בהחלפת LLM לבאג הזה |
> **מבנה `agent_config_override` המאומת:** `{ "conversation_config": { "agent": { "prompt": { "llm": "<gpt-4o|claude-sonnet-4|gemini-2.5-flash>" } } }, "platform_settings": {} }` — **שני** השדות חובה; ה-override הוא **merge** (הפרסונה+הכלים נשמרים, רק ה-LLM מוחלף). מאפשר בנצ'מרק LLM בלי לגעת בסוכן החי.
> כל בדיקות ה-EMP/probe נמחקו אחרי האימות (204). החשבון נקי.

---

## 5. מה simulation *לא* בודק — ומה כן צריך שיחת-קול אמיתית

Simulation הוא **טקסט בלבד**. הוא **לא** מכסה:
- **פרוזודיה/אינטונציה** — שאלות שלא עולות בטון (E-13), מונוטוניות. (מדידה: `scripts/analyze-call-pitch.ts`.)
- **הגייה עברית / ניקוד** — "זְהָבָה" מול "זה אבא" (E-3); הזלגת תגי-רגש `[...]` לקול (E-5); קריאת SSML מילולית.
- **turn-taking / ASR** — אובדן תשובות בנות-מילה (E-6), ברג'-אין, שקט, `retranscribe_on_turn_timeout`.
- **אודיו/רשת** — קו רועש, הד, DTMF, AMD/תא-קולי (S-065…S-074) — הסימולטור לא "שומע".
- **חוזה ה-scenario** — `clientToolResult.is_error` (E-12), timeout גלובלי, דיווח `cb` — שכבת Voximplant.

**מה כן צריך שיחת-קול אמיתית:** התקנת test-application ב-Voximplant → חיוג לנייד-בדיקה (לעולם לא לרשימת
קמפיין חיה, ולא לפני 08:00 / אחרי 21:00) → הקלטה/תמליל → ניקוד ב-`voice-call-qa-analyst`. שני המישורים
משלימים: **simulation** נועל היגיון-שיחה וקריאות-כלי בזול ובכמות (CI); **שיחת-קול** בודקת את מה
שאי-אפשר לדמות בטקסט. תיקון prompt/flow → `voice-rsvp-agent`; קוד/פלטפורמה → `voximplant-engineer`.

---

## 6. workflow מומלץ (מחזור)
1. **בדיקת-מפתח כ-simulation** לכל קטגוריית-קטלוג (א…י) — פרסונה + `success_conditions` + `mock:all`.
2. **unit tests נקודתיים** רק היכן שצריך דיוק כירורגי (save_rsvp נקרא · mark_dnc על opt-out · אנטי-הזיה).
3. הרצת חבילה עם `repeat_count`≥3; קריאת `rationale.messages` לכשלים.
4. תיקון ה-prompt של הסוכן; אימות מחדש; שמירת האדום כרגרסיה עד שירוק.
5. אחת לתקופה — **שיחת-קול אמיתית** לכיסוי §5.

## 7. מנופים למדידה (עם החבילה הזו)
- **LLM (החלטת-מוצר #16):** הרץ את החבילה תחת `gemini-2.5-flash` מול `gpt-4o`/`claude-sonnet-4` דרך
  `agent_config_override` ב-`run-tests` (מבנה מאומת ב-§4.2) — **בלי לשנות את הסוכן החי**.
  **עדכון 2026-07-15:** אימות חי הראה שהחלפת ה-LLM **אינה** משפרת את קריאת-הכלי — `save_rsvp` נורה נכון תחת
  gemini (simulation + tool-with-mock עוברים). ה"כשל" המקורי היה `tool_mock_config` חסר, לא ה-LLM. אין צורך
  בהחלפת LLM לבאג הזה; אם בעתיד יישקל LLM אחר — זה מטעמי איכות-שיחה כללית, ויימדד מול החבילה המתוקנת.
- **`end_call`/tool-forcing:** אחרי הפעלתם, הרץ שוב את `sim-01` + `unit-tool-save-attending` לאימות.
