# סריקת הרשאות בכל נקודות הכניסה של האדמין (15.10.2026)

בדיקה בלבד — **שום קוד לא שונה.** כל טענה מסומנת **[נמדד]** (נבדק בקוד ביום הזה) או **[מוסק]** (הסקה, לא נבדקה).

## השאלה

האם ההרשאות המפורטות (`manage_settings`, `manage_voice`, `manage_billing`…) נאכפות בשרת בכל נקודת כניסה של האדמין — ולא רק בשכבת הנתונים (`src/lib/data/admin`)?

## תשובה

**[נמדד]** כן. מתוך 226 נקודות כניסה של האדמין, בכולן יש שער הרשאה בשרת לפני כל גישה לנתונים, חוץ משתיים שאין בהן גישה לנתונים כלל (פירוט למטה).

| סוג | כמות |
|---|---|
| Server Actions (קבצי `'use server'`) | 153 |
| עמודים | 66 |
| Route Handlers (`src/app/api/admin/**`) | 5 |
| Layouts | 2 |
| **סה"כ** | **226** |

חוזק השער (מה שכל נקודה מגיעה אליו):

- **223** — שער בשם: `manage_settings` 98 · `manage_voice` 34 · `requirePlatformOwner` 33 · `manage_billing` 27 · `view_customer_data` 16 · `manage_staff` 8 · `rdp.request` 5 · `integrations.manage` 4 · `integrations.read` 3 · `events.mark_test` 2 · `view_activity_log` 2 · `view_webhooks` 2 · `view_recordings` 2 · `campaigns.runstate` 1 · `events.purge_test` 1 · `view_events` 1.
- **1** — `admin/analytics/page.tsx`: הסריקה סיווגה אותו "רצפה בלבד" (`requirePlatformStaff`), אבל קריאה של הקוד מראה ש-`getAnalyticsDashboard` / `getRealtimeSnapshot` (`src/lib/data/admin/analytics.ts:26-27`) ו-`getSearchConsoleDashboard` (`search-console.ts:157-158`) בודקים בנוסף `hasPlatformPermission('view_customer_data')` ומחזירים `null` / מצב שגיאה למי שאין לו. זו בדיקה "רכה" (לא `require*`), ולכן הסריקה לא ספרה אותה. **אין חור.**
- **2** — בלי שער בשם, ובלי גישת שירות לנתונים:
  - `admin/fleet/[id]/page.tsx` — redirect בלבד: מאמת UUID ואז `redirect('/admin/fleet?focus=…')`. היעד מוגן. לא נוגע בנתונים.
  - `admin/voice/console/page.tsx` — `requireUser()` + קריאה מ-view בשם `console_me` שמצמצם ל-`auth.uid()` (RLS). זה מכוון: ההערה בקובץ מסבירה ש-`manage_voice` היה נועל נציגים רשומים מהטלפון שלהם. לפני הכל רץ ה-layout של האדמין עם `requirePlatformStaff`.

## שיטה [נמדד]

סקריפט קריאה-בלבד על ה-TypeScript Compiler API: גרף קריאות על 6,338 פונקציות; 574 מהן נוגעות ב-service-role. שער קשיח = `requirePlatformStaff/Permission/Owner`. הניתוח **רגיש לסדר**: השער חייב לרוץ לפני הקריאה הראשונה ל-service-role או לפני insert/update/upsert/delete/rpc.

- ריצה ראשונה (לא רגישה לסדר) סימנה 16 ו-23 נקודות — כולן false positive: השער נמצא בפונקציית DAL שרצה *לפני* תופעות הלוואי (`sendSlackAlert`, `logActivity`, `noteCalendarWrite`). עקבות הקריאות אומתו ידנית; `assignRole`/`clearRole` קוראות ל-`requireRolePermission` לפני הכתיבה (`provider-numbers.ts:203-239`).
- **בקרה שלילית:** אותו ניתוח על 127 נקודות כניסה *שאינן* אדמין (פעולות לקוח/ציבור, routes) מסמן 121 — כלומר הניתוח לא ריק.

## מגבלות

- **ניתוח סטטי:** callbacks, dispatch דינמי וקריאות שלא נפתרו לא מתועדים.
- מוכיח שהשער רץ לפני הגישה לנתונים — **לא** שמפתח ההרשאה שנבחר הוא הנכון. את זה מכסה `admin-data-layer-coverage.test.ts` ל-DAL.
- קריאות עם cookie-client נשענות על RLS (הרצפה `is_platform_staff()`).
- נכללו רק קבצי `'use server'` ברמה העליונה ו-closures בתוך עמודים. `scripts/` וה-worker אינם נגישים מבקשה.

