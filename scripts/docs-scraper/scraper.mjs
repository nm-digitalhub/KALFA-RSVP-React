#!/usr/bin/env node
// זחלן תיעוד כללי - מודד, מחליט, מאמת, ורק אז סורק.
//
// ההבדל מ-scripts/scraper-v1.mjs אינו בכמות הפיצ'רים אלא בסדר הפעולות. v1 קיבע
// גבול סריקה (origin/**) וסלקטור חילוץ (article || main || .col-content) לפני
// שראה עמוד אחד, ולכן כל אתר חדש הוסיף לו exception. כאן אין hardcode לאתר או
// למחולל: שלב analysis מודד את ה-DOM ואת הקישורים, מחליט לפי ספים קבועים,
// שומר את ההסבר להחלטה בפרופיל, מאמת את החילוץ על שלושה עמודים - ואם הביטחון
// נמוך, מסרב לסרוק במקום להחזיר JSON ריק שנראה כמו הצלחה.
//
// הקובץ הזה הוא ה-orchestrator בלבד. כל שלב יושב במודול משלו:
//
//   Crawlee        -> discovery / crawling          (כאן)
//   Playwright     -> rendering                     (כאן + analyze-site)
//   Analyzer       -> scope + content-root          analyze-site.mjs
//   Extractor      -> HTML/text/headings/code/links extract-page.mjs
//   Turndown       -> HTML אל Markdown בלבד         html-to-markdown.mjs
//   Validator      -> העמוד אמיתי ושלם              validate-page.mjs
//   Exporter       -> JSON + audit                  export-page.mjs
//
// שימוש:
//   node scripts/docs-scraper/scraper.mjs <start-url> <out.json>
//   node scripts/docs-scraper/scraper.mjs <start-url> <out.json> --analyze-only
//   node scripts/docs-scraper/scraper.mjs <start-url> <out.json> --glob 'https://host/path/**'
//   node scripts/docs-scraper/scraper.mjs --only <out.json> <url> <url> ...
//
// קודי יציאה: 0 תקין, 1 הסתיים עם עמודים ריקים או כושלים, 2 ה-analysis נכשל.

import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Dataset, PlaywrightCrawler } from '@crawlee/playwright';

import { analyzeSite, normalizeUrl, shouldAcceptUrl } from './analyze-site.mjs';
import {
    extractPage,
    measureLateGrowth,
    readMetaRefreshTarget,
    settlePage,
} from './extract-page.mjs';
import { htmlToMarkdown } from './html-to-markdown.mjs';
import {
    buildPageRecord,
    printAnalysisReport,
    printCrawlAudit,
    writeAudit,
    writeDocs,
} from './export-page.mjs';
// מדיניות ה-HTTP מוגדרת פעם אחת ב-validator, ונקראת גם כאן וגם ב-analyzer.
// שני עותקים הם מה שאיפשר ל-analyzer להכשיר עמוד 500 שה-crawler פוסל.
import { classifyHttpStatus } from './validate-page.mjs';

const HARD_REQUEST_CAP = 5000;

// --- CLI ---------------------------------------------------------------------
// --glob ו---analyze-only נשלפים ראשונים כדי שיוכלו להופיע בכל מקום. ב-v1
// פרסור לפי אינדקס גרם ל-"<url> --glob <pattern>" להשתמש במחרוזת "--glob" כשם
// קובץ הפלט, בשקט.
export function parseArgv(rawArgv) {
    let argv = [...rawArgv];

    const analyzeOnly = argv.includes('--analyze-only');
    argv = argv.filter((arg) => arg !== '--analyze-only');

    const globAt = argv.indexOf('--glob');
    const globOverride = globAt === -1 ? null : argv[globAt + 1] ?? null;

    // `--glob` בסוף השורה הוא בקשה שלא ניתן לקיים, ולא בקשה ריקה. ההתנהגות
    // הקודמת - להשמיט אותו ולרוץ בלי גבול - הייתה סורקת אתר שלם למי שביקש
    // במפורש תת-עץ אחד, בלי לומר מילה.
    if (globAt !== -1 && !globOverride) {
        return { cliError: '--glob requires a pattern, for example --glob \'https://host/docs/**\'' };
    }
    if (globAt !== -1) {
        argv = argv.filter((_value, index) => index !== globAt && index !== globAt + 1);
    }

    const onlyMode = argv[0] === '--only';
    const outputFile = argv[1] || 'docs.json';
    const targetUrls = onlyMode ? argv.slice(2) : argv[0] ? [argv[0]] : [];

    return { cliError: null, analyzeOnly, globOverride, onlyMode, outputFile, targetUrls };
}

