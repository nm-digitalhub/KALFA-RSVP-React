# תוכנית: מספרי-badge בסיידבר הניהול (Unread/Pending Nav Counts)

> **זהו מסמך תכנון בלבד — לא בוצע שום שינוי קוד, לא נוצרה מיגרציה, לא נערך אף קובץ
> יישום.** התוכנית הופקה בשני סבבי מחקר על-ידי סוכן `core:code-architect`
> (read-only, ללא כלי Write/Edit/Bash), ואומתה בנפרד על-ידי team-lead שקרא ישירות
> את קוד היעד (`admin-shell.tsx`, `app-shell.tsx`, שבעה עמודי admin, `dal.ts`,
> `sidebar.tsx`, `dashboard.ts`) והצליב מספרי-שורות מדויקים מול הדוח. כל מזהה
> טכני (נתיבים, שמות עמודות, קוד) נשמר באנגלית. נכון ל-2026-08-11.

## 0. ההחלטה שהניעה את זה

צילום מסך של הסיידבר הראה בקשה למספר קטן ליד פריטי תפריט כמו "פניות",
"בקשות חזרה", "התראות תפעול" — סימון unread/pending. `Badge` ו-`SidebarMenuBadge`
כבר קיימים בפרויקט (`src/components/ui/badge.tsx`, `src/components/ui/sidebar.tsx:586-601,714`)
— אין צורך בהתקנת שום חבילה חדשה.

## 1. החלטת ארכיטקטורה: badge לכל פריט בסיידבר, לא פעמון-התראות גלובלי

**נבחר:** `SidebarMenuBadge` ליד כל פריט תפריט רלוונטי (admin בלבד).
**נדחה במפורש:** פעמון-התראות מרוכז בכותרת (header).

נימוקים:
- קיימים רק 4 תחומים "actionable" כרגע (ראו §2) — לכל אחד יעד ניווט קיים
  ומדויק בתפריט; פעמון מוסיף שכבת-עקיפה (פעמון ← פאנל ← קליק) מעל ניווט
  שהסיידבר כבר נותן ישירות.
- פעמון היה דורש קומפוננטת-פאנל חדשה, סמנטיקת-איגום חדשה, ומושג
  "נקרא/לא-נקרא" שלא קיים היום באף טבלה בסכמה.
- אף אחד משני ה-header-ים (`admin-shell.tsx:410-416` — טקסט "אזור ניהול" סטטי;
  `app-shell.tsx:262-282` — placeholder חיפוש לא-פעיל + `OrgSwitcher`) לא מכיל
  היום שום מנגנון התראות. **התוכנית הזו לא נוגעת באף header.**

כדאי להיבחן מחדש רק אם מספר-התחומים ה-badge-worthy יגדל מעבר למה שהסיידבר
יכול לשאת בצורה סבירה, או אם דרישת-מוצר אמיתית ל-feed בזמן-אמת חוצה-תחומים
תתעורר — אף אחד מהשניים לא נכון היום.

## 2. פריטים שמקבלים badge — עם המקור המדויק בקוד

| פריט תפריט | טבלה | תנאי הספירה | תואם למה שהעמוד עצמו מציג? |
|---|---|---|---|
| פניות (`/admin/contacts`) | `contact_messages` | `status = 'new'` | **לא** — העמוד מציג את כל הסטטוסים, ללא סינון (ראו §4) |
| בקשות חזרה (`/admin/callbacks`) | `callback_requests` | `status = 'new'` | **לא** — אותה בעיה |
| קמפיינים (`/admin/campaigns`) | `campaigns` | `status IN WINDDOWN_STATUSES` (`['active','paused','closed']`, `src/lib/data/admin/campaigns.ts:79-83`) | **כן** — `listCampaignsForAdmin()` כבר מסונן לאותו תנאי בדיוק; ה-EmptyState של העמוד אומר מילולית "אין קמפיינים הדורשים טיפול" |
| פניות סוכנים (`/admin/fleet`) | `fleet_requests` | `status = 'pending'` | **כן, זה כבר קיים בקוד** — `fleet/page.tsx:76-78` כבר מציג `ממתינות למענה (N)` מ-`listPendingFleetRequests()` עם אותו תנאי בדיוק |

