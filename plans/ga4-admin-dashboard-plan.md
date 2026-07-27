# תוכנית יישום: דשבורד Google Analytics פנימי — `/admin/analytics` (גרסה 2)

> גרסה 2 — 27.07.2026, לאחר עשר הנחיות עדכון מהבעלים. **כל טענה טכנית חדשה אומתה חיה מול ה-property לפני העדכון** (ראו "אימותי v2" למטה). התוכנית מאושרת עקרונית; מימוש רק לאחר אישור סופי. בלי קוד, בלי commit, בלי deploy.

**אימותי v2 (בוצעו חיים מול ה-API, קריאה-בלבד):**
- ✅ המטריקות `newUsers` ו-`averageSessionDuration` תקפות (runReport החזיר תקין), כולל טווח `today..today`.
- ✅ ה-dimension‏ `isKeyEvent` תקף לזיהוי אירועי-מפתח ללא hardcode. **ממצא חי**: כרגע הוא מחזיר `(not set)` לכל אירוע — ב-property טרם הוגדרו key events; המקור להגדרתם הוא GA4 Admin (פעולת בעלים), והדשבורד רק משקף.
- ✅ ‏runRealtimeReport עם `eventName`×`eventCount` תקף; ✅ גם עם `city`×`activeUsers` (0 שורות בשעת הבדיקה — אין גולשים פעילים; הקריאה עצמה תקינה).
- ✅ (מההקמה, לא נבדק שוב): ‏ADC + הרשאת Viewer + ‏`fallback:'rest'` הוכחו ב-runReport אמיתי.

**מה השתנה בגרסה 2 (מיפוי לעשר ההנחיות):** ‏(1) בורר טווח מלא `?range=` עם today/7d/30d/90d, טיפוסים ו-cache פרמטריים — אין עוד שדות 7d/30d קבועים; ‏(2) ‏KPI חדשים: ‏newUsers, ‏averageSessionDuration (שניות→עיצוב משך ב-UI); ‏(3) ‏Realtime מורחב: אירועים מובילים + מיקומים, ו"דפים פעילים" מוצהר כלא-ממומש; ‏(4) אימות תצורה בטוח עם fs.access ו-issue codes; ‏(5) ביטול KEY_EVENT_NAMES — זיהוי דרך isKeyEvent; ‏(6) ‏cache ממופתח לפי טווח + תיעוד per-process; ‏(7) פרק אימות מעודכן — בלי לחזור על בדיקות ההקמה; ‏(8) הוסרו מספרי מכסה — propertyQuota נקרא כשזמין, core/realtime בנפרד; ‏(9) בדיקות חדשות לכל אלה; ‏(10) עדכון-תוכנית בלבד, אחרי אימות.

**מטרה:** עמוד אדמין חדש שמציג נתוני תנועה מ-GA4 (property ‏`GA4_PROPERTY_ID`) דרך Google Analytics Data API, שרת-בלבד, עם בורר טווח, cache, מצבי כשל מלאים, RTL, ותצוגה בעברית.

