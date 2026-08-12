# KALFA Fleet — מצב תפעולי חי (Operational Status)

> מסמך זה נכתב מתוך קריאת לוגים בפועל (repo: `/var/www/vhosts/kalfa.me/beta`), נכון ל-**2026-08-09 15:30 (Asia/Jerusalem)**.
> כל מזהה טכני (נתיבים, טבלאות, פקודות CLI, קוד) נשמר באנגלית.

## 0. מה זה, ומה זה לא

מסמך זה הוא **תצלום-מצב נקודתי** (point-in-time snapshot) — לא מפרט ארכיטקטוני. הוא נגזר מקריאה חד-פעמית, read-only, של `.fleet-logs/runs/index.ndjson`, קובצי trace בודדים תחת `.fleet-logs/runs/`, דוחות digest, קבצי lock תחת `.fleet-logs/locks/`, פלט `pm2 list`/`pm2 describe`, ולוג ה-process של ה-scheduler עצמו (`kalfa-fleet-out.log`). המטרה: **לבדוק את הארכיטקטורה המתועדת מול מה שבאמת קרה** — לא מה ש-`fleet.json` והגדרות ה-role *אומרות* שאמור לקרות (זה מתועד ב-`01-architecture-and-orchestration.md` וב-`02-roles-catalog.md`), אלא מה שהלוגים בפועל מראים שקרה.

המספרים, השעות והאירועים כאן **נכונים לרגע הבדיקה בלבד**. קורא עתידי שרוצה לדעת "מה קורה עכשיו" צריך **להריץ מחדש** בדיקת לוגים דומה — לא לסמוך על המספרים הספציפיים במסמך הזה כאילו הם עדיין תקפים. ראו `03-cli-and-request-lifecycle.md` לפקודות ה-CLI הרלוונטיות לבדיקה כזו.

## 1. מצב דחוף (כרגע, נכון ל-15:30)

שני ממצאים הבאים **פתוחים ולא-פתורים** נכון לרגע כתיבת המסמך. הם אינם היסטוריה — הם המצב החי.

### 1.1 כשל אימות חי ב-support-drafter — ללא retry עדיין

ההרצה **האחרונה בכל הלוג** — `support-drafter`, ‏**2026-08-09 15:30:31**, שלוש דקות בלבד לפני שנקודת הזמן הזו נבדקה — **נכשלה**:

```
"Failed to authenticate. API Error: 401 Invalid bearer token"
duration_ms: 2208, cost: $0
```

מקור: ‏`.fleet-logs/runs/20260809T153024-support-drafter.json`.

זהו כשל אימות גולמי (401 Invalid bearer token), לא כשל לוגי בתוך ה-role. נכון לרגע הבדיקה: **לא בוצע עדיין retry**, ואין הרצת המשך שנרשמה בלוג אחריו. אם הכשל הזה עדיין לא טופל בזמן שקוראים מסמך זה — הוא ישן מדי מכדי להיות "עכשווי"; יש לבדוק את מצב האימות (OAuth token) בפועל, לא להסתמך על השורה הזו.

### 1.2 תפיסת מסגרת (`bac77347`, ₪4) שאושרה ע"י הבעלים — עדיין פתוחה 14 יום אחרי

`business-ops` מצא בהתאמה (reconciliation) השבועית שלו (‏`runs/20260809-business-ops-summary.md`, נוצר 2026-08-09 10:04) **שתי תפיסות מסגרת פתוחות** מול ספק הסליקה:

- קמפיין `15a8730e` (₪152) — מכוסה במלואו ע"י קרדיט ברמת-אירוע פעיל (₪84). **לא פער אמיתי, אין פעולה נדרשת.**
- קמפיין **`bac77347`** (אירוע `ec7c68d1`, **₪4**) — **עדיין פתוחה**. הבעלים אישר ניקוי כבר ב-**26.7.2026** (לסגור את הקמפיין, לשחרר את המסגרת, ולסגור גם את האירוע), אך נכון להיום **9.8.2026** — **14 יום מאוחר יותר** — היא עדיין לא שוחררה.

הציטוט המדויק מתוך `runs/20260809-business-ops-summary.md`:

> *"הבעלים אישר ניקוי ב-26.7 (לסגור את הקמפיין, לשחרר את המסגרת, ולסגור גם את האירוע), אך עדיין פתוח היום 9.8. אין נתיב קוד קיים לשחרור תפיסה כזו במערכת... הבקשה הקודמת בנושא הזה פגה בלי מענה. מעביר עכשיו בפועל ל-main"*

מה כן נבדק / נעשה:
- `business-ops` אימת שאין חיובים/holds כושלים אחרים (0 charging failures, 0 pending holds מלבד השתיים הנ"ל).
- `business-ops` פתח **handoff** חדש ל-`main` היום (‏`tmp-20260809b.txt`), עם הגוף המלא: *"נדרש: שחרור תפיסת מסגרת (4 ש"ח) על קמפיין bac77347-a2f4-4a6e-a825-933fcbd3d0c7 (אירוע ec7c68d1-2494-4887-a644-7648dcd74b9a)... הבעלים אישר את הפעולה ב-26.7.2026. אין נתיב קוד קיים... מומלץ: sumit-billing-expert לשחרור מול ספק הסליקה, ולאחר מכן events-guests-expert או rls-schema-engineer... פנייה קודמת בנושא הזה פגה בלי מענה."*
- שני roles נוספים נתקלו באותה בקשה תלויה היום ונמנעו במכוון מלגעת בה, כי אינה בסמכותם: `content-seo-strategist` — *"קיימת הודעת SessionStart על תיבת main עם פריט FYI שהועבר מ-business-ops... לא בסמכות התפקיד"*; `social-manager` — *"פנייה בתיבת main (לא לתפקיד זה)... אינה בגבולות התפקיד — לא טופלה כאן במכוון."*

מה **לא** נעשה, ומדוע:
- **אין נתיב קוד קיים לשחרור hold** מסוג זה במערכת (לא קיים endpoint/RPC/פונקציה שמבצעת שחרור J5-hold).
- ה-role `main` — ה-Tier-2 executor שאמור לצרוך handoff כזה — **לא רץ בפועל מאז 2026-07-31 00:06–00:08** (הרצה אחרונה עסקה בנושא אחר, GA4 analytics; ראו `runs/20260731-main-summary.md`). אין שום spawn נוסף שלו מאז, ולפי עיצוב המערכת `main` מתעורר **רק** על verdict ענוי (answered) ל-`fleet_requests` — לא על בקשה ממתינה גרידא.
- אישור הבעלים מ-26.7 היה **בעל-פה/לא-פורמלי** ומעולם לא הפך ל-verdict רשום ב-`fleet_requests` — ולכן הבקשה **פגה** (expired) ונוצרה מחדש, וזהו **לפחות המחזור השני** של פקיעה-והיווצרות-מחדש ללא פתרון.

**המצב נכון ל-15:30: פתוח, ולא מטופל.** אין לקרוא בשקט את ה-handoff החדש כ"טופל" — הוא רק *נוצר*, לא נענה.

## 2. נפח ריצות — per-role, לפי ה-ledger

`.fleet-logs/runs/index.ndjson` — 387 שורות, טווח 2026-07-23 עד 2026-08-09 15:30. ספירת אירועי start לפי role:

| Role | ריצות |
|---|---|
| `ops-monitor` | 77 |
| `support-drafter` | 56 |
| `event-health-watcher` | 48 |
| `qa-runner` | 38 |
| `chief-of-staff` | 35 |
| `brand-director` | 27 |
| `creative-producer` | 22 |
| `business-ops` | 20 |
| `smoke-test` | 19 |
| `callback-triage` | 18 |
| `content-seo-strategist` | 8 |
| `main` | 7 (רק **2** בפועל בוצעו — ראו §5) |
| `social-manager` | 6 |
| `smoke-test-t2` | 4 |

התדירויות **חורגות** מהסלוטים הקבועים המוגדרים ב-`fleet.json`, כי רוב ה-roles הם גם **תגובתיים** (‏`owner_direct_request`, `goal_due`, `contact_messages_new`, `callback_requests_pending`), לא רק run-on-schedule. לוג ה-process של ה-scheduler (‏`/var/www/vhosts/kalfa.me/.pm2/logs/kalfa-fleet-out.log`) מאשר ששתי השכבות חיות בפועל:

**דוגמאות סלוט קבוע** (תואם ל-`fleet.json` באופן מדויק, 2026-08-09):
```
07:30:23 ... spawning ops-monitor
08:00:23 ... spawning event-health-watcher
09:30:23 ... spawning support-drafter
10:00:23 ... spawning business-ops
11:00:23 ... spawning content-seo-strategist
11:30:24 ... spawning social-manager
15:30:24 ... spawning support-drafter
```

**דוגמאות תגובתיות** (spawn שלא נובע מסלוט קבוע):
```
2026-08-03: answer-watcher: spawning social-manager to consume "אצוות סושיאל שבועית לאישור"
2026-08-01/02: inquiry-watcher: 1 goal(s) due — spawning creative-producer
2026-08-03: answer-watcher: spawning qa-runner to consume "QA לילי: 1 כשל"
```

## 3. Self-throttling — ההגנות עובדות בפועל

לא רק שקווי ההגנה קיימים בהגדרה — הלוג מראה אותם **פועלים בפועל**:

- **daily_run_cap**: ‏`{"role":"brand-director","skipped":"daily_cap"}` (2026-07-30).
- **lock contention**: ‏`{"role":"creative-producer","skipped":"lock"}` (פעמיים), ‏`{"role":"main","skipped":"lock"}`, ‏`{"role":"event-health-watcher","skipped":"lock"}`.
- **killswitch**: ‏`{"role":"smoke-test","skipped":"killswitch"}`.

כל אחד מהם היה skip בודד, שהתפוגג מעצמו (self-resolving) — לא נעילה תקועה. הצי אף דיווח על עצמו בנושא: `answer-watcher: spawning ops-monitor to consume "Fleet lock skips: 3 היום — contentions או דבוק"` (2026-07-31) — כלומר צביר של lock-skips יצר התראה יזומה לבעלים, ולא הוסתר.

**מסקנה לפרק זה**: מנגנוני ה-throttling אינם תיאוריה — יש עדות ליישום בפועל, וכולם self-resolved ללא צורך בהתערבות ידנית.

## 4. כשלים ושגיאות

חיפוש מדויק (‏`"is_error":true`, ‏`api_error_status` לא-null) מצא **8 הרצות שנכשלו** מתוך כ-380:

| תאריך | Role | סיבה |
|---|---|---|
| 2026-07-23/24 (×3) | chief-of-staff, ops-monitor, event-health-watcher | חריגה ממכסת Anthropic השבועית — `"You've hit your weekly limit · resets 5pm (Asia/Jerusalem)"`, `api_error_status: 429` |
| 2026-07-30 | ops-monitor | תוקף OAuth פג — `"Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue."` |
| 2026-07-30 | business-ops | `terminal_reason: aborted_streaming`, עלות $0.27, 3 turns |
| 2026-07-31 | content-seo-strategist | `terminal_reason: aborted_tools`, עלות $1.31, 24 turns (רץ זמן ארוך לפני שנקטע) |
| 2026-07-31 | event-health-watcher | `terminal_reason: aborted_streaming`, עלות $0.11 |
| **2026-08-09 15:30:31** | **support-drafter** | **`"Failed to authenticate. API Error: 401 Invalid bearer token"`, duration_ms: 2208, עלות $0 — ראו §1.1** |

### תקרית exit=127 — `REPO_DIR` unbound variable

צביר נפרד פגע ב-`smoke-test`, ‏`ops-monitor` ו-`brand-director` בתוך 20 דקות ב-2026-07-29 16:24–16:44. הסיבה משומרת ב-`.fleet-logs/locks/spawn-brand-director.log`:

```
run-role.sh: line 13: REPO_DIR: unbound variable
```

**הוא נפתר מעצמו** — ההרצות המתוזמנות הבאות הצליחו כרגיל, וכבר דווח לבעלים: `answer-watcher: spawning ops-monitor to consume "צי: 3 ריצות exit=127 ב-29.7"`.

### קריסות subprocess של ה-scheduler — SyntaxError (build-corruption)

