# 02 — אימות והרשאות (Authentication & Authorization)

מסמך זה מתעד את שכבת האימות וההרשאות של KALFA Event Magic, כפי שהיא ממומשת בפועל בקוד ובמיגרציות נכון ל‑**2026‑07‑21**. כל טענה אומתה מול קבצי המקור, קבצי המיגרציות בריפו, הטיפוסים המחוללים (`src/lib/supabase/types.ts`), ו‑**מדידה ישירה של ה‑DB החי** (`pg_policies`, `pg_proc`, `has_function_privilege`, `pg_class.relrowsecurity`) — לא מקריאת מיגרציות בלבד. המיגרציה האחרונה שהוחלה: `20260721012000`.

> **עדכון 2026‑07‑21 — מה השתנה מאז גרסת 2026‑07‑02.** הגרסה הקודמת תיארה **שני** רבדי תפקידים; מאז נוספו שניים ומודל הצירים הוא כעת שלושה (§1.2, §6A, §6B). בנוסף, מספר טענות בגרסה ההיא הפכו לא‑נכונות ותוקנו כאן לפי מדידה: מספר הטבלאות (33 → **54**), ה‑policies החשופות ל‑anon (3 → **1**), פונקציות SECDEF שניתנות להרצה ע"י anon (11 → **0**), `set_updated_at` (ללא `search_path` → **עם**), ו‑`can_access_event` ("מחכה לחיווט" → **26 policies בפועל**). הפערים שנסגרו הוסרו מ‑§12.

## 1. עקרונות העל

- **אכיפה בצד השרת בלבד**: כל הרשאה, תפקיד ובעלות נבדקים בשרת — ב‑Server Components, Server Actions ו‑Route Handlers. ה‑proxy (middleware) מבצע הפניה אופטימית בלבד ואינו גבול האבטחה (`src/proxy.ts:9-11`).
- **מודל דו‑שכבתי (two‑tier)**: RLS במסד מבטיח **בידוד** (tenant isolation — נגיעה רק בשורות שלך); ה"פועל" (מותר לערוך אורחים? לנהל חברים?) נאכף בשכבת האפליקציה מול מקור אמת יחיד ב‑DB — `has_org_permission()` (`src/lib/permissions.ts:8-18`).
- **אין אמון בקלט מהדפדפן**: מזהי משתמש/אירוע/ארגון המגיעים מהלקוח לעולם אינם משמשים כהרשאה; הם מאומתים מול הנתונים בשרת (למשל cookie הארגון הפעיל — `src/lib/auth/dal.ts:65-67`).
- **שלושה צירי תפקידים בלתי תלויים** (ראו §1.2): צוות פלטפורמה, לקוח/ארגון, ומוקד שיחות. ציר אחד אינו מקנה הרשאות בציר אחר — הצלבה ביניהם היא באג אבטחה, לא נוחות.

### 1.1 מסלול בקשה מאומתת — מקצה לקצה

