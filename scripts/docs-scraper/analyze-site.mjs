// שלב ה-Analyzer: מודד את האתר, קובע גבול סריקה, ומאמת שהחילוץ עובד - הכול
// לפני שנסרק עמוד אחד.
//
// רץ על דפדפן משלו ולא דרך Crawlee, כדי שלא יחלוק תור בקשות עם הסריקה עצמה:
// תור משותף היה מסמן את עמוד ההתחלה ואת ה-samples כ"כבר טופלו", והסריקה הייתה
// מדלגת עליהם.

import {
    RobotsTxtFile,
    constructGlobObjectsFromGlobs,
    filterRequestsByPatterns,
    parseSitemap,
} from 'crawlee';
import { chromium } from 'playwright';

import {
    collectNavigationLinks,
    detectContentRoot,
    detectGenerator,
    extractPage,
    readMetaRefreshTarget,
    settlePage,
} from './extract-page.mjs';
import {
    MIN_BOUNDARY_CONFIDENCE,
    classifyHttpStatus,
    validateExtractedPage,
    validateSiteProfile,
} from './validate-page.mjs';

const NAV_TIMEOUT_MS = 30_000;
const MIN_LINKS_FOR_PREFIX = 5;      // לפחות 5 כתובות תחת תיקיית ההתחלה
const SITEMAP_URL_CAP = 2000;        // תקרת איסוף, לא תקרת סריקה
const SITEMAP_TIMEOUT_MS = 15_000;
const MAX_REDIRECT_HOPS = 3;

// --- פרופיל האתר --------------------------------------------------------------
// כל החלטה שהזחלן מקבל נרשמת כאן עם המקור והביטחון שלה, ונשמרת לצד הפלט. זה מה
// שמאפשר לקרוא אחרי ריצה גרועה למה היא הייתה גרועה, בלי להריץ שוב.
export function createEmptyProfile(startUrl) {
    const url = new URL(startUrl);
    return {
        requestedUrl: startUrl,
        resolvedUrl: null,
        origin: url.origin,
        hostname: url.hostname,
        redirect: {
            http: false,
            metaRefresh: false,
            target: null,
        },
        generator: {
            name: 'unknown',
            confidence: 0,
        },
        contentRoot: {
            selector: null,
            // איזו התאמה של הסלקטור נבחרה. בלי זה ה-analysis בוחר את
            // article[1] וה-extractor קורא את article[0].
            matchIndex: 0,
            score: 0,
            confidence: 0,
        },
        crawlBoundary: {
            strategy: null,
            pathPrefix: null,
            // ה-glob נשמר על הפרופיל ולא רק על ה-CLI, כי shouldAcceptUrl חייב
            // לדעת עליו. בלי זה ה-analysis מאמת את /docs/ בזמן שהסריקה תוגבל
            // ל-/api/** - כלומר מאמת עמודים שלא ייסרקו ולא מאמת את אלה שכן.
            glob: null,
            confidence: 0,
            source: null,
        },
        discovery: {
            internalLinks: 0,
            candidateDocLinks: 0,
            externalLinks: 0,
            sitemapUrls: [],
            // דיאגנוסטיקה בלבד: התחילית המשותפת של הקישורים הפנימיים. היא לא
            // משתתפת בהחלטה (ההחלטה היא לפי תיקיית ההתחלה), אבל כשה-fallback
            // הוא same-origin היא מראה מיד אם היה כאן תת-עץ שהוחמץ.
            commonPathPrefix: null,
        },
        validation: {
            sampleUrls: [],
            validSamples: 0,
            invalidSamples: 0,
            passed: false,
            reasons: [],
            // השער דורש שעמוד ההתחלה עצמו יהיה תקין - תנאי שאינו נגזר מספירת
            // ה-samples, ולכן נשמר בנפרד.
            startPageValid: false,
            sampleResults: [],
        },
    };
}

