# תיקון: בניית קישור RSVP מוחלט תמיד (origin helper משותף)

**קומיט:** `576e40f` · **ענף:** `main` (נדחף ל-origin) · **פרוס** ל-`kalfa-beta` + `kalfa-worker`
**תאריך:** 2026-06-29

---

## 1. הבעיה

בעמוד פרטי המוזמן, קישור ה-RSVP לבעלים נבנה כך:

```ts
const rsvpUrl = linkInfo
  ? `${process.env.APP_ORIGIN ?? ''}/r/${linkInfo.token}`
  : '';
```

ה-`?? ''` הוא נקודת הכשל: אם `APP_ORIGIN` אינו נפתר בזמן ריצה, התוצאה היא
`"/r/<token>"` — **path יחסי**. הוא עדיין מועתק ללוח, אבל אינו ניתן לשיתוף
(אין host), ולכן מוזמן שמקבל אותו ב-WhatsApp/SMS יקבל קישור שבור. הכשל **שקט**:
המערכת לא זועקת, פשוט מייצרת קישור פגום.

## 2. חקירת שורש הבעיה (לא ניחוש)

| בדיקה | ממצא |
|---|---|
| היכן `APP_ORIGIN` מוגדר? | קיים ב-`.env.local`, **לא** ב-OS environ של תהליך pm2. |
| אז איך התשלום עובד בפרודקשן? | `next start` טוען `.env.local` אל `process.env` בזמן ריצה — לכן ה-API routes של התשלום (שעושים `if (!APP_ORIGIN) throw`) עובדים. |
| מה הסיכון בפועל? | התלות בטעינת `.env.local`. אם היא אי-פעם חסרה/שגויה, ה-`?? ''` מייצר קישור שבור בשקט במקום להיכשל ברעש. |
| אילו כותרות ה-nginx מעביר? | `beta-proxy.conf`: `Host $host`, `X-Forwarded-Host $host`, `X-Forwarded-Proto https` — כולן נושאות את ה-host הציבורי. |

## 3. מציאת הפתרון המתועד (Context7 → Next.js v16.2.9)

לפי ההנחיה: **לא לנחש ולא להמציא פתרון מותאם — לקרוא תיעוד**. שאילתת Context7 על
הגרסה המדויקת המותקנת (`/vercel/next.js/v16.2.9`) החזירה:

> ב-App Router אין "origin" מובנה ל-Server Component. הדרך **המתועדת** לקרוא את
> ה-host של הבקשה הנכנסת היא `headers()` מ-`next/headers` (אסינכרוני,
> `(await headers()).get('...')`).

מסקנה: אין helper רשמי ל-URL מוחלט. הדפוס הרשמי הוא **env var קנוני + נפילה
ל-`headers()`**. בדיוק הדפוס ש-`buildJoinLink` הקיים (קישורי הזמנה לארגון) כבר
השתמש בו — כך שזו גם הזדמנות לאיחוד ולא לשכפול.

## 4. הפתרון שיושם

### קובץ חדש — `src/lib/url.ts` (server-only)

```ts
import 'server-only';
import { headers } from 'next/headers';

export async function getAppOrigin(): Promise<string> {
  const fromEnv = process.env.APP_ORIGIN?.trim().replace(/\/+$/, '') || null;
  if (fromEnv) return fromEnv;                       // (1) מקור קנוני מועדף

  const h = await headers();                          // (2) נפילה מתועדת
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (host) {
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${host}`;
  }
  throw new Error('Cannot resolve app origin: APP_ORIGIN unset and no request host');
}

export async function getAppUrl(path: string): Promise<string> {
  const origin = await getAppOrigin();
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
```

**למה בסדר הזה:**
- **מעדיף `APP_ORIGIN`** — יציב, אינו ניתן-לזיוף (בניגוד ל-Host header), ועובד גם
  מחוץ להקשר בקשה. כשהוא מוגדר, `headers()` **כלל לא נקרא** → מצב ה-rendering של
  הקורא לא משתנה.
- **נופל ל-`headers()`** — מבטיח URL מוחלט בזמן render גם אם ה-env חסר; משתמש
  ב-`x-forwarded-host` (הנכון מאחורי proxy) עם נפילה ל-`host`.
- **זורק רק** כשאין env **וגם** אין host — תקלת-תצורה אמיתית, לעולם לא ב-render רגיל.

### `guests/[guestId]/page.tsx` — שימוש בפתרון

```diff
- const rsvpUrl = linkInfo
-   ? `${process.env.APP_ORIGIN ?? ''}/r/${linkInfo.token}`
-   : '';
+ const rsvpUrl = linkInfo ? await getAppUrl(`/r/${linkInfo.token}`) : '';
```

### `team/actions.ts` — איחוד (כלל אי-השכפול)

```diff
- import { cookies, headers } from 'next/headers';
+ import { cookies } from 'next/headers';
+ import { getAppUrl } from '@/lib/url';

  async function buildJoinLink(token: string): Promise<string> {
-   const h = await headers();
-   const host = h.get('host') ?? '';
-   const proto = h.get('x-forwarded-proto') ?? 'https';
-   return `${proto}://${host}/join/${token}`;
+   return getAppUrl(`/join/${token}`);
  }
```

אותה לוגיקה, משופרת: עכשיו מעדיפה `APP_ORIGIN` ומודעת ל-`x-forwarded-host`.

### `rsvp-link.tsx` — עדכון תגובה בלבד (דיוק)

## 5. מה הושאר בכוונה (היקף ממוקד)

| מקום | מצב | סיבה |
|---|---|---|
| `agreements.ts:185` (קישור הסכם במייל) | עדיין `?? ''` | billing/messaging-רגיש — לא נוגעים בלי אישור. **מועמד לאימוץ ה-helper.** |
| `admin/channels/page.tsx:12` | עדיין `?? ''` | מסך אדמין פנימי, השפעה נמוכה. מועמד לאימוץ. |
| API routes (orders/pay, campaigns/*) | `if (!APP_ORIGIN) throw` | כבר עושים fail-hard נכון; יש להם `request` ולא צריכים `headers()`. |

## 6. אימות

| בדיקה | תוצאה |
|---|---|
| `npx tsc --noEmit` | 0 שגיאות |
| `npm run lint` | 0 |
| `npx vitest run` (מלא) | 438/438 עוברים |
| `next build --webpack` | exit 0 |
| smoke פוסט-פריסה | `/auth/login` → 200; כותרות `/r/` תקינות |

## 7. קבצים שהשתנו

- `+ src/lib/url.ts` (חדש)
- `~ src/app/(customer)/app/events/[id]/guests/[guestId]/page.tsx`
- `~ src/app/(customer)/app/events/[id]/guests/[guestId]/rsvp-link.tsx`
- `~ src/app/(customer)/app/team/actions.ts`
