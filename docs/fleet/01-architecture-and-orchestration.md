# KALFA Fleet — ארכיטקטורת התזמור וההרשאות (Architecture & Orchestration)

> מסמך זה נכתב מתוך קריאת קוד בפועל (repo: `/var/www/vhosts/kalfa.me/beta`), נכון ל-2026-08-09.
> כל מזהה טכני (נתיבים, טבלאות, פקודות CLI, קוד) נשמר באנגלית.

## 1. מה זה

"kalfa-fleet" הוא צי בית-גידול (home-grown) של סוכני Claude Code אוטונומיים — **roles** — שרצים על גבי pm2 בזמנון (schedule) או באופן תגובתי (reactive), נפרד לחלוטין מה-subagents האינטראקטיביים המובנים של Claude Code שיושבים תחת `.claude/agents/`.

מסמך זה מכסה **אך ורק** את מנוע התזמור: איך הצי מחליט **מתי** role רץ ו**באילו הרשאות** — לולאת הזמנון (`bin/scheduler.mjs`), שרשרת ההפעלה הבטוחה (`bin/run-role.sh`), סולם ההרשאות בן שלוש הדרגות (Tier 0 / Tier 1 / Tier 2), ה-guard hooks שאוכפים אותו, ומנגנון ה-inbox/handoff שמנתב עבודה אל ה-role היחיד בעל גישה לנתוני ייצור חיים (`main`, Tier 2). קטלוג ה-roles עצמם (16 הגדרות prompt) מתועד ב-`02-roles-catalog.md`; משטח ה-CLI (`fleet-agent-cli.ts`) ומחזור-חיי הבקשה מתועדים ב-`03-cli-and-request-lifecycle.md`; ראיות ריצה חיות (uptime, מדדים, בריאות תפעולית) מתועדות ב-`04-operational-status.md`; סקירה כללית מרוכזת נמצאת ב-`00-index.md`. מסמכים אלה מוזכרים כאן רק בשמם לצורך cross-linking.

החומר במסמך זה מבוסס על דו"ח מחקר מאומת שקרא במלואם את `scheduler.mjs`, `run-role.sh`, `run-context.sh`, `main-inbox.sh`, שלושת קובצי ה-tier settings, שני ה-guard hooks ו-`TODO.md`, והצליב כמה טענות ישירות מול מצב הריפו החי (כולל `git worktree list` ו-`git ls-files`) בתאריך כתיבת המסמך.

## 2. הזמנון (`bin/scheduler.mjs`)

תהליך Node שרץ תחת pm2, **בלי תלויות npm בכוונה** (הערה ב-`scheduler.mjs:15` — "must never break with repo installs"). זהו תחליף ה-cron של הצי, כי crontab חסום למשתמש-OS הזה ע"י הקשחת Plesk (`scheduler.mjs:2-4`).

### מבנה הלולאה

`fullTick()` (`scheduler.mjs:461-472`) רץ מיידית עם עליית התהליך, ואז כל 60 שניות דרך `setInterval`. בכל tick:

1. `tick()` — המסלול המתוזמן (scheduled).
2. קריאה מחדש של `fleet.json` מהדיסק (`readConfig()`, `scheduler.mjs:48-50`) — **בלי caching**, כך ששינוי בקונפיג נכנס לתוקף תוך tick אחד, בלי restart לתהליך.
3. `answerWatcherTick(config)` ו-`inquiryWatcherTick(config)` — שני המסלולים התגובתיים — **רק אם** `!existsSync(KILLSWITCH) && !config.dry_run` (`scheduler.mjs:469`).

### המסלול המתוזמן — `tick()` (`scheduler.mjs:104-159`)

- בדיקת KILLSWITCH ראשונה (`:113-118`) — אם הקובץ קיים, ה-tick חוזר מיידית, עוד לפני לולאת ה-slots המתוזמנים.
- שעון קיר מחושב דרך `Intl.DateTimeFormat` נעוץ ל-`config.timezone` (ברירת מחדל `Asia/Jerusalem`), ומפיק `{day 0-6, hhmm, dateKey}` (`:52-70`). יום 0 = ראשון, תואם לשבוע הישראלי; `dayMatches` תומך ב-`"*"`, טווחים (`"0-4"`), רשימות (`"0,2,4"`) ויום בודד.
- לכל role מופעל, לכל slot ב-`schedule`: התאמת דקה מדויקת (`slot.time === now.hhmm`) בתוספת התאמת יום. **אין catch-up** לדקה שהוחמצה — אם התהליך היה למטה בדיוק ב-HH:MM, ה-slot פשוט מדולג לאותו יום (אין חלון סבלנות/drift במסלול הזה).
- סמן dedup פר-slot: `slot-<role>-<dateKey>-<hhmm>` (`:129`) — מבטיח לכל היותר spawn אחד ל-role ל-slot לוח-שנה, גם על פני restart של הזמנון (הסמן הוא קובץ בדיסק, לא state בזיכרון).
- `daily_run_cap` (ברירת מחדל 14) נאכף דרך מונה **משותף** בקובץ `count-<dateKey>` (`:93-102, 132-138`) לפני spawn; אם התקרה הושגה, סמן ה-slot עדיין נכתב (כ-`'capped'`) כדי שלא ינוסה שוב באותו tick/יום.
- `dry_run: true` מקצר-מעגל **אחרי** הנהלת-החשבונות של הסמן/התקרה אך **לפני** ה-`spawn()` בפועל (`:143-147`) — רושם ללוג "DRY-RUN: would spawn" וכותב שורת index, בלי להריץ תהליך בפועל.
- spawn בפועל: `spawn(run-role.sh, [role], {detached:true, stdio:[ignore, logfile, logfile]})`, ‏`child.unref()` (`:150-156`) — fire-and-forget; הזמנון לעולם לא ממתין לילד או עוקב אחריו מעבר לכך.

