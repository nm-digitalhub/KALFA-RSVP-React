# תיקון לולאת ההפעלות של `social-manager`: תוכנית מוכנה ליישום

**תאריך:** 27.9.2026, בערך 15:40 IDT.
**סוג המסמך:** הצעה בלבד. לא שונה שום קוד, קונפיג, `fleet.json` או DB. לא בוצע restart ולא נענתה שום בקשה. כל ה-diffs נבנו והורצו בעותקים בתיקיית scratch בלבד.
**קודם לו:** `plans/social-manager-analysis-2026-09-27.md`. כל טענה שלו שנשענים עליה כאן אומתה מחדש מול הקוד, ותיקונים לה מופיעים ב-§1.3.
**סימון:** **MEASURED** פירושו שיש ראיה (קובץ:שורה, פלט או שאילתה). **INFERRED** פירושו הסקה.

---

## 0. תקציר

- **הסיבה:**
  - ה-validator של `publish-social` מסמן את "תמיד" גם בתוך "לא תמיד", ולכן הפוסט נכשל פעמיים והגיע לתקרת הניסיונות.
  - מאותו רגע אין לבקשה המאושרת `62dc162c` שום דרך חוקית לצאת מהתור.
  - ה-answer-watcher מפעיל את התפקיד מחדש כל 4–5 דקות, בלי תקרה לבקשה אחת, עד שהתקרה היומית המשותפת (50) נגמרת. אז הוא חוסם גם את כל שאר התפקידים עד חצות. **MEASURED**
- **מצב נוכחי:**
  - התקרה הגיעה ל-50 ב-15:20:12. מאז כל tick כותב "answer cap 50 reached — deferring".
  - הלולאה **תחזור ב-00:00**, והיא צפויה לרוץ עד בערך 03:45.
  - ה-slot של qa-runner ב-02:30 נמצא בתוך החלון הזה. **MEASURED** (לוג pm2, `locks/answer-20260927=50`, `fleet.json`)
- **מינימום לפני חצות (בלי קוד, פעולת בעלים אחת):** בלימה ממוקדת לבקשה הזו בלבד, דרך קובץ ה-marker שלה (§2, אפשרות A). החלופה היא `enabled:false` לתפקיד (§2, אפשרות B).
- **התיקון המלא:** חמש שכבות, 5 קבצי patch. כולם עוברים `git apply --check` על העץ הנוכחי, והטסטים עוברים (§3):
  - (א) ה-validator מתעלם מסופרלטיב שלילי.
  - (ב) verb חדש `abandon-publish`: יציאה חוקית, **בלי מיגרציה**.
  - (ג) תקרה לכל בקשה במתזמן, ותקרה לכל תפקיד עם `continue`.
  - (ד) יישור הוראות, והעברת סיבת ההפעלה לריצה.
  - (ה) verb `run-stats` ובדיקה ב-fleet-maintainer.
- **חשוב:** תיקון (א) לבד **לא** משחרר את `62dc162c`. בדיקת התקרה רצה לפני ה-validator (§1.2). השחרור נעשה דרך (ב), ואחריו בקשה חדשה `-r3` (§4).

---

## 1. אימות סיבת השורש

### 1.1 השרשרת, צעד אחר צעד