לוג ה-process של ה-scheduler עצמו מראה קריסות חוזרות של ה-**subprocess** ‏`dist/fleet-agent-cli.cjs` (ה-helper שמבצע polling עבור "inquiry-watcher"), עם חתימות אופייניות ל-build-corruption:

```
2026-08-04 08:01:22 — SyntaxError: Invalid Unicode escape sequence
2026-08-05 17:32:15 — SyntaxError: Unexpected end of input
```

בנוסף שגיאות רשת חולפות (`EAUTHTIMEOUT`, `read ECONNRESET`). קריסות אלה הרגו **רק** את ה-subprocess החד-פעמי של ה-polling — **לא** את ה-scheduler עצמו (ה-spawning המשיך כרגיל אחרי כל קריסה כזו). התבנית תואמת לממצא הידוע מראש ("worker bundle CJS gotchas").

### באג חוזר וטרי — `event-health-watcher` כותב לנתיב שגוי

**ממצא חדש, לא-מתועד קודם**: ל-`event-health-watcher` יש באג חוזר בבניית נתיב — הוא מנסה לכתוב את סיכום ה-local שלו אל `/var/www/vhosts/kalfa.me/.fleet-logs/runs/...` (**חסר את מקטע ה-`beta/`**), ונחסם ע"י sandbox ההרשאות. זה קרה **גם ב-2026-08-08 וגם ב-2026-08-09** — חתימת denial זהה ב-`Write` בשני קבצי ה-trace (‏`20260808T080032-event-health-watcher.json` ו-`20260809T080023-event-health-watcher.json`).

**נקודה חשובה**: הסיכום של `chief-of-staff` מה-2026-08-08 17:30 קבע במפורש שהבאג הזה הוא **"חד-פעמי" (one-time), לא חוזר באף json קודם**. המסקנה הזו **הופרכה כבר למחרת** — יום אחד בלבד אחרי ש-`chief-of-staff` דיווח "חד-פעמי", הבאג חזר. זו דוגמה מוחשית לכך שהביקורת-העצמית (self-audit) של הצי יכולה לפגר מחזור אחד שלם אחרי המציאות בשטח.

ההשפעה עד כה קוסמטית בלבד — ההתראה ה-owner-facing (FYI) יצאה כרגיל בשני המקרים; רק עותק הארכיון המקומי (‏`.md`) חסר עבור 08-08 ו-08-09.

## 5. מצב ה-locks

`.fleet-logs/locks/` מכיל **183 קבצים**, כולם markers של dedup/rate-limit — **לא** mutexים תקועים במובן הקלאסי:

| דפוס שם | תפקיד |
|---|---|
| `answer-YYYYMMDD` | dedup יומי ל-answer-watcher |
| `count-YYYYMMDD` | ספירה יומית |
| `verdict-<uuid>` | marker אישור-קבלה (ack) פר-verdict |
| `slot-<role>-<date>-<time>` | dedup פר-סלוט-זמנון, אחד פר-role פר-הרצה מתוזמנת |
| `reactive-<role>` | חותמת זמן (epoch ms) של הטריגר התגובתי האחרון |
| `spawn-<role>.log` | ריקים ברובם; רק ל-`spawn-brand-director.log` יש תוכן — שגיאת ה-`REPO_DIR` החד-פעמית מ-07-29 שתועדה ב-§4 |

**`global.lock`** (0 בייטים): ‏`Birth: 2026-07-23 14:04:23` (ההרצה הראשונה-אי-פעם של הצי), ‏`Modify: 2026-08-09 15:30:24` — נגע בדיוק ברגע ה-spawn האחרון (הכושל) של support-drafter. **לא נמצאה עדות שהוא תקוע כרגע**: ‏`ps` לא מראה תהליך support-drafter/claude יתום שקשור לאותה הרצה; ה-scheduler (pid 2110230) חי, וכבר הצליח מאז לספון (spawn) `inquiry-watcher` חדש כרגיל (`fleet-agent-cli.cjs sql ... role = 'business-ops'`); ואף run מאוחר יותר לא רשם lock-skip.

