# נרמול נתיבי GA4 — החלפת UUID ב-placeholders לפני שליחה

**סטטוס: אושר ומומש (27.7.2026). צעד אחרון אחרי פריסה: כיבוי `pageChangesEnabled` בזרם (פקודה מוכנה בסוף המסמך).**
**רקע:** סקירת ה-compliance ‏(27.7.2026) העלתה ש-page_view האוטומטי שולח את
כתובת העמוד המלאה, ובאזור המחובר הנתיבים מכילים UUID פנימיים
(`/app/events/<uuid>/...`). לפי תיקון 13 מזהה מקוון עשוי להיות מידע אישי;
עקרון המזעור מחייב לצמצם את מה שנשלח, לא רק לגלות אותו.

## אינוונטורי — נתיבים נמדדים עם מקטעים דינמיים (נכון ל-27.7.2026)

הקבוצות הנמדדות הן `(public)/(site)` (שיווק — אין UUID) ו-`(customer)/app`.
דפי הטוקן `/r /g /ty /join` ואזור `(admin)` אינם נמדדים כלל (התג לא נטען).

| נתיב אמיתי | נתיב מנורמל |
|---|---|
| `/app/events/<uuid>` | `/app/events/[event-id]` |
| `/app/events/<uuid>/stats` | `/app/events/[event-id]/stats` |
| `/app/events/<uuid>/guests` | `/app/events/[event-id]/guests` |
| `/app/events/<uuid>/guests/<uuid>` | `/app/events/[event-id]/guests/[guest-id]` |
| `/app/events/<uuid>/guests/new` · `/import` · `/import/whatsapp` | כנ"ל עם `[event-id]` |
| `/app/events/<uuid>/campaign/<uuid>` (+`/approve` `/payment` `/agreement`) | `/app/events/[event-id]/campaign/[campaign-id]/...` |

שדות שחייבים נרמול: `page_location`, `page_path`, `page_referrer`
(ה-referrer הפנימי בניווט בין דפי האפליקציה מכיל את אותם UUID).
`page_title` נבדק: כותרות הדפים באזור האישי אינן מכילות UUID.

## המנגנון (מאומת מול התיעוד הרשמי, developers.google.com)

מקורות: `/analytics/devguides/collection/ga4/views` ‏+
`/analytics/devguides/collection/ga4/measure-spa-gtm`.

1. **כיבוי ה-page_view האוטומטי בקונפיג התג**: ‏
   `gtag('config', TAG_ID, { send_page_view: false })` — מתועד במפורש.
2. **שליחת page_view ידני** בכל ניווט (כולל הטעינה הראשונה):
   `gtag('event','page_view',{ page_title, page_location, page_path, page_referrer })`
   עם ערכים מנורמלים.
3. **כיבוי "Page changes based on browser history events"** בהגדרות
   ה-Enhanced Measurement של הזרם — מתועד כצעד חובה למניעת ספירה כפולה
   ("disable automatic history-based page views... to prevent double-counting").
   שאר מתגי ה-Enhanced Measurement (גלילה, טפסים, קליקים יוצאים) נשארים.

## השלכות ארכיטקטוניות

- הרכיב `<GoogleAnalytics>` של ‎@next/third-parties אינו חושף
  `send_page_view:false` — נדרש מעבר לטעינת gtag.js ישירה (אותו snippet רשמי)
  בתוך `GoogleAnalyticsGated`, בתוספת רכיב `PageViewTracker` ‏(usePathname)
  שמנרמל ושולח. ה-gating בהסכמה, ‏Consent Mode והחרגת דפי הטוקן — ללא שינוי.
- הנרמול חל על שתי הקבוצות הנמדדות מאותו רכיב; בדפי השיווק הנרמול הוא זהות
  (אין UUID) — אין שינוי בדיווח שלהם מלבד מעבר ל-page_view ידני.
- מימוש הנרמול: פונקציה טהורה `normalizeAnalyticsPath(path)` עם regex ל-UUID
  (`[0-9a-f]{8}-...`), ממופה לפי המקטע הקודם (events→[event-id],
  campaign→[campaign-id], guests→[guest-id], אחרת→[id]) + טסטים על כל
  האינוונטורי לעיל.

## סיכונים ואימות

- **ספירה כפולה** אם המתג בזרם לא כובה לפני הפריסה — סדר הפעולות: קוד קודם
  (ידני כבוי-אוטומטי), מתג אחריו; בפער הקצר אין אובדן, רק כפילות זמנית הפוכה.
- **אימות אחרי פריסה**: ‏DebugView/Realtime — לוודא שכל page_view מציג נתיב
  מנורמל ושהספירה אינה כפולה; השוואת ספירת page_views יומית מול יום קודם.
- **חד-כיווניות היסטורית**: נתונים שכבר נאספו עם UUID נשארים במאגר עד תום
  חלון השמירה (14 חודשים) — הנרמול צופה פני עתיד; מחיקה יזומה אפשרית דרך
  Data-deletion requests אם עו"ד ידרוש.

## תלות בהחלטות פתוחות

- שאלת עו"ד 22 (UUID = מידע אישי?) לא חוסמת — הנרמול נכון לפי עקרון המזעור
  בכל תשובה.
- אם בעתיד יאושרו מזהים כפרמטרים מפורשים (או BigQuery), הנרמול כאן אינו
  מתנגש — הוא עוסק רק בשדות ה-page.

## פקודת הצעד האחרון (להרצה מיד אחרי הפריסה, SA עם Editor או בעלים)

```bash
set -a && . ./.env.local && set +a && node -e "
const { AnalyticsAdminServiceClient } = require('@google-analytics/admin');
const c = new AnalyticsAdminServiceClient({ fallback: 'rest' });
c.updateEnhancedMeasurementSettings({
  enhancedMeasurementSettings: {
    name: 'properties/' + process.env.GA4_PROPERTY_ID + '/dataStreams/15330155015/enhancedMeasurementSettings',
    pageChangesEnabled: false,
  },
  updateMask: { paths: ['page_changes_enabled'] },
}).then(([s]) => console.log('pageChangesEnabled:', s.pageChangesEnabled));
"
```
(או ידנית: הגדרות הזרם → מדידה משופרת → הגדרות מתקדמות של צפיות בדף → ביטול
"שינויים בדפים המבוססים על אירועים בהיסטוריית הדפדפן".)