**תיקון-ביניים שנרשם כאן למען הסדר:** בסבב המחקר הראשון הוצע ל-קמפיינים
`charge_status IN ('charge_failed','charge_review')` — ניחוש מה-display-label-map
בעמוד, לא מאומת מול נתונים חיים. הסוכן תיקן את עצמו בסבב השני לאחר ש-team-lead
אימת את `listCampaignsForAdmin()` בפועל: התנאי הנכון הוא `WINDDOWN_STATUSES`
(עמודת ה-enum `status`, לא הטקסט-חופשי `charge_status`). זה גם מייתר שאילתת-אימות
`select charge_status, count(*) ...` ואת שאלת ה-index על `charge_status` שהופיעו
בסבב הראשון.

**פרט-מימוש שדורש תיקון קטן:** `WINDDOWN_STATUSES` (`campaigns.ts:79`) הוא
כרגע `const` **לא-מיוצא** (`export` חסר). כדי שהמודול החדש (§5) ישתמש באותו
מקור-אמת ולא ישכפל את הרשימה, יש להוסיף `export` לפני ה-`const`, או לייבא את
הטיפוס `CampaignStatus` ולשכפל את שלוש הערכים תוך הערה שמצביעה חזרה למקור.
עדיף האופציה הראשונה (export) — מונע drift.

## 3. פריטים שלא מקבלים badge — עם הסיבה שנבדקה בפועל

- **התראות תפעול (`/admin/alerts`)** — זה יומן היסטוריה של התראות **שכבר נשלחו**
  (`listOpsAlerts`, עם `delivered: boolean` = הצלחת שליחת ה-Slack POST), לא תיבת
  "לא-נקראו". אין בסכמה שום עמודת `acknowledged_at` או מקבילה. badge אמיתי כאן
  ידרוש שינוי-סכמה (עמודה חדשה) — לא מוצע כאן. שימוש ב-`delivered = false` כתחליף
  היה מודד "צינור ההתראות שבור", מושג שונה ולא זהה ל"לא-נקרא" — נשקל במפורש
  ונדחה.
- **ערוצי תקשורת (`/admin/channels`)** — עמוד קונפיגורציה טהור
  (`getOutreachMasterState`/`listAllChannels` מחזירים בוליאנים/קטלוג-תצוגה
  בלבד) — אין רשימה ואין ספירה מספרית בכלל.
- **תמיכת לקוחות (`/admin/support`)** — כלי חיפוש break-glass (מזין מזהה, סיבה
  נדרשת, מתועד ביומן ביקורת) — לא תור, אין מה לספור.
- **`/admin/webhooks`** — **תיקון לאחר קריאת הקוד בפועל:** יש כאן דווקא
  primitive מוכן לספירה — `getWebhookHealth()`
  (`src/lib/data/admin/webhook-inbox.ts:112-145`) כבר מחזיר `unprocessedCount`
  ו-`failedCount`, מבנה כמעט זהה לדפוס `fleet_requests`. ההחלטה שלא ל-badge
  כאן לא נובעת מהיעדר-נתון, אלא מאופי הנתון: `worker/main.ts` מריץ לולאת
  ניקוז (`drain webhook_inbox`, שורה 395) עם backoff אקספוננציאלי (1s→60s,
  שורות 490,577-578) על שגיאות זמניות — לא ממתין-למענה-אנושי כמו
  `fleet_requests.status='pending'`, אלא נתון שמתאזן-מעצמו תוך שניות/דקות
  ברוב המקרים. badge על מספר שמרצד ונעלם לבד תוך פחות מדקה הוא רעש, לא
  אוריינטציה — לכן עדיין מומלץ **לא** ל-badge, אך מהסיבה המדויקת הזו, לא
  "retry של pg-boss" (הניסוח הקודם) — הניקוז הזה הוא לולאת-poll פנימית של
  ה-worker, לא job של pg-boss. גם מיקומו בקבוצת "כלי בדיקה ואבחון"
  (`admin-shell.tsx:152`, לא בקבוצת עבודה actionable) מחזק את ההחלטה.
