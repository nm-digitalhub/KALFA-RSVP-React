# המלצת אירועי GA4 ל-KALFA — גרסה 2 (מתוקן לפי ביקורת הבעלים)

> ‏27.07.2026. גרסה 1 נכתבה ע"י סוכן-מומחה (מקורות: תיעוד גוגל הרשמי, קוד `@next/third-parties@16.2.12` המותקן, סריקת ריפו, הצלבת Context7). **גרסה 2 מיישמת את ביקורת הבעלים במלואה** — חמישה תיקונים מחייבים + דיוקי ניסוח. ההיקף שנסרק בריפו: ‏`src/app/auth/actions.ts`, ‏`src/app/(public)/(site)/contact/{actions.ts,inquiry-forms.tsx}`, ‏`src/app/(customer)/app/events/{actions.ts,[id]/guests/import/**,[id]/campaign/**}`, ‏`src/lib/validation/inquiries.ts`, שני ה-layouts הנושאים את התג — רשימה סגורה; טענות על קוד מוגבלות לקבצים אלה.

## תיקוני גרסה 2 (מיפוי לביקורת)

1. ‏**begin_checkout הוסר** → ‏custom‏ `campaign_started` (מסחר-אלקטרוני אינו המודל; מיפוי כפוי היה מעוות את משפך ה-ecommerce).
2. ‏**add_payment_info הוסר** → ‏custom‏ `payment_authorized` ("תפיסת מסגרת" היא תוצאת authorization, לא מסירת פרטי תשלום; ו-ceiling אינו ערך-עסקה — לא נשלח כ-value עד הכרעה עסקית).
3. ‏**transaction_id ≠ campaignId** → מזהה-חיוב ייחודי ויציב לכל חיוב בפועל (מזהה פנימי/מזהה ספק-סליקה, ללא PII) — ‏campaignId נפסל בגלל תרחישי חיוב-חוזר/תיקון/חלקי/refund שיפעילו דה-דופליקציה שגויה. בחירת השדה המדויק — בזמן מימוש מול שכבת ה-billing.
4. ‏**honeypot לא ייצור generate_lead** — נדרש חוזה מפורש בין הודעת ה-UI (זהה לבוט וללקוח בכוונה) לבין דגל אנליטיקה נפרד: ‏`state.analyticsAccepted: boolean` שנקבע true רק בליד אמיתי שנשמר. אין "רעש נסבל" ב-Key Event.
5. ‏**טענת "אפס Key Events — אומת חי" הוסרה.** הניסוח הנכון: מצב ה-Key Events ב-GA4 Admin לא אומת ישירות; דגימת Data API החזירה `isKeyEvent=(not set)` — אין להסיק מכך שאין אירועים מרכזיים מוגדרים (וייתכן ש-purchase מסומן כברירת-מחדל בנכסי web).

## א. יסודות (מדויק)

**ארבע שכבות אירועים:**
1. **Automatically collected** — נאספים במסגרת הטמעה תקינה בלי קוד ייעודי: ‏`page_view`, ‏`session_start`, ‏`first_visit` (התנהגות page_view תלויה גם בתצורת התג). בהטמעה הנוכחית (‏`@next/third-parties` + ‏history-tracking) — אין לשלוח אותם ידנית.
2. **Enhanced measurement** — אחרי הפעלת toggles ב-Admin: ‏scroll, ‏click יוצא, ‏file_download, ‏form_start/form_submit, ‏video.
3. **Recommended events** — שמות סטנדרטיים (`sign_up`, `login`, `generate_lead`, `purchase`...) שמעדכנים ממדים/מדדים מוגדרים-מראש ומאפשרים ל-GA4 להבין את הפעולה. **דיוק:** הם אינם "פותחים ייבוא ל-Ads" לבדם — לשימוש ב-Ads יש לסמן כ-Key Event וליצור Conversion ב-Google Ads.
4. **Custom** — נאסף רגיל; **פרמטרים מותאמים שרוצים לנתח בדוחות דורשים בדרך-כלל רישום כ-Custom Dimensions/Metrics ב-Admin** (ר' סעיף ו').

**Key Events:** סימון ב-Admin → Events; עד **30** ב-Standard (‏**50** ב-360). מופיעים בדוחות GA4 ויכולים לשמש ליצירת Ads conversions; אינם יוצרים audiences מעצמם.

