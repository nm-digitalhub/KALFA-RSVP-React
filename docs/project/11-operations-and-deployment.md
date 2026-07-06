# 11 — תפעול, פריסה ותשתית (Operations, Deployment & Infrastructure)

מסמך זה מתעד את תשתית ההרצה של KALFA Event Magic בסביבת ה-beta:
אירוח, תהליך הפריסה, ה-worker, משתני סביבה, כלי Supabase, צנרת האימות,
סקריפטים תפעוליים, ניטור ומלאי השירותים החיצוניים.

כל העובדות במסמך אומתו מול קבצים ומצב מערכת חיים בתאריך 2026-07-02
(`pm2 jlist`, `/etc/nginx/conf.d/beta-proxy.conf`, `package.json`, קוד המקור).
היכן שהמקור הוא ידע תפעולי מצטבר ולא קובץ — הדבר מסומן במפורש.

---

## 1. טופולוגיה כללית

```text
Internet (HTTPS)
   │
   ▼
nginx  — /etc/nginx/conf.d/beta-proxy.conf
   │    listen 217.154.17.185:443 ssl (http2), server_name beta.kalfa.me
   │    proxy_pass → http://127.0.0.1:3002
   ▼
pm2 "kalfa-beta"  — next start -H 127.0.0.1 -p 3002   (Next.js 16, webpack build)
pm2 "kalfa-worker" — node dist/worker.cjs             (pg-boss, outreach + webhooks)
   │
   ▼
Supabase (PostgreSQL + Auth, פרויקט חי מקושר, region ap-south-1)
```

שני התהליכים רצים תחת המשתמש `kalfa.me`, עם `cwd` בתיקיית הריפו
`/var/www/vhosts/kalfa.me/beta`.

---

## 2. אירוח: nginx + pm2 (`kalfa-beta`)

### 2.1 תהליך האפליקציה

`pm2 jlist` (אומת חי) מראה:

| process | script | args | interpreter |
|---|---|---|---|
| `kalfa-beta` | `node_modules/.bin/next` | `start -H 127.0.0.1 -p 3002` | — |
| `kalfa-worker` | `dist/worker.cjs` | — | `/opt/plesk/node/24/bin/node` (Node 24) |

האפליקציה מאזינה **רק** על `127.0.0.1:3002` — אין חשיפה ישירה לאינטרנט;
כל התעבורה עוברת דרך nginx. פקודות pm2 נוחות מוגדרות ב-`package.json`:
`pm2:status`, `pm2:logs`, `pm2:restart`, `pm2:reload`, `worker:logs`.

### 2.2 קונפיגורציית nginx

הקובץ הפעיל: `/etc/nginx/conf.d/beta-proxy.conf`. נקודות מפתח (מתוך הקובץ עצמו):

- `server_name beta.kalfa.me`, האזנה על `217.154.17.185:443` עם `http2 on`.
- תעודות Let's Encrypt מנתיב מודול Plesk:
  `/opt/psa/var/modules/letsencrypt/etc/live/beta.kalfa.me/`.
- בלוק `:80` נפרד שמחזיר `301` ל-HTTPS ומשרת `/.well-known/acme-challenge/`
  לחידוש תעודות.
- `client_max_body_size 25M`, timeouts של 300 שניות (read/connect/send).
- תמיכה ב-WebSocket דרך `map $http_upgrade` + כותרות `Upgrade`/`Connection`.
- כותרות פרוקסי מלאות: `Host`, `X-Real-IP`, `X-Forwarded-For`,
  `X-Forwarded-Proto https`, `X-Forwarded-Host`.

### 2.3 תיקון ה-502 בנתיבי `/admin` (proxy buffers)

מסלולי `/admin` מאומתים פולטים כותרות `Set-Cookie` גדולות — עוגיות ה-auth
המפוצלות של Supabase (`sb-<ref>-auth-token.0/.1/…`). גודלן המשולב עולה על
באפר ברירת-המחדל (~8k) של nginx, מה שגרם בעבר ל-
`upstream sent too big header … 502`. התיקון (מיושם ומתועד בהערה בתוך הקובץ):

```nginx
proxy_buffer_size       32k;
proxy_buffers           16 16k;
proxy_busy_buffers_size 64k;
```

בלוק התגובה כולו של ה-upstream חייב להיכנס ל-`proxy_buffer_size` יחיד —
לכן ההגדלה. אין לצמצם ערכים אלה בלי לוודא שוב את תרחיש ה-`/admin`.

