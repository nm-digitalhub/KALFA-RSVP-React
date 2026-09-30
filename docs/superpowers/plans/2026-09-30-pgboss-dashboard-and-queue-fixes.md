# מסך המשימות ותור המשימות: תיקון הקוד הידני

**סטטוס:** תוכנית לאישור, 30.9.2026. עוד לא בוצע שום דבר.

**מקורות:**
- `docs/superpowers/plans/2026-09-30-pgboss-handrolled-audit.md`
- תיעוד רשמי דרך ctx7: Supabase (`/websites/supabase_guides`) ו-PostgreSQL 17 (`/websites/postgresql_17`, כמו הגרסה החיה 17.6; תוקן 30.9 אחרי שנקרא בטעות תיעוד 18)
- pgboss.io
- החבילה `@pg-boss/dashboard` בגרסה 1.9.0, שמותקנת כבר בפרויקט
- מדידות חיות, 30.9, בקריאה בלבד

## עובדות שנמדדו (30.9)

| נושא | תוצאה | מקור |
|---|---|---|
| גרסת הסכמה של pg-boss בבסיס הנתונים | 42 | `select version from pgboss.version` |
| pg-boss של הפרויקט (worker ו-web) | 12.33.5, סכמה 42 | `node_modules/pg-boss/package.json` |
| הדשבורד שמותקן בפרויקט | `@pg-boss/dashboard` 1.9.0. בתוכו pg-boss מוטמע עם `pgboss: { schema: 42 }` שתואם לבסיס הנתונים. אין בו אף import ב-src. הטווח ב-package.json הוא `^1.6.1` | `build/server/index.js:22202` |
| pool החיבורים של הדשבורד | `max: 10` קבוע בקוד, בלי משתנה סביבה שמשנה אותו | `build/server/index.js:16641` |
| הדשבורד הנוכחי (ה-clone) | מתחבר ל-pooler במצב session, פורט 5432 | `.env.pgboss-ui` |
| מגבלת session mode לפי Supabase | כמות הלקוחות מוגבלת ל-"Pool Size" לכל צירוף של role ו-database | supabase.com/docs/guides/database/prisma/prisma-troubleshooting |
| Transaction mode לפי Supabase | פורט 6543. מחזיק יותר חיבורים. prepared statements עם שם לא נתמכים. חיבור שלא היה בשימוש 5 דקות נסגר | supabase guides, Supavisor FAQ |
| חיבורים חיים | Supavisor: 13 idle | `pg_stat_activity` |
| `max_connections` | 60 | `current_setting` |
| טבלת המשימות | `pgboss.job_common`: 101,354 שורות חיות, רק 1,524 מתות, autovacuum אחרון 30.9 00:01. `backend_xmin` הכי ישן: 0. אין טרנזקציה ארוכה | `pg_stat_user_tables`, `pg_stat_activity` |
| המסקנה לגבי אזהרת הניטור | אין bloat ואין xmin שנתקע. הסריקה איטית פשוט כי יש הרבה שורות, כך שהפתרון הוא לקצר את זמן השמירה. זה תואם את ההנחיה של pg-boss ("shrink the job table") ואת תיעוד autovacuum (`autovacuum_naptime` = דקה) | pgboss.io/api/events, postgresql.org/docs/17/runtime-config-autovacuum (סף autovacuum: 50 + 20% מהשורות, וניתן לשנות לכל טבלה בנפרד) |
| זמן שמירה של משימות שהסתיימו | `deletion_seconds` = 604800, כלומר 7 ימים, בכל התורים. זו ברירת המחדל, ואין הגדרה משלנו | `pgboss.queue` |
| policy של singleton | כל התורים שהקוד מגדיר כ-singleton הם באמת singleton | `pgboss.queue` מול `worker/main.ts:1026-1070` |

**שורה 6 בדוח הביקורת (חשש לסחיפה של policy) נבדקה: אין בעיה.**

## השלבים

כל שלב נפרס ונבדק בנפרד. אם שלב נכשל, עוצרים.

### שלב 1: המסך הרשמי בתוך האתר, לצד הישן

