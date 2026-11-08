# מפת מחרוזות: public

מקור: 38 קבצים. 571 רשומות ב-`public.jsonl`. מספרי שורות הם מ-1. שום דבר לא שונה בריפו.

| action | רשומות |
|---|---|
| convert | 84 |
| restructure | 336 |
| keep | 5 |
| decide | 146 |
| כבר ב-`t()` | 151 |

דגלים: legal 129, rich-text 42, dynamic-key 27, concat 14, b2b-wording 12, plural 8, gender-slash 5, logic 3, legal-signed 1. הדגלים `outbound` ו-`worker` לא הופיעו באזור הזה.

מתוך 146 רשומות `decide`, 126 הן הדפים המשפטיים ובאנר העוגיות. העטיפה עצמה לא משנה עברית, ו-D1 חוסמת את פרסום התרגום, לא את ההמרה. 20 הנותרות ממתינות להחלטה לפני העטיפה: D7, D8, D9, D10. אזור customer-auth סימן גם הוא את מחרוזות ה-`legal` שלו כ-`decide`.

## לפי קובץ

העמודה "כבר t()" סופרת ברירות מחדל עבריות שכבר עטופות. העמודה 'use client' היא "לא" בכל הקבצים, כי `getT` עובד גם ברכיבי שרת וגם ברכיבי לקוח. רכיבי לקוח יצטרכו מקור שפה כשתגיע שפה מהבקשה, וזה נושא של התשתית.

