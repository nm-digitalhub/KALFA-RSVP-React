# KALFA Fleet — ה-CLI ומחזור-חיי הבקשה (`scripts/fleet-agent-cli.ts`)

> מסמך זה נכתב מתוך קריאת קוד בפועל (repo: `/var/www/vhosts/kalfa.me/beta`), נכון ל-2026-08-09.
> כל מזהה טכני (נתיבים, טבלאות, פקודות CLI, קוד) נשמר באנגלית.

## 1. היקף

`scripts/fleet-agent-cli.ts` (1,561 שורות) הוא **הדרך היחידה** שבה role כלשהו ב-kalfa-fleet כותב משהו או מדבר עם הבעלים. אין גישה גולמית ל-DB, אין קריאה ישירה ל-API של ספק חיצוני, ואין כתיבת קובץ מחוץ לנתיבים המפורשים שה-CLI חושף. כל פעולה פריווילגית — פתיחת בקשה, כתיבת טיוטה, שאילתת SQL, סגירת יעד — היא **verb** צר ושמור, עם guard משלו בצד השרת, ולא "יכולת" גנרית שה-role מפעיל לפי שיקול דעתו. עיקרון זה הוא הבסיס לכל מודל האמון של הצי: role יכול לבקש, לדווח ולמלא verb ספציפי — הוא לא יכול לפעול ישירות מול הנתונים.

מסמך זה מכסה **אך ורק** את משטח הפקודות של ה-CLI, את מחזור-החיים של טבלת `fleet_requests`, את שכבות ה-concurrency/locking, את טיפול ה-credentials, את מוסכמת קודי ה-exit, ואת בדיקת טריות ה-bundle. הקטלוג של 16 ה-roles עצמם מתועד ב-`02-roles-catalog.md`; מנוע התזמור (scheduler, tiers, hooks) מתועד ב-`01-architecture-and-orchestration.md`; מצב תפעולי חי (הרצות, uptime, מדדים) מתועד ב-`04-operational-status.md`; אינדקס-על לכל סדרת `docs/fleet/` נמצא ב-`00-index.md`.

## 2. משטח הפקודות (19 verbs)

הפקודות משודרות (dispatch) ב-`main()` (`fleet-agent-cli.ts:1512-1555`). לכל דגל טקסט-חופשי (`--body`, `--note`, `--summary`, `--state`, `--query`, `--reason`, `--error`, `--evidence`) יש תאום `--X-file` (`:221-268`) שקורא את התוכן מנתיב הכפוי תחת `.fleet-logs/` — זה קיים **אך ורק** כדי להתחמק מבדיקת ה-hooks של Bash שסורקים את מחרוזת הפקודה כולה, לא מטעמי אבטחת DB.

### פקודות תקשורת עם הבעלים

| Verb | תיאור | Table/RPC | תכונת בטיחות מרכזית |
|---|---|---|---|
| `request` (`:425-494`) | פתיחת בקשה חדשה כלפי הבעלים | `INSERT fleet_requests` דרך `insertAndNotify` (`:365-423`) | ה-role חייב להתקיים ב-`fleet.json` (`validateRequestRole`); `kind`/`tier` מאומתים; דדופ לפי `request_key` (unique-violation → החזרה אידמפוטנטית); נתיבי `--attach` כפויים לתוך `.fleet-logs/drafts/` בלבד (`:457-480`) |
| `handoff` (`:496-541`) | העברת בקשה קיימת ל-role אחר או ל-`main` כשורה חדשה | `SELECT` + `INSERT fleet_requests` | היעד חייב להיות מופעל ב-`fleet.json` או `main` (`validateHandoffTarget`); השורה המקורית לעולם לא משתנה (append-only); handoff עצמי נדחה |
| `complete` (`:543-616`) | סגירת בקשה על-ידי המבצע | `UPDATE fleet_requests` → `status='completed'` | רק מ-pending/approved/answered (`isCompletableStatus`); CAS על ה-status הנצפה (`.eq('status', row.status)`); הפסק-דין נבנה דרך `buildCompletionAnswer` (כלל prefix נאכף ב-DB) |
| `poll` (`:633-714`) | ה-role קורא את תיבת-הדואר/פסקי-הדין/הפתוח שלו | `SELECT fleet_requests` | מפריד בקשות ביוזמת הבעלים (`payload.origin==='owner'`) מבקשות ביוזמת ה-role; פותר הקשר `thread_root` |
| `verdicts` (`:618-631`) | לשימוש ה-scheduler בלבד: כל פסקי-הדין שלא נצרכו על-פני כל ה-roles | `SELECT fleet_requests` | — |
| `ack` (`:716-746`) | קליטה חד-פעמית (exactly-once) של פסק-דין | RPC ‏`fleet_consume_request` (CAS) | claim אטומי בצד השרת; `claimed:false` + exitCode 2 כשה-race אבד |
| `expire` (`:775-794`) | טאטוא pending→expired שעבר את `expires_at` | `UPDATE fleet_requests` | מוגבל ל-`status='pending' AND expires_at<=now()` |
| `withdraw` (`:748-773`) | ביטול בקשה עדיין-pending של ה-role עצמו | `UPDATE fleet_requests` → `status='expired'` | מוגבל `.eq('status','pending')` — no-op אם כבר נענתה |
| `digest` (`:877-892`) | פרסום תמצית יומית ל-Slack | ללא (Slack בלבד) | — |