### המסלול התגובתי — inquiry-watcher (`inquiryWatcherTick`, `scheduler.mjs:393-459`)

עבור roles שמציינים טריגר `reactive` (מחרוזת בודדת או מערך), הפונקציה בודקת קטלוג שאילתות SQL מספר-שורות קבוע מראש (`TRIGGERS`, `:194-238`): `contact_messages_new`, `callback_requests_pending`, `webhook_inbox_errors`, `owner_direct_request`, `goal_due`. cooldown פר-role (`REACTIVE_COOLDOWN_MS = 4min`, `:254, 410-414`) מונע בדיקה חוזרת של role שזה עתה ירה. הטריגרים נבדקים לפי סדר במערך; הראשון עם עבודה ממתינה (`n > 0`) מבצע spawn ועוצר (לכל היותר spawn אחד ל-role ל-tick). מסלול זה חולק את **אותו** מונה `daily_run_cap` עם המסלול המתוזמן (`:397, 401`). שני הטריגרים הפר-role (`owner_direct_request`, `goal_due`) משלבים `{{role}}` לתוך מחרוזת ה-SQL דרך substitution מאומת (`ROLE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/`, `:244-252`) — שמות ה-roles מגיעים מ-`fleet.json` (בשליטת הבעלים) אך עדיין עוברים ולידציה לפני string-interpolation לתוך SQL, כדי שטעות הקלדה בקונפיג לא תהפוך לפיסת הזרקת-SQL.

### המסלול התגובתי — answer-watcher (`answerWatcherTick`, `scheduler.mjs:267-348`)

מריץ בכל tick את פקודת ה-`verdicts` של ה-fleet CLI (כל הבקשות שנענו-ולא-נצרכו, על פני כל ה-roles, **ללא תלות** בקונפיג `reactive` של role כלשהו). עבור כל verdict:

- אם ל-role יש `auto_ack: true` → `ack` מיידי דרך ה-CLI, ללא spawn (`:293-306`).
- אחרת → spawn להרצה המלאה של ה-role כדי שיוכל לפעול על ה-verdict, נאכף כנגד מונה **נפרד**: `answer-<dateKey>` (‏`answer_daily_run_cap`, ברירת מחדל 50), עם סמן קבוע `verdict-<id>` שנכתב **לפני** ה-spawn (spawn אחד לכל verdict, לתמיד — `:310-346`).

**למה שני caps נפרדים** (מתועד ב-`:82-92, 313-324`, עם תקרית מתוארכת): שיתוף מונה אחד בין "פתיחת N בקשות" ל-"צריכת N תשובות לאותן בקשות" גובה כפול על יחידת פעילות אחת, ועלול להרעיב תשובה שהבעלים עצמו כבר נתן — נמדד ב-2026-07-30: התראת disk-94% ישבה לא-נצרכת במשך שעות כי spawns שגרתיים מיצו את התקרה המשותפת קודם.

### התנהגות `dry_run` — שתי המוזרויות המתועדות

1. **הנהלת-החשבונות מתבצעת לפני שבדיקת ה-dry_run בכלל נבדקת** — ב-`tick()` (`:140-147`), סמן ה-slot נכתב ומונה התקרה היומית המשותף מוגדל **לפני** הענף `if (config.dry_run)`. יום שלם ב-dry-run עדיין מסמן לצמיתות כל slot תואם כ-`'spawned'` לאותו יום קלנדרי, וצורך תקציב-תקרה אמיתי — כך שכיבוי `dry_run` מאוחר יותר באותו יום ימצא slots שכבר "נוצלו" ותקרה שכבר נצרכה חלקית, למרות שדבר לא רץ בפועל.
2. **אסימטריה בין המסלול המתוזמן לתגובתי** — `fullTick()` (`:461-472`) מדלג לגמרי על `answerWatcherTick`/`inquiryWatcherTick` תחת `dry_run`, בלי שום לוג "would spawn" לאף אחד מהם — רק המסלול המתוזמן רושם את כוונת ה-dry-run שלו (`:144`). מפעיל שבודק `dry_run:true` יראה בלוג את כוונות ה-roles המתוזמנים, אך יקבל שקט מוחלט לגבי מה הטריגרים התגובתיים או ה-verdicts הממתינים היו עושים.

### עמידות-בפני-כשל

‏`fleet.json` לא-קריא/פגום גורם ל-`tick()` לרשום ללוג ולחזור בלי לקרוס (`:106-111`); כשל הקריאה-מחדש של `fullTick()` עצמו נבלע באותו אופן (`:463-468`).

## 3. `run-role.sh`

