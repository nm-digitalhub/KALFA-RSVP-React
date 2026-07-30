# Session Handoff Context


## Session Overview

| Field | Value |
|-------|-------|
| **Source** | Claude Code |
| **Session ID** | `8cc1946f-2f09-4f83-af1d-c2a39afae7f9` |
| **Working Directory** | `~/beta` |
| **Session File** | `~/.claude/projects/-var-www-vhosts-kalfa-me-beta/8cc1946f-2f09-4f83-af1d-c2a39afae7f9.jsonl` |
| **Repository** | kalfa.me/beta @ `main` |
| **Model** | claude-opus-5 |
| **Last Active** | 2026-07-28 03:46:07 UTC |
| **Tokens Used** | 131 in / 280,209 out |
| **Cache Tokens** | 11,614,860 read / 2,222,397 created |
| **Files Modified** | 1 |
| **Messages** | 10 |


## Summary

> A session-scoped Stop hook is now active with cond


## Current State

No response requested.


## Subagent Results

### Agent "Map autonomous fleet + agent defs" finished (a83fce2423970ea20)
> ## Summary
> 
> There are two completely separate systems. The **"autonomous agents" the owner means is (B) the fleet** — `/var/www/vhosts/kalfa.me/beta/.claude/fleet/`. It is a live pm2-hosted scheduler (`kalfa-fleet`, online 35h) that spawns headless `claude -p` runs on a clock. The `.claude/agents/*.md` files are ordinary Claude Code subagent definitions — they only exist inside an interactive session and nothing fires them on a schedule.
> 
> Nothing exists in `/var/www/vhosts/kalfa.me/.claude/` ...
> Tools used: 39

### Agent "Map voice-agent call stack" finished (ad7ef828025c785a1)
> ⚠️ Killed
> Tools used: 53

### Agent "Map customer/service/sales data surfaces" finished (a499120d8e2a94f31)
> ⚠️ Killed
> Tools used: 74

### Agent "Design data + dispatcher + fleet layer" finished (af26954b3522b003c)
> I have everything I need. Here is the plan.
> 
> ---
> 
> # KALFA Outbound CRM Voice Agents — Data + Dispatcher + Autonomous Fleet
> 
> **Scope owned here:** schema, consent model, dial queue/worker, admin controls, fleet roles.
> **Not owned here:** the Voximplant/ElevenLabs scenario + rule (telephony agent), the Israeli legal line (compliance agent). Every place their output plugs in is marked `[TELEPHONY]` / `[LEGAL]`.
> 
> ---
> 
> ## 0. What I verified by reading (and what I did not)
> 
> Confirmed by reading the...
> Tools used: 54

### Agent "Design telephony + persona layer" finished (aa14bbe21215d31c0)
> ⚠️ Killed
> Tools used: 73


## Key Decisions

- Subagent "Agent "Map autonomous fleet + agent defs" finished": ## Summary

There are two completely separate systems. The **"autonomous agents" the owner means is (B) the fleet** — `/var/www/vhosts/kalfa.me/beta/.claude/fleet/`. It is a live pm2-hosted scheduler (`kalfa-fleet`, online 35h) that spawns headless `claude -p` runs on a clock. The `.claude/agents/*.md` files are ordinary Claude Code subagent definitions — they only exist inside an interactive session and nothing fires them on a schedule.

Nothing exists in `/var/www/vhosts/kalfa.me/.claude/` ...
- Subagent "Agent "Map voice-agent call stack" finished": Now the API routes, lib, and other scenarios in parallel.
- Subagent "Agent "Map customer/service/sales data surfaces" finished": I'll start by exploring the repository structure and the uncommitted migration.
- Subagent "Agent "Design data + dispatcher + fleet layer" finished": I have everything I need. Here is the plan.

---

# KALFA Outbound CRM Voice Agents — Data + Dispatcher + Autonomous Fleet

**Scope owned here:** schema, consent model, dial queue/worker, admin controls, fleet roles.
**Not owned here:** the Voximplant/ElevenLabs scenario + rule (telephony agent), the Israeli legal line (compliance agent). Every place their output plugs in is marked `[TELEPHONY]` / `[LEGAL]`.

---

## 0. What I verified by reading (and what I did not)

Confirmed by reading the...
- Subagent "Agent "Design telephony + persona layer" finished": Corrections verified against the bundled typings (`typings/voxengine.d.ts`, the cdn.voximplant.com copy) and against our own live agent config. Three of your four corrections are right and one of your primitives is mis-specified in our typings. The design survives, but two of my rationales were wrong and are replaced below.

---

# ADDENDUM — corrected premises

## C1 · Two telephony architectures, argued from the docs

### What the typings actually say (all quotes verbatim)