## אימות מול GitHub ומול התיעוד [נמדד]

- **GitHub:** `HEAD` המקומי = `origin/main` = `780b246c`. שבעה קבצים מרכזיים (`dal.ts`, `admin-data-layer-coverage.test.ts`, `analytics.ts`, `search-console.ts`, `fleet/[id]/page.tsx`, `voice/console/page.tsx`, `api/admin/fleet-file/route.ts`) — ה-blob sha ב-`main` ב-GitHub זהה לעץ העבודה (`gh api … contents`). כלומר הסריקה רצה על אותו קוד שנמצא ב-GitHub.
- **תיעוד Next.js (Context7, `/vercel/next.js/v16.2.9`, וגם `node_modules/next/dist/docs` בגרסה המותקנת 16.4.1):** בדיקת הרשאה ב-layout/page לא מספיקה; כל Server Action ו-Route Handler הם נקודות כניסה נפרדות ודורשים בדיקה משלהם, וה-DAL הוא המקום המומלץ (`data-security`, `authentication` — "Treat Server Actions with the same security considerations as public-facing API endpoints"). זה בדיוק הדפוס שהסריקה בדקה: שער בתוך הפעולה עצמה ולא ב-layout.

## מנגנון האכיפה והמטריצה החיה [נמדד]

- `requirePlatformPermission(key)` (`dal.ts:195-201`): `requireUser()` ואז RPC ‏`has_platform_permission` מול ה-DB; אם אין הרשאה — `redirect('/access-denied')`. מפתח לא ידוע פשוט לא מתאים ומופנה החוצה. `hasPlatformPermission` לא זורק ומחזיר `false` גם על שגיאת RPC (נכשל סגור).
- הפונקציה החיה ב-DB (`pg_get_functiondef`): תפקיד בעלים (`is_owner_role`) מקבל הכל; כל השאר — רק מפתחות שמופיעים ב-`platform_role_permissions` של התפקיד שלהם, לפי `auth.uid()` מהסשן ולא ערך מהדפדפן.
- `api/admin/fleet-file/route.ts:54-56`: `requirePlatformPermission('manage_settings')`; ה-`NEXT_REDIRECT` מומר ל-`403` (ולא נשען על ה-layout).
- דוגמאות שער בתוך הפונקציה: `listOffers` ← `manage_billing` (`offers.ts:81`), `getWhatsAppChannelConfig` ← `manage_settings` (`channels.ts:31`), ב-`campaigns.ts` כל קריאות ה-service-role שבודקות מפתח (46, 96, 231, 259) נעשות אחרי `requirePlatformPermission('manage_billing')`.
- מיפוי מודול↔הרשאה ב-`admin-data-layer-coverage.test.ts`: `users.ts`→`manage_staff` (122), `packages.ts`→`manage_billing` (114), `webhook-inbox.ts`→`view_webhooks` (123), `call-dnc.ts`→`manage_voice` (137), `rdp-access.ts`→`rdp.request` (152), `faq.ts`→`manage_settings` (132), `oauth-provider-config.ts`→`integrations.read`/`integrations.manage` (212).

מטריצה חיה מה-DB (15.10.2026, קריאה בלבד):

| תפקיד | הרשאות |
|---|---|
| owner (17) | הכל |
| ops_engineer (8) | `view_events`, `manage_settings`, `integrations.read`, `integrations.manage`, `view_activity_log`, `manage_voice`, `campaigns.runstate`, `view_webhooks` |
| billing_clerk (5) | `view_events`, `view_customer_data`, `manage_billing`, `view_billing`, `view_activity_log` |
| support_agent (3) | `view_events`, `view_customer_data`, `view_activity_log` |
| auditor (3) | `view_billing`, `integrations.read`, `view_activity_log` |

תוצאה ל-`ops_engineer`: `manage_voice` ✓ ו-`manage_settings` ✓ → עובר; `manage_billing` ✗, `manage_staff` ✗, `roles.manage` ✗, `view_customer_data` ✗ → מופנה ל-`/access-denied` (ב-route: 403). **לא הרצתי** התחברות כ-`ops_engineer` בפועל — התוצאה נגזרת מהקוד ומהמטריצה, לא מבדיקה חיה.

