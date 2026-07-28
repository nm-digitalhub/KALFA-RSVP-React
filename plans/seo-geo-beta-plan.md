# SEO + GEO לאתר beta — תוכנית מאושרת-ממצאים (2026-07-27)

מטרה: שיפור דירוג בגוגל לקהל הישראלי + נראות ב-AI Overviews / ChatGPT / Perplexity / Gemini לשאילתות בעברית.
**סקופ: ריפו beta בלבד.** אין שום עבודה, המלצה או snippet לדומיין הישן.

מקור: סשן `/hebrew-seo-geo-toolkit` (ערכת הכלים ב-`.claude/skills/hebrew-seo-geo-toolkit/` — שם נמצאים גם references: geo-research.md, schema-templates.md, seo-checklist.md).

## 1. ממצאי ביקורת (נמדד מול beta.kalfa.me החי + עץ העבודה, 27.7)

| בדיקה | מצב |
|---|---|
| Title / Description | ✅ קיימים אבל רזים (description = 43 תווים, בלי ביטויי חיפוש) |
| `lang="he" dir="rtl"` | ✅ |
| OG / Twitter tags | ❌ אין |
| Canonical / metadataBase | ❌ אין |
| JSON-LD | ❌ 0 בלוקים |
| robots.txt | ✅ **כבר כתוב** — `src/app/robots.ts` (לא מקומט, לא פרוס → 404 בחי). מתיר הכול כולל בוטי AI, חוסם `/r /g /ty /join /app /admin /auth /api` |
| sitemap.xml | ✅ **כבר כתוב** — `src/app/sitemap.ts` (לא מקומט): `/`, `/contact`, `/terms`, `/privacy`, `/cookies` בלבד |
| noindex על משטחי טוקנים | ✅ `/r /g /ty` עם `robots: { index: false, follow: false }` |
| תמונת opengraph-image | ❌ אין בכלל |
| llms.txt | ❌ אין |
| FAQ / תוכן "תשובה קודם" | ❌ אין בדף הבית |
| מהירות | ✅ 0.06s |

הערה: ברגע ש-robots.ts/sitemap.ts ייפרסו, beta.kalfa.me נפתח לסריקה ולאינדוקס (אין host-awareness — זו ההתנהגות של הקוד הקיים).

## 2. P0 — ארבעה סעיפים שנותרו (ממתין ל"בצע")

### 2.0 ⛔ שער מקדים — סתירת "הושבה" (נמצא ע"י הבעלים 27.7, אומת מול הסכמה והקוד)

**אין יכולת הושבה במוצר.** אפס עמודות seating/table בסכמת guests (רק group_id), אפס קוד ב-src/lib ובאפליקציית הלקוח. האזכורים היחידים בכל src/ הם קופי שיווקי בדף הבית עצמו:
- `(public)/(site)/page.tsx:76` — כרטיס פיצ'ר 05 "ניהול שולחנות והושבה"
- `(public)/(site)/page.tsx:86` — שלב 5 "מנהלים הושבה ועדכונים"
- `(public)/(site)/page.tsx:189` — פסקת הגיבור "…רשימת האורחים וההושבה"

המשמעות: דף הבית מציג היום יכולת שלא קיימת, וברגע שהאתר נפתח לאינדוקס (פריסת robots.ts) ההצהרה תיסרק ותצוטט ע"י גוגל ומנועי AI כעובדה. מנוגד ל-BRAND §4 (אין להמציא יכולת) וגם חשיפה צרכנית (מצג שווא).

**גזירות על התוכנית:**
1. שלושת האזכורים חייבים תיקון קופי (ניסוח מחדש סביב יכולת אמיתית — קבוצות, מלווים, סטטוסים) **לפני** שהאתר נפתח לאינדוקס — או החלטת בעלים מפורשת אחרת. נוסח חלופי יוצג לאישור יחד עם ה-FAQ.
2. FAQ על הושבה — **הוסר** מרשימת ה-FAQ (§2.3).
3. "סידורי הושבה"/"סידור שולחנות לחתונה" — **הוסרו** מיעדי מילות המפתח (§3). מחקר ה-Suggest של הבעלים מצא שזה ביקוש אמיתי ("וסידורי הושבה") — נרשם כאות ביקוש למוצר (פער-מוצר/רודמאפ), לא כיעד אופטימיזציה. אם וכאשר הפיצ'ר ייבנה — הביטויים חוזרים לתוכנית.