- **נעילת גרסה:** `"@pg-boss/dashboard": "1.9.0"` בגרסה מדויקת, בלי `^`. `serverExternalPackages` ב-`next.config.ts` מקבל את `@pg-boss/dashboard`.
- **handler יחיד:** `src/lib/pgboss/dashboard-handler.ts`, server-only, שמור ב-`globalThis`:
  - `createDashboardHandler({ databases: [{ url, name: 'kalfa', schema: 'pgboss' }], basePath: '/admin/jobs', allowedActionOrigins: [host] })`.
  - ה-`url` נבנה מאותם משתני סביבה `SUPABASE_DB_*` שה-worker משתמש בהם, אבל **עם פורט 6543 (transaction mode)**. כך עשרת החיבורים של הדשבורד לא תופסים מקום ב-session pool. זה מבוסס על תיעוד Supabase.
  - לגבי prepared statements: הספרייה `pg` לא משתמשת ב-prepared statements עם שם, אלא אם נותנים לה `name`, ולכן זה אמור לעבוד ב-transaction mode. בודקים את זה בשלב 3.
- **שני ה-routes:** `/admin/jobs/[[...path]]` ו-`/admin/jobs.data`. השורה הראשונה בכל אחד היא `await requirePlatformPermission('manage_settings')`, ואחריה `return dashboard(request)`.
- **כיבוי:** `close()` נקרא בכיבוי, מתוך `src/instrumentation.ts`.
- **בדיקת גרסאות:** טסט שמשווה את `pgboss.schema` המוטמע בדשבורד ל-`pgboss.schema` של `node_modules/pg-boss`. אם הם שונים, הטסט נכשל. זו ההגנה שמונעת את התקלה של היום.
- **הישן נשאר:** האפליקציה הישנה ממשיכה לרוץ, רק בלי נתיב שמוביל אליה. `dashboard-proxy.ts` נמחק רק בשלב 7.

### שלב 2: בדיקות סטטיות

- `lint`, `tsc`, `build` (webpack), והטסטים הרלוונטיים.

### שלב 3: בדיקה חיה, אחרי פריסה

- **הרשאות:** בלי התחברות, התשובה היא הפניה או 403.
- **דפים:** עם הרשאה, `/admin/jobs`, `/admin/jobs.data`, דף משימה ודף schedules מחזירים 200.
- **הגנה מפני שליחה זרה:** בקשת POST עם Origin זר נדחית.
- **דפדפן:** בדיקה בדפדפן אמיתי, בכל הלשוניות, כולל Retry ו-Send Job על תור בדיקה.
- **חיבורים:** בזמן הגלישה בודקים ב-`pg_stat_activity` שהחיבורים החדשים הם דרך transaction mode, ושה-session pool לא התמלא.

### שלב 4: זמן שמירה של משימות (מתקן את האזהרה)

- **קודם תיקון התלות:** מעבירים את בדיקת "משימה תקועה" (`queue-schedule.ts`, `summary.ts`, `ops_job_health`) ל-`getSchedules()` ו-`previewSchedule()`, במקום המפה הידנית ו-`lastCompletedOn` מתוך טבלת המשימות. זה מתקן גם את ההתראה השגויה על משימות שבועיות וחודשיות אחרי 7 ימים.
- **אחר כך הקיצור:** `updateQueue(name, { deleteAfterSeconds })` לתורים הגדולים, ובראשם `outreach-arm`, `workflow-schedule-sweep`, `webhook-process` וה-sweeps שרצים כל דקה. הערך המוצע הוא יום אחד.
  - לגבי `__pgboss__send-it`, התור הפנימי של המתזמן: לבדוק בתיעוד אם מותר לשנות לו את ההגדרה. אם לא, לא נוגעים בו.
- **בדיקה:** כעבור יום, מספר השורות ב-`job_common` וזמן הסריקה של הניטור יורדים, והאזהרה לא חוזרת.

### שלב 5: התראה על אזהרות

- `boss.on('warning', …)` שולח התראה ל-Slack, עם אותו מנגנון התראות שכבר קיים.

### שלב 6: קוד ידני נוסף

- **`worker/pgboss-meta.ts`:** מוחלף ב-`work(..., { includeMetadata: true })`. בודקים שהטסטים של `callRequest` נשארים ירוקים.
- **הערה ישנה:** מתקנים את ההערה ב-`worker/main.ts:960`.

### שלב 7: פירוק הישן (דורש אישור נפרד)

- מסירים את `kalfa-pgboss-ui` מ-pm2 ומ-`ecosystem.config.cjs`.
- מוחקים את `dashboard-proxy.ts` ואת `PGBOSS_DASHBOARD_UPSTREAM`.
- ה-clone עובר לארכיון.
- מעדכנים את הזיכרון `pgboss-dashboard-version-coupling`.


