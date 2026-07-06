# תוכנית פריסה — ‎@pg-boss/dashboard‎ (ממשק ניהול התזמונים)

**תאריך:** 2026-07-06 · **סטטוס:** מחקר ותכנון בלבד — טרם הותקן דבר · **היקף:** אפס קוד, אפס בנייה ידנית — חבילה רשמית בלבד

---

## 1. תקציר

הממשק הרשמי `@pg-boss/dashboard` (מאת timgit, מחבר pg-boss עצמו) הוא **שרת web עצמאי** שמותקן מ-npm ורץ כתהליך נפרד — מתאים בדיוק לדפוס הקיים אצלנו (pm2 + nginx). הוא מתחבר ישירות לסכימת `pgboss` הקיימת ב-Supabase, **בטוח מול הפרודקשן** (ללא מיגרציות, ללא polling, לא מפריע ל-`kalfa-worker`), ותומך ב-Basic Auth מובנה.

**הארכיטקטורה שהוכרעה (סופי, 2026-07-06):** בדיוק לפי הסכימה המובנית של החבילה, אפס קוד ידני — build רשמי מהמקור (תג `dashboard-1.6.1`) עם `PGBOSS_DASHBOARD_BASE_PATH=/admin/jobs`; תהליך pm2 נפרד **`kalfa-pgboss-ui`** על `127.0.0.1:3010`; ‏nginx מעביר את `/admin/jobs` ישירות ל-3010 בלי להסיר את ה-prefix; הגנה: ‏Basic Auth המובנה + TLS (+IP allowlist אופציונלי); פריט ניווט "משימות מתוזמנות" בפאנל האדמין. פירוט והסיכון המקובל: ‏§5.3.1.

---

## 2. המצב הקיים (מאומת בשרת + ב-DB החי)

| רכיב | מצב |
|---|---|
| pg-boss מותקן | `12.23.1` (declared `^12.21.2`) — עומד במינימום הנדרש (12.21) |
| Node בשרת | `24.18.0` (גם ב-pm2, `/usr/bin/node`) — עומד בדרישה `>=22.12.0` ✓ |
| סכימת DB | `pgboss` חיה ב-Supabase: job, job_common, queue, schedule, bam, job_dependency; ‎~44K jobs (רובם completed) |
| חיבור DB | session pooler‏ IPv4: `aws-1-ap-south-1.pooler.supabase.com:5432`, user `postgres.<ref>`, ‏`ssl: { rejectUnauthorized: false }` (משתני `SUPABASE_DB_*` ב-`.env.local`) |
| worker | `worker/main.ts` → esbuild → `dist/worker.cjs`, תהליך pm2 ‏`kalfa-worker`, ‏`max: 4` connections |
| תורים | outreach-arm / outreach-step / outreach-call-request / outreach-sweeper / outreach-dead / webhook-process + ‏3 crons‏ (`boss.schedule`) |
| חשיפה | nginx ‏`conf.d/beta-proxy.conf` ‏→ ‏`127.0.0.1:3002` (kalfa-beta) |
| פורטים תפוסים (localhost) | 3000, 3002, 3030 (ועוד); **3003 פנוי** |
| firewall מקומי | **קיים ופעיל** (תיקון 21:55 — הבדיקה המוקדמת הסתמכה על פלט חתוך): ‏Plesk Firewall + ‏imunify360, מדיניות INPUT=DROP עם allowlist ‏(80/443/8443/8447/8880/22/דואר/DB…). ‏**8444: פתוח בשרת, חסום אצל הספק (אבחון סופי 22:36)**: כלל Plesk ‏"Allow 8444" ‏(id 148) חי ב-iptables, אך ‏**חומת האש של IONOS ברמת הרשת מפילה את הפורט לפני שהחבילות מגיעות לשרת** — הוכח ב-tcpdump (אפס SYN על ה-wire בזמן בדיקת check-host מ-8 נקודות בעולם, כולן timeout; ביקורת חיובית על 443 באותה דקה — ‏SYN מגיע). הערה מתודולוגית: "האימות החיצוני" המוקדם ב-WebFetch היה false-positive — ‏WebFetch של Claude Code רץ **מהשרת עצמו** (‏IP המקור בלוג = ‏IP השרת); אימות חיצוני אמיתי = ‏check-host.net. תיקון: פתיחת 8444 בפאנל IONOS (‏Network → ‏Firewall Policies), או מעבר ל-443 ‏(§5.1). ‏`HOST=127.0.0.1` נשאר כהגנת עומק |
| הגנת אדמין קיימת | שכבת אפליקציה בלבד (`requireAdmin` / RPC ‏`has_role`) — לא זמינה לתהליך חיצוני ללא קוד נוסף |