| # | שלב | קוד | ראיה |
|---|---|---|---|
| 1 | הבעלים אישר את `62dc162c` (`publish-20260913-batch-2-instagram-r2`) ב-11:56:56 IDT | — | `verdicts`: ‏`answered_at 08:56:56Z` **MEASURED** |
| 2 | `publish-social` תופס שורה ב-ledger **לפני** בדיקות הבטיחות (insert, ‏`attempt_count` מתחיל ב-1) | `scripts/fleet-agent-cli.ts:2175-2186`; ‏`20260810061515_fleet_social_posts.sql:35` (`default 1`) | קוד **MEASURED** |
| 3 | בדיקת grounding מסמנת "תמיד" | `fleet-agent-cli.ts:2317` → `publish-social.ts:167-172` → `:161-163`, ‏`SUPERLATIVE_WORDS` ב-**:126** | הרצה של הפונקציה על קובץ הכיתוב האמיתי מחזירה `superlative ("תמיד")` **MEASURED** |
| 4 | הסיבה: `includesHebrewWord` בודק רק גבול מילה. אין לו מושג של שלילה | `publish-social.ts:142-152` | שורה 3 בכיתוב: "אישור הגעה זה **לא תמיד** רק כן או לא" **MEASURED** |
| 5 | `markFailed` רושם `failed`, ניסיון חוזר מעלה ל-`attempt_count=2` | `fleet-agent-cli.ts:2258`, ‏`:2318-2320` | שורה `860f3c07`: ‏`failed`, ‏`attempt_count 2`, ‏`error="caption contains … superlative ("תמיד")…"` **MEASURED** |
| 6 | מעכשיו כל ניסיון נעצר ב-**:2212** (`retry_ceiling_reached`), **עוד לפני** ה-grounding ב-:2317 | `publish-social.ts:444` ‏(`PUBLISH_RETRY_CEILING=2`) | קוד **MEASURED** |
| 7 | `ack` נחסם כשמדובר ב-verdict מאושר של publish_social | `fleet-agent-cli.ts:938-962` (נקרא מ-`:965`) | ניסיון נדחה ב-13:40 (לפי הדו"ח הקודם) |
| 8 | `complete` **מותר** בקוד וב-DB, ואסור **רק** ב-prompt | `src/lib/fleet/complete.ts:37-41` (כולל `approved`); ‏`social-manager.md:160-163` | **MEASURED** |
| 9 | expire חל רק על `pending`; ‏`fleet_answer_request` מקבל רק `pending` | `src/lib/fleet/expire.ts:37`; ‏`20260723094500_fleet_requests.sql` (הודעה `request is not pending`) | **MEASURED** |
| 10 | `cmdVerdicts` מחזיר את הבקשה כל עוד `consumed_at IS NULL` | `fleet-agent-cli.ts:828-838` | `verdicts` ב-15:21: הבקשה היחידה בתור **MEASURED** |
| 11 | ה-answer-watcher: ה-marker הוא cooldown של 4 דק' **בלי מונה ניסיונות** | `.claude/fleet/bin/scheduler.mjs:264`, ‏`:327-331`; commit ‏`7465ab6` (31.8) | **MEASURED** |
| 12 | תקרה יומית אחת משותפת לכל התפקידים, ו-`break` מעצור את כולם | `scheduler.mjs:350-354` | לוג: 15:20:12 ו-15:21:12 ‏`answer cap 50 reached — deferring` **MEASURED** |

**מה ה-DB מתיר:** המעבר `approved → consumed` חוקי. זה נכון במיגרציה (`20260727000620_fleet_requests_completed_status.sql:112`) וגם בפונקציה החיה (`pg_proc`: ‏`has_consumed_edge=true`). **MEASURED** לכן שכבה (ב) **לא צריכה מיגרציה**.

### 1.2 הממצא החדש שמשנה את סדר העבודה

תיקון ה-validator **לא** משחרר את `62dc162c`.
- השורה ב-ledger כבר עומדת על `failed` עם `attempt_count=2`.
- בדיקת התקרה (`:2212`) רצה לפני ה-grounding (`:2317`), ולכן גם validator מתוקן יקבל `retry_ceiling_reached`. **MEASURED** (סדר הקוד)
- איפוס השורה ב-SQL עוקף את ה-audit, ולכן לא מומלץ.
- כלומר, מבחינת 62dc162c (א) היא מניעה לעתיד, ו-(ב) היא השחרור.

### 1.3 תיקונים לדו"ח הקודם

| טענה בדו"ח | מה נמדד עכשיו |
|---|---|
| "48 spawns, 39 ריצות" | הנתונים האלה היו צילום מצב של 15:11. **הסופי ליום:** 50 spawns של answer-watcher. מתוכם 45 ל-`62dc162c`, ‏3 ל-`0acf38d9`, אחד ל-`e6769c72` ואחד ל-content-seo-strategist. ב-`index.ndjson` ל-social-manager: ‏41 `started` ו-9 `skipped:lock`. **MEASURED** |
| "$22.99 היום" | $24.05 נכון ל-15:40 (סכום `cost_usd` ב-index). **MEASURED** |
| "`SUPERLATIVE_WORDS` ב-`publish-social.ts:124`" | השורה הנכונה היא **:126**. שורה 124 היא `PERCENT_PATTERN`. |
| §4.2 שם: תקרה של 3 **spawns** לכל verdict | חלש מדי: spawn שנדחה על ה-lock (9 היום) נספר כניסיון, ולכן verdict לגיטימי יכול להיתקע בזמן ריצה ארוכה של תפקיד אחר. בתיקון כאן סופרים **ריצות אמיתיות** (`.starts`, שנכתב אחרי ה-flock), ו-spawns משמשים רק כגיבוי (§3.ג). |
| §4.6 שם: "תקרה לכל תפקיד **בנוסף**" | החלפת `break` ב-`continue` **לבדה לא עושה כלום**. המונה `answer-<date>` אחד ומשותף, ולכן אחרי 50 כל verdict נכשל באותה בדיקה. רק מונה נפרד לכל תפקיד (`answer-<role>-<date>`), שנבדק **לפני** המונה הגלובלי, מונע את ההרעבה. |
| "complete על כישלון אסור" | אסור **רק** ב-prompt. הקוד (`complete.ts:37`) וה-DB מתירים אותו. הוא לא נבחר כיציאה כי הוא שולח לבעלים "✅ הושלם" על פרסום שלא קרה. |

### 1.4 רגישות: האם זה ייחודי ל-social-manager? **INFERRED** מהקוד

כל תפקיד שאינו `auto_ack` ויש לו verdict שהוא לא יכול או לא ירצה לצרוך ייכנס לאותה לולאה. זה כולל תפקיד שנכשל בריצה שוב ושוב.

לכן תיקון (ג) כללי, ולא ספציפי ל-publish_social.

---

## 2. בלימה לפני 00:00 (בלי קוד, פעולת בעלים)

ההשוואה נכונה ל-15:40. כרגע אין spawns עד חצות, כי התקרה מוצתה.

| | A: marker ממוקד (**מומלץ**) | B: ‏`enabled:false` |
|---|---|---|
| פעולה | לכתוב מספר epoch רחוק לקובץ `.fleet-logs/locks/verdict-62dc162c-7425-4801-9bf1-bf01901acec9`, למשל `99999999999999` | `"enabled": false` ל-`social-manager` ב-`.claude/fleet/fleet.json` |
| למה זה עובד | `scheduler.mjs:329-330`: ‏`Date.now() - last` שלילי, קטן מה-cooldown, ולכן `continue` לתמיד. זה נכון גם אחרי restart, כי ה-marker שמור בדיסק. **MEASURED** מהקוד, ובטסט `far-future legacy marker` על הקוד המוצע | `scheduler.mjs:301`: תפקיד מושבת מדולג; ‏`run-role.sh:101-105` |
| מה נשאר פעיל | כל השאר: ה-slot השבועי, טריגרים תגובתיים ו-verdicts אחרים של התפקיד | כלום, כל התפקיד כבוי |
| תאימות לתיקון (ג) | `parseVerdictMarker` קורא מספר חשוף כ-marker ישן, והוא נשאר מדולג (טסט) | לא רלוונטי |
| ביטול | מחיקת הקובץ | `true` |
| סיכון | ריצת social-manager מסיבה אחרת (פנייה ישירה) תראה את הבקשה ב-poll ותנסה publish-social שוב. זה ייכשל על התקרה, בעלות של ריצה אחת, בלי לולאה | אובדן פניות ישירות לתפקיד עד שמחזירים |

- **מאשר:** הבעלים. הכתיבה היא ל-`.fleet-logs/locks`. זה לא קוד, אבל זה משנה התנהגות של הצי.
- **אימות אחרי 00:00:** ב-`~/.pm2/logs/kalfa-fleet-out.log` לא אמורה להופיע שורת `spawning social-manager to consume "🔴 פרסום בפועל: אינסטגרם — ההערה הקטנה…"`, ו-`locks/answer-20260928` צריך להישאר 0 או קטן.

---

## 3. התיקון המלא: חמש שכבות

הקבצים ב-§נספח, לפי סדר. **תלויות:**
- 1-A, ‏3-C ו-4-D עומדים כל אחד בפני עצמו (`git apply --check` עבר על כל אחד לבד).
- 2-B דורש את 1-A.
- 5-E דורש את 2-B (אותו קובץ CLI).
- הרצה ברצף של 1 עד 5 בעותק scratch שיחזרה את כל קבצי היעד byte-for-byte. **MEASURED**

**איזו שכבה עוצרת את הלולאה באופן כללי:** (ג).
- (ב) מכסה רק verdict שהגיע לתקרת הניסיונות.
- בקשת publish_social יכולה להיכשל גם **לפני** שנפתחת לה שורה ב-ledger. דוגמאות: payload לא תקין, או בקשה ישנה בלי sha256. במקרה כזה אין שורת ledger, ו-`abandon-publish` מסרב, וזה נכון.
- את המקרה הזה, וכל verdict תקוע של כל תפקיד, עוצרת רק (ג).
- לכן (ג) היא התיקון הכללי, ו-(ב) היא היציאה הנקייה למקרה של היום.

### (א) ה-validator: שלילה אינה סופרלטיב (`1-A-validator.patch`)

- **השינוי:**
  - `NEGATED_BEFORE = /(?:^|[^א-ת])[וש]?לא[\s־-]+$/`.
  - `includesHebrewWord(..., { skipNegated })` מדלג על מופע שלילי **וממשיך לסרוק**, כדי שגם מופע לא-שלילי בהמשך הכיתוב ייתפס.
  - הפטור חל על סופרלטיבים בלבד. "לא בחינם" עדיין נתפס כטענת "חינם".
  - "הלא תמיד" (שאלה רטורית שמאשרת) ו"לא רק הכי" (המילה שלפני "הכי" היא "רק") נשארים חיוביים.
- **טסטים חדשים** (`publish-social.test.ts`, 5 בלוקים):
  - **נכשלים לפני התיקון:** "לא תמיד / לא הכי / לא בטוח / ולא / שלא / לא־תמיד", והשורה המדויקת של `62dc162c`.
  - **עוברים גם לפני וגם אחרי (שומרי רגרסיה):** "לא תמיד… אבל אנחנו תמיד כאן", "הלא תמיד", "לא רק הכי", "לא בחינם".
- **הרצה** (vitest בעותק scratch):
  - לפני התיקון: `8 failed | 66 passed`. אלה 2 טסטים של (א) ו-6 של (ב).
  - אחרי התיקון: `74 passed`. **MEASURED**
- **כל הכיתובים שנכתבו אי פעם** (`.fleet-logs/drafts/social/*/*caption*`):
  - validator נוכחי: פגיעה אחת בלבד, `20260913-batch/post-2`.
  - validator מתוקן: אפס.
  - אין שינוי בשום כיתוב אחר. **MEASURED** (אבל במאגר אין אף true-positive, כך שהוא לא מוכיח שהגילוי האמיתי נשמר. זה מה שהטסטים עושים.)
- **סיכון:** נמוך. הבדיקה הזו היא רשת מכנית בלבד. brand-director עדיין בודק תוכן.
- **ביטול:** `git revert`.
- **פריסה:** `npm run fleet-agent:build` (הבנדל `dist/fleet-agent-cli.cjs`). אין צורך ב-restart.

### (ב) יציאה חוקית: ‏`abandon-publish` (`2-B-abandon-publish.patch`)

- **למה verb ייעודי ולא ריכוך של `ack`:**
  - הלקח מה-ack-trap ("לעולם לא ack על publish_social מאושר", `social-manager.md:205-208`) נשאר **בלי חריג**.
  - ה-verb מתעד את הסיבה.
  - ה-consume קופא את `answer` (`guard :112-118`), ולכן הסיבה לא יכולה לשבת על השורה עצמה.
- **תנאי כשירות** (`decideAbandonPublish`, פונקציה טהורה ב-`publish-social.ts`):
  - הבקשה עוברת את `validatePublishRequestRow`: ‏social-manager, ‏approval, ‏approved.
  - `payload.action=publish_social`.
  - לפלטפורמה **המאושרת** יש שורת ledger במצב `failed` עם `attempt_count >= PUBLISH_RETRY_CEILING`.
  - אם אין שורת ledger (כלומר אף ניסיון לא נעשה, בדיוק הצורה של ה-ack-trap), הבקשה **נדחית**.
- **סדר הפעולות:**
  1. פותח שאלה לבעלים עם `request_key = abandon-<request_key המקורי>`. זה אידמפוטנטי דרך `fleet_requests_request_key_unique`, ו-`thread_root` מקשר לבקשה המקורית.
  2. `fleet_consume_request` (approved→consumed).
  3. הודעת Slack בשרשור.
  - אם הריצה קורסת בין 1 ל-2, נשארת שאלה מיותרת ו-verdict שעדיין approved. בטוח להריץ שוב.
- **טסטים** (`decideAbandonPublish`, 6 טסטים):
  - מותר רק ב-failed בתקרה.
  - נדחה כשאין ניסיון, כשמתחת לתקרה, וכשהסטטוס published / publishing / dry_run.
  - בודק רק את הפלטפורמה המאושרת.
  - נדחה כש-payload אינו publish_social.
  - כולם נכשלים לפני ועוברים אחרי (ראו (א)). **MEASURED**
- **type-check:** ‏`tsc` (אותן אפשרויות strict כמו ב-tsconfig של הפרויקט) על ה-CLI המתוקן יחד עם המודולים המתוקנים: **exit 0**. **MEASURED**
- **lint:** ‏`eslint --stdin` לכל קובץ TS: נקי. **MEASURED**
- **מיגרציה:** **לא נדרשת.** המעבר קיים ב-DB החי (§1.1).
- **סיכון:** בינוני-נמוך.
  - זה פותח דלת נוספת למצב `consumed`.
  - מה שמגן: תנאי ה-ledger, ובדיקת בעלות (`--role`).
- **ביטול:** `git revert`, ואז build.
- **פריסה:** `npm run fleet-agent:build`.
- **מאשר:** הבעלים. זה מרכך הגנה שהבעלים ביקש במפורש.

### (ג) הגנה במתזמן (`3-C-scheduler.patch`)

מודול חדש, `.claude/fleet/bin/verdict-guard.mjs`:
- טהור, בלי תלויות, ו-`scheduler.mjs` מייבא אותו. את `scheduler.mjs` עצמו אי אפשר לייבא לטסט, כי הוא מריץ `setInterval` בזמן הטעינה.
- **תקרה לכל verdict בשני מונים:**
  - `VERDICT_MAX_STARTS=3`: ריצות אמיתיות. `run-role.sh` מוסיף בית אחד ל-`locks/verdict-<id>.starts` **אחרי** ה-flock.
  - `VERDICT_MAX_SPAWNS=12`: כל ה-spawns, כולל דחיות lock. זה גיבוי בלבד.
  - כך דחיות lock לבדן לא "יתקעו" verdict לגיטימי.
- **כשמגיעים לתקרה:**
  - שורת `stranded_verdict` ב-index ושורת לוג.
  - בקשת **fyi אחת** לבעלים דרך ה-CLI, עם `--request-key stranded-verdict-<id>` ‏(DB-unique) ו-`--related-to <id>`.
  - ה-marker מסומן `stranded` ו-`escalated`. אם שליחת ה-fyi נכשלה, היא תנוסה שוב ב-tick הבא בלי כפילות.
- **תקרה לכל תפקיד** `answer_role_daily_cap` (ברירת מחדל 10, מונה `answer-<role>-<date>`):
  - נבדקת **לפני** התקרה הגלובלית, ועושה `continue`.
  - ה-`break` הגלובלי נשאר כגיבוי.
- **spawn אחד לכל תפקיד ב-tick:** הריצה מטפלת בכל ה-verdicts של התפקיד דרך `poll`.
- `indexLine` לכל spawn של verdict (`verdict_spawn`, `spawn`, `starts`).
- סיבת ההפעלה מועברת ל-`run-role.sh` בכל שלושת המסלולים: `slot`, ‏`reactive:<trigger>`, ‏`verdict:<id>`.
- **תאימות לאחור:** marker ישן (מספר חשוף) נקרא כ-spawn אחד. marker פגום נקרא כ-verdict חדש.

**טסטים:** `node --test` (לפי התקדים של `test:scraper`). נוסף הסקריפט `npm run test:fleet-scheduler`.
- 11 טסטים עוברים. **MEASURED**
- הם כוללים: legacy, corrupt, round-trip, cooldown, marker עתידי, "דחיות lock לא תוקעות", תקיעה אחרי 3 ריצות ואחרי 12 spawns, escalate חד-פעמי, ותקציב לתפקיד.

**Harness אינטגרציה** (scheduler אמיתי, CLI ו-run-role מדומים, cooldown=0, 9 ticks). **MEASURED**
- verdict תקוע: 3 ריצות, ואז `STRANDED` ו-fyi אחד, בלי spawns נוספים.
- verdict שני של אותו תפקיד חיכה ל-tick הבא, כלומר spawn אחד לתפקיד ב-tick.
- תפקיד אחר המשיך לקבל spawns במקביל.
- תרחיש שני, `answer-social-manager=10`: ‏social-manager נדחה עם `continue`, ו-content-seo-strategist קיבל spawn. marker ישן `1790000000000` נקרא כ-`spawn 2/12`.

- **סיכון:** נמוך.
  - החשש: verdict לגיטימי שנכשל 3 פעמים ייעצר. אבל אז יש fyi לבעלים.
  - **הפעלה מחדש:** מחיקת `locks/verdict-<id>*`.
- **ביטול:** `git revert`, ואז `pm2 restart kalfa-fleet`. אין מצב ב-DB.
- **פריסה:** `pm2 restart kalfa-fleet` (הבעלים. ה-scheduler נטען רק בעלייה).

### (ד) יישור הוראות וסיבת הפעלה (`4-D-instructions.patch`)

- **`run-role.sh`:**
  - ארגומנט שני `reason`, עם allowlist ב-regex: `slot|manual|reactive:[a-z_]+|verdict:<uuid>`. כל ערך אחר הופך ל-`unknown`.
  - נבדק על `x;rm` ועל `verdict:../../etc`: שניהם הפכו ל-`unknown`. **MEASURED**
  - כתיבת `.starts` אחרי ה-flock.
  - שורות `started` ו-`skipped:lock` נבנות עם `jq -cn --arg`, לא באינטרפולציה (אותו לקח כמו `run-role.sh:57-62`).
  - `bash -n` עבר. **MEASURED**
- **`run-context.sh`:**
  - מציג "סיבת ההפעלה" תחת "הקשר ריצה".
  - למסלול verdict: "זו לא תקלת cron, לכל היותר 3 הפעלות".
  - **חריג מפורש** לכלל ה-ack בשורות 70-77: ‏verdict מאושר של publish_social נסגר בכלים שה-prompt של התפקיד מגדיר, וה-prompt של התפקיד גובר. זה פותר את הסתירה מול `social-manager.md:205-208`.
- **`social-manager.md`:**
  - :42: שלושה מסלולי הפעלה; "30 דק'" היא תקרת זמן ולא חלון.
  - :160-168: שלב סופי `abandon-publish` אחרי `retry_ceiling_reached`, ובלי fyi או question משלו (השאלה שה-verb פותח היא ההסלמה). השחרור הוא בקשה חדשה `-r<N+1>`.
  - משפט-ההצלחה עודכן ל-HTML ו-PNG.
  - לקח ה-ack-trap: הרצף `publish-social`, ואז `complete` או `abandon-publish`.
- **לא כלול במכוון:** הסתירה של `PUBLISHED.md` לכל אצווה מול לכל פוסט (§2.2.1 בדו"ח הקודם). היא לא חלק מהלולאה, והיא דורשת החלטה נפרדת.
- **סיכון:** נמוך.
  - `run-context.sh` משותף לכל התפקידים, אבל החריג מנוסח כתלוי ב-prompt של התפקיד, ולכן תפקידים אחרים לא מושפעים.
- **פריסה:** אין. נקרא בכל ריצה. לשים לב: `run-role.sh` עם ארגומנט שני עובד רק אחרי (ג) (או כשמריצים ידנית); בלי (ג) ברירת המחדל היא `manual`.

### (ה) fleet-maintainer: ספירת ריצות (`5-E-maintainer.patch`)

- **`src/lib/fleet/run-stats.ts` (טהור):**
  - `aggregateRunIndex` סופר לכל תפקיד ולכל יום (לפי שעון Asia/Jerusalem, כי ה-scheduler כותב ב-UTC ו-run-role בשעון מקומי): `started`, ‏`lockSkipped`, ‏`verdictStarts` ו-`stranded`.
  - שורה פגומה מדולגת, לא קורסת.
  - `findRunaways` מחזיר ימים עם `started+lockSkipped > N`, או עם `stranded > 0`.
- **verb `run-stats --range 1d|7d|30d --max-per-day N`:** קריאה בלבד.
- **`fleet-maintainer.md`:** סעיף חדש. בכל ריצה: ‏`run-stats --range 7d`. על כל חריגה: `question` עם `request-key runaway-<role>-<date>`, ובלי כפילות.
  - נכתב במפורש שהוא **לא** קו ההגנה הראשון, כי הוא רץ פעם בשבוע.
- **טסטים:** 7, כולם עוברים. **MEASURED**
- **הרצה על ה-index האמיתי (30 יום), תקרה 10:**
  - social-manager ב-27.9: ‏`started 41, lockSkipped 9`.
  - support-drafter ב-1.9: ‏`started 15`. זה יום reactive מוכר.
  - אם זה רעש, אפשר להעלות את `--max-per-day` ל-15. **MEASURED**
- **פריסה:** build ל-CLI.

---

## 4. איך משחררים את `62dc162c`

**מומלץ:** אחרי פריסת (ב) (עדיף יחד עם (ד)), ריצה אחת של social-manager (למשל ה-spawn הבא על ה-verdict) מריצה:

```
npm run fleet:agent -- abandon-publish --id 62dc162c-7425-4801-9bf1-bf01901acec9 --role social-manager --reason-file .fleet-logs/drafts/<YYYYMMDD>/abandon-62dc162c.txt
```

- ה-verb מאמת את ה-ledger (`860f3c07`: ‏failed, ‏2 ≥ 2), פותח שאלה `abandon-publish-20260913-batch-2-instagram-r2` וצורך את הבקשה.
- אם הבעלים רוצה לפרסם: עונה על השאלה. בריצה הבאה נפתחת בקשה חדשה `publish-20260913-batch-2-instagram-r3`, עם אותו כיתוב (אחרי (א) הוא עובר) או עם `facts_source`. הבעלים מאשר אותה מחדש.
- **למה לא לפרסם מחדש תחת `62dc162c`:** ה-ledger בתקרה (§1.2). ה-payload קפוא. מפתח בקשה ייחודי לתמיד.
- **למה לא SQL ידני, `complete` או `fleet_consume_request` ישיר:**
  - SQL ידני ו-`fleet_consume_request` ישיר עוקפים את ה-audit ואת ההגנה.
  - `complete` מדווח "✅ הושלם" על פרסום שלא קרה, בדיוק הבאג שה-prompt אוסר.
- **ניקוי שכדאי לעשות באותה הזדמנות** (החלטת בעלים):
  - `5bb80831`: השאלה "פרסום נכשל שוב". השאלה החדשה מחליפה אותה, ולכן לענות עליה או לתת לה לפוג.
  - `c5098e27`: ה-fyi עם האבחנה "cron / 61", שהיא שגויה.
  - `ac94a5ab`: אצוות אישור כפולה.
  - אם בחרתם בבלימה A: למחוק את ה-marker **אחרי** שהבקשה נצרכה. לפני זה אין בזה צורך, כי verdict שנצרך לא חוזר ל-`verdicts`.

---

## 5. סדר יישום, סיכונים, ביטול ואימות

| שלב | מה | פריסה (בעלים) | אימות | ביטול |
|---|---|---|---|---|
| 0 (היום, לפני 00:00) | בלימה A (או B) | כתיבת קובץ, או שינוי `fleet.json` | אחרי 00:00: אין spawn ל-62dc162c בלוג | מחיקת הקובץ, או `true` |
| 1 | 1-A + 2-B | `npm run fleet-agent:build` | `npx vitest run src/lib/fleet/publish-social.test.ts`; ‏`abandon-publish` על 62dc162c מחזיר `abandoned:true` ושאלה חדשה ב-/admin/fleet | revert, ואז build |
| 2 | 3-C + 4-D | `pm2 restart kalfa-fleet` (אחרי merge) | `npm run test:fleet-scheduler`; ב-index מופיעות שורות `verdict_spawn` ו-`reason`; ‏"סיבת ההפעלה" ב-prompt של הריצה (`runs/<stamp>-<role>.json`) | revert, ואז restart |
| 3 | 5-E | build | `npm run fleet:agent -- run-stats --range 7d` מחזיר את 27.9 ב-`runaways` | revert, ואז build |
| 4 | שחרור 62dc162c (§4) | ריצת התפקיד | `verdicts` ריק מ-62dc162c; מופיעה שאלת abandon | אין (consume הוא סופי, וזה המכוון) |
| בכל שלב | Definition of Done | — | `npm run lint`, ‏`npx tsc --noEmit`, ‏`npm run build` מלאים. **לא הורצו כאן**, כי אסור לגעת בעץ ולפי הזיכרון אסור build במקביל. הורץ רק מה שמפורט למטה | — |

- **מינימום שמספיק לפני חצות:** שלב 0 בלבד. אחריו, השלבים 1 עד 4 לפי הסדר, וכל אחד דורש אישור.
- **אם רוצים קוד מהר:** 3-C לבד, ואז restart. זה עוצר את הלולאה אחרי 3 ריצות ופותח fyi, גם בלי (ב).

**שער הפריסה של שינויי ה-CLI הוא המיזוג לעץ, לא ה-build.**
- `package.json:50` מגדיר `fleet:agent` כ-`esbuild … --outfile=dist/fleet-agent-cli.cjs && node …`. כל קריאה של תפקיד ל-`npm run fleet:agent -- …` בונה מחדש את הבנדל המשותף מתוך העץ. **MEASURED**
- לכן 1-A, ‏2-B ו-5-E נכנסים לתוקף בריצת התפקיד הראשונה אחרי שהם בעץ.
- `npm run deploy` (`package.json:14`) כבר כולל `fleet-agent:build` ו-`pm2 restart kalfa-fleet`, ולכן deploy רגיל פורס את כל השכבות, כולל 3-C.

**הערות זהירות:**
- לא לפרוס באמצע ריצת fleet: `pm2 restart kalfa-fleet` אינו הורג ילדים detached, אבל לפי הזיכרון, לא לשנות את העץ באמצע deploy.
- **dependency בין שכבות:** 2-B ו-5-E משנים את אותו קובץ CLI; ליישם לפי הסדר.
- **`--related-to`** בשאלות שה-verb ו-ה-scheduler פותחים משמש לקישור בלבד. אין לו השפעה על מצב.

---

## 6. מה הורץ בפועל כדי לבסס את התוכנית

| בדיקה | תוצאה |
|---|---|
| שחזור ה-false-positive: הפונקציה הנוכחית על `post-2-caption-instagram.txt` | `superlative ("תמיד")` |
| vitest על `publish-social.test.ts`, בקוד המקורי ובקוד המתוקן | 8 נכשלים לפני, 74/74 עוברים אחרי |
| vitest על `run-stats.test.ts` | 7/7 |
| `node --test verdict-guard.test.mjs` | 11/11 |
| harness של ה-scheduler (2 תרחישים) | §3.ג |
| `tsc` (strict) על ה-CLI המתוקן + המודולים | exit 0 |
| `eslint --stdin` על 5 קבצי TS | נקי |
| `bash -n` על `run-role.sh` / `run-context.sh`, ‏`node --check` על `scheduler.mjs` | תקין |
| `git apply --check` לכל patch על העץ הנוכחי (1-A, 3-C, 4-D לבד; הרצה ברצף 1→5 בעותק) | תקין; התוצאה זהה byte-for-byte לקבצי היעד |
| הפונקציה החיה `fleet_requests_guard` | המעברים `consumed` ו-`completed` קיימים |
| `fleet_social_posts` ל-62dc162c | `860f3c07`, ‏instagram, ‏failed, ‏2 |

**מגבלות:**
- `npm run lint`, ‏`npx tsc --noEmit` ו-`npm run build` על כל הפרויקט **לא** הורצו, כי אסור לשנות את העץ.
- `abandon-publish` לא הורץ מול DB.
- ה-harness מדמה את ה-CLI.
- ה-patch של `package.json` נבנה מול העץ הנוכחי, שבו כבר יש שינוי שלא נעשה לו commit. אם השינוי ההוא ישתנה, יש לבנות את ה-patch מחדש.

---

## נספח: ה-patches (unified diff, להחלה מה-root של `beta/` לפי הסדר)

### `1-A-validator.patch`

````diff
--- a/src/lib/fleet/publish-social.ts
+++ b/src/lib/fleet/publish-social.ts
@@ -139,14 +139,34 @@
 // brand-director's editorial review (see the comment above).
 const HEBREW_LETTER = /[א-ת]/;
 
-function includesHebrewWord(text: string, word: string): boolean {
+// A superlative directly preceded by a standalone negation is the OPPOSITE of
+// a claim: "אישור הגעה זה לא תמיד רק כן או לא" ("an RSVP is not always just
+// yes or no") promises nothing. Measured live 2026-09-27: exactly that line
+// failed publish-social twice (request 62dc162c), reached
+// PUBLISH_RETRY_CEILING, and left an approved verdict the role could not
+// consume — the answer-watcher then re-spawned it ~45 times in one day.
+// Only "לא" as its own word counts, optionally with the conjunction prefixes
+// ו/ש ("ולא", "שלא"), separated by whitespace or a maqaf/hyphen. "הלא תמיד"
+// ("isn't it always") is rhetorical AFFIRMATION and stays a hit, and so does
+// "לא רק הכי" — the word right before "הכי" there is "רק", not "לא".
+const NEGATED_BEFORE = /(?:^|[^א-ת])[וש]?לא[\s\u05BE-]+$/;
+
+function includesHebrewWord(
+  text: string,
+  word: string,
+  options: { skipNegated?: boolean } = {},
+): boolean {
   let from = 0;
   for (;;) {
     const at = text.indexOf(word, from);
     if (at === -1) return false;
     const before = at > 0 ? text[at - 1] : '';
     const after = at + word.length < text.length ? text[at + word.length] : '';
-    if (!HEBREW_LETTER.test(before) && !HEBREW_LETTER.test(after)) return true;
+    if (!HEBREW_LETTER.test(before) && !HEBREW_LETTER.test(after)) {
+      // Keep scanning past a negated hit: "לא תמיד קל, אבל אנחנו תמיד כאן"
+      // must still be caught on its second, un-negated occurrence.
+      if (!(options.skipNegated && NEGATED_BEFORE.test(text.slice(0, at)))) return true;
+    }
     from = at + 1;
   }
 }
@@ -158,8 +178,10 @@
   for (const word of FREE_WORDS) {
     if (includesHebrewWord(caption, word)) matches.push(`free-claim ("${word}")`);
   }
+  // Negation exemption is for superlatives only, deliberately: "לא חינם" is
+  // left to the free-claim check and to brand-director, not reasoned about here.
   for (const word of SUPERLATIVE_WORDS) {
-    if (includesHebrewWord(caption, word)) matches.push(`superlative ("${word}")`);
+    if (includesHebrewWord(caption, word, { skipNegated: true })) matches.push(`superlative ("${word}")`);
   }
   return matches;
 }
--- a/src/lib/fleet/publish-social.test.ts
+++ b/src/lib/fleet/publish-social.test.ts
@@ -190,6 +190,44 @@
     );
   });
 
