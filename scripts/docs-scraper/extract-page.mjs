// שלב ה-Extractor: כל מה שנקרא מתוך עמוד שכבר רונדר.
//
// כל הפונקציות כאן מקבלות Playwright Page ומריצות evaluate. הן לא מחליטות
// כלום על האתר ולא כותבות לשום מקום - הן רק מודדות ומחלצות.

// ⚠️ 8 שניות לא הספיקו לעמוד שמריץ דמו חי. jsonforms.io הידרט את הסקשנים
// האחרונים אחרי שההמתנה כבר חזרה, ולכן התקרה עלתה - היא תקרה, לא זמן המתנה:
// עמוד יציב יוצא ממנה תוך שתי שניות.
const SETTLE_TIMEOUT_MS = 20_000;
const SETTLE_MIN_CHARS = 200;
/** כמה זמן אורך הטקסט חייב להישאר ללא שינוי לפני שהעמוד נחשב מרונדר. */
const SETTLE_STABLE_MS = 700;
/**
 * כמה זמן חייבים לצפות בעמוד לפני שמותר לקרוא לו יציב - גם אם הוא שקט מהרגע
 * הראשון.
 *
 * ⚠️ חלון שקט לבדו אינו מבדיל בין "סיים" לבין "עוד לא התחיל", וזה נמדד: עמוד
 * שמוסיף פסקה אחרי 1,500ms נסגר אחרי 772ms עם 406 תווים במקום 812. התיקון
 * הקודם עבד על jsonforms.io רק במקרה - אותו עמוד רועש ברציפות בזמן ההידרציה,
 * כך שהחלון מעולם לא נסגר מוקדם. עמוד ששקט ואז טוען, לא.
 *
 * הרצפה היא ההודאה שאי אפשר לדעת מתי עמוד "סיים": היא קונה חלון שבו טעינה
 * מאוחרת עוד נתפסת, ומעליה עדיין אפשר לפספס. מה שמונע פספוס שקט הוא לא המספר
 * הזה אלא הבדיקה שאחרי החילוץ - ראו `verifyNoLateContent`.
 */
const SETTLE_MIN_OBSERVE_MS = 2_000;

// ה-root נבחר לפי ניקוד, לא לפי זהות המחולל. המשקלים מתגמלים סימני תוכן
// (פסקאות, כותרות, בלוקי קוד) ומענישים סימני ניווט (nav/aside/footer וצפיפות
// קישורים), כך שסרגל צד עם 116 קישורים מפסיד לגוף עמוד גם כשהוא ארוך ממנו.
export async function detectContentRoot(page) {
    return page.evaluate(() => {
        const explicitSelectors = [
            'article',
            'main',
            '[role="main"]',
            '.col-content',
            '.content',
            '.docs-content',
            '.documentation',
        ];
        const candidates = [];

        function scoreElement(el) {
            const text = (el.innerText || '').trim();
            if (text.length < 100) return -Infinity;
            const chars = text.length;
            const paragraphs = el.querySelectorAll('p').length;
            const headings = el.querySelectorAll('h1,h2,h3,h4').length;
            const codeBlocks = el.querySelectorAll('pre').length;
            const listItems = el.querySelectorAll('li').length;
            const links = el.querySelectorAll('a[href]').length;
            const navElements = el.querySelectorAll('nav,header,footer,[role="navigation"],aside').length;
            const linkDensity = links / Math.max(1, text.split(/\s+/).length);
            return (
                chars +
                paragraphs * 120 +
                headings * 300 +
                codeBlocks * 500 +
                listItems * 20 -
                navElements * 1500 -
                linkDensity * 4000
            );
        }

        // matchIndex נשמר לצד הסלקטור, כי סלקטור לבדו אינו מזהה אלמנט. עמוד עם
        // שני <article> - הראשון כרטיס תקציר, השני גוף העמוד - גורם ל-analysis
        // לבחור את השני ול-extractor לקרוא את הראשון, ואף אחד מהשניים לא מדווח
        // על סתירה. זה בדיוק הכשל השקט שהגרסה הזו קיימת כדי למנוע.
        for (const selector of explicitSelectors) {
            document.querySelectorAll(selector).forEach((el, matchIndex) => {
                candidates.push({
                    selector,
                    matchIndex,
                    score: scoreElement(el),
                    htmlLength: el.innerHTML.length,
                });
            });
        }

        // הנפילה ל-body children מותנית בכך שאין מועמד עם ניקוד סופי, ולא רק
        // בכך שהרשימה ריקה. TypeDoc, למשל, פולט main שמכיל רק breadcrumbs: הוא
        // נכנס לרשימה עם -Infinity, ובתנאי "הרשימה ריקה" הוא היה חוסם סריקה של
        // אתר תקין לחלוטין.
        if (!candidates.some((candidate) => Number.isFinite(candidate.score))) {
            [...document.body.children].forEach((el, matchIndex) => {
                candidates.push({
                    selector: 'body > *',
                    matchIndex,
                    score: scoreElement(el),
                    htmlLength: el.innerHTML.length,
                });
            });
        }

        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0] || null;
        const second = candidates[1] || null;
        if (!best || !Number.isFinite(best.score)) {
            return null;
        }

        const confidence = second && Number.isFinite(second.score)
            ? Math.max(0, Math.min(1, (best.score - second.score) / Math.max(1, Math.abs(best.score))))
            : 1;

        return {
            selector: best.selector,
            matchIndex: best.matchIndex,
            score: best.score,
            confidence,
        };
    });
}

