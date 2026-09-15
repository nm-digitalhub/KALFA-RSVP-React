// בדיקות ל-scripts/scraper-v2.mjs.
//
// מורצות עם `npm run test:scraper` (node --test), ולא תחת vitest: הסוויטה של
// vitest מוגדרת ל-src/**/*.test.ts ורצה בסביבת node ללא דפדפן, בעוד שכאן
// חייבים דפדפן אמיתי ושרת HTTP אמיתי - הבדיקות המעניינות הן בדיוק אלה
// שבודקות DOM וזחילה, ולא ניתן לזייף אותן בלי לזייף את מה שנבדק.
//
// אין כאן mocks: כל בדיקה רצה מול שרת fixtures מקומי שמדמה את הדפוסים
// שהכשילו את v1 - עמוד-קש עם meta refresh, סרגל ניווט בתוך main, עמוד TypeDoc
// בלי main, עמוד שיווקי עם קישור בודד ל-/docs, נכסים, ועמוד שנופל ב-500.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

import {
    commonPathPrefix,
    createEmptyProfile,
    getDirectoryPrefix,
    inferCrawlBoundary,
    internalPageCandidates,
    isNonHtmlAsset,
    normalizeUrl,
    pickSampleUrls,
    shouldAcceptUrl,
} from './analyze-site.mjs';
import {
    detectContentRoot,
    extractPage,
    measureLateGrowth,
    readMetaRefreshTarget,
    settlePage,
} from './extract-page.mjs';
import { htmlToMarkdown } from './html-to-markdown.mjs';
import { estimateMaxRequests, parseArgv, storageDirFor } from './scraper.mjs';
import {
    classifyHttpStatus,
    isRetryableHttpStatus,
    validateExtractedPage,
    validateSiteProfile,
} from './validate-page.mjs';

const execFileAsync = promisify(execFile);
const SCRAPER = fileURLToPath(new URL('./scraper.mjs', import.meta.url));

// --- fixtures ----------------------------------------------------------------
// Expressive Code מקודד מעבר שורה ב-data-code כתו DEL. נבנה מקוד התו ולא
// ככתיב בריחה, כדי שהקובץ הזה לא יחזיק תו בקרה ליטרלי (npm run
// check:control-chars אוסר, ובצדק - הוא נמחק בשקט בכל עריכה).
const DEL = String.fromCharCode(0x7f);

const LOREM ='This paragraph exists so the page clears the two hundred character floor that validateExtractedPage enforces, because a page that is shorter than that is not documentation but a stub, and the crawler is supposed to notice the difference rather than store it.';

function sidebar(links) {
    return `<nav>${links.map((href) => `<a href="${href}">${href}</a>`).join('')}</nav>`;
}

const DOC_PAGES = ['/docs/a', '/docs/b', '/docs/c', '/docs/d', '/docs/e', '/docs/f', '/docs/g', '/docs/h'];

// סרגל הניווט יושב בתוך main בכוונה: זה הדפוס (Fern, ועוד) שבו main.innerText
// מחזיר את כל עץ הניווט לפני מילה אחת של תוכן, וזו בדיוק הסיבה שה-root נבחר
// לפי ניקוד ולא לפי סדר סלקטורים.
function docPage(title, extraBody = '') {
    return `<!doctype html><html><head><title>${title}</title></head><body>
<main>
  ${sidebar([...DOC_PAGES, '/docs/overview/', '/marketing/'])}
  <article>
    <h1>${title}</h1>
    <p>${LOREM}</p>
    <p>${LOREM}</p>
    <pre>const answer = 42;</pre>
    <a href="/docs/a">related page</a>
  </article>
</main>
${extraBody}
</body></html>`;
}

const FIXTURES = {
    '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' },

    // אותו עמוד-קש, אבל עם השהיה: כאן התג עדיין בעמוד כשקוראים אותו.
    '/docs/delayed/': {
        type: 'text/html',
        body: '<!doctype html><html><head><meta http-equiv="refresh" content="30;url=/docs/overview/"></head><body><p>redirecting shortly, and this sentence exists only so the settle helper has some text to find instead of waiting out its whole timeout on every run.</p></body></html>',
    },

    // עמוד-קש: 200 עם meta refresh, בלי main ובלי קישורים. v1 נבנה סביבו.
    '/docs/': {
        type: 'text/html',
        body: '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=/docs/overview/"></head><body></body></html>',
    },

    '/docs/overview/': {
        type: 'text/html',
        body: docPage('Overview', `
<a href="/docs/logo.png">logo</a>
<a href="/docs/a#section">fragment duplicate</a>
<a href="/docs/a?utm_source=newsletter">tracking duplicate</a>
<a href="/docs/versioned?version=2">real query</a>
<a href="https://external.example.com/page">external</a>
<a href="/docs/empty">empty page</a>
<a href="/docs/broken">broken page</a>
<a href="/docs/mirror">mirror of a</a>`),
    },

    // עמוד עם root קיים אבל בלי טקסט: חייב להיספר ב-audit.empty, לא להיעלם.
    '/docs/empty': {
        type: 'text/html',
        body: '<!doctype html><html><head><title>Empty</title></head><body><main><article></article></main><p>padding text that keeps the settle helper from timing out on every single run of this fixture page, which would slow the suite down for no reason at all.</p></body></html>',
    },

    '/marketing/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>Marketing</title></head><body>
<main><article><h1>KALFA</h1><p>${LOREM}</p><p>${LOREM}</p>
<a href="/pricing">pricing</a><a href="/about">about</a><a href="/contact">contact</a>
<a href="/careers">careers</a><a href="/blog">blog</a><a href="/legal">legal</a>
<a href="/docs/overview/">docs</a></article></main></body></html>`,
    },

    // TypeDoc: לא main ולא article, רק .col-content בתוך .container-main.
    '/typedoc/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>TypeDoc</title></head><body>
<div class="container-main">
  <div class="col-sidebar">${sidebar(DOC_PAGES)}</div>
  <div class="col-content"><h1>Class Foo</h1><p>${LOREM}</p><p>${LOREM}</p><pre>foo()</pre></div>
</div></body></html>`,
    },

    // עמוד ששקט, ואז מוסיף. זה המקרה שחלון-שקט לבדו מפספס: התוכן הראשון יציב
    // מיד, ההמתנה נסגרת, והפסקה השנייה מגיעה אחריה. נמדד לפני התיקון: 406 תווים
    // מתוך 812.
    '/late/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>Late</title></head><body>
<main><article><h1>Late page</h1><p>${LOREM}</p></article></main>
<script>
  setTimeout(function () {
    document.querySelector('article')
      .insertAdjacentHTML('beforeend', '<h2>Arrived late</h2><p>${LOREM}</p>');
  }, 1400);
</script>
</body></html>`,
    },

    // שחזור מדויק של מה שנקרא מ-workflowbuilder.io: השפה ב-data-language ולא
    // ב-class, וכל שורת קוד היא div.ec-line נפרד - כלומר מעברי השורה מבניים,
    // ו-textContent מדביק אותן. בלי התיקון הגדר יוצאת
    // "git clone repocd repopnpm install" בלי שפה.
    '/expressive/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>Expressive</title></head><body>
<main><article>
  <h1>Quick start</h1>
  <p>${LOREM}</p>
  <div class="expressive-code"><figure class="frame is-terminal">
    <figcaption><span class="sr-only">Terminal window</span></figcaption>
    <pre data-language="bash"><code>${
        [['git', ' ', 'clone repo'], ['cd repo'], ['pnpm install']]
            .map((spans) => `<div class="ec-line"><div class="code">${spans.map((s) => `<span>${s}</span>`).join('')}</div></div>`)
            .join('')
    }</code></pre>
    <button data-code="git clone repo${DEL}cd repo${DEL}pnpm install">Copy</button>
  </figure></div>
</article></main></body></html>`,
    },

    // עמוד שנועד לשלב ה-Markdown: סקריפט, קישור ותמונה יחסיים, עוגן
    // aria-hidden, כפתור העתקה, רשימה, טבלה ובלוק קוד עם lang- (ולא language-).
    '/markdown/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>Markdown</title></head><body>