| קובץ | convert | restructure | keep | decide | כבר t() | ברמת מודול | שינוי 'use client' | סיכון |
|---|---|---|---|---|---|---|---|---|
| `(site)/_legal.tsx` | 7 | 0 | 0 | 1 | 0 | 0 | לא | אין getT. שלד לשלושת הדפים המשפטיים. שורה 27 מציגה מציין מקום למבקרים. |
| `(site)/about/page.tsx` | 2 | 20 | 0 | 0 | 9 | 18 | לא | השדה t מצל על המתרגם ב-.map בשורות 142, 158. שורה 64 טוענת שהממשק "לא תורגם". about-page.test קורא את המקור. |
| `(site)/contact/actions.ts` | 0 | 5 | 0 | 0 | 0 | 5 | לא | קבועים ברמת מודול בקובץ use server. הודעות ההצלחה משותפות ל-honeypot ולכן מפתח אחד לכל אחת. |
| `(site)/contact/inquiry-forms.tsx` | 0 | 0 | 0 | 2 | 10 | 0 | לא | שני נוסחי גילוי והסכמה. שורה 198 מצטטת ערך topic. |
| `(site)/contact/page.tsx` | 0 | 3 | 1 | 0 | 4 | 2 | לא | שורה 40 'תמיכה' היא ערך logic. אסור לעטוף. |
| `(site)/cookies/page.tsx` | 0 | 0 | 0 | 39 | 0 | 2 | לא | אין getT. כל הדף legal, ורוב הפסקאות rich-text. site-metadata.test. |
| `(site)/error.tsx` | 0 | 0 | 0 | 0 | 6 | 0 | לא | הומר במלואו. |
| `(site)/faq/page.tsx` | 0 | 8 | 0 | 0 | 3 | 6 | לא | רוב התוכן מגיע מ-faq_items ומ-business-facts, לא מהקובץ הזה. ראו M8. |
| `(site)/guest-list-template/page.tsx` | 1 | 33 | 2 | 0 | 16 | 32 | לא | הטבלה מרונדרת מ-import-template. שדה t מצל בשורות 230, 246. המערך FAQ מזין גם JSON-LD. |
| `(site)/page.tsx` | 1 | 56 | 0 | 15 | 34 | 63 | לא | הקובץ הגדול ברשימה. שדה t מצל בשורות 429, 476, 516, 542, 568. תצוגת דמה ב-D7. ה-H1 מפוצל. |
| `(site)/privacy/page.tsx` | 0 | 0 | 0 | 38 | 0 | 2 | לא | אין getT. legal. privacy/page.test.tsx בודק טקסט מרונדר, ולכן מנגנון rich-text חייב לרנדר את ברירת המחדל. |
| `(site)/terms/page.tsx` | 0 | 0 | 0 | 29 | 0 | 2 | לא | אין getT. legal. ייתכן נוסח חיוב ישן (D2). שורה 99 כוללת "[לאישור עו״ד]". |
| `(site)/whatsapp/page.tsx` | 4 | 19 | 0 | 0 | 11 | 18 | לא | שדה t מצל בשורה 130. המערך FAQ מזין גם JSON-LD. |
| `cb/[token]/actions.ts` | 4 | 2 | 0 | 1 | 0 | 2 | לא | ההודעה של ה-honeypot בשורה 68 שונה מההודעה האמיתית (D10). |
| `cb/[token]/intake-form.tsx` | 0 | 1 | 0 | 0 | 5 | 0 | לא | מחרוזת אחת נותרה. |
| `cb/[token]/page.tsx` | 0 | 3 | 0 | 0 | 2 | 1 | לא | dir="rtl" קשיח, mr-1 פיזי, כפילות של BrandLine. |
| `error.tsx` | 0 | 0 | 0 | 0 | 5 | 0 | לא | הומר במלואו. |
| `g/[token]/gift-landing.tsx` | 0 | 0 | 0 | 0 | 6 | 0 | לא | הומר, אבל מציג טקסט מ-lib: greeting, כותרת, תאריך עברי. |
| `g/[token]/page.tsx` | 0 | 1 | 0 | 0 | 2 | 1 | לא | רק כותרת metadata. |
| `join/[token]/page.tsx` | 0 | 2 | 0 | 0 | 5 | 1 | לא | כותרת metadata "לארגון" מול כותרת הדף "לצוות". |
| `r/[token]/actions.ts` | 4 | 7 | 0 | 0 | 0 | 7 | לא | REASON_MESSAGES לפי קוד. הודעות גנריות חייבות להישאר גנריות. |
| `r/[token]/page.tsx` | 0 | 1 | 0 | 0 | 2 | 1 | לא | רק כותרת metadata. |
| `r/[token]/rsvp-form.tsx` | 2 | 6 | 0 | 0 | 17 | 3 | לא | STATUS_LABELS עם גרש נטוי, ושורה 394 משלבת plural, גרש נטוי ותווית אירוע. |
| `rate/[token]/actions.ts` | 3 | 0 | 1 | 0 | 0 | 0 | לא | שורה 60 לא מוצגת למשתמש. |
| `rate/[token]/page.tsx` | 0 | 1 | 0 | 0 | 2 | 1 | לא | רק כותרת metadata. |
| `rate/[token]/rating-form.tsx` | 0 | 6 | 0 | 0 | 8 | 6 | לא | OPTIONS ו-FEEDBACK ברמת מודול. |
| `ty/[token]/page.tsx` | 0 | 1 | 0 | 0 | 2 | 1 | לא | רק כותרת metadata. |
| `ty/[token]/thankyou-landing.tsx` | 0 | 0 | 0 | 0 | 2 | 0 | לא | הומר, אבל מציג טקסט מ-lib: EVENT_THANKYOU_GREETING, כותרת, תאריך עברי. |
| `components/consent/manage-cookies-button.tsx` | 1 | 0 | 0 | 0 | 0 | 0 | לא | ברירת מחדל שאף קורא לא משתמש בה. ns common. |
| `components/oauth-consent.tsx` | 14 | 1 | 0 | 0 | 0 | 0 | לא | ns customer. אין getT. |
| `components/site/call-me-now-widget.tsx` | 15 | 11 | 0 | 1 | 0 | 11 | לא | dir ו-DirectionProvider קשיחים. res.error הוא עברית מהשרת. גילוי על הקלטה ב-D9. |
| `components/site/event-type-page.tsx` | 18 | 1 | 0 | 0 | 0 | 0 | לא | אין getT. cadence נבנה בעברית ב-tokens.ts. שדה t מצל בשורה 122. |
| `components/site/site-footer.tsx` | 5 | 8 | 0 | 0 | 0 | 8 | לא | אין getT. site-footer.test מקבע שני aria-label כלשונם ואת label ב-FOOTER_PAGE_LINKS. |
| `components/site/site-header.tsx` | 2 | 0 | 0 | 0 | 0 | 0 | לא | אין getT. |
| `hooks/use-oauth-consent.ts` | 1 | 3 | 0 | 0 | 0 | 3 | לא | ns customer. הקבועים נקראים בתוך effect ו-callback. |
| `lib/consent/cookie-consent-config.ts` | 0 | 0 | 0 | 20 | 0 | 9 | לא | הכול legal. נבנה גם בזמן import. analytics-gate.test קורא את cookieConsentConfig. |
| `lib/marketing/consent-wording.ts` | 0 | 0 | 1 | 0 | 0 | 1 | לא | legal-signed. לא לגעת. |
| `lib/marketing/event-types.ts` | 0 | 137 | 0 | 0 | 0 | 137 | לא | משמש בזמן import בארבעה דפים, בפוטר וב-llms.txt. event-types.test קורא את EVENT_TYPES. |

