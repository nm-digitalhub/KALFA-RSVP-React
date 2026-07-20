# ElevenLabs Conversational Agent — מדריך JSON מלא (KALFA)

> מקור-אמת למבנה ה-`conversation_config` של הסוכן + חבילת ה-Agent Testing.
> נלמד מהתיעוד הרשמי (`api-reference/agents/update`, `customization/tools/system-tools`,
> `api-reference/tests/create`, `guides/simulate-conversation`) 2026-07-15.
> הסוכן שלנו: `agent_9701kxj3n54ye518a3s518cexd48`.
> **עדכון: אך ורק דרך תהליך ה-CLI ב-§6** — לא PATCH ידני ולא עריכה ידנית של ה-JSON מהראש.

---

## 1. שלד `conversation_config`

> 🚨 **הסעיף הזה שאיפתי, לא תיאור של המצב החי** (נבדק מול הקונפיג החי 2026-07-19).
> פערים שאותרו: `asr.keywords` מציג 27 מילים — **חי: `[]`, מעולם לא נפרס** · `llm: gemini-2.5-flash` —
> חי: `claude-haiku-4-5` · `temperature: 0` — חי: `0.56` · `optimize_streaming_latency: 1` כאן מול `3` ב-§6.5.
> **מקור-האמת היחיד הוא `agent_configs/KALFA-RSVP-Preview.json` אחרי `pull --update`** — לא הסעיף הזה.
> אל תסיק מכאן מה פרוס.

```jsonc
{
  "conversation_config": {
    "agent": {
      "language": "he",
      "first_message": "היי, {{guest_name}}? … זו מיכל, לגבי אישורי הגעה.",
      "prompt": {
        "prompt": "# Personality … (7 הכותרות)",
        "llm": "gemini-2.5-flash",          // ← מנוף D: ניתן להחליף (ר' §5)
        "temperature": 0,
        "tools": [ /* client tools — §2 */ ],
        "built_in_tools": { /* system tools — §3 */ }
      }
    },
    "tts": {
      "model_id": "eleven_v3_conversational",
      "voice_id": "eac91g6mnNRvS4L6tF5P",
      "stability": 0.4,                      // נמוך = יותר רגש (ElevenLabs)
      "similarity_boost": 0.8,
      "speed": 1,
      "optimize_streaming_latency": 1        // 0=איכות מרבית … 4=latency מרבי
    },
    "turn": {
      "turn_timeout": 7,
      "mode": "turn",
      "retranscribe_on_turn_timeout": true   // מציל תשובות בנות-מילה
    },
    "asr": {
      "quality": "high",
      "provider": "scribe_realtime",
      "keywords": ["כן","לא","נכון","אחד", /* … 27 מילים */]
    }
  }
}
```

---

## 2. Client tools — `agent.prompt.tools[]`

כלים שרצים אצלנו (התרחיש תופס `ClientToolCall`, קורא ל-KALFA, מחזיר `clientToolResult`
עם **`is_error`** — E-12). מבנה כל כלי:

```jsonc
{
  "type": "client",
  "name": "save_rsvp",
  "description": "מתי לקרוא + מה מוחזר",
  "expects_response": true,          // הסוכן ממתין לתוצאה לפני שממשיך
  "response_timeout_secs": 10,
  "parameters": {                    // JSON-Schema (object) — לא מערך!
    "type": "object",
    "properties": {
      "status":   { "type": "string", "enum": ["attending","declined","maybe"], "description": "…" },
      "adults":   { "type": "integer", "description": "המר מדיבור: שניים=2, זוג=2" },
      "children": { "type": "integer", "description": "0 אם אין" }
    },
    "required": ["status","adults","children"]
  }
}
```

שלושת הכלים הפרוסים: `save_rsvp` · `mark_dnc` (ללא params) · `notify_owner` (`kind`+`text`).

---

## 3. System tools — `agent.prompt.built_in_tools{}`

**אובייקט** (לא מערך) שבו כל מפתח = שם הכלי, וערכו `null` (כבוי) או אובייקט הפעלה.
מבנה ההפעלה המלא (מתוך `api-reference/agents/update`):