<main><article>
  <h1>Markdown page<a class="anchor" href="#markdown-page" aria-hidden="true">#</a></h1>
  <p>${LOREM}</p>
  <p>See <a href="../api/foo">the API</a> and <img src="./diagram.png" alt="diagram">.</p>
  <ul><li>first item</li><li>second item</li></ul>
  <table><thead><tr><th>flag</th><th>meaning</th></tr></thead><tbody><tr><td>--only</td><td>exact list</td></tr></tbody></table>
  <button data-code="npm i turndown">Copy</button>
  <pre><code class="lang-ts">const answer: number = 42;</code></pre>
  <pre class="astro-code language-bash"><code>npm run test:scraper</code></pre>
  <script>window.__analytics = 'this text must never reach the markdown';</script>
  <style>.x { color: red }</style>
</article></main></body></html>`,
    },

    // שני <article>: הראשון כרטיס תקציר קצר, השני גוף העמוד. סלקטור לבדו אינו
    // מזהה אלמנט, ולכן זו הבדיקה שמפרידה בין "בחרתי את הטוב ביותר" לבין "קראתי
    // את הראשון".
    '/two-articles/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>Two articles</title></head><body>
<article><h1>Wrong article</h1><p>Short.</p></article>
<article><h1>Correct documentation</h1><p>${LOREM}</p><p>${LOREM}</p><pre>const answer = 42;</pre></article>
</body></html>`,
    },

    // אין אף סלקטור מוכר, ו-main קיים אבל מכיל breadcrumb בלבד. בתנאי המקורי
    // ("אם הרשימה ריקה") ה-main היה נבחר ב--Infinity והעמוד היה יורד כריק.
    '/nostructure/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>No structure</title></head><body>
<main>Home / Docs</main>
<div id="wrap"><h1>Handwritten</h1><p>${LOREM}</p><p>${LOREM}</p></div>
</body></html>`,
    },

    // .content כאן הוא סרגל צד עם 60 קישורים וטקסט קצר. ה-article חייב לנצח.
    '/sidebar-heavy/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>Sidebar heavy</title></head><body>
<div class="content">${Array.from({ length: 60 }, (_v, i) => `<a href="/docs/n${i}">Nav item number ${i}</a>`).join('')}</div>
<article><h1>Real content</h1><p>${LOREM}</p><p>${LOREM}</p><pre>example()</pre><a href="/docs/a">one link</a></article>
</body></html>`,
    },

    // עמודים דקים: 6 קישורים (עובר את סף ה-5) אבל התוכן קצר מדי, ולכן
    // ה-samples ייכשלו וה-analysis חייב לעצור לפני סריקה.
    '/thin/': {
        type: 'text/html',
        body: `<!doctype html><html><head><title>Thin</title></head><body><main><article><h1>Thin</h1><p>short</p>
${['a', 'b', 'c', 'd', 'e', 'f'].map((s) => `<a href="/thin/${s}">${s}</a>`).join('')}
</article></main></body></html>`,
    },
};

for (const page of DOC_PAGES) {
    FIXTURES[page] = { type: 'text/html', body: docPage(`Page ${page}`) };
}
// עמודי האתר השיווקי חייבים להתקיים: ה-samples נלקחים מהם, ו-404 היה מפיל את
// ה-analysis מסיבה שאינה נושא הבדיקה.
for (const slug of ['pricing', 'about', 'contact', 'careers', 'blog', 'legal']) {
    FIXTURES[`/${slug}`] = {
        type: 'text/html',
        body: `<!doctype html><html><head><title>${slug}</title></head><body><main><article>
<h1>${slug}</h1><p>${LOREM}</p><p>${LOREM}</p><a href="/pricing">pricing</a></article></main></body></html>`,
    };
}
FIXTURES['/docs/versioned'] = { type: 'text/html', body: docPage('Versioned') };
// אותו תוכן בדיוק כמו /docs/a, בכתובת אחרת: בודק את זיהוי הכפילויות.
FIXTURES['/docs/mirror'] = { type: 'text/html', body: docPage('Page /docs/a') };
// כתובות שמחזירות סטטוס במקום גוף רגיל. הספירה ב-HITS היא הדרך היחידה להוכיח
// שה-retry קרה או לא קרה: קוד היציאה והדוח מראים רק את התוצאה הסופית.
const STATUS_ROUTES = {};
const HITS = new Map();

// שני עצי תוכן על אותו origin: /scoped/docs/ תקין, /scoped/api/ דק מדי. זה מה
// שמאפשר להוכיח ש---glob באמת מכוון את ה-validation ולא רק את הזחילה.
const SCOPED_DOC_PAGES = Array.from({ length: 8 }, (_v, i) => `/scoped/docs/d${i + 1}`);
const SCOPED_API_PAGES = Array.from({ length: 8 }, (_v, i) => `/scoped/api/a${i + 1}`);

// עץ ה---glob. עמוד השורש מקשר לשני תת-העצים, כך שההסקה האוטומטית נופלת
// ל-same-origin ורק ה---glob מצמצם - בדיוק המצב שבו הפער התגלה.
FIXTURES['/scoped/'] = {
    type: 'text/html',
    body: `<!doctype html><html><head><title>Scoped</title></head><body>
<main>
  ${sidebar([...SCOPED_DOC_PAGES, ...SCOPED_API_PAGES])}
  <article><h1>Scoped</h1><p>${LOREM}</p><p>${LOREM}</p><p>${LOREM}</p></article>
</main></body></html>`,
};
for (const page of SCOPED_DOC_PAGES) {
    FIXTURES[page] = {
        type: 'text/html',
        body: `<!doctype html><html><head><title>${page}</title></head><body><main><article>
<h1>${page}</h1><p>${LOREM}</p><p>${LOREM}</p></article></main></body></html>`,
    };
}
// ה-API דק בכוונה: כותרת וחצי משפט. ה-validator חייב לפסול אותו.
for (const page of SCOPED_API_PAGES) {
    FIXTURES[page] = {
        type: 'text/html',
        body: `<!doctype html><html><head><title>${page}</title></head><body><main><article>
<h1>${page}</h1><p>stub</p></article></main></body></html>`,
    };
}
// עמודי שגיאה "עשירים": ה-HTML שלהם עובר את validateExtractedPage בקלות, ורק
// ה-status מבדיל. /rich/ מקשר לעמוד תקין אחד ולשמונה 404, כך ששני ה-samples
// שאינם עמוד ההתחלה נופלים על 404 - וה-analysis חייב לסרב.
const RICH_MISSING = Array.from({ length: 8 }, (_v, i) => `/rich/missing${i + 1}`);
FIXTURES['/rich/'] = {
    type: 'text/html',
    body: `<!doctype html><html><head><title>Rich</title></head><body>
<main>
  ${sidebar(['/rich/ok1', ...RICH_MISSING])}
  <article><h1>Rich</h1><p>${LOREM}</p><p>${LOREM}</p><p>${LOREM}</p></article>
</main></body></html>`,
};
FIXTURES['/rich/ok1'] = {
    type: 'text/html',
    body: `<!doctype html><html><head><title>ok1</title></head><body><main><article>
<h1>ok1</h1><p>${LOREM}</p><p>${LOREM}</p></article></main></body></html>`,
};
for (const page of RICH_MISSING) {
    STATUS_ROUTES[page] = { status: 404, body: richErrorPage(page), type: 'text/html' };
}
// כתובת התחלה שמחזירה 500 עם גוף שנראה כמו תיעוד.
STATUS_ROUTES['/rich500/'] = { status: 500, body: richErrorPage('Rich 500'), type: 'text/html' };
FIXTURES['/rich/home'] = { type: 'text/html', body: richErrorPage('Home') };

for (const slug of ['a', 'b', 'c', 'd', 'e', 'f']) {
    FIXTURES[`/thin/${slug}`] = {
        type: 'text/html',
        body: `<!doctype html><html><head><title>Thin ${slug}</title></head><body><main><article><h1>${slug}</h1><p>short</p></article></main></body></html>`,
    };
}

// עץ נפרד למדיניות ה-HTTP. הוא מופרד מ-/docs/ בכוונה: שתילת ארבע כתובות שגיאה
// בעץ הראשי הייתה מזיזה את אינדקסי ה-samples אל תוכן שבור, וכשל ב-analysis
// היה מסתיר בדיוק את מה שהבדיקה הזו אמורה למדוד.
const HTTP_OK_PAGES = Array.from({ length: 12 }, (_v, i) => `/http/ok${i + 1}`);
const HTTP_ERROR_PAGES = ['/http/notfound', '/http/broken', '/http/throttled', '/http/export'];