## פריטים שאינם טקסט (נרשמו, לא תוקנו)

**חצים פיזיים** (11 אייקונים ב-7 קבצים):
- `ArrowLeft`: `about/page.tsx:203`, `guest-list-template/page.tsx:166,298`, `(site)/page.tsx:302,501,612`, `whatsapp/page.tsx:112`, `event-type-page.tsx:106,259`, `site-header.tsx:63`.
- `ArrowRight`: `_legal.tsx:40`.

**`lang`/`dir` קשיחים:**
- `cb/[token]/page.tsx:58` `dir="rtl"`.
- `call-me-now-widget.tsx:135` `DirectionProvider direction="rtl"`, ושורה 136 `dir="rtl"`.
- `cookie-consent-config.ts:201,206` `default: 'he'`, `rtl: 'he'`.
- JSON-LD: `about/page.tsx:108` `inLanguage: 'he-IL'`, `(site)/page.tsx:234,242` `inLanguage: 'he'`, `(site)/page.tsx:208` `availableLanguage: ['he']`.
- `dir="ltr"` על מספרים, כתובות ומזהים הוא נכון ונשאר: `cb/[token]/page.tsx:89,113`, `_legal.tsx:63`, `inquiry-forms.tsx:112`, `oauth-consent.tsx:88,93,98`, `cookies/page.tsx:120,148,149,179,181,182`.

**CSS פיזי:** `cb/[token]/page.tsx:90` `mr-1`. הרקע הדקורטיבי בשורות 133-139 משתמש ב-`-left-` ו-`-right-`.

**פורמט `he-IL` ותאריכים:**
- אין קריאת `he-IL` ישירה בקבצים שלי, חוץ מ-`inLanguage` למעלה.
- `formatEventDateLine` (`gift-landing.tsx:47`, `thankyou-landing.tsx:28`, `rsvp-form.tsx:147`) מחזיר יום בשבוע ותאריך עברי. המקור ב-`src/lib/data/event-display.ts` (אזור lib-data).
- `formatOutreachScheduleHe` (`event-type-page.tsx:55`) בונה עברית עם `toLocaleString('he-IL')` ב-`src/lib/faq/tokens.ts:28` (אזור lib-other).
- תאריכים כתובים ידנית: `cookies/page.tsx:41,231`, `privacy/page.tsx:51`, `terms/page.tsx:35`, `(site)/page.tsx:360`.

**אחרים:** placeholder `050-1234567` ב-`call-me-now-widget.tsx:193`. `₪100` ב-`terms/page.tsx:90`. `locale: 'he_IL'` קשיח ב-`src/lib/seo/open-graph.ts:39` (אזור lib-other).

## מנגנונים משותפים