### 2.1 Metadata מורחב — `src/app/layout.tsx`
הקובץ כבר Modified בעבודה הפתוחה (GA4/consent) — לגעת **רק** בבלוק `export const metadata`.
להוסיף:
- `metadataBase: new URL(<origin>)` — דרך `getAppUrl`/`getAppOrigin` מ-`src/lib/url.ts` (לא env גולמי; ראו זיכרון app-url-helper). שימו לב: `metadata` סטטי לא יכול לקרוא async — לבדוק אם נדרש `generateMetadata` או קריאה סינכרונית לקונפיג.
- `alternates: { canonical: '/' }` ברמת ה-root + בדפי (site).
- `openGraph`: `type: 'website'`, `locale: 'he_IL'`, title/description/siteName, תמונה (2.2).
- `twitter: { card: 'summary_large_image' }`.
- description עשיר: לשלב "אישורי הגעה", "ניהול מוזמנים", "הזמנות דיגיטליות", "לחתונה ולאירועים" — בניסוח טבעי, בלי דחיסה. **בלי "הושבה" — ראו §2.0.**

### 2.2 תמונת OG
`src/app/opengraph-image.png` (1200×630) או route של `ImageResponse` (`opengraph-image.tsx`) עם לוגו KALFA + tagline בעברית. סטטי עדיף (פשוט, בלי runtime).

### 2.3 JSON-LD + סקשן FAQ — `src/app/(public)/(site)/page.tsx`
הקובץ **לא** נגוע בשינויים הפתוחים — בטוח לעריכה.
- `<script type="application/ld+json">` עם `@graph`:
  - `Organization` — name KALFA, url, logo, `sameAs` (אם יש נכסים חברתיים — לשאול את הבעלים), contactPoint עם טלפון בפורמט `+972` (לקחת מהקונפיג/עמוד יצירת קשר, לא hardcode — זיכרון no-hardcoded-business-facts).
  - `WebSite` — name + url + `inLanguage: 'he'`.
  - `SoftwareApplication` — applicationCategory: BusinessApplication, בעברית, `offers` עם `priceCurrency: 'ILS'` רק אם מציגים מחיר (המחיר = דאטה מ-DB, לא hardcode).
  - `FAQPage` — צמוד לסקשן ה-FAQ (2.3ב).
- סקשן FAQ חדש בדף הבית: 6–8 שאלות בפורמט answer-first (משפט תשובה ישיר ראשון), עם היכולות האמיתיות בלבד. טיוטת שאלות (נוסח סופי יוצג לאישור לפני שילוב):
  1. מה זו מערכת אישורי הגעה?
  2. איך שולחים אישורי הגעה בוואטסאפ?
  3. האם אפשר לבצע אישורי הגעה בשיחת טלפון?
  4. איך מייבאים רשימת מוזמנים?
  5. האם הנתונים של האורחים פרטיים ומאובטחים?
  6. לאילו אירועים זה מתאים? (חתונה, בר/בת מצווה, כנסים, אירועי חברה)
  (שאלת הושבה הוסרה — §2.0; כל שאלה חייבת לשקף יכולת קיימת בקוד בלבד)
- לוודא היררכיית כותרות תקינה (h2 לסקשן, h3 לשאלות) ו-RTL.

### 2.4 מסלול `/llms.txt`
`src/app/llms.txt/route.ts` (route handler שמחזיר text/plain; אותו דפוס כמו `app/robots.txt/route.ts` שמוזכר ב-`(admin)/admin/jobs.data/route.ts`).
תוכן: מה זה KALFA, למי, יכולות מרכזיות, קישורים לעמודי השיווק. עברית + אנגלית. **בלי** פרטי API, בלי stack פנימי.