`Call.transferTo...


## Recent Conversation

### User (2026-07-28 02:58:29 UTC)

[Request interrupted by user]

### Assistant (2026-07-28 02:59:30 UTC)

הצוות השני חזר. אבדוק את הנקודה שבדקת — `voxengine-ci` אכן חושף רק `init` ו-`upload`:

### Assistant (2026-07-28 02:59:50 UTC)

שניים מהשלושה חזרו עם תוכניות מלאות. כותב את התוכנית המאוחדת.

### User (2026-07-28 03:04:27 UTC)

[Request interrupted by user]

### Assistant (2026-07-28 03:05:35 UTC)

שלושת המומחים חזרו. חוות הדעת המשפטית משנה את התוכנית מהותית — כותב גרסה סופית.

### User (2026-07-28 03:05:43 UTC)

[Request interrupted by user]

### User (2026-07-28 03:06:02 UTC)

למה אתה לא מתייחססס!!! npm notice run tsx scripts/voximplant/cli.ts numbers      phone numbers : 1      97237219347          phone_id       : 2303422          country        : IL          status         : active          application_id : 11107202          rule_id        : —

### Assistant (2026-07-28 03:08:18 UTC)

צודק, פספסתי. וזה פלט חשוב — הוא מאשש הנחה אחת וחושף שני פערים:

**מספר אחד בלבד בחשבון**, `97237219347`, על אפליקציית הייצור 11107202. משמעויות:
- **אין caller ID נפרד לפרסונה.** שיחת RSVP לאורח, שיחת שירות ללקוח ושיחת מכירה — כולן מאותו מספר. `crm_voximplant_caller_id` שתוכנן אין לו למה להצביע בלי רכישת מספר שני.
- **סיכון עסקי אמיתי:** אם שיחות מכירה יגרמו לסימון המספר כספאם אצל המפעילים, זה פוגע ב**שיעור המענה של מוצר ה-RSVP עצמו** — הליבה. זו סיבה עצמאית להתחיל בפרסונה אחת ולא בשלוש.
- רגל …

### Assistant (2026-07-28 03:13:02 UTC)

שלחתי. שלושה דברים ששווה לדעת לפני שאתה קורא:

**מה השתנה מהותית מהבקשה המקורית** — חוות הדעת המשפטית קבעה ששיחת מכירה יזומה לליד קר שלא ביקש כלום נכשלת בשני חסמים **בלתי-תלויים** (חוק הספאם + הגבלת מטרה בחוק הגנת הפרטיות), כך שגם אם הפרשנות המקלה של "מערכת חיוג אוטומטי" תתקבל היא עדיין אסורה. לכן פרסונת המכירות **נבנית במלואה** אבל הבסיס החוקי שלה מוגדר מחדש: מי שביקש שיחת מכירה בטופס (`topic='מכירות'` — כבר קיים במערכת) או מי שנתן הסכמה שיווקית מתועדת. האכיפה היא עמודת `call_basis` בסכמה, לא כ…

### Assistant (2026-07-28 03:40:38 UTC)

No response requested.


## Tool Activity

### Shell (17 calls)

> `$ echo "=== .claude/agents ===" && ls -la .claude/agents/ 2>/dev/null && echo && echo "=== .claude/agents/shared ===" && ls -la .claude/agents/shared/ 2>/dev/null | head -30 && echo && echo "=== fleet files ===" && ls -la .claude/*.json .claude/fleet* 2>/dev/null && echo && echo "=== skills ===" && ls -la .claude/skills/ 2>/dev/null`
> ```
> lrwxrwxrwx  1 kalfa.me psacln    42 Jul 26 20:24 hyperframes-keyframes -> ../../.agents/skills/hyperframes-keyframes
> lrwxrwxrwx  1 kalfa.me psacln    41 Jul 26 20:24 hyperframes-registry -> ../../.agents/skills/hyperframes-registry
> lrwxrwxrwx  1 kalfa.me psacln    46 Jul 18 19:19 israeli-ai-compliance-kit -> ../../.agents/skills/israeli-ai-compliance-kit
> drwxr-xr-x  5 kalfa.me psacln  4096 Jul 26 17:30 israeli-consumer-contract-law
> drwxr-xr-x  4 kalfa.me psacln  4096 Jul 27 17:08 israeli-conte
> ```

> `$ echo "=== agent_configs ===" && ls -la agent_configs/ 2>/dev/null && echo && echo "=== docs/voice-agent ===" && ls -la docs/voice-agent/ 2>/dev/null && echo && echo "=== voximplant scenarios ===" && find . -path ./node_modules -prune -o -name "*.js" -path "*voxengine*" -print 2>/dev/null | head -20 && ls -la voxengine* 2>/dev/null | head`
> ```
> ./voxfiles/scenarios/src/VoiceABTest.voxengine.js
> ./voxfiles/scenarios/src/RSVP.voxengine.js
> ./voxfiles/scenarios/src/RSVPPreview.voxengine.js
> ./voxfiles/scenarios/src/Outgoingcall-RSVPAI.voxengine.js
> ./voxfiles/scenarios/src/RSVPAgent.voxengine.js
> ```

> `$ npx ctx7@latest library "ElevenLabs" "transfer call to human agent system tool in conversational AI agents" 2>&1 | head -60`
> ```
>    Context7-compatible library ID: /elevenlabs/elevenlabs-js
>    Description: The official Node.js SDK for ElevenLabs, enabling developers to integrate lifelike AI voices into their applications with ease.
>    Code Snippets: 1609
>    Source Reputation: High
>    Benchmark Score: 75.19
> ```

> `$ npx ctx7@latest docs /websites/elevenlabs_io "transfer_to_number and transfer_to_agent system tools: configuration, SIP REFER vs conversational transfer, required agent config fields" 2>&1 | head -200`
> ```
>         transfers=transfer_rules  
>     )  
> )  
> # Create the agent configuration  
> conve
> ```

> `$ npx ctx7@latest docs /websites/elevenlabs_io "client tools with custom telephony websocket integration: limitations of system tools outside native Twilio, and passing dynamic variables in outbound calls" 2>&1 | head -180`
> ```
> ```
> --------------------------------
> ### Handle Client Tools in JavaScript
> Source: https://elevenlabs.io/docs/eleven-agents/customization/widget
> Register an event listener for 'elevenlabs-convai:call' to define cu
> ```

> `$ echo "=== TOC of rsvp-conversation-design.md ===" && grep -n "^#\{1,3\} " docs/voice-agent/rsvp-conversation-design.md | head -60`
> ```
> 494:## 4.1 חוזה הכלי הקיים (פרוס)
> 511:## 4.2 כלים חדשים נדרשים (מסומנים בקטלוג)
> 522:## 4.3 [החלטת מוצר] — שאלות פתוחות
> 541:## 4.4 קשרים לתוצרים הבאים
> 550:## נספח (מוצע, 2026-07-26): הנחיית-קול "דיבור אנושי" ל-prompt של RSVPAgent
> ```

> `$ echo "=== docs/voximplant corpus ===" && ls docs/voximplant/ 2>/dev/null | head -30 && echo && echo "=== transfer/conference/REFER hits in corpus ===" && grep -rlin "forwardCallToPSTN\|SIP REFER\|conference\|transfer" docs/voximplant/ 2>/dev/null | head -20`
> ```
> docs/voximplant/research/vox-ref-gap-b.md
> docs/voximplant/research/guides-contact-center.md
> docs/voximplant/research/guides-conferences.md
> docs/voximplant/research/sdk-mobile.md
> docs/voximplant/research/vox-ref-avatar.md
> ```

> `$ sed -n '31,90p' docs/voice-agent/rsvp-conversation-design.md; echo "-----TOOLS-----"; sed -n '494,545p' docs/voice-agent/rsvp-conversation-design.md`
> ```
> ## 4.2 כלים חדשים נדרשים (מסומנים בקטלוג)
> | כלי מוצע | חוזה מוצע | תרחישים | הערות |
> |---|---|---|---|
> | הרחבת `save_rsvp` לסטטוס maybe | `{status: "attending"\|"declined"\|"maybe", adults, children}` (או כלי `mark_maybe` נפרד) | S-018 | `submit_rsvp` כבר תומך ב-maybe (E-7) — הפער הוא בחוזה הכלי בלבד |
> | `schedule_callback` | `{when: "later_today"\|"tomorrow"\|"iso-datetime?"}` → יוצר משימת חיוג ב-dispatche
> ```

*...and 9 more shell calls (all exit 0)*


### Write (3 calls)

> **`/var/www/vhosts/kalfa.me/.claude/plans/harmonic-beaming-stonebraker.md`** (new file) (+71 lines)
> ```diff
> +# צוות סוכנים: 2 נציגי שירות + נציג מכירות (קוליים) + תפקידי צי
> +
> +## Context
> +
> +הבעלים ביקש להקצות צוות מומחים שיבחן את הסוכנים האוטונומיים הקיימים ויבנה **3 סוכנים נוספים**: 2 נציגי שירות + 1 נציג מכירות. דרישות היכולת: להוציא שיחות יוצאות, לחזור ללקוח במועד מאוחר יותר, ובמידת הצורך — או כשהלקוח מבקש — **להעביר את השיחה החיה לבעלים**.
> +
> +החלטות הבעלים (נמסרו בסשן):
> +- **היקף:** גם 3 פרסונות קוליות (ElevenLabs+Voximplant) וגם 3 תפקידים בצי האוטונומי שמזינים אותן.
> +- **קהל יעד:** לקוחות קיימים · לידים קרים שלא המירו · פניות נכנסות שהשאירו טלפון.
> +- **העברה:** העברה חיה לבעלים + נפילה להתראה אם אינו זמין.
> +- **הפעלה:** להפעיל בסיום, עם שליטה על הפעלה/כיבוי מפאנל האדמין.
> +
> +התוצאה המכוונת: מנוע חיוג עסקי (CRM) נפרד ממנוע ה-RSVP הקיים — עם ספינת-נתונים משלו, שערי הסכמה משלו, ותיעוד שיחות משלו — שלא פוגע ולא נוגע במסלול האורחים שכבר חי באוויר.
> +
> +---
> +
> +## מיפוי מאומת של המצב הקיים
> +
> +### שתי מערכות "סוכנים אוטונומיים" נפרדות
> +1. **סוכני קול** — `agent_configs/KALFA-RSVP.json` (סוכן ElevenLabs יחיד) מגושר ב-`voxfiles/scenarios/src/RSVPAgent.voxengine.js` (1352 שורות) לכלל `OutCallAgent` (rule 1520915, app `kalfa-rsvp` 11107202).
> +2. **צי אוטונומי** — pm2 app `kalfa-fleet` מריץ `.claude/fleet/bin/scheduler.mjs`, טיק כל 60 שניות, קורא מחדש את `.claude/fleet/fleet.json` בכל טיק. 15 תפקידים מוגדרים, 13 קבצי prompt ב-`.claude/fleet/roles/`.
> +
> +### מה כבר קיים ושמיש כמו שהוא
> +- מתזמן שיחות-חוזרות מלא בייצור: `src/lib/data/call-callbacks.ts` + `QUEUES.callbackSweep` (cron `*/5`, singleton, claim-once).
> +- שער אימות טוקן אטום לכלי-סוכן: `src/lib/voximplant/agent-tool-guard.ts`.
> +- שרשרת 11 שערים לחיוג: `dispatchOutreachCall` ב-`src/lib/data/outreach-calls.ts:117-322`.
> +- `isDncListed()` — phone-first, fail-closed, מעל `call_dnc_list`.
> +- כוונון עברית יקר-ערך בקונפיג ElevenLabs (scribe_realtime, turn_v3, 16 מילות back-channel, eleven_v3_conversational).
> +- קונפרנס ורגל-מפקח בתרחיש (שורות 589-683) — התשתית להעברה קיימת חלקית.
> +- מיגרציה `20260728021842_callback_requests_scheduling.sql` — כבר הוחלה על ה-DB החי, מוסיפה ל-`callback_requests` את `requested_at`, `attempt_count`, `calendar_item_id`, `exchange_connection_id`, `scheduled_at` + אינדקס תור-עבודה. **אין לה שום קוד צורך עדיין, והיא לא מקומטת ב-git.**
> +
> +---
> +
> +## המגבלות החוסמות (מאומתות מול הקוד)
> +
> +### 1. העברת שיחה לבעלים — לא קיימת, ואי-אפשר לקנות אותה מ-ElevenLabs
> +`transfer_to_number` ו-`transfer_to_agent` אינם מוגדרים בסוכן, והתיעוד הרשמי קובע ש-`conference`/`blind` נתמכים רק באינטגרציית **Twilio מקורית**; `sip_refer` דורש רגל SIP. הסטאק כאן הוא גשר WebSocket מול Voximplant → **ההעברה חייבת להיבנות בצד Voximplant ככלי-לקוח**.
> +מה שכן קיים: `VoxEngine.createConference()` + `callUser()` לרגל מפקח (שורות 589-683) — אבל `callUser` מחייג לזהות SDK בתוך האפליקציה, לא לנייד; הוא מופעל רק ע"י אופרטור אנושי; והוא **כבוי** (`app_settings.monitor_enabled` default false → הראוט מחזיר 503). כל הפרימיטיבים ל-PSTN (`callPSTN` לרגל שנייה, `sendMediaBetween`, `Modules.Conference`) קיימים ולא בשימוש.
> +
> +### 2. עמוד השדרה של ההסכמה והתיעוד קשור לאירועים — לא ללקוחות
> +- `contacts` הוא **event-scoped** (`event_id NOT NULL`), ולכן `hasCallConsent(contactId)` מחזיר `false` לכל ליד ולכל לקוח → המנוע הקיים יסרב 100% מהשיחות האלה.
> +- `call_attempts` — טבלת תיעוד השיחות היחידה — נושאת שלושה FK NOT NULL: `event_id`, `campaign_id`, `contact_id`. **שיחה לליד לא יכולה להירשם בה בכלל.**
> +- אין בסכמה שום טבלת לידים/CRM/הזמנות, ואין שדה הסכמה שיווקית ללקוחות של KALFA עצמה (`user_settings` מכיל רק `event_updates`, `reminder_updates`, `billing_updates`).
> +→ נדרשת ספינת-נתונים חדשה: ישות "אדם שמותר לחייג אליו", מודל הסכמה phone-first, וטבלת תיעוד שיחות ללא FK לאירוע/קמפיין.
> +
> +### 3. סוכן ElevenLabs אחד לא ניתן ל"החלפת עור" בזמן שיחה
> +ב-`platform_settings.overrides.conversation_config_override` השדות `agent.prompt.prompt`, `first_message`, `llm`, `tool_ids`, `tts.voice_id` כולם `false` → override בזמן שיחה **נבלע בשקט**. לכן 3 פרסונות = **3 סוכני ElevenLabs נפרדים** (‏`agents.json` כבר מערך; `readAgentFleet()` כבר רב-סוכני).
> +
> +### 4. חוטים קשיחים לפרסונה אחת
> +- `RSVPAgent.voxengine.js:81` — `AGENT_ID` קבוע בקוד.
> +- `app_settings.voximplant_rule_id` הוא סקלר יחיד, ו-`dispatchOutreachCall` מעביר אותו תמיד. אין בחירת כלל/פרסונה לפי קמפיין.
> +- מטען ה-customData מוגבל ל-200 בתים (‏~110 בשימוש).
> +
> +### 5. תפקידי הצי לא יכולים לחייג — וזה בכוונה
> +ההרשאות לפי tier: tier0 קורא בלבד + כתיבה ל-`.fleet-logs` + ה-CLI של הצי; **חסומים** `curl`, `npx`, `node -e`, `supabase`, כל `.env`. tier2 (רק `main`) מוסיף `supabase db query` בלבד. **`Task` אינו מורשה באף tier** → תפקיד צי לא יכול להפעיל subagent. לכן התפקידים החדשים יכולים רק **לבנות רשימת חיוג ולבקש אישור**; החיוג עצמו חייב לעבור דרך ה-worker ושעריו.
> +
> +### 6. תקציב ריצות משותף
> +`daily_run_cap: 14` גלובלי לכל התפקידים יחד, וכל הריצות מסודרות בטור ע"י flock גלובלי — שני תפקידים באותה דקה = אחד מדלג (`"skipped":"lock"`). 3 תפקידים חדשים חייבים לוחות זמנים מרווחים, ועלולים לדחוק תפקידים קיימים.
> +
> +### 7. חשיפה משפטית — הקצה החד הוא המכירות
> +חיוג אוטומטי + תוכן פרסומי נכנס לתחום סעיף 30א לחוק התקשורת. הדגל הקיים `call_consent_required` (default true) הוא **guest-scoped** — אסור לרכב עליו, כי טוגל אחד ירים הסכמה לשתי אוכלוסיות לא קשורות. שיחת מכירה יזומה לליד קר שלא ביקש דבר היא המקרה הרגיש ביותר. חוות דעת משפטית מפורטת בהזמנה — תשולב לפני הגשת התוכנית.
> +
> +### 8. אימות אמיתי לא רץ אוטונומית
> +שיחה חיה, איכות הגייה בעברית ותקינות ההעברה ניתנות לאימות רק בשיחה אמיתית שהבעלים מריץ. כל שער סטטי (lint/tsc/build/tests) יעבור — ולא יוכיח שההעברה עובדת.
> +
> +---
> +
> +## Status
> +
> +מומחי העיצוב (טלפוניה+פרסונות · נתונים+מנוע חיוג+צי · משפטי) עובדים. התוכנית המלאה תיכתב כאן עם החזרתם.
> +
> ```

