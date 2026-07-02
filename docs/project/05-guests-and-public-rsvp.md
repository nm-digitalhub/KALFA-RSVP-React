# 05 — מוזמנים ו‑RSVP ציבורי

מסמך זה מתעד את ניהול המוזמנים (Guests) ואת משטח ה‑RSVP הציבורי — מהישות במסד הנתונים, דרך זרימות הניהול בצד הבעלים (רשימה, הוספה/עריכה/מחיקה, ייבוא CSV), ועד עמוד אישור ההגעה הציבורי `/r/[token]`, מחזור חיי הטוקן, הגנות ה‑abuse, וקליטת RSVP מכפתורי WhatsApp.

כל האמור נכתב מתוך קריאת הקוד עצמו (נכון ל‑2026‑07‑02); אי‑התאמות בין הקוד לתיעוד קיים מרוכזות בסעיף האחרון.

## מפת קבצים

| תחום | קבצים |
|---|---|
| שכבת נתונים — מוזמנים | `src/lib/data/guests.ts` (+ `guests.test.ts`) |
| שכבת נתונים — RSVP | `src/lib/data/rsvp.ts` |
| שכבת נתונים — contacts | `src/lib/data/contacts.ts` (נגזרת חיוב; לא UI) |
| אימות קלט (Zod) | `src/lib/validation/guests.ts`, `src/lib/validation/rsvp.ts` |
| Server Actions (בעלים) | `src/app/(customer)/app/events/[id]/guests/guests-actions.ts` |
| ייבוא CSV | `src/app/(customer)/app/events/[id]/guests/import/import-actions.ts`, `src/lib/csv.ts` |
| טלפון | `src/lib/phone.ts` (E.164), `ISRAELI_PHONE_RE` ב‑`src/lib/constants.ts` |
| עמוד RSVP ציבורי | `src/app/(public)/r/[token]/page.tsx`, `rsvp-form.tsx`, `actions.ts` |
| Rate limiting | `src/lib/security/rate-limit.ts` (+ `rate-limit.test.ts`) |
| קישורים מוחלטים | `src/lib/url.ts` (`getAppUrl` / `getAppOrigin`) |
| הקשחת DB | `supabase/migrations/202606290034_rsvp_harden.sql` |
| WhatsApp inbound | `src/app/api/webhooks/whatsapp/route.ts`, `src/lib/whatsapp/inbound.ts`, `src/lib/data/webhook-processing.ts`, `worker/main.ts` |
| קונבנציית כפתורים | `docs/whatsapp-rsvp-button-convention.md` |

## ישות המוזמן (`guests`)

מקור האמת לשדות: הטיפוסים המחוללים ב‑`src/lib/supabase/types.ts` (טבלת `guests`, שורות 894–984).

| שדה | טיפוס | הערות |
|---|---|---|
| `id` | uuid | מזהה |
| `event_id` | uuid | FK ל‑`events`; גבול הבעלות — כל גישה נבדקת דרכו |
| `full_name` | text | שם המוזמן (PII) |
| `phone` | text \| null | טלפון גולמי כפי שהוזן (PII); אופציונלי |
| `status` | enum `guest_status` | `pending` \| `attending` \| `declined` \| `maybe` |
| `contact_status` | enum `contact_status` | `not_contacted` \| `contacted` \| `responded` \| `wrong_number` \| `unclear` \| `unavailable` \| `callback` |
| `expected_count` | int \| null | מכסת המוזמנים שהוקצתה; `null` = ללא תקרה |
| `confirmed_adults` | int \| null | מבוגרים שאושרו ב‑RSVP האחרון |
| `confirmed_kids` | int \| null | ילדים שאושרו ב‑RSVP האחרון |
| `meal_pref` | text \| null | העדפת תפריט (מנוקה כשהתשובה אינה `attending`) |
| `note` | text \| null | הערה חופשית (PII) |
| `group_id` | uuid \| null | FK ל‑`guest_groups` |
| `contact_id` | uuid \| null | FK ל‑`contacts` — ישות "איש קשר" של מודל החיוב (טלפון ייחודי לאירוע) |
| `callback_requested` | boolean | דגל בקשת שיחה חוזרת |
| `language` | text \| null | שפת המוזמן (לתמיכה עתידית) |
| `extras` | jsonb | JSON חופשי; **לעולם אינו מוקרן ל‑UI** (ראו "פרטיות") |
| `rsvp_token` | text | ה‑bearer secret של קישור ה‑RSVP הציבורי; ייחודי (`guests_rsvp_token_key`) |
| `rsvp_token_revoked_at` | timestamptz \| null | חותמת ביטול הקישור; `null` = פעיל |
| `created_at` / `updated_at` | timestamptz | |

### סטטוסים וערכי תשובה

