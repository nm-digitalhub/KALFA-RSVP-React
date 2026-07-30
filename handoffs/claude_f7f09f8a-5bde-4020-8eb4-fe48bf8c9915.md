# Session Handoff Context


## Session Overview

| Field | Value |
|-------|-------|
| **Source** | Claude Code |
| **Session ID** | `f7f09f8a-5bde-4020-8eb4-fe48bf8c9915` |
| **Working Directory** | `~/beta` |
| **Session File** | `~/.claude/projects/-var-www-vhosts-kalfa-me-beta/f7f09f8a-5bde-4020-8eb4-fe48bf8c9915.jsonl` |
| **Repository** | kalfa.me/beta @ `main` |
| **Model** | claude-fable-5 |
| **Last Active** | 2026-07-27 15:09:39 UTC |
| **Tokens Used** | 163 in / 141,444 out |
| **Cache Tokens** | 11,143,704 read / 799,880 created |
| **Files Modified** | 5 |
| **Messages** | 10 |


## Summary

> Base directory for this skill: /var/www/vhosts/kal


## Current State

מבצע את תיקון הקופי עכשיו — שלושת המקומות, עם ניסוח שממופה ליכולות אמיתיות בלבד (ייבוא מוזמנים, תזכורות/עדכונים, קבוצות ומלווים — כולן קיימות בקוד).


## Key Decisions

- tool-result: b7mcrydfa.txt (108.4 KB)
- tool-result: bva5oxyip.txt (213.0 KB)
- tool-result: hook-900656b0-eba9-4187-94ec-bb62ace1af7b-stdout.txt (21.3 KB)


## Recent Conversation

### User (2026-07-27 14:56:55 UTC)

היכן התוכנית שמורה

### Assistant (2026-07-27 14:57:04 UTC)

התוכנית עדיין לא נשמרה — היא הייתה רק בשיחה. אשמור אותה עכשיו כקובץ ב-`plans/` לפי מוסכמת הפרויקט.

### Assistant (2026-07-27 14:58:55 UTC)

התוכנית שמורה עכשיו בשני מקומות:

1. **`plans/seo-geo-beta-plan.md`** (בריפו beta) — התוכנית המלאה והמעודכנת: טבלת הממצאים מול beta החי, ארבעת סעיפי ה-P0 שנותרו (metadata מורחב, תמונת OG, ‏JSON-LD + FAQ, ‏llms.txt), מפת מילות המפתח, שלבי האימות, ומה שכבר קיים בעבודה הפתוחה (robots.ts + sitemap.ts) כדי שלא ייווצר כפל עבודה. הקובץ לא מקומט — הוא יושב בעץ העבודה ליד שאר השינויים הפתוחים.
2. **שורת זיכרון** — כדי שכל סשן עתידי ידע שהתוכנית קיימת, שהסקופ הוא beta בלבד, ושממתינים ל"בצע".

לתשומת לבך: …

### User (2026-07-27 15:01:56 UTC)

הבעיה שמצאתי — סתירת "הושבה" (נמדד מול   הסכמה והקוד):    התוכנית כוללת FAQ מס' 5 ("איך עובד סידור   ההושבה/שולחנות?") ומילות מפתח "סידורי   הושבה"/"סידור שולחנות לחתונה" (§2.1,   §3). בדקתי: אין שום יכולת הושבה במוצר —   אפס עמודות seating/table בסכמת guests   (יש רק group_id), אפס קוד באפליקציית   הלקוח וב-src/lib. האזכורים היחידים הם   בקופי השיווקי של דף הבית עצמו (כרטיס   פיצ'ר 05, שלב 5, וטקסט הגיבור) — כלומר   דף הבית החי כבר היום מציג יכולת שלא   קיימת, ועכשיו כשהאתר נפתח לאינדוקס   וייס…

### Assistant (2026-07-27 15:02:22 UTC)

ממצא חמור ונכון לבדוק אותו מיד. מאמת מול הסכמה והקוד לפני שאני מעדכן את התוכנית.

### Assistant (2026-07-27 15:04:25 UTC)

# הממצא שלך אומת ושולב בתוכנית כשער חוסם

**האימות שלי מאשר את שלך במלואו:** אין שום עמודת seating/table בסכמה (רק `group_id` ב-guests), אפס קוד הושבה ב-`src/lib` ובאפליקציית הלקוח. האזכורים היחידים של הושבה/שולחנות בכל `src/` הם שלושת מקומות הקופי בדף הבית: כרטיס פיצ'ר 05 (`page.tsx:76`), שלב 5 (`page.tsx:86`) ופסקת הגיבור (`page.tsx:189`).