// --- URL ---------------------------------------------------------------------
// נרמול אחד לכל הצינור. fragment נמחק תמיד (אותו עמוד), ופרמטרי tracking
// נמחקים לפי רשימה סגורה. query אמיתי (version=2, lang=he) נשאר, כי הוא משנה
// עמוד.
// נמחקים רק פרמטרים שהסמנטיקה שלהם היא tracking באופן חד-משמעי, כלומר משפחת
// utm_*. `ref` ו-`source` הוסרו מהרשימה בכוונה: באתרי תיעוד הם לרוב פרמטרים
// עסקיים אמיתיים - /api?ref=v1 מול /api?ref=v2, או
// /docs/reference?source=node מול ?source=browser - ומחיקתם מיזגה שני עמודים
// שונים לכתובת אחת, כלומר איבדה אחד מהם בלי להשאיר עקבות.
export function normalizeUrl(rawUrl) {
    const url = new URL(rawUrl);
    url.hash = '';
    const removableParams = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
    ];
    for (const key of removableParams) {
        url.searchParams.delete(key);
    }
    return url.href;
}

export function isNonHtmlAsset(rawUrl) {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    return /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|mp4|webm|mp3|wav|woff2?|ttf|eot|css|js|mjs|map)$/i.test(pathname);
}

export function getDirectoryPrefix(pathname) {
    if (pathname.endsWith('/')) return pathname;
    const index = pathname.lastIndexOf('/');
    return pathname.slice(0, index + 1);
}

export function commonPathPrefix(paths) {
    if (!paths.length) return '/';
    const split = paths.map((p) => p.split('/').filter(Boolean));
    const result = [];
    for (let i = 0; ; i++) {
        const value = split[0]?.[i];
        if (value === undefined || !split.every((parts) => parts[i] === value)) {
            break;
        }
        result.push(value);
    }
    return '/' + (result.length ? result.join('/') + '/' : '');
}

// לפני שמחשבים תחילית משותפת חייבים לסנן, אחרת קישור בודד ל-/careers גורר את
// התחילית ל-"/" וכל ההסקה מתה.
//
// המדד הוא origin ולא hostname, כדי שהגילוי ימדוד בדיוק את מה שהסריקה תרשה:
// shouldAcceptUrl דורש origin זהה, ואילו hostname זהה מקבץ יחד את
// https://docs.x.com, http://docs.x.com ו-https://docs.x.com:8443. קישורים
// שלעולם לא ייסרקו היו נכנסים ל-candidateDocLinks, לתחילית המשותפת, להסקת
// הגבול, לבחירת ה-samples ולהערכת maxRequests - חמישה מקומות שבהם המספר היה
// נכון לשאלה אחרת מזו שנשאלה.
export function internalPageCandidates(urls, profile) {
    return [...new Set(
        urls
            .filter((raw) => {
                try {
                    const url = new URL(raw);
                    return url.protocol === 'http:' || url.protocol === 'https:';
                } catch {
                    return false;
                }
            })
            .map(normalizeUrl)
            .filter((raw) => {
                const url = new URL(raw);
                return url.origin === profile.origin && !isNonHtmlAsset(raw);
            }),
    )];
}

// ההחלטה היחידה על גבול הסריקה, דטרמיניסטית לחלוטין.
// "רוב הקישורים יושבים תחת תיקיית ההתחלה" הוא ההבדל בין אתר תיעוד לבין אתר
// שיווקי עם קישור בודד ל-/docs. כשהתנאי לא מתקיים לא מנחשים תת-עץ, אלא נופלים
// ל-same-origin, שהוא רחב אבל נכון.
export function inferCrawlBoundary(startUrl, candidates) {
    const start = new URL(startUrl);
    const startDir = getDirectoryPrefix(start.pathname);
    const underStartDir = candidates.filter((raw) => new URL(raw).pathname.startsWith(startDir));
    const ratio = underStartDir.length / Math.max(1, candidates.length);

    if (
        startDir !== '/' &&
        underStartDir.length >= MIN_LINKS_FOR_PREFIX &&
        ratio >= MIN_BOUNDARY_CONFIDENCE
    ) {
        return {
            strategy: 'path-prefix',
            pathPrefix: startDir,
            glob: null,
            confidence: ratio,
            source: 'start-directory-majority',
        };
    }

    return {
        strategy: 'same-origin',
        pathPrefix: null,
        glob: null,
        confidence: 1,
        source: 'same-origin-fallback',
    };
}

// ה-glob נבדק דרך Crawlee עצמה ולא במתאים משלנו, ובמכוון. minimatch שיושב
// בשורש הוא 3.1.5, בעוד ש-@crawlee/core מביא 9.0.9 משלו - ייבוא ישיר של
// 'minimatch' היה נותן מתאים אחר מזה שמסנן בפועל בזמן ההזחילה, כלומר בדיוק
// אי-ההסכמה בין האימות לסריקה שהתיקון הזה בא למחוק. constructGlobObjectsFromGlobs
// ו-filterRequestsByPatterns הם אותו קוד שה-enqueueLinks מריץ.
function matchesGlob(url, glob) {
    if (!glob) return true;
    return filterRequestsByPatterns([{ url }], constructGlobObjectsFromGlobs([glob])).length > 0;
}