- **`guest_status`** — מצב ה‑RSVP של האורח: `pending` (טרם ענה, מצב התחלתי), `attending`, `declined`, `maybe`.
- **ערכי תשובה שהאורח יכול לבחור**: `attending` / `declined` / `maybe` — מוגדרים פעם אחת ב‑`RSVP_STATUSES` (`src/lib/constants.ts:48`). `pending` אינו ניתן לבחירה בטופס הציבורי.
- **`contact_status`** — מצב יצירת הקשר בצד הבעלים/מוקד; `submit_rsvp` קובע אותו ל‑`responded` אוטומטית עם כל תשובה.

### טבלאות נלוות

- **`rsvp_responses`** (`types.ts:1553-1606`) — רשומת audit append‑only של כל שליחת RSVP: `guest_id`, `event_id`, `attending` (boolean \| null — `null` מייצג `maybe`), `adults`, `kids`, `meal_pref`, `note`, `extras` (תשובות לשאלות מותאמות), `created_at`. הרשומה האחרונה משמשת גם ל‑idempotency וגם למילוי‑מראש של הטופס.
- **`event_questions`** — שאלות מותאמות‑אירוע: `q_key`, `label`, `q_type`, `required`, `options` (מערך ערכים מותרים), `enabled`, `sort_order`. הטופס הציבורי מציג רק שאלות `enabled`, וה‑RPC מאמת מולן.
- **`guest_groups`** — קבוצות מוזמנים לכל אירוע: `name`, `color`.

### חוזי הקרנה (DTO) — הסתרת הטוקן

ב‑`src/lib/data/guests.ts:31-39` מוגדרות הקרנות עמודות קבועות:

- `GUEST_LIST_COLUMNS` — לרשימה המעומדת (כולל embed של `contacts(op_status, removal_requested)` ל‑badges).
- `GUEST_DETAIL_COLUMNS` — לטופס העריכה (מוסיף `meal_pref`/`note`).
- `GROUP_COLUMNS` — לקבוצות.

שלושתן **מחריגות במכוון את `rsvp_token` ואת `extras`**, וטסט ייעודי אוכף זאת (`src/lib/data/guests.test.ts:65-80`, describe "column secrecy"). הטוקן נגיש לבעלים רק דרך `getRsvpLinkInfo` (ראו "מחזור חיי הטוקן"), מאחורי אימות בעלות מפורש.

## ניהול מוזמנים (צד הבעלים)

כל פונקציות הנתונים ב‑`src/lib/data/guests.ts` פותחות ב‑`await requireOwnedEvent(eventId)` — שער בעלות שרת‑צד שמחזיר `notFound()` לאירוע שאינו בבעלות המשתמש. ה‑Server Actions ב‑`guests-actions.ts` מאמתים קלט עם Zod לפני הקריאה לשכבת הנתונים, ומחזירים `FormState` עם שגיאות בעברית.

### רשימה — עימוד/סינון/מיון בצד השרת (מאומת בקוד)

`listGuests` (`src/lib/data/guests.ts:167-288`) מבצעת הכול במסד הנתונים; רשימת המוזמנים המלאה לעולם אינה נטענת לדפדפן:

- **עימוד**: `range(offset, offset + pageSize - 1)` עם `count: 'exact'`; גודל עמוד ברירת מחדל 25 (`GUESTS_PAGE_SIZE`, `src/lib/constants.ts:12`, ניתן לכיוון ב‑env).
- **חיפוש**: `ilike` על `full_name`/`phone` דרך `buildSearchFilter` (שורות 138–143). מכיוון ש‑`.or()` של PostgREST מקבל מחרוזת פילטר גולמית, הפונקציה מסירה כל תו בעל משמעות תחבירית (`, ( ) * % "` ו‑backslash) לפני העטיפה ב‑`*…*` — מניעת הזרקת תנאים.
- **מיון**: מפתח המיון עובר דרך whitelist קשיח (`SORT_COLUMNS`, שורות 97–113: `name`/`status`/`contact`/`created`) — ערך שאינו ברשימה נופל לברירת המחדל (`created`), כי שם העמודה משורשר למחרוזת השאילתה (בשונה מ‑`.eq()` הפרמטרי); הכיוון מוגבל ל‑`asc`/`desc`. נוסף tiebreaker יציב על `id` כדי שעמודים לא "יערבבו" שורות שוות.
- **סינון**: ערכי `status`/`contactStatus` מאומתים מול ה‑enum המחולל (`Constants.public.Enums`) — ערך לא חוקי **מתעלמים ממנו** ואינו מגיע לשאילתה; `groupId` מסונן ב‑`.eq()` פרמטרי.
- **badges של הודעות (B6)**: מצב ה‑outreach (`op_status`, `removal_requested`) מגיע כ‑embed של ה‑contact המקושר, ו‑`delivery_status` האחרון פר‑contact נשלף בשאילתת batch אחת לכל העמוד (שורות 223–254) — ללא N+1. כשל בשליפת ה‑badges מדרדר לרשימה ללא badges במקום להפיל אותה.