+  // Live incident 2026-09-27 (request 62dc162c): a NEGATED superlative was
+  // treated as a promise, the post failed twice, hit the retry ceiling, and
+  // the approved verdict could never be consumed.
+  it('does not treat a negated superlative as a claim', () => {
+    expect(scanGroundingClaims('אישור הגעה זה לא תמיד רק כן או לא')).toEqual([]);
+    expect(scanGroundingClaims('זה לא הכי מסובך')).toEqual([]);
+    expect(scanGroundingClaims('לא בטוח שתזכרו את כולם')).toEqual([]);
+    expect(scanGroundingClaims('ולא תמיד יש זמן לזה')).toEqual([]);
+    expect(scanGroundingClaims('דברים שלא תמיד נאמרים')).toEqual([]);
+    expect(scanGroundingClaims('זה לא־תמיד פשוט')).toEqual([]);
+  });
+
+  it('passes the exact caption line that failed request 62dc162c', () => {
+    expect(
+      validateGrounding(
+        'אישור הגעה זה לא תמיד רק כן או לא. לפעמים יש לאורח פרט קטן שממש משנה את הערב שלו',
+        undefined,
+      ),
+    ).toBeNull();
+  });
+
+  it('still flags an un-negated superlative later in the same caption', () => {
+    expect(scanGroundingClaims('זה לא תמיד קל, אבל אנחנו תמיד כאן')).toEqual([
+      expect.stringContaining('superlative ("תמיד")'),
+    ]);
+  });
+
+  it('keeps rhetorical "הלא" and "לא רק הכי" as claims', () => {
+    expect(scanGroundingClaims('הלא תמיד אמרנו את זה')).toEqual([
+      expect.stringContaining('superlative ("תמיד")'),
+    ]);
+    expect(scanGroundingClaims('לא רק הכי זול')).toEqual([expect.stringContaining('superlative ("הכי")')]);
+  });
+
+  it('does not extend the negation exemption to free-claims', () => {
+    expect(scanGroundingClaims('לא בחינם')).toEqual([expect.stringContaining('free-claim')]);
+  });
+
   it('requires facts_source when a claim is found', () => {
     expect(validateGrounding('המחיר 200 ₪', undefined)).toMatch(/facts_source/);
     expect(validateGrounding('המחיר 200 ₪', '')).toMatch(/facts_source/);
````

### `2-B-abandon-publish.patch`

````diff
--- a/src/lib/fleet/publish-social.ts
+++ b/src/lib/fleet/publish-social.ts
@@ -469,6 +469,58 @@
   return attemptCount >= PUBLISH_RETRY_CEILING;
 }
 
+// The ONE legal way out for an approved publish_social verdict that can never
+// be published (measured 2026-09-27, request 62dc162c): publish-social refuses
+// past the ceiling, `ack` is refused by design (the ack-trap), and `complete`
+// would report a success that never happened. Without an exit the verdict
+// stays approved+unconsumed forever and the scheduler keeps re-spawning the
+// role for it. Eligible ONLY when the ledger itself proves the automatic
+// path is exhausted — never on the role's say-so, never before a real
+// attempt: an approved verdict with no ledger row is exactly the ack-trap
+// shape (consumed with nothing ever tried) and stays refused.
+export type AbandonLedgerRow = {
+  id: string;
+  platform: string;
+  status: string;
+  attempt_count: number;
+  error: string | null;
+};
+
+export type AbandonDecision =
+  | { ok: true; platform: Platform; row: AbandonLedgerRow }
+  | { ok: false; reason: string };
+
+export function decideAbandonPublish(payload: unknown, ledgerRows: readonly AbandonLedgerRow[]): AbandonDecision {
+  const record =
+    payload && typeof payload === 'object' && !Array.isArray(payload)
+      ? (payload as Record<string, unknown>)
+      : {};
+  if (record.action !== 'publish_social') {
+    return { ok: false, reason: 'not a publish_social request — use the regular verdict flow' };
+  }
+  const platform = typeof record.platform === 'string' ? record.platform : '';
+  if (!isPlatform(platform)) {
+    return { ok: false, reason: `payload.platform "${platform}" is not a supported platform` };
+  }
+  const row = ledgerRows.find((r) => r.platform === platform);
+  if (!row) {
+    return {
+      ok: false,
+      reason: 'no publish attempt is recorded for this request — run publish-social first (abandon is only for an exhausted retry ceiling)',
+    };
+  }
+  if (row.status !== 'failed') {
+    return { ok: false, reason: `ledger status is "${row.status}", not "failed" — nothing to abandon` };
+  }
+  if (!isRetryCeilingReached(row.attempt_count)) {
+    return {
+      ok: false,
+      reason: `attempt_count=${row.attempt_count} is below the ceiling (${PUBLISH_RETRY_CEILING}) — retry publish-social first`,
+    };
+  }
+  return { ok: true, platform, row };
+}
+
 // Critical lesson from a live incident (2026-08-12): a Graph API id field
 // read via `Number(...)` (or a JSON schema typed `number`) silently loses
 // precision — Instagram container/media ids are commonly 17-digit numbers,
--- a/src/lib/fleet/publish-social.test.ts
+++ b/src/lib/fleet/publish-social.test.ts
@@ -7,6 +7,7 @@
   buildInstagramPublishPlan,
   checkReviewApproved,
   classifyGraphApiError,
+  decideAbandonPublish,
   decideContainerPoll,
   decideExistingRow,
   deriveDryRunArtifactPath,
@@ -413,6 +414,48 @@
   });
 });
 
