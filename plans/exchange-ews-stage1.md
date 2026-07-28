# אינטגרציית IONOS Hosted Exchange — שלב 1 (יומן בלבד)

תוכנית לאישור בעלים · 27.07.2026 · מבוסס על חקירת ews-investigator (כל עובדה
מסומנת MEASURED אומתה מול השרת החי / קוד מותקן / npm registry).

## 0. בסיס העובדות (MEASURED)

| עובדה | ראיה |
|---|---|
| ‏endpoint: `https://exchange.ionos.com/EWS/Exchange.asmx` חי | ‏401 + כותרות Exchange (לא 404) |
| שרת: ‏Exchange Server 2019 (חוות שרתים) | ‏`x-owa-version: 15.2.2562.45`, ‏`x-feserver: WINHEX19BEUS*` |
| אימות: ‏Negotiate+NTLM בלבד ב-challenge (אין Basic) | כותרות ‏WWW-Authenticate |
| תיבה: `netanel.kalfa@kalfa.me`, קונפיג שרת-מפורש בלי Autodiscover | צילום הגדרת iOS של הבעלים |
| פרישת EWS ‏10/2026 = ‏Exchange Online בלבד; ‏on-prem ללא שינוי | הצהרת מיקרוסופט המפורשת |
| ‏NTLM זמין בלי התקנות: ‏`@ewsjs/xhr@3.1.3` בעץ, כולל `useNtlmAuthentication()` | ‏node_modules נבדק |
| חובה `new XhrApi({ gzip: true })` — אחרת ג'יבריש ב-NTLM | ‏README רשמי, ‏issue #334 |
| ‏uuid CVE — אפס חשיפה (רק `v4()` נקרא בשרשרת) | קריאת מקור Guid.js + msal-node |
| באג Node 24 ‏(util.isNullOrUndefined) מוגבל ל-ExtendedPropertyDefinition — לא בשלב 1 | קריאת מקור + אימות על Node v24.18 |
| אין חבילה עדכנית/עדיפה (סקר npm מלא) | ‏node-ews ‏2022+deprecated `request`; אין fork; תוסף n8n מ-22.7 בנוי על 0.15.3 |

## 1. היקף שלב 1 — וגבולותיו

**כן:** בדיקת חיבור · פרטי תיבה · רשימת יומנים · יצירת פגישת-בדיקה · מחיקתה.
**לא (איסור מפורש):** שליחת מייל, קריאת הודעות, סנכרון דו-כיווני, כל UI מעבר למסך "חיבור Exchange" בסיסי.

## 2. שכבת ה-provider — `src/lib/exchange-ews/`

לפי תקדים הפיצול של `src/lib/voximplant/` (core/client). כל קובץ פותח ב-`import 'server-only'`.

```
src/lib/exchange-ews/
├── types.ts        # חוזים בלבד — בלי שום ייבוא של הספרייה
├── crypto.ts       # AES-256-GCM (סעיף 4) + טסטים
├── provider.ts     # הממשק המבודד — הקוד הקורא מכיר רק אותו
└── ews-impl.ts     # המימוש היחיד שנוגע ב-ews-javascript-api
```

### 2.1 חתימות הממשק (`provider.ts`)

```ts
export type ExchangeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'auth_failed' | 'unreachable' | 'not_found' | 'provider_error' };
  // לעולם לא זולג טקst שגיאה גולמי של הספרייה אל הקורא/הלוג

export interface ExchangeCalendarProvider {
  testConnection(cfg: ExchangeConnectionConfig): Promise<ExchangeResult<MailboxInfo>>;
  listCalendars(cfg: ExchangeConnectionConfig): Promise<ExchangeResult<CalendarSummary[]>>;
  createTestAppointment(cfg: ExchangeConnectionConfig, draft: AppointmentDraft): Promise<ExchangeResult<{ appointmentId: string }>>;
  deleteAppointment(cfg: ExchangeConnectionConfig, appointmentId: string): Promise<ExchangeResult<void>>;
}
```

### 2.2 שלד המימוש (`ews-impl.ts`) — הנקודות שנקבעו מהחקירה