### פקודות נתונים

| Verb | תיאור | Table/RPC | תכונת בטיחות מרכזית |
|---|---|---|---|
| `sql` (`:835-875`) | שאילתת SQL אד-הוק, read-only, ל-roles קוראי-נתונים | חיבור `pg` גולמי (credentials של ה-session pooler) | guard על משפט בודד, `SELECT`/`WITH` בלבד, regex מילים-אסורות, **וגם** עטיפה של כל שאילתה ב-`BEGIN TRANSACTION READ ONLY` (השכבה הסמכותית) + תקרת שורות (200) + statement timeout של 15 שניות |
| `draft-reply` (`:906-940`) | הכתיבה היחידה של support-drafter | `UPDATE contact_messages` | מוגבל ל-`status='new' AND draft_reply IS NULL`; לעולם לא שולח מייל; תקרה של 4000 תווים |
| `distill-corrections` (`:1151-1209`) | לשימוש תחזוקה בלבד: בניית קורפוס few-shot | `SELECT contact_messages` (קריאת PII לצורך redact בלבד) | כותב ל-`.claude/fleet/roles/support-drafter.examples.md` (git-ignored); הפלט נקי-PII |
| `business-facts` (`:1218-1243`) | עובדות תמחור עבור support-drafter | `SELECT packages` + `getBaseOveragePricingEnabled()` | — |
| `analytics-summary` (`:1386-1453`) | דוח GA4 מצרפי | GA4 Data API (‏`createRequire`, לא static import) | `configured:false` היא תוצאה תקינה שאינה שגיאה; שומרת את שרשרת ה-grpc מחוץ ל-bundle |

### פקודות callback-triage

| Verb | תיאור | Table/RPC | תכונת בטיחות מרכזית |
|---|---|---|---|
| `triage-claim` (`:963-987`) | תפיסת callback לצורך triage | RPC ‏`claim_callback_triage` | claim בצד השרת עם `FOR UPDATE SKIP LOCKED`; מחזיר רק `topic`/`note`/`attempt` — לעולם לא שם/טלפון |
| `triage-finish` (`:1006-1128`) | כתיבת תוצאת ה-triage | RPC ‏`finish_callback_triage` | מגודר על `--attempt` (CAS מול `triage_attempt_count`); `--evidence` חייב להיות תת-מחרוזת מילולית של ה-note (`:1037-1057`); תוצאות `finalized`/`claim_lost`/`already_finalized`/`claim_inactive`/`not_found` — רק `finalized` הוא exitCode 0 |

### פקודות goal

| Verb | תיאור | Table/RPC | תכונת בטיחות מרכזית |
|---|---|---|---|
| `goal-poll` (`:1252-1273`) | יעדים שהגיע זמנם עבור role | `SELECT fleet_goals` | משקף את שאילתת ה-due של ה-scheduler עצמו |
| `goal-progress` (`:1275-1330`) | קידום יעד בצעד אחד | RPC ‏`fleet_goal_progress` | CAS על `--step`; ל-`--next-wake-at` חייב offset UTC מפורש; תוצאות `advanced`/`paused_on_failures`/`stale_step`/`not_active`/`not_found` |
| `goal-close` (`:1332-1363`) | כתיבה סופית (terminal) ליעד | RPC ‏`fleet_goal_close` | CAS על `--step`; `completed`/`failed` בלבד |

## 3. מחזור-החיים של `fleet_requests`