`reactive-main` (‏`1785445570707` → 2026-07-31 00:06:10) הוא ה-marker התגובתי ה"ישן" ביותר מבין כולם — אך זה **לא** אינדיקציה לתקלה; זה נובע ישירות מכך ש-`main` פשוט רץ לעיתים רחוקות מאוד בעיצוב (ראו §1.2 — הריצה האחרונה שלו הייתה אז).

## 6. דוחות digest — מה הם אמרו בפועל

- **`digest-20260804.txt`**: "יום שקט — כל 8 ההרצות ב-24 השעות האחרונות הסתיימו exit=0, ללא skip/lock/killswitch." QA ירוק (2508 בדיקות). ‏`ops-monitor`: דיסק 85%→86%, נפתח FYI טרי (הקודם על 85% פג ונוקה). מסמן **4 פריטים עדיין ממתינים להחלטת הבעלים, כולם פגים למחרת (5.8)**: דוח ops/finance שבועי מ-business-ops, שאלת תקרת עוסק-פטור, אישור לוח-תוכן שבועי, ומסירת תיבת ה-main — "אותן 4 בקשות כמו ה-digest הקודם, לא נוסף כלום."
- **`digest-20260806.md`**: "יום שקט. 10 הרצות צי ב-24 שעות — כולן exit=0, ללא skips, אין הרצה בלי summary." דיסק 87% (כבר אושר, לא חדש). אין קמפיינים תקועים, אין קפיצת כשלי-מסירה, 0 פניות לקוח חדשות. QA ירוק לחלוטין (2508 בדיקות, tree נקי). "Inbox/verdicts/open ריקים בכל 11 ה-roles הפעילים שנבדקו... אין מה להחליט, אין פעולה מומלצת."

**הדפוס שיש להיזהר ממנו**: שני ה-digests מתארים צי בריא-מכנית — אבל הטקסט של `digest-20260804.txt` **עצמו** מסמן שפריטים הממתינים להחלטת הבעלים מצטברים וחוזרים digest-אחר-digest **בלי להיפתר**. לפי §1.2, פריט ה-`bac77347` נשאר בלתי-פתור **3–5 ימים אחרי** שני ה-digests האלה, ועדיין פתוח 14 יום אחרי אישור הבעלים המקורי. **digest ירוק אינו הוכחה שאין כלום פתוח** — הוא רק אומר שהמנגנון עצמו (הרצות, בדיקות, סקירת inbox) עבד ללא שגיאה.

## 7. סטטוס pm2

התהליך נקרא **`kalfa-fleet`** (id 4) — **לא** "kalfa-fleet-scheduler":

```
kalfa-fleet | fork | pid 2110230 | uptime 9h | restarts 0 | status online
script: /var/www/vhosts/kalfa.me/beta/.claude/fleet/bin/scheduler.mjs
created at: 2026-07-31T16:41:58.140Z
```

`restarts: 0` משקף רק את ה-incarnation הנוכחי של תהליך ה-pm2. לוג ה-out של ה-scheduler עצמו מראה שהתהליך התחיל-מחדש בפועל **עשרות פעמים** מאז 07-31 (רובן במקבץ סביב ההקמה ב-07-31/08-01), ולאחר מכן בערך **פעם ביום, סביב 06:2x IDT**, ב-08-05, 08-06, ו-08-09 (`... starting — repo ... / KILLSWITCH cleared — fleet active`) — עקבי עם `uptime: 9h` שתואם להפעלה-מחדש של הבוקר הזה (06:26:23). **הסיבה להפעלה-מחדש המחזורית לא נקבעה מהלוגים בלבד** (יכול להיות deploy hook או cron תחזוקה יומי) — וזה **מחוץ לתחום** בדיקת read-only זו. קובץ ה-error log (‏`kalfa-fleet-error.log`) **ריק** — כל השגיאות, כולל הקריסות שתוארו ב-§4, נופלות ל-out-log במקום.

### אי-דיוק שנמצא ב-דיווח העצמי של ops-monitor