// שער אחד לכל שאלה "האם לסרוק את הכתובת הזו" - גם בתור, גם בבחירת ה-samples
// וגם בבדיקות. שלושתם חייבים לשאול את אותו שער, אחרת ה-analysis מאמת עמודים
// שלא ייסרקו.
export function shouldAcceptUrl(rawUrl, profile) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        return false;
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        return false;
    }
    if (url.origin !== profile.origin) {
        return false;
    }
    if (isNonHtmlAsset(url.href)) {
        return false;
    }
    if (
        profile.crawlBoundary.strategy === 'path-prefix' &&
        !url.pathname.startsWith(profile.crawlBoundary.pathPrefix)
    ) {
        return false;
    }
    if (
        profile.crawlBoundary.strategy === 'glob' &&
        !matchesGlob(url.href, profile.crawlBoundary.glob)
    ) {
        return false;
    }
    return true;
}

// עמוד ההתחלה, אחד מהשליש הראשון, ואחד מהשליש האחרון. שלושה עמודים מקצוות
// שונים של עץ הניווט חושפים מבנה שונה; שלושה עמודים סמוכים לא.
export function pickSampleUrls(startUrl, candidates) {
    const unique = [normalizeUrl(startUrl), ...candidates.map(normalizeUrl)];
    const deduped = [...new Set(unique)];
    if (deduped.length <= 3) {
        return deduped;
    }
    return [
        deduped[0],
        deduped[Math.floor(deduped.length / 3)],
        deduped[Math.floor((deduped.length * 2) / 3)],
    ];
}