העמוד `src/app/(customer)/app/events/[id]/guests/page.tsx` קורא את הפרמטרים מ‑`searchParams` ומעביר אותם כמות שהם — האימות כולו בשכבת הנתונים:

| פרמטר URL | משמעות |
|---|---|
| `page` | מספר עמוד (1‑based) |
| `search` | חיפוש בשם/טלפון |
| `sort` / `dir` | מפתח מיון (whitelist) וכיוון |
| `status` | סינון לפי `guest_status` |
| `contact` | סינון לפי `contact_status` |
| `group` | סינון לפי קבוצה |

### הוספה / עריכה / מחיקה

- `createGuestAction` / `updateGuestAction` (`guests-actions.ts:44-159`): אימות Zod (`createGuestSchema` / `updateGuestSchema`) → `createGuest` / `updateGuest`.
  - הסכימות **אינן כוללות** `id` / `event_id` / `rsvp_token`, כך שלא ניתן להבריח אותם מהדפדפן (`src/lib/validation/guests.ts:53-56`).
  - `event_id` נגזר תמיד משער הבעלות, לעולם לא מהקלט; `rsvp_token` נשאר ל‑DEFAULT של המסד (`guests.ts:328-377`).
  - העדכון (`guests.ts:384-433`) בנוי משדות allow‑list בלבד ותחום ב‑`event_id` + `id` גם יחד.
- `deleteGuest` (`guests.ts:436-480`) מוחקת בהיקף כפול (`event_id` + `id`) ואחר כך מריצה `pruneOrphanContact` כדי לא להשאיר contact יתום (שלמות מודל החיוב).
- `setContactStatusAction` (`guests-actions.ts:178-196`) — עדכון מהיר של `contact_status` מהרשימה; הערך מאומת מול ה‑enum לפני שכבת הנתונים.
- **קבוצות**: `createGroupAction` / `deleteGroupAction` בצד הפעולות; `listGroups` / `createGroup` / `updateGroup` / `deleteGroup` בשכבת הנתונים (`guests.ts:518-635`), כולן מאחורי `requireOwnedEvent`.
- **סנכרון contacts**: אחרי יצירה או עדכון‑טלפון נקרא `syncGuestContact` (`guests-actions.ts:94-112`) שמפעיל `linkGuestContact` — best‑effort במכוון: המוזמן כבר נכתב, וכשל בסנכרון נרשם ללוג **ללא טלפון** (מזהי event/guest בלבד) ואינו מכשיל את הפעולה; ה‑contacts מתיישבים בעדכון הבא או בבניית קמפיין.

### ייבוא CSV בכמות

זרימת הייבוא: `import-actions.ts` (`importGuestsAction`, שורות 72–241) → `parseCsv` → אימות פר‑שורה → `bulkInsertGuests` (`guests.ts:654-683`, הוספה ב‑statement יחיד).

**ה‑parser** (`src/lib/csv.ts`, `parseCsv`, שורות 29–105) — מימוש עצמאי ללא תלות חיצונית, בסמנטיקת RFC 4180 לתת‑הקבוצה הנתמכת:

- קלט UTF‑8; BOM מוביל מוסר (נפוץ בייצוא מאקסל ב‑Windows).
- שדות מופרדים בפסיק; שדה יכול להיות עטוף במרכאות כפולות.
- `""` בתוך שדה מצוטט = מרכאה literal; שדה מצוטט יכול להכיל פסיקים ושורות חדשות.
- מסיימי שורה CRLF או LF; CR בודד נבלע כחלק מהמסיים, לעולם לא כתוכן.
- שורת סיום עודפת בסוף הקובץ אינה יוצרת שורה ריקה מדומה; שורות ריקות באמצע נשמרות (והקורא מדלג עליהן).
- מוחזר grid גולמי של מחרוזות; מיפוי כותרות ואימות — באחריות הקורא. מכוסה ב‑`src/lib/csv.test.ts`.

**מיפוי עמודות** (`import-actions.ts:46-52`, `headerKey`) — שורת הכותרת ממופה לפי aliases בעברית ובאנגלית (case‑insensitive):

| עמודה | כותרות מזוהות | חובה |
|---|---|---|
| `full_name` | `name`, `full_name`, `שם`, `שם מלא` | כן |
| `phone` | `phone`, `mobile`, `טלפון`, `נייד`, `מספר` | לא |
| `group` | `group`, `קבוצה` | לא |

דוגמת קובץ תקין:

```csv
שם,טלפון,קבוצה
ישראל ישראלי,050-1234567,משפחה
"כהן, שרה",0521234567,חברים
```

**כללי עיבוד**:

1. מגבלות זולות‑קודם: גודל קובץ עד `CSV_MAX_BYTES` (ברירת מחדל 1,000,000 בייט, נבדק לפני הפענוח ושוב אחריו) ואז עד `CSV_MAX_ROWS` (ברירת מחדל 2,000) שורות נתונים (`src/lib/constants.ts:36-37`).
2. ללא עמודת שם — שגיאה מיידית; שורות ריקות לחלוטין מדולגות.
3. כל שורה מאומתת בנפרד ב‑`importRowSchema` (`validation/guests.ts:60-82`): שם 1–200 תווים, טלפון ריק או תואם `ISRAELI_PHONE_RE`, שם קבוצה עד 200 תווים.
4. **הצלחה חלקית**: שורות תקינות נטענות; שורות פסולות מדווחות אחת‑אחת בעברית עם מספר שורה (1‑based, ללא הכותרת).
5. **קבוצות לפי שם**: שליפה אחת של קבוצות האירוע (מפתח שם lowercase) + יצירה אחת לכל שם חדש באמת — ללא שאילתה פר שורה.
6. ההוספה עצמה — `insert` יחיד; מוחזרים `id` בלבד (בלי למשוך PII חזרה). `rsvp_token` נשאר ל‑DEFAULT של המסד — לכל מוזמן מיובא נוצר טוקן חדש אוטומטית.
7. לאחר הייבוא: `buildContactsForEvent` בונה/מרענן את טבלת ה‑contacts (best‑effort — אינו מכשיל ייבוא שהושלם; כשל נרשם ללוג ללא PII), ונרשמת פעולת `guests.imported` ב‑activity log עם ספירות בלבד (`importedCount`, `failedCount`, `newGroupCount`).

### נורמליזציית טלפון — שתי שכבות

1. **אימות קלט** (טפסים וייבוא): `ISRAELI_PHONE_RE` (`src/lib/constants.ts:32-33`) — regex סלחני לפורמט ישראלי: קידומת `+972` / `972` / `0`, ואז נייד `5x` / VoIP `7x` / קידומת גאוגרפית, ו‑7 ספרות מנוי עם מקפים/רווחים אופציונליים. הערך נשמר ב‑`guests.phone` **כפי שהוזן**.
2. **נורמליזציה קנונית** (מודל החיוב/outreach): `normalizePhone` (`src/lib/phone.ts:11-16`) — `libphonenumber-js` עם ברירת אזור `IL` (כך ש‑`05x-xxxxxxx` מקומי מנורמל ל‑`+972…`), מחזירה E.164 או `null` לערך לא‑חייגני (parser שאינו זורק). משמשת ב‑`src/lib/data/contacts.ts` (`deriveContacts` שורה 38, `linkGuestContact` שורה 124) לדה‑דופליקציה של contacts לפי `(event_id, normalized_phone)`.

כלומר: הייחוד וההתאמה בין ערוצים (כולל זיהוי שולח ב‑WhatsApp) נעשים על הצורה המנורמלת — לא על הקלט הגולמי שבעמודת `guests.phone`.

## RSVP ציבורי — `/r/[token]`

הנתיב: `src/app/(public)/r/[token]/` (עמוד: `page.tsx`, טופס: `rsvp-form.tsx`, פעולה: `actions.ts`). שכבת הנתונים: `src/lib/data/rsvp.ts`. ההקשחה המלאה: המיגרציה `supabase/migrations/202606290034_rsvp_harden.sql` (מסמך התכנון המלא בתוך המיגרציה עצמה).

### עקרון הליבה

קישור RSVP ציבורי מעניק גישה **לאורח אחד ולאירוע אחד בלבד**. שני נתיבי הגישה היחידים לנתוני אורח לפי טוקן הם שתי פונקציות SECURITY DEFINER במסד — `get_rsvp_by_token` (קריאה) ו‑`submit_rsvp` (כתיבה) — ש‑EXECUTE עליהן הוענק **אך ורק ל‑`service_role`** (המיגרציה, שורות 332–338). anon/authenticated אינם יכולים לקרוא להן ישירות, ומדיניות הקריאה הישירה של `event_questions` ל‑anon הוסרה (שורה 77) — כך שה‑rate limiter בצד Next אינו עקיף.

### זרימת קריאה (GET העמוד)