export function createAuditState() {
    return {
        visited: 0,
        stored: 0,
        empty: [],
        failed: [],
        redirectStubs: [],
        noHeadings: [],
        duplicates: [],
        // root שנבחר לאתר ולא נמצא בעמוד מסוים. זה כשל אחר מ"עמוד ריק", והוא
        // הסימן היחיד לכך שהסלקטור עצמו לא מתאים לחלק מהעץ.
        rootMissing: [],
        // משאב תקין שאינו עמוד HTML (JSON, PDF, octet-stream). לא כשל, ולכן
        // אינו משפיע על קוד היציאה - אבל גם לא עמוד ריק.
        skippedNonHtml: [],
        // כשל שהפיל את הזחלן כולו, להבדיל מכשל של כתובת בודדת.
        crawlerError: null,
        // עמודים שגדלו אחרי שכבר חולצו, כלומר ההמתנה נסגרה מוקדם. התוכן תוקן
        // בחילוץ חוזר; הרשומה כאן היא הראיה שזה קרה, ומדד לכך שהספים קצרים
        // מדי לאתר הזה.
        lateContent: [],
    };
}

// כל ריצה מקבלת ספריית storage משלה, הנגזרת מקובץ הפלט.
//
// נמדד: שתי ריצות במקביל משורש הריפו הרגו זו את זו. Crawlee מגדירה
// purgeOnStart=true כברירת מחדל, ו-MemoryStorage.purge() מוחקת את
// request_queues/default ואת datasets/default (memory-storage.js:167-183).
// הריצה השנייה מחקה את התור של הראשונה תוך כדי עבודתה, וזו מתה ב-
// "ENOENT: ... storage/request_queues/default/<id>.json" - חריגה לא מטופלת,
// אחרי שכבר נשמרו עמודים.
//
// הבידוד יושב תחת storage/ הקיימת (שכבר ב-gitignore) ולא לצדה, ומפתחו הוא שם
// קובץ הפלט: שתי סריקות לאותו קובץ פלט הן התנגשות ממילא, ושתי סריקות לקבצים
// שונים כבר לא נוגעות זו בזו.
export function storageDirFor(outputFile) {
    const slug = basename(outputFile).replace(/\.json$/i, '').replace(/[^\w.-]+/g, '-') || 'default';
    return join('storage', slug);
}

export function estimateMaxRequests(profile) {
    const estimatedPages = Math.max(
        profile.discovery.candidateDocLinks,
        profile.discovery.sitemapUrls.length,
        50,
    );
    return Math.min(HARD_REQUEST_CAP, Math.ceil(estimatedPages * 1.5));
}

