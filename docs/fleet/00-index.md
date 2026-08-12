# KALFA Fleet — סקירה כללית ואינדקס (Overview & Index)

> מסמך זה נכתב מתוך קריאת קוד ולוגים בפועל (repo: `/var/www/vhosts/kalfa.me/beta`), נכון ל-2026-08-09.
> כל מזהה טכני (נתיבים, טבלאות, פקודות CLI, קוד) נשמר באנגלית.

## 1. מה זה kalfa-fleet

"kalfa-fleet" הוא צי בית-גידול (home-grown) של סוכני Claude Code אוטונומיים — **roles** — שרצים על גבי pm2 בזמנון (schedule) או באופן תגובתי (reactive), נפרד לחלוטין מה-subagents האינטראקטיביים המובנים של Claude Code שיושבים תחת `.claude/agents/`. כל הרצה כפופה לסולם הרשאות בן שלוש דרגות — Tier 0 (ברירת המחדל, טיוטה/דיווח-בלבד), Tier 1 (qa-runner, שערי QA), Tier 2 (ה-role היחיד, `main`, שמורשה לכתוב כנגד נתוני ייצור חיים). כל פעולה פריווילגית עוברת דרך **verb** ייעודי ב-CLI ותהליך אישור-בעלים (`fleet_requests`) — ולא דרך גישה גולמית לנתונים.

## 2. מסמכי הסדרה

| # | מסמך | תיאור |
|---|------|-------|
| 00 | `00-index.md` | מסמך זה — סקירה כללית ואינדקס |
| 01 | `01-architecture-and-orchestration.md` | מנוע התזמור: מתי role רץ ובאילו הרשאות — לולאת הזמנון (`scheduler.mjs`), שרשרת ההפעלה הבטוחה (`run-role.sh`), סולם ההרשאות בן שלוש הדרגות, ה-guard hooks שאוכפים אותו, ומנגנון ה-inbox/handoff |
| 02 | `02-roles-catalog.md` | קטלוג 16 הגדרות ה-role תחת `.claude/fleet/roles/*.md` — מטרת כל role, טריגר ההפעלה, מה הוא קורא, מה הוא כותב/עושה, guardrails, ותלויות בין roles |
| 03 | `03-cli-and-request-lifecycle.md` | משטח הפקודות של `scripts/fleet-agent-cli.ts` — הדרך היחידה שבה role כותב משהו או מדבר עם הבעלים; מחזור-החיים של `fleet_requests`, concurrency/locking, credentials, מוסכמת exit codes, ובדיקת טריות ה-bundle |
| 04 | `04-operational-status.md` | תצלום-מצב תפעולי חי — נגזר מקריאה חד-פעמית של הלוגים בפועל, לבדיקת הארכיטקטורה המתועדת מול מה שבאמת קרה |

## 3. התחל כאן

- רוצים להבין **מתי/איך** משהו רץ (זמנון, טריגרים תגובתיים, tiers, guard hooks, handoff) → `01-architecture-and-orchestration.md`.
- רוצים לדעת מה **role ספציפי** עושה (מה הוא קורא, מה הוא כותב, מה אסור לו) → `02-roles-catalog.md`.
- בונים משהו שצריך **לכתוב נתונים או לדבר עם הבעלים** → `03-cli-and-request-lifecycle.md` (ה-verbs, ה-guards שלהם, ומחזור-החיים של `fleet_requests`).
- רוצים לדעת את **מצב הבריאות התפעולי הנוכחי** → `04-operational-status.md` — אך שימו לב: זהו **תצלום-מצב נקודתי**, לא מצב חי (living state). לכל דבר עדכני יותר יש להריץ מחדש את בדיקת הלוגים המתוארת שם, לא לסמוך על המספרים הספציפיים בו.

## 4. עקרונות מפתח