// חילוץ אחד, root אחד. ב-v1 היו שני סלקטורים שונים לתוכן ולקישורים, ולכן
// "לאן העמוד הזה מפנה" החזיר את סרגל הניווט של האתר.
//
// מוחזרות ארבע שכבות ולא אחת: html (המקור, לאחר ניקוי), content (טקסט),
// headings, codeBlocks ו-hyperlinks. ה-Markdown נגזר מ-html בצד Node, ולכן
// אינו מוחזר כאן - אבל הוא גם לא מחליף את codeBlocks (ראו למטה).
export async function extractPage(page, contentRoot) {
    // מקבל גם מחרוזת וגם את ה-contentRoot המלא, כדי לא לשבור קריאה קיימת.
    // מחרוזת פירושה "ההתאמה הראשונה", וזו בדיוק ההנחה שהייתה כאן קודם.
    const descriptor =
        typeof contentRoot === 'string'
            ? { selector: contentRoot, matchIndex: 0 }
            : { selector: contentRoot.selector, matchIndex: contentRoot.matchIndex ?? 0 };

    return page.evaluate(({ selector, matchIndex }) => {
        const root = document.querySelectorAll(selector)[matchIndex];
        if (!root) {
            return {
                rootFound: false,
                html: '',
                content: '',
                headings: [],
                codeBlocks: [],
                hyperlinks: [],
            };
        }

        const headings = [...root.querySelectorAll('h1,h2,h3,h4')]
            .map((h) => ({
                level: Number(h.tagName.slice(1)),
                text: h.innerText.trim(),
            }))
            .filter((h) => h.text);

        // שני מסלולים, כי מחוללי תיעוד מגישים קוד אחרת: Expressive Code (Astro)
        // מחזיק את המקור הנקי ב-data-code של כפתור ההעתקה ומקודד שורה חדשה כתו
        // DEL, וכל השאר מגישים pre רגיל. הכתיב '\u007F' מפורש בכוונה: תו בקרה
        // ממשי בקוד המקור נמחק בשקט בכל עריכה או העתקה.
        //
        // המסלול הזה נשאר גם אחרי שנוסף ה-Markdown, ובמכוון: ה-data-code הוא
        // המקור הנקי, בעוד שה-<pre> הוא הגרסה המעוצבת. Markdown שנגזר מה-HTML
        // הוא פלט נוסף, לא מקור אמת יחיד.
        const fromCopyButtons = [...root.querySelectorAll('button[data-code]')]
            .map((b) => b.getAttribute('data-code')?.replaceAll('\u007F', '\n').trim())
            .filter(Boolean);
        const fromPre = [...root.querySelectorAll('pre')]
            .map((pre) => pre.innerText.trim())
            .filter(Boolean);
        const codeBlocks = [...new Set([...fromCopyButtons, ...fromPre])];

        const hyperlinks = [...root.querySelectorAll('a[href]')]
            .map((el) => {
                try {
                    return {
                        text: el.innerText.trim() || '[ללא טקסט/אייקון]',
                        url: new URL(el.getAttribute('href'), location.href).href,
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        // ה-HTML נלקח מ-clone ולא מה-root החי, כי הוא עובר עריכה. שתי עריכות
        // בלבד, ושתיהן סמנטיות ולא תלויות אתר:
        //
        //   1. הסרת אלמנטים שאינם תוכן. script/style/noscript הם הכרח - הטקסט
        //      שלהם היה נשפך ל-Markdown כאילו היה פסקה. button ו-aria-hidden
        //      הם פקדי ממשק ("Copy", "Edit this page", עוגני כותרת): לא תיעוד.
        //      ביודעין לא מוסרים כאן class names כמו .pagination-links - זה היה
        //      חוזר בדיוק ל-hardcode-לפי-אתר שהגרסה הזו מוחקת.
        //   2. הפיכת קישורים ותמונות לכתובות מוחלטות. ב-Markdown שיישמר בדיסק
        //      "../api/foo" הוא חסר משמעות, כי אין יותר עמוד שממנו הוא יחסי.
        const clone = root.cloneNode(true);

        // שטיחת בלוקי הקוד, לפני כל הסרה - כאן ה-clone עדיין זהה במבנה ל-root,
        // ולכן אפשר להתאים ביניהם לפי אינדקס.
        //
        // נמדד על workflowbuilder.io: Expressive Code פולט
        // <pre data-language="bash"> ובתוכו <div class="ec-line"> לכל שורה.
        // textContent על מבנה כזה מחזיר "git clone repocd repopnpm install" -
        // כל הפקודות דבוקות, כי מעברי השורה הם מבניים ולא תווים. ה-Markdown
        // שיצא היה בלוק קוד שלא ניתן להריץ ממנו דבר.
        //
        // שני מקורות לטקסט הנקי, לפי סדר אמינות:
        //   1. data-code של כפתור ההעתקה - המקור שהאתר עצמו מצהיר עליו, בלי
        //      מספור שורות וסימוני diff. נלקח רק כשמספר הכפתורים שווה למספר
        //      ה-pre, כדי שההתאמה לפי אינדקס תהיה ודאית ולא ניחוש.
        //   2. innerText של ה-pre החי. הדפדפן הוא זה שפורס את השורות, ולכן אין
        //      כאן היוריסטיקה משלנו.
        const livePres = root.querySelectorAll('pre');
        const liveCopyButtons = root.querySelectorAll('button[data-code]');
        const copyButtonsMatchPres =
            liveCopyButtons.length > 0 && liveCopyButtons.length === livePres.length;

        clone.querySelectorAll('pre').forEach((pre, index) => {
            // השפה נשמרת על ה-pre לפני השטיחה, כי היא יכולה לשבת על ה-<code>
            // שעומד להימחק. data-language הוא הדפוס של Expressive Code ו-Shiki;
            // language-/lang- הוא של כל השאר.
            const code = pre.querySelector('code');
            const declared =
                pre.getAttribute('data-language') ||
                pre.getAttribute('data-lang') ||
                `${code?.getAttribute('class') ?? ''} ${pre.getAttribute('class') ?? ''}`
                    .match(/(?:language-|lang-)([\w+#-]+)/)?.[1] ||
                '';
            if (declared) {
                pre.setAttribute('data-language', declared);
            }

            const fromCopyButton = copyButtonsMatchPres
                ? liveCopyButtons[index].getAttribute('data-code')?.replaceAll('\u007F', '\n')
                : null;
            const text = (fromCopyButton ?? livePres[index]?.innerText ?? pre.textContent ?? '')
                .replace(/\n+$/, '');
            if (text) {
                pre.textContent = text;
            }
        });

        clone.querySelectorAll('script, style, noscript, button, [aria-hidden="true"]')
            .forEach((el) => el.remove());
        clone.querySelectorAll('a[href]').forEach((a) => {
            try {
                a.setAttribute('href', new URL(a.getAttribute('href'), location.href).href);
            } catch {
                // קישור שאינו כתובת (javascript:, mailto מעוות). נשאר כפי שהוא.
            }
        });
        clone.querySelectorAll('img[src]').forEach((img) => {
            try {
                img.setAttribute('src', new URL(img.getAttribute('src'), location.href).href);
            } catch {
                // src שאינו כתובת (data: פגום). נשאר כפי שהוא.
            }
        });

        return {
            rootFound: true,
            html: clone.innerHTML.trim(),
            content: root.innerText.trim(),
            headings,
            codeBlocks,
            hyperlinks,
        };
    }, descriptor);
}

// לגילוי לוקחים את כל הקישורים בעמוד, כולל סרגל הניווט. זה ההפך מהחילוץ
// בכוונה: הניווט הוא בדיוק המקום שבו עץ התיעוד מוצהר.
export async function collectNavigationLinks(page) {
    return page.evaluate(() => {
        return [...document.querySelectorAll('a[href]')]
            .map((a) => {
                try {
                    return new URL(a.getAttribute('href'), location.href).href;
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    });
}

// זיהוי מחולל לצורכי דוח בלבד. הוא לא נוגע בבחירת ה-root ולא בגבול הסריקה;
// הוא קיים כדי שקורא ה-audit יבין מול מה עמד.
export async function detectGenerator(page) {
    return page.evaluate(() => {
        const meta = document.querySelector('meta[name="generator" i]')?.getAttribute('content') || '';
        if (meta) {
            return { name: meta.toLowerCase().split(/\s+/)[0], confidence: 1 };
        }
        const fingerprints = [
            { name: 'typedoc', confidence: 0.9, selector: '.tsd-page-title, .col-content' },
            { name: 'starlight', confidence: 0.9, selector: 'starlight-menu-button, astro-island' },
            { name: 'docusaurus', confidence: 0.9, selector: '#__docusaurus, .theme-doc-markdown' },
            { name: 'fern', confidence: 0.8, selector: '[class*="fern-"]' },
            { name: 'nextra', confidence: 0.8, selector: '[class*="nextra-"]' },
            { name: 'mkdocs', confidence: 0.8, selector: '[data-md-component], .md-content' },
        ];
        for (const candidate of fingerprints) {
            if (document.querySelector(candidate.selector)) {
                return { name: candidate.name, confidence: candidate.confidence };
            }
        }
        return { name: 'unknown', confidence: 0 };
    });
}

// קורא את היעד של meta refresh שעוד לא בוצע - כלומר כזה עם השהיה
// (content="5;url=..."). ב-content="0;url=..." הדפדפן מבצע את ההפניה בעצמו,
// והפונקציה הזו תרוץ על העמוד החדש או תיפול באמצע הניווט; שני המקרים מטופלים
// אצל הקורא, לפי השוואת הכתובת שנחתה בה בפועל.
//
// ה-try/catch אינו הגנה תיאורטית: Playwright זורק
// "Execution context was destroyed" כשהעמוד מנווט תוך כדי evaluate, וזה קרה
// בבדיקה על עמוד-קש אמיתי. בלעדיו כל עמוד-קש היה נספר כבקשה כושלת.
export async function readMetaRefreshTarget(page) {
    try {
        return await page.evaluate(() => {
            const meta = document.querySelector('meta[http-equiv="refresh" i]');
            if (!meta) return null;
            const content = meta.getAttribute('content') || '';
            const match = content.match(/url\s*=\s*(.+)$/i);
            if (!match) return null;
            try {
                return new URL(match[1].trim().replace(/^['"]|['"]$/g, ''), location.href).href;
            } catch {
                return null;
            }
        });
    } catch {
        return null;
    }
}

// המתנה גנרית לתוכן: עד שהעמוד מפסיק להשתנות, ולא עד שיש בו "מספיק" טקסט.
//
// לא networkidle (סקריפטי אנליטיקה דוחים אותו עד לפסק הזמן) ולא סלקטור קבוע
// (זה בדיוק ה-hardcode שהגרסה הזו מוחקת).
//
// ⚠️ התנאי הקודם היה "לפחות 200 תווים ב-body", והוא חתך עמודים בשקט. נמדד על
// jsonforms.io/docs/uischema/controls/: סרגל הניווט והכותרת לבדם חוצים 200 תווים
// בטעינה הראשונה, כך שההמתנה חזרה מיד — לפני שהדמואים של React הידרטו. ארבעה
// סקשנים חיים לא נתפסו כלל, ביניהם "The readonly option", וה-html שנשמר נגמר
// בתוך אקורדיון MUI ריק. הכשל לא הותיר שום סימן: העמוד נראה תקין, עם כותרות
// ותוכן, רק קצר יותר מהאמת.
//
// הסף נשאר כשער כניסה בלבד (עמוד ריק לגמרי לא ייחשב "יציב"), וההכרעה עברה
// ליציבות: אורך הטקסט חייב להישאר ללא שינוי לאורך SETTLE_STABLE_MS רצופים.
export async function settlePage(page) {
    await page
        .waitForFunction(
            ({ minChars, stableMs, observeMs }) => {
                const body = document.body;
                if (!body) return false;
                const length = body.innerText.trim().length;
                if (length < minChars) return false;

                // נשמר על window ולא בסגירה, כי waitForFunction מריץ את הפונקציה
                // מחדש בכל poll ואין מצב שמחזיק בין קריאות.
                const state = (window.__kalfaSettle ??= { length: -1, since: 0, first: Date.now() });
                const now = Date.now();
                if (length !== state.length) {
                    state.length = length;
                    state.since = now;
                    return false;
                }
                // שקט מספיק זמן, וגם נצפה מספיק זמן. השני הוא שמונע סגירה
                // מוקדמת על עמוד ששקט מהרגע הראשון ורק אחר כך טוען.
                return now - state.since >= stableMs && now - state.first >= observeMs;
            },
            {
                minChars: SETTLE_MIN_CHARS,
                stableMs: SETTLE_STABLE_MS,
                observeMs: SETTLE_MIN_OBSERVE_MS,
            },
            { timeout: SETTLE_TIMEOUT_MS, polling: 250 },
        )
        .catch(() => null);
}

/**
 * האם העמוד גדל אחרי שכבר חילצנו ממנו.
 *
 * ⚠️ זו התשובה האמיתית לחיתוך, ולא `SETTLE_MIN_OBSERVE_MS`. שום המתנה אינה
 * יודעת מתי עמוד סיים, ולכן הדבר היחיד שאפשר להבטיח הוא שפספוס לא יהיה שקט:
 * אחרי החילוץ בודקים שוב את אורך ה-root, ואם הוא גדל - החילוץ היה מוקדם.
 *
 * מחזיר את ההפרש בתווים (0 = לא גדל). הקורא מחליט אם לחלץ שוב, לרשום ב-audit,
 * או שניהם - כאן רק נמדד.
 *
 * ⚠️ `windowMs` הוא גבול הבדיקה, והיא בדיקה חסומה ולא הוכחה. תוכן שיגיע אחרי
 * החלון הזה עדיין לא ייתפס - נמדד: חלון של 700ms על עמוד שמוסיף ב-1,400ms
 * החזיר 0. הפרמטר מפורש כדי שהגבול יהיה בחירה של הקורא ולא מספר חבוי כאן.
 */
export async function measureLateGrowth(
    page,
    contentRoot,
    capturedLength,
    windowMs = SETTLE_STABLE_MS,
) {
    const descriptor =
        typeof contentRoot === 'string'
            ? { selector: contentRoot, matchIndex: 0 }
            : { selector: contentRoot.selector, matchIndex: contentRoot.matchIndex ?? 0 };

    try {
        await page.waitForTimeout(windowMs);
        const now = await page.evaluate(({ selector, matchIndex }) => {
            const root = document.querySelectorAll(selector)[matchIndex];
            return root ? root.innerText.trim().length : 0;
        }, descriptor);
        return Math.max(0, now - capturedLength);
    } catch {
        // הדף נסגר או ניווט. אין מה למדוד, ואין על מה לדווח.
        return 0;
    }
}