> **`/var/www/vhosts/kalfa.me/.claude/plans/harmonic-beaming-stonebraker.md`** (+199 lines)
> ```diff
> +# צוות סוכנים: 2 נציגי שירות + נציג מכירות (קוליים) + תפקידי צי
> +
> +## Context
> +
> +הבעלים ביקש להקצות צוות מומחים שיבחן את הסוכנים האוטונומיים הקיימים ויבנה **3 סוכנים נוספים**: 2 נציגי שירות + 1 נציג מכירות, שיודעים להוציא שיחות, לחזור ללקוח מאוחר יותר, ובמידת הצורך — או כשהלקוח מבקש — **להעביר את השיחה החיה לבעלים**.
> +
> +החלטות הבעלים שנמסרו בסשן:
> +- **היקף:** גם 3 פרסונות קוליות (ElevenLabs+Voximplant) וגם 3 תפקידים בצי האוטונומי שמזינים אותן.
> +- **קהל יעד:** לקוחות קיימים · לידים קרים שלא המירו · פניות נכנסות שהשאירו טלפון.
> +- **העברה:** העברה חיה לבעלים + נפילה להתראה אם אינו זמין.
> +- **הפעלה:** להפעיל בסיום, עם שליטה מלאה על הפעלה/כיבוי מפאנל האדמין.
> +
> +התוצאה המכוונת: **מנוע חיוג עסקי (CRM) נפרד לחלוטין ממנוע ה-RSVP** — ספינת נתונים משלו, שערי הסכמה משלו, תיעוד שיחות משלו, ותרחיש Voximplant משלו — שלא נוגע במסלול האורחים החי. הפרדה זו אינה העדפה אלא הכרח: מסלול ה-RSVP קשור מבנית לאירוע, וניסיון להרחיב אותו ללקוחות היה מחייב לפרק את גבולות הבעלות שמגנים על נתוני האורחים.
> +
> +---
> +
> +## מגבלות מאומתות (מול קוד ומול תיעוד חי)
> +
> +### 1. העברה לבעלים — לא קיימת; שתי ארכיטקטורות, אחת נכונה
> +`transfer_to_number` **אינו מופיע כלל** ב-`built_in_tools` של הסוכן; `conference`/`blind` נתמכים רק ב-Twilio מקורי; `sip_refer` — *"available only when using SIP protocol during conversation"*.
> +
> +ElevenLabs כן מציעה **SIP trunking כספק מדרגה ראשונה** (`CreateSIPTrunkPhoneNumberRequestV2`), ו-Voximplant יכולה לשמש כ-trunk — אז העברה מובנית **אפשרית עקרונית**, אך לא בגשר ה-WebSocket הנוכחי. **נדחתה**, כי SIP REFER הוא blind: בהצלחה Voximplant מתנתקת מהשיחה, ואז "הבעלים לא ענה → חזרה ללקוח + קביעת שיחה חוזרת" — בדיוק הדרישה — הופך לבלתי אפשרי. בנוסף מאבדים את שער ה-AMD, ההקלטה, נפילת ה-DTMF וערוץ הפקודות החי.
> +→ **ההעברה נבנית כ-client tool בצד Voximplant.** כל הפרימיטיבים קיימים: `callPSTN` לרגל שנייה, `sendMediaBetween`, `stopMediaTo`, `handleTones`, `Call.say`.
> +
> +### 2. עמוד השדרה של ההסכמה והתיעוד קשור לאירוע — לא ללקוח
> +- `contacts` הוא `event_id NOT NULL` → `hasCallConsent()` מחזיר `false` לכל ליד ולקוח.
> +- `call_attempts` נושאת שלושה FK NOT NULL (`event_id`, `campaign_id`, `contact_id`) → **שיחה לליד לא יכולה להירשם בה**.
> +- אין טבלת לידים/CRM, ואין שדה הסכמה שיווקית ללקוחות KALFA.
> +- `isDncListed()` הוא היחיד שעובד phone-first ו-fail-closed → **נעשה בו שימוש חוזר מילולי**.
> +
> +### 3. פרסונה אחת לכל סוכן ElevenLabs — בבחירה, לא בכפייה
> +`conversation_config_override` **כן** תומך ב-`prompt`/`first_message`/`llm`/`tool_ids`/`knowledge_base`/`voice_id`; ה-`false` בקונפיג שלנו הוא בחירה. **בכל זאת נבחרו 3 סוכנים נפרדים**, מארבע סיבות: (א) override של `tool_ids` יוצר אי-התאמה אפשרית מול `TOOL_ROUTES` הסטטי → הסוכן קורא לכלי שהתרחיש מתעלם ממנו ותולה עד timeout, בשקט; (ב) override שנשלח בלי שהדגל המתאים דלוק **נבלע ללא שגיאה** (מתועד בקוד, שורות 824-838) — זו כבר הכשילה את `schedule_callback`; (ג) פרומפט של 11K תווים היה עובר בחוט בכל שיחה ומפסיק להיות artifact נסקר ב-git; (ד) `evaluation.criteria` ו-`data_collection` הם per-agent ואינם ניתנים ל-override — כלומר סוכן אחד = בריכת שיחות אחת בלי הבחנה בין שירות למכירות.
> +`agents.json` כבר מערך ו-`readAgentFleet()` כבר רב-סוכני → **אפס שינויי קוד באפליקציה** כדי להחזיק שלושה סוכנים נוספים.
> +
> +### 4. מכסת 200 בתים ל-customData — מאומתת בתיעוד הרשמי
> +מדוד: המטען הנוכחי 113B. הוספת agent-id מלא = 154B (77% מהמכסה). **נדחה** — ה-agent id יגיע מ-ctx (0 בתים).
> +
> +### 5. תפקידי הצי לא יכולים לחייג — וזה יתרון
> +tier0 חוסם `curl`, `npx`, `node -e`, `supabase`, `.env`; `Task` חסום בכל ה-tiers. תפקיד יכול רק לקרוא ולהריץ את `fleet:agent`.
> +→ התפקידים **מציעים** בלבד. האילוץ `crm_call_queue_approved_before_dispatch` הופך שורה לא-מאושרת לבלתי-ניתנת-לחיוג **ברמת ה-DB** — כך שגם prompt שגוי לחלוטין לא יכול לגרום לטלפון לצלצל.
> +
> +### 6. תקציב ריצות משותף
> +`daily_run_cap: 14` גלובלי + flock יחיד. ראשון כבר ב-10/14 → שלושת התפקידים החדשים מפוזרים 13:00/13:30/14:00 בימים שונים (ראשון מגיע ל-11).
> +
> +### 7. חשיפה משפטית
> +`call_consent_required` הוא guest-scoped — **אסור לרכב עליו**. שיחת מכירה יזומה לליד קר היא הקצה הרגיש. *(חוות דעת הציות עדיין בהרצה — סעיף ייעודי יתווסף.)*
> +
> +### 8. אימות אמיתי אינו רץ אוטונומית
> +כל שער סטטי יעבור ולא יוכיח שההעברה עובדת. מטריצת שיחות חיה (§7) מורצת בידי הבעלים בלבד.
> +
> +### תגלית: תשתית שכבר על הדיסק ולא ב-git
> +`src/lib/callbacks/schedule-policy.ts` + `calendar-item.ts` + טסטים (untracked, נוצרו במהלך הסשן) — **מנוע שעות-חיוג מלא ובדוק**: ראשון-חמישי 09:00-18:00, שישי 09:00-13:00, שבת סגור, שבת וחגים דרך `buildJewishCalendar`, מינימום התראה שעתיים, אופק 14 יום, תקרה יומית. יחד עם המיגרציה `20260728021842` (כבר הוחלה חי, לא מקומטת). **אין לכתוב מנוע שני** — זהו שער שעות-החיוג. `calendar-item.ts` נושא הכרעת בעלים מילולית שיש לכבד: *"סוכן אוטונומי רשאי לקבוע שיחה חוזרת בלי אישור דווקא משום שאינו יכול לבחור מה כתוב בפגישה"* — השרת מרכיב כל שדה מעמודות מובנות.
> +
> +---
> +
> +## הארכיטקטורה
> +
> +### שלוש הפרסונות
> +
> +| מפתח DB | שם | תפקיד | קהל |
> +|---|---|---|---|
> +| `customer_care` | **שני** | שירות יזום — ליווי, סטטוס, "הכול זז?" | לקוחות עם אירוע פעיל |
> +| `inbound_followup` | **עדי** | חזרה לפניות — מי שביקש שיחזרו אליו, תלונות, שימור | `callback_requests` / `contact_messages` |
> +| `lead_sales` | **רוי** | מכירות — הבנת צורך והעברה לבעלים לסגירה | לידים שנרשמו ולא המירו |
> +
> +גבול קשיח משותף לשלושתם: **אינם מתמחרים, אינם מבטיחים, ואינם ממציאים.** מחיר/הנחה/תנאי תשלום/התחייבות → `transfer_to_owner`. שאלה ללא תשובה במשתנים → `crm_alert_owner`.
> +
> +### מבנה קבצים
> +
> +```
> +agent_configs/KALFA-CS-SHANI.json | KALFA-CS-ADI.json | KALFA-SALES-ROI.json   ← חדשים
> +agent_configs/KALFA-RSVP.json                                                  ← ללא נגיעה
> +tool_configs/transfer_to_owner.json crm_book_callback.json crm_alert_owner.json
> +             crm_mark_dnc.json crm_log_outcome.json                            ← 5 כלים משותפים
> +voxfiles/scenarios/src/CRMAgent.voxengine.js                                   ← תרחיש אחד
> +voxfiles/applications/…/rules.config.json                    ← + OutCallCRM, + CRMAgentPreview
> +src/lib/data/crm-calls.ts crm-queue-sweep.ts crm-ingest.ts crm-consent.ts      ← request-free
> +src/lib/data/admin/crm-agents.ts crm-queue.ts
> +src/app/(admin)/admin/voice/agents/{page,agents-client,queue-client,actions}.tsx
> +src/app/api/voximplant/transfer-target/[token]/route.ts
> +src/app/api/voximplant/agent-tool/crm/{callback,alert,dnc,outcome}/[token]/route.ts
> +.claude/fleet/roles/crm-{inbound,care,sales}-lister.md  +  fleet.json entries
> +supabase/migrations/2026072909{0,1,2}000_*.sql
> +```
> +
> +**תרחיש אחד, לא שלושה.** ה-agent id מגיע מ-ctx; ctx שנכשל או שאינו מחזיר `agent_id` → **לא מחייגים** (הפוך מכלל ה-RSVP, שממשיך עם משתנים ריקים). זה חינם, כי ctx נשלף **לפני** `callPSTN` — וזה בדיוק מה שנותן שיניים למתג ההפעלה/כיבוי הפר-פרסונה בפאנל האדמין.
> +
> +---
> +
> +## `transfer_to_owner` — הליבה
> +
> +**עיצוב: שתי רגליים ישירות, לא קונפרנס.** בהעברה חמה יש בכל רגע בדיוק שני צמדי מדיה — הקונפרנס נועד לשלושה. בנוסף `createConference()` בקוד הקיים נקרא ללא ארגומנטים בעוד הטיפוסים דורשים `hd_audio`, והשורה **מעולם לא רצה** (‏`monitor_enabled=false` → 503). לא בונים את מסלול ההסלמה על API לא-מאומת. (וריאנט `intro3way` נשאר מאחורי דגל כבוי.)
> +
> +**מכונת מצבים:** `idle → ringing → accepting → bridged`, עם נפילה מכל שלב ל-`owner_unavailable`.
> +- הודעת המתנה ללקוח ב-+2.5 שניות (`call.say`).
> +- **watchdog צלצול 15 שניות** (ברירת המחדל של Voximplant היא 60 — לקוח לא ימתין).
> +- **שער קבלה בהקשה על 1** אחרי `Connected`, עם whisper לבעלים בלבד: "שיחה מקלפה. ‹סיכום›. להקיש אחת כדי לקבל." — זה מה שמונע מסירת לקוח לתא הקולי של הבעלים ורישום `transferred` שקרי.
> +- בגישור: `stopMediaTo` בשני הכיוונים **קודם** (אחרת השיחה האנושית ממשיכה לזרום ל-ElevenLabs — פרטיות ועלות), ואז `sendMediaBetween(call, owner)`, ואז סגירת ה-WS.
> +
> +**שלוש מלכודות והשומרים שלהן:**
> +1. `agent.close()` מפעיל `onWebSocketClose` → `scheduleHangup(call, 2000)` → **כל העברה מוצלחת הייתה מתנתקת 2 שניות אחרי שהצליחה.** דגל `state.transferHoldsCall` חוסם זאת בארבעה מקומות (WS close, `end_call`, `cleanupAndTerminate`, ה-timeout הגלובלי).
> +2. `GLOBAL_TIMEOUT_MS = 150s` היה חותך שיחת מכירה אנושית באמצע → מנוטרל בגישור ומוחלף ב-`TRANSFERRED_MAX_MS` (30 דק').
> +3. חיוב ElevenLabs: בזמן צלצול (≤22ש') ה-WS פתוח ומחייב — נסבל. **אחרי גישור, בלי סגירת WS, שיחת מכירה של 12 דקות הייתה מחייבת 12 דקות ElevenLabs ומזרימה משא-ומתן מסחרי פרטי לצד שלישי.** סגירת ה-WS היא בו-זמנית בקרת עלות ובקרת פרטיות.
> +
> +**מספר הבעלים — מאיפה:** endpoint ייעודי `GET /api/voximplant/transfer-target/{token}`, נשלף **רק ברגע ההעברה**. לא customData (המכסה, ובעיקר: `customData` נרשם ל-call history ומודפס ללוג בשורה הראשונה של התרחיש), ולא ctx (רץ בכל שיחה; ומטען ctx דלוף היום חושף שם פרטי — הוספת נייד הבעלים הופכת את אותו טוקן ליכולת דוקסינג). השליפה העצלה גם נותנת למתג `voice_transfer_enabled` תוקף **תוך כדי שיחה**. המספר חי ב-`const` מקומי, לא נכתב ללוג, לא ל-state, ולא מגיע ל-LLM לעולם; ב-DB נשמר `destination_fingerprint` (SHA-256 קטום).
> +
> +**תשובה כנה בשלושה מצבים** (כמו `saved|rejected|queued`, תמיד `is_error:false`):
> +`transferred` (שתוק לגמרי) · `owner_unavailable` (התנצל, קבע חזרה) · `unavailable` (לא ניסינו — **אל תגיד "ניסיתי להשיג אותו"**).
> +
> +---
> +
> +## ספינת הנתונים
> +
> +**מיגרציה A — `crm_contacts` + `crm_consent_events` + `user_settings`**
> +`crm_contacts` מזוהה ב-`normalized_phone` (E.164, UNIQUE) — אותו מפתח קנוני ש-`call_dnc_list` משתמש בו כ-PK, כך שההשתקה מתחברת בלי שכבת תרגום. `user_id` מקשר לחשבון; `display_name` מאוכלס **רק** כשאין חשבון (אפס כפילות מול `profiles`). עמודות בסיס חוקי נפרדות: `service_consent_at` · `marketing_consent_at` · `inbound_consent_at` + `inbound_consent_expires_at` · `phone_verified_at` (**הוכחת בעלות, לא הסכמה**). `crm_consent_events` = יומן append-only שנאכף בטריגר (service_role עוקף RLS אך לא טריגרים).
> +`user_settings` מקבלת `service_call_consent_at` ו-`marketing_call_consent_at`, **DEFAULT NULL**. שלוש העמודות הקיימות (`event_updates` וכו') הן העדפות התראה שברירת המחדל שלהן `true` ומעולם לא הוצגו כרשות לחייג — שימוש בהן היה ייצור הסכמה רטרואקטיבית במיגרציה.
> +
> +**מיגרציה B — `crm_call_queue` + `crm_call_attempts`**
> +התור הוא **גבול ההרשאה**. שורה נולדת `proposed`; רק פעולת שרת עם `manage_voice` חותמת `approved_by/approved_at`; והאילוץ
> +`check (dispatched_at is null or approved_at is not null)`
> +הופך שורה לא-מאושרת לבלתי-ניתנת-לחיוג. `crm_call_attempts.queue_item_id UNIQUE` הוא שומר האידמפוטנטיות (מחליף את כל מנגנון ה-touchpoint). אינדקס `crm_call_queue_one_open` מבטיח פריט פתוח אחד לאדם.
> +
> +**מיגרציה C — דגלי `app_settings`** — 17 עמודות, **כולן בטוחות כברירת מחדל**: `crm_calls_enabled=false`, שלושת מתגי הפרסונות `false`, `crm_consent_required=true`, `crm_inbound_consent_days=30`, `crm_contact_message_phone_is_consent=false`, תקרות, `crm_transfer_phone`, `voice_transfer_enabled=false`, `crm_voximplant_rule_id`. **אין נגיעה ב-`call_consent_required`.**
> +
> +**+ `owner_transfer_legs`** — טבלה חדשה. `human_agent_call_legs` אינה מתאימה: `agent_id` מפנה ל-`console_agents`, ה-CHECK על `mode` הוא `('monitor','takeover')` בלבד, וכל מדיניות ה-RLS שלה היא `agent_id = auth.uid()` — הבעלים אינו console agent, והשורה הייתה בלתי-נראית לפאנל.
> +
> +**שרשרת 14 השערים** ב-`dispatchCrmCall` משקפת צעד-בצעד את `dispatchOutreachCall`, כולל איחוד הטיפוסים (`skipped|blocked|transient_error` — רק בדיקת היתרה ניתנת ל-retry, כדי ש-retry לעולם לא יחייג פעמיים). שער 8 הוא `findCallbackSlot` מ-`schedule-policy.ts` — ומחוץ לשעות הוא **מתזמן מחדש** את פריט התור במקום להפיל אותו.
> +
> +---
> +
> +## פאנל האדמין — `/admin/voice/agents`
> +
> +לא הרחבה של `/admin/channels` (שם כבר תועד באג של טפסים שדורסים מתג משותף; ושם חיים אישורי ספקים, לא סוכנים). שבעה כרטיסים: מתג ראשי · שלושת הסוכנים · מספר להעברה · שעות חיוג (**שבת וחגים מוצגים כשורה נעולה — החסימה היא קוד, לא צ'קבוקס**) · תקרות · תור לאישור (אשר/דחה שורה-שורה, בלי אישור-גורף) · היסטוריית שיחות.
> +
> +הרשאות: `manage_voice` לקונפיג, `view_customer_data` לתור ולהיסטוריה (שם יש שם וטלפון של אדם), `view_recordings` להקלטה. פתיחת שורה מפעילה `recordStaffAccess` — אותו break-glass של `getUserDetail`. כל הדלקת פרסונה יורה `sendSlackAlert(level:'warn', category:'security')`.
> +
> +**מתג ההפעלה שביקשת עובד בשלוש שכבות:** הדגל ב-DB → ctx לא מחזיר `agent_id` → התרחיש לא מחייג. גם שיחה שכבר בתור לא תצא.
> +
> +---
> +
> +## תפקידי הצי
> +
> +שלושה תפקידים Tier-0: `crm-inbound-lister` (א'-ה' 13:00) · `crm-care-lister` (ג' 13:30) · `crm-sales-lister` (ד' 14:00), כולם `enabled:false` עד אישור.
> +
> +הפעולה היחידה שלהם: פועל חדש ב-CLI —
> +`npm run fleet:agent -- crm-queue --role R --persona P --contact <uuid> --reason "<בלי PII>"`
> +שמכניס שורה `proposed` עם `approved_by: null`. שמונה שומרים בתוך הפועל, ובהם: הפרסונה חייבת להתאים לתפקיד, `--reason` נדחה אם הוא נראה כמו טלפון/אימייל, ו**הפועל מריץ מחדש את אותה `hasCrmCallConsent` שהמנוע מריץ** — תפקיד לא יכול להציע מי שאין בסיס לחייג אליו גם בטעות. תקרה 25 הצעות ליום לתפקיד.
> +
> +הלולאה נסגרת דרך answer-watcher: התפקיד מגיש `request --kind approval`, הבעלים עונה, ה-watcher **מזניק את התפקיד מחדש** (`auto_ack` מכוון ל-false) כדי שיקרא אילו הצעות אושרו ואילו נדחו — ו**ילמד מהדחיות**. ריצת הוורדיקט אינה נספרת במכסה היומית.
> +
> +---
> +
> +## סדר ביצוע
> +
> +| # | שלב | שער אימות | אישור בעלים |
> +|---|---|---|---|
> +| 0 | קימוט מה שכבר על הדיסק: `20260728021842` + `src/lib/callbacks/` + `types.ts` | `vitest run src/lib/callbacks` | סקירת קוד |
> +| 1 | מיגרציה A + `gen types --linked` | `verify:db`, tsc | **כן — DB חי** |
> +| 2 | מיגרציה B (+ `owner_transfer_legs`) + types | `verify:db`, tsc | **כן — DB חי** |
> +| 3 | מיגרציה C + types | `verify:db`, tsc | **כן — DB חי** |
> +| 4 | שכבת הסכמה + ingest (בלי חיוג) | טסטי fail-closed, `worker:deps` | לא |
> +| 5 | צ'קבוקסים ב-`/app/settings` — **בלעדיהם אין למי לחייג** בשתי פרסונות | טסטים, build | סקירת נוסח |
> +| 6 | פאנל אדמין (כל הדגלים כבויים → הדף אינרטי) + עדכון `admin-data-layer-coverage.test.ts` | טסט הכיסוי **חייב** לעבור | לא |
> +| 7 | 3 סוכני ElevenLabs + 5 כלים (‏§CLI) | G1-G3 (drift, tool_ids, כוונון עברית) | לא |
> +| 8 | `CRMAgent.voxengine.js` + 5 ראוטים + `voxOwnerTransferSchema` | `node --check`, tsc, טסטי ראוט, `upload --dry-run` ל-kalfatest | לא |
> +| 9 | מנוע חיוג + sweeps — **חשוך** (שער 1 חוסם הכול) | טסט סדר-שערים, build | לא, ולא להדליק דגל |
> +| 10 | פועל `crm-queue` + 3 תפקידי צי (`enabled:false`) | הרצה ידנית מול איש קשר מזורע | לא |
> +| 11 | **מטריצת שיחות חיות R1-R9** | ראה למטה | **כן — כסף אמיתי** |
> +| 12 | עלייה לאוויר, פרסונה אחת (`inbound_followup`), אישור שורה-שורה | תצפית חיה | **כן** |
> +
> +בין שלב 0 לשלב 11 **שום דבר אינו יכול לחייג**, ושלב 12 הוא שינוי קונפיג בלבד ללא קוד.
> +
> +---
> +
> +## אימות
> +
> +**סטטי (ללא עלות):** בדיקת drift אמיתית היא `pull --update` + `git diff --exit-code` (‏`agents status` **אינו** בודק drift — אומת בקוד ה-CLI). אסרציה ש-`tool_ids` מכיל את חמשת המזהים ולא מזהה זר. אסרציה שנועלת את כוונון העברית (scribe_realtime, turn_v3, 16 מילות back-channel, eleven_v3_conversational, phoneme tags) **ואת מצב ה-overrides על `false`** — כדי שהחלטה §3 לא תבוטל בשקט בעוד חצי שנה.
> +
> +**בדיקות סוכן ללא טלפוניה:** 11 בדיקות ב-agent-testing. שתי הקריטיות: הסוכן **שותק** אחרי `transferred`, והסוכן **אינו אומר "ניסיתי להשיג אותו"** אחרי `unavailable`.
> +
> +**בלי PSTN, על `kalfatest`:** אפשר להוכיח שלושה דברים בלי לחייג לאיש — עצירה כשאין `agent_id`, חסימה כש-`voice_transfer_enabled` כבוי, ושרידות הרגל כשה-WS נסגר.
> +
> +**מטריצת שיחות חיות — הבעלים בלבד, שני מכשירים:** R1 בסיס · **R2 הבעלים מקבל (מפריך את מלכודת הניתוק)** · R3 לא עונה · R4 עונה ולא מקיש · R5 דוחה · R6 הלקוח מנתק באמצע צלצול · R7 הבעלים מנתק אחרי גישור · R8 כיבוי המתג תוך כדי שיחה · **R9 שיחה מועברת מעל 3 דקות (מפריכה את מלכודת החיוב ואת חיתוך ה-150 שניות)**.
> +אימות R1-R2 מהאודיו המוקלט דרך Scribe — **לא** מתמלול הסוכן, שכבר הסתיר באג בעבר.
> +
> +---
> +
> +## הכרעות פתוחות לבעלים
> +
> +1. **קולות** — שלושה `voice_id` בעברית, לאודישן על `eleven_v3_conversational` עם `enable_phoneme_tags`. שימוש בקול ה-RSVP לשלושתם אפשרי כברירת מחדל אך מבטל את טעם ההפרדה.
> +2. **`daily_run_cap`** — העלאה מ-14 ל-18 (ראשון יגיע ל-11/14).
> +3. **הסכמה ללקוחות קיימים** — האם שיחת שירות על האירוע של הלקוח עצמו דורשת אופט-אין. אם התשובה שלילית, זו שורה אחת ב-`hasCrmCallConsent` — והופכת להחלטה מתועדת במקום תאונה.
> +4. **`crm_contact_message_phone_is_consent`** — האם טלפון שנמסר בטופס יצירת קשר חופשי הוא בסיס לחיוג. ברירת מחדל: לא.
> +5. **הקלטה אחרי ההעברה** — `call.record()` ממשיך, כלומר **גם קולו של הבעלים והשיחה האנושית המלאה מוקלטים**. הגילוי שנאמר בפתיחה עסק בסוכן AI ואינו מכסה זאת בבירור.
> +
> +## הודאה בכנות
> +
> +עם הסכמה כמעט: **`customer_care` ו-`lead_sales` יתחילו עם אפס אנשי קשר לחייג אליהם** (הצ'קבוקסים בשלב 5 טרם מולאו ע"י איש). רק `inbound_followup` מקבל אוכלוסייה אמיתית מיד. זו נקודת ההתחלה הנכונה, וזו הסיבה שהיא הפרסונה הראשונה שעולה לאוויר. ייצור בסיס יש-מאין — backfill, "הסכמה משתמעת מהיותך לקוח", מִחזוּר `event_updates` — הוא בדיוק הכשל שהעיצוב הזה קיים כדי למנוע. הפאנל יציג לכל פרסונה "כרגע N אנשי קשר עומדים בתנאי החיוג", וכש-N=0 יאמר זאת במפורש.
> +
> ```