1. `dynamic = 'force-dynamic'` (`page.tsx:13`) — רינדור פר‑בקשה; בנוסף `next.config.ts:21-32` אוכף ל‑`/r/:token*` את הכותרות: `Cache-Control: no-store, max-age=0` (התגובה אישית — לעולם לא במטמון), `Referrer-Policy: no-referrer` (הטוקן שבנתיב לא ידלוף ב‑Referer), `X-Robots-Tag: noindex, nofollow` (בנוסף ל‑metadata `robots` של העמוד).
2. **Rate limit קריאה**: מפתח `rsvp:read:<token>:<ip>` עם `RSVP_READ_RATE` — 30 בקשות לדקה (`constants.ts:41`). ה‑IP נגזר מ‑`x-forwarded-for` (ערך ראשון) או `x-real-ip` (`getClientIp`, `rate-limit.ts:45-62`).
3. **בדיקת צורה זולה** לפני כל עבודת DB: `looksLikeToken` (`page.tsx:24-30`) — אורך 16–128 תווים ותווים `[A-Za-z0-9_-]` בלבד. המינימום (`RSVP_TOKEN_MIN_LENGTH = 16`) סלחני במכוון לטוקני legacy; הפורמט הקנוני הוא 32 תווי hex.
4. `getRsvpByToken` (`rsvp.ts:78-90`) → RPC `get_rsvp_by_token` דרך קליינט service‑role (`createAdminClient`).
5. ה‑RPC (המיגרציה, שורות 88–159) מחזיר `NULL` לכל אחד מהמקרים — טוקן לא קיים, טוקן מבוטל (`rsvp_token_revoked_at is not null`), או אירוע שאינו `active` — **בלי להבחין ביניהם** (אין אות enumeration). לטוקן תקף מוחזר jsonb עם:
   - `guest` — שם, `expected_count`, סטטוס נוכחי, ספירות מאושרות, תפריט, הערה, ותשובות קודמות **מסוננות לשאלות המופעלות כרגע** (prefill לא גורר מפתח שהושבת).
   - `event` — שם, סוג, תאריך, שם מקום וכתובת.
   - `questions` — השאלות המופעלות, ממוינות לפי `sort_order`.
   - `can_respond` — האם `rsvp_deadline` טרם חלף, בהשוואה מפורשת באזור זמן `Asia/Jerusalem` (סשן ה‑DB הוא UTC).
6. כשל מכל סוג ⇒ הודעה גנרית אחת בעברית: "קישור אישור ההגעה אינו תקף, פג תוקפו או בוטל" — ללא חשיפת הסיבה.

### מה האורח רואה ויכול לעדכן

הטופס (`rsvp-form.tsx`) מציג את שם האורח, שם האירוע, תאריך (מפורמט he‑IL) ומקום, ומאפשר:

- בחירת תשובה: מגיע/ה, אולי, לא מגיע/ה.
- ספירת מבוגרים + ילדים (steppers) — עם תקרה משולבת `expected_count`, או 50 כשאין מכסה (מקביל ל‑`COUNT_MAX` בסכימת ה‑Zod, כדי שה‑UI לא יציע ערך שהשרת ידחה).
- העדפת תפריט — עד 120 תווים, מוצגת רק כשנבחר "מגיע".
- הערה — עד 500 תווים.
- תשובות לשאלות האירוע — select כשיש `options`, אחרת טקסט חופשי עד 500; שדות חובה מסומנים.

כשעבר ה‑deadline (`can_respond=false`) מוצג העמוד עם הודעה, ללא טופס. האורח **אינו** רואה: טלפון, סטטוס יצירת קשר, קבוצה, או כל נתון של אורח אחר.

### זרימת שליחה (Server Action — לא REST)

**אין endpoint REST ייעודי ל‑RSVP תחת `src/app/api/`** (אומת בחיפוש על העץ) — השליחה ממומשת כ‑Server Action, `submitRsvpAction` (`actions.ts:38-85`), הקשור לטוקן מהנתיב כך שהדפדפן לעולם אינו שולח מזהה אורח. הסדר:

1. **Rate limit שליחה**: `rsvp:submit:<token>:<ip>` עם `RSVP_SUBMIT_RATE` — 5 לדקה (`constants.ts:42`), הדוק מהקריאה.
2. הרכבת תשובות השאלות משדות שטוחים בשם `answer_<q_key>` חזרה לאובייקט.
3. **Zod** — `rsvpSubmitSchema` (`validation/rsvp.ts:22-52`): enum סטטוס, ספירות שלמות 0–50, תפריט עד 120, הערה/תשובות עד 500, וכלל "מגיע ⇒ `adults+kids >= 1`". תקרת `expected_count` האמיתית נאכפת רק ב‑RPC — המקום היחיד שמכיר אותה — ובמכוון אינה משוכפלת.
4. `submitRsvp` (`rsvp.ts:98-130`) → RPC `submit_rsvp` (service‑role בלבד).

### אטומיות ואימות בתוך `submit_rsvp` (המיגרציה, שורות 169–323)

פונקציית plpgsql SECURITY DEFINER — טרנזקציה אחת שמבצעת את הכול:

| שלב | פעולה | קוד כשל |
|---|---|---|
| a | whitelist סטטוס (`attending`/`declined`/`maybe`) | `invalid_status` |
| b | איתור + **נעילת** שורת האורח לפי טוקן (`FOR UPDATE`); מבוטל ולא‑קיים זהים | `not_found` |
| c | שערי אירוע: `status='active'`; deadline באזור `Asia/Jerusalem` | `closed` / `deadline_passed` |
| d | נורמליזציה: `attending` ⇒ `1 ≤ adults+kids ≤ expected_count` (ללא תקרה כש‑NULL); `declined`/`maybe` ⇒ ספירות 0 ותפריט מנוקה | `invalid_count` |
| e | אימות תשובות מול `event_questions` בתוך ה‑DB: מפתח לא מוכר נדחה; חובה נאכף; טקסט ≤ 500; בחירה חייבת להיות ב‑`options` | `invalid_answers` / `missing_required` |
| f | **Idempotency**: payload מנורמל זהה לתשובה האחרונה ⇒ הצלחה עם `unchanged:true`, בלי שורה חדשה (בטוח ל‑double‑click ול‑retry; הנעילה בשלב b עושה את הבדיקה race‑safe) | — |
| g | הוספת שורת `rsvp_responses` (append‑only) | — |
| h | הקרנת last‑write‑wins על האורח: `status`, `confirmed_adults/kids`, `meal_pref`, `note`, `contact_status='responded'` | — |

קודי הכשל ממופים בחזרה להודעות עבריות בטוחות (`actions.ts:16-24`) — אקטואליות (deadline / אירוע סגור / ספירה) בלי לחשוף תקפות‑טוקן מעבר למה שהעמוד כבר הציג; `not_found` נשאר גנרי.

### הגנות abuse — מימוש ה‑rate limiter

`src/lib/security/rate-limit.ts` — fixed window ללא תלות חיצונית:

- מונה פר‑מפתח ב‑Map ברמת module; הבקשה הראשונה פותחת חלון (`windowMs`), הבאות מונות עד `limit`, ואז נחסמות עד ה‑reset.
- `pruneExpired` מנקה חלונות שפגו בכל קריאה — ה‑Map אינו גדל ללא גבול עם IPים חדשים.
- **מגבלה מתועדת בקוד עצמו** (שורות 1–8): המצב הוא **בזיכרון התהליך** — תחת pm2 cluster או ריבוי instances המגבלה האפקטיבית מוכפלת ומתאפסת ב‑restart. זהו קו הגנה ראשון בלבד; השדרוג הייעודי הוא store משותף (Postgres/Redis). ההגנה האמיתית היא הטוקן (128 ביט) + השערים בתוך ה‑RPCים, שאינם נגישים אלא דרך service‑role.

## מחזור חיי הטוקן

| שלב | מנגנון | מיקום |
|---|---|---|
| יצירה | DEFAULT של המסד: `encode(extensions.gen_random_bytes(16),'hex')` — **128 ביט, 32 תווי hex** (CSPRNG; הועלה מ‑96 ביט) | המיגרציה, שורות 62–70 |
| אחסון | ערך גלוי (לא hashed) בעמודת `guests.rsvp_token`, אינדקס ייחודי `guests_rsvp_token_key` | schema |
| חשיפה לבעלים | `getRsvpLinkInfo` בלבד, אחרי `requireOwnedEvent` | `rsvp.ts:185-202` |
| רוטציה | `regenerateRsvpToken` — `randomBytes(16).toString('hex')` (Node crypto, שקול לחוזק ה‑DEFAULT) + איפוס `rsvp_token_revoked_at`; הקישור הקודם מפסיק לעבוד מיידית | `rsvp.ts:226-243` |
| ביטול | `revokeRsvpToken` — `rsvp_token_revoked_at = now()`; שני ה‑RPCים מתייחסים לטוקן מבוטל כלא‑קיים | `rsvp.ts:205-219` |
| תפוגה | אין TTL פר‑טוקן; חסימה בפועל כשהאירוע אינו `active`, וחסימת טופס (העמוד עוד מוצג) כשה‑`rsvp_deadline` חלף | ה‑RPCים |

נקודות מפתח:

- קוד האפליקציה **לעולם אינו קובע טוקן ביצירת אורח** — `createGuest` / `bulkInsertGuests` משאירים אותו ל‑DEFAULT, כך שנקודת האמת לחוזק הטוקן אחת ויחידה.
- אי‑האחסון כ‑hash הוא בחירה מודעת (הטוקן הוא מפתח החיפוש של ה‑RPC); הפיצוי: החרגה מכל הקרנה owner‑facing (נאכפת בטסט), נעילת ה‑RPCים ל‑service_role, ואיסור רישום בלוגים.
- **UI לבעלים**: עמוד פרטי האורח (`.../guests/[guestId]/page.tsx:60`) בונה קישור מוחלט `await getAppUrl('/r/' + token)`. `getAppUrl` / `getAppOrigin` (`src/lib/url.ts:34-61`) מעדיפים את `APP_ORIGIN` המוגדר (יציב ולא בשליטת תוקף, בשונה מ‑Host header) עם fallback ל‑`x-forwarded-host`/`host` + `x-forwarded-proto` שה‑nginx מעביר; ההרכבה דרך WHATWG `new URL(input, base)` עם קריסת לוכסנים מובילים — כך ש‑path "מוחלט" אינו יכול להחליף את ה‑origin.
- הרכיב `rsvp-link.tsx` מציג/מעתיק את הקישור ומגיש את פעולות `revokeRsvpTokenAction` / `regenerateRsvpTokenAction` (`guests-actions.ts:242-272`), ששוב מאמתות בעלות בשכבת הנתונים.
- **פערי legacy**: המיגרציה מציינת (שורות 45–50) שטוקנים ישנים מתחת לתקן 32‑hex דורשים רוטציה יזומה בנתוני production (פעולה מאושרת‑בנפרד, לא חלק מהמיגרציה); לכן שומר‑הצורה בעמוד נשאר סלחני (מינימום 16 תווים).