+describe('decideAbandonPublish', () => {
+  const payload = { action: 'publish_social', platform: 'instagram' };
+  const failedAtCeiling = {
+    id: 'row-1',
+    platform: 'instagram',
+    status: 'failed',
+    attempt_count: PUBLISH_RETRY_CEILING,
+    error: 'caption contains a price/promise pattern',
+  };
+
+  it('allows abandoning only a failed row at the retry ceiling', () => {
+    const decision = decideAbandonPublish(payload, [failedAtCeiling]);
+    expect(decision).toEqual({ ok: true, platform: 'instagram', row: failedAtCeiling });
+  });
+
+  it('refuses when no attempt was ever made (the ack-trap shape)', () => {
+    const decision = decideAbandonPublish(payload, []);
+    expect(decision.ok).toBe(false);
+  });
+
+  it('refuses below the ceiling', () => {
+    const decision = decideAbandonPublish(payload, [{ ...failedAtCeiling, attempt_count: 1 }]);
+    expect(decision).toMatchObject({ ok: false, reason: expect.stringContaining('retry publish-social first') });
+  });
+
+  it('refuses a published, publishing or dry_run row', () => {
+    for (const status of ['published', 'publishing', 'dry_run']) {
+      expect(decideAbandonPublish(payload, [{ ...failedAtCeiling, status }]).ok).toBe(false);
+    }
+  });
+
+  it('only looks at the ledger row for the approved platform', () => {
+    const facebookRow = { ...failedAtCeiling, platform: 'facebook' };
+    expect(decideAbandonPublish(payload, [facebookRow]).ok).toBe(false);
+  });
+
+  it('refuses a non-publish_social payload', () => {
+    expect(decideAbandonPublish({ action: 'other', platform: 'instagram' }, [failedAtCeiling]).ok).toBe(false);
+    expect(decideAbandonPublish(null, [failedAtCeiling]).ok).toBe(false);
+  });
+});
+
 // Regression for a live incident (2026-08-12): a Graph API id read via
 // Number(...) silently loses precision past ~15-16 digits. Instagram
 // container/media ids are commonly 17 digits.
--- a/scripts/fleet-agent-cli.ts
+++ b/scripts/fleet-agent-cli.ts
@@ -234,6 +234,16 @@
 //     mismatch/grounding failed/REVIEW.md not ready/retry ceiling
 //     reached/missing credential/Meta API error/post-publish ledger-write
 //     failure).
+//   abandon-publish --id UUID --role social-manager --reason TEXT|--reason-file PATH
+//     The one legal exit for an APPROVED publish_social verdict that can never
+//     be published. Allowed only when fleet_social_posts shows the request's
+//     platform row at status='failed' with attempt_count >= PUBLISH_RETRY_CEILING
+//     (decideAbandonPublish) — an approved verdict with no attempt is the
+//     ack-trap and stays refused. Files an owner-facing question FIRST
+//     (request_key abandon-<original request_key>, idempotent) as the audit
+//     record, then consumes the verdict via fleet_consume_request
+//     (approved->consumed is already a legal DB edge — no migration). exit 0 =
+//     consumed; exit 2 = already consumed by someone else; exit 1 = refused.
 //   render-image --html TEXT --out PATH [--width N] [--height N]
 //     social-manager's actual image-production path: it authors a small
 //     HTML+CSS mockup itself (--html, or --html-file for a large one — see
@@ -329,6 +339,7 @@
   buildDryRunArtifact,
   buildInstagramPublishPlan,
   checkReviewApproved,
+  decideAbandonPublish,
   decideContainerPoll,
   decideExistingRow,
   deriveDryRunArtifactPath,
@@ -957,7 +968,8 @@
   if (action === 'publish_social') {
     fail(
       `ack refused: this is an APPROVED publish_social verdict — acking it consumes it ` +
-        `WITHOUT publishing (the 2026-08-23/2026-08-30 ack-trap). Run publish-social instead.`,
+        `WITHOUT publishing (the 2026-08-23/2026-08-30 ack-trap). Run publish-social instead; ` +
+        `if it already answered retry_ceiling_reached, use abandon-publish (never ack).`,
     );
   }
 }
@@ -995,6 +1007,87 @@
   if (!claimed) process.exitCode = 2;
 }
 
+// See the header doc and decideAbandonPublish's own comment. Order matters:
+// the audit question is filed BEFORE the consume, so a crash in between
+// leaves an extra note and a still-approved verdict (safe to re-run — the
+// question's request_key dedups), never a consumed verdict with no record of
+// why. The consumed row itself cannot carry the reason: fleet_requests_guard
+// freezes `answer` on approved->consumed.
+async function cmdAbandonPublish(args: Record<string, string | undefined>): Promise<void> {
+  const id = requireOption(args.id, 'id');
+  const role = requireOption(args.role, 'role');
+  const reason = requireOption(args.reason, 'reason');
+  const admin = createAdminClient();
+
+  const { data: request, error: requestError } = await admin
+    .from('fleet_requests')
+    .select('id, role, kind, status, title, request_key, payload')
+    .eq('id', id)
+    .maybeSingle();
+  if (requestError) fail(`abandon-publish lookup failed: ${requestError.message}`);
+  const rowError = validatePublishRequestRow(request);
+  if (rowError || !request) return fail(`abandon-publish: ${rowError ?? 'request-id not found'}`);
+  if (request.role !== role) fail(`abandon-publish: request belongs to "${request.role}", not "${role}"`);
+
+  const { data: ledgerRows, error: ledgerError } = await admin
+    .from('fleet_social_posts')
+    .select('id, platform, status, attempt_count, error')
+    .eq('request_id', id);
+  if (ledgerError) fail(`abandon-publish: ledger lookup failed: ${ledgerError.message}`);
+
+  const decision = decideAbandonPublish(request.payload, ledgerRows ?? []);
+  if (!decision.ok) return fail(`abandon-publish refused: ${decision.reason}`);
+
+  const payloadRecord =
+    request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)
+      ? (request.payload as Record<string, Json | undefined>)
+      : {};
+  const threadRoot = typeof payloadRecord.thread_root === 'string' ? payloadRecord.thread_root : id;
+  const audit = await insertAndNotify({
+    requestKey: `abandon-${request.request_key}`,
+    role,
+    runId: null,
+    kind: 'question',
+    tier: 0,
+    title: `פרסום נעצר סופית: ${decision.platform} — ${request.title.replace(/^🔴 פרסום בפועל:\s*/, '')}`.slice(0, 200),
+    body:
+      `הבקשה המאושרת ${id} לא פורסמה אחרי ${decision.row.attempt_count} ניסיונות, ` +
+      `והמערכת לא תנסה שוב אוטומטית. היא נסגרה (consumed) כדי שהסוכן לא יופעל עליה שוב.\n\n` +
+      `שגיאה אחרונה: ${decision.row.error ?? '(לא נרשמה)'}\n\nסיבת הסוכן: ${reason}\n\n` +
+      `כדי לפרסם בכל זאת: אשר בקשת פרסום חדשה (מפתח חדש) אחרי תיקון הכיתוב או עם facts_source.`,
+    payload: {
+      action: 'abandon_publish',
+      abandoned_request_id: id,
+      ledger_row_id: decision.row.id,
+      platform: decision.platform,
+      attempt_count: decision.row.attempt_count,
+      thread_root: threadRoot,
+    },
+  });
+
+  const { data: consumed, error: consumeError } = await admin.rpc('fleet_consume_request', { p_id: id });
+  if (consumeError) fail(`abandon-publish: consume failed: ${consumeError.message}`);
+  const claimed = Array.isArray(consumed) && consumed.length > 0 ? consumed[0] : null;
+  if (claimed) {
+    await sendSlackAlert({
+      level: 'warn',
+      title: `פרסום נעצר סופית: ${claimed.title}`,
+      detail: `${decision.row.attempt_count} ניסיונות נכשלו. נפתחה שאלה לבעלים.`,
+      source: `fleet:${role}`,
+      category: 'errors',
+      threadTs: (await threadTsFor(id)) ?? undefined,
+    });
+  }
+  console.log(
+    JSON.stringify(
+      { abandoned: !!claimed, request_id: id, audit_request_id: audit.request?.id ?? null },
+      null,
+      2,
+    ),
+  );
+  if (!claimed) process.exitCode = 2;
+}
+
 // Retire one still-pending request THE CALLING ROLE FILED (superseded / no
 // longer relevant). --role is checked against the row's own role BEFORE the
 // update (validateWithdrawOwnership, same ownership principle as
@@ -2834,9 +2927,11 @@
       return cmdPublishSocial(scalarValues, !!dryRun);
     case 'render-image':
       return cmdRenderImage(scalarValues);
+    case 'abandon-publish':
+      return cmdAbandonPublish(scalarValues);
     default:
       fail(
-        'usage: fleet-agent-cli <request|handoff|complete|poll|verdicts|ack|expire|withdraw|digest|sql|draft-reply|distill-corrections|business-facts|faq|style|triage-claim|triage-finish|goal-poll|goal-progress|goal-close|analytics-summary|housekeeping-pr|publish-social|render-image> [options]',
+        'usage: fleet-agent-cli <request|handoff|complete|poll|verdicts|ack|expire|withdraw|digest|sql|draft-reply|distill-corrections|business-facts|faq|style|triage-claim|triage-finish|goal-poll|goal-progress|goal-close|analytics-summary|housekeeping-pr|publish-social|render-image|abandon-publish> [options]',
       );
   }
 }