**כללי שמות:** מתחיל באות; אותיות/ספרות/`_`; ‏case-sensitive; שם עד 40 תווים; עד 25 פרמטרים לאירוע; ערך עד 100 תווים (חריגים: ‏page_title‏ 300, ‏page_referrer‏ 420, ‏page_location‏ 1000). אין מגבלת שמות-ייחודיים ל-web streams (מגבלת 500 = ‏app streams).

**`sendGAEvent('event', '<name>', {params})`** — דורש `<GoogleAnalyticsGated/>` ‏mounted בעץ; קריאה לפני אתחול התג ⇒ ‏console.warn והאירוע נבלע. **דרישת מימוש:** אין לירות על סמך mount בלבד — יש לוודא שהסכמת analytics התקבלה ושהתג אותחל בפועל.

## ב. משטחי מדידה ומנגנון-אחרי-redirect

התג נטען ב-`(public)/(site)/layout.tsx` וב-`(customer)/app/layout.tsx` בלבד (אומת בקבצים אלה; **בזמן מימוש: grep אימות ל-GoogleAnalyticsGated/GoogleAnalytics בכל העץ** כתנאי-שער). דפי הטוקן `/r /g /ty /join` מוחרגים ברמת ה-layout — הגנת הפרטיות מובנית מבנית, לא תלוית-אירועים.

**מנגנון אירוע-אחרי-redirect (רוב ה-Server Actions שלנו):**
- **ברירת המחדל: cookie חד-פעמי.** ‏TTL קצר (שניות), ‏SameSite=Lax, ‏path מוגבל ככל האפשר, קריאה+מחיקה אטומיות, ירי-בדיוק-פעם-אחת (הגנה מ-refresh, ‏BFCache, שני טאבים).
- **query-flag רק כשאין ברירה** — ורק אחרי אימות שהפרמטר אינו נאסף ל-page_location לפני הניקוי (הוא מלכלך נתוני דפים גם בלי PII).
- פעולות בלי redirect (‏useActionState): ‏effect שיורה רק על מעבר-state חדש (זהות אובייקט), לא על כל re-render.

## ג. טבלת האירועים (v2)

‏**ר** = שם/פרמטר רשמי · **ש"ד** = שיקול-דעת

| # | פעולה עסקית | שם GA4 (v2) | פרמטרים (ללא PII) | נקודת שליחה | Key Event? | תיעוד |
|---|---|---|---|---|---|---|
| 1 | הרשמה הושלמה | `sign_up` | `method:'email'` | ‏`/auth/signup/success` — פעם אחת בלבד, אחרי יצירת חשבון בפועל (לא בכל טעינה); ‏cookie-flag למסלול ה-session-המיידי | כן | ר |
| 2 | התחברות | `login` | `method:'email'` | ‏cookie-flag שנקבע רק בזרימת credentials אמיתית — **לא** בשחזור session ולא בכניסה אוטומטית אחרי הרשמה (מניעת ניפוח) | לא | ר |
| 3 | טופס יצירת קשר | `generate_lead` | ‏`lead_source:'contact_form'` (רשמי; אפשר גם הנושא) | ‏effect על `analyticsAccepted===true` — **דגל נפרד מ-notice; ‏honeypot לעולם לא מדליק אותו** | כן | ר |
| 4 | בקשת "חזרו אליי" | `generate_lead` | ‏`lead_source:'callback_request'` | כנ"ל | כן | ר |
| 5 | יצירת אירוע-שמחה | custom `celebration_event_created` (v2 — חד-משמעי מול ישות המוצר) | ‏`event_type` | ‏cookie-flag אחרי redirect | לא | ש"ד |
| 6 | ייבוא אורחים | custom `guest_import` | ‏`method:'csv'│'whatsapp'`, ‏`guest_count` (v2 — לא `count` הגנרי; מספר בלבד) | ‏effect על state.done | לא | ש"ד |
| 7 | הפעלת אישורי הגעה | **custom `campaign_started`** (v2 — ‏begin_checkout נפסל) | — | ‏cookie-flag אחרי redirect | כן | ש"ד |
| 8 | חתימת הסכם | custom **`agreement_signed`** (v2 — עבר, לא פקודה) | — | ‏cookie-flag אחרי redirect ל-payment | **כן** | ש"ד |
| 9 | תפיסת מסגרת | **custom `payment_authorized`** (v2 — ‏add_payment_info נפסל; בלי value עד הכרעה עסקית על משמעות ה-ceiling) | — | רכיב שקורא `?held=1` + ‏router.replace (query קיים כבר בזרימה — לאמת אי-איסוף ל-page_location) | כן | ש"ד |
| 10 | **חיוב סופי** | `purchase` | ‏`transaction_id:<מזהה-חיוב ייחודי — לא campaignId>` (v2), ‏`currency:'ILS'`, ‏`value:<final amount>`, ‏`items:[{item_id:'rsvp_outreach', item_name:'RSVP outreach service', price:<amount>, quantity:1}]` (v2) | ‏handler על `outcome==='charged'` | **כן — המרכזי** | ר |
| 11* | חיוב נדחה | custom `charge_declined` | ‏`decline_category` מ-allowlist לא-רגיש: ‏insufficient_funds/issuer_declined/technical_error/unknown (v2 — לא הודעת gateway גולמית) | ענף שלילי באותו handler | לא | ש"ד |
| 12* | שינוי סטטוס קמפיין | custom `campaign_status_changed` עם `new_status:'activated'│'paused'│'cancelled'` (v2 — מאחד 12+13 הישנים בהבחנה מפורשת; ‏"started" נשאר אירוע נפרד כי הוא בקשת-משתמש, לא מעבר-מצב) | — | ‏state.notice | לא | ש"ד |