### 2.4 היחס ל-Plesk

השרת מנוהל על ידי Plesk, אבל **beta.kalfa.me אינו מנוהל דרך Plesk**:
הקובץ ב-`conf.d/` נטען לפני `zz010_psa_nginx.conf` ולכן **מצל (shadows) את
ה-vhost של Plesk** (כך כתוב בהערה בראש הקובץ). אזהרת `server_name conflict`
שמציג Plesk היא קוסמטית בלבד — הקונפיגורציה הפעילה היא `beta-proxy.conf`.
אין לערוך את האתר דרך ממשק Plesk.

---

## 3. ה-worker: `kalfa-worker` (pg-boss)

### 3.1 מה הוא עושה

`worker/main.ts` הוא תהליך ארוך-חיים יחיד שמחזיק את כל צד ה-pg-boss:
שכבת ה-web נשארת נקייה מ-pg-boss לחלוטין. תפקידיו:

- הרצת לוח הזמנים של קמפייני outreach לכל איש קשר
  (WhatsApp → המתנה → תזכורות → הסלמה לשיחה → עצירה על reach מחויב).
- ניקוז `webhook_inbox` בדפוס persist-then-process (עיבוד כלכלי out-of-band,
  כשל בשורה אחת לא חוסם את השאר, ולעולם לא נרשם payload ללוג).
- Arm/Sweep עצמי-מרפא: תזמון אידמפוטנטי דרך deterministic job ids.

תורים (מוגדרים ב-`src/lib/queue/queues.ts`): `outreach-arm`, `outreach-step`,
`outreach-call-request`, `outreach-sweeper`, `outreach-dead` (dead-letter),
`webhook-process`. תזמוני cron: `arm` ו-`webhook` כל דקה, `sweeper` כל 5 דקות.
מדיניות retry לצעדים: 3 ניסיונות עם backoff ואז dead-letter.
ה-worker אינרטי עד שהדגל `outreach_enabled` דולק (`stepGate` נכשל-סגור),
ולכן בטוח להריץ אותו לפני go-live. כיבוי חינני: SIGTERM/SIGINT →
`boss.stop({ graceful: true, timeout: 30000 })`.

### 3.2 בנייה והרצה

ה-worker הוא תהליך עצמאי (Next לא רץ בו), ולכן:

- הוא טוען את `.env.local` בעצמו (פונקציית `loadEnv()` בראש `worker/main.ts`).
- הוא נבנה עם esbuild לקובץ יחיד — סקריפט `worker:build` ב-`package.json`:

```bash
esbuild worker/main.ts --bundle --platform=node --format=cjs --target=node20 \
  --outfile=dist/worker.cjs --tsconfig=tsconfig.json \
  --alias:server-only=./worker/empty.js \
  --alias:next/headers=./worker/empty.js \
  --alias:next/cache=./worker/empty.js \
  --external:pg-native
```

המודולים `server-only` / `next/headers` / `next/cache` ממופים ל-stub ריק
(`worker/empty.js`) כדי שקוד דומיין משותף מ-`src/lib/` יעבוד מחוץ ל-Next.
הרצה: `worker:start` = `node dist/worker.cjs` (בפועל דרך pm2).

### 3.3 חיבור ה-DB — חובה session pooler (IPv4)

ה-worker מתחבר ל-Postgres ישירות (לא דרך supabase-js) עם
`SUPABASE_DB_HOST/PORT/USER/PASSWORD/NAME`, סכימת `pgboss`,
`application_name: 'kalfa-worker'`, ומקסימום 4 חיבורים.

**אילוץ תפעולי קריטי** (ידע תפעולי מאומת, לא ניתן לאימות מקוד כי הערכים
ב-`.env.local`): החיבור **חייב** לעבור דרך ה-session pooler של Supabase —
`SUPABASE_DB_HOST=aws-1-ap-south-1.pooler.supabase.com`, פורט `5432`,
משתמש בפורמט `postgres.<project-ref>`. הכתובת הישירה
`db.<project-ref>.supabase.co` היא **IPv6-only**, ולשרת אין קישוריות IPv6 —
שימוש בה גורם ל-`ENETUNREACH` ול-crash-loop של ה-worker.

---

## 4. תהליך הפריסה (deploy)

### 4.1 הסקריפטים (מתוך `package.json`)