// --- הסריקה -------------------------------------------------------------------
async function runCrawl({ profile, startUrls, onlyMode, globOverride, maxRequests }) {
    const audit = createAuditState();
    const allDocsData = [];
    const contentHashes = new Map();

    const crawler = new PlaywrightCrawler({
        requestHandlerTimeoutSecs: 30,
        navigationTimeoutSecs: 30,
        maxConcurrency: 3,
        maxRequestsPerMinute: 60,
        sameDomainDelaySecs: 0.5,
        maxRequestRetries: 3,
        maxRequestsPerCrawl: maxRequests,
        respectRobotsTxtFile: true,

        async requestHandler({ page, request, response, enqueueLinks }) {
            // visited נספר לפני כל סינון, ולכן משמעותו אחת ויחידה: כל response
            // שהגיע ל-handler. ניסיון חוזר על אותה כתובת נספר שוב, כי הוא אכן
            // response נוסף. המספרים שמתחתיו צרים יותר: stored = נשמר כתיעוד,
            // failed = נכשל, empty = תקין אבל בלי תוכן.
            audit.visited++;

            // PlaywrightCrawler אינו זורק על סטטוס שגיאה, ולכן עמוד 500 הגיע
            // לכאן, נמצא בלי תוכן, ונרשם כ"עמוד ריק". זה מיזוג של שני כשלים
            // שונים לגמרי - "האתר החזיר שגיאה" מול "הסלקטור לא מצא תוכן" -
            // ובדיוק המיזוג הזה מסתיר תקלת שרת בדוח שנראה סביר. נמדד בבדיקה.
            //
            // שלושה סטטוסים לא יגיעו לכאן לעולם: 401, 403 ו-429 הם
            // BLOCKED_STATUS_CODES של Crawlee, ו-_throwOnBlockedRequest זורק
            // עליהם "Request blocked - received N status code." לפני ה-handler
            // (basic-crawler.js:951). הם מגיעים ל-audit.failed באותה מגירה, רק
            // עם הנוסח שלה. isRetryableHttpStatus עדיין מונה את 429 בכוונה:
            // המדיניות נכונה גם אם כרגע Crawlee מיישמת אותה במקומנו.
            const status = response?.status() ?? 0;
            const verdict = classifyHttpStatus(status);
            if (verdict.failed) {
                if (!verdict.retryable) {
                    request.noRetry = true;
                }
                throw new Error(`HTTP ${status}`);
            }

            // אותה משפחת באגים, בצד השני: כתובת בלי סיומת שמחזירה JSON או PDF
            // עוברת את isNonHtmlAsset (שקורא pathname בלבד), נטענת בדפדפן,
            // ומגיעה לחילוץ כאילו הייתה עמוד. היא לא כשל - היא פשוט לא עמוד
            // תיעוד, ולכן יש לה מגירה משלה ולא audit.failed.
            const contentType = response?.headers()['content-type']?.toLowerCase() ?? '';
            if (
                contentType &&
                !contentType.includes('text/html') &&
                !contentType.includes('application/xhtml+xml')
            ) {
                audit.skippedNonHtml.push({ url: normalizeUrl(request.url), contentType });
                return;
            }

            await settlePage(page);

            const url = normalizeUrl(request.url);
            const title = await page.title();

            // עמוד-קש של הפניה: אין בו תוכן, אבל יש בו יעד. נרשם כ-redirectStub
            // והיעד נכנס לתור, במקום להיספר כעמוד ריק.
            //
            // שני מקרים, ושניהם אמיתיים: הדפדפן כבר ניווט (content="0;url=...")
            // ואז page.url() כבר אינו request.url, או שההפניה מושהית והתג עדיין
            // בעמוד. שמירת הרשומה תחת request.url במקרה הראשון הייתה מצמידה את
            // התוכן של עמוד אחד לכתובת של אחר.
            const landedUrl = normalizeUrl(page.url());
            const metaRefresh = await readMetaRefreshTarget(page);
            const stubTarget =
                landedUrl !== url
                    ? landedUrl
                    : metaRefresh && normalizeUrl(metaRefresh) !== url
                        ? normalizeUrl(metaRefresh)
                        : null;

            if (stubTarget) {
                audit.redirectStubs.push({ url, target: stubTarget });
                if (!onlyMode && shouldAcceptUrl(stubTarget, profile)) {
                    await enqueueLinks({ urls: [stubTarget], strategy: 'same-origin' });
                }
                return;
            }

            let extracted = await extractPage(page, profile.contentRoot);

            // ⚠️ הבדיקה שהופכת חיתוך מכשל שקט לכשל מדווח.
            //
            // נמדד: עמוד שמוסיף פסקה אחרי 1.5 שניות נסגר ב-772ms עם מחצית
            // התוכן, וההמתנה לא ידעה. שום המתנה לא יכולה לדעת מתי עמוד סיים,
            // ולכן במקום להאריך אותה עוד — בודקים אחריה. אם ה-root גדל מאז
            // החילוץ, החילוץ היה מוקדם: מחלצים שוב ורושמים ב-audit, כדי שגם
            // התיקון וגם העובדה שהוא נדרש יהיו גלויים.
            const grew = await measureLateGrowth(page, profile.contentRoot, extracted.content.length);
            if (grew > 0) {
                audit.lateContent.push({ url, extraChars: grew });
                console.warn(`[warn] ${url} grew by ${grew} chars after extraction — re-extracted`);
                extracted = await extractPage(page, profile.contentRoot);
            }

            const category = extracted.headings.find((h) => h.level === 1)?.text ?? title ?? 'כללי';

            const rootLabel = `${profile.contentRoot.selector}[${profile.contentRoot.matchIndex}]`;
            if (!extracted.rootFound) {
                audit.rootMissing.push(url);
                console.warn(`[warn] the root '${rootLabel}' was not found in ${url}`);
            }
            if (!extracted.content) {
                audit.empty.push(url);
                console.warn(`[warn] no content in ${url}`);
            }
            if (extracted.headings.length === 0) {
                audit.noHeadings.push(url);
            }

            // זיהוי כפילויות על הטקסט ולא על ה-Markdown: הטקסט הוא מה שהמשתמש
            // קורא, וה-Markdown נגזר ממנו ויכול להשתנות עם גרסת Turndown.
            if (extracted.content) {
                const hash = createHash('sha256').update(extracted.content).digest('hex');
                const seenAt = contentHashes.get(hash);
                if (seenAt) {
                    audit.duplicates.push({ url, sameAs: seenAt });
                } else {
                    contentHashes.set(hash, url);
                }
            }

            const record = buildPageRecord({
                url,
                title,
                category,
                extracted,
                markdown: htmlToMarkdown(extracted.html),
            });

            allDocsData.push(record);
            // כתיבה לדיסק לכל רשומה בנפרד: ריצה שנקטעת באמצע משאירה את מה שכבר
            // נאסף ב-storage/datasets/default, ולא רק בזיכרון.
            await Dataset.pushData(record);
            audit.stored++;

            console.log(`[ok] ${title} -> ${url}`);

            if (onlyMode) {
                return;
            }

            // same-origin ושער אחד. אין glob אלא אם המשתמש נתן אחד מפורשות;
            // הסינון האמיתי קורה ב-shouldAcceptUrl, על כתובת מנורמלת.
            // transformRequestFunction רץ לפני חישוב ה-uniqueKey, ולכן הנרמול
            // כאן באמת מונע כפילויות ולא רק מייפה את הכתובת.
            await enqueueLinks({
                strategy: 'same-origin',
                ...(globOverride ? { globs: [globOverride] } : {}),
                transformRequestFunction(req) {
                    req.url = normalizeUrl(req.url);
                    if (!shouldAcceptUrl(req.url, profile)) {
                        return false;
                    }
                    return req;
                },
                exclude: ['**/_astro/**', '**/_next/**'],
            });
        },

        failedRequestHandler({ request, error }) {
            audit.failed.push({
                url: request.url,
                error: error?.message ?? 'unknown',
            });
            console.error(`[fail] ${request.url}: ${error?.message ?? 'unknown'}`);
        },
    });

    // ריצה שנופלת עדיין חייבת להחזיר את מה שנאסף. לפני כן, תקלת אחסון הפילה
    // את התהליך אחרי שכבר נשמרו עמודים, ואיתה נעלמו גם out.json וגם ה-audit -
    // כלומר הראיה היחידה למה שקרה. ה-crawlerError נרשם ב-audit ומשפיע על קוד
    // היציאה, ולא נבלע.
    try {
        await crawler.run(startUrls);
    } catch (error) {
        audit.crawlerError = error?.message ?? 'unknown';
        console.error(`[fail] crawler aborted: ${audit.crawlerError}`);
    }
    return { audit, allDocsData };
}