מוזמן כ-`run-role.sh <role>` ע"י הזמנון (שלוש נקודות קריאה) או ידנית. הסדר הבטוח המתועד (`run-role.sh:5-16`): **ארגומנט role → KILLSWITCH → role מופעל → flock גלובלי → timeout קשיח**, כאשר תנאי-קדם מבניים (קיום `REPO_DIR`/`HOME`) מוקדמים ל-KILLSWITCH רק כי הם נחוצים כדי *לתעד* דילוג-בגלל-killswitch.

הרצף:

1. `set -euo pipefail` (`:22`), אך קריאת ה-`claude` פטורה בכוונה דרך `|| STATUS=$?` (`:136-146`) כך שגם הרצת role שנכשלה מגיעה לשורת ה-index שלה. יש תקרית מתועדת (`:27-31`) שבה באג-סדר לא-מוגן תחת `set -e` הרג subshell בשקט וקלקל את `HOME`/`PATH`, ותקרית נוספת (`:60-61`) שבה `set -e` הפך דילוג "disabled" שהיה מתועד בעבר למוות שקט ב-exit-5 — שתיהן תוקנו ע"י הוספת שערי תקינות-JSON מפורשים לפני כל קריאת `jq`.
2. `HOME`/`PATH` ננעצים במפורש (לא נורשים מהסביבה) כדי שההתנהגות תהיה זהה בין אם הזמנון עלה נקי, restart-ed, או שהסקריפט מוזמן ידנית (`:24-36`).
3. בדיקת KILLSWITCH (`:77-80`) — כותבת שורת index ויוצאת עם 0.
4. בדיקות קיום-קובץ-קונפיג ו-`claude`-נגיש (`:83-85`) — יציאה 70/127, ללא שורת index (לפני ה-mkdir).
5. **שער תקינות-JSON** על `fleet.json` (`:95-99`) — JSON פגום מקבל שורת index שגיאה משלו ויציאה 78, במקום להפיל כל קריאת `jq` שאחריה.
6. **בדיקת enabled** (`:101-105`): `jq -r '.roles[$r].enabled // false'` — כל דבר שאינו המחרוזת `"true"` המילולית → שורת index `skipped:disabled`, יציאה 0. זה רץ **לפני** בדיקת קיום קובץ ה-prompt (`:113-116`), כך ש-role עם `enabled:false` וקובץ `roles/<role>.md` חסר לעולם לא מגיע לשגיאת prompt-חסר.
7. tier/model/timeout נקראים מ-`fleet.json` (`:107-109`); קובץ ההרשאות נפתר כ-`settings/tier<N>.settings.json`.
8. קובץ role-prompt חסר → שורת index שגיאה, יציאה 1 (`:113-116`).
9. ‏`.token.env` נטען אם קיים (`:120-124`) — טוקן OAuth ארוך-חיים לאימות headless, מיוצא כ-`CLAUDE_CODE_OAUTH_TOKEN`.
10. **flock גלובלי** על `.fleet-logs/locks/global.lock`, לא-חוסם (`flock -n 9`) (`:126-130`) — מסדרן **את כל** עבודת הצי, לא פר-role, במפורש כדי להבטיח ש-`next build` לעולם לא ירוץ במקביל (`:7-8`, מהדהד את לקח "Concurrent build collision" מזיכרון הפרויקט). תפיסת מנעול תפוסה → `skipped:lock`, יציאה 0.
11. ה-prompt מורכב מתוכן קובץ ה-role-prompt **בתוספת** פלט `run-context.sh <role>`, משורשרים (`:132`).
12. הפעלה: `timeout --kill-after=60 "${TIMEOUT_MIN}m" claude -p "$PROMPT" --permission-mode dontAsk --setting-sources project --settings "$SETTINGS" --model "$MODEL" --output-format json` (`:139-146`), ‏stdout/stderr נלכדים ל-`$TRACE.json`/`$TRACE.err`.
13. שורת ה-index הסופית מתעדת exit status, ‏session_id, ‏cost_usd — נבנית דרך `jq` בבנייה בטוחה-למחרוזת ולא ב-interpolation (‏`index_line()`, `:63-75`), כי רשומה פגומה בשורה אחת שברה בעבר את ה-parser הזורם עבור 41 רשומות עוקבות (תקרית מתועדת, `:58-61`).

**`--setting-sources project`** מוציא מכל הרצת-צי את `settings.local.json` האינטראקטיבי של הבעלים ואת ההגדרות ברמת-משתמש (`tier0.settings.json:2`) — אך **לא** מוציא את `.claude/settings.json` הפרויקטי המחובר ל-git. קובץ זה רושם hook מסוג `SessionStart` שמצביע ל-`main-inbox.sh` — ראו סעיף 6 להסבר למה זה כנראה יורה על **כל** הרצת role headless בצי, לא רק על סשן `main` האינטראקטיבי.