```ts
import { ExchangeService, ExchangeVersion, Uri } from 'ews-javascript-api';
import { XhrApi } from '@ewsjs/xhr';

const EWS_ENDPOINT = 'https://exchange.ionos.com/EWS/Exchange.asmx'; // allowlist קשיח — סעיף 5

function buildService(user: string, password: string): ExchangeService {
  const service = new ExchangeService(ExchangeVersion.V2018_01_08); // המקסימום שהספרייה מכירה; 2019 מדבר סכימה זו
  service.Url = new Uri(EWS_ENDPOINT);                              // בלי Autodiscover — כמו בקונפיג המאומת
  service.XHRApi = new XhrApi({ gzip: true })                       // gzip:true = חובה (issue #334)
    .useNtlmAuthentication(user, password);                         // user = כתובת מלאה
  return service; // קצר-מועד, נבנה פר-קריאה, לא נשמר בזיכרון
}
```

‏(חתימות `XhrApi`/`useNtlmAuthentication` אומתו מול ‏d.ts המותקן; קריאות היומן —
‏CalendarFolder.Bind / FindAppointments / Appointment.Save / Delete — יאומתו שוב
מול ה-d.ts בעת הכתיבה, לא מהזיכרון.)

## 3. סכימה (מיגרציה אחת — **לא תיווצר לפני אישור**)

דגם "טבלה סגורה" לפי תקדים `console_agent_secrets`: ‏RLS פעיל **בלי אף policy**,
‏REVOKE מ-anon/authenticated — גישה רק דרך service-role בצד השרת. הנימוק:
הטבלה מחזיקה credential מוצפן; אין הצדקה ל-SELECT דפדפני, גם לא לבעלים על
הרשומה שלו. סטטוס לתצוגה — דרך view דק בלבד.

```sql
create table public.exchange_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,  -- תמיד: מי חיבר
  org_id uuid references public.organizations(id) on delete cascade,  -- מולא רק בחיבור ארגוני-משותף
  mailbox_email text not null check (btrim(mailbox_email) <> ''),
  auth_method text not null default 'ntlm' check (auth_method in ('ntlm','basic')),
  credential_ciphertext text not null,
  credential_iv text not null,          -- 12B base64, ייחודי לכל הצפנה
  credential_auth_tag text not null,    -- 16B base64, GCM tag
  encryption_key_version smallint not null default 1,
  status text not null default 'pending'
    check (status in ('pending','verified','failed','revoked')),
  last_verified_at timestamptz,
  last_error text,                      -- הודעה מסוננת בלבד, לעולם לא raw
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exchange_connections_mailbox_per_user unique (user_id, mailbox_email)
);
alter table public.exchange_connections enable row level security;
revoke all on public.exchange_connections from anon, authenticated;

create view public.exchange_connections_status
  with (security_invoker = off) as        -- ייקבע סופית מול rls-schema-engineer
  select id, user_id, mailbox_email, status, last_verified_at
  from public.exchange_connections;       -- בלי אף עמודת הצפנה
```

הערה: אין `ews_endpoint_url` בטבלה בשלב 1 — בכוונה (סעיף 5, ‏SSRF).

### 3.1 מתג מודל-הבעלות — נשלט מפאנל הניהול (הכרעת בעלים 27.07)

במקום hardcode: עמודה ב-`app_settings` —

```sql
alter table public.app_settings
  add column exchange_connection_mode text not null default 'per_user'
  check (exchange_connection_mode in ('per_user','per_org'));
```

- נערך ממסך אדמין (הרחבת `/admin/settings` או `/admin/channels`, לפי דפוס
  מתג-העוגיות), נקרא ב-Server Actions דרך reader קיים של app_settings.
- **סמנטיקת החלפה מוגדרת-מראש**: החלפת מצב לא מוחקת ולא מנתקת חיבורים
  קיימים — קובעת רק אילו חיבורים חדשים נוצרים ואיזה מסלול פעיל בממשק.
- ברירת-מחדל `per_user` — המצב האמיתי של שלב 1.

## 4. מודל ההצפנה — `node:crypto` בלבד (הכרעת בעלים)

- **מפתח:** ‏`EXCHANGE_EWS_ENCRYPTION_KEY` — ‏32B ‏base64 ב-env (סודיות כמו
  ‏service-role; לעולם לא `NEXT_PUBLIC_`). ייווצר ע"י הבעלים
  (`openssl rand -base64 32`) ויוזן ידנית — לא בצ'אט.
- **אלגוריתם:** ‏AES-256-GCM. ‏IV ‏12B רנדומלי **חדש לכל הצפנה**; ‏auth-tag
  ‏16B בעמודה נפרדת; פענוח עם `setAuthTag` — כשל אימות = שגיאה, בלי fallback.
- **AAD:** ‏`${connectionId}:${userId}` — קושר ciphertext לרשומה; מונע השתלת
  ‏ciphertext בין רשומות.