הדוח של `ops-monitor` מ-07:30 היום **טען uptime של "כ-233 ימים"** לתהליכים — טענה שסותרת באופן ישיר גם את ה-restart של ה-scheduler ב-06:26 **באותו בוקר עצמו**, וגם את ה-`uptime: 9h` שנצפה ישירות דרך `pm2`. זהו **פגם באיכות-הנתונים** בחישוב הפנימי של role ניטור אחד — יש להתייחס אליו כלא-מאומת עד שהחישוב הבסיסי ייבדק.

## 8. הערכה כוללת

**מנגנון התזמון, ה-dedup, ה-cap וה-self-reporting עובד כפי שתוכנן.** סלוטים קבועים יורים בזמן ותואמים ל-`fleet.json`; שכבת ה-reactive (בקשות בעלים, goal-due, polling של contact/callback) מוסיפה spawns נכון; דילוגי lock/cap/killswitch נדירים, מתאוששים לבד, וחוזרים לדיווח לבעלים אוטומטית; שערי QA ירוקים לכל אורך החלון שנצפה (2508 בדיקות, tree נקי, נכון ל-08-09 02:30); התרעת דיסק נדלקה ונוקתה נכון (87%→71%→79%); עלות פר-הרצה נשארת נמוכה גם בכשלים (הרצות שנקטעו עלו $0–$1.31, לא runaway).

**אך יש פער אמיתי, וחי כרגע, בין מה שהצי מדווח לבין מה שבאמת נפתר:**

- ניקוי תפיסת מסגרת (`bac77347`, ₪4) שהבעלים אישר **לפני 14 יום** (26.7) עדיין פתוח בפרודקשן, כי נדרש קוד שלא קיים, ומסלול ההסלמה שאמור לנתב אותו לביצוע מאומת-אנוש (`main`) יושב עכשיו בלי-צריכה **לפחות שני מחזורי בקשה-ופקיעה מלאים** — גלוי לשני roles נוספים היום, לא טופל ע"י אף אחד, כי `main` מתעורר רק על verdict *ענוי* שאף פעם לא מגיע.
- ההרצה **האחרונה בכל הלוג** (support-drafter, 2026-08-09 15:30, שלוש דקות לפני בדיקה זו) נכשלה על שגיאת אימות API גולמית (‏`401 Invalid bearer token`) — כשל חי ולא-פתור ברגע הבדיקה, טרם retry או drop.
- ל-`event-health-watcher` יש באג חוזר אמיתי (נתיב כתיבה שגוי, חסר מקטע `beta/`) ש-`chief-of-staff` של הצי עצמו איפיין כ"חד-פעמי" יום אחד לפני שחזר — דוגמה לכך שהביקורת-העצמית של הצי מפגרת מחזור אחד אחרי המציאות.
- הדוח של `ops-monitor` מ-07:30 היום טען uptime תהליכים "~233 יום", שסותר גם את ה-restart של ה-scheduler באותו בוקר וגם את ה-uptime הנצפה דרך pm2 — פגם באיכות-נתונים בפלט של role ניטור אחד, שיש להתייחס אליו כלא-מאומת עד בדיקה.

שום דבר מכאן לא מצביע על כך שהצי "שבור" כמערכת — ההגנות (locks, caps, human-gated Tier-2, QA, סף-דיסק) כולן עובדות אמפירית כמתוכנן — אבל **"digest ירוק" אסור לקרוא כ"אין כלום פתוח"**: פריט אמיתי, פונה-ללקוח/חיוב, פג ונוצר-מחדש בשקט כבר שבועיים, וגם דיווח-עצמי של role ניטור אחד לא תואם את מה שההרצה הבאה שלו-עצמו מראה.

---

*מסמך זה הוא חלק מסדרת `docs/fleet/`. סקירה על + אינדקס: `00-index.md`. מנוע התזמור (scheduler, tiers, hooks): `01-architecture-and-orchestration.md`. קטלוג 16 ה-roles: `02-roles-catalog.md`. ה-CLI ומחזור-חיי הבקשה: `03-cli-and-request-lifecycle.md`. מסמך זה — תצלום-מצב תפעולי חד-פעמי — אינו מוחלף על-ידי המסמכים האחרים, אלא צריך רענון מחזורי (הרצה חוזרת של בדיקת הלוגים) כדי להישאר רלוונטי.*