## 3. זהות החבילה (ממצאי מחקר: Context7 + npm registry + README/מקור ב-GitHub)

- **שם:** `@pg-boss/dashboard` · **גרסה אחרונה:** 1.6.1 (פורסמה 2026-06-30; 16 גרסאות מאז 2026-02) — **מתוחזק פעיל**
- **מחבר:** timgit (מונורפו של pg-boss, ‏`packages/dashboard`) · **רישיון:** MIT · **תיעוד:** https://timgit.github.io/pg-boss/dashboard
- **ארכיטקטורה:** שרת עצמאי — React Router SSR + Hono; ships prebuilt‏ `build/`; ‏bin: ‏`pg-boss-dashboard`
- **מודל DB:** יוצר `pg.Pool` משלו (`max: 10`) + מופע PgBoss פנימי (bundled ‏`^12.24.1`) שמופעל עם `schedule:false, supervise:false, migrate:false, createSchema:false` — **קריאה/פעולות דרך API רשמי בלבד, ללא DDL, ללא polling, ללא הפרעה ל-worker**
- **יכולות UI:** סקירת תורים וסטטוסים, סינון משימות, פירוט משימה (payload/פלט/שגיאות), יצירה/ביטול/מחיקה/retry/resume של משימות, ניהול schedules ותורים, ריבוי DBs/סכימות ממסך אחד
- **תצורה — משתני סביבה בלבד:**

| משתנה | ברירת מחדל | הערה |
|---|---|---|
| `DATABASE_URL` | `postgres://localhost/pgboss` | חובה אצלנו |
| `PGBOSS_SCHEMA` | `pgboss` | ברירת המחדל תואמת אותנו |
| `PORT` | `3000` | אצלנו: **3003** |
| `HOST` | **`0.0.0.0` — גם ב-CLI וגם בשרת הפרודקשן!** | לא מתועד ב-README; אומת בקוד בתג `dashboard-1.6.1`‏ (`bin/cli.js` וגם `app/server.node.ts` ← ‏`build/server.js`). אצלנו: **127.0.0.1 חובה** |
| `PGBOSS_DASHBOARD_AUTH_USERNAME/_PASSWORD` | כבוי | Basic Auth; שניהם או כלום |
| `PGBOSS_DASHBOARD_BASE_PATH` | `/` | **build-time בלבד** — לא זמין בחבילת npm |
| `PGBOSS_DASHBOARD_QUERY_TIMEOUT` | `60000` | statement_timeout per-query |

## 4. נקודות קריטיות שהתגלו במחקר