## RSVP מכפתורי WhatsApp

מסמך הקונבנציה: `docs/whatsapp-rsvp-button-convention.md`. אומת מול הקוד — **תואם** (סטייה שמית קטנה מצוינת בסעיף האחרון).

### חוזה ה‑payloads

כפתורי ה‑quick‑reply בתבנית המאושרת ב‑WABA חייבים לשאת מזהים קבועים:

| כוונה | payload | `guests.status` |
|---|---|---|
| מגיע | `rsvp_attending` | `attending` |
| לא מגיע | `rsvp_declined` | `declined` |
| אולי | `rsvp_maybe` | `maybe` |

בקוד: `RSVP_BUTTON_MAP` — `src/lib/data/webhook-processing.ts:27-31`. כל reply‑id אחר הוא reach רגיל (חיוב) שאינו רושם RSVP.

### חילוץ המזהה

Meta מעבירה את מזהה הכפתור בשתי צורות: template quick‑reply ⇒ הודעת `type:"button"` עם `button.payload`; interactive reply ⇒ `interactive.button_reply.id` (או `list_reply.id`). `extractReplyId` (`src/lib/whatsapp/inbound.ts:79-84`) ממפה: `button.payload ?? button_reply.id ?? list_reply.id`; `classifyMessagePayload` מחזיר `{ billable, removal, replyId }`.

### צינור העיבוד (persist‑then‑process)

1. **Intake** — `src/app/api/webhooks/whatsapp/route.ts`: מאמת חתימת `X-Hub-Signature-256` בעזרת whatsapp-api-js (fail‑closed: 401 לחתימה לא תקפה; GET verification מול ה‑verify token מחזיר את ה‑challenge או 403), מנרמל את **כל** האירועים שבמשלוח (גם batched) ושומר ל‑`webhook_inbox` עם dedupe key — בלי שום לוגיקה עסקית, בלי לרשום את ה‑payload ללוג.
2. **Worker** — `worker/main.ts:112-120` (pg‑boss, מתוזמן כל דקה): מרוקן את ה‑inbox ומריץ `processWebhookEvent` לכל שורה, idempotent.
3. **רישום ה‑RSVP** — `webhook-processing.ts:139-163`:
   - reply‑id מזוהה + resolution לאירוע/contact (לפי `context.id` של ההודעה המצוטטת, עם fallback לטלפון השולח המנורמל).
   - שליפת האורחים שמאחורי ה‑contact: `getGuestsForContact` (`src/lib/data/interactions.ts:175-192`).
   - **רק כשיש בדיוק אורח אחד** נשלף `rsvp_token` שלו ונקרא `submitRsvp` — אותו RPC אטומי של הטופס הציבורי; שום כלל RSVP אינו משוכפל, וטוקן מבוטל/אירוע סגור נדחים באותם שערים.
   - `attending` נשלח עם מבוגר אחד (ה‑RPC דוחה 0) והאורח מדייק ספירות דרך הקישור; `declined`/`maybe` ללא ספירה (ה‑RPC מאפס).
   - טלפון משותף לכמה אורחים ⇒ **מדלגים** על רישום ה‑RSVP (לעולם לא מנחשים אורח); החיוב וה‑opt‑out ברמת contact ממשיכים לרוץ.
   - הכול gated על `fresh` (dedupe ב‑`UNIQUE(channel, provider_id)`) כך ש‑retry של Meta לא ירשום פעמיים. מכוסה ב‑`webhook-processing.test.ts` (describe ‏"RSVP from a quick-reply button (C9)").
4. בהצלחה נרשם marker נטול‑PII: `rsvp.from_whatsapp` (ראו audit להלן).

### מצב תלוי (pending)

הקוד מחובר קצה‑לקצה ונפרס; מה שנותר **תפעולי בצד Meta**, לא פריט קוד:

1. התבנית המאושרת ב‑WABA חייבת לשאת כפתורי quick‑reply עם ה‑payloads שבטבלה — `sendTemplate` שולח לפי שם תבנית בלבד, וה‑payloads מוגדרים בתבנית הרשומה אצל Meta.
2. מנוי ה‑webhook של אפליקציית Meta ל‑`messages` חייב להיות פעיל (ראו `docs/admin-webhooks-runbook.md`).

## פרטיות, לוגים ו‑audit

### מה נחשב PII