| script | פקודה | תפקיד |
|---|---|---|
| `build` | `NEXT_DIST_DIR=.next-verify next build --webpack` | **בניית אימות בלבד** — לתיקייה נפרדת, לא נוגעת ב-`.next` החי |
| `deploy` | ראו להלן | **הפריסה עצמה — כוללת את הבנייה** |
| `worker:build` | esbuild → `dist/worker.cjs` | בניית ה-worker |
| `test` | `vitest run` | חבילת הבדיקות |

סקריפט `deploy` במלואו:

```bash
NEXT_DIST_DIR=.next-stage next build --webpack \
  && rm -rf .next.old \
  && mv .next .next.old \
  && mv .next-stage .next \
  && pm2 restart kalfa-beta --update-env \
  && rm -rf .next.old \
  && npm run worker:build \
  && pm2 restart kalfa-worker --update-env
```

כלומר: בנייה מבוימת ל-`.next-stage` בזמן שהאתר החי ממשיך לרוץ מ-`.next`,
החלפה אטומית-בקירוב (`mv`), ריסטארט לאפליקציה, בניית worker וריסטארט שלו.
אם הבנייה נכשלת — `.next` החי לא נפגע כלל.

### 4.2 זרימת הפריסה המלאה (pre-deploy gate)

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run deploy
```

שני כללים חשובים:

1. **`deploy` הוא-הוא הבנייה.** אין להריץ `npm run build` לפני `npm run deploy` —
   זו בנייה כפולה מיותרת (double-build). `npm run build` נועד לאימות בלבד.
2. **הבנייה תמיד `--webpack`.** בניית production עם Turbopack שוברת את
   `/_not-found` (InvariantError על 404). סקריפטי `build`/`deploy`
   כבר כוללים את הדגל — אין להסירו. (`build:prod` הוסר ב-2026-07-06 —
   בנייה ישירה ל-`.next` החי עוקפת גם את בידוד ה-distDir וגם את רענון
   `.deploy-id` של הגנת ה-version-skew.)

`next.config.ts` מכבד `NEXT_DIST_DIR` (`distDir: process.env.NEXT_DIST_DIR || '.next'`),
וזה מה שמאפשר את הפרדת `.next-verify` / `.next-stage` / `.next`.

**מודל סביבת הריצה (ecosystem.config.cjs, ‏2026-07-06):** שני התהליכים
מוגדרים בקובץ ecosystem עם env מינימלי ומפורש (`NODE_ENV` בלבד); את הסודות
והתצורה כל תהליך טוען בעצמו מ-`.env.local` בעלייה. הדיפלוי משתמש ב-`pm2
restart` **רגיל (בלי `--update-env`)** — הדגל הזה מעתיק את סביבת ה-shell של
המריץ לתוך הייצור (כך דלפו בעבר משתני סשן, PATH של plugins ו-FORCE_COLOR).
אחרי `pm2 delete`/reboot: להפעיל מחדש דרך `env -i` כמתועד בראש הקובץ, ואז
`pm2 save`.

**הגנת version-skew (`.deploy-id`):** סקריפט ה-deploy כותב מזהה חדש לקובץ
`.deploy-id` **לפני** הבנייה; `next.config.ts` קורא אותו גם בבנייה וגם ב-runtime
(`deploymentId`). קצה תפעולי: אם deploy נכשל אחרי כתיבת המזהה אך לפני ה-restart,
קובץ המזהה מקדים את ה-`.next` המוגש — `pm2 restart` ידני במצב כזה יגרום לרענוני
mismatch. התאוששות: להריץ `npm run deploy` מחדש (לא restart ידני).

### 4.3 בנייה מקבילית — אסורה

תיקיית `.next-verify` היא משאב משותף בין סשנים (כולל סשני agent/Codex
מקבילים). **אין להריץ שני `next build` במקביל** — הם מתנגשים על אותה
תיקיית פלט. אם בנייה אחרת רצה, ממתינים לסיומה.

---

## 5. משתני סביבה

מקור אמת: `grep -rhoE "process\.env\.[A-Z_]+" src worker scripts` +
`next.config.ts` + שמות (בלבד!) מ-`.env.example` / `.env.local`.
**שמות בלבד — ערכים לעולם לא מתועדים.**

### 5.1 בשימוש פעיל בקוד

| שם | תפקיד | היקף |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | כתובת פרויקט ה-Supabase (לקוח דפדפן + שרת) | ציבורי |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | מפתח anon של Supabase (מוגן RLS) | ציבורי |
| `SUPABASE_SERVICE_ROLE_KEY` | מפתח service-role ל-`createAdminClient()` — עוקף RLS | **שרת בלבד** |
| `APP_ORIGIN` | ה-origin הקנוני לקישורים אבסולוטיים (`src/lib/url.ts` — `getAppUrl`/`getAppOrigin`) | שרת |
| `SUPABASE_DB_HOST` | מארח Postgres ל-worker — **חייב להיות ה-session pooler** (§3.3) | worker |
| `SUPABASE_DB_PORT` | פורט (ברירת מחדל 5432) | worker |
| `SUPABASE_DB_USER` | משתמש בפורמט `postgres.<project-ref>` (דרישת ה-pooler) | worker |
| `SUPABASE_DB_PASSWORD` | סיסמת ה-DB | worker |
| `SUPABASE_DB_NAME` | שם ה-DB (ברירת מחדל `postgres`) | worker |
| `WHATSAPP_GRAPH_VERSION` | דריסת גרסת Graph API של Meta (ברירת מחדל `v23.0`) | שרת |
| `NODE_ENV` | סביבת ריצה סטנדרטית | הכל |
| `NEXT_DIST_DIR` | תיקיית פלט הבנייה (build-time בלבד, `next.config.ts`) | build |

### 5.2 שמות קיימים אך ללא שימוש בקוד (legacy)

ב-`.env.example` וב-`.env.local` מופיעים גם `SUMIT_API_KEY`,
`NEXT_PUBLIC_SUMIT_COMPANY_ID`, `NEXT_PUBLIC_SUMIT_API_PUBLIC_KEY`
(וב-`.env.local` גם `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
נכון ל-2026-07-02 **אין להם אף הפניה ב-`src/`** — פרטי SUMIT עברו לניהול
אדמין בטבלת `app_settings` (ראו §11). הם שריד מהחיווט הראשוני
(מתועד ב-`docs/sumit-payments-implementation.md`).