1. **SSL אל ה-pooler נשלט אך ורק מה-connection string.** הקוד לא מגדיר `ssl` פרוגרמטית. כדי לשקף את `rejectUnauthorized:false` של ה-worker נדרש `?sslmode=no-verify` ב-`DATABASE_URL`. ‏(`sslmode=require` ב-node-postgres עדיין מנסה אימות CA וצפוי להיכשל מול Supabase.) — **פריט הולידציה הראשון.**
2. **ה-CLI מאזין על `0.0.0.0` כברירת מחדל** ובשרת אין firewall ⇒ הרצה "לפי ה-README" הייתה חושפת את הדשבורד לאינטרנט ללא TLS. חובה `HOST=127.0.0.1`.
3. **אין מצב read-only.** כל מי שניגש יכול לבטל/למחוק/להריץ מחדש משימות אמת. ⇒ הגנה כפולה לפחות (Basic Auth + הגבלת רשת), כפי שהמשתמש הגדיר.
4. **sub-path דורש build מקוד מקור** — חבילת npm אפויה עם base ‏`/`. ⇒ ‏`beta.kalfa.me/admin/jobs` ירד מהפרק (סותר את אילוץ "בלי קוד/בנייה ידנית").
5. **תאימות גרסאות:** מינימום 12.21 ✓ (לנו 12.23.1). אבל **גרפי metrics history ו-sparklines דורשים סכימת 12.24** — יהיו ריקים עד שדרוג ה-worker ל-`>=12.24.1` (bump מינורי; ה-`boss.start()` של ה-worker יריץ את מיגרציית הסכימה — דורש אישור נפרד).
6. **תקציב חיבורים:** ‏pool עד 10 חיבורים נוספים אל ה-session pooler (בנוסף ל-4 של ה-worker) — לא קונפיגורבילי.
7. **טאב Warning History** יישאר ריק בלי `persistWarnings: true` בקונפיג ה-worker (שינוי קוד עתידי, אופציונלי).
8. **ל-nginx של Plesk‏ (1.30.3) אין `http_auth_request_module`** (מקומפל עם ssl/realip/sub/dav/v2/v3 בלבד — אומת ב-`nginx -V`). ⇒ דפוס ה-auth_request הקלאסי לאימות סשן Supabase בשכבת nginx **אינו זמין**; שילוב מערכת המשתמשים הקיימת חייב לעבור דרך האפליקציה (ראו §5.3, אפשרות D).
9. **אין WebSocket/SSE בדשבורד** (אומת מול התלויות וקוד השרת — HTTP טהור: SSR + polling) ⇒ ניתן לעשות לו proxy דרך Route Handler של Next ללא מגבלה פרוטוקולית.

## 5. תוכנית הפריסה

### 5.1 התקנה — build רשמי מהמקור (שלב ביצוע, לאחר אישור)
הסכימה המובנית של החבילה ל-sub-path (‏README, "Serving under a sub-path") — סקריפטים של החבילה בלבד, אפס קוד שלנו:
```bash
cd /var/www/vhosts/kalfa.me
git clone --depth 1 --branch dashboard-1.6.1 https://github.com/timgit/pg-boss pgboss-dashboard-src
cd pgboss-dashboard-src/packages/dashboard
npm ci
PGBOSS_DASHBOARD_BASE_PATH=/admin/jobs npm run build   # react-router build + esbuild → build/
```
שדרוג עתידי = ‏checkout תג חדש + אותו build (דטרמיניסטי).

### 5.2 תצורה — קובץ env ייעודי, לא-committed
`/var/www/vhosts/kalfa.me/pgboss-dashboard-src/packages/dashboard/.env.pgboss-dashboard` (הרשאות 600, מחוץ ל-git):
```
DATABASE_URL=postgres://postgres.<ref>:<SUPABASE_DB_PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=no-verify
PGBOSS_SCHEMA=pgboss
PORT=3010
HOST=127.0.0.1
PGBOSS_DASHBOARD_BASE_PATH=/admin/jobs
PGBOSS_DASHBOARD_AUTH_USERNAME=<admin-user>
PGBOSS_DASHBOARD_AUTH_PASSWORD=<strong-random>
```
הזרקה דרך `node --env-file` (נתמך ב-Node 24) — בלי סקריפט wrapper ובלי סודות ב-`ecosystem.config.cjs` (שנמצא ב-git).

