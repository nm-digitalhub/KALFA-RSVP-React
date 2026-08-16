# תוכנית מיגרציה: IONOS Hosted Exchange → Microsoft 365

**סטטוס: תכנון בלבד. לא בוצע שום שינוי בקוד, ב-DB, ב-DNS או בטננט.**
נכתב 15.08.2026.

### מוסכמת מקורות — שלוש רמות, לא שתיים

| תג | פירוש |
|---|---|
| **[נמדד]** | אימתתי בעצמי בסשן הזה — הרצתי פקודה, קראתי את הקובץ, או שלפתי את הדף |
| **[דווח]** | סוכן מחקר מדד וציטט מקור; **לא** אימתתי בעצמי |
| **[הסקה]** | מסקנה מנתונים, לא מדידה ישירה |

טענות שנשענו על **[דווח]** ונושאות משקל החלטתי — אימתתי בעצמי והן מסומנות
כעת **[נמדד]**. מה שנשאר **[דווח]** הוא מה שלא אימתתי, ומסומן ככזה במכוון
כדי שלא ייחשב לוודאי. §9 מרכז את מה שאיש לא אימת.

---

## 0. תמצית החלטה

1. **היעד הוא Microsoft Graph, לא "EWS עם OAuth".** EWS ב-Exchange Online מתחיל
   להיסגר באוקטובר 2026 ונסגר לגמרי באפריל 2027 **[נמדד, מקור ראשוני]**.
   מיגרציה של שכבת ה-EWS הקיימת ל-M365 היא מסלול שנגמר בתוך חודשיים.
2. **מודל האימות: app-only (client credentials), מוגבל דרך RBAC for
   Applications.** ההחלטה שלי, הנימוק ב-§3. אין OAuth callback, אין refresh
   tokens, אין סיסמאות משתמש ב-DB שלנו.
3. **אין תקלה פעילה.** המערכת עדיין עובדת מול IONOS ותמשיך לעבוד כל עוד חשבון
   ה-IONOS חי **[נמדד]**. יש לנו זמן לעבוד מסודר.
4. **הסיכון המיידי הוא דואר, לא יומן.** התוכן הועתק ל-M365 אבל ה-MX עדיין
   מצביע ל-IONOS **[נמדד]** — כלומר דואר שנכנס עכשיו נוחת רק בצד הישן ולא
   נמצא בצד החדש.
5. **שכבת הבידוד מחזיקה חלקית.** הספרייה כלואה כמו שתוכנן, אבל אין נקודת
   החלפה — שבע נקודות קריאה מייבאות את המימוש הקונקרטי ישירות **[נמדד]**.

---

## 1. מצב נמדד היום (15.08.2026)

### 1.1 הטננט
| פריט | ערך | מקור |
|---|---|---|
| Entra tenant | `11926da5-9d16-45e3-947b-27b2909ba6c5` | [נמדד] openid-configuration |
| סוג דומיין | `Managed`, מותג "KALFA RSVP" | [נמדד] getuserrealm |
| אימות דומיין | `MS=ms83510950` מפורסם | [נמדד] dig TXT |
| תיבה | הועברה עם כל התוכן ל-Exchange Online | הצהרת הבעלים |

> **זה מבטל מסקנה מתועדת קודמת.** הזיכרון `exchange-ews-workstream` קובע
> "OAuth: CLOSED, not deferred… No tenant on our side could ever issue a token…
> structurally unavailable." זה **לא נכון יותר**. יש לעדכן את קובץ הזיכרון
> כחלק מהעבודה הזו, אחרת סשן עתידי יסיק שוב את המסקנה השגויה.

### 1.2 DNS — מצב ביניים
| רשומה | ערך נוכחי | מסקנה |
|---|---|---|
| MX | `10 mx00.ionos.com`, `20 mx01.ionos.com` | **לא הועבר** — דואר נכנס הולך ל-IONOS |
| SPF | `v=spf1 mx include:_spf.perfora.net include:_spf.kundenserver.de ~all` | של IONOS בלבד |
| DMARC | `v=DMARC1; p=quarantine; adkim=r; aspf=r` | יישאר יציב במעבר |
| autodiscover | לא קיים | יידרש |
| DKIM selectors | לא קיימים | יידרשו |

**ספירת SPF lookups אחרי מיזוג** [נמדד]: `mx` + 3 includes = **4 מתוך 10**.
כל שלושת ה-includes שטוחים (ip4/ip6 בלבד, בלי קינון) — יש מרווח, אין חסם.

### 1.3 אימות מול M365
- `outlook.office365.com/EWS/Exchange.asmx` → `401` עם `WWW-Authenticate: Bearer`
  **בלבד** [נמדד]. אין NTLM, אין Basic.
- Basic Auth כבר כבוי לחלוטין ב-Exchange Online לכל הפרוטוקולים (EWS, EAS, POP,
  IMAP, RPS, OAB, Autodiscover) ולא ניתן להפעלה מחדש **אפילו על ידי תמיכת
  מיקרוסופט** [נמדד, learn.microsoft.com, עודכן 16.07.2026].
- **מסקנה: סיסמת המשתמש חסרת ערך לקוד השרת שלנו.** לא תיכנס ל-DB ולא לקוד.

### 1.4 המערכת שלנו — עדיין חיה
- `console_agent_calendar_presence`: `synced_at` טרי, `last_error_code` = NULL.
- קראתי את `src/lib/data/console-agent-calendar-presence.ts`: `synced_at` נכתב
  גם בכישלון, אבל `last_error_code` מתאפס ל-`null` **רק** במסלול ההצלחה
  (שורה 164). לכן זו הוכחה אמיתית שקריאת EWS מול IONOS הצליחה, לא רק
  שה-cron רץ **[נמדד]**.
- נפח נתונים: `exchange_connections` = 1 (verified), `exchange_calendar_links`
  = 1, `exchange_availability_blocks` = 1, `console_agent_calendar_presence` = 1
  **[נמדד]**. המיגרציה קטנה מבחינת דאטה — הכובד הוא בקוד.

> **⚠️ `exchange_connections.status` הוא לא אינדיקטור בריאות** [נמדד —
> אימתתי בעצמי, כי הדיווח שקיבלתי היה גורף מדי]. העמודה נכתבת בארבעה מקומות:
> `'pending'` ביצירה (שורות 199, 226), `'revoked'` בביטול (414), ו-
> `'verified'`/`'failed'` דרך `recordConnectionResult()` (306). **הדיוק
> החשוב:** `recordConnectionResult()` נקרא **רק** מ-`testMyExchangeConnection()`
> (שורות 329, 335) — כלומר רק מלחיצה ידנית על "בדיקת חיבור". אף מסלול
> לא-מפוקח (סנכרון אירועים, תזמון שיחות חוזרות, ה-cron) לא מעביר אותה
> ל-`failed`. **תיבה מתה תמשיך להציג `status='verified'` לנצח.** לכן
> `/admin/debug`, `getMyActiveExchangeConnection()` ושער הרינדור של
> `/admin/calendar` **אינם ראיה** למצב חי. הסימן היחיד שמתרענן מעצמו בכל טיק
> הוא `console_agent_calendar_presence.last_error_code` — וזה בדיוק הסימן
> שמדדתי לעיל, ולא במקרה.

**התיבה ב-IONOS עדיין קיימת ופעילה.** התוכן **הועתק** ל-M365, לא הועבר —
נקודת הקצה של IONOS עדיין עונה ב-NTLM והקריאה האחרונה הצליחה [נמדד]. כלומר
שתי תיבות חיות במקביל: הישנה עדיין משרתת את היומן ואת הדואר הנכנס, החדשה
מחזיקה עותק. הקידוד הקשיח בקוד (`exchange.ionos.com`, `Exchange2016`, NTLM)
עדיין נכון **לתיבה הישנה** — הוא לא נשבר, הוא פשוט מצביע למקום שאנחנו עוזבים.
- סביבת ריצה: כל תהליכי pm2 על **Node 24.19.0** [נמדד] — עובר את הרף של
  `@azure/identity` (`>=20`). לא חסם.

### 1.5 שכבת הבידוד — מה באמת הובטח ומה באמת קיים
**מה מחזיק** [נמדד]: `ews-javascript-api` / `@ewsjs/xhr` מיובאות **רק**
ב-`ews-impl.ts`. אף מודול אחר לא נוגע בספרייה. זה הישג אמיתי.

**מה לא מחזיק** [נמדד]: אין נקודת החלפה. שבע נקודות מייבאות את הסינגלטון
הקונקרטי `import { ewsProvider } from '@/lib/exchange-ews/ews-impl'`:

| קובץ | סוג |
|---|---|
| `src/lib/data/exchange-connections.ts:16` | ייצור |
| `src/lib/data/exchange-availability.ts:10` | ייצור |
| `src/lib/data/event-exchange-sync.ts:33` | ייצור |
| `src/lib/data/callback-scheduling.ts:36` | ייצור |
| `src/lib/data/console-agent-calendar-presence.ts:5` | ייצור |
| `src/lib/data/event-exchange-sync.test.ts:22` | טסט |
| `src/lib/data/callback-scheduling.test.ts:29` | טסט |

מול זה, **מודול אחד בלבד** מייבא מ-`provider.ts` (הממשק).
המשמעות: אין נקודת הזרקה — צריך להוסיף מודול בורר ולנתב את שבע הקריאות דרכו.
זה שלב עבודה אמיתי, אבל **זול**, כי הבעיה היא רק *ממי מייבאים*, לא *מה עובר*.

**הממשק עצמו תקין ואינו דורש שינוי מבני.** בדיקה קובץ-אחר-קובץ מראה שכל מה
שחוצה את `provider.ts` הוא נתון פשוט ולא טיפוס של EWS: מזהי פגישות הם
מחרוזות אטומות (גם בשכבת ה-Zod — `z.string().max(1024)`, בלי regex בצורת EWS,
כך שמזהה Graph יעבור כמו שהוא); `seriesLinked` הוא בוליאני נגזר; `showAs` הוא
אוצר מילים משלנו שמתורגם בתוך `ews-impl.ts`. `graph-impl.ts` יכול לממש את
`ExchangeCalendarProvider` כמות שהוא.

**שני חריגים שדורשים שינוי מתואם, לא רק TypeScript:**

1. **`ExchangeErrorCode` נעול ב-DB.** חמשת הקודים
   (`auth_failed`/`unreachable`/`not_found`/`recurring_locked`/`provider_error`)
   מוגבלים ב-**CHECK constraint** על `console_agent_calendar_presence`
   (מיגרציה `20260812181059`), ומעליהם יושבות הודעות שגיאה בעברית והסתעפות
   לוגית בתזמון שיחות חוזרות. `graph-impl.ts` חייב למפות את שגיאות Graph
   (סטטוס HTTP + `error.code` ב-JSON) לאותם חמישה ערכים בדיוק — או שנדרשת
   מיגרציה מתואמת.
2. **מערכת הקטגוריות היא Outlook-ית מהיסוד.** `category-colors.ts` ממפה
   אינדקס `OlCategoryColor` לצבע, ומיובא **ישירות לצרור הלקוח**
   (`event-edit-dialog.tsx`, `event-form-fields.tsx`). זה לא rename.

---

## 2. לוח הזמנים שקובע את הסדר

**[נמדד, מקור ראשוני:** `learn.microsoft.com/.../deprecation-of-ews-exchange-online`,
עודכן 29.06.2026, סעיף "EWS deprecation timeline"**]**

| תאריך | מה קורה |
|---|---|
| יולי 2018 | הוכרז שאין יותר פיתוח ל-EWS |
| 2023 | נקבע תאריך סגירה: 10/2026 |
| ינואר 2024 | תקרית Midnight Blizzard — הורחב מיישומי צד ג' לכל היישומים כולל של מיקרוסופט עצמה |
| **אוקטובר 2026** | "EWS starts to be disabled globally for all organizations" |
| **אפריל 2027** | "EWS is fully disabled" |

- **חל על Exchange Online בלבד.** ב-Exchange מקומי (IONOS) EWS ממשיך לעבוד —
  ולכן האינטגרציה הנוכחית לא תישבר מעצמה כל עוד חשבון IONOS חי.
- קיים מנגנון allowlist ברמת טננט (`EWSAllowedAppIDs` + `EWSEnabled`) שמאפשר
  להאריך את EWS מעבר לאוקטובר. **[הסקה חלשה — מקור משני בלבד;** גוף הפוסט
  ב-techcommunity לא נגיש ל-fetch**]**. **לא רלוונטי לנו**: אנחנו לא רוצים
  EWS על הטננט החדש בכלל.
- מיקרוסופט מפרסמת טבלת מיפוי רשמית EWS→Graph (`aka.ms/ews2graphMap`),
  **אבל אל תסתמכו עליה ליומן** [דווח, אחרי בדיקה חוזרת של הדף]: אין בה
  סעיף CRUD לאירועי יומן כלל — `CreateItem`/`UpdateItem`/`DeleteItem`
  ממופים רק תחת "Mail APIs > Messages", וכותרת "Calendar APIs" מכסה רק
  זמינות/תזכורות/הרשאות/הזמנות. **המקור הנכון ל-CRUD הוא דפי ה-reference
  הייעודיים** (`event`, `event-update`, `event-delete`, `user-post-events`,
  `calendar-list-calendarview`). כלי `aka.ms/ewsTools` **לא רלוונטי לנו** —
  זהו Roslyn analyzer ל-.NET/C# בלבד, לא נוגע ב-TypeScript.

