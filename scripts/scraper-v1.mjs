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
const ONLY_MODE = process.argv[2] === '--only';
const OUTPUT_FILE = ONLY_MODE
    ? (process.argv[3] || 'workflowbuilder_docs.json')
    : (process.argv[3] || 'workflowbuilder_docs.json');
const TARGET_URLS = ONLY_MODE
    ? process.argv.slice(4)
    : [process.argv[2] || 'https://www.workflowbuilder.io/docs/overview/'];

if (TARGET_URLS.length === 0) {
    console.error('❌ מצב --only דורש לפחות כתובת אחת.');
    process.exit(1);
}

// האתר מפנה workflowbuilder.io -> www.workflowbuilder.io (301), וכל הקישורים
// בדף כתובים עם www. הגרסה הקודמת סיננה לפי 'https://workflowbuilder.io**'
// ולכן 0 מתוך 70 הקישורים הפנימיים עברו, התור התרוקן, ונסרק עמוד אחד בלבד.
const SITE_GLOBS = ['https://www.workflowbuilder.io/docs/**'];

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

        // שליפת כל הקישורים והטקסטים שלהם מתוך הדפדפן החי
        const hyperlinks = await page.evaluate(() => {
            const links = [];
            document.querySelectorAll('a[href]').forEach(el => {
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
            const main = document.querySelector('main');
            if (!main) return { content: '', headings: [], codeBlocks: [] };

            const headings = [...main.querySelectorAll('h1,h2,h3,h4')]
                .map(h => ({ level: Number(h.tagName[1]), text: h.innerText.trim() }))
                .filter(h => h.text);

            // Expressive Code מחזיק את המקור הנקי ב־data-code של כפתור ההעתקה,
            // ומקודד שורה חדשה כתו DEL (U+007F) ולא כישות HTML. הכתיב המפורש
            // מכוון: תו בקרה ממשי בקוד המקור נמחק בשקט בכל עריכה או העתקה.
            const codeBlocks = [...document.querySelectorAll('button[data-code]')]
                .map(b => b.getAttribute('data-code').replaceAll('\u007F', '\n'));

            return { content: main.innerText.trim(), headings, codeBlocks };
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
                // נכסי הבנייה של Astro אינם עמודים.
                exclude: ['**/_astro/**'],
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