- **רוטציה:** ‏`encryption_key_version` + ‏`..._KEY_PREVIOUS` בזמן מעבר.
- **אינווריאנט לוגים:** לעולם לא plaintext/ciphertext/סיסמה בלוג, כולל שגיאות.
- טסטים: ‏round-trip, חבלה ב-tag/iv/AAD חייבת להיכשל, זרות בין רשומות.

## 5. אינווריאנטות אבטחה

1. **‏SSRF:** ה-endpoint קשיח בקוד (‏allowlist של exchange.ionos.com בלבד);
   שום קלט משתמש לא קובע לאן השרת פונה. (אושש חיצונית: קיום fork בשם
   ‏node-ews-ssrf-fixed מוכיח שזה וקטור אמיתי בעטיפות EWS.)
2. **טבלה סגורה** — אין שום נתיב דפדפני ל-ciphertext.
3. ‏Server Action עם `requireUser` + בעלות על הרשומה (auth-authz-guardian
   יסקור לפני ship).
4. תגובות SOAP עלולות להכיל תוכן יומן אישי — לוגים ברמת מטא-דטה בלבד.
5. הסיסמה נכנסת פעם אחת במסך מאובטח, מוצפנת מיד, לא מוחזרת ל-client לעולם.

## 6. מדרג ביצוע ושערים

| שלב | תוכן | שער יציאה |
|---|---|---|
| ‏1.0 | מיגרציית `exchange_connections` + view | ‏advisors נקי, ‏`gen types --linked`, אישור rls-schema-engineer |
| ‏1.1 | ‏`crypto.ts` + טסטים | ‏vitest ירוק; סריקה שאין plaintext בלוגים |
| **⛔ שער אישור-בעלים** | לפני שקרדנציאל אמיתי נוגע במערכת | אישור מפורש |
| ‏1.2 | ‏`testConnection` ‏(read-only: ‏Bind ליומן) | מול התיבה האמיתית `netanel.kalfa@kalfa.me` — אין live-test-data מומצא |
| ‏1.3 | ‏`getMailboxInfo` + ‏`listCalendars` | אותה תיבה |
| ‏1.4 | ‏`createTestAppointment`+`deleteAppointment` | פגישה נראית ונעלמת ב-OWA (אימות עין) |
| ‏1.5 | ‏Server Action + מסך "חיבור Exchange" + מתג המודל באדמין (§3.1) | סקירת authz; ‏lint+tsc+tests+build |

כל שלב: ‏lint + ‏tsc + טסטים רלוונטיים לפני מעבר. פריסות — הבעלים בלבד.

## 7. הכרעות פתוחות (חוסמות התחלה)

1. ✅ **בדיקת ה-NTLM עברה (27.07 19:58, MEASURED)**: ‏curl ‏--http1.1 ‏--ntlm
   עם `netanel.kalfa@kalfa.me` (פורמט UPN, בלי domain נפרד) → ‏401-challenge
   ואז **‏200 OK** עם `Persistent-Auth: true`. ה-401 המוקדם היה ארטיפקט
   HTTP/2 (‏NTLM צמוד-חיבור נשבר על ריבוב h2) — הספרייה עובדת מעל Node
   http/1.1 כך שאינו רלוונטי למימוש. דומיין AD פנימי שנחשף ב-challenge:
   ‏winusa.mail (מידע אבחוני בלבד, לא נדרש לקונפיג).
2. ✅ **מודל בעלות — הוכרע (27.07)**: נשלט ממסך אדמין דרך
   `app_settings.exchange_connection_mode` (§3.1); הסכימה תומכת בשני
   המודלים מיום ראשון; ברירת-מחדל `per_user`.
3. **אישור התוכנית הזו** — הסכימה (§3) ומודל ההצפנה (§4) במפורש.

## 8. סיכונים ידועים ומענה

| סיכון | מענה |
|---|---|
| ספרייה ללא תחזוקה (‏5/2024) | בידוד מלא מאחורי provider; שום ייבוא שלה מחוץ ל-ews-impl.ts |
| באג Node 24 ‏(ExtendedPropertyDefinition) | לא בנתיב שלב 1; חסימת lint על ייבוא ExtendedPropertyDefinition עד פתרון |
| ‏IONOS עשויה לשנות backend בעתיד | ‏status ‏'failed' + התראה; אימות מול תמיכת IONOS מומלץ |
| ‏Basic לא מוצע | ‏NTLM ראשי; ‏basic נשאר בסכימה כאופציה מתועדת בלבד |
