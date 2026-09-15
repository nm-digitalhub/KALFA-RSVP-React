// שלב ה-Validator: האם העמוד אמיתי, והאם האתר בכלל ראוי לסריקה.
//
// מכוון שהמודול הזה אינו מייבא דבר מהאחרים, הוא גם המקום שבו יושבים הספים
// המשותפים. במיוחד MIN_BOUNDARY_CONFIDENCE: הוא גם הסף שמעליו מסיקים תחילית
// נתיב וגם הסף שמתחתיו השער פוסל אותה. אם שני המספרים היו נכתבים פעמיים הם
// היו יכולים להתפצל, וגבול שהוסק היה נופל בשער של עצמו.

export const MIN_CONTENT_CHARS = 200;
export const MIN_CHARS_PER_LINK = 30;   // מתחת לזה זה סרגל ניווט, לא תוכן
export const MIN_VALID_SAMPLES = 2;
export const MIN_BOUNDARY_CONFIDENCE = 0.65;

// --- סיווג תשובת HTTP ---------------------------------------------------------
// מוגדר כאן פעם אחת, ונקרא גם ב-analyzer וגם ב-crawler. הפיצול לשני עותקים הוא
// מה שיצר את האסימטריה: ה-crawler פסל 500, וה-analyzer באותו רגע היה מוכן
// להכריז על אותו עמוד sample תקין - כי validateExtractedPage בודק אורך, כותרות
// וצפיפות קישורים, ועמוד שגיאה יכול לעמוד בשלושתם.
//
// מדיניות ה-retry מפורשת, ולא "5xx כן ו-4xx לא". הכלל הגס טוען ששרת שהודיע
// 501 Not Implemented ישנה את דעתו בניסיון זהה, ושאחרי 408 Request Timeout אין
// טעם לנסות שוב. שתי הטענות שגויות.
const RETRYABLE_HTTP_STATUSES = [
    408, // Request Timeout
    425, // Too Early
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
];

export function isRetryableHttpStatus(status) {
    return RETRYABLE_HTTP_STATUSES.includes(status);
}

// status 0 פירושו "אין תשובה למדוד" - Playwright מחזיר null מ-goto בניווט
// שאינו יוצר תשובה חדשה. זה לא כשל, ולכן אינו מסווג ככזה.
export function classifyHttpStatus(status) {
    if (!status || status < 400) {
        return { failed: false, retryable: false, reason: null };
    }
    return {
        failed: true,
        retryable: isRetryableHttpStatus(status),
        reason: `http_${status}`,
    };
}

// sample תקין רק אם כל התנאים מתקיימים. צפיפות הקישורים היא הבדיקה שתופסת את
// הכשל השקט הקלאסי: root שנבחר על סרגל ניווט מחזיר טקסט ארוך, אבל כמעט כולו
// קישורים.
//
// הבדיקה נעשית על ה-DOM ועל הטקסט, לפני ההמרה ל-Markdown ולא אחריה. Turndown
// מפיק Markdown תקין לחלוטין גם מסרגל צד וגם מעמוד שגיאה, ולכן "יצא Markdown"
// אינו עדות לשום דבר.
export function validateExtractedPage(result) {
    const reasons = [];
    if (result.content.length < MIN_CONTENT_CHARS) {
        reasons.push('content_too_short');
    }
    if (result.headings.length === 0) {
        reasons.push('no_headings');
    }
    if (
        result.hyperlinks.length > 0 &&
        result.content.length / result.hyperlinks.length < MIN_CHARS_PER_LINK
    ) {
        reasons.push('link_density_too_high');
    }
    return {
        valid: reasons.length === 0,
        reasons,
    };
}

// שער הכניסה לסריקה.
export function validateSiteProfile(profile) {
    const reasons = [];
    if (!profile.contentRoot.selector) {
        reasons.push('no_content_root');
    }
    if (profile.discovery.internalLinks === 0) {
        reasons.push('no_internal_links');
    }
    // הדרישה היא שניים, אבל לא יותר ממה שיש. `--only` עם כתובת אחת מייצר
    // sample אחד בדיוק, ודרישה קשיחה של שניים הייתה הופכת את המצב הזה לבלתי
    // שמיש: המשתמש מבקש עמוד אחד מפורשות, והכלי מסרב כי לא מצא עמוד שני לאמת
    // מולו. אותו דבר לאתר אמיתי שיש בו עמוד יחיד.
    const requiredSamples = Math.min(MIN_VALID_SAMPLES, profile.validation.sampleUrls.length);
    if (profile.validation.validSamples < requiredSamples) {
        reasons.push('insufficient_valid_samples');
    }
    if (!profile.validation.startPageValid) {
        reasons.push('start_page_invalid');
    }
    if (
        profile.crawlBoundary.strategy === 'path-prefix' &&
        profile.crawlBoundary.confidence < MIN_BOUNDARY_CONFIDENCE
    ) {
        reasons.push('crawl_boundary_low_confidence');
    }
    return {
        passed: reasons.length === 0,
        reasons,
    };
}