// --- הניתוח עצמו --------------------------------------------------------------
export async function analyzeSite({ startUrl, globOverride = null, onlyMode = false, explicitUrls = [] }) {
    const profile = createEmptyProfile(startUrl);
    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        let robots = null;
        try {
            robots = await RobotsTxtFile.find(startUrl, undefined, { timeoutMillis: 10_000 });
        } catch {
            // robots.txt אופציונלי. היעדרו אינו איסור.
        }
        if (robots && !robots.isAllowed(startUrl)) {
            profile.validation.reasons.push('robots_disallows_start_url');
            return profile;
        }

        // הפניות. meta refresh לא רק נרשם אלא גם נעקב: עמוד-קש הוא לא אתר בלי
        // תוכן, הוא אתר שהתוכן שלו נמצא צעד אחד משם. v1 דילג עליו והמשיך
        // לזחול, וכאן אין "להמשיך" - בלי לעקוב, ה-analysis ייכשל.
        let currentUrl = normalizeUrl(startUrl);
        for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
            const response = await page.goto(currentUrl, {
                waitUntil: 'domcontentloaded',
                timeout: NAV_TIMEOUT_MS,
            });
            // ההבחנה בין הפניית שרת להפניית לקוח נלקחת משרשרת הבקשות ולא
            // מהשוואת כתובות. השוואת כתובות לבדה מסמנת גם meta refresh שהדפדפן
            // ביצע בעצמו כ-"HTTP redirect", וזה תיוג שגוי של בדיוק התקלה שהשדה
            // הזה קיים כדי לתעד.
            const httpRedirected = Boolean(response?.request()?.redirectedFrom());

            // אותה בדיקה שה-crawler עושה, ובאותו helper. בלעדיה עמוד 500 שמגיש
            // גוף HTML שנראה כמו תיעוד - כותרת, פסקאות, קישורים - היה עובר את
            // validateExtractedPage ומכריז "Analysis passed", בזמן שהסריקה
            // שאחריו הייתה פוסלת את אותה כתובת בדיוק. אסימטריה כזו היא הכשל
            // השקט שהמבנה הזה קיים כדי למנוע.
            const startStatus = classifyHttpStatus(response?.status() ?? 0);
            if (startStatus.failed) {
                profile.validation.reasons.push(`start_url_${startStatus.reason}`);
                return profile;
            }

            await settlePage(page);

            const resolvedUrl = normalizeUrl(page.url());
            if (hop === 0) {
                profile.redirect.http = httpRedirected;
            }

            // הדפדפן כבר עקב אחרי ההפניה (content="0;url=..." או ניווט מ-JS):
            // הכתובת השתנתה בלי שהייתה הפניית שרת.
            if (resolvedUrl !== currentUrl && !httpRedirected) {
                profile.redirect.metaRefresh = true;
                profile.redirect.target = resolvedUrl;
            }

            // עמוד-קש עם השהיה שהדפדפן עוד לא ביצע - עוקבים ידנית.
            const metaRefresh = await readMetaRefreshTarget(page);
            if (metaRefresh && normalizeUrl(metaRefresh) !== resolvedUrl && hop < MAX_REDIRECT_HOPS) {
                profile.redirect.metaRefresh = true;
                profile.redirect.target = normalizeUrl(metaRefresh);
                currentUrl = profile.redirect.target;
                continue;
            }

            profile.resolvedUrl = resolvedUrl;
            break;
        }

        if (!profile.resolvedUrl) {
            profile.validation.reasons.push('redirect_loop');
            return profile;
        }

        profile.origin = new URL(profile.resolvedUrl).origin;
        profile.hostname = new URL(profile.resolvedUrl).hostname;

        // ה-robots נטען לפי כתובת ההתחלה, כלומר לפני שידענו איפה ננחת. הפניה
        // חוצת-origin (example.com/docs אל docs.example.com/overview) מותירה
        // אותנו עם מדיניות של אתר אחר - וממנה נגזרות גם בדיקות ה-samples וגם
        // רשימת ה-sitemaps. נטען מחדש בדיוק כשה-origin השתנה, ולא בכל ריצה.
        if (new URL(startUrl).origin !== profile.origin) {
            try {
                robots = await RobotsTxtFile.find(profile.resolvedUrl, undefined, { timeoutMillis: 10_000 });
            } catch {
                robots = null;
            }
            if (robots && !robots.isAllowed(profile.resolvedUrl)) {
                profile.validation.reasons.push('robots_disallows_resolved_url');
                return profile;
            }
        }

        profile.generator = await detectGenerator(page);

        const root = await detectContentRoot(page);
        if (root) {
            profile.contentRoot = root;
        }

        // גילוי.
        const navigationLinks = await collectNavigationLinks(page);
        const sameOrigin = navigationLinks.filter((raw) => {
            try {
                return new URL(raw).origin === profile.origin;
            } catch {
                return false;
            }
        });
        const candidates = internalPageCandidates(navigationLinks, profile);
        profile.discovery.internalLinks = sameOrigin.length;
        profile.discovery.candidateDocLinks = candidates.length;
        profile.discovery.externalLinks = navigationLinks.length - sameOrigin.length;
        profile.discovery.commonPathPrefix = commonPathPrefix(candidates.map((raw) => new URL(raw).pathname));

        // גבול הסריקה.
        if (globOverride) {
            profile.crawlBoundary = {
                strategy: 'glob',
                pathPrefix: null,
                glob: globOverride,
                confidence: 1,
                source: 'user-override',
            };
        } else if (onlyMode) {
            profile.crawlBoundary = {
                strategy: 'only',
                pathPrefix: null,
                glob: null,
                confidence: 1,
                source: 'explicit-url-list',
            };
        } else {
            profile.crawlBoundary = inferCrawlBoundary(profile.resolvedUrl, candidates);

            // כשההפניה הזיזה אותנו עמוק יותר (/docs/ אל /docs/overview/), תיקיית
            // ההתחלה שנמדדה היא של העמוד שנחתנו בו, לא של מה שהתבקש. בודקים גם
            // את התיקייה המבוקשת - אותם ספים בדיוק, רק בסיס אחר - כדי לא לאבד
            // תת-עץ אמיתי בגלל עמוד-קש. אם גם היא לא עוברת, נשארים ב-fallback.
            if (profile.crawlBoundary.strategy === 'same-origin' && profile.requestedUrl !== profile.resolvedUrl) {
                const fromRequested = inferCrawlBoundary(profile.requestedUrl, candidates);
                if (fromRequested.strategy === 'path-prefix') {
                    profile.crawlBoundary = { ...fromRequested, source: 'requested-directory-majority' };
                }
            }
        }

        profile.discovery.sitemapUrls = await collectSitemapUrls(profile, robots);

        // אימות חילוץ על שלושה עמודים.
        const sampleSource = onlyMode ? explicitUrls : candidates.filter((raw) => shouldAcceptUrl(raw, profile));
        const sampleUrls = pickSampleUrls(profile.resolvedUrl, sampleSource);
        profile.validation.sampleUrls = sampleUrls;

        for (const [index, sampleUrl] of sampleUrls.entries()) {
            if (robots && !robots.isAllowed(sampleUrl)) {
                profile.validation.invalidSamples++;
                profile.validation.sampleResults.push({
                    url: sampleUrl,
                    valid: false,
                    reasons: ['robots_disallowed'],
                });
                continue;
            }

            let extracted = null;
            try {
                if (index > 0 || normalizeUrl(page.url()) !== sampleUrl) {
                    const sampleResponse = await page.goto(sampleUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: NAV_TIMEOUT_MS,
                    });
                    // ה-response של ה-sample נשמר ונבדק, ולא רק נזרק. עמוד 404
                    // שמגיש תבנית שגיאה עשירה - כותרת, פסקה, קישורי ניווט -
                    // עומד בכל התנאים של validateExtractedPage, ובלי הבדיקה
                    // הזאת הוא היה נספר כ-sample תקין ומכשיר סריקה שלמה.
                    const sampleStatus = classifyHttpStatus(sampleResponse?.status() ?? 0);
                    if (sampleStatus.failed) {
                        profile.validation.invalidSamples++;
                        profile.validation.sampleResults.push({
                            url: sampleUrl,
                            valid: false,
                            reasons: [sampleStatus.reason],
                        });
                        continue;
                    }
                    await settlePage(page);
                }
                extracted = profile.contentRoot.selector
                    ? await extractPage(page, profile.contentRoot)
                    : null;
            } catch (error) {
                profile.validation.invalidSamples++;
                profile.validation.sampleResults.push({
                    url: sampleUrl,
                    valid: false,
                    reasons: [`navigation_failed:${error?.message ?? 'unknown'}`],
                });
                continue;
            }

            if (!extracted) {
                profile.validation.invalidSamples++;
                profile.validation.sampleResults.push({
                    url: sampleUrl,
                    valid: false,
                    reasons: ['no_content_root'],
                });
                continue;
            }

            const verdict = validateExtractedPage(extracted);
            const reasons = extracted.rootFound
                ? verdict.reasons
                : ['root_selector_not_found', ...verdict.reasons];
            const valid = verdict.valid && extracted.rootFound;

            if (valid) profile.validation.validSamples++;
            else profile.validation.invalidSamples++;
            if (index === 0) profile.validation.startPageValid = valid;

            profile.validation.sampleResults.push({
                url: sampleUrl,
                valid,
                reasons,
                contentChars: extracted.content.length,
                headings: extracted.headings.length,
                hyperlinks: extracted.hyperlinks.length,
            });
        }

        const verdict = validateSiteProfile(profile);
        profile.validation.passed = verdict.passed;
        profile.validation.reasons = verdict.reasons;

        return profile;
    } finally {
        await browser.close();
    }
}

