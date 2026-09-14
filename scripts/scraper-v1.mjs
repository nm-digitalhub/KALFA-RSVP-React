import { PlaywrightCrawler } from '@crawlee/playwright';
import { writeFileSync } from 'fs';

// נקודת הפתיחה חייבת להיות עמוד התיעוד עצמו, לא דף הבית ולא /docs/:
//   * דף הבית מקשר ל־/docs/ פעמיים בלבד מתוך 95 קישורים.
//   * /docs/ מחזיר 200 עם 314 בייט — עמוד־קש עם
//     <meta http-equiv="refresh" content="0;url=/docs/overview/">.
//     זו הפניה בצד הלקוח, לא 301, ולכן זחלן שלא מריץ דפדפן נעצר שם.
//   * ב־/docs/overview/ יושב הניווט המלא של Starlight עם כל עץ התיעוד.
//
// ניתן לעקוף מהמסוף כדי לסרוק תת־עץ:
//   node scripts/scraper-v1.mjs https://www.workflowbuilder.io/docs/nodes/ out.json
// הזחלן ממשיך לעקוב אחרי כל הקישורים הפנימיים תחת /docs/, כך שנקודת פתיחה
// אחרת משנה את הסדר ואת מה שנתפס ראשון — לא את גבול הסריקה.
// שני מצבים:
//
//   זחילה — נקודת פתיחה, ומשם כל קישור פנימי תחת /docs/:
//     node scripts/scraper-v1.mjs <start-url> <out.json>
//
//   רשימה מדויקת — בדיוק הכתובות שנמסרו, בלי לעקוב אחרי דבר:
//     node scripts/scraper-v1.mjs --only <out.json> <url> <url> ...
//
// המצב השני קיים כי "ייצא לי את העמודים האלה" ו"ייצא לי את העץ" הן שתי
// בקשות שונות. זחילה מ־/docs/nodes/ מביאה ~180 עמודים, וכשמבקשים אחד־עשר
// זה לא דיוק חסר — זה תשובה אחרת לגמרי.
// `--glob <pattern>` is pulled out FIRST, so it can appear anywhere and never
// collides with a positional argument. Parsing it by index afterwards meant
// `node scraper-v1.mjs <url> --glob '...'` silently used the string "--glob"
// as the output filename.
const RAW_ARGV = process.argv.slice(2);
const GLOB_AT = RAW_ARGV.indexOf('--glob');
const GLOB_OVERRIDE = GLOB_AT !== -1 ? RAW_ARGV[GLOB_AT + 1] : undefined;
const ARGV = GLOB_AT === -1 ? RAW_ARGV : RAW_ARGV.filter((_, i) => i !== GLOB_AT && i !== GLOB_AT + 1);

const ONLY_MODE = ARGV[0] === '--only';
// Both branches were once the same expression — the output file is argv-positional
// either way; only the URL list differs between the modes.
const OUTPUT_FILE = (ONLY_MODE ? ARGV[1] : ARGV[1]) || 'docs.json';
const TARGET_URLS = ONLY_MODE
    ? ARGV.slice(2)
    : [ARGV[0] || 'https://www.workflowbuilder.io/docs/overview/'];

if (TARGET_URLS.length === 0) {
    console.error('❌ מצב --only דורש לפחות כתובת אחת.');
    process.exit(1);
}

// גבול הזחילה נגזר מכתובת ההתחלה במקום להיות מוצמד לאתר אחד.
//
// הגרסה הקודמת קיבעה כאן 'https://www.workflowbuilder.io/docs/**', כך שהזחלן
// עבד על אתר אחד בלבד: כל כתובת התחלה מאתר אחר הייתה נסרקת ואז התור היה
// מתרוקן, כי אף קישור לא עבר את הפילטר. אותה תקלה בדיוק כבר קרתה כאן פעם
// עם www (0 מתוך 70 קישורים) — הקיבוע היה השורש שלה.
//
// ברירת המחדל היא כל הדומיין של כתובת ההתחלה. כדי לצמצם לתת-עץ, יש להעביר
// glob מפורש:
//   node scripts/scraper-v1.mjs <start-url> <out.json> --glob 'https://host/section/**'
const SITE_GLOBS = GLOB_OVERRIDE
    ? [GLOB_OVERRIDE]
    : [`${new URL(TARGET_URLS[0]).origin}/**`];

const allDocsData = [];

