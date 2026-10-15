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

## הערה אחת על דיוק (לא חור)

`admin-data-layer-coverage.test.ts:277-280` (ושורות סמוכות) מנמק את הרצפה הגסה של `analytics.ts` / `search-console.ts` בכך ש"אין נתוני לקוח" ו"אין מפתח בקטלוג". בפועל הקוד בודק `view_customer_data` (מאז `b5b5f045`, 27.7.2026). הנימוק במבחן לא מעודכן; ההתנהגות נכונה. לא שיניתי — זה קובץ מבחן והנימוק הוא החלטת בעלים.