// sitemap הוא עדות, לא מקור סמכות: הוא משמש להערכת גודל הסריקה ותו לא. האיסוף
// חסום בתקרה ובפסק זמן, כי אתר גדול יכול להגיש מאות אלפי כתובות.
async function collectSitemapUrls(profile, robots) {
    const sources = [];
    if (robots) {
        try {
            sources.push(...robots.getSitemaps());
        } catch {
            // getSitemaps נכשל כשה-robots פגום. לא סיבה להפיל ניתוח.
        }
    }
    if (sources.length === 0) {
        sources.push(new URL('/sitemap.xml', profile.origin).href);
    }

    const collected = [];
    try {
        const iterator = parseSitemap(
            sources.map((url) => ({ type: 'url', url })),
            undefined,
            {
                maxDepth: 2,
                sitemapRetries: 1,
                reportNetworkErrors: false,
                networkTimeouts: { request: SITEMAP_TIMEOUT_MS },
            },
        );
        for await (const item of iterator) {
            if (item.loc && shouldAcceptUrl(item.loc, profile)) {
                collected.push(normalizeUrl(item.loc));
            }
            if (collected.length >= SITEMAP_URL_CAP) break;
        }
    } catch {
        // אין sitemap, או שהוא לא נטען. ההערכה תיפול על ספירת הקישורים.
    }

    return [...new Set(collected)];
}
