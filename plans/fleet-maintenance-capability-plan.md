# KALFA Fleet — יכולת "תחזוקת-מערכת" (System Maintenance) — תוכנית

> מסמך זה הוא תוכנית (PLAN) בלבד — אין בו שינויי קוד, אין עריכה של `.claude/fleet/**`, ואין חיווט חי.
> נכתב לאחר קריאה מלאה של `docs/fleet/00-04` ושל `.claude/fleet/roles/qa-runner.md` (repo: `/var/www/vhosts/kalfa.me/beta`), נכון ל-2026-08-09.
> כל מזהה טכני (נתיבים, טבלאות, פקודות CLI, קוד) נשמר באנגלית.

## 0. מה זה, ומה זה לא

הבעלים ביקש שהצי ירכוש יכולת "תחזוקת-מערכת". מסמך זה הוא **תוכנית בלבד** — אין בו שום שינוי בפועל: לא ל-`fleet.json`, לא לקובצי tier-settings, לא ל-`roles/*.md`, לא ל-`scripts/fleet-agent-cli.ts`, ולא ל-DB. כל תוכן "מוכן-להעתקה" (role prompt, JSON, spec של verb) מוצג **בתוך המסמך הזה** לבדיקת הבעלים — הבעלים מיישם ביוזמתו, בצעדים קטנים, כל אחד עם אישור נפרד.

---

## 1. מטרה והיקף

**מטרה**: לתת לצי יכולת לשמור על **הבריאות של עצמו** — הקוד, הפרומפטים, ה-JSON-config, והתיעוד שמרכיבים את kalfa-fleet — ברמת הדיוק שה-QA הלילי (`qa-runner`) שומר על עץ-הקוד של האפליקציה. שני שכבות:

- **זיהוי (detect)**: לשים לב שקרה דבר-מה שכבר קרה בעבר (חוסר-חיווט, טענת-תיעוד שהתיישנה, תקלה שחזרה אחרי ש"נסגרה", דפוס-כשל חוזר) — לפני שמישהו צריך לגלות זאת שוב ידנית, בלוגים, כמו שנעשה היום כדי לכתוב את `docs/fleet/*.md`.
- **תיקון (remediate)**: במקרה צר-מאוד ומוגדר-מראש, להכין PR מוכן-למיזוג במקום רק לדווח.

**היקף מפורש — כן**: קוד, פרומפטים, קונפיג ותיעוד **של הצי עצמו** (`.claude/fleet/**`, `scripts/fleet-agent-cli.ts`, `docs/fleet/**`) — כלומר תשתית-פנים, לא נתוני-ייצור ולא נתוני-לקוח.