**"אז למה לא פשוט להוסיף OAuth ל-EWS הקיים?"** — שאלה סבירה, והתשובה היא לא.
מבחינה טכנית זה **אפשרי**: הספרייה המותקנת אצלנו כבר כוללת
`OAuthCredentials` [נמדד — הקובץ קיים ב-`node_modules/ews-javascript-api/js/
Credentials/`], ונקודת הקצה של M365 חיה ומעבדת Bearer. אבל זה קונה אפס:
כדי להשיג את הטוקן צריך **בדיוק אותו** רישום Entra, אותו `@azure/identity`
ואותה הגבלת הרשאות ש-Graph דורש — כלומר משלמים את מלוא עלות המעבר, נשארים
עם כל מטען ה-EWS (ספרייה נטושה, מחלקת הבאגים של ה-XML, עקיפת הזמינות),
**ועדיין** צריך להירשם ב-`EWSAllowedAppIDs` כדי לשרוד את אוקטובר. ערך נטו
שלילי.

**פערי parity שנותרו ב-Graph** (מהדף הרשמי): ייבוא/ייצוא תיבות ותיקיות
ציבוריות, In-place Archive, **delta לאירועים חוזרים**, Sticky Notes,
user configuration, admin APIs. מתוך אלה, היחיד שנוגע לנו הוא delta לאירועים
חוזרים — ורק אם נרצה בעתיד להחליף polling ב-delta. **אנחנו רק מזהים** פריט
סדרתי כדי לחסום עריכה, לא עושים לו delta. **אין פער parity שחוסם אותנו.**

---

## 3. החלטת ארכיטקטורה: מודל אימות

ביקשת שאחליט. **ההחלטה: app-only (client credentials grant), עם היקף מוגבל
דרך Exchange Online RBAC for Applications.**

### הנימוק
1. **ה-cron לא יכול אחרת.** הסנכרון כל 10 דקות רץ בתהליך worker בלי סשן
   משתמש ובלי cookies (המודול מוגדר במפורש "REQUEST-FREE by design"). במודל
   delegated נצטרך ממילא מסלול app-only שני במקביל — כלומר delegated לעולם לא
   יכול להיות המודל היחיד.
2. **זה פיצ'ר ניהולי, לא פיצ'ר לקוח.** קיימת החלטה מפורשת שלך מ-27.07:
   "לא אמור להיות גישה ללקוחות, זה פיצ'ר ניהול לעסק". app-only תואם את זה
   ישירות.
3. **זה פותר את פער ההרשאות שסומן ולא טופל.** חיבור תיבה מוגן היום ב-
   `manage_settings`, שיש רק ל-`owner` ו-`ops_engineer`. נציגי מוקד
   (`support_agent`) לא יכולים לחבר תיבה בעצמם. ב-app-only מוסיפים את התיבה
   שלהם ל-management scope — בלי להעניק להם `manage_settings` ובלי מסך הסכמה.
4. **פחות סודות רגישים אצלנו.** במקום סיסמת תיבה מוצפנת לכל משתמש — סוד
   אפליקציה אחד. פחות משטח, פחות רוטציה, פחות מה לאבד.

### מה זה אומר בפועל
- הרשאות אפליקציה: `Calendars.ReadWrite` (יומן) + `MailboxSettings.Read`
  (רשימת הקטגוריות) + `Mail.Send` (רק אם עוברים לשליחת דואר דרך Graph, §4.2).
- ההיקף נאכף בצד Exchange דרך `New-ServicePrincipal` → `New-ManagementScope`
  → `New-ManagementRoleAssignment -CustomResourceScope`, כך שהאפליקציה נוגעת
  **רק** בתיבות שהוגדרו. לא גישה לכל הטננט.
- אימות יבש לפני שנוגעים בקוד: `Test-ServicePrincipalAuthorization`.
- **לא לבקש `User.Read.All`.** היא נדרשת רק ל-`translateExchangeIds`, שלא
  עוזר לנו (§6.1), ואי אפשר להגביל אותה ל-resource scope — כלומר הענקה
  רחבה בתמורה לאפס תועלת.
- **סוד מול תעודה: ✅ הוכרע — תעודה** (15.08.2026, הבעלים). הצעתי במקור
  להתחיל ב-client secret ולהשאיר תעודה כהקשחה; הבעלים בחר ישר בתעודה, וזו
  הבחירה הנכונה: המפתח הפרטי נשאר על השרת ולא עובר בשום ערוץ, בעוד שסוד
  חייב לעבור לפחות פעם אחת מהפורטל אל ה-env. פרטי התעודה ב-§7א שלב 2.