**M1. מחרוזות ברמת מודול.** פונקציה מקומית שקוראת ל-`getT` בתוכה ומחזירה את המערך, והרינדור קורא לה.
- מאומת במקור של `i18next-cli`: `getT` הוא שם מוכר כברירת מחדל (`extractor/parsers/scope-manager.js:181`). גם פרמטר `t: TFunction<'public'>` נקלט עם ה-namespace (`extractor/core/ast-visitors.js:769`). פרמטר בלי הטיפוס הזה נופל ל-`defaultNS`, שהוא `common` (מוסק מקריאת הקוד, לא הורץ).
- `.map(({ t, d }) => ...)` מצל על המתרגם. קריאה ל-`t()` בתוך callback כזה תיכשל בזמן ריצה, כי `t` שם הוא מחרוזת. לשנות את השדה ל-`title`.

**M2. משפט מפוצל סביב אלמנט** (42 רשומות: 27 בדפים המשפטיים, 15 מחוץ להם). `t()` מחזיר מחרוזת.
- לפי התיעוד, `Trans` של `react-i18next` מקבל `i18nKey`, `ns`, `t`, `defaults`, `values`, `components`. למקרה Server Component התיעוד מציג את `IcuTransWithoutContext` עם `t` וגם `i18n`.
- `i18next-cli` מחלץ `Trans` כברירת מחדל (`extractor/core/extractor.js:49`).
- לא אומת: האם `t` לבד מספיק. `getT` מחזיר רק `t`, לכן כנראה צריך גם לחשוף את ה-instance מ-`src/lib/i18n/index.ts`. החבילה לא מותקנת, אז לא ניתן לבדוק.
- חלופה בלי תלות: פיצול למפתחות. זה שובר סדר מילים בשפות אחרות, ולא מתאים לטקסט משפטי.
- החלטה: D5. ב-`text` של הרשומות `<0>...</0>` מסמן את האלמנט, `<br/>` מסמן שבירת שורה ו-`{{...}}` מסמן ביטוי.

**M3. `metadata` סטטי** (15 דפים ברשימה).
- לפי `generate-metadata.md`, אי אפשר לייצא `metadata` וגם `generateMetadata` מאותו segment, ושניהם נתמכים רק ב-Server Components.
- `TITLE` ו-`DESCRIPTION` משמשים גם ב-JSON-LD (`about/page.tsx:106-107`), ולכן צריך פונקציה אחת שמחזירה אותם לשני השימושים.
- `wedding`, `brit`, `bar-mitzva`, `event` (`page.tsx`) לא ברשימה של אף אזור, כי אין בהם עברית, אבל הם קוראים `getEventType()` ברמת מודול וצריכים אותו שינוי. כך גם `src/app/oauth/consent/page.tsx` (אזור customer-auth).

**M4. בחירה לפי ערך** (27 רשומות): `REFUSAL_MESSAGE`, `REASON_MESSAGES`, `STATUS_LABELS`, `FEEDBACK`, `SECTION_EYEBROW`. מפה סטטית בתוך הפונקציה עם קריאות `t` מפורשות, כדי ש-`extract` יראה כל מפתח.

**M5. רבים** (`rsvp-form.tsx:394-395`).
- נמדד ב-`Intl.PluralRules`: he `one, two, other`; en `one, other`; fr `one, many, other`.
- לפי התיעוד, `count` חייב להופיע בקריאה ואין נפילה למפתח הבסיס. ברירות מחדל נכתבות כ-`defaultValue_one` ו-`defaultValue_other`.
- לפי המקור, `extract` משלים קטגוריות חסרות מ-`defaultValue_other` (`extractor/parsers/call-expression-handler.js:958`), ולכן `_two` יקבל את הצורה הקיימת "משתתפים". עברית לא משתנה.

**M6. הודעות Server Action** (27 רשומות). `getT` בתוך ה-action או ה-middleware. קבועים ברמת מודול (`RATE_ERROR`, `REASON_MESSAGES`, `UNAVAILABLE`) עוברים פנימה. מקור השפה בבקשת action עוד לא נקבע. הודעות גנריות על טוקן לא תקף חייבות להישאר גנריות בכל שפה.