const crawler = new PlaywrightCrawler({
    // הגדלת זמן ההמתנה לעמודים דינמיים
    requestHandlerTimeoutSecs: 30,

    // הגבלת כמות הדפדפנים הרצים במקביל כדי לחסוך בזיכרון
    maxConcurrency: 3,

    // רשת ביטחון: עץ התיעוד מונה כ־180 עמודים.
    maxRequestsPerCrawl: 400,

    async requestHandler({ page, request, enqueueLinks }) {
        // ממתינים לתוכן עצמו ולא ל־networkidle: באתר רצים סקריפטים של
        // umami ו־piwik שיכולים לדחות את "הרשת שקטה" עד לפסק הזמן.
        await page.waitForSelector('main', { timeout: 15_000 }).catch(() => null);

        const title = await page.title();

        // דילוג על עמודי־קש של הפניה (אין להם <main> ואין בהם קישורים).
        const isRedirectStub = await page.evaluate(
            () => !document.querySelector('main') &&
                  Boolean(document.querySelector('meta[http-equiv="refresh" i]'))
        );
        if (isRedirectStub) {
            console.log(`↪️  מדלג על עמוד הפניה: ${request.url}`);
            if (!ONLY_MODE) await enqueueLinks({ globs: SITE_GLOBS });
            return;
        }

        console.log(`סורק כעת עמוד דינמי: ${title} -> ${request.url}`);

        // קישורים מתוך גוף העמוד בלבד.
        //
        // הגרסה הקודמת קראה document.querySelectorAll, כלומר גררה את כל סרגל
        // הניווט של האתר לכל עמוד — 116 קישורים זהים בכל קובץ, שמתוכם חמישה
        // שייכים לעמוד. מי שמשתמש בפלט כדי לדעת "לאן העמוד הזה מפנה" קיבל
        // תשובה שגויה לחלוטין.
        const hyperlinks = await page.evaluate(() => {
            const root =
                document.querySelector('article') ||
                document.querySelector('main') ||
                document.body;
            const links = [];
            root.querySelectorAll('a[href]').forEach(el => {
                const text = el.innerText.trim();
                const href = el.getAttribute('href');
                if (href) {
                    try {
                        // הפיכת קישורים יחסיים למוחלטים
                        links.push({
                            text: text || '[ללא טקסט/אייקון]',
                            url: new URL(href, window.location.href).href
                        });
                    } catch {
                        // התעלמות מקישורים שאינם כתובת אינטרנט
                    }
                }
            });
            return links;
        });

        // הגרסה הקודמת שמרה רק כותרות וקישורים, כך שגם סריקה מושלמת הייתה
        // מפיקה מפת קישורים ולא תיעוד. כאן נשמר גם גוף העמוד ובלוקי הקוד.
        const { content, headings, codeBlocks } = await page.evaluate(() => {
            // <article> לפני <main>: אצל חלק מהמחוללים (Fern למשל) סרגל הניווט
            // יושב בתוך <main>, כך שקריאת main.innerText מחזירה את כל עץ הניווט
            // של האתר לפני מילה אחת של תוכן. <article> הוא גוף העמוד בלבד.
            const root =
                document.querySelector('article') ||
                document.querySelector('main') ||
                null;
            if (!root) return { content: '', headings: [], codeBlocks: [] };

            const headings = [...root.querySelectorAll('h1,h2,h3,h4')]
                .map(h => ({ level: Number(h.tagName[1]), text: h.innerText.trim() }))
                .filter(h => h.text);

            // שני מסלולים, כי מחוללי תיעוד שונים מגישים קוד אחרת:
            //   * Expressive Code (Astro) מחזיק את המקור הנקי ב־data-code של
            //     כפתור ההעתקה, ומקודד שורה חדשה כתו DEL (U+007F) ולא כישות
            //     HTML. הכתיב המפורש מכוון: תו בקרה ממשי בקוד המקור נמחק בשקט
            //     בכל עריכה או העתקה.
            //   * כל השאר (Fern, Docusaurus, Nextra) מגישים <pre> רגיל.
            // בלי המסלול השני, אתר כמו Fern נסרק עם 0 בלוקי קוד — ובעמודי
            // דוגמאות זה כל התוכן שמעניין.
            const fromCopyButtons = [...document.querySelectorAll('button[data-code]')]
                .map(b => b.getAttribute('data-code').replaceAll('\u007F', '\n'));
            const fromPre = [...root.querySelectorAll('pre')]
                .map(el => el.innerText.trim())
                .filter(Boolean);
            const codeBlocks = fromCopyButtons.length ? fromCopyButtons : fromPre;

            return { content: root.innerText.trim(), headings, codeBlocks };
        });

        // ניסיון לחילוץ קטגוריה לפי כותרת ראשית h1
        const category = await page.locator('h1').first().innerText().catch(() => 'כללי');

        allDocsData.push({
            url: request.url,
            title: title,
            category: category.trim(),
            headings: headings,
            content: content,
            codeBlocks: codeBlocks,
            hyperlinks: hyperlinks,
            scrapedAt: new Date().toISOString()
        });

        // ב־--only לא נוסיף דבר לתור: הרשימה שנמסרה היא הסריקה כולה.
        if (!ONLY_MODE) {
            await enqueueLinks({
                globs: SITE_GLOBS,
                // נכסי בנייה אינם עמודים. הדפוסים ספציפיים למחוללים מסוימים
                // (Astro, Next) ופשוט לא מתאימים לאף כתובת באתרים אחרים.
                exclude: ['**/_astro/**', '**/_next/**'],
            });
        }
    },

    failedRequestHandler({ request }) {
        console.error(`❌ הריצה על כתובת זו נכשלה: ${request.url}`);
    },
});

await crawler.run(TARGET_URLS);

// שמירת התוצאות
writeFileSync(OUTPUT_FILE, JSON.stringify(allDocsData, null, 2), 'utf-8');

const withContent = allDocsData.filter(p => p.content.length > 0).length;
console.log(`\n✨ הסריקה הדינמית הסתיימה בהצלחה! נסרקו ${allDocsData.length} עמודים.`);
console.log(`   מתוכם ${withContent} עם תוכן, ו־${allDocsData.reduce((n, p) => n + p.codeBlocks.length, 0)} בלוקי קוד.`);