### שינוי ארכיטקטוני שנובע מכך
`buildService()` הנוכחי בונה חיבור **טרי בכל קריאה** ("short-lived — built
fresh per call, never cached"). ב-Graph זה **שגוי**: `ClientSecretCredential`
מטמין ומרענן טוקנים per instance, ובנייה מחדש בכל קריאה מבטלת את המטמון.
המימוש החדש חייב להחזיק credential אחד ברמת מודול.

### סטטוס לא סגור
RBAC for Applications — לא הצלחנו לאשש חד-משמעית GA מול preview. המנגנון הישן
(`Application Access Policies`) עדיין עובד ומתועד כ-"legacy" אבל **לא** מוכרז
כמיושן. **הנחיה: לבחור מנגנון אחד ולא לערבב** — ההרשאות משני המנגנונים
מצטברות (union) ויכולות לייצר גישה רחבה יותר ממה שהתכוונו.

---

## 4. ארבעת המשטחים

### 4.1 יומן — EWS → Graph (הליבה)
היקף: `src/lib/exchange-ews/*` (~1,670 שורות) + 5 מודולי DAL + מסך
`/admin/calendar` + cron.

**מה שורד:** `types.ts` (הממשק), `provider.ts`, כל שכבת ה-DAL, מסך היומן,
`event-exchange-calendar-item.ts` (בוני התוכן), רוב הטסטים.

**מה מת:**
- `xml-safe.ts` — Graph הוא JSON. השארתו תגרום ל**escaping כפול**.
  ⚠️ **תיקון לגרסה קודמת של המסמך הזה:** כתבתי "חמישה מקומות" והנחתי שהגוף
  פטור. **שתי הטענות שגויות** [נמדד — קריאת `ews-impl.ts`]. הספירה הנכונה:
  **6 סוגי שדות, 10 שורות, 11 קריאות בפועל** [נמדד — גזרתי בעצמי, לא
  העתקתי]: subject (730, 800) · **body (740, 806)** · location (752, 801) ·
  category (751, 825) · attendee name+email (**530 — שתי קריאות באותה
  שורה**) · attendee email (531).
  **הגוף עובר escaping בדיוק כמו כל השאר**, ולכן חשוף לאותה סכנת escaping
  כפול — הטענה הקודמת שלי ש"הגוף ייראה תקין" הייתה שגויה.
  ⚠️ שורה 530 היא המלכודת ל-find-and-replace: מי שסופר שורות ולא קריאות
  יפספס אחת.
- `category-list.ts` — מפרסר base64/XML ידני. Graph מחזיר
  `GET /users/{id}/outlook/masterCategories` כ-JSON נקי. הפרסר כולו הופך למת.
- ה-hack של `ExchangeVersion.Exchange2016`, כל שכבת NTLM/`decompress`,
  ה-allowlist הקשיח של `exchange.ionos.com`, ורשומות `serverExternalPackages`.
- העקיפה של `getAvailability` — `POST /users/{id}/calendar/getSchedule` עובד
  ב-Exchange Online ומחזיר free/busy אמיתי. **זה מבטל את הקביעה המתועדת
  "AVAILABILITY SERVICE UNAVAILABLE — do not re-litigate"**, שהייתה נכונה
  ל-IONOS בלבד.

**מיפוי (עיקרי):**

| פעולה | Graph |
|---|---|
| בדיקת חיבור | `GET /users/{id}/calendar` |
| רשימת יומנים | `GET /users/{id}/calendars` (+ calendarGroups) |
| קריאת פגישות בחלון | `GET /users/{id}/calendar/calendarView?startDateTime=…` |
| יצירה | `POST /users/{id}/events` |
| עדכון | `PATCH /users/{id}/events/{id}` |
| מחיקה | `DELETE /users/{id}/events/{id}` |
| זמינות | `POST /users/{id}/calendar/getSchedule` |
| קטגוריות מערכת | `GET /users/{id}/outlook/masterCategories` |

**מה שנעשה פשוט יותר:** `showAs`, `sensitivity`, `categories`,
`reminderMinutesBeforeStart`/`isReminderOn` — כולם 1:1. זיהוי סדרה הופך
ל-`item.type !== 'singleInstance'` במקום בדיקה כפולה של
`AppointmentType`+`IsRecurring`. הבאג של `StringList.Items` שנפל פעם — נעלם,
כי JSON הוא מערך רגיל.

**שתי נקודות שדורשות עבודת תכן אמיתית, לא המרה מכנית:**

1. **אזורי זמן.** ב-EWS העברנו `Date` (רגע בזמן). ב-Graph `start`/`end` הם
   אובייקט `{ dateTime, timeZone }` — **שעון קיר + אזור מפורש**. הקצה החד הוא
   אירועי יום-שלם: Graph דורש חצות באותו אזור זמן. שליחת חצות UTC לאירוע
   שאמור להיקרא כיום שלם בישראל תציג אותו **ביום הלא נכון**. חייבים להעביר
   `Asia/Jerusalem` מפורשות בכל כתיבה.
2. **התראות למוזמנים.** זה בדיוק סוג הבאג שכבר שילמנו עליו פעם
   (עדכון גרירה שלח `SendToNone` לפגישה עם מוזמנים אמיתיים). התיעוד של Graph
   מפורש לגבי **יצירה** ("invitations sent, can't be configured" — תואם
   בדיוק להתנהגות הקוד המתוקן שלנו) ולגבי **מחיקה** ("deleting sends a
   cancellation to attendees"), אבל **שותק** לגבי PATCH שמשנה רק שעה בלי לגעת
   ברשימת המוזמנים.

   **הערת מקורות חשובה:** גם קביעת ה"תאימות המלאה" ליצירה ולמחיקה היא
   **[דווח]** — ציטוט של סוכן מחקר שלא אימתתי מול הדף בעצמי. מכיוון שזו בדיוק
   מחלקת הבאג שכבר עלתה לנו, **לא אסתמך על אף אחד משלושת הפעלים ללא מדידה**:
   שער S4 מכסה יצירה, עדכון ומחיקה יחד, באותה בדיקה של שתי תיבות — בדיוק
   כמו שנעשה ב-31.07. עלות זהה, ודאות שלושה מונים גבוהה יותר.

**שיפור שכדאי מיום ראשון:** לשלוח `Prefer: IdType="ImmutableId"` בכל כתיבה.
מזהה ברירת המחדל של Graph **משתנה** כשפריט עובר תיקייה — ו-
`exchange_calendar_links` מניח שהמזהה השמור נשאר תקף. זול עכשיו, יקר בדיעבד.

### 4.1א אילו חבילות להתקין — כולל ממצא שהופך את התשובה האינטואיטיבית

כל הנתונים **[נמדד]** מול ה-registry החי (`npm view`) ו-`api.npmjs.org`,
15.08.2026:

| חבילה | גרסה יציבה | **תאריך פרסום של הגרסה עצמה** | גודל פרוס | הורדות/שבוע |
|---|---|---|---|---|
| `@microsoft/microsoft-graph-client` | 3.0.7 | **19.09.2023** | 1.25 MB | 2,124,843 |
| `@microsoft/msgraph-sdk` (Kiota) | **אין** — `1.0.0-preview.88` | 05.08.2026 | 23.9 MB | 53,089 |
| `@microsoft/msgraph-sdk-users` | **אין** — preview.88 | 05.08.2026 | 9.5 MB | — |
| `@microsoft/microsoft-graph-types` | 2.43.1 | 03.10.2025 | טיפוסים בלבד | — |
| `@azure/identity` | 4.13.1 | 20.03.2026 | — | 14,492,426 |
| `@azure/msal-node` | 5.5.0 | 04.08.2026 | — | — |

כל תאריך בטבלה נשלף **פר-גרסה** (`npm view <pkg>@<version> time`), לא משדה
`modified` הכללי — השדה הזה הוא מטא-דאטה של ה-registry ומראה 2026-07-16 גם
לחבילה שלא שוחררה מ-2023. מדדתי אותו קודם בטעות ותיקנתי.

**הממצא המטריד:** ל-`@microsoft/microsoft-graph-client` — ה-SDK ה"יציב"
והרשמי — **אין שחרור יציב מאז ספטמבר 2023**. זה **ישן יותר** מהספרייה שאנחנו
מחליפים (`ews-javascript-api`, אחרון 05.2024), שאחת הסיבות המרכזיות להחלפתה
הייתה "maintenance rot".

**ומצב ה-repo גרוע יותר ממה שהמספר לבדו מראה** [נמדד — GitHub API]:
ה-repo **אינו** נטוש (832 כוכבים, לא בארכיון), והקומיט האחרון — 16.06.2026 —
הוא דווקא **תיקון אבטחה**: `"fix: prevent token leak via URL userinfo host
confusion (#2000)"`. אבל שחרור ה-GitHub האחרון הוא **3.0.7 מ-19.09.2023**.

כלומר: **תיקון האבטחה יושב ב-repo ולא שוחרר ל-npm.** מי שמתקין את החבילה
היום מקבל ארטיפקט שחסר תיקון שקיים בקוד המקור שלה. אין GHSA/CVE מפורסם
[נמדד] — זו הקשחה, לא פרצה מנוצלת ידועה — אבל זה מלמד שקצב השחרור שבור,
לא רק איטי.

**למה לא ה-SDK ה"מתקדם יותר" (Kiota):** `@microsoft/msgraph-sdk` הוא אכן הדור
הבא — API שוטף, טיפוסים מלאים, שחרורים כל 1–3 שבועות ברציפות. הפוסל היחיד
שצריך: **הוא ב-preview מאז ינואר 2024 — שנתיים וחצי, 88 גרסאות preview, בלי
1.0 אחת.** להכניס preview לייצור, בפרויקט שכבר נכווה מספרייה לא בשלה, זו אותה
טעות בבגדים חדשים. שני נימוקים משניים: פי 40 פחות אימוץ, ו-23.9 MB פרוסים —
**זה גודל החבילה, לא גודל הצרור** (Kiota נועד ל-tree-shaking, ונתיב יחיד לא
ישלח 24MB), אבל זה עדיין נטל התקנה ו-build אמיתי. **לשקול מחדש ב-1.0 יציב.**

### מה מיקרוסופט עצמה אומרת — הבדיקה שהכריעה
[נמדד — `learn.microsoft.com/en-us/graph/sdks/sdks-overview`, עודכן 06.08.2025].
שלושה ציטוטים, כל אחד מהם משנה משהו:

1. תחת "Supported languages", ה-SDK הרשמי ל-TypeScript/JavaScript הוא
   `microsoftgraph/msgraph-sdk-javascript` — כלומר **`@microsoft/microsoft-graph-client`
   הוא הרשמי**, ולא ה-Kiota. (ל-repo של Kiota יש 44 כוכבים מול 832 [נמדד].)
2. > "**don't use a preview release of an SDK in production apps**, regardless
   > of the version of Microsoft Graph API (v1.0 or beta) it uses."

   זו הוראה מפורשת של מיקרוסופט. היא **פוסלת את ה-SDK ה"מתקדם"** — לא
   השיקול שלי, שלהם.
3. > "Microsoft CSS doesn't officially support SDKs but **Microsoft supports
   > the HTTP request of the Microsoft Graph API call you're making**."

   כלומר מה שנתמך רשמית הוא ה-API עצמו. ה-SDK הוא נוחות, לא ערוץ תמיכה.
   באותו דף מיקרוסופט גם מברכת במפורש על לקוח מצומצם כשמשתמשים רק בתת-קבוצה
   קטנה של ה-API — וזה בדיוק אנחנו.

### ההחלטה — שונתה בעקבות הבדיקה הזו
דרישתך הייתה "רשמיות ועדכניות". שילוב שעומד **בשתיהן** הוא לא ה-SDK של היומן
— זה `@azure/identity` בתוספת לקוח דק משלנו מול ה-API הנתמך:

```
# להתקין (prod)
@azure/identity                     ^4.13.1   ← GA, 20.03.2026, 14.5M/שבוע
                                                זה החלק שנושא משקל אבטחתי

# להתקין (dev — טיפוסים בלבד, אפס קוד ריצה)
@microsoft/microsoft-graph-types    ^2.43.1   ← רשמי, 03.10.2025

# לא להתקין
@microsoft/msgraph-sdk*             — preview; מיקרוסופט אוסרת בייצור
@microsoft/microsoft-graph-client   — הארטיפקט ב-npm מ-2023 וחסר תיקון
                                      אבטחה שקיים בקוד המקור שלו
@azure/msal-node                    — @azure/identity עוטף אותו
@microsoft/microsoft-graph-toolkit  — קומפוננטות UI לדפדפן

# להסיר בסוף (S8)
ews-javascript-api (+ @ewsjs/xhr)
nodemailer + @types/nodemailer — רק אם הדואר עובר ל-Graph sendMail
```

**כל חבילה שמותקנת היא GA ועדכנית.** אין preview, ואין ארטיפקט בן שלוש שנים.

**מה אנחנו כן צריכים לכתוב בעצמנו** (זה המחיר, והוא מוגבל): טיפול ב-429 עם
`Retry-After` ו-backoff, ועימוד (`@odata.nextLink`). שניהם קצרים ומוכרים —
ומיפוי השגיאות היינו כותבים ממילא, כי חמשת קודי `ExchangeErrorCode` נעולים
ב-CHECK constraint (§1.5) ואף SDK לא היה מייצר אותם עבורנו.

**מה שנשאר ב-SDK ולא נצטרך:** batching, העלאת קבצים גדולים, ו-`PageIterator`.
אין לנו שימוש באף אחד מהם בהיקף הזה.

### ✅ הבעלים הכריע (15.08.2026): מסלול ה-SDK הרשמי
הבעלים הריץ `npm install @microsoft/microsoft-graph-client@^3.0.7`. זו
ההחלטה, והיא **הנכונה** — אין חבילה מומלצת יותר, וזו הרשמית.

**מה בדיוק חסר בארטיפקט, ולמה זה כמעט לא נוגע לנו** [נמדד — קראתי את PR
#2000, מוזג 16.06.2026, 5 קבצים]: הפונקציה `isValidEndpoint` חילצה את שם
המארח ביד עם `indexOf(":")`. אפשר היה להטעות אותה עם URL מסוג
`https://graph.microsoft.com@evil.com/` — טריק ה-userinfo — וכך לגרום ל-SDK
**לצרף את טוקן הגישה לבקשה שהולכת לשרת זר**. התיקון מחליף את החילוץ הידני
ב-`new URL()`, פוסל כל URL עם userinfo, ופוסל non-HTTPS.

**התנאי להתקפה: שיגיע ל-`client.api()` URL מלא בשליטת תוקף.** אצלנו נעביר
נתיבים (`/users/…/events`) על בסיס קבוע, ומזהים מה-DB שלנו — לא URL-ים
מבחוץ. **החשיפה המעשית אפסית.**

**⚠️ אימתתי את הפער על הקוד המותקן אצלנו — הוא נוכח, לא תיאורטי** [נמדד]:
```js
client.api('https://graph.microsoft.com@evil.example/v1.0/me')  // → מתקבל, לא נזרקת שגיאה
```
זו בדיוק הבדיקה שה-PR הוסיף ("throws if userinfo is present"). **הסתייגות
שאסור לטשטש:** זה מוכיח שאין פסילה בכניסה — זה **לא** מוכיח שטוקן היה
דולף בפועל (לכך נדרשת בקשה חיה, ולא אריץ כזו). אבל זה מוריד את שני הכללים
שלמטה מ"זהירות סבירה" ל"הגנה נדרשת".

**שני כללי קוד שהופכים את זה לוודאי, לא להערכה:**
1. **לעולם לא להעביר URL מוחלט ל-`.api()`** — רק נתיבים יחסיים. לאכוף בבדיקת
   קוד; זו שורה אחת בהנחיות המימוש.
2. **החריג היחיד הוא עימוד:** `@odata.nextLink` הוא URL מוחלט שמגיע בתשובה
   מ-Graph. לפני שעוקבים אחריו — **לאמת בעצמנו שה-hostname הוא
   `graph.microsoft.com`**. זו בדיוק ההגנה שהתיקון החסר היה נותן.

**מעקב:** לבדוק שחרור חדש לפני S5; לשדרג ברגע ש-3.0.8 יוצא.

**מה שנבדק בפועל אחרי ההתקנה — כל הסימני שאלה של §9 בנושא הזה נסגרו** [נמדד]:

| בדיקה | תוצאה |
|---|---|
| גרסה מותקנת | 3.0.7 מדויק |
| הייבוא העמוק `/authProviders/azureTokenCredentials` | **נפתר** — `TokenCredentialAuthenticationProvider` מיוצא |
| `import.meta` בחבילה (סיכון esbuild→CJS ב-worker) | **אין** — הסיכון סגור לחבילה הזו |
| peerDependencies | **אין** — ו-`legacy-peer-deps=false` כאן, כך שההתקנה כן מעידה על תאימות |
| מעורבות ב-`npm audit` | **אפס** — עשר האזהרות כולן קיימות מקודם (voximplant/axios/form-data, ו-`ews-javascript-api` עצמה) |
| עלות תלויות | **חבילה אחת** נוספה — `tslib`/`@babel/runtime` כבר היו |

הערה: `ews-javascript-api` **עצמה** מופיעה ברשימת החבילות הפגיעות (moderate,
דרך `@azure/msal-node`→`uuid`). הסרתה ב-S8 מקטינה את משטח ה-audit.

**✅ כל השלוש מותקנות (15.08.2026) ועברו בדיקת חיווט** [נמדד]:
`@microsoft/microsoft-graph-client@3.0.7`, `@azure/identity@4.13.1`,
`@microsoft/microsoft-graph-types@2.43.1` (dev).

| בדיקה אחרי ההתקנה | תוצאה |
|---|---|
| `import.meta` ב-build ה-CJS של `@azure/identity` | **0 התאמות ב-77 קבצים** — סיכון קריסת ה-worker סגור |
| חיווט מלא offline (בלי רשת, אישורים מזויפים) | `ClientSecretCredential` → `TokenCredentialAuthenticationProvider` → `Client` → `.api().get()` — **הכל נבנה** |
| `npm audit` | היה **10** מיד אחרי ההתקנה; **כעת 20** — ראה האזהרה מתחת. אף אחת מהשלוש לא מעורבת [אומת פעמיים] |
| תלויות שנוספו | 15 (identity) + 1 + 1 |

> **⚠️ סחף לא מתועד ב-`package.json` — לטפל לפני שמתחילים שלב כלשהו.**
> [נמדד] מאוחר יותר באותו יום נוספו **שתי חבילות CLI ל-`dependencies` של
> הייצור**, שאינן חלק מהתוכנית הזו: `@pnp/cli-microsoft365` ו-
> `@microsoft/m365agentstoolkit-cli`. השנייה גוררת שרשרת
> `teamsfx-core`/`office-addin-*` ש**הכפילה את ה-audit מ-10 ל-20**
> (9 גבוהות, 2 קריטיות). שתיהן כלי CLI אינטראקטיביים, לא קוד אפליקציה —
> ב-`dependencies` הן נארזות לכל פריסת ייצור (הראשונה לבדה ~80MB).
> `@microsoft/m365agentstoolkit-cli` הוא בכלל כלי לפיתוח אפליקציות Teams
> ואינו משמש דבר כאן.
> **המלצה: להסיר את השנייה לגמרי, ולהעביר את הראשונה ל-`devDependencies`**
> (או להשתמש ב-`npx` בלי להתקין). `package.json` ו-`package-lock.json`
> אינם committed כרגע.

**ממצא צדדי שמקטין את החוב:** בעץ יש כעת **שתי** גרסאות `@azure/msal-node` —
`5.5.0` (דרך identity, נקייה) ו-`2.16.3` (דרך `ews-javascript-api`, זו
שנושאת את אזהרת ה-uuid). **הסרת EWS ב-S8 תסלק את הישנה ותוריד אזהרה מהרשימה.**

**נותרו שני שינויי build:** `--external:@azure/identity
--external:@microsoft/microsoft-graph-client` ל-`worker:build`, ולבדוק אם
נדרש `serverExternalPackages` ב-`next.config.ts` (ל-EWS זה נדרש; לחבילה הזו
לא בהכרח — לבדוק אמפירית ב-build, לא להניח).

**מסלול האינטגרציה המאומת** [נמדד — ctx7, `/microsoftgraph/msgraph-sdk-javascript`]:
`ClientSecretCredential` מ-`@azure/identity` → `TokenCredentialAuthenticationProvider`
מ-`@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials` →
`Client.initWithMiddleware({ authProvider })`. ב-app-only ה-scope הוא
`https://graph.microsoft.com/.default`.

**שתי מלכודות build לטפל בהן מראש:**
1. `worker:build` כבר מחצין את `ews-javascript-api`/`@ewsjs/xhr` [נמדד] —
   להוסיף `--external:@azure/identity --external:@microsoft/microsoft-graph-client`,
   אחרת חוזר האירוע המתועד של `import.meta.url` שמתפוצץ ב-`dist/worker.cjs`.
2. ל-`microsoft-graph-client` **אין `exports` map** [נמדד: יש רק
   `main`/`module`/`types`] — הייבוא העמוק של ספק האימות נפתר בשיטה הישנה.
   עובד עם bundlers, אבל **לבדוק אמפירית מיד אחרי ההתקנה**, לא להניח.
   באותה הזדמנות: `grep -r "import.meta" node_modules/@azure/identity/dist/commonjs/`
   צריך לחזור ריק.

### 4.1ב חומר ייחוס שנסגר במחקר התיעוד — היה חסר לגמרי

#### אזורי זמן — השאלה המסוכנת ביותר, ונסגרה
**`Asia/Jerusalem` נתמך כשם אזור זמן — ככל הנראה אין צורך בתרגום ל-
`Israel Standard Time`.** [נמדד — דף `resources/datetimetimezone`, שבו
`Asia/Jerusalem` מופיע מילולית ברשימת "Additional time zones"]. הפורמט:
`{ dateTime: "2026-08-15T12:00:00", timeZone: "Asia/Jerusalem" }` — שעון
קיר בלי offset ובלי `Z`.

⚠️ **סייג מאותו דף עצמו, שאסור להשמיט:** *"Methods such as create or update
might **not** support all dateTimeTimeZone time zones."* כלומר הופעה ברשימה
אינה ערובה שהיצירה והעדכון — בדיוק הקריאות שאנחנו מתכננים — יקבלו אותו.
**זו הסיבה שהשער בשלב S2 הוא סבב מלא יצירה→קריאה→עדכון→מחיקה מול התיבה
האמיתית ולא רק "החיבור עובד".** אם יתברר שצריך שם Windows, זה שינוי של
קבוע אחד — אבל צריך לגלות אותו שם, לא בייצור.

- **בקריאה:** ברירת המחדל היא UTC. לשלוח
  `Prefer: outlook.timezone="Asia/Jerusalem"` בכל קריאה.
- **⚠️ אבל:** ה-header משפיע על **גוף התשובה בלבד**. חלון השאילתה של
  `calendarView` **לא זז** — `startDateTime`/`endDateTime` חייבים לשאת offset
  מפורש, אחרת הם מתפרשים כ-UTC.
- **יום שלם:** התיעוד דורש חצות-עד-חצות **באותו אזור זמן**. האם ה-`end` הוא
  בלעדי (יום אחד = 05/06 חצות עד 06/06 חצות) **לא אומת בתיעוד** — לאמת
  בשער S2, זו בדיוק הטעות שתציג אירוע ביום הלא נכון.
- `outlookUser: supportedTimeZones` הוא **"Not supported"** להרשאות
  אפליקציה — לא לתכנן שום פיצ'ר שמאמת אזור זמן מול התיבה. לא חוסם: אנחנו
  צריכים ערך קבוע אחד.

#### מיפוי שגיאות — חייב להיבנות לפי סטטוס HTTP, לא לפי מחרוזות
**ממצא מכריע: Graph לא מתעד בשום מקום רשימה של ערכי `error.code`.** השמות
בסגנון `ErrorItemNotFound` הם מורשת EWS ואינם חוזה של Graph. לכן:

| סטטוס | מצב | → קוד שלנו |
|---|---|---|
| 401 | טוקן פג/שגוי, או כשל ב-`ClientSecretCredential` | `auth_failed` |
| 403 | הרשאה חסרה, או תיבה מחוץ ל-management scope | `auth_failed` |
| 404 | הפריט לא קיים | `not_found` → **מפעיל ריפוי אוטומטי** (§6.1) |
| 429 | throttling | **לא סופי** — retry לפי `Retry-After`, עד 3 ניסיונות; רק אם המכסה נגמרה → `unreachable` |
| 500/502/503/504 | כשל בצד השרת | `unreachable` |
| אין תשובה כלל | DNS/connect/timeout | `unreachable` — **לאמת את צורת השגיאה מול ה-d.ts המותקן, לא להניח** |
| 400 | בקשה שגויה (הבאג שלנו) | `provider_error` |
| `5006` ב-getSchedule | מעל 1000 פריטים בחלון | `provider_error` |
| כל השאר | — | `provider_error` (ברירת מחדל שמרנית, כמו היום) |

#### מגבלות throttling — לא היו במסמך בכלל
[נמדד] **לכל צירוף של app-id + תיבה**: 10,000 בקשות ב-10 דקות ·
**4 בקשות במקביל** · 150MB העלאה ב-5 דקות. מגבלת המקביליות היא הרלוונטית
לנו — ה-cron וה-UI יכולים להתנגש.

#### פרטים נוספים שנסגרו
- **`calendarView`**: `$top` בין 1 ל-1000. ברירת המחדל **לא מתועדת** —
  להגדיר תמיד במפורש (300, כמו היום).
- **`Prefer: outlook.body-content-type="text"`** מחזיר גוף כטקסט נקי ⇒
  **`bodyToPlainText()` (כ-40 שורות regex ב-`ews-impl.ts`) נמחקת, לא מומרת.**
- **מחיקה**: ל-`DELETE` אין מקבילה ל-`HardDelete` של EWS. קיים גם
  `permanentDelete` (לתיקיית purges) ו-`cancel` (למארגן, עם הודעה מותאמת).
  להחליט לפני S4 אם פריטי בדיקה משאירים פסולת ב-Deleted Items.
- **חזרתיות**: `range.startDate` **חייב** להיות זהה ל-`start` של האירוע.
- **`allowNewTimeProposals`** ברירת מחדל `true` ביצירה — מוזמנים יכולים
  להציע שעה אחרת. להחליט אם לכבות.
- **מנויי שינוי / change-notification subscriptions** (עבודה עתידית בלבד —
  להחלפת ה-polling): אורך חיים 10,080 דקות (< 7 ימים); חידוש ב-`PATCH` על
  `expirationDateTime` לפני שפג. **לא נדרש למיגרציה עצמה.**

### 4.1ג מה שנפתח במעבר — יכולות, לא חבילות

נבדק מול ה-registry (16.08): **אף חבילה חדשה אינה שווה הוספה.**

| נבדקה | נפסלה כי |
|---|---|
| `@microsoft/mgt-element` (Graph Toolkit) | Lit web components מול React 19 + Base UI; דורשת אימות **delegated** ואנחנו app-only; מתנגשת עם מערכת העיצוב RTL |
| `@azure/communication-email` | מוצר Azure נפרד עם מנוי משלו — **היה זמין גם לפני המעבר**, לא נפתח בזכותו |
| `@microsoft/teams-js`, `@microsoft/agents-hosting` | לאפליקציות שרצות בתוך Teams |

**מה שכן נפתח, והכול על ה-SDK שכבר מותקן:**

1. **Change notifications (webhooks)** — הגדולה. מחליפה את ה-cron של
   10 דקות בדחיפה בזמן אמת. **מייתרת גם את הפיוס בזמן-קריאה** שנבנה
   רק כי EWS לא מודיע על מחיקות. מנוי חי 10,080 דק' (< 7 ימים), חידוש
   ב-`PATCH` על `expirationDateTime`.
2. **Delta queries** — סנכרון מצטבר במקום משיכת החלון כולו. ⚠️ פער parity
   ידוע: delta לאירועים **חוזרים** עדיין לא מלא — לבדוק לפני שנשענים עליו.
3. **`getSchedule`** — free/busy אמיתי; מייתר את העקיפה שנבנתה בגלל
   ה-500 של `GetUserAvailability` מול IONOS.
4. **`$batch`** — איחוד קריאות. **רלוונטי במיוחד** בגלל מגבלת **4 בקשות
   במקביל** לכל צירוף app+תיבה (§4.1ב) — ה-cron וה-UI יכולים להתנגש.
5. **`Prefer: outlook.body-content-type="text"`** — **מוחק** את
   `bodyToPlainText()` (~40 שורות regex ב-`ews-impl.ts`) במקום להמיר אותה.

**וכבר מומש:** ניהול Exchange דרך REST — `scripts/exo.cjs`. זה מה שאפשר
להפעיל DKIM ב-16.08 בלי פורטל ובלי PowerShell.

### 4.2 דואר יוצא
**היום:** nodemailer מול `exchange.ionos.com:587`, קונפיג ב-`app_settings`,
נקודת מפגש אחת: `src/lib/email/sender.ts` (95 שורות).
שלושה צרכנים: מסירת הסכם חתום (`agreements.ts`), מענה לפניות
(`admin/contacts.ts`), וסקריפט תפעולי (`scripts/send-email-file.ts`).
**אין OTP במייל** — ה-OTP הולך ב-SMS. כלומר אין תלות קריטית באימות.

**ההמלצה: Microsoft Graph `sendMail`** עם `Mail.Send` app-only מוגבל לתיבת
השליחה. הנימוקים: SMTP AUTH הוא הרגל ש-Microsoft הולכת ממנו — Basic כבר בדרך
לסגירה; Graph מחזיר `202` סינכרוני במקום רק NDR אסינכרוני; והגבלת ה-service
principal לתיבה אחת דרך RBAC היא גבול אבטחה טוב יותר.

**חלופה קבילה:** nodemailer + XOAUTH2 מול `smtp.office365.com:587`. שינוי
קטן יותר (רק בלוק ה-`auth` + לוגיקת טוקן), אבל מצריך `SMTP.SendAsApp`
ורישום service principal בכל מקרה, ומהמר על פרוטוקול בירידה.

**נפסל חד-משמעית: High Volume Email** [נמדד — שלפתי את הדף בעצמי,
`learn.microsoft.com/en-us/exchange/mail-flow-best-practices/high-volume-mails-m365`,
עודכן 03.08.2026]. שלושה ציטוטים מפורשים באותו דף:
> "**Recipient scope** | Internal recipients within the tenant only"
> "HVE accounts cannot be used for external email delivery."
> "Relay to internet via Microsoft 365 or Office 365 | … High Volume Email: **No**"

האורחים שלנו חיצוניים לחלוטין. HVE לא רלוונטי — לא כשלב, לא כגיבוי.

**החדשות הטובות:** הממשק המיוצא `EmailSender.send({to, subject, html, text,
attachments})` לא צריך להשתנות — שלושת הצרכנים לא נוגעים. תפר נקי.

**מגבלות לדעת:** 10,000 נמענים/תיבה/יום; 30 הודעות/דקה; ומגבלת TERRL ברמת
טננט. ⚠️ **מלכודת: כל עוד שולחים מדומיין `*.onmicrosoft.com` יש תקרה של 100
נמענים חיצוניים ל-24 שעות בכל הטננט.** לא לבדוק שליחה אמיתית לפני שהדומיין
המותאם ו-DKIM חיים.

### 4.3א ✅ הקאטאובר בוצע (15.08.2026, ~23:00)

**ה-DNS של kalfa.me מתארח על השרת הזה ב-Plesk** (`ns1/ns2.kalfa.me`), ולכן
כל השינויים נעשו מכאן ב-`sudo plesk bin dns` — בלי רשם ובלי פורטל.
גיבוי הזון לפני השינוי: `/tmp/claude-10003/dns-kalfa-me-backup-20260815.txt`.

| שינוי | ערך | אימות |
|---|---|---|
| SPF | הוספת `include:spf.protection.outlook.com` לרשומה הקיימת (**מיזוג, לא החלפה** — IONOS נשאר מאושר) | ✅ Google · Cloudflare · Quad9 · **רשומה אחת בדיוק** (שתיים = permerror) |
| autodiscover | CNAME → `autodiscover.outlook.com` | ✅ נפתר חיצונית |
| **MX** | `mx00/mx01.ionos.com` → **`kalfa-me.mail.protection.outlook.com` pref 0** | ✅ 8.8.8.8 · 1.1.1.1 · 9.9.9.9 |

ערך ה-MX **נשלף מ-Graph** (`/domains/kalfa.me/serviceConfigurationRecords`)
ולא הורכב מתבנית — זהו מה שמיקרוסופט עצמה מגדירה לדומיין הזה.

**אימות מקצה לקצה:** `sendMail` דרך Graph → `HTTP 202` → **נמסר תוך <5 שניות**.
כלומר `Mail.Send` עובד, והתיבה קולטת דואר בניתוב החדש.

⚠️ **מה שהבדיקה הזו לא הוכיחה:** היא הייתה פנימית (שולח=נמען), ו-Exchange
לא מריץ עליה את שרשרת האימות המלאה. **מסירוּת חיצונית טרם אומתה.**
נשלחה בדיקה ל-`admin@nm-digitalhub.com` — ממתינה לאישור הבעלים.

### ✅✅ הקאטאובר הושלם — דואר יוצא ונכנס עובדים (16.08.2026, 00:10)

**הפתרון היה DKIM, לא פנייה לתמיכה.** רצף מדוד:

```
20:07  Failed        ← לפני DKIM
20:47  DKIM Enabled → Status: Valid
20:49  Failed        ← ⚠️ עדיין נכשל אחרי שהופעל
20:52  Failed        ← ⚠️ ועוד פעם
21:08  ✅ Delivered   ← לתיבה ראשית ב-Gmail, לא ספאם
```

**המלכודת היא ההשהיה:** שתי שליחות **אחרי** ש-DKIM הפך ל-Valid עדיין
נכשלו, מה שיצר רושם שהוא לא עזר. שער המוניטין היוצא של מיקרוסופט מעריך
מחדש בקצב שלו — **בערך 20 דקות**.

**הכלל לפעם הבאה:** טננט חדש שנתקל ב-`5.7.708` — להשלים SPF **ו-DKIM**,
להמתין ~20–30 דקות, ולבדוק שוב **לפני** שמסלימים למיקרוסופט. התיעוד של
מיקרoסופט לא אומר את זה בשום מקום; הוא מציג את הקוד כמוניטין IP טהור עם
פנייה לתמיכה כפתרון היחיד.

<details>
<summary>הניתוח בזמן שהחסימה הייתה פעילה (נשמר לתיעוד)</summary>

**דואר יוצא חיצוני חסום על ידי מיקרוסופט — `550 5.7.708 AS(7910)`.**
[נמדד — NDR מלא בתיבת השולח]. שליחה ל-`admin@nm-digitalhub.com` (Google
Workspace) נדחתה **על ידי מיקרוסופט עצמה**, לא על ידי הנמען. שליחה פנימית
נמסרה בשניות ⇒ הבעיה בכיוון היוצא בלבד.

**סיבה מאומתת מול המקור הרשמי** (`support.microsoft.com/topic/f5675801…`):
`5.7.708` = *"if you send an email message from an IP address that has a low
reputation"*. חסימת אנטי-ספאם שמיקרוסופט מחילה על **טננטים חדשים**.

**מה שנשלל בראיות, ולא בהיגיון:**
- לא Restricted Entities / מדיניות ספאם — אלה מופיעות כ-`5.7.705`.
- לא רשימת חסימה של הטננט — זה `5.7.703`.
- לא בעיית דומיין/מחבר — זה `5.7.750`, והדומיין שלנו מאומת.
- **לא בעיה ספציפית ל-Graph app-only** — מנהל פורום של מיקרוסופט:
  *"This error isn't a Graph Issue… The Graph API call succeeds (202) because
  the message is accepted by Exchange Online for processing, but it fails
  during delivery to external domains."* קיים מקרה מתועד זהה: Graph app-only,
  מנוי משולם, אותו `AS(7910)`.

**אין פתרון תכנותי.** אין endpoint ב-Graph (v1.0 או beta) שחושף את הדגל;
מדיניות ספאם יוצא היא PowerShell בלבד ו-Restricted Entities פורטל בלבד —
ושתיהן לא רלוונטיות לקוד הזה. **⛔ ולא להשתמש ב-`sender.office.com`** — הוא
לכיוון ההפוך (שחרור IP חיצוני שנחסם מלהיכנס).

**⚠️ תיקון לגרסה קודמת של המסמך:** נכתב כאן ש"ההגבלה מוסרת מעצמה תוך 24–72
שעות". **זה שגוי ולא מתועד עבור הקוד הזה** — הטיימליין הזה שייך ל-
`451 4.7.500-699`, graylisting **נכנס** וזמני. מנגנון אחר, כיוון אחר.
**הפתרון היחיד עם ראיות: פנייה לתמיכת Microsoft** (נוסח מוכן בהיסטוריית
הסשן), `admin.microsoft.com → Support → New service request`.

**השלכה על התוכנית: S6 חסום** עד להסרת ההגבלה. KALFA עצמה לא נפגעה — היא
שולחת דרך IONOS SMTP, שאינו תלוי ב-MX, וה-SPF הממוזג עדיין מאשר אותו. **זה
בדיוק המקום שבו המיזוג הציל אותנו:** לו היינו מחליפים ב-
`v=spf1 include:spf.protection.outlook.com -all` כפי שמיקרוסופט מציעה, כל
הדואר של KALFA היה נופל עכשיו.

**DKIM לא היה מופעל** — וזה **כן** התברר כסיבה, בניגוד למה שנכתב כאן קודם.
</details>

**✅ DKIM מופעל ותקף** (`Enabled: true, Status: Valid`), הוגדר דרך
`scripts/exo.cjs` בלי פורטל ובלי PowerShell. הרשומות:
`selector1/2._domainkey.kalfa.me` → `…KALFARSVP.d-v1.dkim.mail.microsoft`.
⚠️ הפורמט הוא `d-v1.dkim.mail.microsoft` — **לא** `onmicrosoft.com` שניחשתי
בתחילה. תמיד לשלוף מ-`New-DkimSigningConfig`, לא להרכיב מתבנית. הכותרת שחזרה: `dkim=none (message not signed)`.
בדיקה אמפירית: `selector1/2-kalfa-me._domainkey.KALFARSVP.onmicrosoft.com`
**אינם נפתרים** ⇒ מיקרוסופט טרם הקצתה מפתחות. **אין לזה API ב-Graph** —
נדרש Defender portal או `New-DkimSigningConfig -DomainName kalfa.me -Enabled $true`.
עד אז מסירוּת חיצונית נשענת על SPF בלבד.

**נותר לניקוי:** שלוש רשומות SRV (`_imaps`, `_pop3s`, `_smtps`) עדיין מפנות
ל-IONOS. הן כעת מטעות — לקוח שיתגלה אוטומטית ינותב לשרת הישן.

### 4.3 DNS ומסירוּת
**סדר קריטי — מה שאפשר לעשות בלי סיכון קודם:**

1. **בלי השפעה על זרימת דואר** (ה-MX עדיין ב-IONOS): לפרסם שתי רשומות DKIM
   (`selector1._domainkey`, `selector2._domainkey` — הערכים מתקבלים מהפורטל),
   להוסיף `include:spf.protection.outlook.com` ל-SPF הקיים, ולהפעיל
   `Set-DkimSigningConfig -Enabled $true`. לאמת `Status: Valid`.
   ⚠️ **להוסיף ל-SPF, לא להחליף** — הנחיה מפורשת של מיקרוסופט כל עוד IONOS חי.
2. לקחת דלתא אחרונה של תוכן התיבה (§4.4).
3. **רק אז** להעביר MX ל-`<domain>.mail.protection.outlook.com`, ולהוסיף
   CNAME ל-autodiscover. TTL ≤ 3600 (Exchange Online תומך רק ב-TTL < 6 שעות).
4. לאמת התפשטות מול resolver חיצוני, לא רק מקומי.
5. DMARC נשאר `p=quarantine` עם alignment רפוי — הוא סובל מעבר. **לא** לעבור
   ל-`p=reject` לפני שראינו `dkim=pass` מיושר על דואר אמיתי.

**חוק ישן שצריך לתייג מחדש:** הכלל "לא להוסיף DKIM מצד הלקוח" נוצר כי ממסר
IONOS שכתב מחדש את גוף ההודעה ושבר את החתימה. **הנימוק הזה לא עובר ל-M365**,
אבל **המסקנה כן נשארת** — מסיבה אחרת: M365 חותם DKIM באופן טבעי, וזה בדיוק
תפקידו. אין סיבה לחתום בעצמנו.

**סיכונים חדשים שלא היו ב-IONOS:** מוניטין של טננט חדש בלי היסטוריית שליחה;
מפתחות DKIM חדשים לגמרי (איפוס אות ותק); ומדיניות ספאם יוצא שמחמירה עם שולחים
חדשים. לוודא אחרי המעבר מול headers אמיתיים: `spf=pass`, `dkim=pass` **ומיושר**,
`dmarc=pass`, ומיקום בתיבה ראשית ב-Gmail.

### 4.4 תוכן התיבה ופירוק IONOS
**המצב:** התוכן הועתק, אבל ה-MX לא עבר — כלומר מה שנכנס מאז ההעתקה נמצא
**רק** ב-IONOS. זה snapshot, לא מראה חיה. אין שום תהליך שמשווה ביניהם היום.

**שאלה שחייבת תשובה לפני נעילת הסדר:** האם ההעתקה נעשתה כ-**migration batch
חי** ב-Exchange Online (שממשיך לסנכרן אינקרמנטלית עד "Complete migration
batch"), או כ-**ייצוא חד-פעמי** (PST / גרירה ידנית / כלי IMAP)? בראשון —
משלימים את ה-batch מיד אחרי החלפת ה-MX והוא לוקח את הדלתא לבד. בשני — צריך
השוואה ידנית לפני ואחרי.

**איך לבדוק כמה חסר, בלי לשנות כלום:** להשוות את חותמת ההודעה **האחרונה**
בתיבת IONOS מול האחרונה ב-M365. הפער בין השתיים הוא בדיוק גודל המשימה.

**⚠️ שתי תלויות עצמאיות ב-IONOS — לא לבטל את החשבון מוקדם:**

| תלות | נשברת כאשר | מושפעת מהחלפת MX? |
|---|---|---|
| דואר נכנס לתיבה האנושית | ה-MX עובר | **כן** |
| אינטגרציית היומן (`src/lib/exchange-ews`) | חשבון IONOS **מבוטל** | **לא** — ממשיכה לעבוד |

כלומר החלפת ה-MX **לא** תשבור את היומן. ביטול חשבון IONOS **כן** ישבור אותו.
לכן: לא לבטל את IONOS עד ששכבת היומן עברה ל-Graph ואומתה.

---

## 5. שלבים ושערי אימות

כל שלב עומד בפני עצמו וניתן לעצירה. שערי החובה של הפרויקט
(`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`) חלים על כל
שלב שנוגע בקוד — ובנוסף שער ריצה חי, כי שערים סטטיים לא תופסים שגיאות
client/server.

| # | שלב | תלוי ב | שער אימות | Rollback |
|---|---|---|---|---|
| **S0** | הכנת טננט: רישום אפליקציה, service principal, management scope, הענקת הרשאות | — | `Test-ServicePrincipalAuthorization` מחזיר הרשאה לתיבה הנכונה **ומסרב** לתיבה אחרת | למחוק את ה-role assignment |
| **S1** | **מתג כיבוי + בורר ספק.** מודול אחד שמייצא `calendarProvider`, שבע נקודות הקריאה עוברות דרכו, ו-`app_settings.exchange_provider` (`ews`\|`graph`\|`off`) שמכבה בלי deploy | — | ללא שינוי התנהגות: כל הטסטים עוברים, היומן החי עדיין עובד מול IONOS | revert אחד |
| **S1.5** | **טסטי characterization** לשלושת המודולים חסרי הכיסוי (§6.3) | S1 | הטסטים מתעדים את ההתנהגות **הקיימת**, כולל הכשל-הרך | — |
| **S2** | `graph-impl.ts` מאחורי אותו ממשק; מיפוי שגיאות Graph לחמשת קודי `ExchangeErrorCode` (או מיגרציה ל-CHECK); הסרת `xmlSafe` **בכל חמשת המקומות** | S0, S1.5 | טסטי יחידה; קריאה חיה לתיבת M365: יצירה→קריאה→עדכון→מחיקה | הבורר חוזר ל-EWS |
| **S2.5** | **הרצה מקבילה לקריאה בלבד** — `testConnection`/`getAvailability`/`listAppointments` מול Graph במקביל ל-EWS החי, השוואת לוג בלבד | S2 | השוואה ידנית ב-`/admin/debug` | חסר סיכון — לא בוצעה כתיבה |
| **S3** | מודל אישורים: סכימה ל-app-only, נטרול עמודות הסיסמה | S0 | מיגרציה מוצגת לאישורך לפני `db push` | מיגרציה הפוכה |
| **S4** | **שער התראות מוזמנים** — בדיקה אמפירית מול שתי תיבות שלך, **כל שלושת הפעלים**: יצירה עם מוזמן → PATCH של שעה בלבד (בלי לגעת ברשימת המוזמנים) → מחיקה. ⚠️ **שולח דואר אמיתי שלא ניתן לבטל — דורש אישור מפורש שלך לשליחה עצמה**, לא רק להרצה | S2 | המוזמן קיבל **שלוש** הודעות: הזמנה, עדכון-שעה, ביטול | חוסם מעבר |
| **S4.5** | **התאמה ידנית של שתי שורות המתאם** (מתכון §6.1) + החלטת 404 מיושמת בקוד | S2 | `appointment_id` בשתי השורות מצביע לפגישה אמיתית בתיבה החדשה | לשחזר ערך קודם |
| **S4.5א** | **14 שורות `callback_requests`** — `UPDATE … SET calendar_item_id=NULL, exchange_connection_id=NULL` על השורות הפתוחות. הסריקה תיצור אותן מחדש ב-M365 לבד (§6.1) | S2 | תוך ≤10 דק' בחלון שעות עבודה, כל שורה פתוחה מקבלת `calendar_item_id` חדש שמצביע לפריט אמיתי ב-M365 | לשחזר את הערכים הקודמים מגיבוי לפני ה-UPDATE |
| **S5** | מעבר היומן ל-Graph | S3, S4, S4.5, **S4.5א** | `/admin/calendar` מציג את התיבה החדשה; presence עובד; אירוע נבדק מסתנכרן | הבורר |
| **S6** | דואר יוצא ל-Graph `sendMail` | S0 | הסכם נשלח ומתקבל; headers מאומתים | קונפיג ל-nodemailer |
| **S7** | DNS: DKIM+SPF (בלי סיכון) → דלתא → MX | S6 | `dkim=pass` מיושר על דואר אמיתי | החזרת MX |
| **S8** | פירוק: מחיקת EWS, הסרת חבילות, ביטול IONOS | S5, S7 | סוויטה מלאה + build נקי | — |

**סדר מוצע (מתוקן — הגרסה הקודמת השמיטה שלושה שלבים שמופיעים בטבלה עצמה,
כולל S4.5 שהמסמך מגדיר כחובה):**

```
S0 → S1 → S1.5 → S2 → S2.5 → S4 → S4.5 → S4.5א → S3 → S5
במקביל, בלי תלות:  S6 → S7
אחרון, אחרי תקופת הרצה:  S8
```
אתה קובע; התלויות בטבלה הן מה שלא ניתן להפוך.

**⚠️ S8 דורש תקופת הרצה, לא רק מעבר שער.** שער S5 מוכיח שהמעבר עבד **פעם
אחת**, לא שהוא יציב. S8 כולל ביטול חשבון IONOS — הפעולה היחידה שלא ניתנת
לביטול ושמנתקת את היומן. **המלצה: מינימום שבועיים של הרצה תקינה בייצור
אחרי S5 לפני S8**, ולא "S5 עבר ⇒ אפשר לבטל".

---

## 5א. חמישה ממצאים חוסמים מהביקורת — הכרעה לפני S1

### א. `off` במתג הכיבוי — אין לו ערך חוקי להחזיר, וברירת מחדל שגויה תמחק נתונים
חמשת קודי `ExchangeErrorCode` נעולים ב-CHECK constraint. "כבוי" אינו אחד מהם.
שלוש דרכים שזה נשבר [נמדד — קריאת הצרכנים]:

1. `console-agent-calendar-presence.ts:151` כותב את הקוד ישירות ל-DB. ערך לא
   חוקי ⇒ ה-upsert נכשל ⇒ נתפס ב-`catch` ⇒ **שורת הנוכחות מפסיקה להתעדכן
   לנצח, בשקט**.
2. **המסוכן:** אם `off` יחזיר `not_found`, גם `deleteAvailabilityBlock`
   (`exchange-availability.ts:305`) וגם `deleteMyExchangeCalendarEvent`
   (`exchange-connections.ts:606`) מפרשים זאת כ"כבר נמחק" **ומוחקים את השורה
   שלנו** בזמן שהפגישה חיה בתיבה. חוסר סנכרון קבוע.
   (שניהם בתבנית `if (!result.ok && result.error !== 'not_found')`.)
3. `runCallbackSchedulingSweep` לא ייעצר — כשל זמינות עולה כ-
   `availability_${code}`, שאינו ברשימת העצירה (`callback-scheduling.ts:525`)
   ⇒ 25 שורות יינסו כל 10 דקות **והתראת Slack תישלח בכל טיק**.

**ההכרעה שלי: `off` יחזיר `provider_error`, ומצב "כבוי" ידווח בערוץ נפרד**
(פאנל `/admin/debug` קורא את `app_settings` ישירות). כך S1 נשאר בלי מיגרציה.
החלופה — קוד שישי + מיגרציה ל-CHECK — יקרה יותר ולא נחוצה.

### ב. הממשק **כן** משתנה — הטענה הקודמת שלי הייתה שגויה
`ExchangeConnectionConfig` הוא `{ mailboxEmail, password, authMethod }`
(`types.ts:14-18`), וכל 13 המתודות מקבלות אותו כארגומנט ראשון. ב-app-only
**אין סיסמה לפענח** — יש סוד אחד ברמת מודול. לכן אי אפשר להעביר את אותו
`cfg`.

**ההכרעה שלי: הבורר מפסיק להעביר `cfg` מהקורא.** כל מימוש טוען את הקונפיג
של עצמו — EWS מ-`exchange_connections`, Graph מ-env + תיבת יעד בהגדרות.
זה מסיר את `cfg`-threading משבע נקודות הקריאה **פעם אחת** במקום פעמיים.
המחיר: S1 גדול מ"שינוי ייבוא", והוא כבר לא "revert אחד". **צריך לומר את זה
בפה מלא ולא לגלות באמצע.**

### ג. `recurring_locked` אינו שגיאת שרת — צריך לממש אותו מחדש
[נמדד] הוא נזרק מקומית ב-`ews-impl.ts` לפני שנשלחת בקשה, לא מגיע מ-Exchange.
`graph-impl.ts` **חייב** לבדוק `item.type !== 'singleInstance'` לפני PATCH
ולזרוק את המקבילה. אחרת ההגנה בצד השרת נעלמת ודגל `readOnly` ב-UI נשאר
המחסום היחיד — כלומר בקשה מזויפת תעבור.

### ד. S3 מוגדר צר מדי — זה לא "מיגרציה קטנה"
[נמדד] 13 פונקציות ב-`exchange-connections.ts` בנויות סביב `connectionId`
שמגיע משורה שנוצרה **מטופס סיסמה**; שלוש עמודות האישורים הן `NOT NULL`
וחוסמות כל הכנסה במודל app-only; ו-`connectionId` מחלחל עד ה-client
(11 מופעים ב-`calendar-client.tsx`). מסך "חיבור תיבה" הופך למסך **תצוגת
מצב בלבד** — ההגבלה נעשית ב-PowerShell (S0), לא באפליקציה.

### ה. הטסטים הקיימים יפסיקו לתפוס אחרי S1
[נמדד] `event-exchange-sync.test.ts:10` ו-`callback-scheduling.test.ts:8`
עושים `vi.mock('@/lib/exchange-ews/ews-impl')`. ברגע שנקודות הקריאה עוברות
לבורר, ה-mock לא מיירט דבר והטסטים יבצעו קריאות אמיתיות. **לעדכן את יעד
ה-mock לנתיב הבורר כחלק מ-S1 עצמו**, לא אחר כך.

## 5ב. מצאי מלא של הפניות ל-IONOS — פערים שהתגלו ב-16.08

נסרק כל המאגר. שלושה דברים שלא היו בתוכנית:

### 🔴 א. "IONOS" הוא **שני** דברים — אסור לחפש-ולהחליף
```
(א) IONOS Hosted Exchange   ← ספק הדואר/יומן. עוזבים.
(ב) IONOS כספק האחסון       ← השרת הזה מתארח אצלם. נשאר!
```
| קובץ | הקשר | פעולה |
|---|---|---|
| `src/app/(admin)/admin/voice/platform/page.tsx:233` | "Allowlist לחומת אש (IONOS)" | **לא לגעת** |
| `scripts/voximplant/cli.ts:558` | "IONOS firewall allowlist" ל-Voximplant | **לא לגעת** |

אלה מתעדים את רשימת ההיתר של כתובות Voximplant בחומת האש של ה-VPS. חיפוש
גורף על `ionos` ישבור אותם. **כל שינוי חייב להיות ממוקד לקובץ, לא גלובלי.**

### ב. משטחי UI שלא היו במצאי §1.1
| קובץ | תוכן | דין |
|---|---|---|
| `admin/settings/settings-form.tsx:228` | placeholder `exchange.ionos.com` בשדה SMTP | לעדכן ב-S6 |
| `admin/settings/page.tsx:66` | כותרת "חיבור Exchange (IONOS)" | לעדכן ב-S5 |
| `admin/debug/_panels.tsx:565-660` | **פאנל דיבאג שלם** — Autodiscover, שגיאת 500 של GetUserAvailability, הקידוד הקשיח, "ספרייה ללא תחזוקה". **כל התוכן מתיישן** | לשכתב ב-S5 |
| `src/lib/ops/integrations.ts:21` | הערה בלבד | לעדכן ב-S8 |

### ג. הערך החי ב-DB, לא רק הסכימה
`app_settings.smtp_host = 'exchange.ionos.com'` (+ `smtp_user`, `smtp_password`,
`smtp_port`, `smtp_secure`). §4.2 מכסה את `sender.ts` אבל **לא את שינוי הערכים
עצמם**. ב-S6, אם עוברים ל-Graph `sendMail`, העמודות האלה מתייתמות; אם נשארים
ב-SMTP, הן משתנות ל-`smtp.office365.com` + XOAUTH2.

### מה שכן היה מכוסה נכון
`ews-impl.ts` (כולל `EWS_ENDPOINT` הקבוע), כל שכבת ה-DAL, `sender.ts`,
`types.ts`, `schemas.ts`, ו-`admin/settings.ts` — כולם ב-§1.1.
הערות במיגרציות היסטוריות (`202606240018`, `20260727171428`,
`20260812181059`, `202606240019`) — **לא לגעת**, הן תיעוד של מה שהיה.

## 6. סיכונים

### 6.1 שורות המתאם השמורות מתות — והכשל שקט
**`translateExchangeIds` לא יציל אותן** [נמדד — שלפתי את הדף בעצמי,
`learn.microsoft.com/en-us/graph/api/user-translateexchangeids`, עודכן
03.06.2026]. ציטוט מדויק מטבלת הפרמטרים:

> "All identifiers in the collection MUST have the same source ID type, and
> MUST be **for items in the same mailbox**. Maximum size of this collection
> is 1,000 strings."

הפורמט `ewsId` אכן נתמך כמקור — כלומר תרגום EWS→Graph אפשרי, אבל **רק בתוך
אותה תיבה**. זו המרת *פורמט* של מזהה, לא איתור פריט בארגון Exchange אחר.
התיבה ב-IONOS והתיבה ב-M365 הן שני ארגונים נפרדים, והעתקת תוכן יוצרת פריטים
חדשים עם מזהים חדשים. **אין מסלול הצלה.**
(הערה נוספת מהדף: `/me/translateExchangeIds` **לא תומך** בהרשאות אפליקציה
בכלל; רק `/users/{id}/` תומך, ודורש `User.Read.All` — עוד סיבה לא לבקש אותה.)

**ארבע עמודות מזהים הופכות למתות, לא שתיים** [נמדד — בדקתי את המיגרציות]:

| טבלה | עמודה | נפח |
|---|---|---|
| `exchange_calendar_links` | `appointment_id`, `rsvp_deadline_appointment_id` | 1 שורה |
| `exchange_availability_blocks` | `appointment_id` | 1 שורה (מרפא את עצמו) |
| `callback_requests` | `calendar_item_id`, `exchange_connection_id` | **14 שורות — כולן פתוחות** |

#### 🔴 `callback_requests` — הסיכון החמור ביותר בכל המסמך, והוא מול לקוחות
[נמדד — שאילתה חיה + קריאת הקוד]. המסמך סימן את השורה הזו קודם כ"לא נספר".
**המספר האמיתי: 14 שורות עם `calendar_item_id`, וכולן `status='new'`** —
כלומר שיחות חוזרות **פתוחות שטרם בוצעו**, לא היסטוריה.

והמלכודת אינה תיאורטית — היא שורת קוד קיימת, `callback-scheduling.ts:215`:
```ts
if (request.calendar_item_id) return { ok: false, reason: 'already_scheduled' };
```
אחרי המעבר, כל 14 השיחות ייחשבו "כבר מתוזמנות" בזמן שפריט היומן שלהן לא
קיים בתיבה החדשה. **התוצאה: 14 לקוחות שהבעלים חושב שהם ביומן שלו — ואינם.**
בלי שגיאה, בלי התראה. זה לא ניקיון קוד, זו שלמות נתונים מול לקוח.

**חובה שלב ייעודי (ראה S4.5א), לא איחוד לתוך "שתי שורות, חמש דקות".**
העמודה גם נקראת פעיל היום דרך `getCallbackRequestByCalendarItem()`
(`exchange-connections.ts:676`), אז היא לא רדומה.
המיגרציה הרלוונטית: `20260728021842`.

**למה זה מסוכן במיוחד:** `syncEventToExchange` יראה שורת קישור קיימת, יסיק
"כבר סונכרן", **ויחליק את האירוע בשקט**. לא שגיאה, לא התראה — פשוט לא קורה.
**הטיפול חייב להיות צעד מפורש בתוכנית**, לא הערת שוליים.

#### ⚠️ עדכון 15.08.2026 — מדידה חיה ביטלה את שני המסלולים שלמטה
**היומן ב-M365 ריק לחלוטין** [נמדד — קריאת Graph חיה]: התיבה מכילה שלושה
יומנים — `לוח שנה` (ברירת מחדל) ועוד שניים שנוצרים אוטומטית בכל תיבה
(`חגים בישראל`, `ימי הולדת`, שניהם לקריאה בלבד). **ביומן הראשי: 0 אירועים.**

כלומר **תוכן היומן לא הועבר** — רק הדואר, אם בכלל. זה תואם בדיוק את מגבלת
העברת ה-IMAP שתועדה ב-§4.4: מעבירה דואר בלבד, לא יומן/אנשי קשר/משימות.

**מה שנובע מכך:**
1. **מתכון ההתאמה לפי נושא+שעה (למטה) מיותר** — אין פריטים להתאים אליהם.
   השורות ב-`exchange_calendar_links`, `exchange_availability_blocks` ו-14
   השורות ב-`callback_requests` פשוט **ייווצרו מחדש** מהנתונים שב-DB.
   פשוט יותר וּודאי יותר מהתאמה ידנית.
2. ~~אזהרה על אובדן היומן ההיסטורי~~ — **בוטלה אחרי מדידה. ראה מיד למטה.**

#### ✅ מה באמת יש ביומן IONOS (נסרק חי, 15.08.2026)
סריקה שנה-שנה 2020–2030 דרך `ewsProvider.listAppointments` (סריקה שנתית
בכוונה — יש תקרה של 300 פריטים לטווח, וחלון רחב אחד היה חותך בשקט):

```
2026: 15 אירועים   ·   לפני 2026: 0   ·   סדרתיים: 0
```

**וכל 15 הם פריטים שהמערכת שלנו יצרה** — כותרות בתבנית
`"שיחה חוזרת — {שם} — {נושא}"` שמיוצרת ב-`callback-scheduling.ts`.
**אין ביומן הזה שום היסטוריה אישית.** האזהרה הקודמת שלי הייתה מוגזמת:
אין כאן נתון שאובד עם ביטול IONOS.

#### 🎯 וזה מאחד שתי בעיות לאחת — עם פתרון אוטומטי
15 הפריטים האלה הם **אותם** פריטים שמאחורי 14 השורות ב-`callback_requests`
(§6.1). לא שתי בעיות — אחת.

והפתרון אינו העתקה אלא **איפוס מבוקר**: `callback-scheduling.ts:215` קובע
`if (request.calendar_item_id) return { reason: 'already_scheduled' }`.
לכן **`UPDATE callback_requests SET calendar_item_id = NULL, exchange_connection_id = NULL`
על השורות הפתוחות ⇒ הסריקה שרצה כל 10 דקות תיצור אותם מחדש בתיבת M365 לבד.**

יתרונות על פני העתקה: אין התאמת נושאים, אין סקריפט מיגרציה, אין מזהים
ידניים, והתוצאה עוברת דרך אותו מנגנון תזמון שכבר מאומת בייצור (כולל שערי
שעות עבודה ושבת). **זה מחליף את S4.5א מ"תיקון ידני" ל-`UPDATE` אחד.**

**סייג לתזמון:** הסריקה מכבדת חלונות שעות עבודה, אז היצירה מחדש תקרה
בחלון החוקי הבא ולא מיידית. זו התנהגות נכונה, לא תקלה.

<details>
<summary>מתכון ההתאמה המקורי (לא בתוקף — נשמר לתיעוד)</summary>

#### יש מסלול שחזור — טעיתי כשכתבתי "אין"
לא צריך לוותר על השורות: **שתי הטבלאות שומרות מספיק כדי לאתר את הפגישה
מחדש לפי תוכן במקום לפי מזהה** [נמדד — קראתי את שתי המיגרציות]:

| טבלה | מה יש לנו לזיהוי | איכות ההתאמה |
|---|---|---|
| `exchange_availability_blocks` | `starts_at`, `ends_at`, `show_as` **ו-`label`** — ותיעוד העמודה קובע במפורש שה-label הוא נושא הפגישה, מאוצר מילים קבוע בשרת | **גבוהה** — כמעט אוטומטית |
| `exchange_calendar_links` | `subject_synced` + `event_id` → `events.event_date` | **בינונית** — `subject_synced` עלול להיות NULL (מתועד כ"לא נקרא בשלב הזה"); דורש עין אנושית |

**המתכון:** `GET /users/{id}/calendar/calendarView` על החלון הרלוונטי בתיבה
החדשה → התאמה לפי נושא → `UPDATE` ידני של `appointment_id`. **שתי שורות
סה"כ — תיקון של חמש דקות, לא סקריפט מיגרציה.** להריץ **לפני** שמסלול Graph
עולה לאוויר, אחרת נופלים בדיוק למלכודת השקטה שלמעלה.

</details>

**החלטת תכן שנגזרת מכאן ואסור להשאיר לברירת מחדל:** מה עושים כשקריאת
עדכון/מחיקה מקבלת **404 על מזהה שאנחנו מכירים**? זו לא שגיאה תפעולית אלא
"המזהה מת" — צריך להחליט במפורש בין "לרפא אוטומטית: להתייחס כלא-מסונכרן
וליצור מחדש" לבין "להיכשל ולהתריע". **המלצתי: ריפוי אוטומטי** — ליצור מחדש
ולעדכן את השורה, כי כל חלופה משאירה אירוע לקוח בלי פגישה ביומן.

**תיקון צופה פני עתיד (זול עכשיו, יקר בדיעבד):** לשמור גם `iCalUId` לצד
המזהה האטום. בניגוד ל-`id` שנגזר ממיקום פיזי בתיבה, `iCalUId` הוא מזהה
פגישה נייד לפי תקן, וכלי מיגרציה טובים משמרים אותו. **לא עוזר לשתי השורות
הקיימות** — הקוד שלנו מעולם לא קרא אותו, אז אין לנו מול מה להשוות — אבל זה
בדיוק סוג המפתח העמיד שהאירוע הזה הוכיח שחסר לנו. לשלב יחד עם
`Prefer: IdType="ImmutableId"`.

### 6.1א ⚠️ מלכודת CASCADE — לבטל, לעולם לא למחוק
[נמדד — קראתי את המיגרציות]: גם `exchange_availability_blocks.connection_id`
(`20260727205735:38`) וגם `exchange_calendar_links.connection_id`
(`20260731113956:45`) מוגדרים `on delete cascade`.

כלומר: **מחיקת שורת החיבור תמחק בשקט את כל שורות המתאם**, בזמן שהפגישות
עצמן נשארות יתומות בתיבה החיה בלי שום רישום שהן שלנו. אין היום מסלול קוד
שמוחק את השורה — אבל סקריפט מעבר שיעשה זאת יגרום לנזק בלתי הפיך.
**כלל מחייב לכל שלב במעבר: `status='revoked'`, אף פעם לא `DELETE`.**
ביטול הוא גם מתג הכיבוי בפועל היום — כל טוען לא-מפוקח מסרב לשורה מבוטלת.

### 6.2 כשל שקט הוא ברירת המחדל ברוב המשטח הזה
| מסלול | התנהגות בכשל | התראה |
|---|---|---|
| `syncEventToExchange` / `markEventExchangeCancelled` | נקרא **אחרי** ה-try/catch של פרסום/סגירה, ללא בדיקת ערך מוחזר | **אין** — console בלבד |
| `runConsoleAgentCalendarPresenceSync` | "never throws", advisory במכוון | **אין** — מתועד ככוונה |
| `getMyPresence()` (נקודת הנוכחות באווטאר) | try/catch גורף → `showAs:'free'` | **אין** |
| `/admin/calendar` | מציג Alert אדום אמיתי | pull בלבד — רק אם מישהו פותח את המסך |
| `runCallbackSchedulingSweep` | — | **יש** Slack warn [דווח] |

**מסקנה: מלבד מסלול אחד, אין דרך לדעת שהיומן נשבר בלי להסתכל.** שים לב
שנקודת הנוכחות נופלת ל-"פנוי" — ברירת המחדל הפחות בטוחה. לכן S1 (מתג + בורר)
הוא השלב הראשון: הוא נותן גם נראות וגם דרך לכבות מהר.

### 6.3 שלושת הקבצים המסוכנים ביותר הם בדיוק אלה בלי טסטים
[דווח, לא אימתתי בעצמי]: `exchange-connections.ts` (710 שורות),
`exchange-availability.ts` (348) ו-`console-agent-calendar-presence.ts` (204)
— **אין להם קובץ טסט כלל**. אלה בדיוק המודולים שמחזיקים את טיפול האישורים ואת
הסתעפויות הכשל-הרך שנסקרו לעיל, והם מה שמיגרציה נוגעת בו הכי הרבה.
**המלצה: טסטי characterization לפני שמתחילים S2**, לא אחרי.

הטסטים הקיימים על המשטח (~113 מקרים) שורדים ברובם, כי הם עושים mock לספק
בגבול המודול ולא לספרייה. זה הפרס האמיתי של שכבת הבידוד.

### 6.4 escaping כפול
הסרה **חלקית** של `xmlSafe()` היא מצב הכשל הריאלי: כל שדה שיישאר מוגן
יישמר עם `&amp;` במקום `&`. **הרשימה המלאה והמדויקת נמצאת ב-§4.1 — 6 סוגי
שדות, 10 שורות, 11 קריאות.**

⚠️ **הסעיף הזה נשא עד עכשיו את הטענה השגויה** ש"הגוף ייראה תקין" ושמדובר
ב"חמישה מקומות". שתיהן הופרכו במדידה: הגוף עובר escaping בדיוק כמו הנושא
והמיקום, ולכן חשוף בדיוק באותה מידה.

### 6.5 אזורי זמן ואירועי יום-שלם
פירוט ב-§4.1. הקצה החד: יום-שלם יוצג ביום הלא נכון אם נשלח חצות UTC.

### 6.6 מוניטין טננט חדש
פירוט ב-§4.3. לא לבדוק שליחה המונית מדומיין `onmicrosoft.com` (תקרה של 100).

---

## 7. מה דורש פעולה שלך (אני מכין, אתה מריץ)

לפי כלל הפרויקט, פקודות שנוגעות בסודות או בפלטפורמה חיה — אתה מריץ.
**לא ביצעתי ולא אבצע בלי "בצע" מפורש:**

1. **רישום אפליקציה ב-Entra** + יצירת client secret. אכין את הפקודות/הצעדים
   המדויקים. הסוד לא עובר דרכי — נכנס ישירות ל-env של הפריסה.
2. **Exchange Online PowerShell**: `New-ServicePrincipal`,
   `New-ManagementScope`, `New-ManagementRoleAssignment`,
   ואימות ב-`Test-ServicePrincipalAuthorization`.
3. **שינויי DNS** — כולם. אכין את הרשומות המדויקות להעתקה.
4. **`db push`** לכל מיגרציה, אחרי שאציג לך אותה.
5. **בדיקת מסירה חיה** ובדיקת התראות המוזמנים (S4) — מול תיבות שלך.

**⚠️ החלף את הסיסמה ששלחת בצ'אט.** היא לא נחוצה לנו ולא תיכנס לשום מקום,
אבל היא נמצאת בתמליל.

---

## 7א. מדריך הפעלה — S0, שלב־אחר־שלב (אתה מריץ)

כל הפקודות אומתו מול `learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac`
(עודכן 16.03.2026) **[נמדד]**. הרץ לפי הסדר. **אל תדלג על שלב 3.**

### דרישות מוקדמות
- ב-Entra: תפקיד **Exchange Administrator**.
- ב-Exchange Online: חברות בקבוצת **Organization Management**.

### שלב 1 — רישום אפליקציה (פורטל Entra)
1. `entra.microsoft.com` → **Applications → App registrations → New registration**.
2. שם: `KALFA Calendar Service`. Account types: **Single tenant**. בלי Redirect URI
   (זה daemon, אין דפדפן).
3. אחרי היצירה, העתק מדף ה-Overview: **Application (client) ID**.
   ה-**Directory (tenant) ID** אמור להיות `11926da5-9d16-45e3-947b-27b2909ba6c5`
   — אשר שזה מה שמופיע.

### שלב 2 — ✅ תעודה (בוצע 15.08.2026), לא client secret
**הבעלים בחר במסלול התעודה — הטוב מבין השניים**, כי המפתח הפרטי לעולם לא
עוזב את השרת ואינו עובר בשום ערוץ תקשורת.

**מה שכבר קיים על השרת** (`/var/www/vhosts/kalfa.me/beta/m365-auth/`,
תיקייה `700`, כל הקבצים ב-`.gitignore`):

| קובץ | הרשאות | תפקיד |
|---|---|---|
| `privkey.pem` | `600` | מפתח פרטי RSA 4096. **לא זז מהשרת לעולם.** |
| `cert.pem` | `644` | תעודה ציבורית — **זו שמעלים ל-Entra**. `644` מכוון: אינה סוד |
| `graph-cert.pem` | `600` | מפתח+תעודה בקובץ אחד — **זה מה ש-`certificatePath` קורא** |

**עובדות התעודה** [נמדד]:
- Thumbprint (SHA-1): `59C2AE242DAC0676247A74B8147A370D8FE3D9CD`
- תוקף עד: **14.08.2031** (5 שנים)
- חתימה: `sha256WithRSAEncryption` (SHA-1 נדחה על ידי Entra)
- **המפתח והתעודה אומתו כתואמים** — hash זהה של המפתח הציבורי משניהם

**בפורטל:** Certificates & secrets → **Certificates** → Upload certificate →
`cert.pem`. ודא שה-thumbprint שמוצג זהה לזה שלמעלה.

**✅ הרישום בוצע ואומת חי (15.08.2026):** האפליקציה `KALFA-RSVP`, התעודה
הועלתה, ה-thumbprint אומת. מצב האישורים: `1 certificate, 0 secret`.

**מזהים שיידרשו בהמשך** (אינם סודות):
```
application object id : 1fe67ad3-6621-479c-a7c4-e1d7e7ba7a87
service principal id  : 9950702b-3fc9-4fb1-91db-e8ba3b5a307d   ← זה ל-PowerShell
Graph service principal: 709e63c3-72c6-4bcf-8d77-22aeea7b6dbb
```

**הרשאות סופיות — 12 app-roles, כולן consented ומאומתות בטוקן:**
```
Calendars.ReadWrite · Calendars.ReadWrite.All · MailboxSettings.ReadWrite
Mail.ReadWrite · Mail.Send · MailboxFolder.ReadWrite.All
MailboxItem.ImportExport.All · Contacts.ReadWrite
User.ReadWrite.All · Directory.ReadWrite.All
Application.ReadWrite.All · AppRoleAssignment.ReadWrite.All
```
שתי האחרונות הן שמאפשרות לנו לנהל הרשאות **בקוד** — הוסרו 13 הרשאות
מיותרות (Teams/ConsentRequest/MultiTenantOrganization ותת-קבוצות של
Calendars) והוספו 7, הכול דרך Graph API ללא נגיעה בפורטל.
**17 מתוך תקרת 30** (12 app-roles + 5 delegated) — 13 מקומות פנויים.

**כל נקודות הקצה אומתו חי ומחזירות 200:** `calendar`, `calendarView`,
`masterCategories`, `mailboxSettings`, `messages`, `mailFolders`,
`contacts`, `users`. **`Mail.Send` במקום ⇒ S6 לא חסום בהרשאות.**

**משתני סביבה לפריסה:**
```
MS_GRAPH_TENANT_ID=11926da5-9d16-45e3-947b-27b2909ba6c5
MS_GRAPH_CLIENT_ID=69535c9d-b933-4c4b-a39d-aee3e2ecf70a
MS_GRAPH_CERT_PATH=/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem
```

⚠️ **שני ליקויים שנמצאו ברישום ודורשים טיפול:**
1. **`Supported account types = All Microsoft account users`** — נדרש
   **Single tenant**. לא חוסם (client credentials מול נקודת הקצה של הטננט
   עובד בכל מקרה), אבל חשבונות Microsoft פרטיים אינם תומכים בהרשאות
   אפליקציה כלל, והחצי הרב-דיירי הוא משטח מיותר. תיקון:
   **Authentication → Supported account types**.
2. **ה-Object ID שמופיע ב-App registrations אינו זה שנדרש ל-PowerShell.**
   `1fe67ad3-6621-479c-a7c4-e1d7e7ba7a87` הוא ה-application object.
   `New-ServicePrincipal` דורש את ה-**service principal object** מ-
   **Enterprise applications**. זו בדיוק המלכודת בשלב 4.
בקוד: `ClientCertificateCredential(tenantId, clientId, certificatePath)` —
ה-d.ts המותקן מתעד את הפרמטר כ-*"path to a PEM-encoded **public/private
key** certificate"*, ולכן נדרש הקובץ **המאוחד** ולא `cert.pem` לבדו.

⚠️ **תפוגה = כשל גלובלי שנראה נקודתי.** תעודה שפגה מפילה **כל** קריאה
כ-`auth_failed`, כולל את מסלול הבריאות היחיד שמדווח על עצמו (§6.2).
**להוסיף התראת Slack על `auth_failed` מתמשך** (3 טיקים רצופים) כחלק מ-S2.
תזכורת ביומן ל-2031 אינה מנגנון.

### שלב 3 — ✅ הוכרע ע"י הבעלים (15.08.2026): הרשאות ניתנות ב-Entra

**החלטת הבעלים: ההרשאות ניתנות ישירות ב-Entra, בלי הגבלה לתיבה בודדת.**
הנימוק שהתקבל: טננט של משתמש יחיד עם תיבה אחת — ההפרדה בין "כל התיבות"
ל"התיבה הזו" היא הפרדה תיאורטית כאן. **זו החלטה תקפה ולא לפתוח מחדש.**

**מה שנובע מכך מעשית — פחות עבודה, לא יותר:**
- **שלב 5 (PowerShell) מיותר לחלוטין.** `New-ServicePrincipal`,
  `New-ManagementScope` ו-`New-ManagementRoleAssignment` לא ישנו דבר, כי
  ההרשאות משני המקורות מתחברות באיחוד. **לדלג.**
- **ה-Object ID מ-Enterprise applications לא נדרש.** רק
  Application (client) ID.
- **שלב 6 (`Test-ServicePrincipalAuthorization`) מיותר** — אין scope לבדוק.
- נדרש רק **admin consent** על ההרשאות ב-Entra.

**היקף ההרשאות: גישה מלאה — החלטת בעלים מפורשת, סופית.** לא לצמצם, לא
להציע לצמצם, ולא לפתוח מחדש בסשן עתידי. הנימוק: טננט של משתמש יחיד, תיבה
אחת, שהיא של הבעלים עצמו.

**יתרון מעשי שנובע מכך:** `Exchange Full Access` כולל כבר את
`Calendars.ReadWrite`, `Mail.Send` ו-`MailboxSettings.ReadWrite` — כלומר
**שלב S6 (מעבר הדואר היוצא ל-Graph) לא ידרוש סבב הרשאות והסכמה נוסף.**
הכול כבר בתוקף.

<details>
<summary>הנימוק המקורי להגבלה (נשמר לתיעוד, לא בתוקף)</summary>

מיקרוסופט מזהירה שההרשאות מ-Entra ומ-Exchange RBAC מתחברות ב**איחוד**:
*"the assigned permissions are a union operation… results in no effective
resource scoping."* לכן הגבלה לתיבה בודדת מחייבת **לא** להעניק ב-Entra.
</details>
**אל תיגע ב-API permissions בפורטל.** ההגבלה שנבנה בשלב 5 היא בצד Exchange,
ומיקרוסופט מזהירה מפורשות שההרשאות משני המקורות **מתחברות באיחוד**:

> "the assigned permissions are a **union** operation on the permissions from
> Microsoft Entra ID and the permissions assigned in Exchange Online RBAC…
> it's important that you **remove** the assignment … from Microsoft Entra ID.
> Otherwise, the union … results in **no effective resource scoping**."

כלומר: הענקת `Calendars.ReadWrite` בפורטל תיתן לאפליקציה גישה **לכל התיבות
בטננט**, ותבטל בשקט את כל ההגבלה. אם כבר הענקת — הסר לפני שממשיכים.

### שלב 4 — מזהים לצד Exchange (שים לב: לא מאותו מסך)
> "**Don't use the IDs from the App Registrations page**, as it shows
> different values."

לך ל-**Enterprise applications** → חפש `KALFA Calendar Service` → משם קח:
**Application ID** ו-**Object ID**. הם שונים ממה שראית קודם.

### שלב 5 — PowerShell (Exchange Online)
```powershell
# 5.0 פעם אחת בלבד, במחשב חדש — בלי זה הפקודה הבאה תיכשל ב-"command not found"
Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser

Connect-ExchangeOnline

# 5.1 מצביע לאפליקציה (מזהים מ-Enterprise applications, שלב 4)
New-ServicePrincipal -AppId <Application ID> -ObjectId <Object ID> `
  -DisplayName "KALFA Calendar Service"

# 5.2 היקף: התיבה הזו בלבד
New-ManagementScope -Name "KALFA app mailboxes" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'netanel.kalfa@kalfa.me'"

# 5.3 הרשאות — מוגבלות להיקף הזה
New-ManagementRoleAssignment -App <Object ID> `
  -Role "Application Calendars.ReadWrite" -CustomResourceScope "KALFA app mailboxes"

New-ManagementRoleAssignment -App <Object ID> `
  -Role "Application MailboxSettings.Read" -CustomResourceScope "KALFA app mailboxes"

# 5.4 רק אם הדואר היוצא עובר ל-Graph (§4.2):
# New-ManagementRoleAssignment -App <Object ID> `
#   -Role "Application Mail.Send" -CustomResourceScope "KALFA app mailboxes"
```
שמות התפקידים אומתו מול טבלת "Supported Application Roles" בדף הרשמי [נמדד].

### שלב 6 — אימות דו-כיווני (זה השער, לא פורמליות)
הפקודה מחזירה **שורה לכל תפקיד שהוקצה** (הקצינו שניים), ו-`Format-Table`
עלול לקטוע את העמודה בטרמינל צר ולגרום לקרוא `True` כ-`False`. לכן
`Format-List`, לא `Format-Table`:

```powershell
# כל שורה חייבת להראות InScope: True
Test-ServicePrincipalAuthorization -Identity "KALFA Calendar Service" `
  -Resource netanel.kalfa@kalfa.me | Select-Object Role, InScope | Format-List

# כל שורה חייבת להראות InScope: False — אחרת ההגבלה לא עובדת
Test-ServicePrincipalAuthorization -Identity "KALFA Calendar Service" `
  -Resource <תיבה אחרת כלשהי בטננט> | Select-Object Role, InScope | Format-List
```
**שתי הבדיקות חייבות לעבור, בכל השורות.** אם השנייה מחזירה True — סימן שהוענקו הרשאות
ב-Entra (שלב 3). `Test-…` עוקף את המטמון, ולכן אפשר להריץ מיד.

### שלב 7 — המתנה
> "Changes to app permissions are subject to cache maintenance that varies
> between **30 minutes and 2 hours** depending on the app's recent usage."

הקריאה האמיתית הראשונה עשויה להיכשל עד שהמטמון מתרענן. **אם `Test-…` עבר,
כישלון בקריאה חיה בשעתיים הראשונות אינו שגיאת הגדרה** — רק להמתין.

### מה להחזיר לי
רק את **Application (client) ID** ואת אישור ששתי בדיקות שלב 6 עברו.
התעודה כבר נוצרה ואומתה (§7א שלב 2); המפתח הפרטי נשאר על השרת ואינו נשלח
לשום מקום.

---

## 8. שאלות פתוחות שדורשות תשובה שלך

| # | שאלה | למה זה חוסם |
|---|---|---|
| Q1 | ההעתקה הייתה migration batch חי או ייצוא חד-פעמי? **הערכתי: חד-פעמי** [הסקה] — תיבת IONOS עדיין חיה ומשרתת קריאות, כלומר בוצעה **העתקה ולא העברה**. אנא אשר או תקן, לא צריך לחקור | קובע אם הדלתא אוטומטית או ידנית (§4.4) |
| Q2 | כמה תיבות אנושיות אמיתיות יש ב-IONOS מלבד זו? | קובע את היקף העברת התוכן |
| Q3 | מאיזו כתובת נשלח דואר יוצא בעתיד? (`noreply@kalfa.me`?) | קובע את היקף ה-RBAC לשליחה |
| Q4 | מתי מתוכנן ביטול חשבון IONOS? | זה הדדליין האמיתי של S5, לא אוקטובר |

---

## 8א. פערים שנסגרו בסבב האימות (15.08.2026)

כל אלה היו **[דווח]** או פתוחים, ואומתו על ידי מול מקור ראשוני:

| נושא | תוצאה |
|---|---|
| RBAC for Applications — GA או preview? | **אין באנר preview בדף כלל**; מתואר כמי ש"replaces Application Access Policies". הרמז היחיד ל-preview הוא שם כתובת המשוב (`exoapprbacpreview@`) — שם, לא סטטוס. **בטוח לבנות עליו.** |
| שמות התפקידים המדויקים | אומתו מהטבלה הרשמית: `Application Calendars.ReadWrite`, `Application Calendars.Read`, `Application MailboxSettings.Read`, `Application Mail.Send`, `Application SMTP.SendAsApp` |
| מלכודת האיחוד Entra↔Exchange | **אומתה מילולית** — ראה שלב 3 ב-§7א. זה היה הפער המסוכן ביותר בכל הרשימה |
| PATCH ומוזמנים | **התיעוד אכן שותק — אימתתי בעצמי.** הדף מדבר רק על עדכון שכולל את `attendees`, על הסרת חבר מרשימת תפוצה, ועל סדרות. **על שינוי שעה בלבד — אין מילה.** שער S4 מאושר כהכרחי, לא כזהירות יתר |
| `sendMail` — הרשאה, תגובה, שמירה | `Mail.Send` (אין רמה גבוהה יותר); `202 Accepted` = התקבל, **לא** נמסר; נשמר ב-Sent Items כברירת מחדל |
| תקרת קבצים מצורפים ב-`sendMail` | לא מצוינת בדף. **מוקד ממילא** — לפי החלטת המסירוּת אנחנו שולחים **קישור מאובטח ולא PDF מצורף** |
| מגבלות שליחה של Exchange Online | **שני מנגנונים נפרדים, לא לבלבל:** (1) **TERRL** — מכסת נמענים חיצוניים יומית לטננט; NDR `550 5.7.233` [נמדד, מקור ראשוני]; טננט ניסיון מוגבל ל-5,000; הנוסחה `500 × (רישיונות^0.7) + 9,500` היא **[הסקה]** — מיקרוסופט מפרסמת רק "scales automatically with the number of licenses", לא נוסחה. (2) **תקרת `onmicrosoft.com`** — 100 נמענים חיצוניים ל-24 שעות בכל הארגון, NDR **`550 5.7.236`** לפי מקורות משניים, **לא** `5.7.233`. דוח ב-EAC → Reports → Mail flow |
| התראת Slack ב-`callback-scheduling` | **אומת בקוד** — `sendSlackAlert` בשורות 536 ו-546, עם הערה מפורשת "Counts only — no name, phone or note ever leaves the system" |
| אילו מודולים באמת חסרי טסטים | **אומת: בדיוק שלושה** — `exchange-connections`, `exchange-availability`, `console-agent-calendar-presence`. לשלושת האחרים **יש** טסטים |
| ה-cron-ים | **אומת** — `callbackScheduleSweep` ו-`calendarPresenceSync`, שניהם `*/10 * * * *` (worker/main.ts:819, 836) |
| מתג כיבוי קיים | **אומת שאין.** המפתח היחיד הוא `exchange_connection_mode` (בעלות בלבד). S1 חייב להוסיף אחד |
| `@azure/identity` — `import.meta` ב-CJS | **0 מתוך 77 קבצים** |
| הייבוא העמוק של ספק האימות | **נפתר** |
| הפער האבטחתי ב-3.0.7 | **נוכח אצלנו** — `.api()` מקבל URL עם userinfo בלי לפסול |

## 9. מה לא אומת (במפורש — לא למלא בניחוש)

**אחרי שלושה סבבי אימות נשארו בדיוק ארבעה. שניים אינם ניתנים לסגירה
מהשולחן:**

1. **האם PATCH שמשנה רק שעה מודיע למוזמנים קיימים.** התיעוד שותק — זה
   **אומת**, לא הונח. נסגר רק במדידה חיה: **שער S4**, דורש אותך ושתי תיבות.
2. **האם נדרש `serverExternalPackages` ב-`next.config.ts`** לחבילות החדשות.
   לא ניתן לבדוק לפני שקוד כלשהו מייבא אותן. שער: ה-build הראשון ב-S2.
   לא להניח לשום כיוון — ל-EWS זה נדרש, וזה לא מלמד על החבילה הזו.
3. **לוח הזמנים המדויק של סגירת Basic Auth ל-SMTP.** המקור הראשוני
   (techcommunity 4489835) חוסם fetch. מה שכן אומת ראשונית: Basic כבר סגור
   לכל שאר הפרוטוקולים ולא ניתן להפעלה. **לא חוסם** — ההמלצה שלנו ל-Graph
   `sendMail` לא תלויה בתאריך הזה.
4. **האם ה-`end` של אירוע יום-שלם הוא בלעדי** (יום אחד = חצות עד חצות
   למחרת). התיעוד דורש "חצות באותו אזור זמן" אבל לא אומר אם הסוף בלעדי.
   **לאמת בשער S2** — זו בדיוק הטעות שתציג אירוע ביום הלא נכון.

**מה שכבר לא פתוח:** מלכודת האיחוד ב-RBAC · שמות התפקידים · סטטוס ה-GA ·
מגבלות השליחה · `sendMail` · ההתראות ב-Slack · כיסוי הטסטים · ה-cron-ים ·
היעדר מתג הכיבוי · שתי בדיקות החבילה (§8א) · **`Asia/Jerusalem` מתקבל** ·
מיפוי השגיאות לפי סטטוס HTTP · מגבלות ה-throttling · אורך חיי מנויי
change-notification · ספירת `callback_requests` (§4.1ב, §6.1).

---

## 10. עדכוני זיכרון נדרשים בסיום

- `exchange-ews-workstream`: לבטל את "OAuth CLOSED — no tenant"; לבטל את
  "GetUserAvailability — do not re-litigate" (נכון ל-IONOS, לא ל-Exchange Online).
- `ews-library-no-xml-escaping`: לתייג כרלוונטי למסלול EWS בלבד.
- `email-deliverability-ionos`: לתייג את נימוק ה-DKIM כספציפי ל-IONOS.