‏(*) = שלב 2.

## ד. שלב 1 רזה (v2)

1. **`purchase`** — נקודת השליחה קלה, אבל **זה האירוע התובעני ביותר באמינות**: ‏idempotency, מזהה-חיוב ייחודי, סכום סופי, ‏retries, ‏refunds, מניעת כפל-דיווח — נבנה ראשון ובזהירות הגדולה ביותר.
2. **`generate_lead`** — עם דגל analyticsAccepted (תיקון ה-honeypot כתנאי-שער).
3. **`sign_up`**.
4. **`agreement_signed`**.
5. **`payment_authorized`** — רק אחרי ההכרעה העסקית על value; עד אז אפשר להתחיל בארבעת הראשונים בלבד.

## ה. מה לא לשלוח (כבר אוטומטי)

‏page_view · session_start · first_visit (בהטמעה הנוכחית) · עם Enhanced Measurement: ‏file_download (יתפוס את תבנית ה-CSV), ‏form_submit/form_start, ‏click יוצא. ‏form_submit יירשם **לצד** האירועים העסקיים על אותם טפסים — אלה שני אירועים שונים, לא כפילות טכנית, אבל יש לתעד זאת כדי שהדוחות לא יפורשו שגוי.

## ו. רישום Custom Dimensions/Metrics (v2 — חובה לניתוח)

כל פרמטר custom שרוצים לפלח/לסכם בדוחות דורש רישום ב-Admin → Custom definitions:
- ‏Dimensions (event-scoped): ‏`lead_source` (אם רוצים פילוח מעבר למובנה), ‏`event_type`, ‏`method`, ‏`decline_category`, ‏`new_status`.
- ‏Metrics: ‏`guest_count` (סכימת אורחים שיובאו).
מגבלות: ‏50 event-scoped dimensions, ‏25 user-scoped, לפרופיל.

## ז. פעולות GA4 Admin (בעלים)

1. לוודא Enhanced Measurement, כולל "Page changes based on browser history events"; לאמת ב-**DebugView** שניווטי client-side נרשמים — בפרט בגלל שהתג נטען רק אחרי הסכמה.
2. אחרי מימוש ואימות: לסמן Key Events לפי הטבלה — **לבדוק קודם מה כבר מסומן** (ייתכן ש-purchase מסומן כברירת-מחדל; מצב ה-Admin לא אומת ישירות).
3. רישום ה-Custom definitions מסעיף ו'.

## ח. מגבלות הדוח (v2 — עקבי)

- **מצב GA4 Admin לא אומת ישירות** (toggles, ‏Key Events, ‏custom definitions). דגימת Data API החזירה `isKeyEvent=(not set)` — אינה הוכחה להיעדר Key Events.
- טענות-קוד מוגבלות לרשימת הקבצים שבכותרת; לפני מימוש נדרש grep-אימות לפריסת התג.
- אימות המקורות הוא corroboration (תיעוד רשמי + מימוש מותקן + אינדקס Context7 של אותו תיעוד) — לא שלושה מקורות בלתי-תלויים לחלוטין.
- אפס קוד נכתב — מחקר והמלצה בלבד.

## פסק הבעלים על גרסה 1 (מיושם כאן)

חמשת התיקונים המחייבים בוצעו (ר' "תיקוני גרסה 2"); ‏v2 הוא הבסיס למימוש בכפוף לאישור סופי.