FIXTURES['/http/'] = {
    type: 'text/html',
    body: `<!doctype html><html><head><title>HTTP policy</title></head><body>
<main>
  ${sidebar([...HTTP_OK_PAGES, ...HTTP_ERROR_PAGES])}
  <article><h1>HTTP policy</h1><p>${LOREM}</p><p>${LOREM}</p><p>${LOREM}</p></article>
</main></body></html>`,
};
for (const page of HTTP_OK_PAGES) {
    FIXTURES[page] = {
        type: 'text/html',
        body: `<!doctype html><html><head><title>${page}</title></head><body><main><article>
<h1>${page}</h1><p>${LOREM}</p><p>${LOREM}</p></article></main></body></html>`,
    };
}

// כתובות שמחזירות סטטוס במקום גוף. הספירה ב-HITS היא הדרך היחידה להוכיח
// שה-retry קרה או לא קרה: קוד היציאה והדוח מראים רק את התוצאה הסופית.
Object.assign(STATUS_ROUTES, {
    '/docs/broken': { status: 500 },
    '/http/notfound': { status: 404 },
    '/http/broken': { status: 500 },
    '/http/throttled': { status: 429 },
});

// עמוד שגיאה שנראה כמו תיעוד: כותרת, שתי פסקאות ארוכות, מעט קישורים. הוא עומד
// בכל שלושת התנאים של validateExtractedPage, ולכן רק בדיקת ה-status מבדילה
// בינו לבין עמוד אמיתי. זה הכשל שהדוח חשף: ה-crawler פסל 500, וה-analyzer
// באותו רגע היה מוכן להכריז עליו sample תקין.
function richErrorPage(title) {
    return `<!doctype html><html><head><title>${title}</title></head><body>
<main><article><h1>${title}</h1><p>${LOREM}</p><p>${LOREM}</p>
<a href="/rich/home">home</a></article></main></body></html>`;
}


let server;
let origin;
let otherServer;
let otherOrigin;
let browser;

before(async () => {
    server = createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        HITS.set(pathname, (HITS.get(pathname) ?? 0) + 1);

        const errorRoute = STATUS_ROUTES[pathname];
        if (errorRoute) {
            res.writeHead(errorRoute.status, { 'content-type': errorRoute.type ?? 'text/plain' });
            res.end(errorRoute.body ?? 'boom');
            return;
        }
        // הפניה חוצת-origin: אותו hostname, פורט אחר. זה כל מה שצריך כדי
        // ש-robots.txt של היעד יהיה קובץ אחר לגמרי.
        if (pathname === '/cross/') {
            res.writeHead(302, { location: `${otherOrigin}/docs/overview/` });
            res.end();
            return;
        }
        // משאב תקין לחלוטין שאינו HTML, ובלי סיומת בכתובת: זה המקרה
        // ש-isNonHtmlAsset לא יכול לתפוס, כי הוא קורא pathname בלבד.
        if (pathname === '/http/export') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end('{"openapi":"3.0.0"}');
            return;
        }
        if (pathname === '/docs/logo.png') {
            res.writeHead(200, { 'content-type': 'image/png' });
            res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
            return;
        }
        const fixture = FIXTURES[pathname];
        if (!fixture) {
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('not found');
            return;
        }
        res.writeHead(200, { 'content-type': fixture.type });
        res.end(fixture.body);
    });
    // origin שני על אותו hostname ופורט אחר. הוא משרת robots.txt שאוסר הכול,
    // ולכן הוא מוכיח שה-analyzer טוען robots מחדש אחרי הפניה חוצת-origin
    // במקום להישאר עם המדיניות של האתר שממנו יצא.
    otherServer = createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/robots.txt') {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('User-agent: *\nDisallow: /\n');
            return;
        }
        const fixture = FIXTURES[pathname];
        res.writeHead(fixture ? 200 : 404, { 'content-type': 'text/html' });
        res.end(fixture?.body ?? 'not found');
    });
    await new Promise((resolve) => otherServer.listen(0, '127.0.0.1', resolve));
    otherOrigin = `http://127.0.0.1:${otherServer.address().port}`;

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
});

after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => otherServer.close(resolve));
});

async function withPage(path, fn) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
        return await fn(page);
    } finally {
        await context.close();
    }
}

// מריץ את הסקריפט האמיתי כתת-תהליך, עם storage משלו, ומחזיר גם את קוד היציאה
// וגם את שני קבצי הפלט. זו הבדיקה היחידה שמוכיחה שהשער והזחילה מחוברים.
async function runScraper(args, { isolateStorage = true, outputName = 'out.json', cwd = null } = {}) {
    const dir = cwd ?? mkdtempSync(join(tmpdir(), 'scraper-v2-'));
    const outputFile = join(dir, outputName);
    try {
        const result = await execFileAsync(
            process.execPath,
            [SCRAPER, ...args.map((arg) => arg.replace('{out}', outputFile).replace('{origin}', origin))],
            {
                cwd: dir,
                env: {
                    ...process.env,
                    // ברירת המחדל כאן מקבעת storage מפורש, כמו בכל הרצת בדיקה.
                    // isolateStorage:false מוותר עליו בכוונה, כדי לבדוק את מה
                    // שהסקריפט עושה כשאיש לא קבע לו - וזה המצב שנפל בשטח.
                    ...(isolateStorage ? { CRAWLEE_STORAGE_DIR: join(dir, 'storage') } : {}),
                    CRAWLEE_LOG_LEVEL: 'ERROR',
                },
                maxBuffer: 64 * 1024 * 1024,
            },
        ).catch((error) => error);

        const exitCode = result.code ?? 0;
        const readJson = (path) => {
            try {
                return JSON.parse(readFileSync(path, 'utf8'));
            } catch {
                return null;
            }
        };
        return {
            exitCode,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            docs: readJson(outputFile),
            audit: readJson(`${outputFile}.audit.json`),
        };
    } finally {
        if (!cwd) {
            rmSync(dir, { recursive: true, force: true });
        }
    }
}

// --- 8, 9, 10: נרמול כתובות --------------------------------------------------
describe('normalizeUrl', () => {
    it('8 - fragment does not create a duplicate', () => {
        assert.equal(
            normalizeUrl('https://h.io/docs/a#section'),
            normalizeUrl('https://h.io/docs/a'),
        );
    });

    it('9 - utm_* params are removed', () => {
        assert.equal(
            normalizeUrl('https://h.io/docs/a?utm_source=x&utm_medium=y&utm_term=z'),
            'https://h.io/docs/a',
        );
    });

    it('10 - a real business query is preserved', () => {
        assert.equal(
            normalizeUrl('https://h.io/docs/a?version=2&lang=he&utm_campaign=x'),
            'https://h.io/docs/a?version=2&lang=he',
        );
    });

    // `ref` ו-`source` נראים כמו tracking ואינם כאלה באופן אוניברסלי. באתרי
    // תיעוד הם לרוב בוחרים גרסה או פלטפורמה, ומחיקתם מיזגה שני עמודים שונים
    // לכתובת אחת - כלומר איבדה אחד מהם בשקט.
    it('10 - ref and source survive, because they are not unambiguously tracking', () => {
        assert.equal(normalizeUrl('https://h.io/api?ref=v1'), 'https://h.io/api?ref=v1');
        assert.equal(normalizeUrl('https://h.io/api?ref=v2'), 'https://h.io/api?ref=v2');
        assert.notEqual(
            normalizeUrl('https://h.io/docs/reference?source=node'),
            normalizeUrl('https://h.io/docs/reference?source=browser'),
        );
    });
});