מכונת-המצבים נאכפת ב-`supabase/migrations/20260723094500_fleet_requests.sql` וב-`20260727000620_fleet_requests_completed_status.sql`:

```text
INSERT (רק pending נקי, נאכף ב-guard)
pending  -> approved | denied | answered | expired | completed
approved | answered  -> completed   (טקסט הפסק-דין חייב להישאר PREFIX מילולי)
approved | denied | answered -> consumed   (דרך fleet_consume_request, CAS)
consumed / expired / completed הם מצבים סופיים
DELETE ו-TRUNCATE חסומים לכולם, כולל service_role, על-ידי triggers
```

שני מסלולי insert מזינים את אותה טבלה:

1. **ה-CLI** — `request`/`handoff` (service-role, דרך `insertAndNotify`).
2. **RPC של הבעלים** — `fleet_owner_request` (`20260729155911_fleet_owner_request.sql`, ‏SECURITY DEFINER, admin-only), שמסמן `payload.origin='owner'` ואופציונלית `payload.thread_root`.

הבעלים עונה **רק** דרך `fleet_answer_request` (SECURITY DEFINER עם בדיקת admin) — לדפדפן אין הרשאת UPDATE ישירה על הטבלה בכלל.

**Fan-out התראות** בעת `request`/`handoff`/`complete`: push לדפדפן לכל `user_roles.role='admin'` דרך `sendPushToUser` (best-effort, try/catch פר-אדמין, `notifyAdmins` ‏`:274-326`) + פוסט ב-Slack דרך `sendSlackAlert` (fail-safe, לעולם לא זורק — מאומת ב-`src/lib/alerts/slack.ts:38-41,366-390`). ה-`ts` המוחזר מ-Slack נשמר ב-`fleet_request_slack_threads`, כך שהתראות `complete`/`ack`/`triage-finish` עונות באותו thread במקום להיפתח כפוסט חדש ברמה העליונה.

## 4. concurrency ו-locking

בתוך `fleet-agent-cli.ts` עצמו אין שום נעילה — ה-concurrency נפתר שכבה אחת מעל: `run-role.sh` מחזיק `flock` **גלובלי** יחיד על `.fleet-logs/locks/global.lock` שמסדר בטור את *כל* הרצות ה-role (fleet-wide, לא per-role); פירוט מלא של מנגנון זה ושל ה-scheduler tick loop נמצא ב-`01-architecture-and-orchestration.md`.

רשת הביטחון האמיתית מפני כותבים מקבילים על אותה שורה היא **CAS ברמת ה-DB**, לא הנעילה בשכבת ה-shell:

- `fleet_consume_request` — `UPDATE…RETURNING` אטומי עם predicate על ה-status.
- אינדקס ייחודי על `fleet_requests.request_key` — הופך retries לאידמפוטנטיים.
- `finish_callback_triage` — גדר `triage_attempt_count` + claim עם `FOR UPDATE SKIP LOCKED`.
- `fleet_goal_progress`/`fleet_goal_close` — CAS על `step_count` (מונוטוני, נאכף ב-trigger `fleet_goals_guard`).

אלה מחזיקים גם מול שני invocations עצמאיים של `fleet-agent-cli.ts` שמתחרים זה בזה בלי שום נעילת filesystem מעורבת.

## 5. הרשאות ואישורי-גישה (credentials)

שני נתיבי credentials נפרדים לחלוטין — שמות בלבד, ללא ערכים:

- **`createAdminClient()`** (`src/lib/supabase/admin.ts:32-51`) בונה קליינט Supabase **service-role** מ-`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — **עוקף RLS לחלוטין**. המשמעות: כל תכונת-בטיחות שתוארה לעיל (בעלות, scoping, אידמפוטנטיות) נאכפת בקוד האפליקציה ובטריגרים/RPCs של ה-DB — **לא** על-ידי RLS.
- **`cmdSql`** (`:840-849`) משתמש בחיבור `pg` גולמי ונפרד — קבוצת credentials אחרת לחלוטין: `SUPABASE_DB_HOST`/`SUPABASE_DB_PORT`/`SUPABASE_DB_USER`/`SUPABASE_DB_PASSWORD`/`SUPABASE_DB_NAME` (credentials של ה-session pooler).

שתי הקבוצות נטענות דרך `node --env-file=.env.local` בכל מסלול הפעלה (סקריפט `fleet:agent`, ‏`run-context.sh:51,87`, ‏`scheduler.mjs → runCli` ‏`:256-265`). ה-roles עצמם לעולם לא מחזיקים את ה-credentials האלה ישירות — קריאת `.env*` חסומה בקובצי ההרשאות של כל tier בצי, לפי הערת הכותרת של הקובץ עצמו (`:5-8`).

## 6. טיפול בשגיאות

הקובץ נשמר משמעת קפדנית של כשל-רועש כברירת-מחדל: `fail()` (`:199-202`) תמיד עושה `console.error` ו-`process.exit(1)`; ה-handler העליון `main().catch()` (`:1558-1561`) עושה את אותו הדבר לכל דבר שלא נתפס. יש גם מוסכמת exit-code מכוונת בת שלוש רמות:

| Exit code | משמעות |
|---|---|
| **0** | הצלחה |
| **2** | no-op שפיר/צפוי (race על CAS שאבד, אין כלום ל-poll, no-op-by-design) |
| **1** | שגיאה קשה |

### ארבע פערים קונקרטיים

1. **שגיאה משנית מוסתרת במסלול הדדופ** (`insertAndNotify`, `:397-407`) — ב-unique-violation על `request_key`, ה-re-select של השורה הקיימת לעולם לא בודק את ה-`error` שלו עצמו. אם שאילתת ה-lookup הזו נכשלת (תקלת רשת רגעית, גליץ' זמני ב-DB), ה-CLI עדיין מדווח `{deduplicated:true, request:null}` ויוצא ב-0 — מסתיר כשל אמיתי מאחורי "דדופ תקין". כל שגיאת DB אחרת בקובץ נבדקת ומנותבת דרך `fail()`; המסלול הזה בלבד לא.
2. **`digest` תמיד מצהיר על הצלחה** (`:877-892`) — ערך ההחזרה של `sendSlackAlert()` (‏`string | null` — `null` בקונפיג מנוטרל, טוקן חסר, rate-limit או כשל שליחה, בכוונה "fail-safe") נזרק, וה-command מדפיס ללא תנאי `{posted: true, ...}`. ל-role או ללוח-הזמנים של chief-of-staff אין דרך לגלות שה-digest היומי נשמט בשקט — ה-CLI ידווח ההיפך.
3. **`withdraw` לא הולך לפי מוסכמת ה-no-op של הקובץ עצמו** (`:748-773`) — הערת הכותרת שלו (`:82-87`) מנסחת במפורש "בקשה שכבר לא pending" כ-no-op, אבל שלא כמו `ack`/`draft-reply`/`triage-finish`/`goal-progress`/`goal-close` — שכולם קובעים `process.exitCode = 2` עבור תוצאת ה-no-op המתועדת שלהם — `withdraw` משאיר exitCode על 0 גם ל-withdraw אמיתי וגם למקרה ה-no-op, כך שקורא לא יכול להבחין "ביטלתי" מ-"מישהו הקדים אותי" דרך קוד-ה-exit, רק על-ידי קריאת `withdrawn:false` ב-JSON.
4. **סחיפת תיעוד מול מימוש** — התקציר בראש הקובץ (`:20-107`) מפרט רק 15 subcommands ומשמיט לגמרי את `verdicts`, ‏`sql`, ‏`triage-claim` ו-`triage-finish`, למרות שכל ארבעתם ממומשים במלואם, מתועדים היטב ליד פונקציות ה-`cmd*` שלהם, ונוכחים ב-usage string של `main()` (`:1552-1554`).

**חשוב**: אף אחד מהפערים האלה **אינו** פער אבטחה. נתיב ה-`--attach` (מסונן דרך `/api/admin/fleet-file/route.ts`) איתן — admin-gated דרך `requirePlatformPermission`, מיושב-`realpath` ומאומת-prefix מול `.fleet-logs/drafts/` הן בכתיבה והן בהגשה, allowlist של MIME, תקרת 25MB, ‏`nosniff`. ופקודת ה-`sql` ה-read-only נהנית משתי שכבות אכיפה עצמאיות (text guard + טרנזקציית `READ ONLY` ממשית, שהיא הסמכותית מביניהן). ארבעת הפערים לעיל הם מטרדי correctness/observability, לא סיכוני אבטחה.

## 7. בדיקת טריות ה-bundle (`scripts/check-fleet-agent-bundle.mjs`)

הבדיקה מאמתת את ה-artifact **המקומפל מראש**, `dist/fleet-agent-cli.cjs` (לא את הקוד-מקור), על שלושה צירים:

- **קיים** בכלל.
- **≥1MB** — תופס esbuild שנקטע (דיסק מלא, כשל build חלקי).
- **≤4MB** — תופס מצב שבו שרשרת ה-gRPC של `@google-analytics/data` הופכת בטעות ל-static import במקום טריק ה-`createRequire` שבו נעשה שימוש ב-`:1367-1384` — ה-artifact האמיתי נמצא בסביבות 2.3MB.
- **חופשי מ-shim ה-`import.meta` של esbuild** (CJS) — shim כזה היה זורק `ERR_INVALID_ARG_VALUE` בזמן ריצה בדיוק ברגע שבו `scheduler.mjs`/`run-context.sh`/`main-inbox.sh` מפעילים אותו בפעם הבאה, headless וללא צופה.

זה קריטי כי קיימים **שני מסלולי הפעלה נבדלים** עם ערבויות-טריות שונות, וה-check מכסה רק את אחד מהם:

- **`npm run fleet:agent -- <cmd>`** (`package.json:23`) — build **וגם** run במכה אחת (esbuild ואז `node`), משמש אינטראקטיבית ועל-ידי roles לפי הערת הכותרת של הקובץ עצמו (`:7`). זה תמיד רץ מול artifact שזה-עתה נבנה מחדש, אך **לא** מריץ את `check-fleet-agent-bundle.mjs`.
- **`npm run fleet-agent:build`** (`package.json:24`) — build **ואז** verify (esbuild ואז הבדיקה ברמת-בייטים), בלי run. זה בדיוק מה ש-`npm run deploy` (`package.json:9`) משלב בשרשרת ה-deploy, מיד לפני `pm2 restart kalfa-fleet` ו-`kalfa-ops-agent`.
- **`scheduler.mjs`, `run-context.sh` ו-`main-inbox.sh`** כולם מריצים `node --env-file=.env.local dist/fleet-agent-cli.cjs ...` **ישירות**, בלי שום build משלהם — הם תלויים לגמרי במה ש-`fleet-agent:build` הפיק אחרון. לפני שהבדיקה הזו נוספה, `npm run deploy` מעולם לא בנה מחדש את ה-artifact הזה בכלל, כך שהוא התקדם רק כתופעת-לוואי של מישהו שמריץ `fleet:agent` ידנית.

## 8. ממצאים לתשומת לב

1. **שגיאה משנית מוסתרת בדדופ של `request`** — כשל בבדיקה החוזרת של שורה קיימת אחרי unique-violation על `request_key` יכול להיראות כמו דדופ תקין (exit 0) גם כשמדובר בכשל DB אמיתי (`insertAndNotify`, `:397-407`).
2. **`digest` לא מסוגל לדווח על כשל שקט של Slack** — כי ערך ההחזרה `string | null` של `sendSlackAlert()` נזרק ולא נבדק (`:877-892`); role שסומך על הפלט לא יכול לדעת שה-digest לא הגיע.
3. **`withdraw` לא עקבי עם שאר ה-CLI בקוד-exit ל-no-op** — בניגוד ל-`ack`/`draft-reply`/`triage-finish`/`goal-progress`/`goal-close`, ‏`withdraw` לא מגדיר `process.exitCode = 2` כשהבקשה כבר לא pending (`:748-773`), למרות שהערת הכותרת שלו עצמה מתארת את המצב הזה כ-no-op.
4. **סחיפת תיעוד מול מימוש בראש הקובץ** — התקציר (`:20-107`) משמיט את `verdicts`, ‏`sql`, ‏`triage-claim` ו-`triage-finish` לגמרי, אף שכולם ממומשים ומתועדים בקוד עצמו ונוכחים ב-usage string.

ארבעת הממצאים לעיל הם מטרדי correctness/observability בלבד — לא פערי אבטחה; שכבות האכיפה (`--attach` הממוגן ב-admin, ‏`sql` ה-read-only הכפול-מאומת) נבדקו ונמצאו איתנות.

---

*מסמך זה הוא חלק מסדרת `docs/fleet/`. אינדקס-על — `00-index.md`; מנוע התזמור (scheduler, tiers, hooks) — `01-architecture-and-orchestration.md`; קטלוג 16 ה-roles — `02-roles-catalog.md`; מצב תפעולי חי — `04-operational-status.md`.*