> **`/var/www/vhosts/kalfa.me/.claude/plans/harmonic-beaming-stonebraker.md`** (+147 lines)
> ```diff
> +# צוות סוכנים קוליים: 2 שירות + 1 מכירות, עם העברה חיה לבעלים
> +
> +## Context
> +
> +הבעלים ביקש להקצות צוות מומחים שיבחן את הסוכנים האוטונומיים הקיימים ויבנה **3 סוכנים נוספים** — 2 נציגי שירות ו-1 מכירות — שיודעים להוציא שיחות, לחזור ללקוח מאוחר יותר, ובמידת הצורך או לבקשת הלקוח **להעביר את השיחה החיה לבעלים**.
> +
> +החלטות שנמסרו בסשן: היקף = פרסונות קוליות **וגם** תפקידי צי · קהל = לקוחות קיימים, לידים שלא המירו, פניות נכנסות שהשאירו טלפון · העברה = חיה + נפילה להתראה · הפעלה = בסיום, בשליטת פאנל האדמין.
> +
> +התוצאה: **מנוע חיוג עסקי (CRM) נפרד ממנוע ה-RSVP** — סכמה, הסכמות, תיעוד ותרחיש משלו — שאינו נוגע במסלול האורחים החי. שלושה מומחים מיפו ותכננו (טלפוניה · נתונים ומנוע · ציות ישראלי); חוות הדעת המשפטית שינתה מהותית את הגדרת פרסונת המכירות, וזה משוקלל כאן.
> +
> +---
> +
> +## מה שנמצא, בקצרה
> +
> +**קיים ושמיש:** מתזמן שיחות-חוזרות בייצור (`call-callbacks.ts`, claim-once) · שער טוקן אטום לכלי-סוכן (`agent-tool-guard.ts`) · שרשרת 11 שערים (`dispatchOutreachCall`) · `isDncListed` phone-first fail-closed · כוונון עברית יקר-ערך בקונפיג ElevenLabs · **מנוע חלונות שליחה מלא עם שבת וחגים** (`src/lib/outreach/send-policy.ts` + `jewish-calendar.ts` + `send-window.ts`, נשמר ב-`app_settings.whatsapp_send_policy`) · תשתית לוח-שנה לא-מקומטת (`src/lib/callbacks/` + מיגרציה `20260728021842` שכבר הוחלה חי).
> +
> +**חסר לגמרי:** העברה לבעלים · טבלת CRM/לידים · שדה הסכמה שיווקית · טבלת תיעוד שיחות ללא FK לאירוע · **עמודת בסיס חוקי לחיוג**.
> +
> +---
> +
> +## מגבלות מאומתות
> +
> +**1 · העברה לבעלים — לא קיימת; נבנית בצד Voximplant.**
> +`transfer_to_number` אינו מוגדר בסוכן; `conference`/`blind` — Twilio מקורי בלבד; `sip_refer` — רק כשהשיחה עצמה SIP. **תיקון לניסוח מוקדם:** ElevenLabs כן מציעה SIP trunking כספק מדרגה ראשונה, ו-Voximplant יכולה לשמש כ-trunk — כלומר העברה מובנית **נגישה**. היא **נדחית**, ומטעם מדויק: כל פרימיטיב ממשפחת REFER **מעביר שליטה**. `transferTo` מנתק אותנו בהצלחה מוגדרתית; הדרישה כאן היא העברה **שאפשר לקחת בחזרה** ("הבעלים לא ענה → חזרה ללקוח → קביעת חזרה"). בנוסף REFER אינו יודע **לסנן**: אין בו מקום ל-whisper ולשער קבלה, ולכן תא קולי של הבעלים היה בולע את הלקוח ונרשם כ-`transferred`. מסלול SIP גם היה מוחק את שער ה-AMD (חיסכון מלא בתא קולי), את ערוץ הפקודות החי (‏`media_session_access_secure_url` מגיע רק מ-`StartScenarios`), ואת שלושת תיקוני התקלות שנבנו על אירועי הקונקטור.
> +`Call.transferTo` במצב attended נשמר כמסלול עתידי אם הבעלים יעבור לזהות SIP.
> +
> +**2 · ההסכמה והתיעוד קשורים לאירוע, לא ללקוח.**
> +`contacts` הוא `event_id NOT NULL` ⇒ `hasCallConsent` מחזיר `false` לכל ליד ולקוח. `call_attempts` נושאת שלושה FK NOT NULL ⇒ שיחה לליד **לא יכולה להירשם בה**. `isDncListed` הוא היחיד שעובד phone-first — ובמפורש **חובה משפטית** לשמור אותו משותף: ס' 30א(ד) פועל על מספר טלפון, ולכן הסרה שנקלטה בערוץ האורחים חוסמת גם את שלושת הסוכנים.
> +
> +**3 · 3 סוכני ElevenLabs נפרדים — בבחירה מנומקת.**
> +‏`conversation_config_override` **כן** תומך ב-prompt/first_message/llm/tool_ids/voice_id (שניים מ-16 העלים כבר `true` אצלנו). ההפרדה נבחרת בכל זאת כי מה ש**אינו** ניתן ל-override הוא בדיוק מה שהופך פרסונה למדידה: `data_collection` (סכמת החילוץ — אחרת נקבל איחוד מטושטש של שלוש), `evaluation.criteria` ("האם התקדם לסגירה" = הצלחה אצל מכירות ו**כשל** אצל שירות), `built_in_tools` והתיאורים שלהם, ואנליטיקה+בדיקות שמתחברות ל-agent id. עלות שיש להודות בה: `asr`/`turn` גם הם per-agent ⇒ כוונון העברית משוכפל שלוש פעמים. מנוטרל ע"י אסרציית CI שמשווה את שלושת התתי-עצים + `scripts/sync-agent-tuning.ts`.
> +**`prevent_subagent_loops: true`** בשלושת הקונפיגים (ב-RSVP הוא `false`). `transfer_to_agent` **אינו מופיע** ב-`built_in_tools` החי — על החשבון הזה המנגנון הוא גרף `workflow` + `run_subagent`; לאמת ב-pull לפני שמתכננים עליו.
> +
> +**4 · מכסת 200 בתים ל-customData** (מאומת בתיעוד). מדוד: 113B היום, 154B עם agent id מלא. ⇒ ה-agent id יגיע מ-**ctx** (0 בתים), ו-ctx שאינו מחזיר `agent_id` ⇒ **לא מחייגים**.
> +
> +**5 · מספר טלפון אחד בלבד בחשבון** — `97237219347`, app 11107202, **ללא רגל ניתוב נכנס** (`rule_id: —`).
> +⇒ אין caller ID נפרד לפרסונה; ⇒ **סיכון ליבה:** סימון המספר כספאם בגלל שיחות מכירה פוגע בשיעור המענה של מוצר ה-RSVP עצמו; ⇒ **אי-אפשר לחזור אל המספר** — פער תפעולי שגם נוגע בחובת גילוי דרכי ההתקשרות.
> +
> +**6 · תפקידי הצי לא יכולים לחייג — וזה יתרון.** tier0 חוסם curl/npx/supabase/.env; `Task` חסום בכל ה-tiers. ⇒ תפקידים **מציעים** בלבד, והאילוץ `crm_call_queue_approved_before_dispatch` הופך שורה לא-מאושרת לבלתי-ניתנת-לחיוג **ברמת ה-DB**. `daily_run_cap: 14` גלובלי + flock ⇒ לוחות זמנים מרווחים.
> +
> +**7 · אימות אמיתי אינו רץ אוטונומית.** כל שער סטטי יעבור בלי להוכיח שההעברה עובדת.
> +
> +---
> +
> +## המגבלה המשפטית — משנה את התוכנית
> +
> +חוות דעת מלאה נשלפה מנבו חי (חוק התקשורת ס' 30 ו-30א · חוק הגנת הצרכן ס' 14ג/14ג1/16ב/16ג + **התוספת השישית** · תקנות מאגר פניות שיווקיות תשפ"ב-2022 · האזנת סתר · הגנת הפרטיות אחרי תיקון 13).
> +
> +**סיווג:**
> +| פרסונה | מסקנה |
> +|---|---|
> +| פניות נכנסות | **בת-ביצוע.** התוספת השישית פרט 1 מכיר במפורש בפנייה למי שביקש שיחזרו אליו — **והנטל להוכיח זאת על העוסק**. |
> +| לקוחות קיימים | **בת-ביצוע לשירות בלבד.** פרט 2 מתיר פנייה "בתקופת העסקה ולגבי אותה עסקה" ו**אוסר** על עסקה אחרת או הארכה — אלא אם הלקוח העלה זאת מיוזמתו (ואז חובה לתעד את היוזמה). |
> +| מכירות ללידים קרים | **אינה בת-ביצוע כפי שתוארה.** |
> +
> +**שני חסמים בלתי-תלויים למכירות לליד קר** — כך שגם אם הפרשנות הצרה של "מסר קולי מוקלט" ב-30א(א) תתקבל (סוכן AI שיחתי אולי אינו "מערכת חיוג אוטומטי" — שאלה פתוחה אמיתית), הפרסונה עדיין נכשלת:
> +1. **חוק הספאם:** התוכן הוא "דבר פרסומת"; אין הסכמה; חריג 30א(ג) **אינו זמין** כי תנאי (1) — הודעה בת-הזמן בעת מסירת הפרטים שהם ישמשו לפרסומת **בדרך זו** — מעולם לא ניתן; וחריג "הפנייה החד-פעמית" ב-30א(ב) חל רק על **בית עסק** ורק כשהתוכן הוא בקשת הסכמה, לא פיץ'.
> +2. **הגנת הפרטיות ס' 8(ב):** הטלפון נאסף למטרת חשבון ושירות; שיחת מכירה יזומה היא **מטרה אחרת**.
> +החשיפה א-סימטרית: 30א(י)(1) — עד 1,000 ₪ לשיחה ללא הוכחת נזק, מצטבר; (י)(5) — חזקת "ביודעין"; (ח) — אחריות אישית.
> +
> +**ולכן פרסונת המכירות מוגדרת מחדש** — ונשארת פרסונה שלישית מלאה:
> +- **מותר היום:** ליד שמילא בקשת חזרה טלפונית ובחר `topic='מכירות'` **ביקש שיחת מכירה**. `INQUIRY_TOPICS` כבר כולל את הערך. זהו **ערוץ המכירות האוטומטי החוקי היחיד ב-KALFA כיום**.
> +- **נפתח בהמשך:** לכידת הסכמה שיווקית לפי אמת-המידה שהמחוקק עצמו קבע (פרט 3): מסמך נפרד בכתב (אלקטרוני מספיק), הבהרה מפורשת ש**אין בהסכמה הסכמה לעסקה**, תוקף **שנה**, ניתן לביטול — תקן שמקיים גם את "הסכמה מפורשת מראש בכתב" של 30א(ב).
> +- **המסלול המהיר להמרת לידים קרים** אינו טלפוני אלא **in-app**: התראה בתוך המוצר למשתמש מחובר אינה "שיגור" באף אחד מארבעת האמצעים ברשימה הסגורה של 30א(ב).
> +
> +**חובות שנכנסות לעיצוב:**
> +- 🔴 **`call_basis`** — עמודה חדשה, ערכים סגורים (`inbound_callback` | `inbound_sales_callback` | `service_existing_customer` | `explicit_marketing_consent`). **חיוג ללא ערך מוכר = חסימה.** זה מה שהופך את החוק לאכיפה בקוד במקום למדיניות בפרומפט.
> +- 🔴 **שעות:** לצרוך את `send-policy`/`jewish-calendar` הקיימים (א'-ה' 09:00-20:30 hardCap 21:00 · ו' 09:00-12:00 · שבת `null` · חסימת שבת ויו"ט מ-hebcal), **לא** 08:00-21:00. אין בדין הוראת שעות לשיחות שיווק — העוגן הוא ס' 30 לחוק התקשורת ("הטרדה", מאסר שלוש שנים), והיקש מס' 18א(ג)(1א) שקובע 08:00-**19:00** לביקור בבית הצרכן.
> +- 🔴 **תקרת ניסיונות אמיתית:** ‏≤3 לפנייה נכנסת, ≤2 לשיחת שירות יזומה, במרווחים. ה-CHECK הקיים `attempt_count <= 20` הוא תקרת שפיות ל-DB, לא מדיניות.
> +- 🔴 **ליבת ס' 11 מדוברת בפתיח** — חובה חקוקה, לא המלצה: מטרה · בעל השליטה במאגר ודרכי התקשרות · שהמסירה וולונטרית ומה תוצאת אי-ההסכמה · **למי נמסר המידע** (Voximplant, ElevenLabs, ה-LLM) · זכויות עיון ותיקון · הפניה ל-`/privacy`. בצד זה: גילוי שזה עוזר קולי אוטומטי, והודעת הקלטה.
> +- 🔴 **שרשרת ראיות בשני טפסי הפנייה** — הנטל על העוסק, פעמיים במפורש בתוספת. חותמת זמן, IP, User-Agent, **הנוסח המדויק שהוצג**, גרסת טופס. הדפוס כבר מוכח ב-`signed_agreements`.
> +- 🔴 **חוסם עלייה לאוויר:** `/privacy` §9 אומר היום שהפנייה נעשית עבור בעל האירוע "ללא תוכן פרסומי של KALFA". ברגע שפרסונה 2 או 3 מחייגת המצג הופך שקרי. לעדכן **לפני** החיוג הראשון, יחד עם מטרת המאגר (ס' 8(ב)).
> +- 🔴 **מאגר "אל תתקשרו אליי":** החובה בס' 16ג(ג) בתוקף; המאגר עצמו **אינו פעיל** (כל-זכות, עודכן 15.4.2026) — אך gov.il חסום מהשרת ואי-אפשר לשלול הפעלה מחדש ⇒ **בדיקה אנושית מדפדפן לפני חיוג ראשון**, ונקודת אינטגרציה נבנית עכשיו כ-stub עם תוקף בדיקה 15 יום ושמירת ראיה (נמל מבטחים, תקנה 3(ו)).
> +- 🔴 **הסוכן מתנתק מלא בהעברה**, לא נשאר מאזין — ההיבט המסוכן ביותר. (העיצוב כבר סוגר את ה-WS בגישור, מאותה סיבה בדיוק ומטעמי עלות.)
> +- 🟢 **ממצא מקל:** בשלושת הסוכנים KALFA מדברת **בשם עצמה** ולא "מטעם זולתו" ⇒ היא "בעל שיחה", וההקלטה אינה האזנת סתר. הטיעון כאן חזק מהותית מאשר בערוץ האורחים.
> +
> +---
> +
> +## הארכיטקטורה
> +
> +**שלוש פרסונות** (מפתח DB · שם · בסיס חוקי):
> +| `customer_care` | **שני** | שירות יזום ללקוח עם אירוע פעיל — סטטוס, תקיעות, תשלום, onboarding | `service_existing_customer`, מוגבל לעסקה הפעילה |
> +| `inbound_followup` | **עדי** | חזרה לפניות, תלונות, שימור | `inbound_callback` |
> +| `lead_sales` | **רוי** | מכירות למי שביקש שיחת מכירה או נתן הסכמה שיווקית | `inbound_sales_callback` \| `explicit_marketing_consent` |
> +
> +גבול משותף: **אינם מתמחרים, אינם מבטיחים, אינם ממציאים.** מחיר/הנחה/התחייבות ⇒ `transfer_to_owner`. שאלה ללא תשובה במשתנים ⇒ `crm_alert_owner`. תוכן שיווקי אסור בשלושתן כל עוד אין `explicit_marketing_consent`.
> +
> +**תרחיש אחד** — `CRMAgent.voxengine.js`, מועתק מ-`RSVPAgent` (רשימת בלוקים מדויקת לפי טווחי שורות בתוכניות המשנה), עם ה-agent id מ-ctx. **לא לגרור:** `rsvp_method:'agent'` (מפעיל את נתיב החיוב של RSVP), מפת ה-DTMF של האורח, `NIQQUD_TEST_MAP`, וסמנטיקת הסטטוסים הסופיים של RSVP. שים לב: הסרת `rsvp_method` תגרום ל-`voxCallbackSchema.refine()` **לדחות** callback סופי של CRM ⇒ נדרש discriminator `call_kind`, לא החזרת השדה.
> +
> +**`transfer_to_owner`** — שתי רגליים ישירות, לא קונפרנס (‏`createConference()` בקוד הקיים נקרא ללא הארגומנט שהטיפוסים דורשים ומעולם לא רץ; לא בונים הסלמה על API לא-מאומת):
> +`idle → ringing → accepting → bridged`, הודעת המתנה ב-2.5ש', **watchdog צלצול 15ש'** (ברירת המחדל 60 — לקוח לא ימתין), **שער קבלה בהקשה על 1** עם whisper לבעלים בלבד ("שיחה מקלפה. ‹סיכום›. להקיש אחת") — זה מה שמונע מסירת לקוח לתא קולי ורישום `transferred` שקרי. בגישור: `stopMediaTo` בשני הכיוונים **קודם**, ואז `sendMediaBetween`, ואז סגירת ה-WS.
> +**שלוש מלכודות:** (א) `onWebSocketClose` מפעיל `scheduleHangup` ⇒ כל העברה מוצלחת הייתה מתנתקת אחרי 2 שניות — דגל `transferHoldsCall` חוסם בארבעה מקומות; (ב) `GLOBAL_TIMEOUT_MS=150s` היה חותך שיחה אנושית ⇒ מנוטרל ומוחלף ב-30 דק'; (ג) בלי סגירת WS, שיחת מכירה של 12 דקות מחייבת 12 דקות ElevenLabs **ומזרימה משא-ומתן פרטי לצד שלישי**.
> +**מספר הבעלים:** endpoint ייעודי `GET /api/voximplant/transfer-target/{token}`, נשלף **רק ברגע ההעברה** — לא customData (נרשם ל-call history ומודפס ללוג) ולא ctx (רץ בכל שיחה; היה הופך טוקן דלוף ליכולת דוקסינג). השליפה העצלה גם נותנת ל-`voice_transfer_enabled` תוקף **תוך כדי שיחה**. נשמר ב-`const` מקומי, לא ללוג, לא ל-state, לעולם לא ל-LLM; ב-DB רק `destination_fingerprint`.
> +**תשובה בשלושה מצבים**, תמיד `is_error:false`: `transferred` (שתוק) · `owner_unavailable` (התנצל, קבע חזרה) · `unavailable` (**אל תגיד "ניסיתי להשיג אותו"**).
> +
> +**חמישה כלים משותפים לשלוש הפרסונות** (‏`tool_ids` זהה — מה שגם הופך תלייה על "כלי לא מוכר" לבלתי-אפשרית): `transfer_to_owner` · `crm_book_callback` (עם מצב **`adjusted`**, כי המתזמן יזיז "מחר ב-20:00" ליום ראשון בבוקר והסוכן חייב לומר את המועד **החדש**) · `crm_alert_owner` · `crm_mark_dnc` (כותב ל-**אותה** `call_dnc_list`) · `crm_log_outcome`.
> +
> +**ספינת נתונים:** `crm_contacts` (מזוהה ב-`normalized_phone` E.164 UNIQUE — אותו מפתח קנוני של `call_dnc_list`) · `crm_consent_events` (append-only בטריגר) · `crm_call_queue` (עם `call_basis` ועם האילוץ שחוסם חיוג ללא מאשר אנושי) · `crm_call_attempts` (‏`queue_item_id UNIQUE` = שומר האידמפוטנטיות) · `owner_transfer_legs` · דגלי `app_settings` (**כולם בטוחים כברירת מחדל**) · `user_settings.{service,marketing}_call_consent_at` (DEFAULT NULL — שלוש העמודות הקיימות הן העדפות התראה שברירת המחדל שלהן `true` ומעולם לא הוצגו כרשות לחייג).
> +
> +**מנוע חיוג:** 3 תורים חדשים, `src/lib/data/crm-calls.ts` request-free, שרשרת שערים המשקפת את `dispatchOutreachCall` צעד-בצעד (רק בדיקת יתרה ניתנת ל-retry, כדי ש-retry לעולם לא יחייג פעמיים), ושער חלון-זמן שמ**תזמן מחדש** במקום להפיל.
> +
> +**פאנל אדמין** `/admin/voice/agents` — לא הרחבת `/admin/channels` (שם כבר תועד באג טפסים שדורסים מתג משותף). מתג ראשי · שלוש פרסונות · מספר להעברה · שעות (שבת וחגים **שורה נעולה** — קוד, לא צ'קבוקס) · תקרות · תור לאישור שורה-שורה · היסטוריה. `manage_voice` לקונפיג, `view_customer_data` לתור (יש שם שם וטלפון), `view_recordings` להקלטה, `recordStaffAccess` בפתיחת שורה. **מתג הכיבוי עובד בשלוש שכבות:** דגל ב-DB ⇒ ctx לא מחזיר `agent_id` ⇒ התרחיש לא מחייג, גם לשיחה שכבר בתור.
> +
> +**שלושה תפקידי צי** Tier-0 (`crm-inbound-lister` א'-ה' 13:00 · `crm-care-lister` ג' 13:30 · `crm-sales-lister` ד' 14:00, כולם `enabled:false`). פעולה יחידה: פועל CLI חדש `crm-queue` שמכניס שורה `proposed` בלבד; שמונה שומרים בתוכו, ובהם הרצה מחדש של **אותה** `hasCrmCallConsent` שהמנוע מריץ ⇒ תפקיד לא יכול להציע מי שאין בסיס לחייג אליו גם בטעות.
> +
> +---
> +
> +## סדר ביצוע
> +
> +| # | שלב | אימות | אישור |
> +|---|---|---|---|
> +| 0 | קימוט מה שכבר על הדיסק (`20260728021842`, `src/lib/callbacks/`, `types.ts`) | `vitest run src/lib/callbacks` | סקירה |
> +| 1-3 | שלוש מיגרציות: הסכמה · תור+שיחות+`owner_transfer_legs` · דגלים. `gen types --linked` אחרי כל אחת | `verify:db`, tsc | **כן — DB חי** |
> +| 4 | שכבת הסכמה + ingest, בלי חיוג | טסטי fail-closed, `worker:deps` | לא |
> +| 5 | צ'קבוקסי הסכמה ב-`/app/settings` + **לכידת ראיות בשני טפסי הפנייה** | טסטים, build | סקירת נוסח |
> +| 6 | פאנל אדמין (הדגלים כבויים ⇒ הדף אינרטי) + עדכון `admin-data-layer-coverage.test.ts` | טסט הכיסוי חייב לעבור | לא |
> +| 7 | 3 סוכני ElevenLabs + 5 כלים לפי ריצת ה-CLI המדויקת | drift · `tool_ids` · אסרציית כוונון עברית + נעילת overrides | לא |
> +| 8 | `CRMAgent.voxengine.js` + 5 ראוטים + `voxOwnerTransferSchema` | `node --check`, tsc, טסטי ראוט, `upload --dry-run` ל-kalfatest | לא |
> +| 9 | מנוע חיוג + sweeps — **חשוך** | טסט סדר-שערים | לא |
> +| 10 | פועל `crm-queue` + 3 תפקידי צי כבויים | הרצה ידנית | לא |
> +| 11 | **חוסמים משפטיים:** עדכון `/privacy` §9 + מטרת מאגר · בדיקה אנושית של סטטוס מאגר ה-DNC · אישור עו"ד לנוסחי הפתיח | — | **כן** |
> +| 12 | **מטריצת שיחות חיות R1-R9** (הבעלים, שני מכשירים) | ראה למטה | **כן — כסף אמיתי** |
> +| 13 | עלייה לאוויר, **פרסונה אחת** (`inbound_followup`), אישור שורה-שורה | תצפית חיה | **כן** |
> +
> +בין 0 ל-12 שום דבר אינו יכול לחייג. שלב 13 הוא קונפיג בלבד.
> +
> +**אימות:** בדיקת drift אמיתית = `pull --update` + `git diff --exit-code` (‏`agents status` **אינו** בודק drift). אסרציה שנועלת את כוונון העברית ואת מצב ה-overrides. 11 בדיקות agent-testing ללא טלפוניה — הקריטיות: הסוכן **שותק** אחרי `transferred`, ו**אינו אומר "ניסיתי להשיג אותו"** אחרי `unavailable`. שלושה דברים מוכחים ב-kalfatest בלי לחייג לאיש: עצירה כשאין `agent_id`, חסימה כשהמתג כבוי, ושרידות הרגל כשה-WS נסגר.
> +**מטריצה חיה:** R1 בסיס · **R2 הבעלים מקבל — מפריכה את מלכודת הניתוק** · R3 לא עונה · R4 עונה ולא מקיש · R5 דוחה · R6 הלקוח מנתק בצלצול · R7 הבעלים מנתק אחרי גישור · R8 כיבוי המתג תוך כדי שיחה · **R9 שיחה מועברת מעל 3 דקות — מפריכה את מלכודת החיוב ואת חיתוך ה-150 שניות**. אימות R1-R2 מהאודיו המוקלט דרך Scribe, לא מתמלול הסוכן שכבר הסתיר באג בעבר.
> +
> +---
> +
> +## הכרעות פתוחות
> +
> +1. **מספר טלפון שני** — היום יש אחד (`97237219347`) ואין caller ID לפי פרסונה; סימון כספאם פוגע במוצר ה-RSVP עצמו. לשקול מספר ייעודי ל-CRM.
> +2. **ניתוב נכנס** — למספר אין `rule_id`; לקוח שמחייג חזרה מגיע לשום מקום.
> +3. **קולות** — שלושה `voice_id` בעברית, לאודישן על `eleven_v3_conversational`.
> +4. **`daily_run_cap`** — העלאה מ-14 ל-18.
> +5. **סיווג העסקה** — "מתמשכת" או "חד-פעמית"? כל מסלול פרסונה 2 תלוי בכך (התוספת השישית פרט 2). שאלת יועמ"ש שנוטה דווקא ל"חד-פעמית".
> +6. **`contact_messages`** — האם טלפון שנמסר בטופס חופשי הוא "ביקש שיחזרו אליו". ברירת מחדל: לא.
> +7. **הקלטה אחרי ההעברה** — קולו של הבעלים והשיחה האנושית מוקלטים; הגילוי בפתיח עסק בסוכן AI.
> +
> +**8 שאלות ליועמ"ש** נוסחו בפורמט הקטלוג הקיים (‏26-33), ובהן: האם סוכן AI שיחתי הוא "מערכת חיוג אוטומטי"; האם ליבת ס' 11 מדוברת + קישור מקיימת את החובה; תוקף בקשת חזרה טלפונית; וסיווג אבטחתי של ההקלטות.
> +
> +## הודאה בכנות
> +
> +עם השקת המערכת, **`customer_care` ו-`lead_sales` יתחילו עם אפס אנשי קשר לחייג אליהם** — הצ'קבוקסים בשלב 5 טרם מולאו, וליד קר שלא ביקש שיחה אינו בר-חיוג משפטית. רק `inbound_followup` מקבל אוכלוסייה אמיתית מיד, ולכן היא הפרסונה הראשונה שעולה לאוויר. ייצור בסיס יש-מאין — backfill, "הסכמה משתמעת מהיותך לקוח", מחזור `event_updates` — הוא בדיוק הכשל שהעיצוב הזה קיים כדי למנוע. הפאנל יציג לכל פרסונה "כרגע N אנשי קשר עומדים בתנאי החיוג", וכש-N=0 יאמר זאת במפורש במקום להשאיר אותך לגלות שקט.
> +
> ```