// --- 7: נכסים ----------------------------------------------------------------
describe('isNonHtmlAsset / shouldAcceptUrl', () => {
    const profile = createEmptyProfile('https://h.io/docs/overview/');
    profile.crawlBoundary = { strategy: 'path-prefix', pathPrefix: '/docs/', confidence: 1, source: 'test' };

    it('7 - asset URLs are rejected', () => {
        for (const asset of ['/docs/logo.png', '/docs/app.js', '/docs/style.css', '/docs/manual.pdf', '/docs/font.woff2']) {
            assert.equal(isNonHtmlAsset(`https://h.io${asset}`), true, asset);
            assert.equal(shouldAcceptUrl(`https://h.io${asset}`, profile), false, asset);
        }
    });

    it('7 - html pages inside the boundary are accepted', () => {
        assert.equal(shouldAcceptUrl('https://h.io/docs/a', profile), true);
    });

    it('7 - other origins, other schemes and out-of-boundary paths are rejected', () => {
        assert.equal(shouldAcceptUrl('https://other.io/docs/a', profile), false);
        assert.equal(shouldAcceptUrl('mailto:a@b.io', profile), false);
        assert.equal(shouldAcceptUrl('https://h.io/pricing', profile), false);
        assert.equal(shouldAcceptUrl('not a url', profile), false);
    });
});

// --- 1, 2, 3: הסקת גבול הסריקה ------------------------------------------------
describe('inferCrawlBoundary', () => {
    it('1 - a start URL under /docs/ with a docs majority infers the prefix', () => {
        const candidates = [
            ...Array.from({ length: 9 }, (_v, i) => `https://h.io/docs/p${i}`),
            'https://h.io/pricing',
        ];
        const boundary = inferCrawlBoundary('https://h.io/docs/start', candidates);
        assert.equal(boundary.strategy, 'path-prefix');
        assert.equal(boundary.pathPrefix, '/docs/');
        assert.equal(boundary.source, 'start-directory-majority');
        assert.ok(boundary.confidence >= 0.65);
    });

    it('2 - a docs subdomain whose pages sit at the root falls back to same-origin', () => {
        const candidates = Array.from({ length: 9 }, (_v, i) => `https://docs.h.io/page-${i}`);
        const boundary = inferCrawlBoundary('https://docs.h.io/', candidates);
        assert.equal(boundary.strategy, 'same-origin');
        assert.equal(boundary.pathPrefix, null);
        assert.equal(boundary.source, 'same-origin-fallback');
    });

    it('3 - a marketing site with one /docs/ link does not infer /docs/', () => {
        const candidates = [
            'https://h.io/pricing',
            'https://h.io/about',
            'https://h.io/contact',
            'https://h.io/careers',
            'https://h.io/blog',
            'https://h.io/docs/overview/',
        ];
        const boundary = inferCrawlBoundary('https://h.io/', candidates);
        assert.equal(boundary.strategy, 'same-origin');
    });

    it('3 - five pages under the start directory are not enough without a majority', () => {
        const candidates = [
            ...Array.from({ length: 5 }, (_v, i) => `https://h.io/docs/p${i}`),
            ...Array.from({ length: 10 }, (_v, i) => `https://h.io/blog/p${i}`),
        ];
        const boundary = inferCrawlBoundary('https://h.io/docs/start', candidates);
        assert.equal(boundary.strategy, 'same-origin');
    });
});

describe('path helpers', () => {
    it('getDirectoryPrefix trims the file segment', () => {
        assert.equal(getDirectoryPrefix('/docs/nodes/http'), '/docs/nodes/');
        assert.equal(getDirectoryPrefix('/docs/nodes/'), '/docs/nodes/');
        assert.equal(getDirectoryPrefix('/'), '/');
    });

    it('commonPathPrefix reports what the links actually share', () => {
        assert.equal(commonPathPrefix(['/docs/a', '/docs/b']), '/docs/');
        assert.equal(commonPathPrefix(['/docs/a', '/blog/b']), '/');
        assert.equal(commonPathPrefix([]), '/');
    });

    it('internalPageCandidates drops other origins, assets and bad URLs', () => {
        const profile = createEmptyProfile('https://h.io/docs/');
        const candidates = internalPageCandidates(
            [
                'https://h.io/docs/a',
                'https://h.io/docs/a#x',
                'https://h.io/docs/logo.png',
                'https://other.io/docs/a',
                'mailto:a@b.io',
                'not a url',
            ],
            profile,
        );
        assert.deepEqual(candidates, ['https://h.io/docs/a']);
    });

    // הגילוי חייב למדוד לפי אותו קריטריון שהשער סורק לפיו. hostname זהה מקבץ
    // יחד שלושה origins שונים, ושניים מהם לעולם לא ייסרקו - ובכל זאת היו
    // נספרים בהסקת הגבול, בבחירת ה-samples ובהערכת maxRequests.
    it('internalPageCandidates measures by origin, not hostname', () => {
        const profile = createEmptyProfile('https://h.io/docs/');
        const candidates = internalPageCandidates(
            ['https://h.io/docs/a', 'http://h.io/docs/b', 'https://h.io:8443/docs/c'],
            profile,
        );
        assert.deepEqual(candidates, ['https://h.io/docs/a']);
        for (const url of ['http://h.io/docs/b', 'https://h.io:8443/docs/c']) {
            assert.equal(shouldAcceptUrl(url, profile), false, `${url} would never be crawled`);
        }
    });
});

// --- 16, 17: שערי האימות ------------------------------------------------------
describe('validation gates', () => {
    const goodSample = {
        content: 'x'.repeat(500),
        headings: [{ level: 1, text: 'Title' }],
        hyperlinks: [{ text: 'a', url: 'https://h.io/a' }],
    };

    it('17 - a valid sample passes', () => {
        assert.deepEqual(validateExtractedPage(goodSample), { valid: true, reasons: [] });
    });

    it('17 - short content, no headings and nav-like link density all fail', () => {
        // 'short' נופל גם על צפיפות קישורים, כי 5 תווים חלקי קישור אחד הם
        // הרבה מתחת ל-30. הבדיקה מאשרת את הסיבה הרלוונטית, לא את הרשימה כולה.
        assert.ok(
            validateExtractedPage({ ...goodSample, content: 'short' }).reasons
                .includes('content_too_short'),
        );
        assert.deepEqual(
            validateExtractedPage({ ...goodSample, headings: [] }).reasons,
            ['no_headings'],
        );
        assert.deepEqual(validateExtractedPage({ ...goodSample, hyperlinks: [] }).reasons, []);
        assert.deepEqual(
            validateExtractedPage({
                ...goodSample,
                hyperlinks: Array.from({ length: 100 }, () => ({ text: 'a', url: 'https://h.io/a' })),
            }).reasons,
            ['link_density_too_high'],
        );
    });

    function profileWith(overrides) {
        const profile = createEmptyProfile('https://h.io/docs/');
        profile.contentRoot = { selector: 'article', score: 1, confidence: 1 };
        profile.discovery.internalLinks = 12;
        profile.crawlBoundary = { strategy: 'path-prefix', pathPrefix: '/docs/', confidence: 0.9, source: 'test' };
        // שלושה samples נלקחו, ולכן הדרישה בפועל היא שניים. הדרישה נגזרת ממספר
        // ה-samples ולא קבועה, כי אי אפשר לדרוש שניים מתוך אחד.
        profile.validation.sampleUrls = ['https://h.io/docs/a', 'https://h.io/docs/b', 'https://h.io/docs/c'];
        profile.validation.validSamples = 3;
        profile.validation.startPageValid = true;
        return { ...profile, ...overrides, validation: { ...profile.validation, ...overrides.validation } };
    }

    it('16 - one valid sample out of three blocks the crawl', () => {
        const verdict = validateSiteProfile(profileWith({ validation: { validSamples: 1, startPageValid: true } }));
        assert.equal(verdict.passed, false);
        assert.ok(verdict.reasons.includes('insufficient_valid_samples'));
    });

    it('17 - two valid samples out of three allow the crawl', () => {
        assert.deepEqual(
            validateSiteProfile(profileWith({ validation: { validSamples: 2, startPageValid: true } })),
            { passed: true, reasons: [] },
        );
    });

    it('18 - an invalid start page blocks the crawl even with enough samples', () => {
        const verdict = validateSiteProfile(profileWith({ validation: { validSamples: 2, startPageValid: false } }));
        assert.ok(verdict.reasons.includes('start_page_invalid'));
    });

    it('16 - a single sample only has to validate itself', () => {
        const single = profileWith({});
        single.validation.sampleUrls = ['https://h.io/docs/a'];
        single.validation.validSamples = 1;
        assert.deepEqual(validateSiteProfile(single), { passed: true, reasons: [] });

        single.validation.validSamples = 0;
        single.validation.startPageValid = false;
        assert.ok(validateSiteProfile(single).reasons.includes('insufficient_valid_samples'));
    });

    it('18 - a missing content root and a low-confidence prefix block the crawl', () => {
        const noRoot = profileWith({});
        noRoot.contentRoot = { selector: null, score: 0, confidence: 0 };
        assert.ok(validateSiteProfile(noRoot).reasons.includes('no_content_root'));

        const lowConfidence = profileWith({});
        lowConfidence.crawlBoundary = { strategy: 'path-prefix', pathPrefix: '/docs/', confidence: 0.4, source: 'test' };
        assert.ok(validateSiteProfile(lowConfidence).reasons.includes('crawl_boundary_low_confidence'));
    });
});