### 5.3 כללי אבטחה

- `.env.local` הוא **server-only** ואינו נכנס ל-Git.
- מפתח ה-service-role לעולם לא יופיע תחת `NEXT_PUBLIC_*`, בלוגים,
  בקומיטים או בקוד לקוח.
- ה-worker טוען את `.env.local` בעצמו (§3.2) — אין קובץ env נפרד לו.

---

## 6. Supabase: פרויקט מקושר, מיגרציות וכלים

### 6.1 הפרויקט

הריפו מקושר (`supabase link`) לפרויקט ה-**חי** `kalfa-event-magic`
ב-region `ap-south-1` (עדות לקישור: `supabase/.temp/project-ref`,
`linked-project.json`). **אין** סביבת Supabase לוקאלית בשימוש — כל פעולה
היא מול ה-DB החי, ולכן כל שינוי סכימה דורש אישור מפורש מראש.

### 6.2 מיגרציות

- `supabase/migrations/` מכילה 46 קובצי SQL (נכון ל-2026-07-02).
- **חשוב:** תיקיית המיגרציות **חלקית** — סכימת הבסיס חיה רק ב-DB
  (הפרויקט קושר לפרויקט קיים). לכן `db push` עיוור מסוכן; runbook
  ה-multi-tenancy (§6.4) מורה במפורש להחיל קבצים בודדים בתוך טרנזקציה.
  מיגרציות עדכניות (למשל L0a) כן הוחלו עם `db push` לאחר יישור ההיסטוריה —
  אבל רק לאחר `supabase migration list --linked` נקי.

### 6.3 הכלים הרשמיים (התקן המחייב)

```bash
npx supabase migration new <name>          # יצירת קובץ מיגרציה חדש
npx supabase db query --linked "<sql>"     # שאילתות מול ה-DB החי (רץ כ-postgres)
npx supabase migration list --linked       # השוואת מיגרציות דיסק מול DB
npx supabase db advisors --linked          # advisors של אבטחה/ביצועים
npx supabase gen types typescript --linked > src/lib/supabase/types.ts  # רענון טיפוסים
```

`db query --linked` רץ כמשתמש `postgres`, כולל יכולת להריץ פונקציות
SECURITY DEFINER שנעולות ל-service_role. אין להשתמש בסקריפטים אד-הוק
לגישת DB — הכלים הרשמיים בלבד.

