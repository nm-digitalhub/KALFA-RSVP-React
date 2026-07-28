# תוכנית: שליטת אדמין בתוסף העוגיות (vanilla-cookieconsent)

**סטטוס: מאושר למימוש (27.7). מיגרציה מוכנה אך לא הוחלה על ה-DB החי — ממתינה
לאישור בעלים נפרד. אין commit ואין deploy.**

## הכרעות סגורות (בעלים, 27.7)

1. **טקסטים נשארים בקוד** — אין שכבת עריכת-טקסט מהאדמין. הנימוק (§7) התקבל:
   הספרייה מציבה title/description דרך `innerHTML` (מאומת מקוד המקור), כך
   שטקסט-אדמין לא-מסונן הוא וקטור XSS נגד כל מבקר; וכל revision עד היום ליווה
   נימוק משפטי מפורש שאסור לעקוף בשדה טקסט חופשי.
2. **מיקום**: עמוד עצמאי `/admin/cookie-consent` + כניסה בסרגל הניווט, לפי
   תבנית `/admin/alerts`.
3. **תג-סטטוס חי**: בשני דפי המדיניות — `/cookies` **וגם** `/privacy` —
   כבר בסבב הזה, מאותו קונפיג.
4. **אטומיות**: כתיבת מתג+bump = **UPDATE אחד על שורה בודדת** באותה טבלה
   (לא RPC, לא שני writes נפרדים). `app_settings` הוא singleton אמיתי
   (`id boolean` PK, שורה יחידה) — שום דבר לא מכריח פיצול, אין צורך להסלים.

מטרה: שליטה מפאנל /admin ב-vanilla-cookieconsent v3.1.0 — הפעלה/כיבוי כללי,
הפעלה/כיבוי כל קטגוריה (`analytics`/`marketing`) בנפרד, העלאת revision.

---

## 0. תמצית טכנית