````

### `3-C-scheduler.patch`

````diff
--- /dev/null
+++ b/.claude/fleet/bin/verdict-guard.mjs
@@ -0,0 +1,74 @@
+// Pure decisions for scheduler.mjs's answer-watcher — no I/O, no deps, so the
+// scheduler stays zero-dependency and this stays unit-testable (scheduler.mjs
+// itself starts its interval on import and cannot be loaded by a test).
+//
+// Why a per-verdict cap exists: commit 7465ab6 (2026-08-31) turned the
+// verdict marker from a one-shot flag into a 4-minute cooldown so a
+// lock-skipped spawn gets retried. That fixed stranding, but assumed every
+// verdict is consumable. Measured 2026-09-27: an approved publish_social
+// verdict (62dc162c) that the role could not consume — publish-social past
+// its retry ceiling, ack refused by design — was re-spawned 45 times in one
+// day, until answer_daily_run_cap (50, shared by ALL roles) ran out and every
+// other role's verdicts were deferred with it.
+//
+// Two counters, because the scheduler cannot see whether a spawn actually ran
+// (spawn is fire-and-forget; run-role.sh's flock is non-blocking):
+//   starts — runs that really acquired the lock for this verdict. run-role.sh
+//            appends one byte to locks/verdict-<id>.starts after its flock.
+//   spawns — every spawn attempt, including lock-skips. Backstop only.
+
+export const VERDICT_RETRY_COOLDOWN_MS = 4 * 60_000;
+export const VERDICT_MAX_STARTS = 3;
+export const VERDICT_MAX_SPAWNS = 12;
+export const ANSWER_ROLE_DAILY_CAP_DEFAULT = 10;
+
+/** Marker file content -> state. Accepts the legacy bare epoch-ms number written
+ * before this module existed (treated as one past spawn), so deploying this
+ * never re-arms or strands an in-flight verdict. */
+export function parseVerdictMarker(raw) {
+  const text = String(raw ?? '').trim();
+  if (text.startsWith('{')) {
+    try {
+      const o = JSON.parse(text);
+      return {
+        last: Number(o.last) || 0,
+        spawns: Number(o.spawns) || 0,
+        stranded: o.stranded === true,
+        escalated: o.escalated === true,
+      };
+    } catch {
+      // fall through: a corrupt marker behaves like a legacy one
+    }
+  }
+  const last = Number(text) || 0;
+  return { last, spawns: last > 0 ? 1 : 0, stranded: false, escalated: false };
+}
+
+export function serializeVerdictMarker(state) {
+  return JSON.stringify(state);
+}
+
+/**
+ * @returns {{action: 'skip', reason: string} | {action: 'spawn'} | {action: 'strand', reason: string} | {action: 'escalate'}}
+ */
+export function decideVerdictSpawn({
+  marker,
+  starts,
+  now,
+  cooldownMs = VERDICT_RETRY_COOLDOWN_MS,
+  maxStarts = VERDICT_MAX_STARTS,
+  maxSpawns = VERDICT_MAX_SPAWNS,
+}) {
+  if (marker.stranded) return marker.escalated ? { action: 'skip', reason: 'stranded' } : { action: 'escalate' };
+  if (now - marker.last < cooldownMs) return { action: 'skip', reason: 'cooldown' };
+  if (starts >= maxStarts) return { action: 'strand', reason: `${starts} runs did not consume it` };
+  if (marker.spawns >= maxSpawns) return { action: 'strand', reason: `${marker.spawns} spawns did not consume it` };
+  return { action: 'spawn' };
+}
+
+/** Per-role daily answer budget. Returns true when this role may spawn again
+ * today. A role at its own cap is skipped (`continue`), leaving the shared
+ * answer_daily_run_cap for every other role. */
+export function roleHasAnswerBudget(roleCountToday, roleCap = ANSWER_ROLE_DAILY_CAP_DEFAULT) {
+  return roleCountToday < roleCap;
+}
--- /dev/null
+++ b/.claude/fleet/bin/verdict-guard.test.mjs
@@ -0,0 +1,69 @@
+// node --test .claude/fleet/bin/verdict-guard.test.mjs  (npm run test:fleet-scheduler)
+import assert from 'node:assert/strict';
+import { test } from 'node:test';
+
+import {
+  VERDICT_MAX_SPAWNS,
+  VERDICT_MAX_STARTS,
+  VERDICT_RETRY_COOLDOWN_MS,
+  decideVerdictSpawn,
+  parseVerdictMarker,
+  roleHasAnswerBudget,
+  serializeVerdictMarker,
+} from './verdict-guard.mjs';
+
+const NOW = 1_790_000_000_000;
+const fresh = { last: 0, spawns: 0, stranded: false, escalated: false };
+
+test('legacy bare-number marker is read as one past spawn', () => {
+  assert.deepEqual(parseVerdictMarker('1790000000000\n'), { last: 1790000000000, spawns: 1, stranded: false, escalated: false });
+});
+
+test('missing or corrupt marker is a fresh verdict', () => {
+  assert.deepEqual(parseVerdictMarker(''), fresh);
+  assert.deepEqual(parseVerdictMarker('{broken'), fresh);
+});
+
+test('JSON marker round-trips', () => {
+  const state = { last: NOW, spawns: 4, stranded: true, escalated: false };
+  assert.deepEqual(parseVerdictMarker(serializeVerdictMarker(state)), state);
+});
+
+test('first sighting spawns', () => {
+  assert.deepEqual(decideVerdictSpawn({ marker: fresh, starts: 0, now: NOW }), { action: 'spawn' });
+});
+
+test('inside the cooldown it skips', () => {
+  const marker = { ...fresh, last: NOW - VERDICT_RETRY_COOLDOWN_MS + 1, spawns: 1 };
+  assert.equal(decideVerdictSpawn({ marker, starts: 1, now: NOW }).action, 'skip');
+});
+
+test('a far-future legacy marker (manual containment) is skipped forever', () => {
+  const marker = parseVerdictMarker('99999999999999');
+  assert.equal(decideVerdictSpawn({ marker, starts: 0, now: NOW }).action, 'skip');
+});
+
+test('lock-skips alone do not strand a verdict before the spawn backstop', () => {
+  const marker = { ...fresh, last: NOW - VERDICT_RETRY_COOLDOWN_MS, spawns: VERDICT_MAX_SPAWNS - 1 };
+  assert.deepEqual(decideVerdictSpawn({ marker, starts: 0, now: NOW }), { action: 'spawn' });
+});
+
+test('strands after VERDICT_MAX_STARTS real runs (the 2026-09-27 loop stops at 3, not 45)', () => {
+  const marker = { ...fresh, last: NOW - VERDICT_RETRY_COOLDOWN_MS, spawns: 3 };
+  assert.equal(decideVerdictSpawn({ marker, starts: VERDICT_MAX_STARTS, now: NOW }).action, 'strand');
+});
+
+test('strands after VERDICT_MAX_SPAWNS spawns even with no recorded start', () => {
+  const marker = { ...fresh, last: NOW - VERDICT_RETRY_COOLDOWN_MS, spawns: VERDICT_MAX_SPAWNS };
+  assert.equal(decideVerdictSpawn({ marker, starts: 0, now: NOW }).action, 'strand');
+});
+
+test('a stranded verdict escalates until the escalation succeeded, then is skipped', () => {
+  assert.deepEqual(decideVerdictSpawn({ marker: { ...fresh, stranded: true }, starts: 3, now: NOW }), { action: 'escalate' });
+  assert.equal(decideVerdictSpawn({ marker: { ...fresh, stranded: true, escalated: true }, starts: 3, now: NOW }).action, 'skip');
+});
+
+test('per-role answer budget', () => {
+  assert.equal(roleHasAnswerBudget(9, 10), true);
+  assert.equal(roleHasAnswerBudget(10, 10), false);
+});
--- a/.claude/fleet/bin/scheduler.mjs
+++ b/.claude/fleet/bin/scheduler.mjs
@@ -19,6 +19,17 @@
 import { dirname, join } from 'node:path';
 import { fileURLToPath } from 'node:url';
 
+import {
+  ANSWER_ROLE_DAILY_CAP_DEFAULT,
+  VERDICT_MAX_SPAWNS,
+  VERDICT_MAX_STARTS,
+  VERDICT_RETRY_COOLDOWN_MS,
+  decideVerdictSpawn,
+  parseVerdictMarker,
+  roleHasAnswerBudget,
+  serializeVerdictMarker,
+} from './verdict-guard.mjs';
+
 const FLEET_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
 const REPO_DIR = dirname(dirname(FLEET_DIR));
 const LOGS_DIR = join(REPO_DIR, '.fleet-logs');
@@ -148,7 +159,7 @@
 
       log(`spawning ${role}`);
       const out = openSync(join(LOCKS_DIR, `spawn-${role}.log`), 'a');