### 6.4 Runbooks — `supabase/runbooks/`

| קובץ | תוכן |
|---|---|
| `org_multitenancy_phase1.md` | הפעלת Phase 1 של org multi-tenancy על ה-DB החי: preflight (אישור גיבוי + ספירות לפני), החלה אטומית של קובץ המיגרציה בטרנזקציה דרך SQL Editor (במפורש **לא** `db push`), אימותי מבנה (24 permissions / 4 roles) ו-backfill (כל אירוע שויך ל-org, כל בעלים חבר-owner), סימולציית משתמש עם `set_config('request.jwt.claims', …)`, רענון טיפוסי TS, ו-rollback מלא שמוחק רק מה שהמיגרציה יצרה. כולל checklist Go/No-Go. |
| `event_lifecycle_s0_preflight.md` | Preflight קריא-בלבד (S0) של מודל ה-lifecycle לאירועים מול ה-DB החי: שאילתות אימות V1a–V5 (verbatim, דרך `db query --linked`), תוצאות חיות מ-2026-07-01, החלטות אנושיות מתועדות לכל ממצא, ותיקון נתונים יחיד וממוקד שאושר על ידי הבעלים (איפוס `rsvp_deadline` באירוע בדיקה). מסתיים ב-sign-off חתום — שהוא תנאי, לא אישור, להמשך ל-S1. |

שני ה-runbooks מדגימים את התקן הפרויקטלי: כל פעולה על ה-DB החי מתועדת
verbatim, עם תוצאות, החלטות, rollback ו-sign-off.

---

## 7. צנרת האימות (verification pipeline)

לפני הכרזה על משימה כגמורה (ולפני כל deploy):

```bash
npm run lint        # ESLint 9 (flat config — eslint.config.mjs)
npx tsc --noEmit    # בדיקת טיפוסים מלאה
npm run test        # vitest run
npm run build       # next build --webpack אל .next-verify (לא נוגע ב-.next החי)
```

מצב הבדיקות (הורץ ואומת 2026-07-02):

```text
Test Files  52 passed (52)
     Tests  576 passed (576)
  Duration  ~3.2s
```

הבדיקות הן unit tests בסביבת Node (`vitest.config.ts`:
`environment: 'node'`, `include: ['src/**/*.test.ts']`, alias `@` → `src`),
ומכסות בעיקר לוגיקת שרת: סכימות Zod, שכבת data, מודולי SUMIT/WhatsApp,
rate-limit ועוד.

תזכורות:

- `npm run build` בונה ל-`.next-verify` בדיוק כדי שאימות לא יפיל את האתר החי.
- **לעולם לא שתי בניות במקביל** (§4.3).
- lint/tsc/vitest לא תופסים כשלים של גבול client-server ב-runtime — לאימות
  מלא נדרשת גם בנייה משולבת ובדיקת קונסול בדפדפן מאומת.

---

## 8. תיקיית `scripts/`

נכון ל-2026-07-02 התיקייה (untracked ב-Git) מכילה שני סקריפטים תפעוליים:

### 8.1 `scripts/kalfa-preflight.sh`

דוח preflight **קריא-בלבד** שנשמר אל `ops-evidence/preflight-<stamp>.txt`
(בהרשאות 600). אוסף בסשן אחד: זמן/מארח, מצב Git מלא (status, diffs,
untracked, פער מול `origin/main`), ארטיפקטי בנייה (`.next*`, BUILD_ID),
מיגרציות על הדיסק + `supabase migration list --linked`, מצב pm2 **ללא**
משתני סביבה (במכוון — כדי לא לדלוף סודות), גרסאות Node/npm, זיכרון ודיסק,
האזנה על פורט 3002, בדיקת HTTP מקומית מול `127.0.0.1:3002`, `nginx -t`
ו-grep על הקונפיגורציה, וזנבות לוגים של pm2 ו-nginx. חלקי nginx דורשים
sudo (מדלג עם אזהרה אם אין). משתני שליטה: `KALFA_ROOT`, `KALFA_DOMAIN`,
`KALFA_PORT`, `NO_FETCH=1`, `SKIP_SUDO=1`.

### 8.2 `scripts/kalfa-worktree-snapshot.sh`