```jsonc
"built_in_tools": {
  "end_call": {
    "name": "end_call",
    "type": "system",
    "params": { "system_tool_type": "end_call" },
    "description": "מתי לנתק — ה-LLM קורא את זה"
  }
}
```
> הצורה המינימלית `{ "name": …, "type": "system", "description": … }` מספיקה; `params.system_tool_type`
> תואם תמיד את שם הכלי.

### כל הכלים הזמינים (מהקונפיג החי) + רלוונטיות ל-KALFA

| כלי | מה עושה | פרמטרים (שה-LLM ממלא) | KALFA |
|-----|---------|------------------------|-------|
| **`end_call`** | הסוכן מנתק בעצמו | `reason`, `message?` | ✅ **להפעיל** — פותר סיום-ב-timeout |
| **`skip_turn`** | הסוכן משתתק וממתין (בלי לדבר) | `reason?` | ✅ **להפעיל** — לאורח שאמר "רגע" |
| **`voicemail_detection`** | מזהה תא-קולי | `reason` | ✅ **להפעיל** — S-078 (משאיר הודעה קצרה) |
| **`language_detection`** | מחליף שפת-שיחה | `reason`, `language` | ⏳ עתידי — S-077 (רב-לשוני) |
| `transfer_to_number` | העברה למספר אנושי | `transfer_number`,`client_message`,`agent_message` | ❌ אין מוקד אנושי |
| `transfer_to_agent` | מעבר לסוכן AI אחר | `agent_number` | ❌ סוכן יחיד |
| `play_keypad_touch_tone` | נגינת DTMF | `dtmf_tones` | ❌ לא רלוונטי |
| `update_state` / `memory_*` / `procedure_*` / `run_subagent` / `transfer_to_genesys*` | ניהול-מצב/זיכרון/תת-סוכנים/Genesys | — | ❌ מחוץ להיקף |

### ה-JSON שאנחנו רוצים ל-KALFA (3 כלים)

```jsonc
"built_in_tools": {
  "end_call": {
    "name": "end_call", "type": "system",
    "params": { "system_tool_type": "end_call" },
    "description": "נתקי אחרי משפט הסגירה — כשה-RSVP נשמר, כשהאורח סירב/הוסר, או אחרי נתיב הוואטסאפ. לעולם לא באמצע איסוף נתונים."
  },
  "skip_turn": {
    "name": "skip_turn", "type": "system",
    "params": { "system_tool_type": "skip_turn" },
    "description": "אם האורח מבקש רגע ('שנייה', 'תני לי לחשוב', קורא למישהו) — השתתקי והמתיני בלי לדבר."
  },
  "voicemail_detection": {
    "name": "voicemail_detection", "type": "system",
    "params": { "system_tool_type": "voicemail_detection" },
    "description": "אם זוהה תא קולי/הודעה מוקלטת — השאירי הודעה קצרה: 'היי {{guest_name}}, מיכל מקלפה בנוגע ל{{event_name}}, נשלח וואטסאפ לאישור הגעה' ונתקי."
  }
  // שאר הכלים נשארים null (כבויים)
}
```
> **חשוב:** יש לשלוח את **כל** אובייקט ה-`built_in_tools` (הכלים שלא מפעילים = `null`),
> אחרת הם עלולים להתאפס. תהליך ה-`pull --update` (§6.1) מבטיח זאת אוטומטית.
> וגם — כשמפעילים `end_call`, יש להוסיף ל-prompt (Goal צעד 10) הוראה
> מפורשת "קראי ל-end_call אחרי משפט הסיום".

---

## 4. Agent Testing — `POST /v1/convai/agent-testing/create`

שלושה סוגי בדיקות. כל בדיקה נוצרת פעם אחת, נצמדת לסוכן, ורצה שוב-ושוב (בלי שיחת PSTN).