**הערת `smoke-test-t2` — אושרה כמדויקת.** הרשומה `smoke-test-t2` ב-`fleet.json` טוענת ש-`enabled:true` לא גורם ל-self-spawn, כי `schedule` ו-`reactive` שניהם ריקים. אומת מול הקוד: `tick()` ב-`scheduler.mjs` מבצע spawn רק לרשומות ב-`rc.schedule` (ריק כאן → אין spawn מתוזמן), ו-`reactiveRoles()`/`inquiryWatcherTick()` מבצעים spawn רק ל-roles עם שדה `reactive` לא-ריק (ריק כאן → גם אין spawn תגובתי). `enabled:true` נדרש רק כדי ש-`bash run-role.sh smoke-test-t2` **ידני** לא יידחה ע"י בדיקת ה-enabled (`:101-105`). ההערה מדויקת לחלוטין, ומטרתה המוצהרת (בדיקה ידנית של שינויים ב-`guard-tier2.sh`/`tier2.settings.json`, כי "שום דבר אחר בצי לא בודק את ה-hook של Tier-2") מאוששת ע"י ה-prompt של `main` עצמו, שמציין הרצה אחת בלבד מאז 2026-07-27.

## 4. מודל ההרשאות: Tier 0 / Tier 1 / Tier 2

שלושת קובצי ה-tier חולקים מבנה: `defaultMode: "dontAsk"` (fail-closed — כל מה שלא הותר במפורש נחסם, אין TTY לשאול) בתוספת hook מסוג `PreToolUse` על matcher `Bash` בלבד. **דחייה תמיד גוברת על היתר**, וכללי נתיב-קובץ תואמים **רק** בצורת `Edit(path)`/`Read(path)` — כלל `Write(path)` או `Glob(path)` פשוט לא מתאים לעולם (מתועד, ומאומת מול תיעוד, בשדה `$comment` של שלושת הקבצים), כך שהיתר `Edit(path)` הוא זה שמעניק גם את הכלי `Write`. זו מלכודת אמיתית שכדאי להפנים: כל עריכת הרשאות עתידית שתכתוב `Write(...)` במקום `Edit(...)` תיכשל בשקט, בלי להעניק דבר.

### Tier 0 (`tier0.settings.json`) — ברירת המחדל, tier דיווח-בלבד

- **מתיר**: Read/Grep/Glob/Agent; `Edit` מוגבל אך ורק ל-`.fleet-logs/**`; git קריאה-בלבד (`status/log/diff/show`); בדיקת `pm2` קריאה-בלבד; `gh issue`/`gh pr` קריאה+comment (לא merge); את ה-fleet CLI עצמו; ומגוון רחב של כלי shell קריאה-בלבד (`df/free/uptime/date/ls/wc/rg/grep/cat/head/tail/sed/awk/find/du/ps/which`).
- **חוסם**: כל קריאה ל-`.env*`/`.token.env`/`vox_ci_credentials.json`/`.secrets/**`; `Edit` על `src/**`, ‏`supabase/**`, ‏`scripts/**`, ‏`worker/**`, ‏`.claude/**`, ‏`agent_configs/**`, ‏`package.json`; ‏`NotebookEdit`, ‏`WebFetch`, ‏`WebSearch`; כל שינוי git (`push/commit/add/checkout/switch/restore/reset/clean/worktree`); ‏`supabase:*`, ‏`psql:*`; ‏`npm install/uninstall`, ‏`npx:*`; ‏`pm2 restart/stop/start/delete/kill/save`; ‏`rm/mv/curl/wget/ssh/scp`; מפרשנים inline (`node -e`, ‏`bash -c`, ‏`python`); ‏`crontab`; ‏`env`/`printenv`.

### Tier 1 (`tier1.settings.json`) — qa-runner, dev-engineer

Tier-0 בתוספת שערי אימות (`npm run lint/test/build`, ‏`npx tsc/vitest/eslint`), כתיבות git על ענפי `fleet/*` (`add/commit/switch/restore/branch`, אך push מוגבל ל-`git push origin fleet/:*` בלבד), יצירת PR (`gh pr create`), ‏`pm2 restart kalfa-beta` (אותו תהליך יחיד בלבד) — ובאופן בולט, היתר עריכת-קוד: `Edit(//var/www/vhosts/kalfa.me/beta-fleet/**)`.

ה-`$comment` של tier1 (`tier1.settings.json:2`) מציין שה-worktree היעד **לא קיים** ("verified 2026-07-29 against `git worktree list`") ועדיין החלטת-בעלים פתוחה ב-`TODO.md` — כרגע הכלל לא תואם כלום, ונתיב הכתיבה היחיד ב-tier זה הוא `.fleet-logs`. **אומת שוב היום (2026-08-09)**: `git worktree list` מציג רק את ה-worktree הראשי בתוספת שני worktrees לא-קשורים (`p0-redactor-rc`, ‏`p0-redactor-rebased`) — אין `beta-fleet`. הטענה עדיין עומדת. אזהרת ההערה עצמה נשארת רלוונטית: `git worktree add` בנתיב הזה יפעיל בשקט גישת-כתיבה מלאה לעותק ריפו שלם, בלי שום שינוי בקובץ הרשאות — יצירת הספרייה הזו **היא** ההחלטה ההרשאתית, ושום דבר אחר במערכת ה-tier לא חוסם זאת (‏`git worktree:*` חסום עבור קריאות ה-Bash של tier1 עצמו, כך שהצי לא יכול ליצור זאת בעצמו — רק אדם, או פעולת Tier-2/בעלים, יכולים).

### Tier 2 (`tier2.settings.json`) — מיועד ל-`main` בלבד, אך משובץ גם ל-smoke-test-t2