## שיטת העבודה המומלצת לפי התיעוד הרשמי (pgboss.io, נקרא 30.9) מול המצב אצלנו

| נושא | מה התיעוד אומר | אצלנו (נמדד בקוד) | פער |
|---|---|---|---|
| זמן שמירה | `deleteAfterSeconds` ברירת מחדל 7 ימים (משימות שהסתיימו), `retentionSeconds` ברירת מחדל 14 ימים (משימות שממתינות). אפשר לשנות אותם ב-`updateQueue`. ההמלצה: לא לרדת מתחת לכמה דקות אם נשענים על ספירות תפוקה | לא מוגדר בשום תור, `worker/main.ts:1096-1104` | כן. זה התיקון לאזהרה (שלב 4) |
| חלוקה לטבלאות נפרדות (`partition`) | מומלץ "for large queues in order to keep it from being a noisy neighbor". אפשר להגדיר רק ביצירת התור, `updateQueue` לא משנה את זה | לא בשימוש | שלב אחרי קיצור זמן השמירה, רק אם האזהרה נמשכת |
| תזמון | "Schedules are checked every 30 seconds". כל תזמון שולח לכל היותר משימה אחת בדקה. האפשרות `missed: skip/once` קובעת מה קורה עם ריצות שהוחמצו בזמן נפילה | 4 תורים כל דקה, 7 תורים כל 5 דקות | כל פעימה של התזמון יוצרת גם שורה פנימית (`__pgboss__send-it`, 51 אלף ב-7 ימים). פחות פעימות = פחות שורות. הסוכן בודק את זה בקוד המקור |
| תגובה מיידית | `useListenNotify: true` ו-`notify: true` ברמת התור: עובד מתעורר "the moment a job is created", והבדיקה המחזורית נשארת כגיבוי. מחייב חיבור session, כי LISTEN לא עובד ב-transaction pooler | לא בשימוש. בדיקה מחזורית כל 10 או 30 שניות (`POLL_MINUTE_CRON`, `POLL_SLOW_CRON`, `worker/main.ts:902-903`). ה-worker מחובר ב-session mode בפורט 5432, כך שזה אפשרי | תור שמופעל מאירוע (למשל עיבוד webhook) יכול לקבל משימה ברגע שהאירוע נשמר, במקום תזמון כל דקה. זה חוסך כ-1,440 משימות ביום לכל תור כזה |
| אזהרות | `on('warning')` עם הסוגים `monitor_backoff`, `xmin_horizon`, `queue_backlog`, `slow_query`, `index_bloat`, `autovacuum_disabled`, `invalid_schedule`. ההמלצה לכל סוג מופיעה בתיעוד | `persistWarnings: true` (האזהרות נשמרות), אבל אין מאזין שמתריע | שלב 5 |
| ניטור | `monitorIntervalSeconds` ברירת מחדל 60, `monitorVacuum` ברירת מחדל true | 300 שניות, `persistQueueStats: true` | אין פער |
| הפרדת תפקידים | מומלץ להריץ מופעי worker עם `supervise: false` ומופע נפרד לתזמון | ה-web וה-owner-agent רצים עם `supervise: false`, וה-worker אחראי על הכול | תואם |
| מטא-דאטה של משימה | `includeMetadata` ב-`work()` מחזיר retryCount, retryLimit ו-state | שאילתה ידנית ב-`worker/pgboss-meta.ts` | שלב 6 |

## סיכונים

- **transaction mode ו-pg-boss:** ייתכן שה-pg-boss המוטמע בדשבורד לא עובד ב-transaction mode. שלב 3 בודק את זה. אם זה לא עובד, חוזרים ל-session mode עם pool קטן, והמגבלה של `max: 10` הקבוע היא סיכון שמדווחים עליו.
- **שדרוג עתידי של pg-boss:** טסט השוויון נכשל עד שמשדרגים גם את הדשבורד לגרסה עם אותה סכמה. זו ההתנהגות הרצויה.

## החזרה לאחור

- **שלבים 1 עד 3:** הישן עדיין רץ, כך שאפשר להחזיר את שני קבצי ה-route.
- **שלב 4:** `updateQueue` חוזר ל-604800.
- **שלב 7:** השלב היחיד שבלתי הפיך בפועל. גם אחריו ה-clone נשאר בארכיון.