## 3. מילות מפתח — פערים בדף הנוכחי (לשילוב טבעי ב-2.1 + 2.3)

- "מוזמנים" — הדף אומר "אורחים"; החיפוש הישראלי: "רשימת מוזמנים לחתונה", "ניהול מוזמנים"
- צורות סמיכות/תחיליות: "אישור הגעה" (יחיד), "לאישורי הגעה", "מערכת אישורי הגעה", "אפליקציית אישורי הגעה"
- חיבור לסוג אירוע בטקסט רץ: "אישורי הגעה לחתונה / לבר מצווה" (היום רק אייקונים)
- ~~הושבה: "סידורי הושבה", "סידור שולחנות לחתונה"~~ — **הוסר, פער-מוצר (§2.0)**; ביקוש אמיתי לפי Suggest — אות רודמאפ בלבד
- ערוצים: "אישורי הגעה בוואטסאפ", "אישורי הגעה טלפוניים"
- כלל GEO (פרינסטון): שטף + עובדות/מספרים > צפיפות מילות מפתח; דחיסה מורידה נראות ב-AI Overviews.

## 4. אימות (Definition of Done)

1. `npm run lint` + `npx tsc --noEmit` + `npm run build` (עם `--webpack` — זיכרון build-webpack-not-found-fix; לא במקביל ל-build אחר).
2. בדיקות schema: Rich Results Test על ה-HTML הבנוי (או ולידציה לוקאלית של ה-JSON-LD).
3. curl על ה-build המקומי: `/robots.txt`, `/sitemap.xml`, `/llms.txt`, ולוודא OG + JSON-LD ב-`/`.
4. לוודא שאף מסלול טוקן לא נכנס ל-sitemap ושה-noindex עליהם לא נפגע.
5. פריסה = של הבעלים (זיכרון no-adhoc-server-processes); אחרי דיפלוי לוודא מול הדומיין החי.

## 5. מה הוחלט / מה נשאר פתוח

- ✅ סקופ: beta בלבד (תוקן פעמיים בסשן — אין עבודה לדומיין הישן).
- ✅ robots/sitemap: הקוד הקיים בעבודה הפתוחה נשאר כמות שהוא.
- ✅ הושבה: הוסרה מכל יעדי ה-SEO/FAQ — פער-מוצר, לא פיצ'ר (§2.0).
- ⏳ תיקון קופי ההושבה בדף הבית (3 מקומות, §2.0) — נוסח חלופי יוצג לאישור; חוסם פתיחה לאינדוקס.
- ✅ 2.0 קופי הושבה: תוקן + נפרס + אומת חי (18:14, אפס מופעים).
- ✅ 2.1 metadata: נפרס + אומת חי (18:33) — description עשיר, og/twitter מלאים,
  canonical פר-עמוד (site) בלבד (ירושת root נפסלה בניסוי נגדי מדוד — /auth/login
  עם root-canonical קיבל canonical של הבית; בקוד הסופי הוא נקי).
- ✅ 2.2 תמונת OG: opengraph-image.png ‏1200×630 (לוגו K האמיתי) + alt.txt — חי,
  כולל twitter:image אוטומטי; תוקן trailing-newline ב-alt (ייכנס בפריסה הבאה).
- ✅ 2.3א JSON-LD: ‏@graph חי — Organization (שם משפטי + טלפון +972 מה-DB דרך
  getCompanyLegal הקיים + toE164Israel חדש), WebSite, SoftwareApplication (בלי
  offers — אין מחיר בעמוד). בלי sameAs (אין נכסים חברתיים מוגדרים — לבעלים).
- ✅ 2.4 llms.txt: route handler force-static (מתועד ב-BFF guide) — חי, 200.
- ⏳ 2.3ב סקשן FAQ + FAQPage schema — נוסח סופי (6 שאלות) הוצג לאישור הבעלים;
  שאלת הטלפון הוחלפה ב"בלי אפליקציה" (ערוץ השיחות עדיין כבוי — B1) — ממתין.
- ⏳ (עתידי, מחוץ לסקופ הנוכחי): GSC + Bing Webmaster, עמוד EN + hreflang, תוכן מדריכים.