תוספת ל-`ecosystem.config.cjs` (תצורה, לא קוד):
```js
{
  name: 'kalfa-pgboss-ui',
  cwd: '/var/www/vhosts/kalfa.me/pgboss-dashboard-src/packages/dashboard',
  script: 'build/server.js',
  node_args: '--env-file=.env.pgboss-dashboard',
  env: { NODE_ENV: 'production' },
},
```
(תואם את עקרון ה-ecosystem הקיים: env מינימלי, כל תהליך טוען סודות בעצמו. הרצה כ-`npm start` של החבילה = ‏`node ./build/server.js` — זהה.)

תוספת nginx ב-`conf.d/beta-proxy.conf`, בתוך ה-server block הקיים, לפני `location /` (תצורה בלבד, משכפלת את דפוס ה-proxy הקיים בקובץ):
```nginx
location ^~ /admin/jobs {
    proxy_pass http://127.0.0.1:3010;   # ללא הסרת prefix — ה-build אפוי ל-/admin/jobs
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    # אופציונלי: allow <ip>; deny all;
}
```

### 5.3 חשיפה — הכרעה נדרשת

**דרישה מעודכנת (2026-07-06 ערב):** שילוב מערכת המשתמשים הקיימת (Supabase ‏`requireAdmin`), **ללא subdomain נוסף**.

| אפשרות | תיאור | משתמש במערכת המשתמשים? | חסרונות |
|---|---|---|---|
| **A. ‏SSH tunnel בלבד** | `ssh -L 3003:127.0.0.1:3003 <server>` → ‏`http://localhost:3003` | לא (Basic Auth בלבד) | גישה למחזיקי SSH בלבד; טוב כשלב ולידציה |
| **B. subdomain ‏(`pgboss.kalfa.me`)** | server block חדש → 3003, ‏TLS + Basic Auth + IP allowlist | לא | **נפסל — המשתמש ביקש ללא subdomain**; דרש גם DNS+cert |
| **C. ‏nginx sub-path + ‏sub_filter rewriting** | ‏location ‏`/admin/jobs/` עם שכתוב HTML בתעבורה | לא — אין `auth_request` ב-nginx של Plesk (§4.8) | שכתוב אפליקציית SSR ב-sub_filter שביר; נפסל |
| **D. ‏sub-path ‏`/admin/jobs` באותו דומיין (נבחר — וריאנט D1)** | build רשמי מהמקור עם base path + ‏nginx ישיר ל-3010 — פירוט ב-§5.3.1 | חלקית: פריט ניווט בפאנל; **האכיפה: Basic Auth המובנה** (אין `auth_request` ב-nginx; אכיפת סשן הייתה דורשת קוד — נדחה) | build מהמקור (רשמי); סיסמה משותפת כשער היחיד |
| **E. פורט נוסף (‏`beta.kalfa.me:8444`)** | server block על פורט נפרד באותו דומיין | לא (Basic Auth בלבד) | לא עונה לדרישה; פורט לא-סטנדרטי |

מסלול מומלץ: **A לולידציה → D לקבע**.

### 5.3.1 אפשרות D — הארכיטקטורה המוסכמת (אושרה עקרונית ע"י המשתמש, 2026-07-06 ערב)

עקרונות שהמשתמש קבע: הדשבורד נשאר **יישום עצמאי** (לא הטמעה נייטיבית, לא iframe, לא import לפאנל); פריט ניווט "משימות מתוזמנות" בפאנל הקיים; תהליך pm2 נפרד בשם **`kalfa-pgboss-ui`** על פורט **3010**; פרסום מאותו דומיין תחת **`/admin/jobs/`**; build מהמקור עם `PGBOSS_DASHBOARD_BASE_PATH=/admin/jobs` (לפי ה-README); הגנה כך ש**רק אדמין מערכת** ייכנס.

**בדיקת אי-כפילות (בוצעה, נקי):** פורט 3010 פנוי; ‏pm2 מכיל רק kalfa-beta + kalfa-worker; אין תיקיות `*pgboss*`/`*dashboard*` תחת `/var/www/vhosts/kalfa.me/`; ‏`@pg-boss/*` לא מותקן ב-node_modules; אין פריט ניווט/נתיב `/admin/jobs` קיים באפליקציה. אין מה שמתנגש — פריסה ראשונה.