-      const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [role], {
+      const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [role, 'slot'], {
         cwd: REPO_DIR,
         detached: true,
         stdio: ['ignore', out, out],
@@ -261,7 +272,8 @@
 // found live 2026-08-30: two verdicts answered back-to-back both fired their
 // spawn on the same tick, one lock-skipped, and with a PERMANENT marker (the
 // original design here) that verdict would never have been retried, ever.
-const VERDICT_RETRY_COOLDOWN_MS = 4 * 60_000;
+// VERDICT_RETRY_COOLDOWN_MS and the per-verdict caps now live in
+// verdict-guard.mjs (see its header for the 2026-09-27 loop they bound).
 
 function runCli(args) {
   return new Promise((resolve) => {
@@ -296,9 +308,15 @@
     return;
   }
 
+  // One spawn per role per tick: the run handles EVERY verdict of its role via
+  // `poll`, so a second spawn in the same tick only ever loses the flock
+  // (measured 2026-09-27 11:57/12:01 — and each such loss still burned cap).
+  const spawnedThisTick = new Set();
+
   for (const v of verdicts) {
     const rc = config.roles?.[v.role];
     if (!rc || !rc.enabled) continue;
+    if (!ROLE_NAME_RE.test(v.role)) continue; // role becomes part of a file name below
 
     if (rc.auto_ack) {
       if (inFlightAcks.has(v.id)) continue;
@@ -325,10 +343,36 @@
     // lock-skipped one gets a real second attempt within a few minutes instead
     // of never.
     const marker = join(LOCKS_DIR, `verdict-${v.id}`);
-    if (existsSync(marker)) {
-      const last = Number(readFileSync(marker, 'utf8').trim()) || 0;
-      if (Date.now() - last < VERDICT_RETRY_COOLDOWN_MS) continue;
+    const state = parseVerdictMarker(existsSync(marker) ? readFileSync(marker, 'utf8') : '');
+    const startsFile = join(LOCKS_DIR, `verdict-${v.id}.starts`);
+    const starts = existsSync(startsFile) ? readFileSync(startsFile).length : 0;
+    const decision = decideVerdictSpawn({ marker: state, starts, now: Date.now() });
+
+    if (decision.action === 'skip') continue;
+    if (decision.action === 'strand' || decision.action === 'escalate') {
+      // Stop spawning for good and tell the owner ONCE. The request_key makes
+      // the fyi idempotent in the DB itself (fleet_requests_request_key_unique),
+      // so a retry after a failed CLI call can never file a second one.
+      if (decision.action === 'strand') {
+        log(`answer-watcher: "${v.title}" (${v.role}) STRANDED — ${decision.reason}; no further spawns`);
+        indexLine({ ts: new Date().toISOString(), role: v.role, stranded_verdict: v.id, starts, spawns: state.spawns });
+      }
+      const { err: escErr } = await runCli([
+        'request', '--role', v.role, '--kind', 'fyi', '--tier', '0',
+        '--request-key', `stranded-verdict-${v.id}`,
+        '--related-to', v.id,
+        '--title', `תשובה שהסוכן לא מצליח לסגור: ${v.title}`.slice(0, 200),
+        '--body',
+        `המתזמן הפסיק להפעיל את ${v.role} על הפנייה ${v.id} אחרי ${starts} ריצות ו-${state.spawns} הפעלות ` +
+          `שלא סגרו אותה. היא נשארת פתוחה (${v.status}) ולא תופעל שוב אוטומטית. ` +
+          `נדרשת החלטה: לסגור אותה בכלי המתאים או לתקן את מה שחוסם את הסוכן. ` +
+          `הפעלה מחדש ידנית: למחוק את .fleet-logs/locks/verdict-${v.id}*.`,
+      ]);
+      if (escErr) log(`answer-watcher: stranded-verdict fyi for ${v.id} failed (will retry next tick): ${escErr.message}`);
+      writeFileSync(marker, serializeVerdictMarker({ ...state, stranded: true, escalated: !escErr }));
+      continue;
     }
+    if (spawnedThisTick.has(v.role)) continue;
 
     // A cap applies here too, but a SEPARATE one from the shared
     // daily_run_cap (see dailyCount's own comment for why): this path only
@@ -347,17 +391,30 @@
     // not start the cooldown clock — leaving the marker unwritten means the
     // very next tick (once the count rolls over) retries immediately instead
     // of waiting out VERDICT_RETRY_COOLDOWN_MS for no reason.
+    //
+    // Per-role budget FIRST, and it `continue`s: one stuck role exhausting its
+    // own budget must not starve every other role's verdicts. Measured
+    // 2026-09-27: a single social-manager verdict used 45 of the shared 50,
+    // and the `break` below then deferred every role until midnight.
+    const roleCap = config.answer_role_daily_cap ?? ANSWER_ROLE_DAILY_CAP_DEFAULT;
+    if (!roleHasAnswerBudget(dailyCount(now.dateKey, `answer-${v.role}`), roleCap)) {
+      log(`answer-watcher: ${v.role} reached its own answer cap ${roleCap} — deferring "${v.title}"`);
+      continue;
+    }
     const cap = config.answer_daily_run_cap ?? 50;
     if (dailyCount(now.dateKey, 'answer') >= cap) {
       log(`answer-watcher: answer cap ${cap} reached — deferring "${v.title}" (${v.role})`);
       break;
     }
 
-    writeFileSync(marker, String(Date.now()));
-    log(`answer-watcher: spawning ${v.role} to consume "${v.title}"`);
+    writeFileSync(marker, serializeVerdictMarker({ ...state, last: Date.now(), spawns: state.spawns + 1 }));
+    spawnedThisTick.add(v.role);
+    log(`answer-watcher: spawning ${v.role} to consume "${v.title}" (spawn ${state.spawns + 1}/${VERDICT_MAX_SPAWNS}, runs ${starts}/${VERDICT_MAX_STARTS})`);
+    indexLine({ ts: new Date().toISOString(), role: v.role, verdict_spawn: v.id, spawn: state.spawns + 1, starts });
     bumpDailyCount(now.dateKey, 'answer');
+    bumpDailyCount(now.dateKey, `answer-${v.role}`);
     const out = openSync(join(LOCKS_DIR, `spawn-${v.role}.log`), 'a');
-    const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [v.role], {
+    const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [v.role, `verdict:${v.id}`], {
       cwd: REPO_DIR,
       detached: true,
       stdio: ['ignore', out, out],
@@ -466,7 +523,7 @@
       log(`inquiry-watcher: ${trigger.describe(pending)} — spawning ${role}`);
       indexLine({ ts: new Date().toISOString(), role, reactive: name, pending });
       const out = openSync(join(LOCKS_DIR, `spawn-${role}.log`), 'a');
-      const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [role], {
+      const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [role, `reactive:${name}`], {
         cwd: REPO_DIR,
         detached: true,
         stdio: ['ignore', out, out],
--- a/package.json
+++ b/package.json
@@ -56,6 +56,7 @@
     "test": "vitest run",
     "test:watch": "vitest",
     "test:scraper": "node --test scripts/docs-scraper/scraper.test.mjs",
+    "test:fleet-scheduler": "node --test .claude/fleet/bin/verdict-guard.test.mjs",
     "verify:db": "node --env-file=.env.local scripts/verify-db-contracts.mjs",
     "typecheck": "tsc --noEmit",
     "transcribe": "node scripts/transcribe-he.mjs",
````

### `4-D-instructions.patch`

````diff
--- a/.claude/fleet/bin/run-role.sh
+++ b/.claude/fleet/bin/run-role.sh
@@ -1,6 +1,11 @@
 #!/usr/bin/env bash
 # Run one fleet role as a headless Claude session. Invoked by scheduler.mjs
-# (schedule slot or answer-watcher) or manually: bin/run-role.sh <role>.
+# (schedule slot, inquiry-watcher or answer-watcher) or manually:
+# bin/run-role.sh <role> [reason]. `reason` says WHY this run exists —
+# slot | reactive:<trigger> | verdict:<request-id> | manual (default). It is
+# recorded in the index and shown to the role; without it the role could not
+# tell an answer-watcher spawn from its schedule and misdiagnosed a verdict
+# loop as "cron" (2026-09-27).
 #
 # Safety order: role argument -> KILLSWITCH -> role enabled -> global flock
 # (serializes ALL fleet work and guarantees never-parallel `next build`) ->
@@ -40,7 +45,11 @@
 CONFIG="$FLEET_DIR/fleet.json"
 
 ROLE="${1:-}"
-[ -z "$ROLE" ] && { echo "usage: run-role.sh <role>" >&2; exit 1; }
+[ -z "$ROLE" ] && { echo "usage: run-role.sh <role> [reason]" >&2; exit 1; }
+# Allowlisted shape only: the reason reaches a file name, the index and the
+# prompt, so anything unexpected collapses to "unknown" rather than flowing on.
+REASON="${2:-manual}"
+[[ "$REASON" =~ ^(slot|manual|reactive:[a-z_]+|verdict:[0-9a-f-]{36})$ ]] || REASON="unknown"
 
 # Structural preconditions only — see the safety-order note above. Without
 # these, `mkdir` and the index write below cannot happen, so there would be no
@@ -125,13 +134,24 @@
 
 exec 9>"$LOCK_FILE"
 if ! flock -n 9; then
-  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"skipped\":\"lock\"}"
+  index_line "$(jq -cn --arg ts "$(date -Is)" --arg role "$ROLE" --arg reason "$REASON" \
+    '{ts:$ts, role:$role, skipped:"lock", reason:$reason}')"
   exit 0
 fi
 
-PROMPT="$(cat "$ROLE_PROMPT"; "$FLEET_DIR/bin/run-context.sh" "$ROLE")"
+# A real run for a verdict: one byte per run that actually got the lock.
+# scheduler.mjs (verdict-guard.mjs) caps these per verdict — lock-skips above
+# never reach this line, so they cannot strand a verdict by themselves.
+if [[ "$REASON" == verdict:* ]]; then
+  printf '.' >> "$LOGS_DIR/locks/verdict-${REASON#verdict:}.starts"
+fi
 
-index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"started\":\"$STAMP\",\"model\":\"$MODEL\",\"tier\":$TIER}"
+PROMPT="$(cat "$ROLE_PROMPT"; "$FLEET_DIR/bin/run-context.sh" "$ROLE" "$REASON")"
+
+# Built by jq, not interpolated — same reason as index_line's rescue record.
+index_line "$(jq -cn --arg ts "$(date -Is)" --arg role "$ROLE" --arg started "$STAMP" \
+  --arg model "$MODEL" --argjson tier "$TIER" --arg reason "$REASON" \
+  '{ts:$ts, role:$role, started:$started, model:$model, tier:$tier, reason:$reason}')"
 
 # `|| STATUS=$?` — see the set -e note at the top. A non-zero run must still
 # reach the index line below; without the guard, set -e would exit here.
--- a/.claude/fleet/bin/run-context.sh
+++ b/.claude/fleet/bin/run-context.sh
@@ -9,6 +9,8 @@
 REPO_DIR="$(cd "$FLEET_DIR/../.." && pwd)"
 ROLE="${1:-}"
 [ -z "$ROLE" ] && exit 0
+# Already allowlisted by run-role.sh; defaulted here for a manual invocation.
+REASON="${2:-manual}"
 
 echo
 echo "---"
@@ -45,6 +47,14 @@
 echo
 echo "## הקשר ריצה"
 echo "תאריך: $(TZ=Asia/Jerusalem date '+%Y-%m-%d %H:%M %Z')"
+echo "סיבת ההפעלה: \`$REASON\`"
+case "$REASON" in
+  slot)        echo "(ה-slot המתוזמן שלך ב-fleet.json.)" ;;
+  reactive:*)  echo "(טריגר תגובתי \`${REASON#reactive:}\` — יש עבודה חדשה בתור שלך.)" ;;
+  verdict:*)   echo "(ה-answer-watcher: הבעלים ענה על הפנייה \`${REASON#verdict:}\` והיא עדיין לא נסגרה."
+               echo " זו **לא** תקלת cron. המתזמן יפעיל אותך עליה לכל היותר 3 פעמים ואז יעצור"
+               echo " ויפתח fyi לבעלים — לכן סגור אותה בריצה הזו בכלי שה-prompt שלך מגדיר.)" ;;
+esac
 echo
 echo "## פניות ותשובות (fleet_requests) של התפקיד שלך"
 echo '```json'
@@ -73,8 +83,12 @@
 echo "   \`ack\` הוא גם התפיסה וגם ההתראה לבעלים שהתשובה נקלטה — בלעדיו הבעלים"
 echo "   לעולם לא יידע שראית את התשובה שלו, והפנייה נשארת תקועה לצמיתות."
 echo "2. פעל לפי התשובה — בגבולות הדרגה שלך."
-echo "פנייה ב-verdicts שנשארה answered בסוף ריצה (בלי ack) = לא טיפלת בה. זה כשל,"
-echo "בדיוק כמו inbox."
+echo "**חריג יחיד — גובר על סעיף 1:** verdict **מאושר** שה-prompt של התפקיד שלך"
+echo "מגדיר לו כלי סגירה אחר (היום: \`payload.action=publish_social\` אצל"
+echo "social-manager — \`publish-social\`, ואז \`complete\` או \`abandon-publish\`) —"
+echo "**אל תריץ עליו ack**; הקוד גם מסרב. הכלי ההוא הוא התפיסה, וההתראה לבעלים."
+echo "פנייה ב-verdicts שנשארה answered/approved בסוף ריצה, בלי ack ובלי כלי-הסגירה"
+echo "של החריג = לא טיפלת בה. זה כשל, בדיוק כמו inbox."
 echo
 echo "**open** — פניות ש**אתה** פתחת וטרם נענו. אין מה לעשות איתן."
 echo "פנייה חדשה לבעלים: \`npm run fleet:agent -- request --role $ROLE ...\`."
--- a/.claude/fleet/roles/social-manager.md
+++ b/.claude/fleet/roles/social-manager.md
@@ -40,7 +40,10 @@
 
 ## הקשר-ריצה
 
-Tier 0, ראשון 11:30, חלון 30 דק'. אין משתמש, אין רשת, אין Canva —
+Tier 0. שלושה מסלולי הפעלה: slot קבוע (ראשון 11:30), טריגר תגובתי
+(פנייה ישירה מהבעלים / מטרה), ותשובת בעלים לפנייה שלך (answer-watcher).
+"סיבת ההפעלה" בהקשר-הריצה למטה אומרת איזה מהם הפעיל אותך — ריצה שאינה ב-11:30
+היא לא תקלת cron. 30 דק' הן תקרת-זמן לריצה אחת, לא חלון. אין משתמש, אין רשת, אין Canva —
 `render-image` הוא היוצא-מן-הכלל היחיד (רינדור מקומי, לא רשת, ראו למעלה).
 **אין לך זיכרון בין שבועות**: "אצווה שבועית" נמדדת
 מול `.fleet-logs/drafts/social/` — הקבצים שאתה עצמך כתבת, עם התאריך
@@ -159,13 +162,24 @@
     זו העדות ש"כבר פורסם" — סגור עם `complete` עכשיו.
   - נכשל (exit 1) → `request --kind fyi --title "פרסום נכשל: <platform>" --body "<שגיאה, בלי PII>"`.
     **לעולם לא** `complete` על כישלון — זה בדיוק הבאג ש-`digest` נתפס בו (מדווח הצלחה
-    שלא קרתה). אם זה הכישלון ה-**שני** לאותה בקשה, פתח `--kind question` במקום
-    לנסות שוב אוטומטית.
+    שלא קרתה). אם זה הכישלון ה-**שני** לאותה בקשה, אל תנסה שוב — עבור לסעיף הבא.
+  - הפלט הוא `outcome: "retry_ceiling_reached"` (או שזה הכישלון השני) → **הפעולה
+    הסופית** לבקשה הזו:
+    ```
+    npm run fleet:agent -- abandon-publish --id <id> --role social-manager --reason-file <נתיב>
+    ```
+    (הסיבה בקובץ תחת `.fleet-logs/`, בלי PII.) ה-verb בודק בעצמו שה-ledger באמת
+    מוצה, פותח לבעלים **שאלה אחת** עם השגיאה, וסוגר את הבקשה. **אל תפתח fyi/question
+    נוסף משלך** — השאלה שה-verb פתח היא ההסלמה. כדי לפרסם בכל זאת, הבעלים יענה על
+    השאלה; בריצה ההיא פתח בקשת-פרסום **חדשה** עם `--request-key` בסיומת `-r<N+1>`
+    (אחרי תיקון הכיתוב, או עם `facts_source` אם הכיתוב טוען טענה עובדתית).
+    `abandon-publish` מסרב אם לא היה ניסיון פרסום אמיתי — הוא **לא** תחליף ל-ack.
 - **retry בריצה הבאה**: אתה **לא** קורא ל-`fleet_social_posts` ישירות (אין לך
   גישת `sql` לטבלה הזו, ולא צריך) — פשוט הרץ שוב `publish-social` על כל בקשת-פרסום
   שעדיין `approved` (דרך `poll`). ה-verb עצמו הוא ה-lookup: exit 2 אומר "כבר פורסם,
-  אין מה לעשות", exit 0 אומר "עכשיו פורסם", exit 1 אומר "עדיין נכשל". אתה אף פעם
-  לא צריך לדעת את מצב ה-ledger מראש.
+  אין מה לעשות", exit 0 אומר "עכשיו פורסם", exit 1 אומר "עדיין נכשל" — ואם הפלט
+  אומר `retry_ceiling_reached`, זה סופי: `abandon-publish` (למעלה), לא עוד ניסיון.
+  אתה אף פעם לא צריך לדעת את מצב ה-ledger מראש.
 
 ## גבולות נוספים — שלב הפרסום
 
@@ -193,8 +207,9 @@
 
 ## משפט-הצלחה
 
-*"ריצה מוצלחת = אצווה אחת בתיקייה מתוארכת, כל כיתוב עם הצעת-ויזואל
-כטקסט, אפס טענות שלא נשלפו מנתונים, ופנייה אחת לאישור."*
+*"ריצה מוצלחת = אצווה אחת בתיקייה מתוארכת, כל כיתוב עם `post-<N>.html`
+ותמונה מרונדרת, אפס טענות שלא נשלפו מנתונים, ופנייה אחת לאישור — ואף verdict
+שלך לא נשאר approved בסוף הריצה בלי publish-social/complete/abandon-publish."*
 
 ## הגבלת פלטפורמה (הוראת בעלים, 23.08)
 **פרסום באינסטגרם בלבד עד הודעה חדשה.** אל תפתח בקשות פרסום לפייסבוק —
@@ -205,4 +220,6 @@
 ## לקח ack-trap (תקרית 23.08, פעמיים באותו יום)
 verdict מאושר עם `payload.action='publish_social'` — **לעולם לא `ack`**.
 `ack` נועל את הבקשה ב-consumed ללא-חזרה והפרסום נחסם. הרצף היחיד:
-`publish-social` → לפי exit code → `complete`. (`ack` מותר רק על verdict דחוי.)
+`publish-social` → לפי exit code → `complete` (הצליח) או `abandon-publish` (תקרת
+ניסיונות מוצתה). (`ack` מותר רק על verdict דחוי.) הכלל הכללי ב"הקשר ריצה"
+("ack על כל verdict") **לא** חל כאן — ה-prompt הזה גובר, וכך כתוב גם שם.
````

### `5-E-maintainer.patch`

````diff
--- /dev/null
+++ b/src/lib/fleet/run-stats.ts
@@ -0,0 +1,75 @@
+// Per-role, per-day run counts from .fleet-logs/runs/index.ndjson. Pure: the
+// CLI (`run-stats`) reads the file, this only parses and counts.
+//
+// Why it exists: on 2026-09-27 social-manager logged 41 starts + 9 lock-skips
+// in one day (a normal Sunday is 1-2) and no role reported it by COUNT —
+// fleet-maintainer only walks known-issues.json, and the role itself
+// misdiagnosed the cause. A count per role per day is the cheapest signal
+// that makes a runaway visible without reading pm2 logs.
+//
+// Dates are bucketed in Asia/Jerusalem: run-role.sh writes local-offset
+// timestamps (date -Is) while scheduler.mjs writes UTC (toISOString), so a
+// plain ts.slice(0, 10) would split one local day across two buckets.
+
+const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
+  timeZone: 'Asia/Jerusalem',
+  year: 'numeric',
+  month: '2-digit',
+  day: '2-digit',
+});
+
+export type RunStat = {
+  role: string;
+  date: string;
+  started: number;
+  lockSkipped: number;
+  verdictStarts: number;
+  stranded: number;
+};
+
+const RANGE_DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };
+
+export function localDate(ts: string): string | null {
+  const ms = Date.parse(ts);
+  return Number.isNaN(ms) ? null : DAY_FORMAT.format(new Date(ms));
+}
+
+/** First local date included in the range, or null for an unknown range. */
+export function rangeStartDate(range: string, now: Date): string | null {
+  const days = RANGE_DAYS[range];
+  if (!days) return null;
+  return DAY_FORMAT.format(new Date(now.getTime() - (days - 1) * 86_400_000));
+}
+
+export function aggregateRunIndex(lines: readonly string[], sinceDate: string): RunStat[] {
+  const byKey = new Map<string, RunStat>();
+  for (const line of lines) {
+    if (!line.trim()) continue;
+    let record: Record<string, unknown>;
+    try {
+      const parsed: unknown = JSON.parse(line);
+      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
+      record = parsed as Record<string, unknown>;
+    } catch {
+      continue; // one corrupt line must not hide the rest (2026-07-28 incident)
+    }
+    const role = typeof record.role === 'string' ? record.role : null;
+    const date = typeof record.ts === 'string' ? localDate(record.ts) : null;
+    if (!role || !date || date < sinceDate) continue;
+
+    const key = `${date}|${role}`;
+    const stat = byKey.get(key) ?? { role, date, started: 0, lockSkipped: 0, verdictStarts: 0, stranded: 0 };
+    if (typeof record.started === 'string') {
+      stat.started += 1;
+      if (typeof record.reason === 'string' && record.reason.startsWith('verdict:')) stat.verdictStarts += 1;
+    }
+    if (record.skipped === 'lock') stat.lockSkipped += 1;
+    if (typeof record.stranded_verdict === 'string') stat.stranded += 1;
+    byKey.set(key, stat);
+  }
+  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.role.localeCompare(b.role));
+}
+
+export function findRunaways(stats: readonly RunStat[], maxPerDay: number): RunStat[] {
+  return stats.filter((s) => s.started + s.lockSkipped > maxPerDay || s.stranded > 0);
+}
--- /dev/null
+++ b/src/lib/fleet/run-stats.test.ts
@@ -0,0 +1,61 @@
+import { describe, expect, it } from 'vitest';
+
+import { aggregateRunIndex, findRunaways, localDate, rangeStartDate } from './run-stats';
+
+const line = (o: Record<string, unknown>) => JSON.stringify(o);
+
+describe('localDate', () => {
+  it('buckets a UTC timestamp by its Asia/Jerusalem date', () => {
+    expect(localDate('2026-09-27T22:30:00.000Z')).toBe('2026-09-28');
+    expect(localDate('2026-09-27T23:59:00+03:00')).toBe('2026-09-27');
+  });
+
+  it('returns null for an unparsable timestamp', () => {
+    expect(localDate('not-a-date')).toBeNull();
+  });
+});
+
+describe('rangeStartDate', () => {
+  it('includes today as the first of N days', () => {
+    expect(rangeStartDate('1d', new Date('2026-09-27T12:00:00+03:00'))).toBe('2026-09-27');
+    expect(rangeStartDate('7d', new Date('2026-09-27T12:00:00+03:00'))).toBe('2026-09-21');
+  });
+
+  it('rejects an unknown range', () => {
+    expect(rangeStartDate('90d', new Date())).toBeNull();
+  });
+});
+
+describe('aggregateRunIndex / findRunaways', () => {
+  const lines = [
+    line({ ts: '2026-09-27T11:30:44+03:00', role: 'social-manager', started: '20260927T113043', reason: 'slot' }),
+    line({ ts: '2026-09-27T12:11:45+03:00', role: 'social-manager', started: '20260927T121144', reason: 'verdict:62dc162c-7425-4801-9bf1-bf01901acec9' }),
+    line({ ts: '2026-09-27T12:12:00+03:00', role: 'social-manager', skipped: 'lock' }),
+    line({ ts: '2026-09-27T12:13:00.000Z', role: 'social-manager', stranded_verdict: '62dc162c-7425-4801-9bf1-bf01901acec9' }),
+    line({ ts: '2026-09-27T13:00:10+03:00', role: 'fleet-maintainer', started: '20260927T130010' }),
+    line({ ts: '2026-09-20T13:00:10+03:00', role: 'fleet-maintainer', started: '20260920T130010' }),
+    '{"cost_usd":}',
+    '',
+  ];
+
+  it('counts starts, lock-skips, verdict starts and strandings per role per day, skipping corrupt lines', () => {
+    expect(aggregateRunIndex(lines, '2026-09-21')).toEqual([
+      { role: 'fleet-maintainer', date: '2026-09-27', started: 1, lockSkipped: 0, verdictStarts: 0, stranded: 0 },
+      { role: 'social-manager', date: '2026-09-27', started: 2, lockSkipped: 1, verdictStarts: 1, stranded: 1 },
+    ]);
+  });
+
+  it('flags role-days over the threshold or with a stranded verdict', () => {
+    const stats = aggregateRunIndex(lines, '2026-09-01');
+    expect(findRunaways(stats, 10).map((s) => s.role)).toEqual(['social-manager']);
+    expect(findRunaways(stats, 1).map((s) => `${s.date}|${s.role}`)).toEqual(['2026-09-27|social-manager']);
+  });
+
+  it('counts a spawn-heavy day (41 starts + 9 lock-skips, as on 2026-09-27) as a runaway', () => {
+    const heavy = [
+      ...Array.from({ length: 41 }, () => line({ ts: '2026-09-27T12:00:00+03:00', role: 'social-manager', started: 'x' })),
+      ...Array.from({ length: 9 }, () => line({ ts: '2026-09-27T12:00:00+03:00', role: 'social-manager', skipped: 'lock' })),
+    ];
+    expect(findRunaways(aggregateRunIndex(heavy, '2026-09-27'), 10)).toHaveLength(1);
+  });
+});
--- a/scripts/fleet-agent-cli.ts
+++ b/scripts/fleet-agent-cli.ts
@@ -244,6 +244,11 @@
 //     record, then consumes the verdict via fleet_consume_request
 //     (approved->consumed is already a legal DB edge — no migration). exit 0 =
 //     consumed; exit 2 = already consumed by someone else; exit 1 = refused.
+//   run-stats [--range 1d|7d|30d] [--max-per-day N]
+//     Read-only per-role/per-day counts from .fleet-logs/runs/index.ndjson
+//     (started, lock-skips, verdict-triggered starts, stranded verdicts) plus
+//     the role-days over --max-per-day (default 10) or with any stranded
+//     verdict. fleet-maintainer / chief-of-staff input for runaway detection.
 //   render-image --html TEXT --out PATH [--width N] [--height N]
 //     social-manager's actual image-production path: it authors a small
 //     HTML+CSS mockup itself (--html, or --html-file for a large one — see
@@ -315,6 +320,7 @@
 import { buildCompletionAnswer, isCompletableStatus } from '@/lib/fleet/complete';
 import { validateWithdrawOwnership } from '@/lib/fleet/withdraw';
 import { runFleetExpireSweep } from '@/lib/fleet/expire';
+import { aggregateRunIndex, findRunaways, rangeStartDate } from '@/lib/fleet/run-stats';
 import {
   renderExamplesMarkdown,
   summarizeMetric,
@@ -1088,6 +1094,24 @@
   if (!claimed) process.exitCode = 2;
 }
 
+async function cmdRunStats(args: Record<string, string | undefined>): Promise<void> {
+  const range = args.range ?? '7d';
+  const maxPerDay = args['max-per-day'] ? Number(args['max-per-day']) : 10;
+  if (!Number.isInteger(maxPerDay) || maxPerDay < 1) fail('--max-per-day must be a positive integer');
+  const since = rangeStartDate(range, new Date());
+  if (!since) return fail('--range must be one of: 1d, 7d, 30d');
+  let raw: string;
+  try {
+    raw = readFileSync(join(process.cwd(), '.fleet-logs', 'runs', 'index.ndjson'), 'utf8');
+  } catch {
+    return fail('run-stats: .fleet-logs/runs/index.ndjson not found');
+  }
+  const stats = aggregateRunIndex(raw.split('\n'), since);
+  console.log(
+    JSON.stringify({ since, maxPerDay, runaways: findRunaways(stats, maxPerDay), stats }, null, 2),
+  );
+}
+
 // Retire one still-pending request THE CALLING ROLE FILED (superseded / no
 // longer relevant). --role is checked against the row's own role BEFORE the
 // update (validateWithdrawOwnership, same ownership principle as
@@ -2865,6 +2889,7 @@
       'evidence-file': { type: 'string' },
       'html-file': { type: 'string' },
       'landing-pages': { type: 'boolean' },
+      'max-per-day': { type: 'string' },
     },
   });
 