צילום triage של ה-worktree אל `ops-evidence/triage-<stamp>/`: קונטקסט Git
(HEAD, branch, status), patches בינאריים של unstaged+staged, רשימת קבצים
untracked וארכיון `untracked-files.tar.gz` שלהם, ומניפסט `SHA256SUMS`
לאימות שלמות. מצבים: `snapshot` (ברירת מחדל), `--backfill-latest`,
`--repair-manifest-latest`, `--verify-latest`. הסקריפט גם מתקין
`/ops-evidence/` אל `.git/info/exclude` כדי שראיות תפעוליות לעולם לא יכנסו
לקומיט.

### 8.3 כלי בדיקה של SUMIT

**לא קיימים** סקריפטי בדיקה של SUMIT ב-`scripts/` נכון למועד כתיבת המסמך.
תיעוד האינטגרציה, ה-PoC וההתנהגות המאומתת של SUMIT נמצא ב-
`docs/sumit-payments-implementation.md` ו-`docs/sumit-response-capture-and-audit.md`.
אם קיימו בעבר סקריפטי בדיקה אד-הוק — הם אינם בריפו; כל כלי כזה, אם ישוחזר,
הוא **כלי PoC/בדיקה לאדמין בלבד** (מבצע חיובים אמיתיים מול SUMIT) ואינו
חלק מזרימת הייצור.

---

## 9. תיקיית `ops-evidence/`

תיקיית ראיות תפעוליות **מקומית בלבד** (הרשאות 700, מוחרגת מ-Git דרך
`.git/info/exclude` — לעולם לא בקומיט). מכילה:

- `preflight-<stamp>.txt` — דוחות ה-preflight מ-§8.1 (הרשאות 600).
- `triage-<stamp>/` — צילומי worktree מ-§8.2, כולל patches, ארכיון
  untracked ומניפסט SHA256SUMS.

מטרתה: ראיות ניתנות-לאימות (checksummed) למצב המערכת לפני/אחרי פעולות
תפעוליות, בלי לזהם את היסטוריית Git ובלי לחשוף תוכן רגיש בריפו.

---

## 10. ניטור ולוגים

### 10.1 מה יש

- **pm2**: `npm run pm2:logs` (= `pm2 logs kalfa-beta --lines 100`),
  `npm run worker:logs`, `pm2 status`, מוני ריסטארט (`↺`) לזיהוי crash-loops.
- **nginx**: `access_log`/`error_log` ב-
  `/var/www/vhosts/system/beta.kalfa.me/logs/` (`proxy_access_ssl_log`,
  `proxy_error_log`) — המקום הראשון לחקור 502/504.
- `scripts/kalfa-preflight.sh` מרכז את כל אלה לדוח אחד.
- אין APM חיצוני, אין agregator לוגים — הניטור הוא pm2 + nginx בלבד.

### 10.2 מה נרשם ומה לא (מדיניות אכופה בקוד)