שמות מוזמנים, טלפונים, תשובות RSVP, העדפות תפריט, הערות, תשובות לשאלות מותאמות, והיסטוריית הודעות — כולם מידע אישי. `rsvp_token` הוא סוד bearer באותה רמת רגישות.

### מה נרשם ומה לא

- ה‑webhook וה‑worker מונחים במפורש לא לרשום payload / טלפון / סוד ללוג; כשלי סנכרון contacts נרשמים עם מזהי event/guest בלבד.
- הטוקן: אינו נרשם בלוגים, אינו מופיע בהקרנות owner (טסט אוכף), אינו דולף ב‑Referer (`no-referrer`), והעמוד אינו נאגר במטמון (`no-store`) ואינו מאונדקס (`noindex`).
- ייבוא CSV מדווח ספירות בלבד; ההוספה בכמות מחזירה `id` בלבד ולא מושכת PII חזרה.

### רשומות audit

| רשומה | תוכן | מיקום כתיבה |
|---|---|---|
| `rsvp_responses` | הרשומה האותוריטטיבית פר‑אורח: תשובה מלאה כולל ספירות ותשובות מותאמות; append‑only, נכתבת אטומית בתוך `submit_rsvp`; שליחה זהה אינה מוסיפה שורה | ה‑RPC |
| `activity_log` / `rsvp.submitted` | feed תפעולי best‑effort: `user_id=null`, meta = `guest_id` + סטטוס + `unchanged` — **לעולם לא שם, הערה או הטוקן**; כשל בה אינו מכשיל RSVP מוצלח | `recordRsvpAudit`, `rsvp.ts:142-170` |
| `activity_log` / `rsvp.from_whatsapp` | marker נטול‑PII ל‑RSVP שנקלט מכפתור: `guest_id` + סטטוס | `recordRsvpFromWhatsapp`, `interactions.ts:200-220` |
| `activity_log` / פעולות בעלים | `guest.created` / `guest.updated` / `guest.deleted` / `guest.contact_status_updated` / `guests.imported` / `group.*` — מזהים, סטטוסים ושמות‑שדות בלבד (לא ערכים) | `logActivity` דרך `guests.ts` / `import-actions.ts` |

הערת מימוש: בנתיב האנונימי `logActivity` הרגיל אינו בשימוש במכוון — הוא דורש `requireUser()` וקליינט RLS של session, שאינם קיימים שם; הכתיבה נעשית ישירות ב‑service‑role עם `user_id=null`. זהו הקשר שונה, לא כפילות.

## אי‑התאמות וממצאים

1. **`expected_count` בייבוא CSV אינו ממופה בפועל**: `importRowSchema` (`validation/guests.ts:81`) תומך ב‑`expected_count` ו‑`bulkInsertGuests` מוכן לקבלו, אבל `headerKey` (`import-actions.ts:46-52`) ממפה רק שם/טלפון/קבוצה — עמודת כמות בקובץ מתעלמים ממנה והשדה תמיד `null` בייבוא. פער בין יכולת הסכימה לזרימה בפועל.
2. **אין REST endpoint ל‑RSVP**: השליחה הציבורית היא Server Action בלבד; ה‑endpoint הציבורי היחיד הקשור לזרימה הוא webhook ה‑WhatsApp (חתום HMAC). מי שמחפש "rsvp route" תחת `src/app/api/` לא ימצא — זו התנהגות מכוונת, לא חוסר.
3. **הטוקן אינו מאוחסן כ‑hash** — בחירה מודעת (מפתח החיפוש של ה‑RPC), ממותנת כמתואר לעיל.
4. **ה‑rate limiter הוא in‑memory פר‑תהליך** — מגבלה מוכרת ומתועדת בקוד; אינו ההגנה היחידה.
5. **סטייה שמית בתיעוד הקונבנציה**: `docs/whatsapp-rsvp-button-convention.md` מזכיר `resolveGuestByContact`; בקוד הפונקציה נקראת `getGuestsForContact` (`interactions.ts:175`) ומחזירה את כל אורחי ה‑contact, כשכלל ה"בדיוק אחד" נאכף בצד הקורא. ההתנהגות המתוארת נכונה.
6. **שני משטרי טלפון**: אימות הטפסים/ייבוא הוא regex ישראלי בלבד (`ISRAELI_PHONE_RE`) בעוד שהנורמליזציה הקנונית (`normalizePhone`) מקבלת כל מספר בינלאומי חוקי בברירת אזור IL — מספר זר תקין ייחסם בטופס אף שהיה מנורמל תקין; בפועל האימות הצר הוא השער.
7. **רוטציית legacy tokens**: תוקן ה‑DEFAULT הועלה ל‑128 ביט, אך המיגרציה עצמה אינה מסובבת טוקנים קיימים שאינם `^[0-9a-f]{32}$` — פעולה תפעולית נפרדת ומאושרת‑בנפרד על נתוני production (מתועד במיגרציה, שורות 45–50).