**M7. באנר עוגיות.**
- לפי תיעוד `vanilla-cookieconsent`: `language.translations` מקבל לכל שפה אובייקט, נתיב או פונקציה. `language.autoDetect: 'document'` קורא את `lang` של `<html>` ונופל ל-`default` אם אין תרגום. `language.rtl` מקבל מחרוזת או מערך.
- קבועי `*_SECTION` נקראים בזמן import, וכך גם `cookieConsentConfig` המיוצא בשורה 235. לכן צריך להפוך את הקבועים לפונקציות ולהעביר את הבדיקות ל-`buildCookieConsentConfig(BASELINE_ADMIN_CONFIG)`.
- הבאנר מורכב ב-root layout ומכסה את כל האזורים, ולכן ns `common`. אין עדיין `src/locales/he/common.json`.
- מחרוזות עם `<a href>` מוצגות כ-HTML. כשיהיו קידומות שפה, ה-href יצטרך ערך.

**M8. תוכן `/faq`.** זו הזרימה, מהקוד ומה-migration, בלי DB חי:
1. `getPublishedFaqItems()` (`src/lib/data/faq.ts`) קורא מטבלת `faq_items`: `item_key, category, question, answer, sort_order, published`. אין עמודת שפה. `item_key` הוא NULL בכל שורה רגילה.
2. `buildFaqPageModel()` (`src/lib/faq/page-model.ts`) מחליף טוקנים `{{...}}` ומוסיף שתי שאלות שבבעלות הקוד, כותרות קטגוריה (`FAQ_CATEGORY_TITLES`) ותשובת מחיר.
3. תשובות המחיר מגיעות מ-`facts.summary_he`, `pricing_rule_he`, `billing_unit_he` (`src/lib/fleet/business-facts.ts`). לפי החוזה בראש הקובץ הוא טהור ובלי imports, כי `scripts/fleet-agent-cli.ts` אורז אותו, ולכן הוא לא אמור לקרוא ל-`getT`. גם ה-drafter משתמש בו.
4. אותו מודל מזין גם את ה-JSON-LD.

`t()` לא מתאים: התוכן נערך ב-`/admin/faq`, ולשורות אין מזהה יציב שאפשר להפוך למפתח סטטי. הכיוון שאני מציע הוא טבלת תרגום `faq_item_translations` עם נפילה לעברית ושדות לכל שפה ב-`/admin/faq`. זה migration ו-RLS, ולכן דורש אישור (D4). משפטי המחיר צריכים גרסה תלוית שפה בצד הצרכן, ו-`_he` נשאר ל-drafter. גם שמות חבילות ותיאוריהן מה-DB בעברית.

**M9. קטלוג `event-types.ts`.**
- `slug` ו-`path` נשארים ברמת מודול. `sitemap.ts` חייב להכיל את המחרוזת `EVENT_TYPES.map`, כי הבדיקה מקבעת אותה.
- התוכן עובר ל-`getEventTypeContent(slug)` עם `getT` בפנים.
- הבדיקות שמריצות `JSON.stringify(EVENT_TYPES)` הן שומרי אמינות (הושבה, xlsx, תאריכי שליחה). צריך להפנות אותן לפלט הפונקציה, אחרת הן עוברות בלי לבדוק כלום.
- `llms.txt` הוא `force-static` וקורא `description`, ולכן רץ בלי שפת בקשה.

**M10. גרש נטוי** (5 רשומות). `context` של i18next דורש ערך מגדר, ובטופס `/r` אין שדה כזה (מוסק מהשדות בשימוש). בעברית הטקסט נשאר. ב-en/fr צריך ניסוח נייטרלי (D6).

## בדיקות שמקבעות מקור

יש לעדכן אותן באותו שינוי, אחרת הן יישברו או יפסיקו לבדוק:

| בדיקה | מה תלוי בה | תוצאה בלי עדכון |
|---|---|---|
| `src/app/(public)/(site)/site-metadata.test.ts` | `literal()` מחפש `const TITLE =` ו-`title: '...'`. `hasField()` קורא רק מה שלפני `export default` | בדיקות ייחודיות ואורך מדלגות בשקט. `generateMetadata` חייב להישאר מעל ה-default |
| `src/components/site/site-footer.test.ts` | `aria-label="אישורי הגעה לפי סוג אירוע"`, `aria-label="משפטי ותמיכה"`, `FOOTER_PAGE_LINKS[].label` | נכשלת |
| `src/lib/marketing/event-types.test.ts` | `EVENT_TYPES` עם כל השדות, `pageSrc` ל-`alternates:`, `title:`, `description:`, `EVENT_TYPES.map` ב-sitemap | נכשלת או עוברת בלי תוכן |
| `src/lib/consent/analytics-gate.test.ts` | `cookieConsentConfig.language.translations.he` | נשברת אם הייצוא יוסר |
| `src/lib/marketing/consent-wording.test.ts` | הנוסח והגרסה | נשאר ירוק כי לא נוגעים |
| `src/hooks/use-oauth-consent.test.ts` | `clientName: 'אפליקציה'` | נשאר ירוק עם ברירת מחדל |
| `src/app/(public)/(site)/privacy/page.test.tsx` | טקסט עברי מרונדר | תלויה בכך שמנגנון rich-text מרנדר ברירת מחדל |

## תלויות באזורים אחרים

טקסט שמוצג בדפים שלי אבל הקובץ שלו באזור אחר:
- `src/components/guest/guest-shell.tsx:39` "מנוהל באמצעות" (shared, מפתח `guest.brandLine`). כפול ב-`cb/[token]/page.tsx:111`, ולכן הרשומה שלי משתמשת באותו מפתח. shared רשם רק את הקידומת ואני את המשפט המלא, ולכן זה המפתח היחיד עם `text` שונה בין האזורים. guest-shell עצמו לא נרשם ב-`public.jsonl`.
- `src/components/forms/callback-fields.tsx` (shared): `TopicSelect` מציג את `INQUIRY_TOPICS` כערך וגם כתווית. צריך להפריד תווית מערך. התוויות הן `common:inquiry.topic.*` (lib-data), והערך נשאר בעברית כי `callback-scheduling.ts` מנתב לפי `'מכירות'` (לפי ההערה ב-`callback-fields.tsx`, לא אומת בקוד הניתוב).
- הודעות Zod ב-`src/lib/validation/rsvp.ts`, `inquiries.ts`, `rating.ts` (lib-data), שמוצגות דרך `FieldError`.
- `EVENT_TYPE_LABELS`, `EVENT_THEME[].greeting`, `EVENT_THANKYOU_GREETING`, `eventHeadingFor`, `GIFT_BRAND[].label` (lib-data).
- `src/components/add-to-calendar-island.tsx` (shared).
- `/api/call-me-now/request-code/route.ts` (shared) מחזיר `error` בעברית, והווידג'ט מציג אותו כמו שהוא. צריך קוד שגיאה.
- `TEMPLATE_HEADER`, `TEMPLATE_SAMPLE_ROWS` (lib-other). המפתח הקיים `site.guestListTemplate.file.sampleNote` מצטט את השורה "סבתא רחל".
- `buildBreadcrumbJsonLd`, `pageOpenGraph` (lib-other).

## החלטות בעלים

