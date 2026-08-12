# תוכנית שילוב ruflo/claude-flow V3 ↔ kalfa-fleet

**תאריך:** 12.8.2026 · **מקור:** איחוד שלושה דוחות ארכיטקטורה בלתי-תלויים (integration / security / activation), כולם read-only
**סטטוס:** ממתין להחלטות בעלים (סעיף ז)

---

## א. תקציר מנהלים

1. **ממצא דחוף שאינו תלוי בהחלטה על ruflo:** התקנת ruflo פתחה פער הרשאות חי ל-Tier-1 ו-Tier-2 של ה-fleet (סעיף ב). התיקון זול, ממוקד, ואינו נוגע ב-ruflo עצמו. שלושת הסוכנים מצאו אותו בנפרד.
2. **פסק-דין שילוב:** אף בעיה מתועדת של ה-fleet אינה נפתרת ע"י יכולות ruflo (swarm/consensus/hooks/learning). ארבע הבעיות האמיתיות ב-`known-issues.json` נפתרות בשינויים קטנים לקוד הקיים (סעיף ג).
3. **מסלול הפעלה מומלץ ל-ruflo:** רישום שרת MCP יחיד, מוצמד-גרסה, ב-scope מקומי, לשימוש אינטראקטיבי בלבד (כלי memory) — בלי daemon, בלי swarm, בלי חיבור ל-fleet עד שהערך מוכח (סעיפים ד-ה).

---

## ב. ממצא דחוף — ירושת הרשאות ruflo אל תוך ה-fleet

### מנגנון (מאומת מקריאת הקבצים החיים)

`run-role.sh` מריץ כל role עם `claude -p --setting-sources project --settings tierN.settings.json` — כלומר `.claude/settings.json` הפרויקטי נטען לכל הרצת fleet. ההתקנה הוסיפה לו:

```json
"allow": ["Bash(npx @claude-flow*)", "Bash(npx claude-flow*)", "Bash(node .claude/*)", "mcp__claude-flow__*"]
```

allow מתאחד בין מקורות; רק deny גובר. מצב בפועל:

| Tier | הגנה קיימת | תוצאה |
|---|---|---|
| Tier-0 | `deny: Bash(npx:*)` גורף | **חסום** ✅ |
| Tier-1 (qa-runner) | אין deny על npx; guard.sh לא סורק npx | **פתוח** 🔴 |
| Tier-2 (main — היחיד עם `supabase db query --linked` כ-postgres) | אין אזכור npx כלל; guard-tier2.sh לא סורק npx | **פתוח** 🔴 |

בנוסף: ה-guards רשומים עם `matcher: "Bash"` בלבד — **קריאות MCP לא עוברות דרכם בכלל**, ולכן `mcp__claude-flow__*` שכבר מאושר מראש יהפוך לפתוח-לכל-tier ברגע שיירשם אי-פעם שרת בשם `claude-flow`. וגם: `node .claude/*` מאפשר הרצת כל אחד מ-43 סקריפטי helpers של ruflo, שחלקם נופלים ל-`npx ...@latest` לא-מוצמד עם `env: process.env` מלא.

**מקל:** אף role prompt לא מזכיר ruflo — הפער לא מנוצל. ההגנות על סודות (`.env*`, `.token.env`, `.secrets/**`) שלמות בכל שלושת ה-tiers.

### תיקון מוצע (בעלים בלבד — `.claude/fleet/**` הוא owner-only)

**ב-1. תוספת ל-`permissions.deny` ב-`tier1.settings.json` וב-`tier2.settings.json`** (וב-tier0 רק את שורת ה-MCP):

```json
"Bash(npx claude-flow*)", "Bash(npx @claude-flow*)", "Bash(npx ruflo*)",
"Bash(node .claude/*)", "mcp__claude-flow__*", "mcp__ruflo__*"
```

מכוון ולא `npx:*` גורף — כי tier1 מרשה בכוונה `npx tsc/vitest/eslint` (qa-runner), וחסימה גורפת תשבור אותו.

**ב-2. שורת חסימה ב-`guard.sh` + `guard-tier2.sh`** (שכבה שנייה, בסגנון שורת ה-curl/wget הקיימת): תבנית שתופסת `npx [-y ]?(ruflo|claude-flow|@claude-flow)` וכן `node +\.claude/`. לא לחסום npx גנרי מאותה סיבה.