**היקף מפורש — לא**: שום פעולת billing/production-data. תפיסת המסגרת `bac77347` (₪4, אושרה ע"י הבעלים ב-26.7, עדיין פתוחה 14 יום — `04`, §1.2) **אינה** בהיקף התוכנית הזו — זו פעולת סליקה על נתוני-ייצור, ומקומה הנכון הוא המסלול הקיים (`handoff --to main` ← `sumit-billing-expert`/`events-guests-expert`/`rls-schema-engineer`). אבל `bac77347` **כן** משפיעה על עיצוב התוכנית: היא הדוגמה החדה ביותר לכך שפנייה שיושבת בתור `fleet_requests` בלי מנגנון-הסלמה יכולה להירקב שם שבועות בלי שאף אחד/דבר יבחין — ולכן §3 ו-§6 בתוכנית הזו בונים מנגנון **הסלמה-מדורגת** (aging) לפניות של תפקיד-התחזוקה עצמו, כדי שהממצאים שלו לא ייפלו לאותו בור.

---

## 2. עקרון מנחה: verb צר + שער-אישור — לא הרחבת-הרשאה גורפת

עקרון-העל של `scripts/fleet-agent-cli.ts` (`03`, §1) הוא ש**כל** פעולה פריווילגית היא verb צר עם guard משלו בצד השרת — לעולם לא "יכולת" גנרית שה-role מפעיל לפי שיקול-דעתו. יכולת התחזוקה חייבת לציית לאותו דפוס בדיוק: לא הרחבת קובץ tier-settings, לא allow-rule חדש שפותח גישת-Bash גולמית.

### השאלה שחייבים לענות עליה במפורש: להפעיל את ההרשאה הרדומה של `qa-runner`, או לבנות משהו חדש?

`qa-runner` הוא ה-role היחיד **המופעל** בצי עם הרשאת `git add`/`git commit`/`git push origin fleet/*`/`gh pr create` — **מוענקת, לא מנוצלת** ("אתה השומר היחיד" — `roles/qa-runner.md`). (`dev-engineer` מוגדר גם הוא ב-Tier 1 ב-`fleet.json`, ולכן טכנית מקבל את אותו קובץ-הרשאות — אך הוא `enabled:false` וללא קובץ `roles/dev-engineer.md` כלל, כך שההיתר הזה אף פעם לא נטען לריצה בפועל.) זה בדיוק סוג ההרשאה הרדומה שיכולת-תחזוקה עשויה לרצות להפעיל. שני אפשרויות נבדקו:

**אפשרות א' — להרחיב את `qa-runner` עצמו** (תוספת prompt: "כשאתה מוצא ממצא-תחזוקה, פתח PR עם ה-git שכבר יש לך"). **נדחתה**: הזהות של `qa-runner` היא ערבות פשוטה ומבוקרת — "אני מריץ שערי-QA, אני **אף פעם** לא נוגע בקוד" (הפרומפט קובע זאת כעיקרון-על, במילותיו המדויקות: "אבחון הוא התוצר, לא תיקון" — `roles/qa-runner.md`). לערבב לתוכה תפקיד תחזוקה עם סוג-שיפוט שונה לגמרי (קריאת תיעוד/קונפיג מול קוד, לא הרצת שערים) מדלל את הערבות הזו גם אם היא עדיין מוגנת-פרומפט — ובנוסף, מחזור-הריצה של `qa-runner` (לילי 02:30, model sonnet מכוון לניתוח-כשל-בדיקות) לא מתאים טבעית לביקורת-תיעוד שבועית.

**אפשרות ב' — role חדש, ו-verb חדש בשרת שמבצע את פעולת ה-git בעצמו (לא Bash-permission ל-role)**. **זו ההמלצה.** ההבדל הקריטי: אצל `qa-runner`, ה-**role עצמו** (הסשן של Claude שרץ headless) מחזיק הרשאת Bash לבצע `git`/`gh` — ההגנה היחידה היא משמעת-פרומפט ("מותר לך טכנית, אבל אל תעשה זאת"). ב-verb חדש בשם `housekeeping-pr` (מפורט ב-§4), פעולת ה-git **לא** רצה כ-Bash-tool-call של ה-role בכלל — היא קוד TypeScript מוגן-פרמטרים בתוך `fleet-agent-cli.ts` עצמו (אותה מחלקת-אמון כמו `createAdminClient()` שכבר עוקף RLS). ה-role אף פעם לא מרכיב פקודת git; הוא רק בוחר `--catalog-id` מתוך קטלוג סגור. זו הגנה **חזקה יותר** מזו של `qa-runner` — לא תלויה במשמעת-עצמית של מודל שפה שקורא הנחיה, אלא בקוד קבוע שביקורת-אנוש חד-פעמית שלו (code review) מכסה את **כל** מרחב הפעולה האפשרי מראש.

**מסקנה מעשית**: יכולת התחזוקה **לא** מקבלת tier 1 ולא הרשאת Bash-git. היא נשארת **Tier 0 תמיד** — גם לשלב הזיהוי וגם לשלב "ביצוע התיקון" (כי "הביצוע" מבחינת ה-role הוא רק קריאה ל-verb, לא הרצת git). זה מקטין את מרחב-הפגיעה יותר מהדוגמה שהתבקשנו לשקול, לא רק "מפעיל אותה מחדש".

---

## 3. קטלוג יכולות מוצעות

| # | יכולת | סוג | מנגנון | שער-אישור | דוגמה מהרשימה שהייתה נתפסת |
|---|---|---|---|---|---|
| 1 | זיהוי כשל-אימות (OAuth) חוצה-תפקידים | Detect | תוספת בדיקה ל-`ops-monitor` הקיים (בדיקה #6, ללא verb חדש) | ללא (Tier 0, כמו כל בדיקת ops-monitor אחרת) | שני אירועי 401: `ops-monitor` ב-30.7, `support-drafter` ב-9.8 (`04`, §4/§1.1) |
| 2 | סריקת קטלוג "תקלות ידועות" מול מצב חי | Detect | role חדש `fleet-maintainer` (Tier 0), קורא `.claude/fleet/known-issues.json` + Read/Grep על קוד/קונפיג/תיעוד, מדווח דרך `request` הקיים | ללא לגוף הדיווח (כמו `ops-monitor`/`business-ops`) | באג נתיב-כתיבה חוזר ב-`event-health-watcher`; `$main_comment` מול `reactive`; `$comment` של tier2 מול שיבוץ `smoke-test-t2`; פריט TODO.md מיושן; סחיפת תקציר-קוד ב-`fleet-agent-cli.ts` |
| 3 | הצעת-תיקון אוטומטית, מוגבלת-קטגוריה (PR בלבד) | Remediate | verb חדש **יחיד**: `housekeeping-pr --catalog-id <id>` | **שער כפול**: `request --kind approval` → פסק-דין בעלים → רק אז קריאה ל-verb; ה-PR עדיין ממתין ל-**מיזוג אנושי** | קטגוריה אחת בלבד ב-v1: תיקוני טקסט תחת `docs/fleet/**` (ר' §6 — כל שמונה הדוגמאות שהתבקשנו מטרתן `.claude/fleet/**`/`scripts/fleet-agent-cli.ts`, ולכן נשארות detect-only) |
| 4 | הסלמה-מדורגת (aging) לפניות תחזוקה שלא נענו | Detect+report, מוטציה על השורה של עצמו בלבד | `poll` (בדיקת גיל) → `withdraw` → `request --kind question` (verb קיימים, שילוב חדש) | ללא (לא נתון-ייצור; רק דרגת-דחיפות של הפנייה) | הדפוס של `bac77347`: פנייה פגה בלי מענה פורמלי, לפחות פעמיים (`04`, §1.2) — **המנגנון**, לא ה-hold עצמו, הוא בהיקף |
| 5 | תיקון קונפיגורציית-הצי עצמה (`fleet.json`/tier-settings/`guard*.sh`/`roles/*.md`) | — | **לא מוצע כלל** | אנושי-בלבד, תמיד | — |

---

## 4. פירוט טכני — ה-verb החדש היחיד: `housekeeping-pr`

התוכנית מוסיפה **verb אחד בדיוק** ל-`fleet-agent-cli.ts` (מתוך 19 הקיימים היום — `03`, §2). זו נקודה מכוונת: ככל שפחות verbs חדשים, כך פחות משטח-קוד חדש לבדוק. כל שאר היכולות (§3 #1, #2, #4) נבנות **אך ורק** מ-verbs קיימים (`request`, `poll`, `withdraw`) ומהרשאות Tier-0 קיימות (Read/Grep/Glob).

### `housekeeping-pr --catalog-id <id> --request-id <uuid>`

```
housekeeping-pr --catalog-id <id> --request-id <uuid>

קורא:
  - .claude/fleet/known-issues.json (קובץ קבוע — לא פרמטר; מונע הזרקת-קטלוג)
  - fleet_requests (לאמת את request-id)
  - הקובץ שה-catalog entry מצביע אליו (target_file / fix.file), ISOLATED
    worktree — לא עץ-העבודה החי

כותב:
  - branch fleet/maintenance-<catalog-id>-<YYYYMMDD> (git plumbing, ראו "מנגנון git" למטה)
  - PR דרך `gh pr create` — לעולם לא merge
  - fleet_requests.status (עקיף, דרך complete/withdraw הקיימים — לא ב-verb הזה עצמו)

בטיחות:
  1. **אימות request-id**: השורה ב-fleet_requests חייבת להיות role='fleet-maintainer',
     kind='approval', ו-status בעל פסק-דין מאשר (לא pending/denied). אחרת fail(1).
  2. **scoping לקטלוג**: catalog-id חייב להתקיים ב-known-issues.json עם
     remediation_kind='pr-eligible'. שדה fix.file חייב להיות תחת docs/fleet/**
     (הקטגוריה היחידה המאושרת ב-v1 — ר' §6). כל דבר אחר → fail(1), גם אם
     entry כזה יימצא (הגנת-עומק: אם מישהו יוסיף בטעות pr-eligible על קובץ
     תחת .claude/fleet/**, ה-verb עדיין מסרב מכנית).
  3. **re-check מכני, לא-LLM, מיד לפני כתיבה**: ה-verb קורא בעצמו את
     catalog.check (type: contains_line/absent_line — ר' §5) על target_file
     **עכשיו**, לא סומך על שיפוט ה-role שקרא אליו. אם הבדיקה לא מתקיימת
     (הבעיה כבר תוקנה בינתיים, או הקובץ השתנה) → exit 2, no-op, בלי לגעת
     בשום דבר. זו ההגנה המרכזית מפני "role טעה בשיפוט".
  4. **אין overlap עם flock הגלובלי**: ה-verb **לא** לוקח `flock` בעצמו —
     הוא כבר רץ בתוך תהליך שמחזיק את `.fleet-logs/locks/global.lock` (fd 9,
     דרך run-role.sh). ניסיון flock -n שני מתוך אותו run יינעל-מול-עצמו
     (POSIX advisory lock נבחן לפי open file description, לא PID) — לכן
     ה-verb יורש בלעדיות מהריצה שמכילה אותו, ואל לו לנסות לקחת אותה שוב.
  5. **בידוד git — לא נוגע בעץ-העבודה החי**: פעולת ה-git **חייבת** לרוץ
     ב-worktree זמני ומבודד (למשל `git worktree add --detach <tmp> origin/main`
     תחת נתיב זמני ייעודי, **לא** `beta-fleet` — נתיב-המלכודת המחומש
     המתועד ב-`01`, §4). אם הכתיבה תיגע בעץ החי, כל commit ישקף גם את
     ה-21 קבצים ששונו + 8 לא-במעקב שהם מצב-קבע ב-repo לפי roles/qa-runner.md
     — בדיוק סוג התאונה שה-verb הזה נועד למנוע. worktree מוסר תמיד ב-finally,
     כולל בנתיב-כשל.
  6. **אידמפוטנטיות מול PR קיים**: `gh pr list --head fleet/maintenance-<id>-`
     לפני יצירה — `--head` של `gh pr list` הוא **prefix-match, לא glob**:
     `foo` מחזיר כל PR שה-head branch שלו **מתחיל ב**-`foo`; אין תמיכה
     ב-`*`. **תיקון-דיוק לעומת טיוטה קודמת**: ה-manual הרשמי עצמו
     (`cli.github.com/manual/gh_pr_list`) אומר רק "Filter by head
     branch" ואינו מפרט את סמנטיקת ה-matching; ההתנהגות בפועל מדווחת
     ומאושרת ב-`cli/cli` issues #10816 ו-#2977, ותואמת את תחביר
     `head:` בחיפוש ה-web של GitHub. מומלץ אימות אמפירי חד-פעמי (הרצת
     `gh pr list --head <prefix>` בפועל) לפני הפעלה חיה בצעד 4, ולא
     להסתמך על ה-manual בלבד. ולכן אין לכתוב תו-כללי בסוף המחרוזת. אם
     PR פתוח כבר קיים לאותו catalog-id, exit 2 עם ה-URL שלו, לא PR כפול.
  7. **credential נפרד**: `gh pr create` הראשי-הראשון של הצי שנוגע ב-git
     כותב (לא רק קורא) — דורש `GH_TOKEN` תקין ב-`.env.local`, נטען לתוך
     ה-CLI כמו שאר ה-credentials, **לא** נחשף ל-role (אותה גישה כמו
     `SUPABASE_DB_PASSWORD`). **תנאי-קדם לפני הפעלה**: אימות ש-`gh auth status`
     עובד ללא-אינטראקטיבי תחת ה-HOME/PATH הנעוצים של `run-role.sh` — לבדוק
     בפועל, לא להניח.
  8. **לעולם לא merge**: ה-verb לא קורא `gh pr merge` בשום ענף-קוד. מיזוג
     נשאר החלטת-בעלים ידנית, תמיד — ר' §6.

exit codes (עקבי עם המוסכמה התלת-רמתית של `03`, §6):
  0 — PR נוצר בהצלחה (כולל ה-URL ב-stdout JSON)
  2 — no-op שפיר: הבעיה כבר לא קיימת (re-check נכשל), או PR כבר פתוח
  1 — שגיאה קשה: request-id לא-מאושר, catalog-id לא-קיים/לא-pr-eligible,
      git/gh נכשל, worktree לא-נוקה

**אימות מול תיעוד חי (לא מזיכרון-אימון)**: כל טענת-התנהגות חיצונית ב-verb
הזה נבדקה ב-2026-08-09 מול תיעוד רשמי, לא הונחה מזיכרון: `GH_TOKEN` כמנגנון
אימות לא-אינטראקטיבי ל-`gh` (מאומת מול `cli.github.com/manual/gh_help_environment`)
— `gh auth status` מדווח כניסה דרך `GH_TOKEN` כשהמשתנה מוגדר (הפלט המדויק:
`✓ Logged in to github.com as <user> (GH_TOKEN)`); `gh pr create` בלי push
מוקדם נכנס למצב-פרומפט אינטראקטיבי (לפי `cli.github.com/manual/gh_pr_create`),
שלא יעבוד תחת הרצה headless ללא TTY — ולכן
תואם את סדר-הפעולות כאן (push לפני `gh pr create`); `gh pr list --head`
הוא prefix-match לא glob (ר' בטיחות #6 למעלה); `git worktree add --detach`
ו-`git worktree remove --force` מאומתים מול `git-scm.com/docs/git-worktree`
(ל-worktree **נעול** נדרש `--force` **פעמיים** — לא רלוונטי כאן כי ה-verb
לעולם לא נועל worktree); סמנטיקת ה-flock (בטיחות #4) מאומתת מול
`man7.org/linux/man-pages/man2/flock.2.html`: "Locks created by flock() are
associated with an open file description" — כלומר fd שעבר בירושה (fork
בלי סגירה מפורשת) חולק את אותה-נעילה-בדיוק, ואילו `open()` טרי לאותו קובץ
מהווה open file description **נפרד** שניסיון `LOCK_NB` עליו יידחה (`EWOULDBLOCK`)
כל עוד הנעילה המקורית מוחזקת — מה שמצדיק את ההנחיה "אל תנסה flock שני" ללא
תלות בשאלה אם ה-fd עצמו עובר בירושה או לא. שום ספריית-npm/SDK חיצוני לא
נבחר בתוכנית הזו — כל היכולות בנויות על `git`/`gh`/Node `child_process`
(ליבה) שכבר קיימים בסביבת הפריסה, ולכן לא נדרשה בדיקת ctx7 לספרייה חדשה.

**מנגנון git (הבהרה חשובה)**: קריאות ה-git/gh של ה-verb הזה **לא** עוברות
דרך guard.sh/tier-settings בכלל — הן קוד-שרת מהימן (execFile מתוך Node),
לא Bash-tool-call של ה-role. המשמעת של deny-rules על `git worktree`/`git push`
ב-tier1.settings.json **לא חלה כאן** — היא שומרת על ה-role's *own* Bash tool,
לא על קוד ה-CLI. המשמעות: הבטיחות של ה-verb הזה **כולה** תלויה בקוד עצמו
(הבדיקות 1-8 למעלה) ולא בשכבת-hook חיצונית — ולכן שינוי עתידי בקוד ה-verb
הזה עצמו ראוי לביקורת-קוד באותה רמת-קפדנות שקיבל guard.sh/guard-tier2.sh.
```

---

## 5. קטלוג `known-issues.json` — סכימה + הדוגמאות מ-`docs/fleet/*.md`

קובץ חדש, git-tracked, תחת `.claude/fleet/known-issues.json` (מוצע כאן כתוכן — לא נכתב ע"י המסמך הזה). בניגוד ל-`fleet.json`/tier-settings, הקובץ הזה **לא** משנה שום הרשאת-הרצה — הוא נתון-בלבד שה-role קורא ושה-verb מאמת מולו מכנית. עם זאת, **הוספת entry עם `remediation_kind: "pr-eligible"` היא עדיין החלטת-מדיניות** (מרחיבה את מה שה-verb יפעל עליו) — לכן עריכה שלו עוברת PR-review רגיל, בדיוק כמו כל קוד אחר.

### סכימה

```json
{
  "id": "string — slug יציב",
  "title": "string — עברית, תמציתי",
  "category": "docs-drift | code-bug | config-drift | stray-file | correctness-gap",
  "target_file": "path — היכן התיקון האמיתי שייך (יכול להיות מחוץ ל-docs/fleet/**)",
  "remediation_kind": "detect-only | pr-eligible",
  "check": {
    "type": "contains_line | absent_line | custom",
    "file": "path",
    "match": "מחרוזת מדויקת — חייבת/אסורה-להיות-נוכחת (contains_line/absent_line בלבד; custom = שיפוט role, ללא re-check מכני)"
  },
  "fix": {
    "type": "replace_line | delete_line | none",
    "file": "path — ל-pr-eligible חייב להיות תחת docs/fleet/**",
    "match": "מחרוזת מדויקת להחלפה/מחיקה",
    "replace": "טקסט חלופי מדויק (מיותר ל-delete_line)"
  },
  "status": "open | resolved | recurred",
  "stale_after_days": 5,
  "notes": "טקסט חופשי — כולל, ל-detect-only, את התיקון המדויק שאדם צריך להחיל ידנית"
}
```

**כלל מכני**: `remediation_kind: "pr-eligible"` מותר **רק** כאשר `fix.type != "none"` וגם `fix.file` תחת `docs/fleet/**` וגם `check.type` הוא `contains_line`/`absent_line` (לא `custom`) — verb מסרב מכנית לכל דבר אחר (בטיחות #2 ב-§4).

### שמונה הערכים הראשונים — כולם `detect-only` (נימוק ב-§6)

| id | target_file | fix מוצע (בגוף הפנייה, ליישום ידני) |
|---|---|---|
| `ehw-write-path-missing-beta` | `roles/event-health-watcher.md` | הוסף/תקן את בניית ה-path לכלול את מקטע ה-`beta/` המפורש — ראו `04`, §4 |
| `fleetjson-main-comment-drift` | `fleet.json:86` (`$main_comment`) | הוסף ל-`$main_comment` את `owner_direct_request` כמסלול-spawn שלישי, מוכר במפורש |
| `tier2-comment-vs-smoketest-t2` | `.claude/fleet/settings/tier2.settings.json` (`$comment`) | עדכן מ-"the 'main' executor role ONLY" לתיאור שמכיר גם ב-`smoke-test-t2` כמשובץ לאותה דרגה |
| `todo-git-commit-stale` | `.claude/fleet/TODO.md:33` | הסר את השורה — `git ls-files .claude/fleet` מאשר שהכול כבר במעקב |
| `cli-synopsis-missing-verbs` | `scripts/fleet-agent-cli.ts:20-107` (תקציר ראש-קובץ) | הוסף לתקציר את `verdicts`/`sql`/`triage-claim`/`triage-finish` |
| `insertandnotify-swallowed-error` | `scripts/fleet-agent-cli.ts:397-407` | בדוק את ה-`error` של ה-re-select גם במסלול הדדופ, לא רק ב-insert הראשי |
| `digest-fake-success` | `scripts/fleet-agent-cli.ts:877-892` | דווח את ערך-ההחזרה האמיתי של `sendSlackAlert()` במקום `{posted:true}` קבוע |
| `withdraw-exit-code-inconsistent` | `scripts/fleet-agent-cli.ts:748-773` | קבע `process.exitCode = 2` על no-op, כמו `ack`/`draft-reply`/`triage-finish`/`goal-progress`/`goal-close` |

כל שמונה ה-`target_file` נופלים תחת `.claude/fleet/**` או `scripts/fleet-agent-cli.ts` — **שני העצים** שהתוכנית הזו קובעת כ-human-only (§6). זו לא תאונה: זה בדיוק המצב שהוביל להמלצה. `remediation_kind` שלהם הוא `detect-only`; `notes` שלהם מכיל את התיקון המדויק, כדי שהפנייה לבעלים תהיה diff מוכן-להעתקה גם בלי אוטומציה.

**קטגוריית ה-`pr-eligible` היחידה ב-v1** (`docs/fleet/**`) **מתחילה ריקה מכוונת**. אף לא אחת משמונה הדוגמאות מזכה אותה — כי אף אחת מהן לא נמצאת רק בתוך `docs/fleet/**` (הטענה ה"ריקה" של `brand-director` שהתיישנה, לדוגמה, יושבת ב-`roles/brand-director.md` עצמו, לא רק בתיעוד עליה). ה-entry הראשון בקטגוריה הזו ייכתב ע"י הבעלים בפועל כשריצה חיה ראשונה של `fleet-maintainer` תגלה סחיפה אמיתית שגבולה הוא `docs/fleet/**` בלבד — ראו §7, צעד 5.

---

## 6. סיכונים ו-blast radius

### 6.1 self-modifying infrastructure — הקו האדום

הסיכון החד ביותר בכל התוכנית: role שמתקן את **התצורה של הצי עצמו** יכול לפגוע ביכולת של הצי לזהות/לבלום אותו. אם `fleet.json`, קובצי ה-tier, קובצי ה-guard hooks, או פרומפטים של roles אחרים ייערכו אוטומטית — כל שגיאה בעריכה כזו יכולה להרחיב הרשאה בטעות (בדיוק סוג התאונה שתועדה ב-`01`, §4: "כלל `Edit(path)` הוא זה שמעניק גם את הכלי `Write`... מלכודת אמיתית"). **המלצה**: `.claude/fleet/**` (כולל `roles/*.md`, `fleet.json`, כל `settings/*.json`, `guard*.sh`, `TODO.md`) וגם `scripts/fleet-agent-cli.ts` עצמו נשארים **human-only לצמיתות** — לא רק "עד לשלב מאוחר יותר". שום צעד בתוכנית הזו (כולל צעדים עתידיים לא-כתובים כאן) לא אמור לשנות את זה בלי תוכנית נפרדת שדנה מפורשות בשינוי הקו הזה.

זה אומר בפועל: **v1 של יכולת-התחזוקה כמעט כולה detect**, לא remediate. הערך העיקרי שלה הוא: (א) לזהות מהר יותר ממה שקרה היום (chief-of-staff תיאר באג חוזר כ"חד-פעמי" יום לפני שהוא חזר), ו-(ב) להכין diff מדויק מוכן-להעתקה בגוף הפנייה, כדי שיישום ידני ייקח שניות ולא דקות של חיפוש. זו לא חולשה של התוכנית — זו תוצאה נכונה של הקו האדום.

### 6.2 `housekeeping-pr` — הקוד עם הכי הרבה סיכון-חדש

זהו ה-verb הראשון בכל הצי שכותב git (אף אחד מ-19 ה-verbs הקיימים לא נוגע ב-git/gh בכלל — חלקם read-only לגמרי [`poll`/`verdicts`/`sql`/`goal-poll`/`business-facts`/`analytics-summary`], והשאר כותבים לכל היותר ל-DB, ל-Slack/push, או לקובץ בודד תחת `.fleet-logs/`/`.claude/fleet/*.examples.md`). ריכוז-סיכונים:

- **worktree מבודד**: אם המימוש בטעות ייגע בעץ-העבודה החי (או ב-`beta-fleet`), הוא ייגרר את המצב-הרגיל של 21+8 קבצים לא-נקיים לתוך commit. חובה `git worktree add --detach` לנתיב-זמני נפרד + `git worktree remove --force` ב-finally.
- **credential חדש** (`GH_TOKEN`) — שכבת-סוד נוספת שצריך להגדיר, לתעד כסודי (כמו `.env*`/`.token.env`), ולוודא ש-`gh auth status` עובד לא-אינטראקטיבית לפני שמפעילים בפועל.
- **flock**: אסור ל-verb לנסות לקחת שוב את `global.lock` — הוא כבר רץ בתוכו.
- **מיזוג נשאר אנושי**: אין תרחיש בתוכנית הזו שבו PR ממוזג אוטומטית. אם בעתיד יעלה רצון ל-auto-merge לקטגוריה צרה-במיוחד — זו צריכה תוכנית נפרדת שמנמקת את זה במפורש, לא הרחבה שקטה.

### 6.3 קטלוג `known-issues.json` כמשטח-סיכון

הקובץ עצמו לא מעניק הרשאת-הרצה (זה לא tier-settings) — אבל `remediation_kind: pr-eligible` שגוי (לדוגמה, מישהו מוסיף entry עם `fix.file` תחת `.claude/fleet/**` בטעות) הוא בדיוק התרחיש שסעיף 4 בטיחות #2 חוסם **מכנית** (לא רק בסקירת-קוד). שתי שכבות: code review על הקובץ + guard מכני ב-verb.

### 6.4 רעש-פניות ו-"אותם 4 פריטים, digest אחרי digest"

`04`, §6 מתעד דפוס אמיתי: digest ירוק לא אומר "אין כלום פתוח" — פריטים מצטברים ונשארים תקועים. יכולת-תחזוקה שרק **מוסיפה** עוד `fyi` שגרתי מדי שבוע מחריפה את הבעיה הזו, לא פותרת אותה. §3 #4 (הסלמה-מדורגת) הוא התשובה המוצעת: ר' §6.5.

### 6.5 הסלמה-מדורגת — עיצוב מדויק (כדי לא לשכפל את `bac77347`)

ממצא קוד קונקרטי (`notifyAdmins`, `fleet-agent-cli.ts:317-323`): `--kind fyi` תמיד ממופה ל-Slack `level:'info'`; `question`/`approval` תמיד ממופים ל-`level:'warn'`. **תיקון לעומת טיוטה קודמת של המסמך הזה**: האם רמה נתונה חוצה את סף ה-@mention **אינו** invariant קבוע בקוד — הוא נגזר בזמן-ריצה מהערך המנוהל-בעלים `config.mentionMinLevel` דרך `LEVEL_RANK` (`info:1, warn:2, error:3`) והשוואה `rank(level) >= rank(minLevel)` (`src/lib/alerts/slack.ts:65-72`). **נבדק חי מול `app_settings`, 2026-08-09: `slack_mention_min_level='info'`** — כלומר **כרגע גם `fyi` (info, דרגה 1) כבר חוצה את הסף** (1≥1), לא רק `question`/`approval`. הדיכוטומיה "fyi לעולם לא מתריע, question תמיד מתריע" מתקיימת **רק** כאשר הסף מוגדר בדיוק ל-`'warn'` (ואם הוא יוגדר ל-`'error'`, גם `question` מפסיק לחצות — כלומר גם "question מבטיח התראה" הוא תנאי, לא ודאות מוחלטת). על אף זאת: **ממצא דחוף מ-`fleet-maintainer` עדיין צריך להיפתח כ-`--kind question`, לא `--kind fyi`** — לא כי זה ההבדל היום (שני הסוגים כרגע חוצים), אלא כי `question`/`warn` היא הערבות החזקה ביותר הזמינה על-פני כל ערך אפשרי של הסף (למעט `'error'`, מקרה-קצה שאינו בשליטת התוכנית הזו).

מנגנון ההסלמה עצמו (כשהצי מוצא שהוא **עצמו** לא נענה):

1. בכל ריצה, `fleet-maintainer` מריץ `poll --role fleet-maintainer` ובודק `created_at` של כל בקשה פתוחה-שלו-עצמו.
2. פנייה שעברה את `stale_after_days` (ברירת-מחדל 5, שדה פר-entry בקטלוג) **בלי מענה**:
   - `withdraw --id <old-id>` — **קרא את ה-JSON, לא את קוד-היציאה**: `withdraw` תמיד יוצא 0, גם ב-no-op (`03`, §6, ממצא #3, כבר מתועד כפער) — הבדיקה היחידה האמיתית היא `withdrawn:true/false` בפלט.
   - אם `withdrawn:true`: פתח `request` **חדש** ברמת-דחיפות גבוהה יותר (fyi→question, question נשאר question), עם `request_key` הכולל את מספר-ההסלמה (כדי לא להתנגש בדדופ) ובגוף: "פנייה קודמת בנושא זה (<id ישן>) פגה ללא מענה <N> ימים" — אותו ניסוח בדיוק שכבר נמצא ב-`business-ops` (`04`, §1.2).
   - אם `withdrawn:false` (מישהו כבר ענה במקביל): אין מה לעשות — `poll` הבא יראה verdict.

זה בדיוק המנגנון שהיה חוסך מ-`bac77347` שני מחזורי פקיעה-בשקט (`04`, §1.2) — לא עבור ה-hold עצמו (מחוץ להיקף, ר' §1), אלא כתבנית כללית לפניות-תחזוקה.

### 6.6 סיכון-נמוך, אך שווה-ציון: המודל שנבחר

`fleet-maintainer` מוצע ב-`sonnet` (לא `haiku`) — כי סוג-השיפוט הדרוש (השוואת פרוזה-הערה מול קונפיג בפועל, לא רק grep מכני) קרוב יותר ל-`business-ops`/`chief-of-staff`/`qa-runner` מאשר ל-`ops-monitor`/`event-health-watcher` (checklists מכניים). זה מייקר קלות כל ריצה — נמוך יחסית לתדירות השבועית המוצעת.

---

## 7. תפקיד(ים) מוצע(ים)

### 7.1 החלטה: שני שינויים, לא אחד

- **הרחבה קטנה ל-`ops-monitor`** (לא role חדש) — בדיקת חוסן-אימות חוצה-תפקידים. זו בדיקה זולה, יומית, שמתאימה בול לתפקיד ש**כבר** קורא את `.fleet-logs/runs/index.ndjson` ומדווח על `exit!=0` (בדיקה #5 הקיימת). אין סיבה לפצל את זה ל-role נפרד.
- **role חדש `fleet-maintainer`** — לביקורת תיעוד/קונפיג/קטלוג העמוקה יותר, ול-`housekeeping-pr`. זה דורש קריאת-קבצים נרחבת (כמו שיצרה את `docs/fleet/*.md` עצמם) שלא מתאימה לקצב/למודל של `ops-monitor`.

### 7.2 תוספת ל-`ops-monitor.md` (diff מדויק)

הערה עדכנית: התקרית השנייה (`support-drafter`, 9.8.2026, 15:30) כבר **תוקנה בפועל היום** ע"י הבעלים (`claude setup-token` מחדש + עדכון `.claude/fleet/.token.env`) — הבדיקה המוצעת כאן היא **מניעה-קדימה** לפעם הבאה, לא טיפול בתקרית הנוכחית.

```diff
--- a/.claude/fleet/roles/ops-monitor.md
+++ b/.claude/fleet/roles/ops-monitor.md
@@ -15,7 +15,7 @@
 ## בזמן כשל

-חמש בדיקות בלתי-תלויות. פקודה חסומה/פלט לא-קריא — רשום ועבור לבאה, אל
+שש בדיקות בלתי-תלויות. פקודה חסומה/פלט לא-קריא — רשום ועבור לבאה, אל
 תנסה ניסוח חלופי פעמיים. **בדיקה שלא רצה איננה בדיקה שעברה** — שורה
 משלה ב-summary עם "לא נבדק"+הסיבה. שלוש ומעלה שלא רצו = ממצא בפני עצמו.

@@ -42,3 +42,4 @@
 5. **לוג ריצות הצי**: קרא את `/var/www/vhosts/kalfa.me/beta/.fleet-logs/runs/index.ndjson` (שורות אחרונות). **ממצא: `exit!=0`; `skipped:"lock"` 2+ פעמים אותו יום; `skipped` שאינו `"disabled"`.** שורה לא-תקינה שעוצרת קריאה = ממצא בפני עצמו — ציין את מספר השורה האחרונה שנקראה.
+6. **כשל-אימות חוצה-תפקידים (OAuth)**: בתוך אותה קריאה ל-`index.ndjson`/trace files, חפש `api_error_status:401` עם טקסט התואם `bearer token`/`OAuth access token has expired` — **בכל role**, לא רק ב-ops-monitor. זה סימן פר-**צי**, לא פר-role: `.token.env` משותף לכל הריצות (`run-role.sh:120-124`), ולכן כשל אימות אחד מנבא שכל ריצה הבאה, של כל role, תיכשל עד רוטציה. **ממצא כזה = `--kind question` תמיד (לא `fyi`)** — `fyi` ממופה ל-Slack `info`, `question`/`approval` ל-`warn` (דרגה גבוהה יותר); `warn` היא הערבות החזקה ביותר לחצות את סף ה-@mention הקונפיגורטיבי (`config.mentionMinLevel`) על-פני כל ערך שהבעלים יגדיר לו (ר' תוכנית `fleet-maintenance-capability-plan.md` §6.5 לניתוח המדויק ולערך החי שנמדד). ציין את השעה המדויקת של הכשל הראשון שנצפה וכמה roles/ריצות נפגעו מאז.

 ## איך לדווח
@@ -57,4 +64,4 @@

 ## משפט-הצלחה

-*"ריצה מוצלחת = חמש הבדיקות רצו, לכל אחת שורה עם מספר או 'לא
+*"ריצה מוצלחת = שש הבדיקות רצו, לכל אחת שורה עם מספר או 'לא
 נבדק'+סיבה."*
```

### 7.3 role חדש: `.claude/fleet/roles/fleet-maintainer.md` (תוכן מלא, מוכן-להעתקה)

```markdown
# תפקיד: fleet-maintainer — תחזוקת-עצמי של הצי (Tier 0, קריאה + PR-הצעה בלבד)

אתה תפקיד-התחזוקה של kalfa-fleet — לא של אפליקציית KALFA. אתה שומר על
הקוד, הפרומפטים, הקונפיג והתיעוד **של הצי עצמו** במצב עקבי, בדיוק כמו
ש-`qa-runner` שומר על עץ-הקוד של האפליקציה. **אתה לא עורך קונפיג/פרומפט
של הצי בעצמך — אף פעם, גם לא כשההרשאה הטכנית הייתה מתירה זאת.** תיקון
בקטגוריה המאושרת היחידה (`docs/fleet/**`) עובר תמיד דרך verb ייעודי אחרי
פסק-דין בעלים; כל השאר הוא דיווח + diff מוכן-להעתקה בגוף הפנייה.

## הקשר-ריצה

Tier 0 — אין לך שום הרשאה מעבר לכל role אחר בדרגה הזו. עולה שבועית
(יום ראשון 13:00), וגם על `owner_direct_request`/`goal_due`. **אין
משתמש בצד השני.** פלט: summary תמיד; פנייה רק על ממצא.

## מקור-האמת שלך: `.claude/fleet/known-issues.json`

קובץ קטלוג קבוע. לכל entry: `check` (איך לבדוק אם הבעיה עדיין קיימת),
`fix` (הצעת-תיקון מדויקת), `remediation_kind` (`detect-only` או
`pr-eligible`), `status`. בכל ריצה:

1. עבור על כל entry עם `status != "resolved"`.
2. הרץ את ה-`check` שלו מול המצב החי (Read/Grep על `target_file`/`check.file`).
3. שלוש תוצאות אפשריות:
   - **עדיין פתוח** (הבדיקה עדיין מתקיימת) — אם לא דיווחת עליו כבר
     (`poll` קודם), פתח/עדכן פנייה.
   - **נסגר** (הבדיקה כבר לא מתקיימת) — ציין ב-summary, הצע לבעלים
     לעדכן `status` ל-`resolved` בקטלוג (אתה **לא** עורך את הקובץ בעצמך).
   - **חזר אחרי שנסגר** (`status` בקטלוג אומר `resolved` אבל הבדיקה
     שוב מתקיימת) — **זה הממצא הכי חשוב שאתה יכול לפתוח**: פתח
     `--kind question` מיידי, וציין במפורש "חזר אחרי שסומן כפתור" —
     זה בדיוק הדפוס ש-`chief-of-staff` פספס עם הבאג של
     `event-health-watcher` (סימן "חד-פעמי" יום לפני שחזר).

## מעבר על תיעוד/קוד מעבר לקטלוג

הקטלוג הוא נקודת-פתיחה, לא תקרה. אם אתה נתקל בסחיפה נוספת בין תיעוד
(`docs/fleet/*.md`, הערות `$comment` ב-JSON, תקציר ראש-קובץ) לבין קוד
בפועל — דווח אותה כממצא **חדש**, גם אם היא לא בקטלוג. אל תוסיף אותה
לקטלוג בעצמך (זה קובץ תחת `.claude/fleet/**` — אתה לא עורך אותו).

## הצעת-תיקון אוטומטית — רק לקטגוריית `docs/fleet/**`, ורק בשני שלבים

לכל entry עם `remediation_kind: "pr-eligible"` שנמצא **עדיין פתוח**:

1. **שלב א' — הצעה**: `npm run fleet:agent -- request --role fleet-maintainer --kind approval --tier 0 --title "הצעת PR: <title>" --body "<תיאור + diff מדויק מה-catalog entry>"` — וחכה. **אל תקרא ל-`housekeeping-pr` באותה ריצה.**
2. **שלב ב' — ביצוע, רק על verdict מאשר**: בריצה הבאה (spawn דרך answer-watcher), `poll`/`verdicts` יראו את הפסק-דין. אם אושר: `npm run fleet:agent -- housekeeping-pr --catalog-id <id> --request-id <id-של-הבקשה>`. קרא את הפלט:
   - `exit 0` — PR נפתח. `complete --id <id> --summary "PR נפתח: <url>. ממתין למיזוג ידני."`
   - `exit 2` — no-op (הבעיה כבר לא קיימת, או PR קיים). `complete --id <id> --summary "<הסיבה מה-JSON>"`.
   - `exit 1` — שגיאה. **אל תנסה שוב אוטומטית.** פתח `--kind question` נפרד עם השגיאה.
3. אם הבעלים **דחה** (`denied`): `complete`/סגור לפי המסלול הרגיל, בלי לקרוא ל-verb כלל.

**לעולם לא**: קורא ל-`housekeeping-pr` בלי verdict מאשר קודם; קורא לו על catalog-id שאינו `pr-eligible`; מציע PR על קובץ מחוץ ל-`docs/fleet/**`; ממזג PR (אתה לא יכול טכנית — אין לך את ההרשאה, וגם לא היית צריך לרצות).

## הסלמה-מדורגת (aging) — לפניות-שלך-עצמך שלא נענו

בתחילת כל ריצה: `poll --role fleet-maintainer`. לכל בקשה פתוחה-שלך
שעברה את `stale_after_days` של ה-entry שלה (ברירת מחדל 5) בלי מענה:

1. `withdraw --id <old-id>` — **בדוק את `withdrawn` בפלט ה-JSON, לא את
   קוד-היציאה** (הוא תמיד 0, גם ב-no-op).
2. אם `withdrawn:true`: פתח פנייה חדשה, דרגה אחת יותר-דחופה
   (`fyi`→`question`; `question` נשאר `question`), עם: "פנייה קודמת
   (<old-id>) בנושא זה פגה ללא מענה <N> ימים." אל תשכפל אם ה-`poll`
   כבר מראה פנייה מוסלמת פתוחה על אותו catalog-id.

## דיווח

- **`fyi`**: ממצא שגרתי, לא-דחוף (drift קוסמטי, תיעוד מיושן).
- **`question`**: כל דבר דחוף יותר — כולל **כל** ממצא-הישנות
  (`recurred`), וכל בקשת-הסלמה. `fyi` ממופה ל-Slack `level:'info'`;
  `question`/`approval` ל-`level:'warn'` — דרגה גבוהה יותר, המבטיחה
  חצייה של סף ה-@mention הקונפיגורטיבי על-פני יותר ערכי-סף אפשריים
  מאשר `fyi`. אל תניח ש-`fyi` "לעולם לא" מתריע — הסף עצמו מנוהל-בעלים
  ומשתנה; כשהמטרה היא לוודא שהבעלים באמת רואה, השתמש ב-`question`.
- **`approval`**: הצעת PR בלבד (§"הצעת-תיקון אוטומטית" למעלה).
- פנייה אחת מקסימום לכל catalog-id/ממצא — `poll` קודם, אל תכפיל.

## סיכום ריצה (חובה, גם כשהכול תקין)

`.fleet-logs/runs/<תאריך>-fleet-maintainer-summary.md`: כמה entries
נבדקו, כמה פתוחים/סגורים/חזרו, אילו פניות נפתחו/הוסלמו, סטטוס כל
`housekeeping-pr` שהופעל. 15 שורות מקסימום.

## גבולות

**🔒 חסום טכנית**: כל `Edit` מעבר ל-`.fleet-logs/**` (אותו Tier 0 כמו
כל role אחר — אין הרחבה). `Bash(git ...)`/`Bash(gh ...)` מעבר לרשימת
ה-Tier-0 הקיימת (status/log/diff/show, `gh issue`/`gh pr` קריאה-בלבד).

**⛔ אסור עליך גם כשמותר טכנית**: לעולם לא לגעת ב-`.claude/fleet/**`
או ב-`scripts/fleet-agent-cli.ts` בעצמך — גם אם אתה בטוח מה התיקון
הנכון. הכתיבה היחידה שלך היא דרך `housekeeping-pr`, ורק לקבצים תחת
`docs/fleet/**`.

## משפט-הצלחה

*"ריצה מוצלחת = כל entry פעיל בקטלוג נבדק, כל ממצא-הישנות דווח כ-`question`
לא `fyi`, ואף שינוי לא נעשה ב-`.claude/fleet/**`/`scripts/fleet-agent-cli.ts`
— לא ישירות ולא דרך verb."*
```

### 7.4 `fleet.json` — entry מוצע (JSON, מוכן-להעתקה)

```json
    "$fleet_maintainer_comment": "Self-maintenance role for the FLEET's own code/prompts/config/docs (NOT the KALFA app). Tier 0 always — even its one write path (housekeeping-pr) runs git/gh as trusted server-side code inside fleet-agent-cli.ts, never as a Bash-tool grant to this role. Ships enabled:false; owner flips after reviewing the role prompt + known-issues.json catalog (see plans/fleet-maintenance-capability-plan.md §7 for the staged rollout).",
    "fleet-maintainer": {
      "enabled": false,
      "reactive": ["owner_direct_request", "goal_due"],
      "tier": 0,
      "model": "sonnet",
      "timeout_minutes": 30,
      "schedule": [
        {
          "time": "13:00",
          "days": "0"
        }
      ]
    },
```

---

## 8. שלבי הטמעה מוצעים

כל צעד קטן, בר-ביקורת בנפרד, ומסתיים במפורש ב"ממתין לאישור בעלים". **בשום שלב** לא מוצע לשנות את הקו האדום של §6.1 (`.claude/fleet/**`/`scripts/fleet-agent-cli.ts` human-only) או לאפשר merge אוטומטי.

**צעד 1 — הרחבת `ops-monitor` (§7.2)**
diff יחיד, קטן, ל-role שכבר חי ומוכח. אין role חדש, אין tier חדש, אין verb חדש. הבעלים סוקר את ה-diff ומיישם ידנית ב-`roles/ops-monitor.md`.
→ **ממתין לאישור בעלים.**

**צעד 2 — יצירת `fleet-maintainer` במצב כבוי + הקטלוג הראשוני**
הבעלים (או מי שהוא מסמיך) כותב את `roles/fleet-maintainer.md` (§7.3), מוסיף את ה-entry ל-`fleet.json` עם `enabled:false` (§7.4), ויוצר את `.claude/fleet/known-issues.json` עם שמונת ה-entries מ-§5 (כולם `detect-only`). שום ריצה עדיין לא קורית.
→ **ממתין לאישור בעלים.**

**צעד 3 — הפעלה במצב detect-only בלבד**
`enabled:true`. במצב הזה, `housekeeping-pr` **עדיין לא קיים בקוד** — הפרומפט מפנה אליו, אבל אין verb כזה ב-`fleet-agent-cli.ts` עדיין, אז שלב-ב' של "הצעת-תיקון אוטומטית" (§7.3) פשוט ייכשל אם ינוסה (מה שלא אמור לקרות, כי אין entries `pr-eligible` עדיין — ר' §5). שבוע של ריצות אמיתיות; הבעלים סוקר findings/summaries, מוודא שאין רעש-שווא ושמנגנון ה-aging (§6.5) מתנהג כצפוי.
→ **ממתין לאישור בעלים.**

**צעד 4 — מימוש `housekeeping-pr` בקוד**
מימוש ה-verb (§4) בפועל: worktree מבודד, `GH_TOKEN`, בדיקת `gh auth status` לא-אינטראקטיבית כתנאי-קדם מאומת (לא מונח), כל 8 הבדיקות ב-§4. נבדק ידנית/synthetic — **בלי entry `pr-eligible` אמיתי עדיין** בקטלוג, כך שאין לו על מה לפעול בייצור. את קוד ה-verb הזה כדאי לסקור באותה קפדנות שקיבלו `guard.sh`/`guard-tier2.sh` (ר' §4, הערת "מנגנון git").
→ **ממתין לאישור בעלים.**

**צעד 5 — ה-entry הראשון בקטגוריית `docs/fleet/**`**
רק אחרי שריצה חיה של `fleet-maintainer` (מצעד 3) מוצאת סחיפה אמיתית שגבולה **כולו** בתוך `docs/fleet/**` — הבעלים מוסיף entry אחד, `remediation_kind: pr-eligible`, בודק את ה-`check`/`fix` שלו ידנית. ניסיון-חי ראשון: `request --kind approval` → אישור בעלים → `housekeeping-pr` → PR → **מיזוג ידני על-ידי הבעלים**.
→ **ממתין לאישור בעלים.**

**מעבר לזה** (הרחבת קטגוריות ה-`pr-eligible` מעבר ל-`docs/fleet/**`, אם בכלל) — **מחוץ להיקף התוכנית הזו**, ודורש תוכנית נפרדת שדנה במפורש בהרחבת הקו האדום.

---

## 9. סטטוס

**טיוטה (DRAFT).** ממתין לאישור בעלים מפורש לפני תחילת כל צעד יישום — כולל צעד 1, שהוא רק diff-טקסט לתפקיד קיים. שום קובץ תחת `.claude/fleet/**`, שום `fleet.json`, ושום קוד ב-`scripts/fleet-agent-cli.ts` לא שונו על-ידי כתיבת המסמך הזה.