ה-`$comment` של `tier2.settings.json` מתאר את הדרגה הזו כ"the 'main' executor role ONLY" — אך בפועל `fleet.json` משבץ אליה **שני** roles: `main` (`"tier": 2`) **וגם** `smoke-test-t2` (`"tier": 2`, ר' `02-roles-catalog.md`). מכיוון ש-`run-role.sh` בוחר את קובץ ה-settings לפי מספר ה-tier בלבד (`settings/tier<N>.settings.json`, ללא הבחנה לפי שם ה-role), שני ה-roles טוענים את **אותו** קובץ הרשאות בדיוק — כולל כלל ה-allow היחיד שמעל Tier 0: `Bash(supabase db query:*)`. ההבדל בין השניים הוא **התנהגותי בלבד**: ה-prompt של `smoke-test-t2` נמנע במכוון מלהריץ `supabase db query` (הוא בודק את הגדר, לא את הדלת — ר' `02-roles-catalog.md`), אך אין שום חסימה מכנית שמונעת ממנו לעשות זאת — הוא מחזיק טכנית באותו מפתח. זהו פער אמיתי בין הכוונה המתועדת בהערת קובץ ה-settings ("main בלבד") לבין הניתוב בפועל ב-`fleet.json`, שכדאי לתעד ולא רק לתקן בשקט.