- **טיוטה-בלבד כברירת מחדל** — Tier 0 (רוב ה-roles) יכול לדווח, לבקש ולכתוב טיוטות (`.fleet-logs/**`, `draft_reply`, `REVIEW.md` וכו') — אין לו כתיבת DB כללית ואין נתיב שליחה לאף ערוץ הודעות.
- **דלת צרה אחת אל הייצור** — `main` (Tier 2) הוא ה-role היחיד בכל הצי שיכול לכתוב כנגד ה-DB החי, ואך ורק דרך `supabase db query --linked` (רץ כ-`postgres`); שני מקורות הסמכות המתועדים שלו הם handoff שנענה או `fleet_goals` שהגיע זמנו (ולפי החיווט בפועל גם `owner_direct_request` — ראו סעיף 5) — לעולם לא ביוזמתו-שלו.
- **כל דבר פריווילגי עובר דרך verb שמור ב-CLI** — `scripts/fleet-agent-cli.ts` הוא הדרך היחידה לכתוב או לדבר עם הבעלים; כל verb (`request`, `handoff`, `complete`, `sql`, `draft-reply` וכו') הוא צר, שמור, ובעל guard משלו בצד השרת — לא "יכולת" גנרית שה-role מפעיל לפי שיקול דעתו.
- **אישור-בעלים דרך `fleet_requests` שוער כל מוטציה אמיתית** — הבעלים עונה אך ורק דרך `fleet_answer_request` (SECURITY DEFINER, admin-only); לדפדפן אין הרשאת UPDATE ישירה על הטבלה.
- **ה-guard hooks הם שכבת אכיפה שנייה מתחת לקובצי ההרשאה** — `guard.sh`/`guard-tier2.sh` פועלים על מחרוזת פקודת ה-Bash המלאה, fail-closed, ודחייה מהם לא ניתנת לעקיפה על-ידי כלל allow; הם משלימים את קובצי ה-JSON (`tier0/1/2.settings.json`) ולא מחליפים אותם — הכיסוי שלהם מוגבל לכלי `Bash` בלבד.
- **`dry_run` ו-KILLSWITCH הם מפסקי-חירום (circuit breakers)** — קובץ KILLSWITCH על הדיסק עוצר spawn חדש כלשהו כמעט מיידית; `dry_run: true` בקונפיג מדלג על spawn בפועל (עם הסתייגויות תיעודיות, ראו `01`).

## 5. ידוע כפתוח

רשימה מצומצמת — הפריטים העומדים בבסיס הכי הרבה עבור מי שמתכנן להרחיב או להפעיל את הצי. פירוט מלא בכל מסמך עצמו.

- **פער חיווט ב-`main`** — ה-`$main_comment` ב-`fleet.json:86` קובע ש-`main` מקבל spawn "רק" מ-answer-watcher, אך מערך ה-`reactive` שלו מחווט גם `owner_direct_request` (טריגר inquiry-watcher, ממתין-לא-נענה) — ש-`roles/main.md` לא מתעד כלל (`01`, סעיף 6).
- **`dev-engineer` ללא prompt** — מוגדר ב-`fleet.json` (Tier 1, מודל `fable`, `enabled:false`) אך אין קובץ `roles/dev-engineer.md`; בטוח היום רק כי מנוטרל וגם מכוון ל-worktree `beta-fleet` שלא קיים (`02`, סעיף 4).
- **מלכודת worktree `beta-fleet` עדיין חמושה** — כלל ה-`Edit` של tier1 לא תואם כלום כרגע, אך יצירת הספרייה על-ידי בן-אנוש תפעיל בשקט גישת-כתיבה מלאה לריפו, בלי שום שינוי הרשאות (`01`, סעיף 4).
- **תפיסת מסגרת `bac77347` (₪4) עדיין פתוחה 14 יום** אחרי אישור הבעלים — אין נתיב קוד לשחרור hold, ו-`main` לא רץ מאז 2026-07-31 כי הבקשה פגה ולא הפכה ל-verdict רשום (`04`, סעיף 1.2 — בדקו מחדש, זה תצלום-מצב).
- **כשל אימות חי ב-support-drafter (401 Invalid bearer token)** היה ההרצה האחרונה בכל הלוג בזמן הבדיקה, ללא retry עדיין (`04`, סעיף 1.1 — בדקו מחדש).

---

*מסמך זה הוא האינדקס של סדרת `docs/fleet/`. מנוע התזמור — `01-architecture-and-orchestration.md`; קטלוג 16 ה-roles — `02-roles-catalog.md`; ה-CLI ומחזור-חיי הבקשה — `03-cli-and-request-lifecycle.md`; מצב תפעולי חי — `04-operational-status.md`.*