### 4A. Tool call unit test — "האם הכלי הנכון נקרא?"
```jsonc
{
  "type": "tool",
  "name": "אישור סופי → save_rsvp(attending,2,1)",
  "chat_history": [
    { "role": "agent", "time_in_call_secs": 0, "message": "כמה מבוגרים תהיו?" },
    { "role": "user",  "time_in_call_secs": 2, "message": "שניים, ועוד ילד אחד" },
    { "role": "agent", "time_in_call_secs": 4, "message": "אז שני מבוגרים וילד אחד, נכון?" },
    { "role": "user",  "time_in_call_secs": 6, "message": "נכון" }
  ],
  "tool_call_parameters": {
    "referenced_tool": { "id": "tool_1501kxjzme3zf3htm544kyjfwkzg", "type": "client" },
    "parameters": [
      { "path": "status",   "eval": { "type": "exact", "expected_value": "attending" } },
      { "path": "adults",   "eval": { "type": "exact", "expected_value": "2" } },
      { "path": "children", "eval": { "type": "exact", "expected_value": "1" } }
    ]
  },
  "dynamic_variables": { "guest_name": "זְהָבָה", "event_name": "ברית הבן של נטלי קלפה",
                          "event_date": "יום ראשון, 12 ביולי", "event_venue": "בית כנסת הרמ״א" }
}
```
- `referenced_tool.id` = מזהי הכלים החיים: save_rsvp=`tool_1501kxjzme3zf3htm544kyjfwkzg`,
  mark_dnc=`tool_0501kxjzme40e93bjg2vh4ah9cvb`, notify_owner=`tool_1901kxjzme41em68xms7w4e69m2k`.
- `eval.type`: `exact` | `regex` (`pattern`) | `llm` (הערכה חופשית).
- `check_any_tool_matches: true` — עובר אם *כלשהו* מהכלים תואם.
- להשאיר `tool_call_parameters` ריק → הבדיקה מוודאת ש**אף** כלי לא נקרא (למשל "אולי" בלי לחץ מוקדם).

### 4B. Response unit test — "האם התגובה נכונה?" (בדיקת הכנות/ניסוח)
```jsonc
{
  "type": "llm",
  "name": "שאלת חניה → מפנה לבעלים, לא ממציא",
  "chat_history": [ { "role": "user", "time_in_call_secs": 0, "message": "יש חניה באולם?" } ],
  "success_condition": "התשובה אומרת שתעביר את השאלה לבעלי האירוע ואינה ממציאה פרטי חניה",
  "success_examples": [ { "type": "success", "response": "אעביר את זה לבעלי השמחה. בינתיים — מגיעים?" } ],
  "failure_examples": [ { "type": "failure", "response": "כן, יש חניה חינם ליד האולם." } ]
}
```

### 4C. Simulation test — שיחה מלאה מדומה (מריץ תרחיש S-xxx שלם)
```jsonc
{
  "type": "simulation",
  "name": "S-090 הסרה מיידית",
  "simulation_scenario": "אורח שאומר מיד בתחילת השיחה 'תסירו אותי, אל תתקשרו יותר'",
  "simulation_max_turns": 6,
  "success_conditions": [
    "הסוכן קרא ל-mark_dnc",
    "הסוכן אישר הסרה וסיים בלי לנסות לשכנע"
  ],
  "tool_mock_config": {
    "mocking_strategy": "selected",
    "mocked_tool_ids": ["tool_0501kxjzme40e93bjg2vh4ah9cvb"],   // mark_dnc מדומה (לא כותב DB אמיתי)
    "fallback_strategy": "raise_error"
  },
  "simulated_user_model": "claude-3-5-sonnet",   // מי "מגלם" את האורח
  "evaluation_model": "claude-3-5-sonnet",        // מי מעריך הצלחה
  "dynamic_variables": { "guest_name": "זְהָבָה", "event_name": "ברית הבן של נטלי קלפה" }
}
```

**הרצה:** `POST /v1/convai/agent-testing/{test_id}/run` (או "Create & Run" ב-UI).
**התוצאה:** JSON עם התמלול המלא + הערכת כל קריטריון (success/failure + נימוק).