| נושא | הכרעה |
|---|---|
| כיבוי כללי (kill switch) | לא לקרוא בכלל ל-`CookieConsent.run()` — fail-safe מבנית, מאומת מקוד המקור (§2.1) |
| כיבוי קטגוריה בודדת | הקטגוריה נעלמת מהקונפיג + **bump אוטומטי** לrevision **באותה כתיבה** (§2.2, ממצא קריטי) |
| טקסטים | קבועים בקוד (הכרעה #1 לעיל) |
| מניעת drift | תג-סטטוס חי ב-`/cookies` וב-`/privacy` (§8) |
| עדכון ללקוחות | `revalidatePath('/', 'layout')` מכל action + TTL cache 20 שנ' + `revalidate=20` ברוט layout (§9) |
| מיגרציה | 4 עמודות ב-`app_settings`, ברירת מחדל בטוחה, UPDATE אחד לכתיבה (§4) |
| הרשאה | `requirePlatformPermission('manage_settings')` |
| Audit | `logActivity('admin.cookie_consent.*')` על כל פעולה, בנוסף ל-Slack (§6.2) |

---

## 1. מצב קיים (מאומת)

- `vanilla-cookieconsent@3.1.0` מותקן בפועל. קונפיג סטטי יחיד:
  `src/lib/consent/cookie-consent-config.ts` (`CONSENT_REVISION = 5`, 3
  קטגוריות). מאתחל: `src/components/consent/cookie-consent.tsx` (מורכב ב-root
  layout). שער אנליטיקה: `src/components/consent/google-analytics-gated.tsx`
  (מורכב ב-`(site)/layout.tsx` ו-`(customer)/app/layout.tsx`, לא ב-root — לא
  פועל בדפי טוקן `/r /g /ty /join`).
- `app_settings` (נבדק חי): singleton `id boolean` PK, **מדיניות RLS יחידה**:
  `app_settings_admin_all — FOR ALL — has_role(auth.uid(),'admin')`.
- דפוס קיים לקריאה ציבורית לא-אדמין: `src/lib/data/alerts-config.ts`
  (service-role + TTL cache 20 שנ' + fail-safe).
- דפוס קיים לטוגל+audit אדמיני: `src/lib/data/admin/voximplant-channel.ts`
  (`updateCallConsentRequired`) + `src/app/(admin)/admin/channels/actions.ts`
  (Slack audit על כל flip).
- דפוס `logActivity`: `src/lib/data/activity.ts` — `action:
  'admin.<domain>.<verb>'`, `meta` **לעולם לא מכיל תוכן רגיש**, רק flags/ids.

---

## 2. שני ממצאים קריטיים מקוד המקור המותקן (`cookieconsent.esm.js`)

### 2.1 כיבוי כללי הוא fail-safe מבנית

`state.D` (flag "אין הסכמה תקפה") מתחיל `true` בקונסטרוקטור ומשתנה **רק**
בתוך `run()`. `acceptedCategory` = `state.D ? [] : state.R`. אם `run()` לא
נקרא בכלל בטעינת העמוד — `acceptedCategory()` מחזיר `false` לתמיד, בלי קשר
לעוגייה שכבר קיימת. **מימוש**: מתג הכיבוי הכללי = "אל תקרא ל-`run()`", לא
"קרא עם קונפיג ריק".

### 2.2 bump ל-revision הוא תנאי הכרחי לכיבוי בטוח של קטגוריה

כש-revision לא משתנה, `state.R` נגזר **ישירות מהעוגייה השמורה** — בלי סינון
מול הקטגוריות המוגדרות כרגע. השמטת קטגוריה מהקונפיג **בלבד** לא מוחקת הסכמה
שמורה קודמת. ה-revision הוא המנגנון היחיד שכופה על הספרייה להתעלם מהעוגייה
הישנה. **לכן**: כל שינוי בזמינות קטגוריה/מתג ראשי מבצע bump **אוטומטי, באותה
כתיבה אטומית** — לא כפתור נפרד.

---

## 3. ארכיטקטורה

```
app_settings (RLS: אדמין-בלבד)
   │
   ├─ מסך /admin/cookie-consent → session client + RLS → src/lib/data/admin/cookie-consent.ts
   │                                                       (getCookieConsentAdminView + 3 toggle fns + bump fn, כולן logActivity)
   │
   └─ כל דף ציבורי/לקוח → service-role + TTL cache → src/lib/consent/admin-config.ts
                                                              │
                          ┌────────────────────────────────────┴──────────────────────┐
                          ▼                                                            ▼
             src/app/layout.tsx (root)                          (site)/layout.tsx + (customer)/app/layout.tsx
               → <CookieConsentBanner adminConfig={…}/>            → <GoogleAnalyticsGated mechanismEnabled={…}/>
                          │
                          ▼
             src/lib/consent/cookie-consent-config.ts
               buildCookieConsentConfig(adminConfig) → CookieConsent.CookieConsentConfig
```

הסכמת מבקר ספציפי נשארת local-only (`kalfa_cookie_consent` cookie) — העמודות
ב-`app_settings` שולטות רק בזמינות, לא בהסכמה אישית.

---

## 4. סכימת DB

```bash
supabase migration new cookie_consent_admin_control
```

```sql
-- Cookie-consent admin control (app_settings singleton). Four admin-managed
-- AVAILABILITY flags — never a per-visitor consent choice (stays local-only,
-- see docs/consent/cookie-consent.md). RLS: no new policy — app_settings_admin_all
-- (FOR ALL, has_role(auth.uid(),'admin')) already covers every column. Public
-- read path (src/lib/consent/admin-config.ts) intentionally bypasses RLS via
-- the service-role client, server-side only, like src/lib/data/alerts-config.ts.
-- DEFAULTS = current shipped behavior; applying this migration changes
-- nothing observable until an admin flips a toggle.
alter table public.app_settings
  add column if not exists cookie_consent_enabled boolean not null default true;

comment on column public.app_settings.cookie_consent_enabled is
  'Master kill switch for vanilla-cookieconsent. Default true (SAFE). When false, CookieConsentBanner never calls CookieConsent.run() — verified fail-safe: acceptedCategory() then returns false for every category regardless of any previously stored consent cookie (plans/cookie-consent-admin-control.md §2.1), so GoogleAnalyticsGated never loads GA / sends Consent Mode ad signals. Rare/emergency control, not a routine toggle.';

alter table public.app_settings
  add column if not exists cookie_consent_analytics_enabled boolean not null default true;

comment on column public.app_settings.cookie_consent_analytics_enabled is
  'Whether the `analytics` category is OFFERED at all. Default true. Every write bumps cookie_consent_revision_bump in the SAME UPDATE statement — see plans/cookie-consent-admin-control.md §2.2 (correctness requirement: omitting a category from the built config alone does not erase it from an already-valid stored consent cookie).';

alter table public.app_settings
  add column if not exists cookie_consent_marketing_enabled boolean not null default true;

comment on column public.app_settings.cookie_consent_marketing_enabled is
  'Whether the `marketing` (Google Ads remarketing/conversions) category is OFFERED at all. Default true. Same automatic-bump requirement as cookie_consent_analytics_enabled.';

alter table public.app_settings
  add column if not exists cookie_consent_revision_bump integer not null default 0;

comment on column public.app_settings.cookie_consent_revision_bump is
  'Admin-only, monotonically-increasing counter. Effective vanilla-cookieconsent revision sent to every visitor = CONSENT_REVISION (code constant, src/lib/consent/cookie-consent-config.ts) + this bump. Incremented by every write to cookie_consent_enabled/analytics_enabled/marketing_enabled and by the standalone "force re-consent" action, always in the SAME single-row UPDATE as the flag change (no RPC, no split writes). Never decremented.';
```

**Rollback**:
```sql
alter table public.app_settings
  drop column if exists cookie_consent_enabled,
  drop column if exists cookie_consent_analytics_enabled,
  drop column if exists cookie_consent_marketing_enabled,
  drop column if exists cookie_consent_revision_bump;
```
אין FK, אין תלות — rollback בטוח מבחינת integrity.

---

## 5. שכבת הקונפיג — `src/lib/consent/cookie-consent-config.ts`

מוסיף טיפוס `CookieConsentAdminConfig` ופונקציה `buildCookieConsentConfig`;
כל הטקסט הקיים נשאר **verbatim**. ה-export הסטטי `cookieConsentConfig` נשאר
לתאימות-לאחור (טסטים קיימים).

```ts
export interface CookieConsentAdminConfig {
  enabled: boolean;
  analyticsEnabled: boolean;
  marketingEnabled: boolean;
  revisionBump: number;
}

export const BASELINE_ADMIN_CONFIG: CookieConsentAdminConfig = {
  enabled: true,
  analyticsEnabled: true,
  marketingEnabled: true,
  revisionBump: 0,
};

export function buildCookieConsentConfig(
  admin: CookieConsentAdminConfig,
): CookieConsent.CookieConsentConfig {
  // categories: necessary always; analytics/marketing included only if enabled
  // sections: same filter, keyed by linkedCategory
  // revision: CONSENT_REVISION + admin.revisionBump
  // … all text verbatim from the current static object …
}

export const cookieConsentConfig = buildCookieConsentConfig(BASELINE_ADMIN_CONFIG);
```

---

## 6. שכבת הנתונים

### 6.1 קריאה ציבורית — `src/lib/consent/admin-config.ts` (חדש)

מראה `src/lib/data/alerts-config.ts` (TTL 20 שנ' + service-role), עם הבדל
מכוון: כישלון → **BASELINE** (המצב הקיים היום), לא "הכול כבוי" — כי כאן כיבוי
הוא פעולת-אדמין מכוונת, לא ברירת-מחדל תפעולית. `cache()` מ-`react` לדה-דופ
בתוך בקשה (root + site/customer layout קוראים לזה).

### 6.2 מסך אדמין — `src/lib/data/admin/cookie-consent.ts` (חדש)

Session client + `requirePlatformPermission('manage_settings')`. כל כתיבה =
**UPDATE אחד**: קריאת ה-bump הנוכחי (SELECT, לא כתיבה), ואז `.update({
...patch, cookie_consent_revision_bump: nextBump })` בקריאה בודדת — פאץ'
הטוגל וה-bump **יחד**, לא בשני writes. כל פונקציה קוראת `logActivity`
(`action: 'admin.cookie_consent.*'`, `meta` ללא PII/תוכן — רק flags).

---

## 7. למה לא עריכת טקסט (סגור, לתיעוד)

1. הספרייה מציבה `title`/`description` דרך **`innerHTML`** (מאומת מקוד המקור
   — `n.et.innerHTML=x` וכו') — טקסט-אדמין לא-מסונן = stored XSS נגד כל
   מבקר. מניעה מלאה דורשת sanitizer/אילוץ plain-text; לא הוצדק מול ההיקף
   המבוקש.
2. כל revision היסטורי (2-5) ליווה נימוק משפטי מפורש (חוק הגנת הפרטיות
   ס' 2(9)/8(ב), עמדת הרשות §58) — שדה טקסט חופשי עוקף את הביקורת הזו בכל
   שמירה, ויוצר סיכון drift מול `/cookies`/`/privacy` בכיוון ההפוך.

---

## 8. תג-סטטוס חי ב-`/cookies` וב-`/privacy`

`src/app/(public)/(site)/_legal.tsx` — `LegalSection` מקבל `badge?:
React.ReactNode` אופציונלי, מוצג ליד הכותרת. `cookies/page.tsx` (סעיפים 5,6)
ו-`privacy/page.tsx` (סעיף 10, שמתאר את שתי הקטגוריות יחד) קוראים
`getCookieConsentPublicConfig()` ומעבירים badge שמראה "פעיל"/"מושבת זמנית"
פר-קטגוריה. הטקסט המשפטי המלא נשאר קבוע — הbadge רק סטטוס, לא תוכן.

---

## 9. cache invalidation

`export const revalidate = 20` ב-root layout (Next.js 16.2.11, `cacheComponents`
לא מופעל — "lowest revalidate wins" לכל המסלול). `revalidatePath('/',
'layout')` מכל action כותב (חריגה מכוונת מה-path הצר הרגיל — זה משפיע על כל
האתר). React `cache()` + TTL 20 שנ' ב-`admin-config.ts`. דפים כבר-דינמיים
(home דרך `getUser()`, `/contact /terms /cookies /privacy` ו-`/r /g /ty`
דרך `force-dynamic`) לא מושפעים; דפי `/auth/*` הם הסיכון היחיד לקיפאון סטטי,
ולכן ה-revalidate ברוט.

---

## 10. ממשק אדמין

`/admin/cookie-consent` עצמאי, `requirePlatformPermission('manage_settings')`,
פריט ניווט עם אייקון `Cookie` (מאומת קיים ב-lucide-react) בקבוצת "מערכת
ותפעול" ליד `/admin/alerts`/`/admin/analytics`. 3 טוגלים (checkbox, מראה
`channels-client.tsx`) + כפתור bump ידני. Slack audit על כל flip (מראה
`updateCallConsentRequiredAction`) + `logActivity`.

---

## 11. שלבי מימוש

| שלב | תוכן |
|---|---|
| S0 | מיגרציה (§4) — מוכנה, **לא מוחלת** |
| S1 | `cookie-consent-config.ts` + `admin-config.ts` + טסטים |
| S2 | חיווט לקוח: root layout, `cookie-consent.tsx`, `google-analytics-gated.tsx`, שני מקומות הרכבה |
| S3 | DAL אדמין + עמוד + actions + client + ניווט |
| S4 | מבחן קצה: כיבוי מהאדמין מול הסכמה קיימת → GA נעצר — **חסום עד שהמיגרציה תוחל** (§4); הוכחה ברמת unit test במקום (§2.1 verified against the real installed library) |
| S5 | badges ב-`/cookies`+`/privacy` (§8) |