describe('pickSampleUrls', () => {
    it('16 - picks the start page plus one from each of the outer thirds', () => {
        const candidates = Array.from({ length: 30 }, (_v, i) => `https://h.io/docs/p${i}`);
        const samples = pickSampleUrls('https://h.io/docs/start', candidates);
        assert.equal(samples.length, 3);
        assert.equal(samples[0], 'https://h.io/docs/start');
        assert.notEqual(samples[1], samples[2]);
    });

    it('16 - a short list is returned whole', () => {
        assert.deepEqual(
            pickSampleUrls('https://h.io/a', ['https://h.io/b']),
            ['https://h.io/a', 'https://h.io/b'],
        );
    });
});

describe('HTTP status classification', () => {
    it('retries only the statuses that a second identical request could resolve', () => {
        for (const status of [408, 425, 429, 500, 502, 503, 504]) {
            assert.equal(isRetryableHttpStatus(status), true, String(status));
        }
        // 501 הוא ה-5xx שמוכיח למה הכלל הגס "5xx = retry" שגוי: שרת שהודיע
        // Not Implemented לא ישנה את דעתו בניסיון זהה.
        for (const status of [400, 401, 403, 404, 410, 451, 501, 505]) {
            assert.equal(isRetryableHttpStatus(status), false, String(status));
        }
    });

    it('classifies success, failure and "no response to measure" distinctly', () => {
        assert.deepEqual(classifyHttpStatus(200), { failed: false, retryable: false, reason: null });
        assert.deepEqual(classifyHttpStatus(301), { failed: false, retryable: false, reason: null });
        assert.deepEqual(classifyHttpStatus(404), { failed: true, retryable: false, reason: 'http_404' });
        assert.deepEqual(classifyHttpStatus(503), { failed: true, retryable: true, reason: 'http_503' });
        // goto מחזיר null בניווט שאינו יוצר תשובה חדשה. היעדר מדידה אינו כשל.
        assert.deepEqual(classifyHttpStatus(0), { failed: false, retryable: false, reason: null });
    });
});

describe('estimateMaxRequests', () => {
    it('21 - floors at 50 pages and caps at 5000 requests', () => {
        const profile = createEmptyProfile('https://h.io/docs/');
        assert.equal(estimateMaxRequests(profile), 75);

        profile.discovery.candidateDocLinks = 200;
        assert.equal(estimateMaxRequests(profile), 300);

        profile.discovery.sitemapUrls = Array.from({ length: 9000 }, (_v, i) => `https://h.io/${i}`);
        assert.equal(estimateMaxRequests(profile), 5000);
    });
});

// --- 14: CLI -----------------------------------------------------------------
describe('parseArgv', () => {
    it('14 - --glob is pulled out wherever it appears', () => {
        const parsed = parseArgv(['https://h.io/docs/', '--glob', 'https://h.io/docs/**', 'out.json']);
        assert.equal(parsed.globOverride, 'https://h.io/docs/**');
        assert.equal(parsed.outputFile, 'out.json');
        assert.deepEqual(parsed.targetUrls, ['https://h.io/docs/']);
    });

    it('14 - --analyze-only is a flag, not a positional', () => {
        const parsed = parseArgv(['https://h.io/docs/', 'out.json', '--analyze-only']);
        assert.equal(parsed.analyzeOnly, true);
        assert.equal(parsed.outputFile, 'out.json');
    });

    // "--glob" בסוף השורה הוא בקשה שלא ניתן לקיים. ההתנהגות הקודמת - להשמיט
    // אותו בשקט - הייתה סורקת אתר שלם למי שביקש במפורש תת-עץ אחד.
    it('14 - --glob without a pattern is a CLI error, not a silent no-op', () => {
        const parsed = parseArgv(['https://h.io/docs/', 'out.json', '--glob']);
        assert.match(parsed.cliError, /--glob requires a pattern/);
        assert.equal(parsed.globOverride, undefined);
    });

    it('15 - --only takes the output file first and the URL list after it', () => {
        const parsed = parseArgv(['--only', 'out.json', 'https://h.io/a', 'https://h.io/b']);
        assert.equal(parsed.onlyMode, true);
        assert.equal(parsed.outputFile, 'out.json');
        assert.deepEqual(parsed.targetUrls, ['https://h.io/a', 'https://h.io/b']);
    });
});

// --- 4, 5, 6, 11, 18: מדידת DOM ----------------------------------------------
describe('detectContentRoot', () => {
    it('5 - article beats a main that contains the navigation', async () => {
        const root = await withPage('/docs/overview/', (page) => detectContentRoot(page));
        assert.equal(root.selector, 'article');
    });

    it('6 - a sidebar with sixty links does not win over the article', async () => {
        const root = await withPage('/sidebar-heavy/', (page) => detectContentRoot(page));
        assert.equal(root.selector, 'article');
    });

    it('4 - TypeDoc has neither main nor article and is still scored', async () => {
        const root = await withPage('/typedoc/', (page) => detectContentRoot(page));
        assert.equal(root.selector, '.col-content');
        assert.ok(root.score > 0);
    });

    it('4 - a nav-only main falls through to the body-children scan', async () => {
        const root = await withPage('/nostructure/', (page) => detectContentRoot(page));
        assert.equal(root.selector, 'body > *');
        assert.equal(typeof root.matchIndex, 'number');
        const extracted = await withPage('/nostructure/', (page) => extractPage(page, root));
        assert.match(extracted.content, /Handwritten/);
        assert.doesNotMatch(extracted.content, /Home \/ Docs/);
    });
});

describe('content root identity', () => {
    it('extractPage uses the exact root instance selected by detectContentRoot', async () => {
        const root = await withPage('/two-articles/', (page) => detectContentRoot(page));
        assert.equal(root.selector, 'article');
        assert.equal(root.matchIndex, 1);

        const result = await withPage('/two-articles/', (page) => extractPage(page, root));
        assert.equal(result.rootFound, true);
        assert.match(result.content, /Correct documentation/);
        assert.doesNotMatch(result.content, /Wrong article/);
        assert.deepEqual(result.codeBlocks, ['const answer = 42;']);
    });

    it('a bare selector still means the first match, so the old contract holds', async () => {
        const result = await withPage('/two-articles/', (page) => extractPage(page, 'article'));
        assert.equal(result.rootFound, true);
        assert.match(result.content, /Wrong article/);
    });

    it('a matchIndex past the end reports rootFound:false rather than throwing', async () => {
        const result = await withPage('/two-articles/', (page) =>
            extractPage(page, { selector: 'article', matchIndex: 7 }));
        assert.equal(result.rootFound, false);
        assert.equal(result.content, '');
    });
});

describe('extractPage', () => {
    it('18 - content, headings, code blocks and links all come from the same root', async () => {
        const extracted = await withPage('/docs/overview/', (page) => extractPage(page, 'article'));
        assert.equal(extracted.rootFound, true);
        assert.deepEqual(extracted.headings, [{ level: 1, text: 'Overview' }]);
        assert.deepEqual(extracted.codeBlocks, ['const answer = 42;']);
        // הסרגל מחזיק עשרה קישורים; ה-article מחזיק אחד. ב-v1 הפלט היה כולל
        // את שניהם, כי הקישורים נלקחו מסלקטור אחר מהתוכן.
        assert.equal(extracted.hyperlinks.length, 1);
        assert.match(extracted.hyperlinks[0].url, /\/docs\/a$/);
        assert.doesNotMatch(extracted.content, /marketing/i);
    });

    it('18 - a missing root reports rootFound:false instead of throwing', async () => {
        const extracted = await withPage('/typedoc/', (page) => extractPage(page, 'article'));
        assert.deepEqual(extracted, {
            rootFound: false,
            html: '',
            content: '',
            headings: [],
            codeBlocks: [],
            hyperlinks: [],
        });
    });
});