**הכרעת המשתמש (2026-07-06, סופית): "אל תיצור קוד ידני — תפעל בדיוק לפי הסכימה המובנית של החבילה" ⇒ וריאנט D1.**

| וריאנט | זרימה | אכיפת "רק אדמין" | סטטוס |
|---|---|---|---|
| **D1 — ‏nginx ישיר (נבחר)** | ‏nginx ‏`location ^~ /admin/jobs` ‏→ ‏`127.0.0.1:3010` (ללא הסרת prefix) | **Basic Auth המובנה של החבילה** (+TLS הקיים; אופציונלי: ‏IP allowlist ב-nginx — תצורה, לא קוד) | **נבחר** |
| D2 — ‏proxy דרך Next | route handler דק עם `requireAdmin` לפני forward | מערכת המשתמשים הקיימת פר בקשה | נדחה — דורש קוד ידני; מתועד כחלופה עתידית בלבד |

**סיכון מקובל ומתועד (הוצף למשתמש והוכרע):** ל-nginx של Plesk אין `auth_request` ‏(§4.8), ולכן ב-D1 מערכת המשתמשים הקיימת **אינה נאכפת** על `/admin/jobs` — ההגנה היא Basic Auth (סיסמה משותפת חזקה) + TLS בלבד, והממשק מסוגל לבטל/למחוק/להריץ מחדש משימות. פריט הניווט בפאנל הוא קישור בלבד (מוצג לאדמינים בתפריט, אך אינו שער אבטחה). חיזוק אופציונלי ללא קוד: ‏`allow/deny` לפי IP ב-nginx.

```
דפדפן
  └─ https://beta.kalfa.me/admin/jobs/… ‏(TLS קיים)
       └─ nginx: location ^~ /admin/jobs → proxy_pass http://127.0.0.1:3010
          (ללא הסרת prefix; Basic Auth נאכף ע"י הדשבורד עצמו)
            └─ kalfa-pgboss-ui ‏(pm2, HOST=127.0.0.1, PORT=3010,
               build רשמי מהמקור, BASE_PATH=/admin/jobs)
פאנל האדמין (Next): פריט ניווט "משימות מתוזמנות" → קישור ל-/admin/jobs
pm2: kalfa-beta │ kalfa-worker (מבצע) │ kalfa-pgboss-ui (מציג)
```

הערת nginx: ‏`location ^~ /admin/jobs` (ללא סלאש סופי) תופס גם `/admin/jobs` וגם `/admin/jobs/...`, קודם ל-location ‏/ הקיים, ומצל על כל נתיב Next עתידי באותו prefix (אין כזה כיום — אומת). ה-location ישוכפל מתבנית ה-proxy הקיימת בקובץ (headers, buffers).

**רכיבי הביצוע:**
1. **Build רשמי מהמקור**: ‏clone של timgit/pg-boss בתג **`dashboard-1.6.1`** → ‏`cd packages/dashboard && npm ci && PGBOSS_DASHBOARD_BASE_PATH=/admin/jobs npm run build` (סקריפטים של החבילה עצמה — אפס קוד UI שלנו). מיקום מוצע: `/var/www/vhosts/kalfa.me/pgboss-dashboard/`. שדרוג עתידי = checkout תג חדש + rebuild.
2. **pm2 ‏`kalfa-pgboss-ui`**: הרצת תוצר ה-build (`node build/server.js`) עם `node_args: --env-file=…/.env.pgboss-dashboard`; ‏env: ‏`DATABASE_URL(?sslmode=no-verify)`, ‏`PGBOSS_SCHEMA=pgboss`, ‏`PORT=3010`, ‏`HOST=127.0.0.1`, ‏`PGBOSS_DASHBOARD_BASE_PATH=/admin/jobs` (נדרש גם בזמן ריצה), ‏Basic creds.
3. **פריט ניווט** "משימות מתוזמנות" בפאנל האדמין הקיים → ‏`/admin/jobs`.
4. **שכבת אכיפה** לפי ההכרעה D1/D2 (לעיל). ב-D2: ‏route handler דק יחיד, ‏requireAdmin בתוך ה-handler (layout של `(admin)` אינו חל על route handlers).
5. **הגנה כפולה בכל מקרה**: ‏Basic Auth פעיל על 3010 (ב-D2 הסוד נשאר ב-env בצד השרת; הדפדפן לא רואה אותו).