**ב-3. רגרסיה אחרי השינוי:** לוודא שאף אחד מ-18 ה-denials המתועדים כ-false-positive-history בקבצי ה-guard לא חוזר, ושe-qa-runner עדיין מריץ `npx tsc --noEmit`/vitest.

**ב-4. אימות אמפירי (לפני+אחרי):** הרצת `smoke-test-t2` עם פקודה תמימה שתואמת רק ל-allow החדש, ובדיקה בלוג אם עברה את שער ההרשאות. לפני התיקון צפוי לעבור (מאשר את הפער); אחרי — להיחסם.

**ב-5. בונוס-בירור:** ה-init רץ 11.8 13:59; אזהרת ה-workspace-trust החלה 15:30 באותו יום. אחרי התיקון לבדוק אם האזהרה נעלמת — חשוד סביר לתקלה הפתוחה מ-11.8.

---

## ג. פסק-דין שילוב — מיפוי יכולות מול בעיות אמיתיות

נבדק מול `04-operational-status.md` + `known-issues.json` (הבעיות שקיימות בפועל, לא תיאורטיות):

| בעיה מתועדת | יכולת ruflo "רלוונטית" | פתרון אמיתי |
|---|---|---|
| תפיסת J5 bac77347 פתוחה — main לא מתעורר (handoff פג, `schedule:[]`) | task lifecycle / consensus | slot מתוזמן או `fleet_goals` row — מנגנון קיים |
| digest מדווח `posted:true` גם כש-Slack נכשל | — | בדיקת ערך החזרה של `sendSlackAlert()` ב-`fleet-agent-cli.ts` |
| event-health-watcher כותב לנתיב חסר `beta/` | — | תיקון מחרוזת-נתיב ב-role prompt |
| chief-of-staff מפספס תבנית חוזרת (חלון 24h) | self-learning memory | הרחבת lookback ל-48-72h ב-`index.ndjson` |
| כשל 401 חוצה-roles (`.token.env`) | hooks/workers | רוטציית credential — תפעולי, ops-monitor כבר מזהה |

**מסקנה:** אף בעיה אינה בעיית תיאום-סוכנים או חיפוש סמנטי. היכולת היחידה עם התאמה חלשה — זיכרון סמנטי — כבר מכוסה ע"י `known-issues.json` (מבוקר, git-tracked) + `grep` על `index.ndjson`. החלפת קטלוג ידני-מבוקר בזיכרון שמתעדכן-לבד (confidence decay, transfer-between-agents) היא רגרסיה בבטיחות מול העיקרון "כל דבר פריווילגי עובר דרך verb שמור".

**לכן: שלב 1 האמיתי לשיפור ה-fleet הוא תיקון ארבע הבעיות הללו בקוד הקיים** — כולן כבר `detect-only` ב-known-issues, חסר רק אישור בעלים.

---

## ד. מסלול הפעלת ruflo (אם רוצים אותו פעיל) — מדורג

### שלב 0 — בריאות בלי side effects
- [בוצע] אין daemon, אין MCP רשום, `.claude-flow/` ריק, pm2 = 6 תהליכים מוכרים.
- הקוד חי רק במטמון npx (‏1.6GB, `~/.npm/_npx/2ed56890c96f58f7`, ruflo 3.36.0; ליבת memory ב-**alpha**). ⚠️ מטמון npx כבר נמחק בעבר בניקוי דיסק (תקרית puppeteer) — תלות שבירה.
- בדיקת גרסה (בעלים): `! /var/www/vhosts/kalfa.me/.npm/_npx/2ed56890c96f58f7/node_modules/.bin/ruflo --version` → צפוי `3.36.0`. לא להריץ `doctor --fix` ולא `memory init --force`.

### שלב 1 — רישום MCP יחיד, interactive-only
```
! claude mcp add ruflo -- npx -y ruflo@3.36.0 mcp start
```
שלוש בחירות מכוונות: **גרסה מוצמדת** (לא `@latest`); **השם `ruflo`** — כך ה-allow השיורי `mcp__claude-flow__*` לא תופס אותו, וכלי `mcp__ruflo__*` נחסמים אוטומטית ב-fleet (אף tier לא מרשה אותם, ואחרי ב-1 גם denied במפורש); **scope local** (ברירת מחדל → `~/.claude.json`) — `.mcp.json` בגיט לא משתנה וה-fleet לא יורש.