// --- main ---------------------------------------------------------------------
export async function main(rawArgv = process.argv.slice(2)) {
    const { cliError, analyzeOnly, globOverride, onlyMode, outputFile, targetUrls } = parseArgv(rawArgv);

    if (cliError) {
        console.error(`[error] ${cliError}`);
        process.exitCode = 2;
        return;
    }

    if (targetUrls.length === 0) {
        console.error('[error] missing start URL.');
        console.error('   node scripts/docs-scraper/scraper.mjs <start-url> <out.json> [--glob <pattern>] [--analyze-only]');
        console.error('   node scripts/docs-scraper/scraper.mjs --only <out.json> <url> <url> ...');
        process.exitCode = 2;
        return;
    }

    for (const url of targetUrls) {
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
        } catch {
            console.error(`[error] invalid URL: ${url}`);
            process.exitCode = 2;
            return;
        }
    }

    // לפני כל גישה לאחסון. Crawlee קוראת את המשתנה בבניית לקוח האחסון ולא
    // בזמן ה-import (configuration.js:209), ולכן קביעה כאן נתפסת. הצבה מותנית
    // בכוונה: מי שקבע CRAWLEE_STORAGE_DIR בעצמו יודע מה הוא עושה.
    process.env.CRAWLEE_STORAGE_DIR ??= storageDirFor(outputFile);

    const profile = await analyzeSite({
        startUrl: targetUrls[0],
        globOverride,
        onlyMode,
        explicitUrls: targetUrls,
    });

    printAnalysisReport(profile);

    // analysis שנכשל עוצר כאן. סריקה שמתחילה על פרופיל לא מאומת מייצרת JSON
    // גדול וריק, וזה הכשל היקר: הוא נראה כמו הצלחה.
    if (!profile.validation.passed) {
        console.error('[error] Site analysis failed.');
        console.error(JSON.stringify(profile.validation.reasons, null, 2));
        const auditPath = writeAudit(outputFile, profile, createAuditState());
        console.error(`   profile saved to ${auditPath}`);
        process.exitCode = 2;
        return;
    }

    if (analyzeOnly) {
        const auditPath = writeAudit(outputFile, profile, createAuditState());
        console.log(`[ok] analysis only. Profile saved to ${auditPath} (nothing crawled).`);
        return;
    }

    const startUrls = onlyMode ? targetUrls.map(normalizeUrl) : [profile.resolvedUrl];
    const maxRequests = onlyMode ? targetUrls.length : estimateMaxRequests(profile);

    const { audit, allDocsData } = await runCrawl({
        profile,
        startUrls,
        onlyMode,
        globOverride,
        maxRequests,
    });

    writeDocs(outputFile, allDocsData);
    const auditPath = writeAudit(outputFile, profile, audit);

    printCrawlAudit(profile, audit);
    console.log(`${outputFile}\n${auditPath}`);

    if (audit.crawlerError || audit.failed.length > 0 || audit.empty.length > 0) {
        process.exitCode = 1;
    }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
    await main();
}