- **לעולם לא נרשמים**: payload של webhook (הערה מפורשת ב-`worker/main.ts`
  וב-worker של ה-inbox), טוקנים וסודות ערוצים (`channels.ts`: "never
  logged"), סיסמת SMTP וגופי מיילים (`src/lib/email/sender.ts`), PII של
  אורחים, CitizenID (PII — לא נשמר כלל).
- **כן נרשמים**: הודעות שגיאה טכניות בלבד (למשל `[pgboss] <message>`,
  `[kalfa-worker] fatal`), ואירועי audit עסקיים דרך
  `src/lib/data/activity.ts` (`logActivity`) — לטבלת activity ב-DB,
  לא ללוג טקסטואלי.
- דוח ה-preflight שולף מצב pm2 **בלי** בלוק ה-env במכוון.

---

## 11. מלאי שירותים חיצוניים

עיקרון רוחבי: **כל פרטי הגישה לספקים מנוהלים על ידי אדמין בטבלת
`app_settings` ב-DB** (RLS אדמין-בלבד, מוצגים במסוך בטופס האדמין) — לא
במשתני סביבה ולא בקוד. אין לתעד או להדפיס ערכים.

### Supabase

הליבה: PostgreSQL + Auth (סשנים מבוססי-cookie דרך `@supabase/ssr`),
פרויקט חי `kalfa-event-magic` ב-`ap-south-1`. שלושה נתיבי גישה:
לקוח דפדפן (anon + RLS), לקוח שרת (cookies), ו-`createAdminClient()`
עם service-role (שרת בלבד). ה-worker מתחבר ל-Postgres ישירות דרך
ה-session pooler (§3.3). מיגרציות וכלים — §6.

### SUMIT (סליקה וחשבוניות)

ספק הסליקה הישראלי (`api.sumit.co.il`) — charge / authorize (J5 hold) /
capture, כולל הפקת מסמכים ושליחתם במייל. הקוד ב-`src/lib/sumit/`
(`charge.ts`, `authorize.ts`, `capture.ts`, `raw-charge.ts`,
`safe-preview.ts`). `CompanyID` ומפתח ה-API מגיעים מ-`app_settings`
(שדות `sumit_company_id`, `sumit_api_public_key`, `sumit_api_key`).
עיקרי התנהגות מאומתים: `Status` הוא enum (0/1/2), reconciliation דרך
`Customer.ExternalIdentifier`, ו-CitizenID לעולם לא נשמר. תיעוד מלא:
`docs/sumit-payments-implementation.md`, `docs/sumit-response-capture-and-audit.md`.

### Meta WABA (WhatsApp Cloud API)

ערוץ ה-outreach הראשי — שליחת תבניות וקבלת webhooks דרך הספרייה
`whatsapp-api-js` מול Graph API (גרסה נשלטת ב-`WHATSAPP_GRAPH_VERSION`,
ברירת מחדל `v23.0`). קונפיגורציה ב-`app_settings`: `whatsapp_phone_number_id`,
`whatsapp_waba_id`, `whatsapp_access_token`, `whatsapp_app_secret`
(אימות חתימת `X-Hub-Signature-256`), `whatsapp_verify_token`, ומתג-העל
`outreach_enabled`. ה-webhooks נקלטים בדפוס persist-then-process
(`webhook_inbox` → עיבוד ב-worker). קוד: `src/lib/whatsapp/`,
`src/lib/data/admin/channels.ts`; תיעוד: `docs/routes-webhooks.md`,
`docs/webhook-inbox-data-contract.md`.

### ExtrA SMS (exm.co.il)

ספק ה-SMS ל-OTP: `POST https://www.exm.co.il/api/v1/sms/send/` עם Bearer
token וגוף `{message, destination, sender}`. האדפטר ב-`src/lib/sms/sender.ts`
מופרד מלוגיקת ה-OTP (`src/lib/data/otp.ts`) — החלפת ספק = אדפטר חדש בלבד.
קונפיגורציה ב-`app_settings`: `sms_enabled`, `extra_sms_sender`,
`extra_sms_token`.

### IONOS SMTP (דוא"ל עסקי)

שליחת מיילים עסקיים (הסכם חתום, מסמכי חיוב וכו') דרך nodemailer מול
IONOS Exchange. קונפיגורציה ב-`app_settings`: `email_enabled`, `smtp_host`,
`smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password`, `smtp_from`.
הערת deliverability (מוטמעת בהערות `src/lib/email/sender.ts`): **אין**
חתימת DKIM עצמית — ה-relay של IONOS משכתב את ההודעה ושובר את ה-body-hash;
ההסתמכות היא על יישור SPF/From של הדומיין דרך ה-relay. מסמכים רגישים
נמסרים כקישור מאובטח, לא כקובץ מצורף.

---

## 12. מה לא אומת / הסתייגויות

- ערכי `.env.local` לא נקראו (בכוונה) — אומתו **שמות** בלבד; דרישת
  ה-session pooler ל-worker (§3.3) היא ידע תפעולי מאומת-בעבר, לא קריאת ערך.
- הגדרת pm2 נשמרת ב-dump (`~/.pm2/dump.pm2`) — אין קובץ `ecosystem.config`
  בריפו; שחזור אחרי reboot מסתמך על `pm2 resurrect`/startup של pm2
  (מנגנון ה-startup עצמו לא אומת במסגרת מסמך זה).
- אזהרת ה-`server_name conflict` של Plesk תועדה כקוסמטית על סמך הערת
  הקונפיגורציה וניסיון תפעולי; לא הופעל `nginx -T` מלא בסשן זה.
- סקריפטי בדיקה של SUMIT אינם קיימים ב-`scripts/` (§8.3) — תועד ההיעדר.
- `region ap-south-1` ושם הפרויקט `kalfa-event-magic` — מידע תפעולי מוכר;
  קובץ `supabase/.temp/linked-project.json` מאשר קישור אך תוכנו לא צוטט כאן.