- **D1.** האם לתרגם terms, privacy, cookies ובאנר העוגיות, מי מאשר משפטית, ואיזו שפה מחייבת.
- **D2.** terms סעיף 3-4 ו-privacy סעיף 3 מתארים חיוב לפי תוצאה, ואילו `pricing_rule_he` אומר מחיר קבוע ששולם פעם אחת. לאשר את מקור העברית לפני תרגום. מוסק מהשוואת הטקסטים.
- **D3.** ניסוח עסקי מול B2C: "אירועי חברה", "כנסים", "פרטיים ועסקיים" וקטלוג `/event`. כבר עטופים ובעלי תרגום: `site.about.hero.intro` (`about/page.tsx:134`), `site.home.audiences.subtitle` (`(site)/page.tsx:560`).
- **D4.** מנגנון התרגום של `faq_items`: טבלת תרגום או חלופה. כולל migration.
- **D5.** rich-text: להתקין `react-i18next` בשביל `Trans`, או לפצל למפתחות.
- **D6.** צורת `מגיע/ה` ו`משתתף/ת` ב-en/fr.
- **D7.** תצוגת הדמה בדף הבית: לתרגם, להתאים למקום או להשאיר. כולל המפתח הקיים `site.home.preview.eventName`.
- **D8.** מצייני מקום שמוצגים למבקרים: `[יושלם בהגדרות פרטי החברה]` (`_legal.tsx:27`), `[לאישור עו״ד]` (`terms/page.tsx:99`).
- **D9.** שלושה נוסחי גילוי והסכמה (`call-me-now-widget.tsx:171`, `inquiry-forms.tsx:64,198`): שפת הגילוי מול שפת השיחה, והאם לשמור נוסח וגרסה כראיה.
- **D10.** `cb/[token]/actions.ts:68` שונה מהנוסח בשורה 101, למרות שהערת הקוד אומרת שהם זהים. לאחד או להשאיר.
- **D11.** הסכמה לדיוור (`consent-wording.ts`) היא עברית בלבד ונשמרת כראיה. ללקוח ב-en/fr צריך נוסח וגרסה לכל שפה, או להשאיר עברית.
- **D12.** טענות שלא יהיו נכונות בתרגום: "לא תורגמו" (`about/page.tsx:64`), "מערכת ישראלית בעברית" (`about/page.tsx:30`), "ממשק בהיר בעברית" (`(site)/page.tsx:110`).
- **D13.** תבנית הרשימה: הכותרות בעברית והייבוא מצפה להן. האם הקובץ והטבלה נשארים בעברית בדפי en/fr.
- **D14.** שפת דפי הטוקן לאורח (`/r`, `/g`, `/ty`): לפי האורח, לפי הדפדפן או לפי האירוע. טרם הוחלט.

## כיסוי

38 מתוך 38 קבצים נקראו במלואם דרך Serena, עד השורה האחרונה. אין קובץ שלא נקרא.

בדיקות שלמות, בוצעו בהרצה:
- סריקת AST על כל הקבצים: 818 שורות עם עברית מחוץ להערות, 0 לא מכוסות.
- 183 ממצאים של `lint-raw.txt` בקבצים האלה, 0 לא מכוסים.
- מספרי `instrument` שונים בתשעה קבצים (למשל `(site)/page.tsx` 42 מול 63). בדיקת ה-AST היא הקובעת, לא הספירה שלו. רק בשני קבצים הוא ספר יותר ממני, בשלוש מחרוזות בכל אחד: `rating-form.tsx` (9 מול 6) ו-`site-footer.tsx` (11 מול 8). זה מתאים לשלוש מחרוזות ה-class באנגלית ב-`TONE_CLASS` וב-`LINK_CLASS`. מוסק מהספירה, כי הפלט שלו לא מפרט מחרוזות.
- מפתחות מול שאר האזורים (customer-auth, shared, lib-data, lib-other): אין מפתח עם טקסט שונה, חוץ מ-`guest.brandLine` שמוסבר למעלה, ואין מפתח שהוא גם עלה וגם הורה. `admin.jsonl` עוד לא היה קיים בזמן הבדיקה.
- אין התנגשות בין מפתחות מוצעים לבין `src/locales/he/public.json`. שלושה מפתחות קיימים נעשה בהם שימוש חוזר: `r.rateLimited`, `rate.rateLimited`, `rate.invalidLink`.

שתי רשומות הן סינתטיות ומסומנות ב-`text`: `TEMPLATE_HEADER` ו-`TEMPLATE_SAMPLE_ROWS`. בקובץ אין מחרוזת, אבל הן מסמנות מקומות שאסור לעטוף.