**אימות ייעודי (בנוסף ל-§5.4):** נכסי static נטענים תחת `/admin/jobs/`; פעולות POST ‏(retry/cancel) עוברות; ‏302 פנימיים נשארים בתוך ה-base path; אין בעיות buffering ב-polling; ב-D2 — אימות streaming ב-route handlers מול תיעוד Next המותקן (`node_modules/next/dist/docs/`) לפני מימוש; ‏401 ללא סשן אדמין; ‏RPC ‏`has_role` פר בקשה (עומס זניח לכלי אדמין).

**אופציה עתידית (מחוץ להיקף, לתיעוד):** אם יידרש מסך שנראה נייטיבי לחלוטין בפאנל — הדרך הרשמית היא UI משלנו מעל **`@pg-boss/proxy`** ‏(v1.5.0, ‏REST API רשמי מעל פעולות pg-boss, ‏OpenAPI/Swagger מובנה) — לא בנייה ידנית מעל הסכימה. הדשבורד הרשמי נשאר כלי תפעולי לאדמין מערכת, לא UI אינטגרלי.

### 5.4 סדר ביצוע ואימות (לשלב הביצוע)

> **סטטוס ביצוע (2026-07-06 21:10):** שלב A הושלם ✓ — המשתמש התקין `@pg-boss/dashboard@1.6.1` (גרר `pg-boss@12.25.1` ב-node_modules; ‏package.json עודכן, לא-committed). ‏`.env.pgboss-dashboard` נוצר (600). הרצת בדיקה חד-פעמית: האזנה על `127.0.0.1:3010` בלבד ✓; ‏401 בלי credentials ✓; ‏200 עם Basic ✓; **‏`sslmode=no-verify` מול ה-pooler עובד ✓; מופע 12.25 עם `migrate:false` קורא את סכימת 12.23 ומציג את כל 6 התורים ✓** (שתי השאלות הפתוחות נסגרו); לוג worker נקי ✓; חיבורי Supavisor ‏4→10 (pool הדשבורד, בתקציב) ✓. התהליך נעצר והפורט שוחרר. **עדכון (21:20):** המשתמש הריץ `npm run deploy` — ה-worker עלה עם 12.25.1 ומיגרציית הסכימה רצה נקי ✓: ‏`pgboss.version=36`, נוספו טבלאות `queue_stats` (+פרטיציות יומיות — התשתית לגרפי ההיסטוריה/sparklines), ‏`subscription`, ‏`warning`; לוג worker נקי ("queues + schedules up"). סעיף השדרוג מ-§8 סגור.
>
> **עדכון (21:29) — הדשבורד פרוס כתהליך pm2 קבוע ✓:** לפי הנחיית המשתמש, חבילת ה-npm הופעלה דרך ה-CLI שלה כ-pm2 ‏**`kalfa-pgboss-dashboard`** (start נקי עם `env -i` לפי נוהל ה-ecosystem, ‏`--node-args=--env-file=…`, ‏`--time`). שלוש הבדיקות עברו: ‏online (0 restarts, לוג שגיאות ריק) ✓; האזנה `127.0.0.1:3010` בלבד ✓; ‏401 בלי / ‏200 עם Basic ✓ — ואז `pm2 save`. גישה נוכחית: ‏SSH tunnel בלבד (שלב A קבוע). ‏**nginx תחת `/admin/jobs` במכוון לא נוסף** — החבילה בנויה ל-`/`.
>
> **הכרעה סופית (21:35) — פורט ייעודי במקום sub-path, ללא build מהמקור:** כשעמד ה-build מהמקור לביצוע, המשתמש שאל "האם זו הדרך היחידה?" ובחר בחלופה שהוצגה: **`https://beta.kalfa.me:8444`** — ‏server block שלישי ב-`conf.d/beta-proxy.conf` (‏8443 = פאנל Plesk, נבדק) עם ה-cert הקיים → ‏`127.0.0.1:3010`. אפס build, החבילה נשארת מ-npm, שדרוגים = ‏`npm update`. אומת חי: האזנה ✓, ‏401/200 ✓, ‏TLS ‏Let's Encrypt ✓, ‏8444 ייחודי בכל עץ nginx ✓. תוכנית ה-build מהמקור (§5.1) נשמרת כמסלול עתידי אם יידרש URL בנתיב-משנה.
>
> **הפריסה התקנית הושלמה (21:45):** פריט ניווט "משימות מתוזמנות" בפאנל האדמין (מונע-env: ‏`PGBOSS_DASHBOARD_URL` ב-`.env.local`, מוצג רק כשמוגדר; קישור חיצוני ב-target חדש); ‏`persistQueueStats: true` + ‏`persistWarnings: true` בקונפיג ה-worker; ‏deploy מלא (934/934 בדיקות, ‏lint ‏0/0, ‏tsc נקי); ‏`queue_stats` החל להתאכלס תוך דקה (7 snapshots ראשונים) ✓. **תוקנן (21:50):** ‏`kalfa-pgboss-dashboard` נוסף ל-`ecosystem.config.cjs` (script ‏cli.js, ‏node_args ‏--env-file, ‏time, ‏autorestart) — שלושת התהליכים מוגדרים כעת מאותו מקור תצורה. ‏`pm2 startOrReload --only` עדכן את התהליך הקיים (אותו id, ללא כפיל), ‏beta/worker לא הושפעו, ‏401/200 אומתו, ‏`pm2 save` בוצע. הפריסה שחזורית במלואה.
1. ‏clone + ‏build מהמקור לפי §5.1 (תג `dashboard-1.6.1`).
2. יצירת `.env.pgboss-dashboard` (chmod 600) — **בדיקת החיבור הקריטית:** הרצה ידנית חד-פעמית `node --env-file=.env.pgboss-dashboard build/server.js` ואימות: התחברות ל-pooler עם `sslmode=no-verify`, טעינת תורים מסכימת 12.23.1, האזנה על `127.0.0.1:3010` בלבד (`ss -tlnp | grep 3010`).
3. ולידציה דרך SSH tunnel ‏(`ssh -L 3010:127.0.0.1:3010`): ‏UI נטען תחת `/admin/jobs/`, נכסי static תקינים (base path), ‏Basic Auth מחזיר 401 בלי credentials, פעולת קריאה בלבד (ללא retry/delete בפרודקשן).
4. בדיקת אי-הפרעה: `pm2 logs kalfa-worker` נקי; ספירת חיבורי pooler לפני/אחרי.
5. הוספת `kalfa-pgboss-ui` ל-`ecosystem.config.cjs` + ‏clean start לפי הנוהל המתועד בקובץ + ‏`pm2 save`.
6. תוספת ה-location ל-`conf.d/beta-proxy.conf` ‏(§5.2) + ‏`nginx -t` + ‏reload (שינוי תשתית — באישור); בדיקות מהדפדפן: ‏401→200, ניווט פנימי, ‏POST‏ (retry על job בדיקה בלבד), ‏302 נשארים ב-base path.
7. פריט ניווט "משימות מתוזמנות" בפאנל האדמין → קישור ל-`/admin/jobs` (שינוי UI מינימלי בפאנל הקיים).
8. עדכון `docs/` תפעולי.