// --- Turndown כ-adapter מבודד -------------------------------------------------
// הבדיקות כאן עובדות על HTML ישירות, בלי דפדפן: זו בדיוק הנקודה של המודול
// הנפרד. אם מחליפים את Turndown, זו הסוויטה שצריכה לעבור.
describe('htmlToMarkdown', () => {
    it('applies the configured style: atx headings, dash bullets, inlined links', () => {
        const md = htmlToMarkdown('<h2>Title</h2><ul><li>one</li></ul><p><a href="https://h.io/a">link</a></p>');
        assert.match(md, /^## Title/);
        // Turndown מרווח פריט רשימה כמרקר ועוד שלושה רווחים, כדי שההזחה של
        // המשך הפריט תהיה ארבעה תווים. הטענה היא על המרקר, לא על הריווח.
        assert.match(md, /^-\s+one$/m);
        assert.match(md, /\[link\]\(https:\/\/h\.io\/a\)/);
    });

    it('keeps GFM tables, which plain Turndown flattens into loose text', () => {
        const md = htmlToMarkdown('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
        assert.match(md, /\| a \| b \|/);
        assert.match(md, /\| 1 \| 2 \|/);
    });

    // ארבעת המקרים נמדדו מול turndown 7.2.4: רק הראשון עובד אצלו מלכתחילה.
    it('recovers the code language from every place documentation generators put it', () => {
        assert.match(htmlToMarkdown('<pre><code class="language-ts">x</code></pre>'), /^```ts$/m);
        assert.match(htmlToMarkdown('<pre><code class="lang-ts">x</code></pre>'), /^```ts$/m);
        assert.match(htmlToMarkdown('<pre class="astro-code language-bash"><code>x</code></pre>'), /^```bash$/m);
        assert.match(htmlToMarkdown('<pre data-language="bash"><code>x</code></pre>'), /^```bash$/m);
        assert.match(htmlToMarkdown('<pre>plain\nlines</pre>'), /^```\nplain\nlines\n```$/m);
    });

    it('lengthens the fence when the code itself contains one', () => {
        const md = htmlToMarkdown('<pre><code>see ``` inside</code></pre>');
        assert.match(md, /^````\nsee ``` inside\n````$/m);
    });

    it('drops script and style text even when the caller did not clean them', () => {
        const md = htmlToMarkdown('<div><p>kept</p><script>leaked()</script><style>.x{}</style></div>');
        assert.equal(md, 'kept');
    });

    it('returns an empty string for empty input rather than throwing', () => {
        assert.equal(htmlToMarkdown(''), '');
        assert.equal(htmlToMarkdown(null), '');
    });
});

describe('extractPage html layer', () => {
    it('removes non-content elements and absolutises links and images', async () => {
        const extracted = await withPage('/markdown/', (page) => extractPage(page, 'article'));

        assert.doesNotMatch(extracted.html, /__analytics/, 'script text must not survive into the html layer');
        assert.doesNotMatch(extracted.html, /color: red/);
        assert.doesNotMatch(extracted.html, /aria-hidden/);
        assert.doesNotMatch(extracted.html, /<button/);

        assert.match(extracted.html, new RegExp(`href="${origin}/api/foo"`));
        assert.match(extracted.html, new RegExp(`src="${origin}/markdown/diagram.png"`));

        // ה-codeBlocks עדיין נקראים מה-DOM החי, ולכן המקור הנקי של כפתור
        // ההעתקה שורד גם אחרי שהכפתור הוסר מה-clone.
        assert.ok(extracted.codeBlocks.includes('npm i turndown'));
    });

    it('feeds a markdown that keeps lists, tables, languages and absolute links', async () => {
        const extracted = await withPage('/markdown/', (page) => extractPage(page, 'article'));
        const md = htmlToMarkdown(extracted.html);

        assert.match(md, /^# Markdown page$/m);
        assert.match(md, /^-\s+first item$/m);
        assert.match(md, /\| flag \| meaning \|/);
        assert.match(md, /^```ts$/m);
        assert.match(md, /^```bash$/m);
        assert.match(md, new RegExp(`\\[the API\\]\\(${origin}/api/foo\\)`));
        assert.doesNotMatch(md, /__analytics/);
        // הכותרת נשארת נקייה: העוגן ה-aria-hidden היה הופך אותה ל-"# Markdown page#".
        assert.doesNotMatch(md, /^# Markdown page#/m);
    });
});

// הרגרסיה שנתפסה על אתר חי, לא בקופסה: 24 גדרות בלי שפה, וכל הפקודות דבוקות
// לשורה אחת. שתי הטענות כאן הן החוזה שמונע את חזרתו.
describe('expressive code blocks', () => {
    it('keeps one line per rendered line instead of gluing them together', async () => {
        const extracted = await withPage('/expressive/', (page) => extractPage(page, 'article'));
        const md = htmlToMarkdown(extracted.html);

        assert.match(md, /^```bash$/m, 'the language lives in data-language, not in a class');
        assert.match(md, /^git clone repo$/m);
        assert.match(md, /^cd repo$/m);
        assert.match(md, /^pnpm install$/m);
        assert.doesNotMatch(md, /repocd/, 'structural line breaks must not disappear');
    });

    it('still reads the clean source separately into codeBlocks', async () => {
        const extracted = await withPage('/expressive/', (page) => extractPage(page, 'article'));
        assert.ok(extracted.codeBlocks.includes('git clone repo\ncd repo\npnpm install'));
    });
});

// ⚠️ הרגרסיה שהתיקון הראשון לא תפס. ההמתנה עברה ל"חלון שקט", וזה הספיק
// ל-jsonforms.io רק במקרה — אותו עמוד רועש ברציפות בזמן ההידרציה. עמוד ששקט
// מיד ומוסיף אחרי 1.4 שניות נסגר ב-772ms עם מחצית התוכן, בלי שום סימן.
describe('a page that goes quiet and then adds content', () => {
    it('captures what arrives after the first quiet window', async () => {
        const extracted = await withPage('/late/', async (page) => {
            await settlePage(page);
            return extractPage(page, 'article');
        });
        assert.match(extracted.content, /Late page/);
        assert.match(extracted.content, /Arrived late/, 'the late section must be in the capture');
        assert.equal(extracted.headings.length, 2);
    });

    it('measureLateGrowth reports zero once the page really is done', async () => {
        const grew = await withPage('/late/', async (page) => {
            await settlePage(page);
            const extracted = await extractPage(page, 'article');
            return measureLateGrowth(page, 'article', extracted.content.length);
        });
        assert.equal(grew, 0);
    });

    it('measureLateGrowth reports the shortfall when extraction was premature', async () => {
        // חילוץ מכוון לפני שהתוכן המאוחר הגיע, כדי להוכיח שהמדידה תופסת אותו
        // ולא רק שהיא שותקת כשהכול תקין.
        //
        // ⚠️ החלון מועבר במפורש (1,800ms), והוא גדול מהרגע שבו ה-fixture מוסיף
        // (1,400ms). עם ברירת המחדל של 700ms הבדיקה מחזירה 0 — נמדד — וזה לא
        // כשל של המדידה אלא הגבול שלה: היא חסומה בזמן, ותוכן שמגיע אחריה עדיין
        // חומק. זו הסיבה שהפרמטר גלוי.
        const grew = await withPage('/late/', async (page) => {
            const early = await extractPage(page, 'article');
            return measureLateGrowth(page, 'article', early.content.length, 1800);
        });
        assert.ok(grew > 0, `expected the page to grow after a premature extract, got ${grew}`);
    });

    it('and reports zero with the default window, because the check is bounded', async () => {
        const grew = await withPage('/late/', async (page) => {
            const early = await extractPage(page, 'article');
            return measureLateGrowth(page, 'article', early.content.length);
        });
        assert.equal(grew, 0, 'a 700ms window cannot see content that arrives at 1400ms');
    });
});

describe('readMetaRefreshTarget', () => {
    it('11 - a pending meta refresh target is resolved to an absolute URL', async () => {
        const target = await withPage('/docs/delayed/', (page) => readMetaRefreshTarget(page));
        assert.equal(target, `${origin}/docs/overview/`);
    });

    it('11 - a zero-second refresh is performed by the browser, and reading it never throws', async () => {
        // זה בדיוק המקרה שהפיל את הגרסה הראשונה של הקוד הזה: page.evaluate מת
        // באמצע הניווט. התוצאה הנכונה היא null, לא חריגה.
        const landed = await withPage('/docs/', async (page) => {
            const target = await readMetaRefreshTarget(page);
            await page.waitForURL(`${origin}/docs/overview/`, { timeout: 5000 });
            return { target, url: page.url() };
        });
        assert.equal(landed.url, `${origin}/docs/overview/`);
        assert.ok(landed.target === null || landed.target === `${origin}/docs/overview/`);
    });

    it('11 - a page without a meta refresh returns null', async () => {
        assert.equal(await withPage('/docs/a', (page) => readMetaRefreshTarget(page)), null);
    });
});

// --- 12, 13, 14, 15, 16, 17: ריצות מלאות -------------------------------------
describe('end to end', () => {
    it('17, 12, 13, 7 - a healthy docs tree crawls, and the audit records what went wrong', async () => {
        const run = await runScraper(['{origin}/docs/', '{out}']);

        // /docs/empty ו-/docs/broken קיימים בכוונה, ולכן קוד היציאה חייב להיות 1.
        assert.equal(run.exitCode, 1, run.stderr);
        assert.equal(run.audit.profile.validation.passed, true);

        // 11 - עמוד-הקש נעקב, וה-URL שנפתר הוא העמוד האמיתי.
        assert.equal(run.audit.profile.redirect.metaRefresh, true);
        assert.equal(run.audit.profile.resolvedUrl, `${origin}/docs/overview/`);

        // 1 - ההפניה הזיזה את נקודת ההתחלה, והגבול עדיין /docs/.
        assert.equal(run.audit.profile.crawlBoundary.strategy, 'path-prefix');
        assert.equal(run.audit.profile.crawlBoundary.pathPrefix, '/docs/');

        const urls = run.docs.map((doc) => doc.url);

        // 7 - נכסים לא נכנסו לתור.
        assert.ok(!urls.some((url) => url.endsWith('.png')));
        // גבול הסריקה החזיק: /marketing/ מקושר מעמוד הפתיחה ולא נסרק.
        assert.ok(!urls.some((url) => url.includes('/marketing/')));
        // כתובות חיצוניות לא נסרקו.
        assert.ok(urls.every((url) => url.startsWith(origin)));

        // 8, 9 - הכתובת עם ה-fragment ועם ה-utm הן אותו עמוד כמו /docs/a.
        assert.equal(urls.filter((url) => url === `${origin}/docs/a`).length, 1);
        assert.ok(!urls.some((url) => url.includes('utm_source') || url.includes('#')));
        // 10 - query אמיתי שרד ונסרק כעמוד נפרד.
        assert.ok(urls.includes(`${origin}/docs/versioned?version=2`));

        // 12 - עמוד ריק תועד ולא נעלם.
        assert.deepEqual(run.audit.audit.empty, [`${origin}/docs/empty`]);
        // 13 - בקשה שנכשלה תועדה עם הסיבה, ורק שם: סטטוס 500 הוא לא "עמוד
        // ריק", והדוח חייב להבדיל בין השניים.
        assert.equal(run.audit.audit.failed.length, 1);
        assert.match(run.audit.audit.failed[0].url, /\/docs\/broken$/);
        assert.equal(run.audit.audit.failed[0].error, 'HTTP 500');
        assert.ok(!run.docs.some((doc) => doc.url.endsWith('/docs/broken')));
        // נראה כפול אחרי ה-deepEqual שלמעלה, ואינו: הוא מקבע את הבאג עצמו -
        // כשל HTTP לא יחזור לעולם לסיווג empty, גם אם רשימת ה-empty תגדל.
        assert.ok(!run.audit.audit.empty.includes(`${origin}/docs/broken`));

        // תוכן זהה בשתי כתובות מסומן ככפילות, ועדיין נשמר.
        assert.equal(run.audit.audit.duplicates.length, 1);
        assert.match(run.audit.audit.duplicates[0].url, /\/docs\/mirror$/);

        // 18 - החילוץ בפועל השתמש ב-root שנבחר, ולכן אין בפלט קישורי ניווט.
        const overview = run.docs.find((doc) => doc.url === `${origin}/docs/overview/`);
        assert.equal(overview.codeBlocks.length, 1);
        assert.ok(overview.hyperlinks.length <= 2);
        assert.equal(run.audit.audit.rootMissing.length, 0);

        // ארבע השכבות נשמרות, ואף אחת לא מחליפה אחרת.
        assert.ok(overview.html.includes('<h1>'));
        assert.match(overview.markdown, /^# Overview$/m);
        assert.match(overview.markdown, /^```\nconst answer = 42;\n```$/m);
        assert.match(overview.content, /Overview/);
        assert.deepEqual(overview.codeBlocks, ['const answer = 42;']);
    });

    it('16 - a site whose samples fail is refused before any page is crawled', async () => {
        const run = await runScraper(['{origin}/thin/', '{out}']);
        assert.equal(run.exitCode, 2);
        assert.equal(run.docs, null, 'no output file may be written when analysis fails');
        assert.equal(run.audit.profile.validation.passed, false);
        assert.ok(run.audit.profile.validation.reasons.length > 0);
        assert.equal(run.audit.audit.visited, 0);
    });

    it('3 - a marketing start page falls back to same-origin rather than guessing /docs/', async () => {
        const run = await runScraper(['{origin}/marketing/', '{out}', '--analyze-only']);
        assert.equal(run.exitCode, 0, run.stderr);
        assert.equal(run.audit.profile.crawlBoundary.strategy, 'same-origin');
        assert.equal(run.audit.profile.crawlBoundary.pathPrefix, null);
        assert.equal(run.docs, null, '--analyze-only must not write a docs file');
        assert.equal(run.audit.audit.visited, 0);
    });

    it('14 - --glob replaces inference entirely', async () => {
        const run = await runScraper([
            '{origin}/docs/',
            '{out}',
            '--glob',
            '{origin}/docs/a*',
            '--analyze-only',
        ]);
        assert.equal(run.exitCode, 0, run.stderr);
        assert.equal(run.audit.profile.crawlBoundary.strategy, 'glob');
        assert.equal(run.audit.profile.crawlBoundary.source, 'user-override');
        assert.equal(run.audit.profile.crawlBoundary.pathPrefix, null);
    });

    // חוזה מנוע הסריקה מול קודי סטטוס, ולא רק המקרה הנקודתי של /docs/broken.
    // ריצה אחת, ארבע טענות: כל סטטוס נכנס למגירה שלו, ומדיניות ה-retry נמדדת
    // לפי מספר הפגיעות בשרת ולא לפי מה שהקוד טוען על עצמו.
    describe('HTTP status policy', () => {
        let run;

        before(async () => {
            HITS.clear();
            run = await runScraper(['{origin}/http/', '{out}']);
        });

        it('404 - one attempt, recorded as failed, never as empty', () => {
            assert.equal(HITS.get('/http/notfound'), 1, 'a 404 must not be retried');
            const entry = run.audit.audit.failed.find((f) => f.url.endsWith('/http/notfound'));
            assert.equal(entry?.error, 'HTTP 404');
            assert.ok(!run.audit.audit.empty.includes(`${origin}/http/notfound`));
            assert.ok(!run.docs.some((doc) => doc.url.endsWith('/http/notfound')));
        });

        it('500 - retried, then recorded as failed, never as empty', () => {
            assert.ok(HITS.get('/http/broken') > 1, `a 500 must be retried, got ${HITS.get('/http/broken')}`);
            const entry = run.audit.audit.failed.find((f) => f.url.endsWith('/http/broken'));
            assert.equal(entry?.error, 'HTTP 500');
            assert.ok(!run.audit.audit.empty.includes(`${origin}/http/broken`));
            assert.ok(!run.docs.some((doc) => doc.url.endsWith('/http/broken')));
        });

        it('429 - retried, then recorded as failed, never as empty', () => {
            assert.ok(HITS.get('/http/throttled') > 1, `a 429 must be retried, got ${HITS.get('/http/throttled')}`);
            const entry = run.audit.audit.failed.find((f) => f.url.endsWith('/http/throttled'));
            // הנוסח כאן אינו שלנו, ובכוונה לא נכפה: 429 הוא
            // BLOCKED_STATUS_CODE של Crawlee, והיא זורקת עליו לפני שה-handler
            // רץ. הטענה היא על החוזה - נכשל, עבר retry, לא empty ולא בפלט -
            // ולא על מי ניסח את ההודעה. נמדד: 'Request blocked - received 429
            // status code.'
            assert.ok(entry, 'a 429 must land in audit.failed');
            assert.match(entry.error, /(?:HTTP 429|429 status code)/);
            assert.ok(!run.audit.audit.empty.includes(`${origin}/http/throttled`));
            assert.ok(!run.docs.some((doc) => doc.url.endsWith('/http/throttled')));
        });

        it('200 application/json - skipped as non-HTML, and not counted as a failure', () => {
            assert.deepEqual(
                run.audit.audit.skippedNonHtml.map((entry) => entry.url),
                [`${origin}/http/export`],
            );
            assert.match(run.audit.audit.skippedNonHtml[0].contentType, /application\/json/);
            assert.ok(!run.audit.audit.failed.some((f) => f.url.endsWith('/http/export')));
            assert.ok(!run.audit.audit.empty.includes(`${origin}/http/export`));
            assert.ok(!run.docs.some((doc) => doc.url.endsWith('/http/export')));
        });

        it('the healthy pages of the same tree still crawl and store', () => {
            // שלוש כתובות שגיאה, שלוש רשומות failed - ולא ארבע: ה-JSON התקין
            // אינו כשל, וה-assertion הזה הוא מה שמונע ממנו לזלוג לשם.
            assert.equal(run.audit.audit.failed.length, 3);
            assert.equal(run.exitCode, 1, 'three failing URLs must surface as exit code 1');
            assert.equal(run.audit.audit.stored, HTTP_OK_PAGES.length + 1);
            assert.equal(run.audit.audit.empty.length, 0);
            assert.equal(run.audit.profile.crawlBoundary.pathPrefix, '/http/');
        });
    });

    // ארבעת החוזים שהסוויטה הקודמת לא ייצגה - ולכן ירוקה לא הייתה יכולה
    // לחשוף אותם. כולם על אותו נושא: ה-analysis חייב לבדוק בדיוק את מה
    // שהסריקה תבדוק, ועל אותם עמודים שהיא תסרוק.
    describe('the analyzer measures what the crawler will actually do', () => {
        it('a start URL that returns 500 with documentation-shaped HTML is refused', async () => {
            const run = await runScraper(['{origin}/rich500/', '{out}']);
            assert.equal(run.exitCode, 2);
            assert.equal(run.docs, null);
            assert.deepEqual(run.audit.profile.validation.reasons, ['start_url_http_500']);
            // ההוכחה שזה ה-status ולא התוכן: אותו גוף עובר את validator התוכן.
            assert.deepEqual(
                validateExtractedPage({
                    content: 'x'.repeat(600),
                    headings: [{ level: 1, text: 'Rich 500' }],
                    hyperlinks: [{ text: 'home', url: 'https://h.io/' }],
                }),
                { valid: true, reasons: [] },
            );
        });

        it('samples that return 404 with documentation-shaped HTML are invalid', async () => {
            const run = await runScraper(['{origin}/rich/', '{out}']);
            assert.equal(run.exitCode, 2);
            const failures = run.audit.profile.validation.sampleResults.filter((s) => !s.valid);
            assert.ok(failures.length >= 2, 'both non-start samples land on a 404');
            for (const failure of failures) {
                assert.deepEqual(failure.reasons, ['http_404']);
            }
            assert.ok(run.audit.profile.validation.reasons.includes('insufficient_valid_samples'));
        });

        it('--glob narrows the samples, not only the queue', async () => {
            // /scoped/docs/ תקין, /scoped/api/ דק. ההסקה האוטומטית נופלת
            // ל-same-origin ומאמתת את שניהם יחד, ולכן רק ה---glob מכריע.
            const docsRun = await runScraper([
                '{origin}/scoped/', '{out}', '--glob', '{origin}/scoped/docs/**', '--analyze-only',
            ]);
            assert.equal(docsRun.exitCode, 0, docsRun.stderr);
            assert.equal(docsRun.audit.profile.crawlBoundary.glob, `${origin}/scoped/docs/**`);
            for (const sample of docsRun.audit.profile.validation.sampleUrls.slice(1)) {
                assert.match(sample, /\/scoped\/docs\//, 'samples must come from inside the glob');
            }

            // אותו אתר, אותו עמוד פתיחה, glob אחר - וה-analysis חייב להיכשל,
            // כי העמודים שייסרקו בפועל אינם עומדים בתנאי החילוץ.
            const apiRun = await runScraper([
                '{origin}/scoped/', '{out}', '--glob', '{origin}/scoped/api/**', '--analyze-only',
            ]);
            assert.equal(apiRun.exitCode, 2);
            assert.ok(apiRun.audit.profile.validation.reasons.includes('insufficient_valid_samples'));
            for (const sample of apiRun.audit.profile.validation.sampleUrls.slice(1)) {
                assert.match(sample, /\/scoped\/api\//);
            }
        });

        it('a cross-origin redirect reloads robots.txt for the origin it landed on', async () => {
            // origin המקור מתיר הכול; היעד אוסר הכול. בלי טעינה מחדש הסריקה
            // הייתה ממשיכה עם המדיניות של האתר הלא נכון.
            const run = await runScraper(['{origin}/cross/', '{out}']);
            assert.equal(run.exitCode, 2);
            assert.equal(run.audit.profile.resolvedUrl, `${otherOrigin}/docs/overview/`);
            assert.deepEqual(run.audit.profile.validation.reasons, ['robots_disallows_resolved_url']);
        });
    });

    // הרגרסיה שנתפסה רק בשטח: שתי סריקות במקביל מאותה ספרייה. Crawlee מגדירה
    // purgeOnStart=true, ו-purge() מוחקת את request_queues/default - כלומר
    // הריצה השנייה מחקה את התור של הראשונה תוך כדי עבודתה, והראשונה מתה
    // ב-ENOENT אחרי שכבר שמרה עמודים. שתי הריצות כאן רצות בלי
    // CRAWLEE_STORAGE_DIR מפורש, בדיוק כמו בשורת הפקודה.
    it('two crawls running side by side from one directory do not destroy each other', async () => {
        const shared = mkdtempSync(join(tmpdir(), 'scraper-v2-shared-'));
        try {
            const [first, second] = await Promise.all([
                runScraper(['{origin}/docs/', '{out}'], {
                    cwd: shared, isolateStorage: false, outputName: 'first.json',
                }),
                runScraper(['{origin}/http/', '{out}'], {
                    cwd: shared, isolateStorage: false, outputName: 'second.json',
                }),
            ]);

            for (const [name, run] of [['first', first], ['second', second]]) {
                assert.equal(run.audit?.audit.crawlerError, null, `${name} must not abort`);
                assert.ok(run.docs?.length > 0, `${name} must store pages`);
                assert.doesNotMatch(run.stderr, /ENOENT/, `${name} must not lose its queue`);
            }

            // ההוכחה שהבידוד הוא שמנע את ההתנגשות, ולא מזל בתזמון.
            assert.deepEqual(
                [storageDirFor('first.json'), storageDirFor('second.json')],
                [join('storage', 'first'), join('storage', 'second')],
            );
            assert.ok(existsSync(join(shared, 'storage', 'first', 'request_queues')));
            assert.ok(existsSync(join(shared, 'storage', 'second', 'request_queues')));
        } finally {
            rmSync(shared, { recursive: true, force: true });
        }
    });

    it('15 - --only crawls exactly the URLs it was given', async () => {
        const run = await runScraper(['--only', '{out}', '{origin}/docs/a', '{origin}/docs/b']);
        assert.equal(run.exitCode, 0, run.stderr);
        assert.equal(run.audit.profile.crawlBoundary.strategy, 'only');
        assert.deepEqual(
            run.docs.map((doc) => doc.url).sort(),
            [`${origin}/docs/a`, `${origin}/docs/b`],
        );
        assert.equal(run.audit.audit.visited, 2);
    });
});