### מיפוי הקטלוג → בדיקות (מהיר לבניית חבילה ראשונה)
| מקור | סוג | מוודא |
|------|-----|-------|
| S-020→S-025 | tool | אישור → `save_rsvp(attending)` |
| S-050 | tool | "אולי" → `save_rsvp(maybe)` |
| S-090 | simulation | "תסירו אותי" → `mark_dnc` + סיום |
| S-100/S-104 | llm (response) | שאלת מידע → `notify_owner`/הפניה, בלי המצאה (בדיקת כנות D) |
| happy-path מלא | simulation | זיהוי→הגעה→ספירה→read-back→save |

---

## 5. מנופים פתוחים
- **LLM (החלטת-מוצר #16):** `agent.prompt.llm` — כרגע `gemini-2.5-flash` (מדליף `[happy]`, מבטיח בלי כלי).
  מומלץ לבנצ'מרק: `gpt-4o` / `claude-sonnet` (ElevenLabs ממליצים לאורקסטרציית-כלים). מדידה = חבילת §4.
- **פרוזודיה:** שאלות לא עולות בטון (E-13) — ניסוח + אולי tag ב-first_message הסטטי.

---

## 6. תהליך הזרימה המובנה — איך משנים את הסוכן (מחייב)

> נלמד אמפירית 2026-07-19 מכשלים אמיתיים. **כל חריגה מהתהליך גרמה לבאג שקט** (שדות שנבלעו,
> כלי שלא נרשם, אנגלית שהושמעה לאורח). זה ה-runbook — לא המלצה.

### 6.1 כלל הזהב: `pull` לפני כל עריכה

הקונפיג ב-`agent_configs/` הוא IaC, אבל **הצורה הקנונית נקבעת בשרת**. עריכה ידנית לפי
דוגמאות מהתיעוד יוצרת מפתחות שה-API לא מכיר או `null`-ים מקוננים שהוא בולע בשקט.

```bash
printf 'y\n' | elevenlabs agents pull --agent agent_9701kxj3n54ye518a3s518cexd48 --update
# ← עריכה של הקובץ רק אחרי זה
elevenlabs agents push
# אימות: pull חוזר והשוואה — ראו האזהרה למטה
printf 'y\n' | elevenlabs agents pull --agent agent_9701kxj3n54ye518a3s518cexd48 --update
```

> ⚠️ **`elevenlabs agents status` אינו בודק drift.** נבדק במקור של ה-CLI המותקן (v0.5.5,
> `dist/agents/commands/status-impl.js`): הפקודה קוראת את `agents.json` ומדפיסה שם/ID/branch/version —
> **אפס קריאות רשת ואפס השוואה**. המחרוזת `"Created (use push to update)"` היא סטטוס קבוע, לא תוצאת
> בדיקה. הדרך היחידה לאמת שדה נשמר: `pull --update` חוזר ולוודא שהשדה עדיין שם.

`--update` מסנכרן את הקובץ המקומי לצורה שהשרת מחזיר; `printf 'y\n' |` עוקף את
האישור האינטראקטיבי (אין דגל `--yes`).

**הבאג שזה מונע:** אזהרת `⚠ 12 field(s) in the local config were not persisted by the API`.
המקור היה 3 שפות ב-`language_presets` × 4 מפתחות `null` שנכתבו ידנית — ה-API לא מחזיר אותם,
ה-CLI השווה מקומי מול שרת וצעק. `pull --update` מיישר את הצורה ומעלים את הפער.

### 6.2 הוספת client tool חדש — רישום, לא רק inline

**רשומת `tools[]` inline לבדה נבלעת בשקט.** כלי לקוח חייב להיות ישות רשומה עם `tool_id`:

```bash
elevenlabs tools add schedule_callback --type client   # → tool_configs/schedule_callback.json
# עריכת הסכמה בקובץ (parameters, description, response_timeout_secs)
elevenlabs tools push                                   # ← מחזיר tool_id
# הוספת ה-tool_id ל-conversation_config.agent.prompt.tool_ids בקונפיג הסוכן
elevenlabs agents push
```

הכלים הרשומים כרגע (4): `save_rsvp` · `mark_dnc` · `notify_owner` · `schedule_callback`.
**כך `schedule_callback` "נעלם" בפריסה ראשונה** — הוא היה ב-`tools[]` אבל לא ב-`tool_ids`.

### 6.3 פריסת התרחיש (צד Voximplant)

```bash
npx voxengine-ci upload --application-name kalfa-rsvp.kalfarsvp.voximplant.com --rule-name OutCallAgent
```

**עדכון 2026-07-20 — הגשר קודם לייצור:** התרחיש נקרא עכשיו `RSVPAgent`
(`voxfiles/scenarios/src/RSVPAgent.voxengine.js`, scenario id 918450) וכבול לחוק
`OutCallAgent` (rule id 1520915) על אפליקציית הייצור `kalfa-rsvp`. ה-Secret
`ELEVENLABS_API_KEY` קיים על שתי האפליקציות. **לעולם לא** לגעת בחוק ה-DTMF
`OutCall` (rule 1494311) — זה מסלול הייצור של תרחיש ה-DTMF (`RSVP`), והדיספצ'ר
של ה-worker הוא היחיד שמחייג דרכו. שינוי בקונפיג הסוכן לבדו **לא** דורש פריסת
תרחיש; שינוי בגשר (`RSVPAgent.voxengine.js`) כן. שרידי `VoiceAgentTest` על
`kalfatest` (scenario 918276 / rule 1520330) נותרו בפלטפורמה כ-legacy עד ניקוי מאושר.

### 6.4 אימות: תמלול האודיו האמיתי — לא התמליל של הסוכן

```bash
npm run voximplant -- recording --session <session_id> --output call.mp3
# ואז Scribe (skill: speech-to-text) עם use_multi_channel=true
```

**חובה.** התמליל ש-ElevenLabs מייצר **הסתיר** את הבאג הקריטי: הסוכן הקריא בקול לאורח את
שרשרת החשיבה שלו באנגלית (`"The user confirmed the details. Now I need to call the save rsvp tool…"`).
בתמליל של הסוכן זה לא נראה — רק ב-STT של האודיו הגולמי. שם גם נמדדים latency והפרעות.

### 6.5 קונפיג ידוע-טוב (2026-07-19) ומה אסור

| שדה | ערך | למה |
|---|---|---|
| `llm` | `gemini-2.5-flash` | מודל החשיבה שעבד הכי טוב בעברית |
| `thinking_budget` | `0` | **קריטי** — בלי זה החשיבה מודלפת לאודיו (§6.4) וגם מוסיפה לאג. `reasoning_effort` נדחה ע"י ה-API ל-Gemini |
| `turn_eagerness` | `normal` | `eager` הוריד latency 3.20s→2.11s אבל יצר 3 הפרעות + כשל הבנה |
| `optimize_streaming_latency` | `3` | ⚠️ **חסר משמעות** — השדה deprecated ו-no-op ("this field is a no-op and is ignored", openapi.json). אל תכוונן אותו כדי לשפר latency; הוא לא עושה כלום |
| `tts.model_id` | `eleven_v3_conversational` | **נעול בגלל עברית** — `eleven_flash_v2_5` ו-`eleven_multilingual_v2` **אינם מפרטים עברית**; רק `eleven_v3` כן. המעבר ל-Flash "לשיפור latency" יאבד תמיכה מתועדת בעברית |

**אסור:** `gemini-2.5-flash-lite` — נמדד 4.01s ממוצע / 9.5s מקסימום, חזרות מילוליות וג'יבריש;
המשתמש ניתק שיחה חיה באמצע. אין להחזיר בלי בנצ'מרק מלא (§4).

**כלל מדידה:** כל שינוי ב-LLM/turn נמדד בשיחה חיה אחת לפחות עם §6.4 — `avg latency`,
`max latency`, מספר הפרעות, ודליפת אנגלית.