צר יותר מ-Tier 1 בכוונה: **אין עריכת קוד כלל** (רק `.fleet-logs/**`), אין כתיבות git, אין deploy, אין שינויי pm2, אין `npm build/test`. הכוח היחיד שהוא מוסיף מעל Tier 0 הוא `Bash(supabase db query:*)` — גישת Postgres חיה לפרויקט המקושר, רצה כ-`postgres` (לפי `main.md:30-31` וזיכרון ה-RLS-audit). נחסם במפורש גם בתוך Tier 2: `supabase db push/reset/migration/link`. בפועל, `main` הוא ה-role היחיד שמנצל את הכוח הזה בזרימת עבודה רגילה; `smoke-test-t2` רץ ידנית-בלבד ולא באופן עצמאי (ר' סעיף 3).

## 5. ה-guard hooks: `guard.sh` ו-`guard-tier2.sh`

`guard-tier2.sh` רשום רק ב-`PreToolUse` hook של `tier2.settings.json` (matcher `Bash`). זהו fork כמעט-זהה של `guard.sh` (ה-hook של Tier 0/1), עם **carve-out יחיד**: `supabase db query` מותר; כל תת-פקודת `supabase` אחרת נחסמת (`guard-tier2.sh:37-40`), בעוד ש-`guard.sh` חוסם את ה-CLI‏ `supabase` לגמרי חוץ מ-`--version` (`guard.sh:39-43`). כל השאר — שמות סקריפטי SUMIT/billing, שמות סקריפטי הודעות-לקוח, הגנות היסטוריית-git (force-push, push-to-main, merge של PR, מחיקת branch), שינויי תשתית (מחזור-חיים של pm2, `nginx/systemctl/plesk/iptables/...`), מפרשנים inline, סריקת נתיבי-סודות, ותעבורת-רשת גולמית — זהה byte-for-byte בין שני ה-hooks.

**האם זה נראה פונקציונלי?** כן, עם הסתייגויות:

- שני ה-hooks פועלים על **מחרוזת פקודת ה-Bash המלאה** (`.tool_input.command`), ‏fail-closed על קלט שלא ניתן לפרש/ריק (`guard.sh:16-20`), ו-`block()` מחזיר exit 2 ש-ה-`$comment` של קובצי ההגדרות עצמם קובע נכון "cannot be overridden by an allow rule" (ה-hooks יורים לפני הערכת-הרשאות).
- ה-guards בודקים **רק** את הכלי `Bash`. קריאות `Read`/`Edit`/`Grep`/`Glob`/`Agent` נשלטות **אך ורק** ע"י רשימות ה-allow/deny ב-JSON, בלי גיבוי ברמת-hook — כך שה-hook אינו רשת-ביטחון אוניברסלית, אלא ספציפית ל-Bash בלבד. זה עקבי עם העיצוב (‏`settings.json` כבר חוסם Read/Edit מבוסס-נתיב לסודות ולקוד), אבל שווה דיוק: ה-hook הוא אחת משתי שכבות אכיפה, לא היחידה.
- לשני ה-hooks יש היסטוריית באג-ותיקון מתועדת ומתוארכת בהערות שלהם עצמם: חור בסריקת-סודות `.env` התקיים כי מחרוזת ההזמנה המותרת של ה-fleet CLI עצמו (`--env-file=.env.local dist/fleet-agent-cli.cjs`) מכילה בעצמה `.env`, כך שה-regex המקורי או (א) לא ירה מעולם (false negative על הקריאה המותרת, 18 דחיות שנמדדו לפני התיקון) או, אחרי תיקון צר, (ב) פספס globs כמו `.env*` (חור חי, נמדד ב-2026-07-29, תוקן ע"י הרחבת מחלקת-התווים באותו יום שהפך לניתן-לניצול). **`guard-tier2.sh` קיבל את אותה הרחבה יום אחד אחרי `guard.sh`** (‏`guard-tier2.sh:76-83` מתעד זאת כ"parity fix", 2026-07-30) — כלומר ה-hook בעל-ההרשאה-הגבוהה-יותר (Tier 2, עם גישת DB חיה) היה זמנית עם guard-סודות **חלש יותר** מ-Tier 0/1 בזמן ש-`guard.sh` כבר תוקן. זה מתוקן כעת ושניהם ב-parity, אבל זהו near-miss היסטורי אמיתי על ה-tier עם גישת DB חיה.
- **אסימטריה אחת נשארת כיום**: רשימות ה-deny של `tier0`/`tier1` כוללות `Bash(env:*)` ו-`Bash(printenv:*)`; רשימת ה-deny של `tier2` לא. בפועל זה סיכון-נמוך — `dontAsk` הוא fail-closed כך ש-`env`/`printenv` לא היו ברשימת ה-**allow** של tier2 גם ככה — וה-guard hook עדיין חוסם תעבורת-רשת גולמית ומפרשני inline שיכלו להדליף dump סביבה לא-חסום — אבל זה המקום היחיד ששלושת קובצי ה-tier לא מקבילים מבנית, ו-`run-role.sh` מבצע `export CLAUDE_CODE_OAUTH_TOKEN` לתוך כל תהליך-צי בכל tier, כולל Tier 2 — כך ש-`env` לא-חסום שם היה משמעותי יותר מאשר ב-Tier 0/1.

## 6. מנגנון ה-inbox/handoff

יש בפועל שני מסלולי-קוד שונים תחת המטריה "handoff", ששניהם מתכנסים ל-`role='main'` בטבלת `fleet_requests`.

### יצירת handoff (`src/lib/fleet/handoff.ts`)

קריאת CLI מסוג `handoff --to <target>` (מורצת ע"י role אחר, למשל `business-ops.md:54`) מאמתת שה-target הוא או role מופעל בצי, או הסנטינל `MAIN_HANDOFF_TARGET = 'main'` (`handoff.ts:19, 107-116`). ‏`buildHandoffRequest()` בונה את שורת ה-forward: אותם `kind`/`tier` כמו המקור, ‏`payload.handoff_from`/`handoff_from_role` לצורך provenance, ‏`handoff_note` אופציונלי, וצירופי המקור מועברים כך שטיוטות נשארות גלויות ב-`/admin/fleet` (`handoff.ts:139-169`). הכלל שרק role **מופעל** (או `main`) יכול להיות יעד handoff סוגר חור "dead letter": בקשה שהוגשה תחת role לא-מוכר/מנוטרל הייתה מוצגת לבעלים, אך פסק-הדין הסופי שלה לעולם לא היה מקבל spawn ע"י answer-watcher (`handoff.ts:6-15`).

### צריכה, סשן אינטראקטיבי (`bin/main-inbox.sh`)

רשום כ-hook מסוג `SessionStart` ב-`.claude/settings.json:3-14` **ברמת הפרויקט** (מחובר ל-git). מבצע poll ל-`role=main` (‏`fleet-agent-cli poll --role main`), ואם יש רשומות `open` או `verdicts` — מדפיס שורה אחת לכל פריט בתוספת תזכורת לסגור עם `complete`. ‏fail-open בעיצובו: כל תנאי-קדם חסר (חבילת CLI, env, DB) יוצא 0 בשקט, כך ש-inbox שבור לעולם לא חוסם עליית-סשן.

### צריכה, role `main` headless ב-Tier 2

לפי `fleet.json`, ‏`scheduler.mjs` ו-`roles/main.md`: רשומת `main` ב-`fleet.json` היא `{"enabled": true, "reactive": ["owner_direct_request", "goal_due"], "tier": 2, "schedule": []}` — אין slots מתוזמנים, כך שהוא מקבל spawn **רק** תגובתית. ‏`main.md` מתעד בדיוק שני מסלולי-הרשאה:

- **מסלול A** — בקשת handoff שנענתה, נאספת ע"י הסריקה הבלתי-מותנית של `answerWatcherTick` על verdicts (מסלול זה לא תלוי כלל במערך ה-`reactive` של `main` — סריקת ה-verdicts רצה עבור כל role עם קונפיג מופעל, בלי קשר לטריגרים שלו), הרשאה = תשובת הבעלים, נסגר דרך `complete` (לעולם לא `ack`, חוץ מ-verdict מסוג `denied`).
- **מסלול B** — רשומת `fleet_goals` שהגיע זמנה, נאספת ע"י טריגר `goal_due` של `inquiryWatcherTick`, הרשאה = גוף היעד עצמו, נסגר דרך `goal-progress`/`goal-close` (לעולם לא `complete`/`ack`).

### חוסר-עקביות אמיתי שכדאי לשים לב אליו

ה-`$main_comment` ב-`fleet.json:86` קובע ש-`main` מקבל spawn "**ONLY**" ע"י ה-answer-watcher אחרי שהבעלים עונה לבקשה כזו — אך מערך ה-`reactive` של `main` עצמו מחווט גם `owner_direct_request`, שנבדק ע"י ה-**inquiry**-watcher, לא ה-answer-watcher, ויורה על בקשה **ממתינה, לא-נענתה-עדיין** שהבעלים הגיש ישירות אל `main` (לא דרך handoff של role אחר). זהו מסלול spawn חי שלישי שההערה לא מכירה בו. בהתאמה, `roles/main.md` (נקרא במלואו, 104 שורות) מתעד רק "שני מסלולים" ולעולם לא מזכיר `owner_direct_request`. זהו פער אמיתי: `fleet.json` מחווט טריגר spawn לתוך `main` שה-prompt של ה-role עצמו לא נותן לו חוזה-טיפול מפורש. בפועל ייתכן שזה שפיר יחסית — פריט כזה כנראה יעלה דרך חלק ה-"inbox" של `run-context.sh` תחת אותו חוזה body/complete שמסלול A כבר מתעד — אך ככתוב, ה-prompt לא אומר זאת, וההערה העליונה בקובץ מתארת את החיווט בצורה שגויה.

### ממצא חיווט נוסף (מוסק, לא-מאומת אמפירית)

מכיוון ש-`main-inbox.sh` הוא hook מסוג `SessionStart` ברמת הפרויקט, ותפקידי הצי רצים עם `--setting-sources project` (ראו סעיף 3), ‏`SessionStart` הוא hook גנרי של מחזור-חיי-סשן ולא אינטראקטיבי-בלבד — זה מרמז בחוזקה ש-`main-inbox.sh` יורה על **כל** הרצת role headless בצי (ops-monitor, chief-of-staff, qa-runner וכו'), ולא רק כשבן-אנוש פותח סשן `main` אינטראקטיבי. הסקריפט fail-open ולא מדפיס דבר כש-inbox של main ריק, כך שהחשיפה בפועל כנראה נמוכה — אך זה אומר שמנגנון שמתועד בזיכרון/TODO כ-"עבור סשן main" הוא, לפי החיווט, אינסטלציה כלל-צית שרצה עשרות פעמים ביום עבור roles שאין להם קשר אליו. שווה בדיקה אמפירית מפורשת (חיפוש פלט `main-inbox.sh` בתוך trace‏ ‏`.json`/`.err` של role שאינו `main`) למי שרוצה זאת מאומת ולא רק מוסק מהחיווט.

### answer-watcher — הערות נוספות

- **הזיהוי הוא poll, לא push**: `answerWatcherTick` קורא לפקודת `verdicts` של ה-fleet CLI בכל tick; אין trigger/webhook ב-DB שמניע את הזמנון — ה-CLI עצמו (מחוץ להיקף קריאה זה) כנראה שואל את `fleet_requests` לרשומות נענו-ולא-נצרכו, וחוזה ה-I/O שלו — JSON‏ `{verdicts:[...]}` ב-stdout — הוא בדיוק מה ש-`scheduler.mjs:281-287` מצפה לו.
- **`auto_ack` מול הרצה מלאה** הוא דגל קונפיג פר-role (‏`config.roles[v.role].auto_ack`), לא תכונה פר-בקשה — כל verdict ל-role עם `auto_ack` מקבל טיפול `ack` קליל (שלפי חוזה ה-CLI עצמו גם מפרסם תגובת Slack משורשרת "הסוכן קלט", לפי `scheduler.mjs:165-167`), בעוד כל verdict ל-role לא-`auto_ack` מקבל spawn מלא כדי שה-role יוכל *לפעול* על ה-verdict, לא רק לסמן אותו כנקרא. ‏`inFlightAcks` (‏`Set`, `:168, 294-297`) מונע מרוץ ack-כפול בתוך חיי-תהליך אחד, אך הוא בזיכרון בלבד — מתאפס ב-restart של הזמנון, ונשען על כך שה-ack של ה-CLI עצמו הוא CAS‏ (compare-and-swap) בצד השרת, כך שמרוץ שאבד פשוט מחזיר `claimed:false` במקום ack כפול (`:298`).
- **פער מבני שכדאי לחשוף**: הסמן `verdict-<id>` (`:337`) נכתב **לפני** ה-spawn, והוא קבוע — "spawn אחד לכל verdict, לתמיד". אם אותו spawn נתקל מיד ב-`flock -n` הלא-חוסם של `run-role.sh` (`:127-130`, כי role אחר בצי באמצע ריצה) הוא יוצא 0 עם `skipped:lock` ולא עושה כלום. עבור role מתוזמן רגיל, ה-slot המתוזמן הבא שואל שוב verdicts דרך `run-context.sh` ועדיין יראה אותו (כי ה-state ברמת ה-CLI לא נגע בו, רק הסמן המקומי של הזמנון) — אבל **ל-`main` יש `schedule: []`**, כך ש-verdict של `main` שמתנגש עם המנעול הגלובלי אין לו נפילה-חזרה מתוזמנת; הוא יישב לא-נצרך עד שטריגר לא-קשור של `owner_direct_request`/`goal_due` יעיר את `main` שוב. בדיקת `.fleet-logs/runs/index.ndjson` (387 שורות) אחר `"skipped":"lock"` העלתה 0 מופעים היסטוריים — כלומר זה עדיין לא התממש בפועל — אך זהו פער חבוי ספציפי לעיצוב אפס-זמנון של `main`, לא תכונה כללית של answer-watcher.

## 7. ממצאים לתשומת לב

הרשימה הבאה היא ממצאים תיעודיים ותפעוליים ששווה לדעת עליהם — לא רשימת דחיפויות. שום דבר כאן אינו פער אבטחה חי; ה-fail-closed הבסיסי (`dontAsk`) ושכבות ה-guard ממשיכות להחזיק בכל המקרים שנבדקו.

1. **`$main_comment` מול קונפיגורציית `main` בפועל** — ‏`fleet.json:86` אומר ש-`main` מקבל spawn "רק" מ-answer-watcher, אך מערך ה-`reactive` של `main` עצמו מחווט גם `owner_direct_request` (טריגר inquiry-watcher) ש-`roles/main.md` לא מתעד כלל (פרוט מלא בסעיף 6).
2. **bookkeeping של `dry_run` מתבצע לפני שהבדיקה עצמה יורה** — סמן ה-slot ומונה התקרה נכתבים לפני הענף `if (config.dry_run)` ב-`tick()`, כך שיום שלם ב-dry-run "צורך" תקרה וסמני-slot אמיתיים (סעיף 2).
3. **אסימטריה בין המסלול המתוזמן לתגובתי תחת `dry_run`** — רק המסלול המתוזמן רושם כוונת "would spawn"; המסלולים התגובתיים מדולגים לגמרי, בלי לוג כלשהו (סעיף 2).
4. **מלכודת ה-worktree `beta-fleet` עדיין חמושה** — כלל ה-`Edit` ב-tier1 לא תואם כלום היום (ה-worktree לא קיים, אומת שוב ב-2026-08-09), אך יצירת הספרייה ע"י בן-אנוש (הצי עצמו חסום מלעשות זאת) תפעיל בשקט גישת-כתיבה מלאה לריפו, בלי שום שינוי הרשאות (סעיף 4).
5. **`dev-engineer` מוגדר ב-`fleet.json` (Tier 1, מודל `fable`, `enabled:false`) בלי קובץ `roles/dev-engineer.md`** — בטוח היום רק כי הוא מנוטרל (בדיקת ה-enabled ב-`run-role.sh` קודמת לבדיקת קיום ה-prompt); יפיק כשל `missing role prompt` באותו יום שמישהו יפעיל אותו בלי לכתוב קודם את ה-prompt.
6. **`main-inbox.sh` — hook `SessionStart` שאינו מוגבל לסשנים אינטראקטיביים** — לפי חיווט ה-`.claude/settings.json` הפרויקטי + `--setting-sources project`, כנראה יורה על כל הרצת role headless, לא רק על סשן `main`. מוסק מהחיווט, לא מאומת אמפירית (סעיף 6).
7. **אסימטריה קטנה ברשימת ה-deny של Tier 2**: `tier2.settings.json` לא כולל `Bash(env:*)`/`Bash(printenv:*)` שקיימים ב-tier0/tier1. לא ניתן-לניצול כרגע (‏`dontAsk` fail-closed, ‏`guard-tier2.sh` עדיין חוסם תעבורת-רשת ומפרשני inline) — אבל המקום היחיד ששלושת קובצי ה-tier לא מקבילים מבנית בלי סיבה מתועדת (סעיף 5).
8. **`.token.envchmod`** — קובץ שיורי 0-בייט (מצב `0644`, מ-2026-07-23, אותו יום כמו `.token.env`) שכמעט ודאי תוצר של קריאת `chmod` שהתקלקלה והשם והפקודה התמזגו לשם-קובץ אחד. נסרק ע"י ה-glob‏ `.token.env*` ב-`.gitignore:57` (אומת דרך `git check-ignore -v`), ולכן לא נחשף — לא זליגה, רק שיירי חסר-תפקוד; ‏`rm` ידני שקול לפי שיקול הבעלים.
9. **פריט `TODO.md` שנפתר בפועל אך לא סומן**: "commit של כל עבודת הצי ל-git (כרגע הכול untracked)" — `git ls-files .claude/fleet` מראה שכל הקבצים (‏`fleet.json`, ‏`bin/*`, ‏`settings/**`, רוב `roles/*.md`, ‏`TODO.md` עצמו) **כן** נמצאים ב-git, ו-`git status --short .claude/fleet/` נקי. הפריט מיושן וכדאי להוריד אותו מהרשימה.
10. **`tier2.settings.json` משובץ בפועל לשני roles, לא רק ל-`main`** — ה-`$comment` של הקובץ מתאר את הדרגה כ"the 'main' executor role ONLY", אך `fleet.json` מגדיר גם את `smoke-test-t2` עם `"tier": 2`, ו-`run-role.sh` בוחר settings לפי מספר-tier בלבד — כך ששני ה-roles טוענים בפועל את **אותו** קובץ הרשאות, כולל `Bash(supabase db query:*)`. הריסון של `smoke-test-t2` מלהריץ את הפקודה הזו הוא התנהגותי (הנחיה ב-prompt שלו), לא חסימה מכנית (סעיף 4). לא ידוע שנוצל לרעה, אך שווה לתקן את ה-`$comment` כך שישקף את הניתוב בפועל, או להוסיף חסימה מפורשת ב-`guard-tier2.sh` אם הכוונה האמיתית היא ש-`smoke-test-t2` לא אמור לגעת ב-`supabase db query` בכלל.

---

*מסמך זה הוא חלק מסדרת `docs/fleet/`. סקירה כללית — `00-index.md`; קטלוג ה-roles — `02-roles-catalog.md`; משטח ה-CLI ומחזור-חיי הבקשה — `03-cli-and-request-lifecycle.md`; מצב תפעולי חי — `04-operational-status.md`.*