- **`/admin/dnc`, `/admin/recordings`, `/admin/templates`, `/admin/users`,
  `/admin/roles`, `/admin/access-log`, `/admin/activity`** — כלי-אבחון,
  מסכי-קונפיגורציה, או יומני-ביקורת append-only. אין backlog actionable.
- הפריטים הנותרים (`/admin/packages`, `/admin/settings`, `/admin/calendar`,
  `/admin/analytics`, `/admin/cookie-consent`, `/admin/company`,
  `/admin/agreement`, `/admin/voice`, `/admin/debug`, `/admin/sumit-test`,
  `/admin/jobs`) לא נסרקו לעומק אך נמצאים באותה קטגוריה סטרוקטורלית
  (קונפיגורציה/אבחון, לא backlog).

## 4. הפער האמיתי שנמצא — לא "פתרון יפה", החלטת-בעלים נדרשת

לגבי פניות ובקשות-חזרה: העמוד עצמו מציג **את כל הסטטוסים**, מדופדף,
מהחדש לישן, ללא סינון/קיבוץ. משמעות: badge שיציג "3 חדשות" מעל עמוד שמראה
40 שורות בכל הסטטוסים לא ניתן להתאמה חזותית ברגע הכניסה — בניגוד לפניות-סוכנים
ולקמפיינים, ששם המספר בבדיוק תואם את מה שהעמוד כבר מציג. **שתי אופציות, טעונות
החלטת בעלים:**
1. להוסיף פילטר-סטטוס לעמודי `/admin/contacts` ו-`/admin/callbacks` כך שה-badge
   יהיה ניתן-להתאמה בכניסה.
2. לקבל את ה-badge כ"אוריינטציה בלבד" (יש-חדש-איפשהו, לא בהכרח נראה-מיד-ברשימה).

**ממצא נוסף מאותה משפחה, גם הוא טעון החלטה:** `getDashboardCounts()`
(`src/lib/data/admin/dashboard.ts:24-35`) סופר את **כל** השורות ב-`contact_messages`/
`callback_requests` (נפח כולל, בלי `.eq`/`.in`), בעוד ה-badge החדש יספור רק
`status='new'`. כרטיס הסקירה (`/admin`) וה-badge בסיידבר יראו שני מספרים שונים
לאותו תחום. לא מוצע כאן לשנות את כרטיסי הסקירה — קריאת-מוצר נפרדת, מחוץ לתחום
המשימה הזו — אבל יש להחליט: ליישר לאותו תנאי, או לתייג במפורש ("סה״כ" מול
"חדשות").

## 5. קבצים ליצירה/שינוי

### חדש: `src/lib/data/admin/nav-counts.ts`

תואם בדיוק את המוסכמה הקיימת (`dashboard.ts`, `contacts.ts`, `callbacks.ts`,
`fleet.ts`, `campaigns.ts` — כולם תחת `src/lib/data/admin/`), ומשוכפל כמעט
מילה-במילה מ-`getDashboardCounts()` שכבר קיים ועובד:

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPlatformPermission, requireAdmin } from '@/lib/auth/dal';
import { WINDDOWN_STATUSES } from './campaigns'; // requires `export` added there

export interface AdminNavCounts {
  contacts: number | null;
  callbacks: number | null;
  campaigns: number | null;
  fleet: number | null;
}

async function countWhere(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'contact_messages' | 'callback_requests' | 'campaigns' | 'fleet_requests',
  column: string,
  values: readonly string[],
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .in(column, values);
  return error ? 0 : (count ?? 0); // fail-soft, same contract as countTable()
}