תוצאת לוואי שכדאי להכיר: `getAnalyticsDashboard` דורש `view_customer_data`, ולכן `ops_engineer` רואה את `/admin/analytics` במצב "אין הרשאה" ו-`billing_clerk`/`support_agent` רואים אותו. זה לא חור; זו החלטת מוצר אם זה הרצוי.

## סוכנים אוטונומיים ושירותים — מי נכנס איך (אימות נוסף, 15.10.2026 ערב)

**הגבלת היקף:** הסריקה למעלה כיסתה את 226 נקודות הכניסה של **האדמין** בלבד, ושם ההרשאה היא הרשאת צוות לפי תפקיד. סוכנים אוטונומיים לא נכנסים דרך השערים האלה — לכל סוג יש מנגנון משלו. נבדק כאן: אין שער-צוות שנועל אותם בטעות, ואין להם דרך עוקפת.

מיפוי כל 89 ה-Route Handlers לפי סימני הרשאה בקוד [נמדד]: ב-60 יש סימן מוכר בקובץ עצמו; ב-29 אין סימן כזה, ולכן נבדקו אחד-אחד לפי הטבלה: חלקם נקראו במלואם, וחלקם דרך ה-helper המשותף שהם מייבאים (העמודה "נקרא בפועל").

| סוג | איך מזדהה | נקרא בפועל | תוצאה |
|---|---|---|---|
| סוכני Fleet (תזמון Claude) | `service_role` דרך `scripts/fleet-agent-cli.ts`; ה-RPC‏ `fleet_consume_request`, `fleet_goal_progress`, `fleet_goal_close` ניתנים ל-`service_role` **בלבד** ואין בהם שער-צוות | הגדרות החיות (`pg_proc` + grants) | לא מושפע ממטריצת התפקידים ✓ |
| ה-6 RPC של הממשק (`fleet_owner_request`, `answer`, `goal_create/pause/resume/abandon`) | `has_platform_permission('manage_settings')` על `auth.uid()` | כל הקוראים בריפו, פונקציות DB, `cron.job` | הקורא היחיד: `src/lib/data/admin/fleet.ts` (cookie של איש צוות). אף סוכן לא קורא להם — אחרת `auth.uid()` ריק היה נכשל ב-`42501` ✓ |
| סוכן הבעלים (`/api/mcp`) | OAuth של Supabase (ES256 מול JWKS, `client_id` מרשימה סגורה) ואז `has_platform_permission_for_user` לכל אחד מ-6 מפתחות: `view_customer_data`, `manage_billing`, `view_billing`, `manage_voice`, `view_events`, `view_webhooks` | `oauth.ts`, `route.ts`, הגדרת הפונקציה החיה (`service_role` בלבד) | בעל המערכת מחזיק את כולם. כלי ה-web-traffic נשען על `view_customer_data` — אותו מפתח של `/admin/analytics` ✓ |
| נציגי מוקד (`/api/agents/*`, `/api/console-calls/*`) | JWT מאומת מול שרת ה-Auth + `is_console_agent`; פקודות AI דורשות בנוסף `manage_voice` | `src/lib/auth/console-agent.ts` | ✓. `/admin/voice/console` מכוון לא דורש `manage_voice` |
| סוכני קול (15 נתיבי `*/tool/*/[token]`) | טוקן אטום לכל שיחה: rate-limit שנכשל סגור, תקרת גוף, חיפוש שורת-ניסיון, תוקף; הזהות מהשורה ולא מהגוף | `agent-tool-guard.ts` במלואו ודוגמאות מ-3 נתיבים | כל ה-15 מייבאים את אותו guard ✓ |
| Webhooks של ספקים | ElevenLabs: `verifyElevenLabsWebhook`; Resend: svix (timing-safe); WhatsApp: `x-hub-signature-256`; CardCom-document: סוד עם `timingSafeEqual`; CardCom-webhook: **ללא אימות במכוון** (לפי הנחיית CardCom) — הבקשה רק מציינת session ו-`GetLpResult` נשאל מול CardCom; Microsoft Graph: `clientState` | שורות הבדיקה בלבד, חוץ משלושת ה-webhooks שנקראו במלואם | ✓ (ראו הערה) |
| נתיבי אדמין שאין בהם שער בקובץ | `jobs.data` ו-`jobs/[[...path]]` ← `proxyToDashboard` ← `requirePlatformPermission('manage_settings')` (`dashboard-proxy.ts:61`); `workflows/[id]/runs/latest` ← `workflowRunsFingerprint` ← `manage_settings` | נקראו | ✓ |
| תשלום | `purchase/settle` ← `guardCampaignRoute`: בדיקת Origin, `requireUser`, `requireOwnedEvent` | נקרא | ✓ |
| ציבורי במכוון | `health`, `auth/callback` (חסימת open-redirect), `auth/logout`, `[...catchAll]` (404), `guest-list-template.csv`, `llms.txt`, `call-me-now/*` (OTP + rate-limit) | הקריאה במלואה רק ל-`health`, `auth/*`, `catchAll`; השאר נקבעו לפי הערות הקובץ | ללא נתונים רגישים בלי טוקן/OTP |