@@ -2929,9 +2954,11 @@
       return cmdRenderImage(scalarValues);
     case 'abandon-publish':
       return cmdAbandonPublish(scalarValues);
+    case 'run-stats':
+      return cmdRunStats(scalarValues);
     default:
       fail(
-        'usage: fleet-agent-cli <request|handoff|complete|poll|verdicts|ack|expire|withdraw|digest|sql|draft-reply|distill-corrections|business-facts|faq|style|triage-claim|triage-finish|goal-poll|goal-progress|goal-close|analytics-summary|housekeeping-pr|publish-social|render-image|abandon-publish> [options]',
+        'usage: fleet-agent-cli <request|handoff|complete|poll|verdicts|ack|expire|withdraw|digest|sql|draft-reply|distill-corrections|business-facts|faq|style|triage-claim|triage-finish|goal-poll|goal-progress|goal-close|analytics-summary|housekeeping-pr|publish-social|render-image|abandon-publish|run-stats> [options]',
       );
   }
 }
--- a/.claude/fleet/roles/fleet-maintainer.md
+++ b/.claude/fleet/roles/fleet-maintainer.md
@@ -64,6 +64,23 @@
    (<old-id>) בנושא זה פגה ללא מענה <N> ימים." אל תשכפל אם ה-`poll`
    כבר מראה פנייה מוסלמת פתוחה על אותו catalog-id.
 