### Edit (1 calls)

> **`/var/www/vhosts/kalfa.me/.claude/plans/harmonic-beaming-stonebraker.md`** (+12 -3 lines)
> ```diff
> -### 1. העברת שיחה לבעלים — לא קיימת, ואי-אפשר לקנות אותה מ-ElevenLabs
> -`transfer_to_number` ו-`transfer_to_agent` אינם מוגדרים בסוכן, והתיעוד הרשמי קובע ש-`conference`/`blind` נתמכים רק באינטגרציית **Twilio מקורית**; `sip_refer` דורש רגל SIP. הסטאק כאן הוא גשר WebSocket מול Voximplant → **ההעברה חייבת להיבנות בצד Voximplant ככלי-לקוח**.
> -מה שכן קיים: `VoxEngine.createConference()` + `callUser()` לרגל מפקח (שורות 589-683) — אבל `callUser` מחייג לזהות SDK בתוך האפליקציה, לא לנייד; הוא מופעל רק ע"י אופרטור אנושי; והוא **כבוי** (`app_settings.monitor_enabled` default false → הראוט מחזיר 503). כל הפרימיטיבים ל-PSTN (`callPSTN` לרגל שנייה, `sendMediaBetween`, `Modules.Conference`) קיימים ולא בשימוש.
> +### 1. העברת שיחה לבעלים — לא קיימת; שתי ארכיטקטורות אפשריות (מתוקן מול תיעוד חי)
> +בסוכן שלנו `transfer_to_number` ו-`transfer_to_agent` אינם מוגדרים כלל. התיעוד הרשמי: `conference`/`blind` נתמכים רק באינטגרציית **Twilio מקורית**; `sip_refer` — *"Available only when using SIP protocol during conversation"*.
> +
> +**תיקון לניסוח קודם:** ElevenLabs כן מציעה **SIP trunking כספק טלפוניה מדרגה ראשונה** (‏`CreateSIPTrunkPhoneNumberRequestV2` ב-`POST /v1/convai/phone-numbers`; עמוד `/docs/eleven-agents/phone-numbers/sip-trunking` — נכנסות ויוצאות, digest/ACL auth, TLS + RTP מוצפן). Voximplant יכולה לשמש כ-trunk. כלומר העברה מובנית **כן** נגישה — אך **לא בגשר ה-WebSocket הנוכחי**.
> +
> +המחיר של המסלול הזה, ולכן ההמלצה הצפויה בכל זאת לבנות בצד Voximplant:
> +- SIP REFER הוא **blind** — בהצלחה Voximplant **מתנתקת** מהשיחה (`CallEvents.TransferComplete`). כלומר "הבעלים לא ענה → חזרה ללקוח + התנצלות + קביעת חזרה" הופך לבלתי אפשרי. זו בדיוק הדרישה של הבעלים.
> +- מאבדים את מנגנוני התרחיש שאנחנו תלויים בהם: שער ה-AMD לפני הגישור (חיסכון עלות מלא בתא קולי), נפילת DTMF, `call.record()`, סדר הזרקת ה-ctx, וערוץ הפקודות החי `AppEvents.HttpRequest`.
> +
> +פרימיטיבים ב-Voximplant שאומתו בתיעוד וזמינים לבנייה: `VoxEngine.forwardCallToPSTN(number, headers?)`, `Call.transferTo()` (‏REFER, עם `TransferComplete`/`TransferFailed`), ומצב `handleBlindTransfer(bool)` שמאפשר *"control the third call leg within an existing session, allowing customization of the caller ID and passing custom headers"* — לצד `callPSTN` לרגל שנייה + `sendMediaBetween` + `Modules.Conference`.
> +
> +מה שקיים בקוד ואינו מספיק: רגל־מפקח (שורות 589-683) המחייגת ב-`callUser` — זהות SDK בתוך האפליקציה, לא נייד; מופעלת רק ע"י אופרטור אנושי; ו**כבויה** (`monitor_enabled` default false → 503).
> ```