### 5.5 שדרוגים אופציונליים (החלטות נפרדות)
- ~~pg-boss ‏→ ‏`>=12.24.1`~~ **בוצע** (12.25.1, סכימה v36 — ראו סטטוס ב-§5.4).
- **`persistQueueStats: true`** בקונפיג ה-PgBoss של ה-worker — **נדרש כדי שגרפי ההיסטוריה/sparklines יתאכלסו!** נמצא באימות (2026-07-06 21:25): הדגל כבוי כברירת מחדל, ולכן `pgboss.queue_stats` נשארת ריקה גם אחרי המיגרציה; הסטטיסטיקות השוטפות (cache בטבלת `queue`, ‏`monitorIntervalSeconds`=60) כן מתעדכנות ואומתו טריות. ‏retention ברירת מחדל: 7 ימים (`queueStatRetentionDays`). שינוי קוד של שורה בקונפיג `worker/main.ts` — באישור.
- **`persistWarnings: true`** בקונפיג ה-PgBoss של ה-worker — מזין את Warning History (טבלת `warning` קיימת מהמיגרציה, ריקה עד ההפעלה). שינוי קוד קטן — באישור.

## 6. סיכונים ומענים

| סיכון | מענה |
|---|---|
| חשיפת פורט ציבורית (CLI default ‏0.0.0.0, אין firewall) | `HOST=127.0.0.1` מפורש + אימות `ss -tlnp` בכל שינוי |
| כשל SSL מול pooler | ולידציה ידנית לפני pm2 (צעד 2); ‏fallback: ‏בדיקת `sslmode` חלופי |
| פעולות כתיבה על jobs בפרודקשן | Basic Auth חזק + הגבלת רשת; מודעות שאין read-only |
| מיצוי חיבורי pooler | ניטור; הדשבורד מוגבל ל-max 10; כיבוי התהליך כשאינו בשימוש אפשרי |
| אינטראקציית מופע 12.24 מול סכימת 12.23 | ‏smoke test (צעד 2); שדרוג worker ל-12.24.1 בהמשך |
| סודות ב-git | סודות רק ב-`.env.pgboss-dashboard` (לא-committed); ‏ecosystem נשאר נקי |