+## ספירת ריצות לכל תפקיד (בכל ריצה, גם בלי entry בקטלוג)
+
+הקטלוג לא תופס תפקיד שרץ שוב ושוב — 27.9: social-manager רץ 41 פעמים (ועוד 9
+דחיות-lock) ביום אחד, ואף בדיקה לא ספרה. לכן בכל ריצה:
+
+1. `npm run fleet:agent -- run-stats --range 7d` (ברירת-מחדל `--max-per-day 10`).
+2. לכל שורה ב-`runaways` (תפקיד+תאריך מעל התקרה, או עם `stranded` > 0):
+   - `poll` קודם — אם כבר פתחת פנייה על אותו תפקיד+תאריך, אל תכפיל.
+   - פתח `--kind question` עם `--request-key "runaway-<role>-<date>"`: הספירות
+     (started / lockSkipped / verdictStarts / stranded), וההפניה ל-`index.ndjson`.
+     `stranded` > 0 = המתזמן כבר עצר verdict שלא נסגר ופתח עליו fyi — ציין את זה,
+     אל תחזור על אבחנה שכבר נמסרה.
+3. ב-summary: שורה אחת "run-stats: N חריגות" (גם כשאין).
+
+אתה רץ פעם בשבוע — אתה **לא** קו ההגנה הראשון. העצירה בזמן אמת היא בתקרות של
+ה-scheduler; התפקיד שלך הוא לוודא שחריגה שקרתה נראתה ונסגרה.
+
 ## דיווח
 
 - **`fyi`**: ממצא שגרתי, לא-דחוף (drift קוסמטי, תיעוד מיושן).
````


---

## מה יושם (27.9.2026, ~16:45 IDT)

**אישור:** הבעלים אישר במפורש את התיקון המלא (חמש השכבות). יושם על העץ האמיתי, מעל השינויים הלא-מקומטים של היום (override של settings/mcp_config ב-`run-role.sh`, שלושת תפקידי ה-design ב-`fleet.json`, `answer_daily_run_cap: 100`, סקשן "עיצוב ב-Claude Design" ב-`social-manager.md`). **לא** בוצעו: commit, deploy, restart, build מלא, כתיבה ל-DB, פתיחה/מענה/סגירה של בקשות fleet, הרצת `abandon-publish`.

### קבצים

| שכבה | קבצים | הערה |
|---|---|---|
| (א) | `src/lib/fleet/publish-social.ts`, `publish-social.test.ts` | patch 1-A כמו שהוא |
| (ב) | `src/lib/fleet/publish-social.ts`, `publish-social.test.ts`, `scripts/fleet-agent-cli.ts` | patch 2-B כמו שהוא. `--reason-file` נפתר ל-`--reason` במנגנון ה-`*-file` הקיים של ה-CLI |
| (ג) | `.claude/fleet/bin/verdict-guard.mjs` (חדש), `verdict-guard.test.mjs` (חדש), `scheduler.mjs`, `package.json` (`test:fleet-scheduler`), `fleet.json` (`"answer_role_daily_cap": 10`, מפורש; `answer_daily_run_cap` נשאר 100) | patch 3-C, ובנוסף הוסר import לא בשימוש (`VERDICT_RETRY_COOLDOWN_MS`) |
| (ד) | `.claude/fleet/bin/run-role.sh`, `run-context.sh`, `.claude/fleet/roles/social-manager.md` | patch 4-D. ה-hunk של משפט-ההצלחה נכשל (הנוסח השתנה היום ל-Claude Design) ומוזג ידנית: נשמר "ויזואל (עמוד ב-Claude Design)" ונוסף סעיף ה-verdict. סקשן "עיצוב ב-Claude Design" לא נגע |
| (ה) | `src/lib/fleet/run-stats.ts` (חדש), `run-stats.test.ts` (חדש), `scripts/fleet-agent-cli.ts`, `.claude/fleet/roles/fleet-maintainer.md` | patch 5-E כמו שהוא |
| תיעוד | `docs/fleet/01-architecture-and-orchestration.md` | תיאור ה-answer-watcher עודכן (הוא עוד תיאר סמן חד-פעמי ותקרה 50) |
| תיקון נוסף (אחרי review) | `scripts/fleet-agent-cli.ts` (הודעת `retry_ceiling_reached`), `social-manager.md`, §4 כאן | ההודעה של `publish-social` בתקרה אמרה "escalate via --kind question" וסתרה את ה-prompt החדש; עכשיו היא מפנה ל-`abandon-publish` ואוסרת שאלה משלך. נתיב `--reason-file` בהוראות ובדוגמה של §4 הוא `.fleet-logs/drafts/<YYYYMMDD>/…` (תואם לכלל "רק שם מותר לך לכתוב" בסקשן ה-design; ה-CLI וה-allowlist מתירים כל `.fleet-logs/**`) |

**allowlist:** לא נדרש שינוי. `Bash(npm run fleet:agent:*)` ו-`node … dist/fleet-agent-cli.cjs:*` כבר מותרים ב-tier0 וב-tier0-design, וה-guard hook (`settings/hooks/guard.sh`) לא חוסם את `abandon-publish`/`run-stats`. `tier0-design.settings.json` לא שונה, ולכן עדיין מכיל כל כלל של tier0 (הטסט עובר).

**אימות מול ה-DB החי (קריאה בלבד, דרך `fleet:agent sql`):** `fleet_requests_guard` מכיל `if old.status in ('approved','denied','answered') and new.status = 'consumed'`; `fleet_consume_request` מעדכן `where status in ('approved','denied','answered') and consumed_at is null`. `62dc162c`: ‏`approved`, ‏`consumed_at null`; ledger ‏instagram ‏`failed`, ‏`attempt_count 2`. כלומר `abandon-publish` כשיר עליה ואין צורך במיגרציה. **MEASURED**

### שערים

| בדיקה | תוצאה |
|---|---|
| `npx vitest run src/lib/fleet scripts` | 13 קבצים, 172/172 (כולל publish-social 74, run-stats 7, tier0-design-settings 5) |
| `npx vitest run src/lib/owner-agent src/app/(admin)/admin/fleet src/lib/ops` | 37 קבצים, 971/971 |
| `npm run test:fleet-scheduler` (`node --test`) | 11/11 |
| `npx tsc --noEmit` (כל הפרויקט) | exit 0 |
| `npm run lint` (כל הפרויקט) | exit 0, בלי פלט |
| `bash -n` על `run-role.sh`, `run-context.sh`; `node --check` על `scheduler.mjs`, `verdict-guard.mjs`; `jq -e` על `fleet.json` | תקין |
| `npm run build` | **לא הורץ** (הוראה: מתנגש עם סשנים מקבילים) |

**סימולציה של המתזמן** (עותק בתיקיית scratch: `scheduler.mjs` האמיתי עם tick של 1.5 שנ' ו-cooldown 0, CLI ו-`run-role.sh` מדומים עם flock ו-`.starts` כמו במקור):
- תרחיש 1: ה-verdict התקוע של social-manager רץ 3 פעמים, ואז `STRANDED — 3 runs did not consume it`, שורת `stranded_verdict` ב-index, **fyi אחד** (`--request-key stranded-verdict-62dc…`, `--related-to`), ואפס spawns נוספים. verdict שני של social-manager קיבל spawn משלו ונסגר. content-seo-strategist המשיך לקבל spawns במקביל; 4 דחיות lock שלו **לא** נספרו כריצות (`runs 0/3`), ואחרי 10 spawns ביום הוא נדחה עם `reached its own answer cap 10` — רק הוא. כל spawn נרשם ב-index כ-`verdict_spawn`.
- תרחיש 2: marker הבלימה `99999999999999` נשאר מדולג ולא שונה; `answer-social-manager-<date>=10` דחה רק את social-manager, ו-content-seo-strategist קיבל 6 spawns.

**`npm run fleet:agent -- run-stats --range 7d`** על ה-index האמיתי: חריגה אחת — social-manager ב-27.9: ‏`started 43, lockSkipped 10, verdictStarts 0, stranded 0` (`verdictStarts 0` כי שדה `reason` נרשם רק מעכשיו). כל שאר התפקידים 1–2 ביום.

### מה נדרש כדי שזה ייכנס לתוקף

- **(א), (ב), (ה):** בתוקף כבר עכשיו — כל `npm run fleet:agent` בונה את הבנדל מהעץ (הבנדל נבנה מחדש כאן ב-`run-stats`).
- **(ד):** בתוקף בכל ריצה חדשה (`run-role.sh`/`run-context.sh` נקראים בכל spawn). עד ה-restart המתזמן הישן לא מעביר סיבה, ולכן הסיבה תהיה `manual` — תקין ותואם.
- **(ג):** דורש `pm2 restart kalfa-fleet` (בעלים). בטוח כשאין ריצה פעילה: `pgrep -af 'run-role.sh|claude -p'` לא מחזיר ריצת צי, והשורה האחרונה של תפקיד ב-`.fleet-logs/runs/index.ndjson` היא `finished` (לא `started` בלי `finished` אחריו). ה-restart עצמו לא הורג ריצה detached, אבל עדיף בזמן שקט. אחרי ה-restart: בלוג `~/.pm2/logs/kalfa-fleet-out.log` שורת `starting`, ובספאון הבא של verdict מופיע `(spawn n/12, runs m/3)` ושורת `verdict_spawn` ב-index.
- **marker הבלימה של `62dc162c` נשאר** (לא נמחק). הקוד החדש קורא אותו כ-marker ישן ומדלג עליו לתמיד.

### שחרור `62dc162c`

- **ייתכן שזה יקרה מעצמו, גם לפני ה-restart:** ה-marker חוסם רק spawns של ה-answer-watcher. כל ריצה אחרת של social-manager (slot של ראשון 11:30, טריגר תגובתי, פנייה ישירה) מקבלת את ה-prompt החדש, רואה את `62dc162c` ב-`poll`, מקבלת מ-`publish-social` את `retry_ceiling_reached` עם ההפניה ל-`abandon-publish`, ומריצה אותו. זו התוצאה המכוונת; היא לא הופעלה כאן.
- **אם רוצים להפעיל את זה דרך המתזמן** (אחרי ה-restart): למחוק את `.fleet-logs/locks/verdict-62dc162c-7425-4801-9bf1-bf01901acec9`. אין עדיין קובץ `.starts`, והמונה מתחיל מ-0. ב-tick הבא social-manager יופעל עם `verdict:62dc162c…` ויריץ `publish-social` → `retry_ceiling_reached` → `abandon-publish`, שפותח שאלה `abandon-publish-20260913-batch-2-instagram-r2` וצורך את הבקשה. אם שלוש ריצות לא יסגרו אותה, המתזמן יעצור ויפתח fyi אחד.
- **חלופה בלי המתזמן:** להריץ ידנית את הפקודה שב-§4.