### Task (6 calls)

- "Map voice-agent call stack" (type: `Explore`)
- "Map autonomous fleet + agent defs" (type: `Explore`)
- "Map customer/service/sales data surfaces" (type: `Explore`)
- "Design telephony + persona layer" (type: `Plan`)
- "Design data + dispatcher + fleet layer" (type: `Plan`)
- *...and 1 more*


### Ask (1 calls)

- ""


### MCP (2 calls)

- `ToolSearch(query=select:SendMessage, max_results=1)`
- `ToolSearch(query=select:ExitPlanMode, max_results=1)`


### MCP (1 calls)

- `SendMessage(to=aa14bbe21215d31c0, summary=Corrections from live docs on transfer options, message=CORRECTION to the brief I gave you — I verified against live ElevenLabs + Voximplant docs and thr..., type=message, recipient=aa14bbe21215d31c0, content=CORRECTION to the brief I gave you — I verified a…)` — "{"success":true,"message":"Message queued for delivery to aa14bbe21215d31c0 at its next tool round.""


### MCP (1 calls)

- `ExitPlanMode(plan=# צוות סוכנים קוליים: 2 שירות + 1 מכירות, עם העברה חיה לבעלים

## Context

הבעלים ביקש להקצות צוו..., planFilePath=/var/www/vhosts/kalfa.me/.claude/plans/harmonic-beaming-stonebraker.md)` — "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file"


### MCP (1 calls)

- `SendUserFile(files=["/var/www/vhosts/kalfa.me/.claude/plans/harmonic-beaming-stonebraker.md"], status=normal, display=attach, caption=קובץ התוכנית המלא — 3 סוכנים קוליים (2 שירות + 1 מכירות) עם העברה חיה לבעלים, תפקידי צי, וחוות הד...)` — "1 file delivered to user.
  /var/www/vhosts/kalfa.me/.claude/plans/harmonic-beaming-stonebraker.md →"



## Files Modified

- `~/.claude/plans/harmonic-beaming-stonebraker.md`


## Session Origin

This session was extracted from **Claude Code** session data.
- **Session file**: `~/.claude/projects/-var-www-vhosts-kalfa-me-beta/8cc1946f-2f09-4f83-af1d-c2a39afae7f9.jsonl`
- **Session ID**: `8cc1946f-2f09-4f83-af1d-c2a39afae7f9`
- **Project directory**: `~/beta`

> To access the raw session data, inspect the file path above.

---

**You are continuing this session. Pick up exactly where it left off — review the conversation above, check pending tasks, and keep going.**