**לא נקרא בעומק (מסומן [מוסק]):** גוף האימות של `voximplant/console/*` (בדקתי רק שהסוד `KALFA_CONSOLE_SECRET` נבדק ושהכשל מחזיר 401, לא אם ההשוואה timing-safe), `workflows/hook/[endpoint]`, `rdp-gateway/*`, `widget/*`, ופנים `verifyElevenLabsWebhook`. אלה נתיבים שבהם הסוכן מציג סוד/חתימה ולא הרשאת צוות.

**הערה קטנה (לא תוקן):** `webhooks/microsoft-graph` משווה `clientState` עם `!==` רגיל ואין בו rate-limit, בניגוד לשאר ה-webhooks. הסיכון נמוך (סוד משותף, התשובה תמיד 202), אבל זה חריג בסגנון — החלטת בעלים אם לתקן.

**אימות שהמיגרציות (שלב 1 ושלב 2) לא פגעו בסוכנים [נמדד]:**
- יומני pm2 (כל הקבצים השמורים, כולל worker, fleet, owner-agent): אפס שורות `42501` / `permission denied` / `has_role` / `user_roles` / `app_role`.
- ריצות Fleet: 15:30 `support-drafter`, 16:30 `brand-director`, 17:30 `chief-of-staff` — `is_error=false`, קובץ `.err` ריק, אפס אזכורי הרשאה. ריצת 17:30 היא אחרי שני השלבים (שלב 2 הוחל מיד אחרי יצירתו, 16:47 IDT לפי גרסת הקובץ). ריצות 15:30 ו-16:30 הן אחרי יצירת שלב 1 (14:46 IDT), אבל מועד ההחלה המדויק שלו ב-DB לא נמדד, ולכן הן ראיה חלקית בלבד. ‏"permission_denials" יחיד אצל `brand-director` הוא חסימת כלי Bash של Claude (`find -exec sh -c`) ולא קשור למסד.
- שתי מדיניות ה-RLS שהוחלפו (`voice_purposes_admin_all`, `voice_purpose_attempts_admin_read`) משמשות רק את ממשק הצוות; סוכני הקול והמנוע עובדים עם `service_role`.

**שלושת שורות `user_roles` שנמחקו:** בעלים ✓, `billing_clerk` ✓ (שניהם עם `platform_staff`), והשלישית — `play-review@kalfa.me` (חשבון הבודק של Google Play, נוצר 18.8) — **ללא** שורת `platform_staff` ו-`console_agents`, ללא התחברות מעולם וללא session. כלומר מחיקת תפקיד האדמין שלה לא שינתה דבר בפועל. **נשאר:** משתמש ה-auth עצמו (עם סיסמה) עדיין קיים, וכנראה גם משתמש ה-SDK ב-Voximplant (`agent_f21060b5…` — לא נבדק). לפי רשימת הזיכרון, חשבון הבודק היה אמור להימחק אחרי אישור האפליקציה (18.8). מחיקה רק דרך `/admin/users` — לא נעשה.

## הערה אחת על דיוק (לא חור)

`admin-data-layer-coverage.test.ts:277-280` (ושורות סמוכות) מנמק את הרצפה הגסה של `analytics.ts` / `search-console.ts` בכך ש"אין נתוני לקוח" ו"אין מפתח בקטלוג". בפועל הקוד בודק `view_customer_data` (מאז `b5b5f045`, 27.7.2026). הנימוק במבחן לא מעודכן; ההתנהגות נכונה. לא שיניתי — זה קובץ מבחן והנימוק הוא החלטת בעלים.