1. הדפדפן שולח בקשה עם cookies של ה‑session (נכתבו ע"י `@supabase/ssr`).
2. `src/proxy.ts` מרענן את ה‑session (`getUser()` → refresh נכתב ל‑cookies) ומבצע הפניה אופטימית בלבד.
3. ה‑layout של האזור (`(customer)/app` או `(admin)/admin`) קורא `requireUser()` / `requireAdmin()` מה‑DAL — זהו שער האימות/תפקיד האמיתי.
4. הדף/Action קורא לפונקציה בשכבת הנתונים (`src/lib/data/*`), שנפתחת בשער בעלות (`requireOwnedEvent`) או הרשאה ארגונית (`requirePermission`).
5. השאילתה עצמה רצה עם ה‑client מבוסס ה‑cookies — RLS במסד מגדר אותה שוב (defense‑in‑depth). קריאות service‑role (`createAdminClient`) מותרות רק אחרי שהשערים בשכבות 3–4 עברו.

### 1.2 שלושת צירי ההרשאה — מודל התודעה

זו הנקודה שהכי מבלבלת בקוד הזה, כי **שלושה דברים שונים נקראים "הרשאה"** והם בלתי תלויים לחלוטין. משתמש יכול להיות בכל צירוף שלהם.

| ציר | מקור האמת | הפונקציה | מה הוא רואה |
|---|---|---|---|
| **צוות פלטפורמה** | `platform_staff` + `platform_roles` | `is_staff()`, `has_platform_permission(_key)` | חוצה‑לקוחות — כל האירועים של כולם |
| **לקוח / ארגון** | `organization_members` + `org_roles` | `has_org_permission(_org_id,_res,_act)` | רק את הארגון שלו |
| **מוקד שיחות** | `console_agents` | `is_console_agent()` | פיד השיחות של כל האירועים |

בנוסף קיים **דגל admin ישן ונפרד** — `user_roles` + `has_role(_user_id,'admin')` (§6). הוא **אינו** זהה ל‑`platform_staff`: `has_role` הוא דגל בוליאני גס משלב מוקדם, בעוד `platform_staff` הוא ציר עם תפקידים והרשאות עדינות. שניהם חיים במקביל היום — 10 policies עדיין מגודרות ב‑`has_role`.

**כלל הזהב — אין הצלבת צירים.** ציר הצוות רואה הכול; ציר הלקוח רואה רק את עצמו. אם משתמש‑לקוח מצליח להיכנס לציר צוות או מוקד, כל הבידוד הרב‑דיירותי קורס. זו בדיוק הייתה סדרת התקלות של 2026‑07‑19/20:

- `20260719214054` — הסרת מדיניות שאפשרו ל"ציר הצוות להלבין את עצמו לציר הלקוח".
- `20260720030121` — הסרת 32 policies של ציר‑צוות מטבלאות לקוח.
- `20260720234500` — `is_console_agent()` דורשת `is_staff()`; לפני כן **כל משתמש רשום** שהוכנס ל‑`console_agents` ראה מיד את כל האירועים של כל הלקוחות.
- `20260721005100` — `console_agents.user_id` → FK ל‑`platform_staff(user_id)` `ON DELETE CASCADE`: ציר המוקד הוא כעת **תת‑קבוצה ממש** של ציר הצוות, אכוף במסד ולא במוסכמה.

### 1.3 איך אירוע נקשר לארגון

`events` מחזיקה **שתי** עמודות בעלות, וזו לא כפילות:

| עמודה | Null? | משמעות |
|---|---|---|
| `owner_id` | NOT NULL | היוצר. תמיד קיים, גם ללא ארגון. |
| `org_id` | NULLABLE | הארגון שהאירוע שויך אליו. |

והשער `can_access_event` מחבר אותן בשני מסלולים נפרדים:

```sql
-- SECURITY DEFINER, STABLE, search_path=public
e.owner_id = auth.uid()
  or (e.org_id is not null and public.has_org_permission(e.org_id, _resource, _action))
```

כלומר: או שאתה היוצר, או שאתה חבר בארגון **ויש לך את ההרשאה הספציפית**. מכיוון ש‑`org_id` הוא nullable, אירוע יכול להתקיים בלי ארגון — ואז רק היוצר ניגש. זו הפונקציה העמוסה במערכת: **26 policies** נשענות עליה (נמדד).

## 2. Supabase Auth — sessions מבוססי cookies

האימות מבוסס `@supabase/ssr` עם session ב‑cookies (לא localStorage). שיטת ההתחברות היחידה למשתמשי קצה היא email+password (`signInWithPassword`); אין OTP login (ראו §5.5 — ה‑OTP במערכת משמש לחתימת הסכם, לא להתחברות).

### 2.1 שלושת ה‑clients — `src/lib/supabase/`

| Client | קובץ | מפתח | הקשר | RLS |
|---|---|---|---|---|
| Browser | `src/lib/supabase/client.ts` | anon key | Client Components בלבד (`createBrowserClient`) | נאכף |
| Server (request‑scoped) | `src/lib/supabase/server.ts` | anon key + session cookies | Server Components / Server Actions / Route Handlers (`createServerClient`) | נאכף לפי המשתמש המחובר |
| Admin (service‑role) | `src/lib/supabase/admin.ts` | `SUPABASE_SERVICE_ROLE_KEY` | קוד שרת אמין בלבד | **עוקף RLS** |

נקודות מפתח:

- `server.ts` — client לכל בקשה, קורא/כותב cookies דרך `next/headers`; כתיבת cookie מתוך Server Component נבלעת בכוונה (read‑only בזמן render) כי רענון ה‑session מתבצע ב‑`proxy.ts` (`src/lib/supabase/server.ts:20-30`).
- `admin.ts` — `createAdminClient()` (`src/lib/supabase/admin.ts:24-43`):
  - מיובא עם `import 'server-only'` — נסיון לייבא אותו לקוד לקוח נכשל בזמן build.
  - קורא את `SUPABASE_SERVICE_ROLE_KEY` (לעולם לא `NEXT_PUBLIC_*`), ונכשל בקול רם אם המפתח חסר או שווה ל‑placeholder המוכר (`admin.ts:33-35`) — כדי שפריסה לא‑מוגדרת לא תקרוס בשקט.
  - stateless: `autoRefreshToken:false`, `persistSession:false` — אינו נושא session של משתמש.
- `env.ts` — `getPublicSupabaseEnv()` קורא רק את `NEXT_PUBLIC_SUPABASE_URL` ו‑`NEXT_PUBLIC_SUPABASE_ANON_KEY`, בעצלנות, כך שהמודול בטוח לייבוא גם בלקוח (`src/lib/supabase/env.ts:6-17`).
- `types.ts` — טיפוסי `Database` מחוללים מהסכמה החיה; כל שלושת ה‑clients מוקלדים בו.

### 2.2 משתני סביבה רלוונטיים (שמות בלבד)

| משתנה | חשיפה | שימוש |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ציבורי | כתובת הפרויקט — כל ה‑clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ציבורי | browser + server clients (RLS נאכף) |
| `SUPABASE_SERVICE_ROLE_KEY` | **שרת בלבד** | `createAdminClient()` בלבד; אסור ב‑`NEXT_PUBLIC_*`, בלוגים או בקומיטים |
| `APP_ORIGIN` | שרת | בניית redirects ובדיקת origin במסלולי `/api` (ראו §9.2; דרך `src/lib/url.ts`) |

## 3. שכבת ה‑DAL — `src/lib/auth/dal.ts`

ה‑Data Access Layer מרכז את בדיקות הזהות והתפקיד קרוב לנתונים, לפי הדפוס המומלץ של Next.js. כל ה‑helpers עטופים ב‑`cache()` של React — קריאות חוזרות באותו render pass חולקות round‑trip אחד. הקובץ מסומן `server-only`.

### 3.1 הפונקציות המיוצאות

| פונקציה | שורה | התנהגות |
|---|---|---|
| `getUser()` | `dal.ts:14` | המשתמש המאומת או `null`. משתמש ב‑`supabase.auth.getUser()` שמאמת את הטוקן מול שרת ה‑Auth — **לעולם לא** `getSession()` להרשאות |
| `requireUser()` | `dal.ts:23` | דורש משתמש מחובר; אחרת `redirect('/auth/login')` |
| `isAdmin()` | `dal.ts:36` | האם המשתמש admin — לא מפנה; ל‑UI מותנה בלבד (למשל קישור ניווט), לעולם לא שער הרשאה |
| `requireAdmin()` | `dal.ts:51` | דורש admin דרך RPC `has_role`; אחרת `redirect('/app')` |
| `ACTIVE_ORG_COOKIE` | `dal.ts:70` | שם ה‑cookie של הארגון הפעיל (`'active_org'`) |
| `getOrgContext()` | `dal.ts:91` | הארגונים של המשתמש + הארגון הפעיל. ה‑cookie הוא **העדפה בלבד** — הערך מאומת מול שורות `organization_members` של המשתמש; org id שלא ברשימת החברויות נופל לארגון הראשון (`dal.ts:118-120`) |
| `requireActiveOrg()` | `dal.ts:132` | דורש ארגון פעיל; אחרת `redirect('/app')` |

(בנוסף מיוצאים הטיפוסים `OrgMembership` ו‑`OrgContext` — `dal.ts:72-87`.)

### 3.2 היכן משתמשים

- `src/app/(customer)/app/layout.tsx:11` — `requireUser()` על כל תת‑העץ `/app`, בתוספת `isAdmin()` ו‑`getOrgContext()` לבניית ה‑shell.
- `src/app/(admin)/admin/layout.tsx:13` — `requireAdmin()` הוא גבול ההרשאה של כל תת‑העץ `/admin`.
- שכבת הנתונים `src/lib/data/*` — כמעט כל פונקציה נפתחת ב‑`requireUser()` (למשל `src/lib/data/events.ts:32`), וקבצי ה‑admin ב‑`src/lib/data/admin/*` נפתחים ב‑`requireAdmin()`.
- Route Handlers רגישים — למשל `src/app/api/campaigns/[id]/authorize/route.ts:83` קורא `requireUser()` ומחזיר redirect ללוגין בכשל.

### 3.3 סטטוס מעבר `getClaims()` → DAL

- קיימת תוכנית מפורטת: `plans/getclaims-dal-migration-plan.md` — מעבר מדורג ל‑`supabase.auth.getClaims()` (אימות JWT מקומי ב‑ES256, ללא round‑trip) ב‑Tier A, עם `requireFreshUser()` מבוסס `getUser()` (revocation‑aware) למוטציות כספיות ב‑Tier B.
- **מצב הקוד בפועל (מאומת ב‑grep על כל `src/`)**: התוכנית במעמד "AWAITING APPROVAL TO IMPLEMENT" ו**טרם מומשה** — `dal.ts` עדיין קורא `supabase.auth.getUser()` (`dal.ts:18`), אין שום קריאה ל‑`getClaims()` בקוד, ו‑`requireFreshUser` אינו קיים. עד ליישום, כל בדיקת זהות היא authoritative (network‑verified, revocation‑aware).

## 4. `src/proxy.ts` — ה‑middleware (proxy) של Next.js

ב‑Next.js 16 קובץ ה‑middleware נקרא `proxy` (`src/proxy.ts:6`). תחומי אחריותו מוגבלים בכוונה לשניים:

1. **רענון session** — יוצר `createServerClient` על גבי cookies של הבקשה וקורא `supabase.auth.getUser()` (לא `getSession()`), מה שמאמת את הטוקן ומפעיל refresh שנכתב חזרה ל‑cookies דרך `setAll` (`proxy.ts:20-41`).
2. **הפניה אופטימית**:
   - משתמש לא מחובר שניגש ל‑prefix מוגן — `PROTECTED_PREFIXES = ['/app', '/admin']` (`proxy.ts:13`) — מופנה ל‑`/auth/login?redirectTo=<path>` (`proxy.ts:48-52`).
   - משתמש מחובר שניגש ל‑`AUTH_PAGES = ['/auth/login', '/auth/signup']` מופנה ל‑`/app` (`proxy.ts:54-56`).

ה‑`matcher` מריץ את ה‑proxy על הכול פרט לנכסים סטטיים ותמונות (`proxy.ts:61-66`). חשוב: ההגנה האמיתית נמצאת בשכבת ה‑DAL והנתונים — ה‑proxy "לעולם אינו קו ההגנה היחיד" (`proxy.ts:9-11`). שימו לב ש‑`/api/*` אינו ברשימת ה‑prefixes המופנים — כל Route Handler תחת `/api` אוכף אימות והרשאה בעצמו.

## 5. מסלולי האימות — `src/app/auth/`

### 5.1 התחברות — `login`

- דף: `src/app/auth/login/page.tsx`; טופס client: `login-form.tsx` (`useActionState`).
- Server Action: `login()` ב‑`src/app/auth/actions.ts:10` — ולידציה עם Zod (`loginSchema`), ואז `supabase.auth.signInWithPassword`. שגיאה מוחזרת גנרית ("אימייל או סיסמה שגויים") בלי להסגיר סיבה; הצלחה → `redirect('/app')`.

### 5.2 הרשמה — `signup`

- Server Action: `signup()` ב‑`src/app/auth/actions.ts:33` — ולידציה עם `signupSchema` (email, password, full_name, phone) ואז `supabase.auth.signUp` כאשר `full_name`/`phone` נכנסים ל‑`user_metadata`; הטריגר `handle_new_user()` ב‑DB מעתיק אותם לשורת `profiles` (`actions.ts:51-52`).
- **מניעת user enumeration**: כאשר email confirmation מופעל, Supabase לא מחזיר שגיאה על אימייל קיים אלא user עם `identities` ריק וללא session. הזיהוי ממומש ב‑helper טהור וניתן לבדיקה — `isExistingUserSignup()` (`src/lib/auth/signup-helpers.ts:8-12`, נבדק ב‑`signup-helpers.test.ts`).
- הרשמה אמיתית ללא session (נדרש אישור מייל) → `redirect('/auth/signup/success')` — דף ייעודי (`src/app/auth/signup/success/page.tsx`) שמסביר את שלב אישור המייל (`actions.ts:74-76`).
- טופס ההרשמה (`signup-form.tsx`) הוא Client Component עם `useActionState`; שדה הסיסמה (`password-field.tsx`) עוטף את הרכיב המשותף `PasswordInput` (`src/components/password-input.tsx`) ומוסיף מד חוזק נגיש (`aria-describedby="password-strength"`).

### 5.3 Callback ו‑Logout

- `src/app/auth/callback/route.ts` — `GET` שמבצע `exchangeCodeForSession(code)` (אישור מייל / OAuth). פרמטר `?next=` מוגן מפני open‑redirect: רק נתיב פנימי שמתחיל ב‑`/` ולא ב‑`//` (`route.ts:10-12`). ההפניה יחסית (303) כדי להיפתר נכון מאחורי ה‑reverse proxy.
- `src/app/auth/logout/route.ts` — `POST` בלבד (לא GET — מונע logout via link/prefetch), `supabase.auth.signOut()` והפניה יחסית ל‑`/`.

### 5.4 חוזק סיסמה — `src/lib/password-strength.ts`

בשימוש בפועל בטופס ההרשמה: `src/app/auth/signup/password-field.tsx:10,32` טוען את `loadPasswordScorer()`. מנוע `@zxcvbn-ts` נטען **דינמית** בהקשת הסיסמה הראשונה (~50KB מחוץ ל‑bundle ההתחלתי; `password-strength.ts:32-48`). זהו משוב UI בלבד — השער האמיתי הוא ולידציית ה‑Zod בשרת (`min(8)` ב‑`signupSchema`), כמתועד ב‑`password-strength.ts:1-4`. הערה תפעולית: הגנת leaked‑password של Supabase Auth כבויה כרגע בפרויקט (ממצא advisor פתוח).

### 5.5 OTP — לא מסלול התחברות

`src/lib/data/otp.ts` וטבלת `otp_challenges` (מיגרציה `202606240015_sms_otp.sql`) משמשים **לאימות זהות בחתימת הסכם** (billing), לא ל‑login: הקוד לא נשמר (רק `sha256(code:phone)`), תוקף 5 דקות, 5 נסיונות אימות, rate‑limit של 5 קודים לשעה לכל phone+purpose — הכול מנוהל בשרת דרך ה‑service‑role client (`otp.ts:9-16`).

## 6. הרשאת Admin — מקור התפקיד האמין

### 6.1 `user_roles` + `has_role()`

- מקור האמת: טבלת `public.user_roles` (`user_id`, `role` מסוג enum `app_role = 'admin' | 'user'`) — ראו הטיפוסים המחוללים `src/lib/supabase/types.ts:1676-1696,1860`.
- הבדיקה: פונקציית `public.has_role(_user_id, _role)` — SECURITY DEFINER, משמשת גם את שכבת האפליקציה (RPC מ‑`requireAdmin`/`isAdmin`) וגם policies של RLS על טבלאות admin. הטבלה והפונקציה הן חלק מהסכמה הבסיסית שקיימת ב‑DB החי; קבצי המיגרציה המוקדמים בריפו (`20260621214435_*.sql`, `20260622*.sql`) הם placeholders מסונכרנים (`;` בלבד) — הגדרותיהן אומתו מול ה‑DB החי (`plans/authz-current-state-verification.md` §1.4).
- שום תפקיד אינו נקרא מ‑JWT claims, מ‑cookie או מקלט דפדפן — תמיד RPC מול הטבלה.

### 6.2 Bootstrap — `claim_first_admin`

- RPC ללא ארגומנטים (`types.ts:1792` — `Args: never; Returns: boolean`), SECURITY DEFINER: בודק אטומית שאין עדיין admin, ורק אז מעניק לקורא את התפקיד. חוזה: `true` = הקורא הפך ל‑admin הראשון; `false` = כבר קיים admin והבקשה נדחית; שגיאה = לא מאומת וכד'.
- ה‑Server Action: `claimFirstAdminAction` ב‑`src/app/(customer)/app/admin-access/actions.ts:21-46` — `requireUser()` ואז RPC; על `false` מוחזרת שגיאה בלי להדליף מי/כמה admins קיימים; על הצלחה `revalidatePath('/app','layout')` ו‑redirect ל‑`/admin`.

### 6.3 טבלאות admin — cookie client, לא service‑role

שכבת הנתונים של ה‑admin (`src/lib/data/admin/*`) עובדת עם ה‑client רגיל מבוסס ה‑cookies (`createClient` מ‑`server.ts`), ולא עם service‑role: טבלאות ה‑admin (`app_settings`, `webhook_inbox`, `message_templates`, `outreach_state`, `agreement_documents` ועוד) מוגנות ב‑policies בסגנון `has_role(auth.uid(),'admin'::app_role)` (למשל `202606240005_app_settings.sql:17-20`, `202606290035_webhook_inbox.sql:37-40`), כך ש‑RLS עצמו אוכף את התפקיד גם אם קוד האפליקציה שגה.

## 6A. ציר צוות הפלטפורמה — `platform_staff`

נוסף ב‑`20260713171233_platform_rbac_owner_staff.sql`. ציר **נפרד** מ‑`user_roles`/`has_role` של §6, ונפרד לגמרי מציר הלקוח.

| טבלה | תפקיד |
|---|---|
| `platform_staff` | חברות: `user_id` (UNIQUE) + `role_id` + `granted_by`. תפקיד יחיד למשתמש. |
| `platform_roles` | קטלוג התפקידים — `owner`, `ops_engineer`, `billing_clerk`, `auditor`, `support_agent` |
| `platform_role_permissions` | מיפוי תפקיד → הרשאה (נתונים, לא קוד) |
| `platform_permission_definitions` | קטלוג מפתחות ההרשאה |

הפונקציות (כולן SECURITY DEFINER, פותרות `auth.uid()` בעצמן): `is_platform_owner()`, `is_staff()`, `has_platform_permission(_key)`. בשכבת האפליקציה: `isPlatformOwner` / `requirePlatformOwner` / `isStaff` / `hasPlatformPermission` / `requirePlatformPermission` ב‑`src/lib/auth/dal.ts:74-141`.

### 6A.1 מצבת התפקידים (נמדד 2026‑07‑21)

| name | label | rank | הרשאות | חברים |
|---|---|---|---|---|
| `owner` | בעל מערכת | 100 | 10 (הכול) | 1 |
| `ops_engineer` | תפעול טכני | 50 | 4 | 0 |
| `billing_clerk` | חיוב וגבייה | 40 | 4 | 0 |
| `support_agent` | נציג תמיכה | 20 | 2 | 0 |
| `auditor` | צופה | 10 | 2 | 0 |

היום **רק תפקיד ה‑owner מאויש**. ארבעת האחרים מוגדרים ומוכנים אך ריקים — כלומר מצבת ההרשאות תוכננה לצוות ומחכה לו, ולא נוסתה בפועל מול משתמשים אמיתיים.

### 6A.2 מטריצת הרשאה × תפקיד (10 מפתחות)

| מפתח | קטגוריה | owner | ops_engineer | billing_clerk | support_agent | auditor |
|---|---|---|---|---|---|---|
| `view_customer_data` | support | ✔ | — | ✔ | ✔ | — |
| `view_recordings` | support | ✔ | — | — | — | — |
| `manage_billing` | billing | ✔ | — | ✔ | — | — |
| `view_billing` | billing | ✔ | — | ✔ | — | ✔ |
| `manage_settings` | platform | ✔ | ✔ | — | — | — |
| `manage_staff` | platform | ✔ | — | — | — | — |
| `roles.manage` | platform | ✔ | — | — | — | — |
| `view_activity_log` | ops | ✔ | ✔ | ✔ | ✔ | ✔ |
| `manage_voice` | ops | ✔ | ✔ | — | — | — |
| `view_webhooks` | ops | ✔ | ✔ | — | — | — |

**איך לקרוא את זה:**

- **`owner`** מחזיק את כל העשר בכל מקרה — הרשאותיו אינן ניתנות לעריכה (אכוף בטריגר). לכן הוספת מפתח הרשאה חדש מעניקה אותו אוטומטית ל‑owner ולא חוסמת אותו.
- **`support_agent`** («נציג תמיכה») הוא הצר ביותר בעל גישה ללקוח: `view_customer_data` + `view_activity_log` בלבד — **ולא** חיוב, **ולא** הקלטות, **ולא** הגדרות, **ולא** ניהול צוות. שימו לב שהוא **אינו** מגיע ל‑`/admin/users/[id]`: אותו מסך מגודר ב‑`manage_staff`, שרק ל‑owner יש. גישתו לנתוני לקוח היא דרך `/admin/support`, `/admin/callbacks` ו‑`/admin/contacts`, ועוברת בנוסף דרך שער «סיבת גישה» (break‑glass) שכותב רשומת ביקורת לפני שהנתונים נחשפים.
- **`view_recordings`** היא ההרשאה הבלעדית ביותר — owner בלבד. הקלטת שיחה מכילה את קולו של האורח, וזה מידע אישי מסוג אחר לגמרי מטבלת נתונים.
- **`view_activity_log`** היא היחידה שכל חמשת התפקידים מחזיקים — יומן הפעילות הוא הרצפה המשותפת.
- **`manage_voice`** מבדילה בין **צפייה** במוקד לבין **פיקוד** עליו: `is_console_agent()` (§6B) פותחת את הפיד, ו‑`manage_voice` נדרשת כדי להוציא פקודות. ההפרדה נשמרת בכוונה בשכבת ה‑Route Handler ולא בתוך `is_console_agent()` — הכנסתה לפונקציה הייתה מרוקנת את הפיד לנציג שאין לו אותה, כלומר רגרסיה ולא הידוק.

### 6A.3 איזו הרשאה פותחת איזה מסך

זו המפה התפעולית — מה בפועל נחסם, לא מה שהקטלוג מבטיח. כל שורה אומתה מול קריאת `requirePlatformPermission` בקוד המסך.

| הרשאה | מסכים שהיא פותחת |
|---|---|
| `view_customer_data` | `/admin/support`, `/admin/callbacks`, `/admin/contacts` |
| `manage_staff` | `/admin/users/[id]`, `/admin/access-log` |
| `manage_billing` | `/admin/packages` (+`new`/`[id]`), `/admin/campaigns` |
| `manage_settings` | `/admin/settings`, `/admin/agreement`, `/admin/company`, `/admin/templates`, `/admin/alerts` |
| `manage_voice` | `/admin/voice`, `/admin/voice/platform`, `/admin/dnc` |
| `view_webhooks` | `/admin/webhooks` |
| `view_activity_log` | `/admin/activity` |
| `view_recordings` | הקלטות שיחה (owner בלבד) |

**מסקנה מעשית:** היום, מכיוון שרק `owner` מאויש, כל המסכים נגישים לאדם אחד. ברגע שיאויש `support_agent`, הוא יראה שלושה מסכים בלבד מתוך השמונה — וזו הנקודה שבה כדאי לבדוק את המצבת בפועל ולא רק בתיאוריה.

הקטלוג והמטריצה הם **נתונים ולא קוד** — ניתנים לעריכה מ‑`/admin/roles` ואין בקוד union קשיח של מפתחות, בהתאם לעקרון "no hardcoded business facts".

**אינווריאנטים אכופי‑DB:** הרשאות תפקיד ה‑owner אינן ניתנות לשינוי; לא ניתן להסיר את בעל המערכת האחרון (טריגר `platform_staff_last_owner`, BEFORE DELETE — מחזיר הודעה בעברית שמוצגת כמות שהיא); כל שינוי חברות נכתב ל‑`platform_role_audit_log` (טריגר `platform_staff_audit`).

ניהול: `/admin/roles` (קטלוג + מטריצת role×permission) ו‑`/admin/users/[id]` (הקצאת תפקיד למשתמש) — `src/lib/data/admin/platform-roles.ts`.

## 6B. ציר מוקד השיחות — `console_agents`

**אלו בני אדם, לא סוכן ה‑AI.** ההבחנה קריטית ומבלבלת: המערכת מריצה סוכן קולי של ElevenLabs שמתקשר לאורחים, ובמקביל יש **נציגים אנושיים** שמנטרים את השיחות האלה. `console_agents` הם השניים.

הראיה החדה ביותר היא הטבלה הנלווית `human_agent_call_legs`, שה‑`mode` שלה מוגבל ל‑`'monitor' | 'takeover'` — הנציג מאזין לשיחה שה‑AI מנהל, ואם צריך משתלט עליה ומדבר עם האורח בעצמו.

| טבלה | תפקיד |
|---|---|
| `console_agents` | מי רשאי לשבת במוקד. `user_id` PK, `display_name`, `vox_username` |
| `agent_status` | נוכחות/זמינות הנציג |
| `console_call_feed` | פיד השיחות (מסונכרן מ‑`call_attempts` בטריגר) |
| `human_agent_call_legs` | רגל השיחה של הנציג בעת ניטור/השתלטות |

**שני אילוצים שנוספו ב‑2026‑07‑20/21 וחייבים להישמר:**

1. `is_console_agent()` = `is_staff() AND exists(console_agents where user_id = auth.uid())` — סוגר את צד ה**קריאה**.
2. `console_agents_staff_fkey` → `platform_staff(user_id) ON DELETE CASCADE` — סוגר את צד ה**הרשמה**, ומבטיח שביטול חברות צוות מסיר את הנציג מהמוקד אוטומטית.

שש ה‑views (`console_events`, `console_campaigns`, `console_campaign_targets`, `console_call_analysis`, `console_rsvp_results`, `console_me`) מגודרות ב‑`is_console_agent()` **ללא סינון בעלות** — זה נכון לציר צוות ואסור בציר לקוח. הן בבעלות `postgres` ללא `security_invoker` (מכוון: `security_invoker` היה מחזיר אפס שורות ושובר את המוקד), ולכן ה‑advisor מסמן אותן `security_definer_view` — ידוע ומקובל.

ניהול ההרשמה: סקשן «נציג אנושי במוקד השיחות» ב‑`/admin/users/[id]`, מגודר `requirePlatformOwner` ומתועד ב‑`logActivity` + התראת Slack (`enrollConsoleAgent`/`removeConsoleAgent` ב‑`platform-roles.ts`).

## 7. Multi‑tenancy ארגוני — סכמה, תפקידים והרשאות

מקור: מיגרציה `supabase/migrations/202606280021_org_multitenancy.sql` (Phase 1, additive); runbook: `supabase/runbooks/org_multitenancy_phase1.md`. הוחלה על ה‑DB החי.

### 7.1 הטבלאות

| טבלה | תפקיד |
|---|---|
| `organizations` | מיכל ה‑tenant (`202606280021:59-65`) |
| `organization_members` | חברות: user + role לכל org; `UNIQUE(organization_id, user_id)` (`:71-78`) |
| `organization_invitations` | הזמנות עם token אטום, תפוגה, ביטול, קבלה חד‑פעמית (`:83-99`) |
| `organization_audit_log` | יומן שינויי חברות/תפקידים — כתיבה דרך service‑role בלבד (`:102-112`) |
| `org_roles` | ארבעת התפקידים הקבועים — **גלובליים**, ללא `organization_id` (`:38-47`) |
| `permission_definitions` | קטלוג ההרשאות (resource × action) — **נתונים**, לא קוד (`:27-35`) |
| `role_permissions` | מיפוי role → permission — נתונים (`:50-56`) |

בנוסף: `events.org_id` נוסף (nullable בשלב זה, `owner_id` נשמר; `:114-117`), ו‑backfill אידמפוטנטי יצר "ארגון אישי" לכל בעל אירועים קיים (`:349-369`).

### 7.2 ארבעת התפקידים הקבועים (data‑driven)

| name | label | rank | הערות |
|---|---|---|---|
| `owner` | בעלים | 40 | `is_owner_role=true`; כל 24 ההרשאות |
| `admin` | מנהל | 30 | הכול פרט ל‑`organization.edit` (רק owner משנה שם ארגון) |
| `member` | חבר | 20 | סט עריכה מצומצם (ראו מטריצה) |
| `viewer` | צופה | 10 | כל פעולות `view` בלבד |

התפקידים והקטלוג נזרעים כ‑DATA (`:147-152`), והלקוחות אינם יכולים לערוך אותם: על `org_roles`/`permission_definitions`/`role_permissions` יש RLS שמתיר קריאה לכל משתמש מאומת ושינוי לצוות הפלטפורמה בלבד (`:281-306`). ה‑`rank` משמש לבדיקות anti‑escalation בשכבת האפליקציה.

### 7.3 קטלוג ההרשאות (24 מפתחות) ומטריצת role×permission

נזרע ב‑`202606280021:120-145`; ✔ לפי ה‑seed ב‑`:154-190`:

| resource.action | owner | admin | member | viewer |
|---|---|---|---|---|
| `events.view` | ✔ | ✔ | ✔ | ✔ |
| `events.create` | ✔ | ✔ | ✔ | — |
| `events.edit` | ✔ | ✔ | ✔ | — |
| `events.delete` | ✔ | ✔ | — | — |
| `guests.view` | ✔ | ✔ | ✔ | ✔ |
| `guests.create` | ✔ | ✔ | ✔ | — |
| `guests.edit` | ✔ | ✔ | ✔ | — |
| `guests.delete` | ✔ | ✔ | — | — |
| `contacts.view` | ✔ | ✔ | ✔ | ✔ |
| `contacts.create` | ✔ | ✔ | ✔ | — |
| `contacts.edit` | ✔ | ✔ | ✔ | — |
| `contacts.delete` | ✔ | ✔ | — | — |
| `campaigns.view` | ✔ | ✔ | ✔ | ✔ |
| `campaigns.create` | ✔ | ✔ | ✔ | — |
| `campaigns.edit` | ✔ | ✔ | ✔ | — |
| `campaigns.delete` | ✔ | ✔ | — | — |
| `campaigns.manage` | ✔ | ✔ | — | — |
| `reports.view` | ✔ | ✔ | ✔ | ✔ |
| `billing.view` | ✔ | ✔ | ✔ | ✔ |
| `members.view` | ✔ | ✔ | ✔ | ✔ |
| `members.manage` | ✔ | ✔ | — | — |
| `organization.view` | ✔ | ✔ | ✔ | ✔ |
| `organization.edit` | ✔ | — | — | — |
| `organization.manage` | ✔ | ✔ | — | — |

### 7.4 `has_org_permission()` — מקור אמת יחיד

```sql
-- 202606280021_org_multitenancy.sql:196-208 (SECURITY DEFINER, stable)
public.has_org_permission(_org_id uuid, _resource text, _action text) returns boolean
-- exists: organization_members ⋈ role_permissions ⋈ permission_definitions
--         where user_id = auth.uid()
```

פונקציות עזר נלוות (כולן SECURITY DEFINER, `:192-275`): `is_org_member(_org_id)` (פרימיטיב הבידוד ל‑RLS, `:211`), `can_access_event(_event_id,_resource,_action)` (שער אירוע מודע‑org; ה‑owner הישן תמיד עובר, `:221`), `org_role_rank(_role_id)` (`:234`), `create_organization(_name)` (אטומי — org + חבר owner ראשון, `:240`), `accept_invitation(_token)` (חד‑פעמי, מותאם‑email, `:255`).

### 7.5 שכבת האפליקציה — `src/lib/permissions.ts`

- `can(orgId, resource, action)` (`permissions.ts:23`) — לא זורק; ל‑UI מותנה. ממומש כ‑RPC ל‑`has_org_permission` וממומואיז ב‑`cache()`.
- `requirePermission(orgId, resource, action)` (`permissions.ts:44`) — זורק שגיאה בטוחה למשתמש; נקרא בראש כל Server Action/מוטציה ארגונית.
- **בכוונה אין union קשיח של מפתחות הרשאה בקוד** — הקטלוג נשאר data‑driven וניתן לעריכה כנתונים (`permissions.ts:16-18`), בהתאם לעקרון "no hardcoded business facts".
- שימוש בפועל: `src/app/(customer)/app/team/page.tsx:16` (`requirePermission(orgId,'members','view')`), `src/lib/data/orgs.ts:187-426` (view/manage לכל פעולות הצוות וההזמנות), `src/app/(customer)/app/layout.tsx:20` (`can(...,'members','view')` להצגת ניווט).
- החלפת ארגון פעיל: ה‑cookie `active_org` נכתב ב‑`src/app/(customer)/app/team/actions.ts:56` וב‑`src/app/(public)/join/[token]/actions.ts:37`, אך כאמור מאומת תמיד מול החברויות ב‑`getOrgContext()`.

### 7.6 סטטוס השלבים

- **Phase 1 (סכמה + תפקידים + backfill)** — הוחל על ה‑DB החי לפי ה‑runbook `supabase/runbooks/org_multitenancy_phase1.md` (מיגרציה additive; `events.owner_id` נשמר, policies קיימות לא נגעו).
- **שכבת אפליקציה קיימת**: ניהול צוות והזמנות פועל — `src/app/(customer)/app/team/` (roster, שינוי תפקיד, הזמנות), `src/app/(public)/join/[token]/` (קבלת הזמנה דרך `accept_invitation`), `src/lib/data/orgs.ts` (כל הפעולות מגודרות `requirePermission`), ובחירת ארגון פעיל ב‑shell.
- **בוצע מאז** (תיקון לגרסת 2026‑07‑02, שציינה שזה "טרם בוצע"): `can_access_event` מחווט בפועל — נמדד 2026‑07‑21, **26 policies** משתמשות בו, והוא השער הנפוץ ביותר בסכמה. `events.org_id` נותר nullable בכוונה, ושני האירועים ב‑DB החי משויכים לארגון.

## 8. תנוחת ה‑RLS (Row Level Security)

- **כל 54 הטבלאות הציבוריות ב‑DB החי עם RLS מופעל** — נמדד 2026‑07‑21: `select count(*) ... where relkind='r' and not relrowsecurity` מחזיר **0**. (הגרסה הקודמת של המסמך ציינה 33; הסכמה גדלה מאז.) המיגרציות בריפו מפעילות RLS על כל טבלה חדשה.
- **RLS הוא defense‑in‑depth, לא ההרשאה הראשית**: הבדיקה הראשית היא תמיד בשרת (DAL + שכבת נתונים). ה‑policies מגדרות ב‑`auth.uid()` / `owns_event()` / `has_role()` / `has_org_permission()` / `is_org_member()`.
- **טבלאות admin** — policy בסגנון `has_role(auth.uid(),'admin')`, והגישה מהקוד היא דרך ה‑client מבוסס‑cookies (לא service‑role), כך שה‑RLS באמת נבדק (§6.3).
- **משטח אנונימי מכוון וצר**: נמדד 2026‑07‑21 — **policy אחת בלבד** כוללת את התפקיד `anon`: `packages_public_read` (SELECT על `packages`, roles `{anon,authenticated}`). ה‑policies של `callback_requests`/`contact_messages` שהוזכרו בגרסה הקודמת אינן מוגדרות עוד על `anon`.
- **אפס policies מגודרות על התפקיד `public`** (נמדד: 0). זה היה פער פתוח בגרסה הקודמת ונסגר.
- **אפס פונקציות ב‑`public` ניתנות להרצה ע"י `anon`** (נמדד על כל 49 הפונקציות). ראו §8.1.

### 8.1 מודל ההרשאות על פונקציות — ולמה `authenticated` חייב EXECUTE

זו נקודה שנכשלים בה בקלות, ובאמת נכשלנו בה: **ב‑Postgres פונקציה נולדת עם `EXECUTE` ל‑`PUBLIC`, וכל תפקיד יורש מ‑PUBLIC.** לכן `revoke execute ... from anon` בזמן ש‑PUBLIC עדיין מחזיק הוא **no‑op גמור**. חייבים `revoke ... from public` (וכך גם התיעוד הרשמי של Supabase מציג — שני צעדים נפרדים). זה בדיוק הבאג ב‑`20260720025745`, שתוקן ב‑`20260721005000`; סריקה מלאה אחריו מצאה עוד שלוש חריגות (פונקציות טריגר), שנסגרו ב‑`20260721012000`.

**14 פונקציות SECURITY DEFINER כן ניתנות להרצה ע"י `authenticated` — וכך חייב להיות.** זו אינה רשלנות אלא דרישה ארכיטקטונית: ביטויי RLS מורצים **בהרשאות התפקיד הקורא**. אומת אמפירית בטרנזקציה מגולגלת — שלילת EXECUTE על `is_console_agent()` מ‑`authenticated` הפכה קריאה תקינה ל‑`42501 permission denied for function is_console_agent`. שמונה מהן בשימוש ישיר ב‑policies, והשאר נקראות מהשרת דרך ה‑client מבוסס‑cookie, שגם הוא רץ כ‑`authenticated`.

גבול האבטחה של אותן פונקציות נמצא **בתוכן**: כל אחת פותרת `auth.uid()` בעצמה ואינה סומכת על זהות שהקורא סיפק. היוצא מן הכלל לכאורה הוא `has_role(_user_id, _role)` שמקבל מזהה כפרמטר — נבדקו **כל** ה‑policies המשתמשות בו, וכולן מעבירות `auth.uid()`. אזהרות ה‑advisor מסוג `authenticated_security_definer_function_executable` הן אפוא רעש מובנה לארכיטקטורה הזו, לא ליקוי.

**טריגרים אינם צורכים את ההרשאה הזו.** פונקציית טריגר אינה ניתנת לקריאה ישירה כלל (`0A000: trigger functions can only be called as triggers`), ו‑Postgres מפעיל אותה דרך מנגנון הטריגר בלי לבדוק את הרשאת מבצע ה‑statement — אומת: לאחר שלילת EXECUTE מ‑`authenticated`, `UPDATE` שבוצע בהתחזות ל‑`authenticated` הצליח וה‑`updated_at` עודכן.
- ה‑RSVP הציבורי **אינו** עובר דרך RLS של anon אלא דרך RPCs נעולים ל‑service_role (ראו §10.1).

## 9. מודל הבעלות (Ownership)

אירועים שייכים לבעליהם (`events.owner_id`), וכל רשומה נגזרת נבדקת דרך גבול הבעלות של האירוע.

### 9.1 השערים בשכבת הנתונים

- **`requireOwnedEvent(eventId)`** — `src/lib/data/events.ts:31-47`: `requireUser()` ואז `select ... .eq('id', eventId).eq('owner_id', user.id)`; אם אין שורה → `notFound()` (404, לא 403 — לא מדליף קיום). זהו שער הבעלות בראש כל פונקציית נתונים סקופת‑אירוע (guests, campaigns, agreements, reports וכו').
- **`requireEventAccess(eventId, resource, action)`** — `events.ts:55-82`: הגרסה מודעת‑ה‑org — מאשר בעלים **או** חבר ארגון עם ההרשאה, דרך RPC `can_access_event()` (מקור אמת יחיד ב‑DB). קיים ומוכן; RLS של `events` עצמה טרם הורחב לחברות org (Phase 3 עתידי), ולכן רוב המסלולים עדיין על `requireOwnedEvent`.
- **סינון בעלות מפורש בנוסף ל‑RLS**: רשימות ועדכונים תמיד מסננים `.eq('owner_id', user.id)` בעצמם (למשל `events.ts:107,310`), והעדכון בנוי מ‑allow‑list מפורש של עמודות כך ש‑`id`/`owner_id` לעולם לא ניתנים לשינוי (`events.ts:258-261`).
- **יצירה**: `createEvent` מציב את הבעלות בשרת — `insert({ ...input, owner_id: user.id, org_id: orgId })` (`events.ts:173`) — לעולם לא מקלט הדפדפן.

### 9.1.1 רשומות נגזרות — סקופ דרך האירוע

רשומות בנות (guests, groups, campaigns, agreements, reports, activity) לעולם אינן נבדקות ישירות מול המשתמש אלא דרך גבול הבעלות של האירוע. דוגמה מייצגת — `src/lib/data/guests.ts`: **כל** פונקציה מקבלת `eventId` ונפתחת ב‑`await requireOwnedEvent(eventId)` לפני כל קריאה/כתיבה — `listGuests` (`guests.ts:172`), `getGuest` (`:295`), `createGuest` (`:332`), `updateGuest` (`:389`), `deleteGuest` (`:440`), `listGroups` (`:519`), `createGroup` (`:544`) ועוד. כך גם מזהה guest גנוב אינו שמיש בלי בעלות על האירוע שלו.

### 9.2 דוגמה ב‑Route Handler

`src/app/api/campaigns/[id]/authorize/route.ts` (מסלול כספי — J5 hold): בדיקת origin (`isAllowedOrigin`) → `requireUser()` (`route.ts:83`) → טעינת הקמפיין (`getCampaignForHold`, קריאת service‑role) → **אימות בעלות מפורש** `requireOwnedEvent(campaign.event_id)` (`route.ts:100`) לפני כל פעולה, ובנוסף שערי lifecycle — `isPastEventDay(event.event_date)` (`route.ts:122`) ו‑`event.status === 'active'` (`route.ts:128`). אותו דפוס חוזר ב‑`/api/campaigns/[id]/close-charge` ו‑`/api/campaigns/[id]/whatsapp-send`; מסלול `/api/orders/[id]/pay` הוסר ב‑cleanup של 2026‑07‑09.

## 10. נעילות אבטחה (Security Lockdowns)

### 10.1 סיווג SECURITY DEFINER ונעילת RPCs ל‑service_role

בבדיקה החיה (2026‑06‑30): 18 פונקציות ב‑`public`, מהן 16 SECURITY DEFINER עם `search_path=public`. הסיווג (לפי `plans/authz-current-state-verification.md` §1.4):

| קבוצה | פונקציות | EXECUTE |
|---|---|---|
| **נעולות ל‑service_role בלבד** | `submit_rsvp`, `get_rsvp_by_token`, `claim_webhook_events`, `try_record_billed_result`, `campaign_billing_summary` | anon ✗, authenticated ✗, service_role ✓ |
| helpers של RLS (חייבות להישאר ל‑authenticated) | `owns_event`, `has_role`, `has_org_permission`, `is_org_member` | authenticated ✓ |
| RPCs אפליקטיביים | `accept_invitation`, `claim_first_admin`, `create_organization`, `can_access_event`, `org_role_rank` | anon/auth ✓ (hardening P2/P3 פתוח) |
| trigger/util | `handle_new_user`, `set_updated_at`, `rls_auto_enable`, פונקציות ה‑lifecycle | לא רלוונטי כ‑RPC |

- **מיגרציה `202606300038_lock_billing_rpcs.sql` (P0, סגור ומאומת‑חי)**: שתי פונקציות ה‑billing — `try_record_billed_result` (כותבת חיוב אמיתי) ו‑`campaign_billing_summary` (חושפת נתוני חיוב) — היו SECURITY DEFINER עם EXECUTE ל‑anon/authenticated/PUBLIC וללא בדיקת זהות פנימית; הוכח חי שקריאת REST אנונימית עבדה. המיגרציה עושה `revoke execute ... from anon, authenticated, public` ו‑`grant ... to service_role` (`0038:29-45`), במקביל לנעילה שכבר הייתה על `submit_rsvp`/`get_rsvp_by_token`/`claim_webhook_events`.
- המשמעות למסלול ה‑RSVP הציבורי: `src/app/(public)/r/[token]` קורא את ה‑RPCs דרך `createAdminClient()` בלבד (`src/lib/data/rsvp.ts:79,102`), כך שהאימות של ה‑token מתבצע בתוך גוף הפונקציה בשרת, ואנונימיים אינם יכולים לקרוא לפונקציות ישירות דרך PostgREST.

### 10.2 שומרי lifecycle ב‑DB (טריגרים)

נאכפים ב‑DB כי `public.events` כתיבת‑בעלים דרך PostgREST — ולידציית Zod לבדה עקיפה:

- **L0a — `20260630072729_events_date_guards_l0a.sql`**: CHECK `events_rsvp_deadline_within_event` (deadline ≤ יום האירוע בישראל, ו‑deadline מחייב `event_date`) + שני טריגרים נגד `event_date` בעבר.
- **מודל מצבי האירוע — `20260630223635_event_lifecycle_state_model.sql`** (החליף את טריגרי L0a בסופרסט): `events_before_insert` (כופה `status='draft'` ו‑`event_date` ≥ מחר בישראל), `events_guard_update` (מכונת מצבים `draft→active→closed` בלבד, נעילות עריכה, SECURITY DEFINER לקריאת `campaigns` חוצת‑RLS), `campaigns_require_active_event`, `campaigns_guard_cancel`, ו‑RPC `cancel_campaign`.
- **`20260630230249_event_lifecycle_trigger_revoke_public.sql`**: revoke EXECUTE מפונקציות הטריגר החדשות (ניקיון advisor; טריגרים אינם עוברים בדיקת EXECUTE ממילא).
- **L2 — `20260630164747_l2_rpc_event_date_guards_and_billing_integrity.sql`**: שער `event_date` ("עבר" = אחרי סוף היום הקלנדרי בישראל) בתוך שלושת ה‑RPCs הנעולים + שלמות billing — `try_record_billed_result` גוזר את ה‑event מ‑`campaign.event_id` ודוחה `event_mismatch` במקום להכניס `p_event` מילולית.
- **L1 — שכבת האפליקציה**: הכלל המשותף ממומש ב‑`src/lib/data/event-date.ts` — `isPastEventDay()` (`:24`) ו‑`assertEventNotPast()` (`:36`) — ונאכף במסלולי approve/activate (`src/lib/data/campaigns.ts:134,269,668`), חתימת הסכם (`src/lib/data/agreements.ts:107`), שליחה ידנית (`src/lib/data/outreach.ts:102`), מנוע ה‑outreach (`src/lib/data/outreach-engine.ts:149`) ומסלולי ה‑API הכספיים (§9.2).

כל המיגרציות הללו מוחלות על ה‑DB החי (אומת מול `supabase migration list --linked`).

### 10.3 הקשחות משלימות

- **Rate limiting** בשרת: `src/lib/security/rate-limit.ts`, בשימוש בפעולות ה‑RSVP הציבוריות (`src/app/(public)/r/[token]/actions.ts`), בפעולות קמפיין וב‑OTP.
- **בדיקת Origin** במסלולי `/api` כספיים (`isAllowedOrigin`, ראו §9.2) כהגנת CSRF משלימה ל‑cookies.
- **שגיאות בטוחות**: כשלונות auth מוחזרים גנריים (login, callback → `/auth/login?error=auth`, claim_first_admin) בלי חשיפת פרטי ספק/DB.

## 11. סיכום — מי מקור האמת לכל שאלה

| שאלה | מקור האמת | נקודת הכניסה בקוד |
|---|---|---|
| מי המשתמש? | Supabase Auth (token מאומת מול השרת) | `getUser()` / `requireUser()` — `src/lib/auth/dal.ts:14,23` |
| האם admin פלטפורמה? (דגל ישן) | טבלת `user_roles` דרך RPC `has_role` | `requireAdmin()` / `isAdmin()` — `dal.ts:36,51` |
| האם חבר צוות פלטפורמה? | טבלת `platform_staff` דרך RPC `is_staff` | `isStaff()` — `dal.ts:100` |
| מותר לבצע פעולת צוות ספציפית? | `platform_role_permissions` דרך `has_platform_permission` | `hasPlatformPermission()` / `requirePlatformPermission()` — `dal.ts:117,135` |
| האם נציג מוקד שיחות? | `console_agents` **∧** `platform_staff` דרך `is_console_agent` | ה‑views ו‑policies של `console_*` |
| מה הארגון הפעיל? | `organization_members` (cookie = העדפה בלבד) | `getOrgContext()` / `requireActiveOrg()` — `dal.ts:91,132` |
| מותר לבצע פעולה ארגונית? | RPC `has_org_permission` (קטלוג data‑driven) | `can()` / `requirePermission()` — `src/lib/permissions.ts:23,44` |
| האם האירוע שלי? | `events.owner_id` (או `can_access_event` המודע‑org) | `requireOwnedEvent()` / `requireEventAccess()` — `src/lib/data/events.ts:31,55` |
| בידוד שורות ב‑DB | RLS על כל הטבלאות הציבוריות | policies מבוססות `auth.uid()` / `owns_event` / `has_role` / `is_org_member` |
| RSVP ציבורי | RPCs נעולים ל‑service_role עם token אטום | `src/lib/data/rsvp.ts:79,102` |

## 12. פערים ידועים ופריטים פתוחים (נמדד 2026‑07‑21)

- מעבר `getClaims()` ב‑DAL — מתוכנן, טרם מומש (§3.3).
- **שני מנגנוני admin במקביל**: `user_roles`+`has_role('admin')` (§6) ו‑`platform_staff`+`is_staff` (§6A) חיים זה לצד זה; 10 policies עדיין מגודרות ב‑`has_role`. אין כאן חור, אבל יש כפילות מושגית שכדאי לאחד.
- הגנת leaked‑password של Supabase Auth כבויה (הגדרת דשבורד).
- 6 אזהרות `security_definer_view` על ה‑views של `console_*` — **מכוונות** ומוסברות ב‑§6B; `security_invoker` היה שובר את המוקד.
- אזהרות `function_search_path_mutable` על פונקציות בסכמת `pgboss` (קוד צד‑שלישי, לא שלנו).

### נסגר מאז גרסת 2026‑07‑02 — אין לפתוח מחדש

| פער בגרסה הקודמת | מצב היום (נמדד) |
|---|---|
| «11 SECDEF ניתנות להרצה ע"י anon/authenticated» | anon: **0** מתוך 49. authenticated: 14 — **נדרש**, ראו §8.1 |
| «`set_updated_at` ללא `search_path` קשיח» | יש לו `proconfig` |
| «policies מגודרות על role `{public}`» | **0** |
| «`can_access_event` בנוי אך לא מחווט» | **26 policies** |
| «`callback_requests`/`contact_messages` INSERT פתוח ל‑anon» | אינן מוגדרות עוד על `anon`; ה‑policy היחידה שנותרה היא `packages_public_read` |

---

*הפניות עיקריות: `src/lib/auth/dal.ts`, `src/lib/supabase/{client,server,admin,env}.ts`, `src/proxy.ts`, `src/app/auth/`, `src/lib/permissions.ts`, `src/lib/data/events.ts`, `supabase/migrations/202606280021_org_multitenancy.sql`, `202606300038_lock_billing_rpcs.sql`, מיגרציות ה‑lifecycle מ‑2026‑06‑30, `supabase/runbooks/org_multitenancy_phase1.md`, `plans/authz-current-state-verification.md`.*