## מה עדכנתי ב-`plans/seo-geo-beta-plan.md`

1. **סעיף חדש §2.0 — שער מקדים חוסם:** שלושת אזכורי ההושבה בדף הבית חייבים תיקון קופי (ניסוח מחדש סביב יכולות …

### User (2026-07-27 15:04:50 UTC)

תתקן

### User (2026-07-27 15:05:04 UTC)

תתקן עכשיו לפני שאתה מתחיל

### Assistant (2026-07-27 15:06:36 UTC)

מבצע את תיקון הקופי עכשיו — שלושת המקומות, עם ניסוח שממופה ליכולות אמיתיות בלבד (ייבוא מוזמנים, תזכורות/עדכונים, קבוצות ומלווים — כולן קיימות בקוד).

### User (2026-07-27 15:09:39 UTC)

[Request interrupted by user]


## Tool Activity

### Shell (18 calls)

> `$ python3 /var/www/vhosts/kalfa.me/beta/.claude/skills/hebrew-seo-geo-toolkit/scripts/seo_audit.py "https://kalfa.me" 2>&1 | head -100`
> ```
> exists: yes
> ai_bots_mentioned: none
> ## Sitemap
> sitemap_xml: yes
> === Audit Complete ===
> ```

> `$ curl -s --max-time 15 "https://kalfa.me/robots.txt"; echo "---SITEMAP---"; curl -s --max-time 15 "https://kalfa.me/sitemap.xml" | head -50`
> ```
>     <loc>https://kalfa.me/rsvp/Test</loc>
>     <lastmod>2026-03-24T11:36:25+02:00</lastmod>
>     <changefreq>weekly</changefreq>
>     <priority>0.8</priority>
>             </url>
> ```

> `$ ls /var/www/vhosts/kalfa.me/beta/src/app/ /var/www/vhosts/kalfa.me/beta/src/app/\(public\)/\(site\)/ /var/www/vhosts/kalfa.me/beta/public/ 2>&1`
> ```
> cookies
> layout.tsx
> page.tsx
> privacy
> terms
> ```

> `$ python3 /var/www/vhosts/kalfa.me/beta/.claude/skills/hebrew-seo-geo-toolkit/scripts/seo_audit.py "https://beta.kalfa.me" 2>&1 | head -60; echo "===ROBOTS==="; curl -s --max-time 15 "https://beta.kalfa.me/robots.txt"; echo "===SITEMAP==="; curl -s --max-time 15 "https://beta.kalfa.me/sitemap.xml" | head -30`
> ```
> ## Sitemap
> sitemap_xml: no
> === Audit Complete ===
> ===ROBOTS===
> <!DOCTYPE html><html data-dpl-id="ms39dr9p" lang="he" dir="rtl" class="__variable_2a156f h-full font-sans"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="preload" href="/_next/static/media/d2e3c073bbb3955e-s.p.woff2?dpl=ms39dr9p" as="font" crossorigin="" type="font/woff2"/><link rel="preload" href="/_next/static/media/ec516af01d950ed6-s.p.woff2?dpl=ms39dr9p" as="font" crossorigin="" type="font/woff2"/><link rel="stylesheet" href="/_next/static/css/311fa1aa3f4cbbdc.css?dpl=ms39dr9p" data-precedence="next"/><link rel="stylesheet" href="/_next/static/css/05e80daff8c66481.css?dpl=ms39dr9p" data-precedence="next"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/webpack-5621207644d4d1d5.js?dpl=ms39dr9p"/><script src="/_next/static/chunks/4bd1b696-e356ca5ba0218e27.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/3794-eeb0ab8a4d0a6b29.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/main-app-3277808c4a6e29ab.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/8500-f62a38ff68ab7f42.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/8409-eddce460300b29d1.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/5684-7ab3cfc4fe11f808.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/5030-34038d4321403c4e.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/9774-4c7ffa2227c3ab94.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/5212-c3b041fb4c14ced6.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/5148-127bb892cef0edf5.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/972-6ed8528b5ebe09a9.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/3650-f6f30df09cdc3b1d.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/2077-730e36c6425834f8.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/app/(public)/(site)/page-5ac457e2b88c4b75.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/app/global-error-107bd0482424188c.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/app/layout-ef9d743139e182be.js?dpl=ms39dr9p" async=""></script><meta name="robots" content="noindex"/><meta name="next-size-adjust" content=""/><title>KALFA — ניהול אישורי הגעה</title><meta name="description" content="פלטפורמה לניהול אישורי הגעה לאירועים פרטיים"/><link rel="manifest" href="/manifest.webmanifest"/><link rel="icon" href="/favicon.ico?603d046c9a6fdfbb" type="image/x-icon" sizes="16x16"/><script src="/_next/static/chunks/polyfills-42372ed130431b0a.js?dpl=ms39dr9p" noModule=""></script></head><body class="min-h-full bg-background text-foreground antialiased"><div hidden=""><!--$--><!--/$--></div><main class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"><h1 class="text-2xl font-bold">הדף לא נמצא</h1><p class="text-muted-foreground">הקישור שגוי או שהדף הוסר.</p><a class="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90" href="/">לדף הבית</a></main><!--$--><!--/$--><script src="/_next/static/chunks/webpack-5621207644d4d1d5.js?dpl=ms39dr9p" id="_R_" async=""></script><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"1:\"$Sreact.fragment\"\n3:I[57121,[],\"\"]\n4:I[74581,[],\"\"]\n5:I[98500,[\"8500\",\"static/chunks/8500-f62a38ff68ab7f42.js?dpl=ms39dr9p\",\"8409\",\"static/chunks/8409-eddce460300b29d1.js?dpl=ms39dr9p\",\"5684\",\"static/chunks/5684-7ab3cfc4fe11f808.js?dpl=ms39dr9p\",\"5030\",\"static/chunks/5030-34038d4321403c4e.js?dpl=ms39dr9p\",\"9774\",\"static/chunks/9774-4c7ffa2227c3ab94.js?dpl=ms39dr9p\",\"5212\",\"static/chunks/5212-c3b041fb4c14ced6.js?dpl=ms39dr9p\",\"5148\",\"static/chunks/5148-127bb892cef0edf5.js?dpl=ms39dr9p\",\"972\",\"static/chunks/972-6ed8528b5ebe09a9.js?dpl=ms39dr9p\",\"3650\",\"static/chunks/3650-f6f30df09cdc3b1d.js?dpl=ms39dr9p\",\"2077\",\"static/chunks/2077-730e36c6425834f8.js?dpl=ms39dr9p\",\"6210\",\"static/chunks/app/(public)/(site)/page-5ac457e2b88c4b75.js?dpl=ms39dr9p\"],\"\"]\n6:I[90484,[],\"OutletBoundary\"]\n7:\"$Sreact.suspense\"\na:I[90484,[],\"ViewportBoundary\"]\nc:I[90484,[],\"MetadataBoundary\"]\ne:I[26719,[\"4219\",\"static/chunks/app/global-error-107bd0482424188c.js?dpl=ms39dr9p\"],\"default\"]\n:HL[\"/_next/static/media/d2e3c073bbb3955e-s.p.woff2?dpl=ms39dr9p\",\"font\",{\"crossOrigin\
> ```

> `$ echo "=== PROD HEAD (kalfa.me) ==="; curl -s --max-time 15 "https://kalfa.me" | tr '>' '>\n' | grep -iE "hreflang|og:|twitter:|ld\+json|<html|robots|canonical|lang=|dir=" | head -30; echo; echo "=== PROD HEADERS ==="; curl -sI --max-time 15 "https://kalfa.me" | grep -iE "x-robots|content-language|link"; echo; echo "=== BETA HOME HEAD ==="; curl -s --max-time 15 "https://beta.kalfa.me" | tr '>' '>\n' | grep -iE "hreflang|og:|ld\+json|<html|robots|canonical" | head -15; echo; echo "=== BETA HEADERS ==="; curl -sI --max-time 15 "https://beta.kalfa.me" | grep -iE "x-robots|content-language"`
> ```
>         <meta name="twitter:image" content="https://kalfa.me/images/Logo-Kalfa/Logo_App_Icon.png">
>         log: console.log,
>             dir="auto"
> ...
> </persisted-output>
> ```

> `$ grep -A 12 "=== BETA HOME HEAD ===" /var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta/f7f09f8a-5bde-4020-8eb4-fe48bf8c9915/tool-results/b7mcrydfa.txt | head -20; echo "########"; grep -B2 -A6 "=== PROD HEADERS ===\|=== BETA HEADERS ===" /var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta/f7f09f8a-5bde-4020-8eb4-fe48bf8c9915/tool-results/b7mcrydfa.txt | head -30`
> ```
> Preview (first 2KB):
> === BETA HOME HEAD ===
> <!DOCTYPE html><html data-dpl-id="ms39dr9p" lang="he" dir="rtl" class="__variable_2a156f h-full font-sans"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/css/311fa1aa3f4cbbdc.css?dpl=ms39dr9p" data-precedence="next"/><link rel="stylesheet" href="/_next/static/css/05e80daff8c66481.css?dpl=ms39dr9p" data-precedence="next"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/webpack-5621207644d4d1d5.js?dpl=ms39dr9p"/><script src="/_next/static/chunks/4bd1b696-e356ca5ba0218e27.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/3794-eeb0ab8a4d0a6b29.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/main-app-3277808c4a6e29ab.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/app/global-error-107bd0482424188c.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/8500-f62a38ff68ab7f42.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/8409-eddce460300b29d1.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/5684-7ab3cfc4fe11f808.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/5030-34038d4321403c4e.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/9774-4c7ffa2227c3ab94.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/5212-c3b041fb4c14ced6.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/5148-127bb892cef0edf5.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/972-6ed8528b5ebe09a9.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/3650-f6f30df09cdc3b1d.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/2077-730e36c6425834f8.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/app/(public)/(site)/page-5ac457e2b88c4b75.js?dpl=ms39dr9p" async=""></script><script src="/_next/static/chunks/
> ...
> </persisted-output>
> ```

> `$ grep -rn "hreflang\|ld+json\|application/ld" /var/www/vhosts/kalfa.me/beta/src/ 2>/dev/null | head; echo "---"; ls /var/www/vhosts/kalfa.me/beta/src/app/\(public\)/; echo "---"; grep -rn "noindex\|robots" /var/www/vhosts/kalfa.me/beta/src/app --include="*.tsx" --include="*.ts" | grep -v node_modules | head; echo "---nginx---"; grep -rn "X-Robots\|robots" /etc/nginx/conf.d/ /var/www/vhosts/system/*/conf/ 2>/dev/null | grep -i kalfa | head`
> ```
> /var/www/vhosts/kalfa.me/beta/src/app/(public)/r/[token]/page.tsx:20:  robots: { index: false, follow: false },
> /var/www/vhosts/kalfa.me/beta/src/app/(public)/ty/[token]/page.tsx:11:// be cached or prerendered. Response headers (no-store, no-referrer, noindex)
> /var/www/vhosts/kalfa.me/beta/src/app/(public)/ty/[token]/page.tsx:18:  robots: { index: false, follow: false },
> /var/www/vhosts/kalfa.me/beta/src/app/(admin)/admin/jobs.data/route.ts:15:// such a path from the App Router (same shape as `app/robots.txt/route.ts`).
> ---nginx---
> ```

> `$ echo "=== prod llms.txt ==="; curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://kalfa.me/llms.txt"; echo; echo "=== beta llms.txt ==="; curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://beta.kalfa.me/llms.txt"; echo; echo "=== prod headers ==="; curl -sI --max-time 10 "https://kalfa.me" | grep -iE "^x-robots|^content-language|^server|^cache"; echo "=== beta headers ==="; curl -sI --max-time 10 "https://beta.kalfa.me" | grep -iE "^x-robots|^content-language|^cache"; echo "=== beta home robots-meta check ==="; curl -s --max-time 10 "https://beta.kalfa.me" | grep -o 'name="robots"[^/]*' | head -3; echo "(ריק = אין תג robots בדף הבית)"`
> ```
> cache-control: max-age=0, must-revalidate, no-cache, no-store, private
> === beta headers ===
> cache-control: private, no-cache, no-store, max-age=0, must-revalidate
> === beta home robots-meta check ===
> (ריק = אין תג robots בדף הבית)
> ```

*...and 10 more shell calls (all exit 0)*


### Write (2 calls)

> **`/var/www/vhosts/kalfa.me/beta/plans/seo-geo-beta-plan.md`** (new file) (+86 lines)
> ```diff
> +# SEO + GEO לאתר beta — תוכנית מאושרת-ממצאים (2026-07-27)
> +
> +מטרה: שיפור דירוג בגוגל לקהל הישראלי + נראות ב-AI Overviews / ChatGPT / Perplexity / Gemini לשאילתות בעברית.
> +**סקופ: ריפו beta בלבד.** אין שום עבודה, המלצה או snippet לדומיין הישן.
> +
> +מקור: סשן `/hebrew-seo-geo-toolkit` (ערכת הכלים ב-`.claude/skills/hebrew-seo-geo-toolkit/` — שם נמצאים גם references: geo-research.md, schema-templates.md, seo-checklist.md).
> +
> +## 1. ממצאי ביקורת (נמדד מול beta.kalfa.me החי + עץ העבודה, 27.7)
> +
> +| בדיקה | מצב |
> +|---|---|
> +| Title / Description | ✅ קיימים אבל רזים (description = 43 תווים, בלי ביטויי חיפוש) |
> +| `lang="he" dir="rtl"` | ✅ |
> +| OG / Twitter tags | ❌ אין |
> +| Canonical / metadataBase | ❌ אין |
> +| JSON-LD | ❌ 0 בלוקים |
> +| robots.txt | ✅ **כבר כתוב** — `src/app/robots.ts` (לא מקומט, לא פרוס → 404 בחי). מתיר הכול כולל בוטי AI, חוסם `/r /g /ty /join /app /admin /auth /api` |
> +| sitemap.xml | ✅ **כבר כתוב** — `src/app/sitemap.ts` (לא מקומט): `/`, `/contact`, `/terms`, `/privacy`, `/cookies` בלבד |
> +| noindex על משטחי טוקנים | ✅ `/r /g /ty` עם `robots: { index: false, follow: false }` |
> +| תמונת opengraph-image | ❌ אין בכלל |
> +| llms.txt | ❌ אין |
> +| FAQ / תוכן "תשובה קודם" | ❌ אין בדף הבית |
> +| מהירות | ✅ 0.06s |
> +
> +הערה: ברגע ש-robots.ts/sitemap.ts ייפרסו, beta.kalfa.me נפתח לסריקה ולאינדוקס (אין host-awareness — זו ההתנהגות של הקוד הקיים).
> +
> +## 2. P0 — ארבעה סעיפים שנותרו (ממתין ל"בצע")
> +
> +### 2.1 Metadata מורחב — `src/app/layout.tsx`
> +הקובץ כבר Modified בעבודה הפתוחה (GA4/consent) — לגעת **רק** בבלוק `export const metadata`.
> +להוסיף:
> +- `metadataBase: new URL(<origin>)` — דרך `getAppUrl`/`getAppOrigin` מ-`src/lib/url.ts` (לא env גולמי; ראו זיכרון app-url-helper). שימו לב: `metadata` סטטי לא יכול לקרוא async — לבדוק אם נדרש `generateMetadata` או קריאה סינכרונית לקונפיג.
> +- `alternates: { canonical: '/' }` ברמת ה-root + בדפי (site).
> +- `openGraph`: `type: 'website'`, `locale: 'he_IL'`, title/description/siteName, תמונה (2.2).
> +- `twitter: { card: 'summary_large_image' }`.
> +- description עשיר: לשלב "אישורי הגעה", "ניהול מוזמנים", "סידורי הושבה", "הזמנות דיגיטליות", "לחתונה ולאירועים" — בניסוח טבעי, בלי דחיסה.
> +
> +### 2.2 תמונת OG
> +`src/app/opengraph-image.png` (1200×630) או route של `ImageResponse` (`opengraph-image.tsx`) עם לוגו KALFA + tagline בעברית. סטטי עדיף (פשוט, בלי runtime).
> +
> +### 2.3 JSON-LD + סקשן FAQ — `src/app/(public)/(site)/page.tsx`
> +הקובץ **לא** נגוע בשינויים הפתוחים — בטוח לעריכה.
> +- `<script type="application/ld+json">` עם `@graph`:
> +  - `Organization` — name KALFA, url, logo, `sameAs` (אם יש נכסים חברתיים — לשאול את הבעלים), contactPoint עם טלפון בפורמט `+972` (לקחת מהקונפיג/עמוד יצירת קשר, לא hardcode — זיכרון no-hardcoded-business-facts).
> +  - `WebSite` — name + url + `inLanguage: 'he'`.
> +  - `SoftwareApplication` — applicationCategory: BusinessApplication, בעברית, `offers` עם `priceCurrency: 'ILS'` רק אם מציגים מחיר (המחיר = דאטה מ-DB, לא hardcode).
> +  - `FAQPage` — צמוד לסקשן ה-FAQ (2.3ב).
> +- סקשן FAQ חדש בדף הבית: 6–8 שאלות בפורמט answer-first (משפט תשובה ישיר ראשון), עם היכולות האמיתיות בלבד. טיוטת שאלות (נוסח סופי יוצג לאישור לפני שילוב):
> +  1. מה זו מערכת אישורי הגעה?
> +  2. איך שולחים אישורי הגעה בוואטסאפ?
> +  3. האם אפשר לבצע אישורי הגעה בשיחת טלפון?
> +  4. איך מייבאים רשימת מוזמנים?
> +  5. איך עובד סידור ההושבה/שולחנות?
> +  6. האם הנתונים של האורחים פרטיים ומאובטחים?
> +  7. לאילו אירועים זה מתאים? (חתונה, בר/בת מצווה, כנסים, אירועי חברה)
> +- לוודא היררכיית כותרות תקינה (h2 לסקשן, h3 לשאלות) ו-RTL.
> +
> +### 2.4 מסלול `/llms.txt`
> +`src/app/llms.txt/route.ts` (route handler שמחזיר text/plain; אותו דפוס כמו `app/robots.txt/route.ts` שמוזכר ב-`(admin)/admin/jobs.data/route.ts`).
> +תוכן: מה זה KALFA, למי, יכולות מרכזיות, קישורים לעמודי השיווק. עברית + אנגלית. **בלי** פרטי API, בלי stack פנימי.
> +
> +## 3. מילות מפתח — פערים בדף הנוכחי (לשילוב טבעי ב-2.1 + 2.3)
> +
> +- "מוזמנים" — הדף אומר "אורחים"; החיפוש הישראלי: "רשימת מוזמנים לחתונה", "ניהול מוזמנים"
> +- צורות סמיכות/תחיליות: "אישור הגעה" (יחיד), "לאישורי הגעה", "מערכת אישורי הגעה", "אפליקציית אישורי הגעה"
> +- חיבור לסוג אירוע בטקסט רץ: "אישורי הגעה לחתונה / לבר מצווה" (היום רק אייקונים)
> +- הושבה: "סידורי הושבה", "סידור שולחנות לחתונה"
> +- ערוצים: "אישורי הגעה בוואטסאפ", "אישורי הגעה טלפוניים"
> +- כלל GEO (פרינסטון): שטף + עובדות/מספרים > צפיפות מילות מפתח; דחיסה מורידה נראות ב-AI Overviews.
> +
> +## 4. אימות (Definition of Done)
> +
> +1. `npm run lint` + `npx tsc --noEmit` + `npm run build` (עם `--webpack` — זיכרון build-webpack-not-found-fix; לא במקביל ל-build אחר).
> +2. בדיקות schema: Rich Results Test על ה-HTML הבנוי (או ולידציה לוקאלית של ה-JSON-LD).
> +3. curl על ה-build המקומי: `/robots.txt`, `/sitemap.xml`, `/llms.txt`, ולוודא OG + JSON-LD ב-`/`.
> +4. לוודא שאף מסלול טוקן לא נכנס ל-sitemap ושה-noindex עליהם לא נפגע.
> +5. פריסה = של הבעלים (זיכרון no-adhoc-server-processes); אחרי דיפלוי לוודא מול הדומיין החי.
> +
> +## 5. מה הוחלט / מה נשאר פתוח
> +
> +- ✅ סקופ: beta בלבד (תוקן פעמיים בסשן — אין עבודה לדומיין הישן).
> +- ✅ robots/sitemap: הקוד הקיים בעבודה הפתוחה נשאר כמות שהוא.
> +- ⏳ אישור "בצע" לארבעת סעיפי 2.1–2.4 — טרם ניתן.
> +- ⏳ נוסח FAQ סופי — יוצג לאישור לפני שילוב.
> +- ⏳ (עתידי, מחוץ לסקופ הנוכחי): GSC + Bing Webmaster, עמוד EN + hreflang, תוכן מדריכים.
> +
> ```

> **`/var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta/memory/seo-geo-beta-workstream.md`** (new file) (+19 lines)
> ```diff
> +---
> +name: seo-geo-beta-workstream
> +description: Hebrew SEO+GEO workstream for the beta Next.js site — plan saved at plans/seo-geo-beta-plan.md, awaiting explicit בצע
> +metadata:
> +  type: project
> +---
> +
> +SEO/GEO workstream (started 2026-07-27, `/hebrew-seo-geo-toolkit` session). **Scope: beta repo ONLY** — the user rejected any audit/recommendations for the old production domain ([[scope-beta-only]]).
> +
> +Plan file: `plans/seo-geo-beta-plan.md` (in the beta repo).
> +
> +State:
> +- Already written by the in-flight uncommitted workstream (NOT deployed yet, hence 404 live): `src/app/robots.ts` (allows all incl. AI bots, blocks token surfaces) + `src/app/sitemap.ts` (5 marketing pages). Do not duplicate or redesign these.
> +- Remaining P0 (awaiting explicit בצע, not yet given): (1) rich metadata in root layout — metadataBase/canonical/OG he_IL/Twitter via getAppOrigin, layout.tsx is ALSO modified by the open GA4/consent work so touch only the metadata block; (2) opengraph-image; (3) JSON-LD @graph + answer-first FAQ section in `(public)/(site)/page.tsx` (file untouched by open work — safe), FAQ copy must be shown for approval before merging; (4) `/llms.txt` route, product-focused, no API/stack internals.
> +
> +**Why:** plan-in-conversation was lost on the user ("היכן התוכנית שמורה") — plans must be persisted to `plans/` per project convention.
> +
> +**How to apply:** resume from the plan file; verify robots/sitemap deployment state against the LIVE beta domain before claiming anything is live ([[verify-live-docs-not-advisor]]).
> +
> ```


### Edit (14 calls)

> **`/var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta/memory/scope-beta-only.md`** (+3 -1 lines)
> ```diff
> -**Reinforced 2026-07-22** (user: "חובה ליישר קו... לא לערבב בין שני פרויקטים", then "אני לא מבין למה אתה נוגע ומערבב"): even READ-ONLY inspection outside beta/ (ls, git status/log in the HOME repo) crosses the line once it goes beyond the minimum needed to answer a direct question — the moment an investigation reveals a sibling/parent path belongs to another project, STOP and ask; never run git commands inside the other repo, never let Bash cwd sit outside beta ([[bash-cwd-persists-across-calls]]), and never propose cleanups there ([[home-laravel-repo-drift]]).
> +**Reinforced 2026-07-22** (user: "חובה ליישר קו... לא לערבב בין שני פרויקטים", then "אני לא מבין למה אתה נוגע ומערבב"): even READ-ONLY inspection outside beta/ (ls, git status/log in the HOME repo) crosses the line once it goes beyond the minimum needed to answer a direct question — the moment an investigation reveals a sibling/parent path belongs to another project, STOP and ask; never run git commands inside the other repo, never let Bash cwd sit outside beta ([[bash-cwd-persists-across-calls]]), and never propose cleanups there ([[home-laravel-repo-drift]]).
> +
> +**Reinforced 2026-07-27** (SEO/GEO session, user: "מה זה קשור לדומיין הראשי?? תתמקד רק בbeta!"): the scope rule covers PLANS and RECOMMENDATIONS too, not just code — auditing the live kalfa.me production site (the old Laravel app) and drafting a "P1 recommendations package" for it was rejected. Marketing/SEO/GEO work targets the beta Next.js app only; do not audit, plan for, or prepare paste-ready snippets for the production Laravel domain.
> ```

> **`/var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta/memory/MEMORY.md`** (+2 -1 lines)
> ```diff
> -- [GA4 analytics](ga4-analytics-workstream.md) — LIVE consent-gated (Basic), (site) group excludes token routes; health = Realtime/reports, tag-detection warnings = plausibly consent-gating but unverified attribution; Data API dormant
> +- [GA4 analytics](ga4-analytics-workstream.md) — LIVE consent-gated (Basic), (site) group excludes token routes; health = Realtime/reports, tag-detection warnings = plausibly consent-gating but unverified attribution; Data API dormant
> +- [SEO/GEO beta](seo-geo-beta-workstream.md) — plan @ plans/seo-geo-beta-plan.md; scope beta ONLY; robots.ts+sitemap.ts already exist uncommitted; 4 P0 items awaiting בצע
> ```

> **`/var/www/vhosts/kalfa.me/beta/plans/seo-geo-beta-plan.md`** (+1 -1 lines)
> ```diff
> -- description עשיר: לשלב "אישורי הגעה", "ניהול מוזמנים", "סידורי הושבה", "הזמנות דיגיטליות", "לחתונה ולאירועים" — בניסוח טבעי, בלי דחיסה.
> +- description עשיר: לשלב "אישורי הגעה", "ניהול מוזמנים", "הזמנות דיגיטליות", "לחתונה ולאירועים" — בניסוח טבעי, בלי דחיסה. **בלי "הושבה" — ראו §2.0.**
> ```

> **`/var/www/vhosts/kalfa.me/beta/plans/seo-geo-beta-plan.md`** (+17 -3 lines)
> ```diff
> -## 2. P0 — ארבעה סעיפים שנותרו (ממתין ל"בצע")
> -
> -### 2.1 Metadata מורחב — `src/app/layout.tsx`
> +## 2. P0 — ארבעה סעיפים שנותרו (ממתין ל"בצע")
> +
> +### 2.0 ⛔ שער מקדים — סתירת "הושבה" (נמצא ע"י הבעלים 27.7, אומת מול הסכמה והקוד)
> +
> +**אין יכולת הושבה במוצר.** אפס עמודות seating/table בסכמת guests (רק group_id), אפס קוד ב-src/lib ובאפליקציית הלקוח. האזכורים היחידים בכל src/ הם קופי שיווקי בדף הבית עצמו:
> +- `(public)/(site)/page.tsx:76` — כרטיס פיצ'ר 05 "ניהול שולחנות והושבה"
> +- `(public)/(site)/page.tsx:86` — שלב 5 "מנהלים הושבה ועדכונים"
> +- `(public)/(site)/page.tsx:189` — פסקת הגיבור "…רשימת האורחים וההושבה"
> +
> +המשמעות: דף הבית מציג היום יכולת שלא קיימת, וברגע שהאתר נפתח לאינדוקס (פריסת robots.ts) ההצהרה תיסרק ותצוטט ע"י גוגל ומנועי AI כעובדה. מנוגד ל-BRAND §4 (אין להמציא יכולת) וגם חשיפה צרכנית (מצג שווא).
> +
> +**גזירות על התוכנית:**
> +1. שלושת האזכורים חייבים תיקון קופי (ניסוח מחדש סביב יכולת אמיתית — קבוצות, מלווים, סטטוסים) **לפני** שהאתר נפתח לאינדוקס — או החלטת בעלים מפורשת אחרת. נוסח חלופי יוצג לאישור יחד עם ה-FAQ.
> +2. FAQ על הושבה — **הוסר** מרשימת ה-FAQ (§2.3).
> +3. "סידורי הושבה"/"סידור שולחנות לחתונה" — **הוסרו** מיעדי מילות המפתח (§3). מחקר ה-Suggest של הבעלים מצא שזה ביקוש אמיתי ("וסידורי הושבה") — נרשם כאות ביקוש למוצר (פער-מוצר/רודמאפ), לא כיעד אופטימיזציה. אם וכאשר הפיצ'ר ייבנה — הביטויים חוזרים לתוכנית.
> +
> +### 2.1 Metadata מורחב — `src/app/layout.tsx`
> ```

> **`/var/www/vhosts/kalfa.me/beta/plans/seo-geo-beta-plan.md`** (+4 -4 lines)
> ```diff
> -  4. איך מייבאים רשימת מוזמנים?
> -  5. איך עובד סידור ההושבה/שולחנות?
> -  6. האם הנתונים של האורחים פרטיים ומאובטחים?
> -  7. לאילו אירועים זה מתאים? (חתונה, בר/בת מצווה, כנסים, אירועי חברה)
> +  4. איך מייבאים רשימת מוזמנים?
> +  5. האם הנתונים של האורחים פרטיים ומאובטחים?
> +  6. לאילו אירועים זה מתאים? (חתונה, בר/בת מצווה, כנסים, אירועי חברה)
> +  (שאלת הושבה הוסרה — §2.0; כל שאלה חייבת לשקף יכולת קיימת בקוד בלבד)
> ```

*...and 9 more edits*


### Read (4 calls)

- `/var/www/vhosts/kalfa.me/beta/src/app/layout.tsx`
- `/var/www/vhosts/kalfa.me/beta/src/app/(public)/(site)/layout.tsx`
- `/var/www/vhosts/kalfa.me/beta/src/app/(public)/(site)/page.tsx`
- `/var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta/memory/scope-beta-only.md`


### Ask (2 calls)

- ""
- ""



## Files Modified

- `~/.claude/projects/-var-www-vhosts-kalfa-me-beta/memory/scope-beta-only.md`
- `./plans/seo-geo-beta-plan.md`
- `~/.claude/projects/-var-www-vhosts-kalfa-me-beta/memory/seo-geo-beta-workstream.md`
- `~/.claude/projects/-var-www-vhosts-kalfa-me-beta/memory/MEMORY.md`
- `./src/app/(public)/(site)/page.tsx`


## Session Origin

This session was extracted from **Claude Code** session data.
- **Session file**: `~/.claude/projects/-var-www-vhosts-kalfa-me-beta/f7f09f8a-5bde-4020-8eb4-fe48bf8c9915.jsonl`
- **Session ID**: `f7f09f8a-5bde-4020-8eb4-fe48bf8c9915`
- **Project directory**: `~/beta`

> To access the raw session data, inspect the file path above.

---

**You are continuing this session. Pick up exactly where it left off — review the conversation above, check pending tasks, and keep going.**