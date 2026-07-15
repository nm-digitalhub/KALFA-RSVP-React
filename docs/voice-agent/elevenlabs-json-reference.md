# ElevenLabs Conversational Agent — מדריך JSON מלא (KALFA)

> מקור-אמת למבנה ה-`conversation_config` של הסוכן + חבילת ה-Agent Testing.
> נלמד מהתיעוד הרשמי (`api-reference/agents/update`, `customization/tools/system-tools`,
> `api-reference/tests/create`, `guides/simulate-conversation`) 2026-07-15.
> הסוכן שלנו: `agent_9701kxj3n54ye518a3s518cexd48`. עדכון ב-`PATCH /v1/convai/agents/{id}`.

---

## 1. שלד `conversation_config`

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
> **חשוב:** ב-PATCH יש לשלוח את **כל** אובייקט ה-`built_in_tools` (הכלים שלא מפעילים = `null`),
> אחרת הם עלולים להתאפס. וגם — כשמפעילים `end_call`, יש להוסיף ל-prompt (Goal צעד 10) הוראה
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