## 7. מה במפורש לא נעשה בשלב זה
לא הותקנה החבילה, לא נוצר env, לא שונו ecosystem/nginx/DNS, לא שודרג pg-boss. הכל ממתין לאישור לפי CLAUDE.md (שינויי תשתית/DNS באישור מפורש בלבד).

## 8. הכרעות שהתקבלו + שאלות פתוחות
**הוכרע (2026-07-06):** ארכיטקטורה D1 — בדיוק לפי הסכימה המובנית של החבילה, אפס קוד ידני; ‏`/admin/jobs`; ‏pm2 ‏`kalfa-pgboss-ui`; פורט 3010; ‏nginx ישיר ללא הסרת prefix; ‏Basic Auth מובנה; ללא iframe; ללא subdomain. הסיכון (אכיפה ללא מערכת המשתמשים) הוצף והתקבל.

**נותר להכרעה לפני ביצוע:**
1. אישור להתחיל את שלב הביצוע (§5.4) — כולל שינוי nginx (תשתית, באישור מפורש).
2. ‏IP allowlist ב-nginx — להפעיל? אילו כתובות?
3. אישור לשדרוג pg-boss ל-12.24.1 (כולל מיגרציית סכימה אוטומטית בעליית ה-worker) — עכשיו או בהמשך? (בלעדיו — גרפי metrics history ריקים)
4. מיקום המקור: ‏`/var/www/vhosts/kalfa.me/pgboss-dashboard-src/` (מוצע, מחוץ לריפו beta) — מאושר?

---
*מקורות: Context7 (pg-boss), npm registry ‏(`@pg-boss/dashboard@1.6.1`), ‏README + קוד מקור ‏(`bin/cli.js`, ‏`server.js`) ממונורפו timgit/pg-boss, אינטרוספקציה של השרת וה-DB החי. מחקר בוצע ע"י סוכן מחקר ייעודי + אימות ישיר.*