שימוש: כלי `memory_store`/`memory_search`/`memory_list` בלבד. לא `swarm_*`, לא `hive-mind_*`, לא `agent_spawn`, לא `task_*` (כפול ל-TaskCreate), לא `neural_*`.

**Verification:** ‏`! claude mcp list` → ruflo ✓ connected; ‏`git diff .mcp.json` → ריק; roundtrip store→search בסשן חדש; `ls .claude-flow/data` → נוצרו קובצי DB.
**Rollback:** ‏`! claude mcp remove ruflo`.

### שלב 2 — daemon: **לא מריצים**
שרת פרודקשן חי, ליבה אלפא, workers שכותבים ביחס ל-repo. אם שלב 1 יוכיח שהזיכרון דורש daemon: הרצה מפוקחת ידנית, ואז pm2 בשם `ruflo-daemon` עם worker מינימלי (`consolidate` בלבד). Rollback: `pm2 delete ruflo-daemon && pm2 save`.

### שלב 3 — חיבור ל-fleet: רק אחרי ערך מוכח, ורק בקריאה
- תנאי מקדים מוחלט: סעיף ב סגור ומאומת.
- אם ה-memory הוכיח ערך: **verb קריאה חדש** ב-`scripts/fleet-agent-cli.ts` (למשל `ruflo-recall --query`) שקורא את ה-DB המקומי ישירות — בלי npx, בלי רשת, בלי הרשאות חדשות, עקבי עם מודל ה-verbs. עריכת ה-CLI = קוד רגיל; עריכת tiers = בעלים בלבד.
- אם role כלשהו יזין את הזיכרון: סניטציית PII (שם/טלפון/תוכן פנייה) לפני אינדוקס; `agentScopes.defaultScope: project` נשאר; transfer-between-agents מבוטל.

---

## ה. קווים אדומים (מכל שלושת הדוחות)

1. אף fleet role לא מקבל `npx` לא-מוצמד/רשת — בשום tier.
2. אף שרת MCP לא נגיש לסשן fleet בלי guard תואם — ה-guards הקיימים עיוורים ל-MCP.
3. אין daemon/`mcp start` קבוע על שרת הפרודקשן בלי אישור בעלים ספציפי.
4. אף סוד לא נמצא ב-env של תהליך עם נתיב ל-`npx ...@latest`.
5. אין swarm/hive-mind במקביל ל-scheduler — לא שני מנועי orchestration על אותו repo ו-DB חי.
6. אין PII של אורחים בזיכרון וקטורי חוצה-סשנים בלי סניטציה.
7. שינויי `.claude/fleet/**` — בעלים בלבד, כולל בפני ruflo upgrade עתידי שעלול לדרוס.
8. מספרי השיווק של ruflo (150x-12,500x) אינם ראיה — רק מדידות מקומיות.

---

## ו. היגיינת גיט (לא דחוף, לפני הקומיט הבא)

`.swarm/`, `ruvector.db`, ו-6+24 תיקיות agents/skills — untracked ולא ב-gitignore; `git add -A` יסחוף אותם. להחליט: gitignore מלא / קומיט מכוון של קונפיגורציית ruflo. כמו-כן `.claude/settings.json` + `.gitignore` העוקבים נושאים את שינויי ההתקנה — לקמט בנפרד משינויי הקוד.

## ז. החלטות נדרשות מהבעלים

| # | החלטה | המלצה | דחיפות |
|---|---|---|---|
| 1 | תיקון פער ה-tiers (ב-1+ב-2, קבצים owner-only) | לבצע | 🔴 מיידי |
| 2 | אימות אמפירי לפני/אחרי (ב-4) + בדיקת trust (ב-5) | לבצע | 🔴 עם #1 |
| 3 | תיקון 4 בעיות ה-fleet מסעיף ג | לבצע (ללא קשר ל-ruflo) | 🟠 |
| 4 | רישום MCP של ruflo לשימוש אינטראקטיבי (שלב 1) | אופציונלי — לפי רצונך | 🟢 |
| 5 | daemon / swarm / חיבור fleet | לא כרגע | — |
| 6 | היגיינת גיט (סעיף ו) | לבצע לפני קומיט הבא | 🟢 |