**עקרונות מנחים (מחייבים):**
- כל קריאת GA4 רצה בשרת בלבד (`import 'server-only'` בשכבת הנתונים). אפס credentials בצד לקוח; רכיבי לקוח מקבלים props מספריים בלבד (תקדים `_donut.tsx`).
- אימות דרך ADC (`GOOGLE_APPLICATION_CREDENTIALS` נקרא אוטומטית ע"י הקליינט); ‏`fallback: 'rest'` עוקף gRPC.
- recharts רק בגרף המגמה; KPI, טבלאות ומדים — רכיבי שרת SVG/CSS (כלל-הבית `_meters.tsx:5-12`).
- צבעים אך ורק דרך `ChartConfig` + ‏`var(--color-…)` וטוקנים סמנטיים — אף hex.
- אין PII: אגרגטים בלבד. ה-tag רץ רק ב-`(site)` וב-`(customer)/app`; דפי טוקן מוחרגים, ובנוסף פילטר הגנתי בבקשת top-pages (§3.3).

---

## 1. עץ קבצים

### קבצים חדשים

```
src/lib/analytics/
├── ga4-types.ts            # טיפוסים + AnalyticsRange + parseRange + מיפויי תוויות — בלי server-only
├── ga4-requests.ts         # בוני-בקשות טהורים, פרמטריים בטווח: buildCoreBatchA/B(range), buildRealtimeRequests()
├── ga4-requests.test.ts    # בדיקות צורת הבקשות (כולל פרמטריות הטווח)
├── ga4-mappers.ts          # ממפי-תגובות טהורים + classifyGa4Error + fillTrendGaps + formatSeconds
├── ga4-mappers.test.ts     # בדיקות מיפוי, סיווג, ועיצוב משך
└── ga4-client.ts           # 'server-only': singleton (ADC + fallback:'rest') + getGa4ConfigStatus() האסינכרוני

src/lib/data/admin/
├── analytics.ts            # ה-DAL: הרשאות + cache-לפי-טווח + אורקסטרציה
└── analytics.test.ts       # בדיקות DAL (מוקים: server-only, dal, ga4-client)

src/app/(admin)/admin/analytics/
├── page.tsx                # async server component, force-dynamic; קורא searchParams.range דרך parseRange
├── loading.tsx             # שלד תואם-footprint
├── _range-picker.tsx       # רכיב שרת: בורר טווח מ-<Link>-ים (?range=), aria-current, RTL
├── _sections.tsx           # רכיבי שרת: SectionCard (state-aware), טבלאות, מדים, כרטיס realtime
├── _trend-chart.tsx        # 'use client': גרף מגמה recharts (הרכיב הלקוחי היחיד עם גרף)
└── _auto-refresh.tsx       # 'use client': טיימר 60שנ' → router.refresh() כשהטאב גלוי (renders null)
```

### קבצים קיימים שמשתנים

```
src/components/admin-shell.tsx            # שורה אחת: פריט ניווט בקבוצת "מערכת ותפעול"
src/app/(admin)/admin/_components.tsx     # export חדש: StatTile (חילוץ האריח האינליני הקיים)
next.config.ts                            # רק אם build ייכשל: '@google-analytics/data' ל-serverExternalPackages (תקדים pg-boss)
```

אין מיגרציות, אין env חדש, אין תלויות חדשות.

---

## 2. חוזי טיפוסים (`ga4-types.ts`)

```ts
// ---- טווח: מקור אמת יחיד, פרמטרי בכל השכבות ----
export type AnalyticsRange = 'today' | '7d' | '30d' | '90d';
export const DEFAULT_RANGE: AnalyticsRange = '30d';
export const RANGE_OPTIONS: readonly { value: AnalyticsRange; label: string }[];
// [{today,'היום'},{7d,'7 ימים'},{30d,'30 יום'},{90d,'90 יום'}]

export function parseRange(raw: string | string[] | undefined): AnalyticsRange;
// כל קלט לא-חוקי (כולל מערך, ריק, ערך זר) → DEFAULT_RANGE. נבדק ביחידה.

export function rangeToDateRange(range: AnalyticsRange): { startDate: string; endDate: string };
// today→{today,today}; 7d→{7daysAgo,today}; 30d→{30daysAgo,today}; 90d→{90daysAgo,today}

export type SectionState = 'ok' | 'stale' | 'quota_exhausted' | 'error' | 'not_configured';

export interface Sectioned<T> { state: SectionState; data: T | null; fetchedAt: string | null; }

// פרמטרי-טווח — ערך אחד לכל מדד, עבור הטווח הנבחר. אין שדות 7d/30d קבועים (v2).
export interface AnalyticsOverview {
  activeUsers: number;
  newUsers: number;                    // v2
  sessions: number;
  pageViews: number;
  engagementRate: number | null;       // שבר 0–1
  averageSessionDuration: number;      // שניות (כפי שמוחזר מה-API); עיצוב ב-UI בלבד (v2)
}

export interface TrendPoint { date: string; activeUsers: number; sessions: number; }
export interface TopPageRow { pagePath: string; pageTitle: string; views: number; }
export interface ChannelRow { channelGroup: string; label: string; sessions: number; }
export interface SourceRow  { source: string; medium: string; sessions: number; }
export interface CountryRow { countryId: string; label: string; activeUsers: number; }
export interface DeviceRow  { category: string; label: string; sessions: number; }

// isKeyEvent נגזר מה-dimension הרשמי isKeyEvent === 'true' — לא מרשימה קבועה (v2).
export interface EventCountRow { eventName: string; count: number; isKeyEvent: boolean; }

// Realtime מורחב (v2). topLocations לפי city (אגרגט בלבד; מוצג רק כשיש נתון).
export interface RealtimeSnapshot {
  activeUsersNow: number;
  topEvents: { eventName: string; count: number }[];
  topLocations: { label: string; activeUsers: number }[];
}
// "דפים פעילים בזמן-אמת" — לא ממומש בשלב הראשון: אין dimension רשמי pagePath
// ב-runRealtimeReport (אומת מול הסכמה). מוצהר כפער — לא מוחלף בנתון אחר (v2).

export interface QuotaSnapshot {
  tokensPerDay:  { consumed: number; remaining: number };
  tokensPerHour: { consumed: number; remaining: number };
}

export interface AnalyticsDashboard {
  configured: boolean;
  configIssue: Ga4ConfigIssue | null;   // v2 — קוד בטוח למצב not_configured
  range: AnalyticsRange;                // הטווח שעליו נבנה כל האובייקט (v2)
  overview: Sectioned<AnalyticsOverview>;
  trend:    Sectioned<TrendPoint[]>;
  topPages: Sectioned<TopPageRow[]>;
  channels: Sectioned<ChannelRow[]>;
  sources:  Sectioned<SourceRow[]>;
  geo:      Sectioned<CountryRow[]>;
  devices:  Sectioned<DeviceRow[]>;
  events:   Sectioned<EventCountRow[]>;
  coreQuota: QuotaSnapshot | null;      // v2 — מכסות core בנפרד מ-realtime
}

export const TABLE_ROW_LIMIT = 10;
export const EVENTS_ROW_LIMIT = 15;
export const CHANNEL_GROUP_LABELS: Record<string, string>;
export const DEVICE_LABELS: Record<string, string>;
```

**הוסר (v2):** ‏`KEY_EVENT_NAMES` — אין allowlist קשיח. מקור האמת לאירועי-מפתח: הגדרת Key Events ב-GA4 Admin, המשתקפת ב-dimension‏ `isKeyEvent`. אומת חי: כרגע אין key events מוגדרים ב-property (`(not set)` לכל אירוע) — הממפה מפרש רק `'true'` כאירוע-מפתח, וכל ערך אחר (`'false'`, `'(not set)'`) כלא. **פעולת בעלים עתידית**: סימון אירועים כ-key ב-GA4 Admin (דוח סוכן-האירועים שבדרך יסייע להחליט); ‏allowlist קוד יתווסף רק אם יוכח צורך מוצרי.

### 2.2 אימות תצורה בטוח (v2, ‏`ga4-client.ts`)

```ts
export type Ga4ConfigIssue =
  | 'missing_property_id'      // המשתנה חסר/ריק
  | 'invalid_property_id'      // קיים אך לא ספרות-בלבד (^\d+$)
  | 'missing_credentials_path' // GOOGLE_APPLICATION_CREDENTIALS חסר/ריק
  | 'credentials_unreadable';  // הקובץ לא קיים/לא קריא (fs.promises.access R_OK)

export async function getGa4ConfigStatus(): Promise<{ ok: true } | { ok: false; issue: Ga4ConfigIssue }>;
// אסינכרוני (fs.access). לעולם לא מדפיס/מלוגג נתיב או תוכן — לא בהודעות שגיאה,
// לא ב-issue, לא ב-UI. ה-UI ממפה issue → משפט עברי גנרי ("קובץ האישורים אינו
// קריא לשרת") בלי שום ערך. מחליף את isGa4Configured מבוסס-presence מגרסה 1.
```

### 2.3 סיווג שגיאות (`ga4-mappers.ts`) — ללא שינוי מגרסה 1

```ts
export type Ga4ErrorKind = 'quota' | 'auth' | 'network' | 'unknown';
export function classifyGa4Error(err: unknown): Ga4ErrorKind;
// quota: code===8 / HTTP 429 / 'RESOURCE_EXHAUSTED'; auth: 7/16/401/403; network: כשל fetch/DNS.
```

---

## 3. שכבת הנתונים

### 3.1 ‏`ga4-client.ts`

כמו גרסה 1 (lazy singleton, ‏`{ fallback: 'rest' }`, בלי credentials מפורשים) + ‏`getGa4ConfigStatus` מ-§2.2. ‏Node runtime (ברירת מחדל). ‏bundling: מתחילים בלי לגעת ב-next.config.ts; כשל build על google-gax → ‏serverExternalPackages (נקודת הכרעה בשלב 3 של סדר הביצוע).

### 3.2 חלוקת הבקשות (v2 — פרמטרי בטווח)

| יחידה | קריאה | דוחות | TTL | מפתח cache |
|---|---|---|---|---|
| Batch A(range) | `batchRunReports` | overview‏ (6 מטריקות, כולל newUsers ו-averageSessionDuration), trend‏ (`date`), topPages, channels, sources | 5 דק' | `A:${range}` |
| Batch B(range) | `batchRunReports` | countries, devices, events‏ (`eventName`+`isKeyEvent`) | 5 דק' | `B:${range}` |
| Realtime | 3×‏`runRealtimeReport` במקביל | ‏activeUsers (בלי dims) · topEvents (`eventName`×`eventCount`) · topLocations (`city`×`activeUsers`) | 45 שנ' | slot יחיד |

- ‏overview: דוח אחד, ‏dateRange יחיד לפי הטווח הנבחר: ‏activeUsers, newUsers, sessions, screenPageViews, engagementRate, averageSessionDuration.
- ‏events: דוח אחד `eventName`+`isKeyEvent` × ‏eventCount (v2 — דוח ה-keyEvents הנפרד מגרסה 1 התייתר; ‏batch B = ‏3 דוחות).
- ‏realtime: אין batch רשמי ל-realtime — שלוש קריאות ב-`Promise.all` תחת ה-slot היחיד. ‏topLocations מוצג רק כשיש שורות.
- ‏`returnPropertyQuota: true` על הדוח הראשון בכל batch **וגם** על קריאת ה-activeUsers של realtime — ‏core ו-realtime הם מאגרי מכסה **נפרדים** ומטופלים בנפרד (v2): ‏`coreQuota` ב-dashboard, ‏quota של realtime בתוך ה-snapshot לצורך הבאנר. **אין מספרי מכסה קבועים בתוכנית או בקוד** — קוראים propertyQuota כשזמין ומציגים consumed/remaining בלבד.

### 3.3 בוני הבקשות (`ga4-requests.ts` — טהורים, פרמטריים)

```ts
export function buildCoreBatchA(range: AnalyticsRange): IRunReportRequest[]; // בדיוק 5
export function buildCoreBatchB(range: AnalyticsRange): IRunReportRequest[]; // בדיוק 3
export function buildRealtimeRequests(): IRunRealtimeReportRequest[];        // בדיוק 3
```

ללא שינוי מגרסה 1: פילטר ההגנה על topPages (‏notExpression + ‏BEGINS_WITH על `/r/`,`/g/`,`/ty/`), ‏sources על ‏session-scoped (`sessionSource`/`sessionMedium`), ‏channels על `sessionDefaultChannelGroup`, ‏orderBy + ‏limit.

### 3.4 הממפים (`ga4-mappers.ts`)

כמו גרסה 1, בתוספת/שינוי (v2): ‏`mapOverview` שולף גם newUsers ו-averageSessionDuration (‏Number עם ברירת-מחדל 0); ‏`mapEvents(resp)` יחיד עם ‏`isKeyEvent: dim === 'true'`; ‏`mapRealtime(activeResp, eventsResp, locationsResp)`; ‏`fillTrendGaps(points, range, today)` פרמטרי-טווח; וחדש:

```ts
export function formatSeconds(totalSeconds: number): string;
// עיצוב משך קריא בעברית: 45→"45 שנ'"; 154→"2:34 דק'"; 3725→"1:02:05 שע'"; 0→"0 שנ'". נבדק ביחידה.
```

### 3.5 ה-DAL (`src/lib/data/admin/analytics.ts`)

```ts
export async function getAnalyticsDashboard(range: AnalyticsRange): Promise<AnalyticsDashboard | null>;
export async function getRealtimeSnapshot(): Promise<Sectioned<RealtimeSnapshot>>;
```

סדר פנימי: ‏requireAdmin → ‏hasPlatformPermission('view_customer_data') (‏false⇒null) → ‏getGa4ConfigStatus (לא-תקין ⇒ ‏configured:false + ‏configIssue, אפס רשת) → ‏fetch.

**עיצוב ה-cache (v2):**

```ts
// core: Map ממופתח 'A:30d', 'B:90d'... — טווחים שונים לא דורסים זה את זה
// ולא חולקים TTL. realtime: slot יחיד (אינו תלוי-טווח).
// ה-cache הוא PER-PROCESS (זיכרון המודול) ואינו משותף בין מופעי Node:
// כיום kalfa-beta רץ כ-fork יחיד ב-pm2 (מופע אחד בפועל); ריבוי מופעים
// עתידי = cache נפרד לכל מופע — לגיטימי לאגרגטים, ומתועד כאן במפורש.
const coreSlots = new Map<string, CacheSlot<CoreData>>();
let realtimeSlot: CacheSlot<RealtimeSnapshot>;
const CORE_TTL_MS = 5 * 60_000;
const REALTIME_TTL_MS = 45_000;
const QUOTA_BACKOFF_MS = 60_000;
```

כללי ההחלטה (`resolveOutcome` הטהורה) — ללא שינוי מגרסה 1: ‏fresh→ok; ‏expired→רענון; כשל עם lastGood→stale ("מוצגים נתונים מ-HH:MM"); כישלון לא נשמר; חריג quota עם backoff‏ 60שנ'; ‏auth/network בלי lastGood→error. בדיקת ההרשאה רצה לפני הגשה מה-cache בכל בקשה.

---

## 4. הרשאות — ללא שינוי מגרסה 1

‏gate רך עם `hasPlatformPermission('view_customer_data')` (‏dal.ts:117); ‏EmptyState בתוך העמוד; אפס מיגרציות. החלופה (משאב `view_analytics` חדש) נדחתה באין-דורש; לשקילה מחודשת אם יקום תפקיד שצריך אנליטיקס בלי גישת נתוני-לקוחות.

---

## 5. פירוק ה-UI

### 5.1 ‏`page.tsx`

```
0. const range = parseRange((await searchParams).range)   // לא-חוקי → 30d, בלי redirect
1. dash = await getAnalyticsDashboard(range); realtime = await getRealtimeSnapshot()
   - dash === null       → PageHeading + EmptyState הרשאה
   - !dash.configured    → כרטיס "לא מוגדר": משפט עברי גנרי לפי configIssue
                           (לעולם לא נתיב/ערך; תקדים getInfraConfigStatus)
2. <RangePicker current={range} /> + סקשנים + <AutoRefresh /> + "עודכן ב-…"
3. באנרי מכסה: core ו-realtime בנפרד, עם consumed/remaining כשזמין —
   בלי מספרי-תקרה קבועים (v2)
```

### 5.2 ‏`_range-picker.tsx` (שרת, v2)

ארבעה `<Link href={{ pathname: '/admin/analytics', query: { range } }}>` בסגנון segmented control, ‏`aria-current` על הנבחר, RTL לוגי. ניווט = ‏server re-render עם הטווח החדש; ה-cache הממופתח הופך חזרה לטווח שכבר נטען למיידית.

### 5.3 חלוקת server/client (עדכוני v2 — השאר כגרסה 1)

- אריחי KPI: נוספים **newUsers** ("משתמשים חדשים") ו-**averageSessionDuration** ("משך ביקור ממוצע", `formatSeconds`). כותרות האריחים מציינות את הטווח הנבחר.
- גרף המגמה: מכסה את הטווח הנבחר; בטווח `today` (נקודת נתון אחת) מוצג placeholder מפורש "גרף מגמה זמין בטווח רב-יומי" — הצהרה, לא תחליף-נתון.
- כרטיס Realtime (שרת): ‏activeUsersNow גדול + רשימת topEvents (עד 5) + רשימת topLocations (עד 5, רק כשקיימות). **"דפים פעילים עכשיו" לא מוצג ולא מדומה — פער מוצהר** (v2).
- ‏`_auto-refresh.tsx`: 60שנ', רק בטאב גלוי — כגרסה 1.

### 5.4 ניווט + ‏StatTile — ללא שינוי מגרסה 1

('אנליטיקת אתר' בקבוצת "מערכת ותפעול"; אימות שם האייקון ‏ChartColumn/BarChart3 מול lucide המותקן בזמן המימוש.)

---

## 6. תוכנית בדיקות (vitest, node env, ‏`vi.mock('server-only', () => ({}))`)

### 6.1 טהורות (`ga4-requests.test.ts`, ‏`ga4-mappers.test.ts`)

- **parseRange (v2)**: ארבעת הערכים החוקיים עוברים; ‏undefined, מחרוזת זרה, מערך, ריק → ‏`'30d'`.
- **rangeToDateRange (v2)**: ארבעת המיפויים המדויקים.
- ‏batch A בדיוק 5 דוחות, ‏batch B בדיוק 3 (v2), ‏realtime בדיוק 3 בקשות והראשונה ללא dimensions; ‏dateRanges נגזרים מהטווח שהועבר — נבדק לכל ארבעת הטווחים (v2); פילטר `/r/`,`/g/`,`/ty/` ב-topPages; ‏returnPropertyQuota על הראשון בכל batch.
- **mapOverview (v2)**: כולל newUsers ו-averageSessionDuration; ערכים חסרים/פגומים → 0.
- **mapEvents (v2)**: ‏`isKeyEvent==='true'` → ‏true; ‏`'false'`/`'(not set)'`/חסר → ‏false — בלי שום שם-אירוע קשיח בקוד או בבדיקה.
- **mapRealtime (v2)**: שלוש תגובות → snapshot; תגובות ריקות → 0 ומערכים ריקים.
- **formatSeconds (v2)**: ‏45, ‏154, ‏3725, ‏0 — לפי החוזה ב-§3.4.
- ‏fillTrendGaps לכל טווח רב-יומי + קלט ריק; ‏classifyGa4Error — כגרסה 1.

### 6.2 אימות תצורה (v2)

- **getGa4ConfigStatus**: ‏property חסר → ‏`missing_property_id`; ‏`'12ab3'` → ‏`invalid_property_id`; נתיב חסר → ‏`missing_credentials_path`; קובץ לא-קיים/לא-קריא (נתיב זמני) → ‏`credentials_unreadable`; תקין → ‏`ok`. ‏assert שאף תוצאה אינה מכילה נתיב.

### 6.3 ‏DAL (`analytics.test.ts`)

כגרסה 1 (הרשאה→null; לא-מוגדר→אפס רשת; TTL; ‏stale; אי-שמירת-כישלון; ‏quota backoff; ‏single-flight), ובנוסף (v2):
- **cache מופרד לפי טווח**: קריאה ל-30d ואז ל-7d → שתי קריאות client; חזרה ל-30d בתוך TTL → ללא קריאה שלישית.
- ‏realtime slot אינו תלוי-טווח: החלפת range אינה מפילה את cache ה-realtime.

### 6.4 אימות דפדפן חי — האינטגרציה החדשה בלבד (v2)

**לא חוזרים על בדיקות ההקמה** — ‏ADC, הרשאת הנכס, ‏`fallback:'rest'`, וכן תקפות newUsers / averageSessionDuration / isKeyEvent / realtime-events / realtime-city — כולם כבר אומתו חיים מול ה-property (ראו "אימותי v2"). בדפדפן נבדק רק החדש: הרינדור, בורר הטווח (כולל `?range=זבל` → 30d), עיצוב המשך, הגרף ב-RTL, ‏auto-refresh בלי איבוד state, ‏empty-states בנתונים דלים, היעדר נתיבי-טוקן ב-top pages, וכרטיס "לא מוגדר" לכל ארבעת ה-issue codes (סימולציה ב-dev בלבד). לפי ‏skill‏ verifying-kalfa-changes.

---

## 7. סדר ביצוע ונקודות אימות

| שלב | תוכן | נקודת אימות |
|---|---|---|
| 1 | ‏ga4-types (parseRange/rangeToDateRange), ‏ga4-requests, ‏ga4-mappers + בדיקות | `npx vitest run src/lib/analytics` ירוק; ‏tsc |
| 2 | ‏ga4-client (+getGa4ConfigStatus) + ‏DAL + בדיקות | `npx vitest run src/lib/data/admin/analytics.test.ts` ירוק |
| 3 | ‏page.tsx שלד (KPI בלבד) + ‏_range-picker | דפדפן: מספרים אמיתיים בכל ארבעת הטווחים. **כשל bundling → serverExternalPackages ובדיקה חוזרת** |
| 4 | כל הסקשנים + realtime מורחב + גרף + auto-refresh + loading + StatTile | דפדפן: כל סקשן תקין בכל טווח |
| 5 | ניווט + כרטיס "לא מוגדר" + באנרי מכסה (core/realtime בנפרד) | סיידבר פעיל; ‏issue codes מוצגים גנרית |
| 6 | שערים: lint && tsc && vitest && build (לא במקביל ל-build אחר) | הכול ירוק |
| 7 | אימות דפדפן מלא §6.4 | דיווח לבעלים עם רשימת קבצים ותוצאות |
| 8 | *אופציונלי נפרד:* הסבת שני האריחים האינליניים הקיימים ל-StatTile | ‏diff ויזואלי אפס |

בלי commit ובלי deploy בכל השלבים.

---

## 8. סיכונים ונקודות פתוחות

1. **Bundling של google-gax** — מוכרע מוקדם (שלב 3); מוצא-חירום חד-שורתי עם תקדים.
2. **מכסות** — אין מספרים קבועים (v2); ‏propertyQuota נקרא כשזמין; ‏core ו-realtime מנוטרים בנפרד; ‏backoff‏ 60שנ' על 429; ב-dev ה-cache מתאפס ב-HMR — מוגן באותו backoff.
3. **Latency** — טעינה לא-מקוררת = 2 batches + 3 realtime במקביל; ‏loading.tsx מכסה; החלפת-טווח ראשונה = קריאות חדשות (loading מכסה).
4. **Property חדש ודל-נתונים** — ‏empty-states באותו footprint; ‏fillTrendGaps מונע גרף שבור; ייתכן thresholding של גוגל.
5. **אזור-זמן** — ‏dimension‏ `date` לפי הגדרת ה-property. **פתוח לבעלים: לוודא Asia/Jerusalem ב-GA4 Admin.**
6. **router.refresh()** — מריץ את כל העמוד; זול מאחורי cache; מתועד בהערת קוד.
7. **קובץ ה-credentials ב-runtime** — קריא למשתמש ה-pm2 (כיום ✓: בעלות kalfa.me, ‏600) וחייב להיות ב-env של התהליך בעת deploy עתידי.
8. **שם אייקון lucide** — אימות בזמן מימוש.
9. **פעולות בעלים פתוחות:** ‏(א) סימון Key Events ב-GA4 Admin (כרגע אין — אומת חי; דוח סוכן-האירועים יסייע); ‏(ב) אישור מיקום ניווט; ‏(ג) אזור-זמן ה-property.

---

**סיכום היקף (v2):** ‏12 קבצים חדשים (מהם 3 בדיקות), ‏2 קבצים קיימים משתנים, שינוי מותנה אחד ב-next.config.ts. אפס מיגרציות, אפס env חדש, אפס תלויות חדשות. כל שמות המטריקות/המימדים — כולל תוספות v2 — אומתו מול ה-API החי של ה-property עצמו לפני כתיבת התוכנית.
