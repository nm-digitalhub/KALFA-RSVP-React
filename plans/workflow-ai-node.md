# צומת AI בתהליכים — תוכנית

תאריך: 2026-09-23 · הכרעת הבעלים: הכלים הם **היכולות שלנו**, לא Gmail/Jira.

כל שורה מסומנת **נמדד** או **מוסק**.

---

## 1. מה ה-SDK נותן, ומה הוא לא

**נמדד** (`nodes/ai-agent.md`, נקרא במלואו; `node-schemas/form-controls.md`):

| רכיב | מה זה | שמיש לנו |
|---|---|---|
| `NodeType.AiNode` = `'ai-node'` | תבנית ויזואלית | כן |
| `AiTools` | Repeater למערך כלים | כן, בהסתייגות למטה |
| `VariableTextArea` | prompt עם `{{…}}` | כן, כבר בשימוש ב-6 מקומות |

**הסתייגות אחת, והיא מצוטטת:** *"each row is `{ id, sourceHandle, tool, description, apiKey }`. Surface specific to the demo's AI-agent node; only relevant if you ship a similarly-shaped node type."*

הפקד **נעול לצורה הזו**. אי אפשר להחליף את `apiKey` בשדה אחר.

**והספק מצהיר שהוא לא מריץ כלום:** *"Your backend is responsible for invoking the actual AI service at runtime."* הצומת הוא הגדרה בלבד.

## 2. שני חסמים, לשניהם כבר יש תשובה בקוד

### `apiKey` בתרשים — נפתר ב-`{{secrets.…}}`

**נמדד.** התרשים ניתן לייצוא, ותפריט הייצוא שם אותו בתיבה להעתקה. סוד בתוכו הוא סוד שנוסע — הפגם שתוקן פעמיים ב-22.9.

`secrets.ts` כבר פותר בדיוק את זה: התרשים, הדפדפן, עקבת ההרצה היבשה ושורת הלוג מחזיקים `{{secrets.NAME}}`; הערך קיים רק בסביבת התהליך, וההחלפה קורית **בתוך הפורט היוצא — אחרי שורת הביקורת ואחרי שהאירוע נפלט**. `action.webhook` עובד ככה היום.

**לכן:** שדה ה-`apiKey` מקבל הפניה בלבד, ו-`arm-check` חוסם ערך שאינו הפניה.

### אין ספק AI — ואין צורך באחד

**נמדד.** אפס מפתחות ספק בסביבה. `ai` v7 ו-`@ai-sdk/openai` מותקנות ו**מעולם לא יובאו** (אפס ייבואים בכל הקוד).

**אבל כבר יש מסלול Claude מוקשח ופעיל** — `.claude/fleet/bin/run-role.sh`:

```bash
claude -p "$PROMPT" \
  --permission-mode dontAsk \
  --setting-sources project \
  --settings "$SETTINGS" \
  --model "$MODEL" \
  --output-format json
```

* **אין `ANTHROPIC_API_KEY`** — אימות ב-`CLAUDE_CODE_OAUTH_TOKEN` מ-`.claude/fleet/.token.env` (0600, gitignored).
* **ההרשאות לכלים הן קובץ settings לכל tier** — `dontAsk` = fail-closed, `deny` תמיד מנצח `allow`.
* **קיר שלישי**: hook `PreToolUse` שחוסם לפני הערכת ההרשאות; `allow` לא יכול לעקוף אותו.
* **killswitch, flock גלובלי, timeout קשיח, ורשומת NDJSON לכל הרצה** — כולל עלות ו-session_id.

**מוסק:** צומת AI לא צריך ספק חדש, מפתח חדש, או לולאת tool-calling משלנו. הוא צריך להריץ את אותו מנגנון עם קובץ settings משלו.

## 3. התכנון

### הצומת

`action.ai_agent`, `templateType: NodeType.AiNode`:

| שדה | פקד | הערה |
|---|---|---|
| `systemPrompt` | `VariableTextArea` | תומך `{{nodes.…}}` — כמו הספק |
| `tools` | `AiTools` | `tool` = שם כלי מותר; `apiKey` = `{{secrets.…}}` או ריק |
| `model` | `Select` | haiku / sonnet — מה שהצי כבר מריץ |
| `maxTurns` | `Text` | תקרה קשיחה |

### איך הכלים מגיעים ליכולות שלנו

**`.mcp.json` כבר קיים** (נמדד — שלושה שרתים: next-devtools, shadcn, supabase). כלומר MCP הוא מנגנון חי בפרויקט.

שרת MCP חדש, `kalfa-workflow`, חושף את `ctx.deps.guests` ככלים — והצומת רץ עם קובץ settings שמתיר **רק** את הכלים שהוא הגדיר.

**שלוש שכבות, כולן קיימות כבר:** שם הכלי בתרשים → `allow` ב-settings → hook שחוסם לפני הכול.

### ההרצה

`AiAgentPort` חדש ב-`engine/ports.ts`, בדיוק כמו `AccountingPort` שנוסף ב-22.9. ההרצה היבשה מקבלת stub שמחזיר טקסט מסומן ו**לא מריצה שום מודל** — אותה תכונה שנבדקת ב-`sumit-accounting.test.ts` בסריקת מקור.

---

## 4. מה שחייב הכרעה לפני שורת קוד

**⚠️ מודל שפה שיכול לכתוב לרשומות אורחים ולשלוח הודעות לאנשים אמיתיים.** CLAUDE.md מחייב תכנון לפני שינוי ב-messaging וב-guest-data, וזה שניהם בבת אחת.

| שאלה | למה היא חוסמת |
|---|---|
| כלים **קוראים בלבד** בגרסה ראשונה? | קריאה אינה הפיכה-לרעה; כתיבה כן |
| מי מאשר כלי שכותב? | היום אין שום מנגנון אישור לכלי |
| תקרת עלות לריצה? | הצי רושם `total_cost_usd`; לתהליך אין תקרה |
| מה קורה כשהמודל טועה? | `errorPolicy` קיים, אבל "טעה" ≠ "נכשל" |

**המלצה:** גרסה ראשונה **קוראת בלבד** — הסוכן מסכם, מסווג ומחליט, והפעולה נעשית בצמתים הקיימים שאחריו. זה נותן את כל הערך של סיווג וניתוב בלי לתת למודל יד על הנתונים.

## 5. אימות

* ההרצה היבשה לא מריצה מודל — סריקת מקור, כמו ב-SUMIT.
* `apiKey` שאינו `{{secrets.…}}` חוסם arming.
* כלי שאינו ב-settings נחסם — נבדק מול קובץ ה-settings עצמו.
* `outputSchema` מול מה שה-handler מחזיר — השער שנוסף ב-23.9.
* הזרקת תקלה על כל בדיקה חדשה.
* lint · tsc · סוויטה · build.
* **טרם אומת בדפדפן** ו**טרם אומת מול מודל חי**.