export async function getAdminNavCounts(): Promise<AdminNavCounts> {
  await requireAdmin();
  const supabase = createAdminClient();

  const [canCustomer, canBilling, canSettings] = await Promise.all([
    hasPlatformPermission('view_customer_data'),
    hasPlatformPermission('manage_billing'),
    hasPlatformPermission('manage_settings'),
  ]);

  const [contacts, callbacks, campaigns, fleet] = await Promise.all([
    canCustomer ? countWhere(supabase, 'contact_messages', 'status', ['new']) : Promise.resolve(null),
    canCustomer ? countWhere(supabase, 'callback_requests', 'status', ['new']) : Promise.resolve(null),
    canBilling ? countWhere(supabase, 'campaigns', 'status', WINDDOWN_STATUSES) : Promise.resolve(null),
    canSettings ? countWhere(supabase, 'fleet_requests', 'status', ['pending']) : Promise.resolve(null),
  ]);

  return { contacts, callbacks, campaigns, fleet };
}
```

**דרישה קשיחה:** גידור עם `hasPlatformPermission` (לא-זורק), **לעולם לא**
`requirePlatformPermission`. `requireAdmin()` (`has_role`) והרשאות-הפלטפורמה
הן שכבה **אורתוגונלית** נפרדת (`dal.ts:61-68`, מאומת) — admin יכול באופן
לגיטימי שלא להחזיק אף אחת מ-`view_customer_data`/`manage_billing`/
`manage_settings`. שימוש ב-`requirePlatformPermission` בתוך ה-layout המשותף
היה מפנה admin כזה ל-`/app` מ**כל** דף `/admin`, לא רק מהדפים הרלוונטיים.

### שינוי: `src/app/(admin)/admin/layout.tsx`

**תיקון לאחר קריאת הקובץ בפועל:** אין בו כרגע `Promise.all` ברמה-עליונה —
רק קריאות `await` עוקבות (`requireAdmin()`, `getProfile()`), ו-`Promise.all`
פנימי-בלבד בתוך ה-try/catch של Exchange. הניסוח "להוסיף ל-Promise.all הקיים"
משלב-המחקר הקודם לא מדויק. הפעולה הנכונה: להוסיף
`const navCounts = await getAdminNavCounts();` כקריאה עצמאית (או, לביצועים
מעט טובים יותר, לעטוף יחד עם `getProfile()` ב-`Promise.all([getProfile(),
getAdminNavCounts()])` — שתי הקריאות בלתי-תלויות), ולהעביר
`navCounts={navCounts}` ל-`<AdminShell>`. לא לגעת בבלוק ה-try/catch של
Exchange — הוא נשאר מבודד כפי שהוא.

### שינוי: `src/components/admin-shell.tsx`

1. הוספת `navCounts: AdminNavCounts` ל-props של `AdminShell`.
2. `NAV_GROUPS` הוא `const` ברמת-מודול בקובץ `'use client'` — לא ניתן לצקת
   לתוכו נתוני-שרת לפי-render. הצורה הנכונה מבחינה מבנית: `navCounts` עצמו
   (מפתחות `contacts`/`callbacks`/`campaigns`/`fleet`) + טבלת-מיפוי href→מפתח
   שנשארת מקומית בקובץ, כך ש-`NAV_GROUPS`/`renderNavItem` לא צריכים לדעת שמות
   טבלאות.
3. `renderNavItem(item, pathname)` → `renderNavItem(item, pathname, count?: number)`.
4. **הרכבה — badge חייב להיות אח (sibling) של `SidebarMenuButton`, בתוך
   `SidebarMenuItem`, לעולם לא בתוך ה-`Link`/`render` prop:**

```tsx
function renderNavItem(item: NavItem, pathname: string, count?: number) {
  const { href, label, icon: Icon } = item;
  const active = isActive(pathname, href);
  return (
    <SidebarMenuItem key={href}>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        className={count ? 'pe-8' : undefined}
        render={
          <Link href={href} aria-current={active ? 'page' : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        }
      />
      {count ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  );
}
```

שתי שבירות-שקטות שזה מונע (שתיהן אומתו ישירות מול `sidebar.tsx`):
- מיקום-ה-Y של `SidebarMenuBadge` מגיע מ-`peer-data-[size=default]/menu-button:top-1.5`
  (`sidebar.tsx:595`) — סלקטור `peer-*` תופס רק אח-קודם, ו-`SidebarMenuButton`
  נושא `peer/menu-button`. אם ה-badge יושב בתוך ה-`render` prop, הסלקטור לעולם
  לא יתאים.
- `[&>span:last-child]:truncate` על הכפתור (`sidebar.tsx:481`) יעבור-יעד
  ל-badge במקום לתווית העברית, והתווית תפסיק להיחתך נכון.
- הכפתור מפנה מקום-קצה רק ל-`data-sidebar="menu-action"`
  (`group-has-data-[sidebar=menu-action]/menu-item:pe-8`, `sidebar.tsx:481`),
  ש-`data-sidebar="menu-badge"` של ה-badge לא תואם — לכן `pe-8` המפורש בדוגמה
  חיוני כשיש מספר, אחרת תוויות כמו "פניות סוכנים" ירוצו מתחת למספר.

`SidebarMenuBadge` כבר מיוצא מ-`src/components/ui/sidebar.tsx:586-601,714` —
להוסיף אותו לייבוא ה-Sidebar* הקיים (`admin-shell.tsx:41-54`).

## 6. `app-shell.tsx` (צד לקוח) — ללא שינוי, במפורש

נבדק (`app-shell.tsx` המלא, `app/layout.tsx`, `app/page.tsx`, `app/events/page.tsx`,
`app/events/[id]/page.tsx`). ה-nav: לוח-בקרה, "האירועים שלי", "ניהול משתמשים"
(מותנה-הרשאה), הגדרות, "עזרה ותמיכה" (קישור פשוט ל-`/contact?t=support`, אפילו
לא route באפליקציה), וקישור ניהול (מותנה-admin).

**המלצה: אין badge לאף פריט בסיידבר הלקוחי, כולל "האירועים שלי".** הסיבה
העיקרית איננה "מעט אירועים ללקוח" (נכון, אבל משני) — אלא ש-RSVP חדש שמגיע
הוא **המוצר עובד**, לא משימה שהבעלים צריך לסגור. badge מסמן "טפל בזה כדי
שהמספר ייעלם"; החלה על תגובות-RSVP הופכת את מה שהמוצר קיים בשבילו. אין
בקוד היום שום מושג "needs attention" בצד הלקוח (`grep` על `charge_status`/
`needs_attention` תחת `src/app/(customer)` החזיר אפס תוצאות) — לבנות אחד
הוא עבודת-סכמה/שאילתה חדשה, מחוץ לתחום המשימה הזו. `/app/events/[id]/stats`
כבר חושף נפח-תגובות כ-statistic — זו ההצגה הנכונה לנתון הזה (מספר שרוצים
לראות), לא badge שמרמז על עבודה שלא בוצעה. אותו היגיון פוסל badge גם על
תת-הניווט בתוך עמוד-אירוע (guests/campaign/stats tabs).

`app-shell.tsx` לא זקוק לשום שינוי-קוד — מרנדר את פריטי ה-nav inline
(שורות 169-188) ולא דרך `renderNavItem` משותף כמו `admin-shell.tsx`, כך שאין
שאלה של "האם צריך לשכפל את כלל-ההרכבה גם לכאן" — לא צריך, כלום לא משתנה
בקובץ הזה.

## 7. אינדקסים

- `contact_messages(status)` — מאונדקס (`contact_messages_status_idx`,
  מיגרציה `20260723180000`). תקין כמות שהוא.
- `fleet_requests(status, created_at desc)` — מאונדקס עם `status` מוביל
  (`fleet_requests_status_created_idx`, מיגרציה `20260723094500`). שאילתת
  `status='pending'` מכוסה במלואה.
- `callback_requests(status)` — **אין אינדקס שמכסה את זה.** קיימים שני
  אינדקסים חלקיים (`callback_requests_unscheduled_idx`,
  `callback_requests_untriaged_idx`) אך אף אחד מהם לא מכיל פרדיקט ש-`status='new'`
  הבלעדי מרמז עליו — Postgres לא יכול להשתמש בהם, יבצע sequential scan.
- `campaigns(status)` — **לא נבדק עדיין** (השאלה הישנה על `charge_status`
  התייתרה עם המעבר ל-`status`/`WINDDOWN_STATUSES` — יש לבדוק את `status`
  לפני מימוש).

בהיקף-שורות הנוכחי (מוצר B2C לפי-אירוע, לא high-volume) sequential scan
כנראה לא בעייתי — **לא מוצע כאן migration באופן יזום.** אם/כשהטבלאות יגדלו:
`create index callback_requests_status_idx on callback_requests(status)` /
מקביל ל-`campaigns(status)`. כל מיגרציה טעונה אישור בעלים מפורש לפי CLAUDE.md.

ארבע הספירות רצות כ-`Promise.all` אחד בתוך `getAdminNavCounts()`, פעם אחת
לכל רינדור של ה-admin layout (לא פעם לכל פריט-תפריט) — חסום, בלי N+1.

## 8. Staleness — נפתר, לא שאלה פתוחה

`requireAdmin()` קורא cookies בכל קריאת-DAL, מה שכבר כופה על כל תת-העץ
`/admin` רינדור דינמי (לא-cached). ה-layout רץ מחדש במלואו בכל ניווט, ללא
תלות ב-`revalidatePath`. אין שום שכבת `unstable_cache`/`revalidateTag`
בקוד-בסיס כולו (0 hits). **לא נדרש מנגנון-cache למספרי ה-badge — טריות
ברמת-טעינת-הדף אוטומטית וללא עלות.**

## 9. סיכום היקף

שני קבצים חדשים/משתנים תחת `/admin` בלבד: `src/lib/data/admin/nav-counts.ts`
(חדש) ו-`src/components/admin-shell.tsx` + `src/app/(admin)/admin/layout.tsx`
(שינוי). `app-shell.tsx` ושני ה-header-ים: **אפס שינוי**.

## 10. שאלות פתוחות לבעלים (לפני מימוש)

1. §4 — פילטר-סטטוס על עמודי contacts/callbacks, או badge כ"אוריינטציה בלבד"?
2. §4 — ליישר את כרטיסי-הסקירה (`/admin`) לאותו תנאי כמו ה-badge, או לתייג
   "סה״כ" מול "חדשות"?
3. §7 — לבדוק `campaigns(status)` cardinality/index לפני מימוש בפועל.
4. §5 — לאשר הוספת `export` ל-`WINDDOWN_STATUSES` ב-`campaigns.ts` (שינוי
   חד-שורתי, לא-הרסני).

## קבצים שנקראו לאימות (שני סבבי סוכן + אימות team-lead עצמאי מלא)

`src/components/admin-shell.tsx`, `src/components/app-shell.tsx`,
`src/app/(admin)/admin/layout.tsx`, `src/app/(customer)/app/layout.tsx`,
`src/app/(customer)/app/{page,events/page,events/[id]/page}.tsx`,
`src/components/ui/sidebar.tsx`, `src/components/ui/badge.tsx`,
`src/lib/auth/dal.ts`, `src/lib/data/admin/{dashboard,contacts,callbacks,
fleet,alerts,campaigns,labels,shared,webhook-inbox}.ts`,
`src/app/(admin)/admin/{support,contacts,callbacks,campaigns,channels,
alerts,fleet,webhooks,dnc,recordings,templates,users,roles,access-log,
activity}/page.tsx`, `src/app/(admin)/admin/_components.tsx`, `worker/main.ts`,
מיגרציות רלוונטיות תחת `supabase/migrations/` (אימות אינדקסים + הגדרת
enum `campaign_status`).

**סטטוס אימות:** team-lead קרא ישירות ואימת — לא רק "האמין לדוח" — כל טענה
מהותית: קיום ומיקום-שורה מדויק של `SidebarMenuBadge` וה-CSS שלו
(`sidebar.tsx:481,586-601,714`), האורתוגונליות `requireAdmin`/
`hasPlatformPermission` (`dal.ts:34-141`), התקדים `getDashboardCounts()`
(`dashboard.ts:1-55`), כל ארבעת האינדקסים הנטענים (או היעדרם), ערכי
ה-enum `campaign_status` המלאים, ותוצאת ה-`grep` האפסית תחת
`src/app/(customer)`. שתי אי-דיוקים נמצאו ותוקנו במסמך זה: מבנה
`admin/layout.tsx` (§5, אין `Promise.all` קיים ברמה-עליונה) ומנגנון
ה-retry ב-`/admin/webhooks` (§3, לולאת-poll פנימית של ה-worker, לא job
של pg-boss) — המסקנות המעשיות בשני המקרים לא השתנו.
