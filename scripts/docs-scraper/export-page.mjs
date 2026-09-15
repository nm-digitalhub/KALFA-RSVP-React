// שלב ה-Exporter: בניית הרשומה וכתיבת הפלט. שום החלטה על האתר לא נופלת כאן.

import { writeFileSync } from 'node:fs';

// ארבע שכבות לכל עמוד, ולא אחת:
//
//   html      - המקור אחרי ניקוי. מה שאפשר להמיר ממנו מחדש בלי לסרוק שוב.
//   content   - טקסט. זה מה שה-validator בדק, וזה מה שמשמש לזיהוי כפילויות.
//   markdown  - הפלט הקריא ל-LLM. רשימות, טבלאות, emphasis וקישורים שורדים בו,
//               ו-innerText מאבד את כולם.
//   codeBlocks - המקור הנקי של הקוד, שנקרא מה-DOM ולא מה-Markdown.
//
// ההחלטה לשמור את כולן ולא לבחור אחת היא מכוונת: ברגע שמכריזים על Markdown
// כמקור האמת היחיד, כל מה ש-Turndown החמיץ אבד בלי דרך לשחזר.
export function buildPageRecord({ url, title, category, extracted, markdown, scrapedAt }) {
    return {
        url,
        title,
        category: category.trim(),
        headings: extracted.headings,

        html: extracted.html,
        content: extracted.content,
        markdown,

        codeBlocks: extracted.codeBlocks,
        hyperlinks: extracted.hyperlinks,

        scrapedAt: scrapedAt ?? new Date().toISOString(),
    };
}

export function writeDocs(outputFile, pages) {
    writeFileSync(outputFile, JSON.stringify(pages, null, 2), 'utf8');
}

// ה-audit נכתב תמיד, גם כשה-analysis נכשל וגם ב---analyze-only, כי הוא התשובה
// לשאלה "למה לא נסרק כלום".
export function writeAudit(outputFile, profile, audit) {
    const auditPath = `${outputFile}.audit.json`;
    writeFileSync(auditPath, JSON.stringify({ profile, audit }, null, 2), 'utf8');
    return auditPath;
}

export function printAnalysisReport(profile) {
    console.log(`
SITE ANALYSIS
Requested URL:       ${profile.requestedUrl}
Resolved URL:        ${profile.resolvedUrl ?? '-'}
HTTP redirect:       ${profile.redirect.http}
Meta refresh:        ${profile.redirect.metaRefresh}${profile.redirect.target ? ` -> ${profile.redirect.target}` : ''}
Generator (report):  ${profile.generator.name} (${profile.generator.confidence})
Content root:        ${profile.contentRoot.selector ? `${profile.contentRoot.selector}[${profile.contentRoot.matchIndex}]` : '-'} (score ${Math.round(profile.contentRoot.score)}, confidence ${profile.contentRoot.confidence.toFixed(2)})
Internal links:      ${profile.discovery.internalLinks}
Candidate doc links: ${profile.discovery.candidateDocLinks}
External links:      ${profile.discovery.externalLinks}
Common path prefix:  ${profile.discovery.commonPathPrefix ?? '-'}
Sitemap URLs:        ${profile.discovery.sitemapUrls.length}
Boundary strategy:   ${profile.crawlBoundary.strategy}
Boundary prefix:     ${profile.crawlBoundary.pathPrefix ?? '-'}
Boundary confidence: ${profile.crawlBoundary.confidence}
Boundary source:     ${profile.crawlBoundary.source}
Samples valid:       ${profile.validation.validSamples}/${profile.validation.sampleUrls.length}
Analysis passed:     ${profile.validation.passed}
`);

    for (const sample of profile.validation.sampleResults) {
        const mark = sample.valid ? '[ok]' : '[bad]';
        const detail = sample.valid ? '' : ` - ${sample.reasons.join(', ')}`;
        console.log(`  ${mark} ${sample.url}${detail}`);
    }
}

export function printCrawlAudit(profile, audit) {
    console.log(`
CRAWL AUDIT
Requested URL:       ${profile.requestedUrl}
Resolved URL:        ${profile.resolvedUrl}
Boundary strategy:   ${profile.crawlBoundary.strategy}
Boundary prefix:     ${profile.crawlBoundary.pathPrefix ?? '-'}
Boundary confidence: ${profile.crawlBoundary.confidence}
Visited:             ${audit.visited}
Stored:              ${audit.stored}
Empty:               ${audit.empty.length}
Failed:              ${audit.failed.length}
Without headings:    ${audit.noHeadings.length}
${audit.crawlerError ? `Crawler aborted:     ${audit.crawlerError}\n` : ''}`);

    if (
        audit.rootMissing.length ||
        audit.duplicates.length ||
        audit.redirectStubs.length ||
        audit.skippedNonHtml.length ||
        audit.lateContent.length ||
        audit.filteredByProfile.length ||
        audit.skippedByCrawler.length
    ) {
        console.log(`Root not found:      ${audit.rootMissing.length}
Duplicate content:   ${audit.duplicates.length}
Redirect stubs:      ${audit.redirectStubs.length}
Skipped non-HTML:    ${audit.skippedNonHtml.length}
Late content:        ${audit.lateContent.length}
Filtered by profile: ${audit.filteredByProfile.length}
Skipped by crawler:  ${audit.skippedByCrawler.length}${skipReasonBreakdown(audit)}
`);
    }

    // ⚠️ הודעה נפרדת, ולא עוד שורה במניין. זחילה שנחתכה בתקרה היא תוצאה
    // חלקית שנראית כמו הצלחה, וזה הכשל שהכלי הזה קיים כדי לא לחזור עליו.
    if (audit.truncatedByLimit) {
        console.log(
            `[warn] הזחילה נעצרה ב-maxRequestsPerCrawl. התוצאה חלקית — העלו את התקרה או צמצמו את ה-boundary.\n`,
        );
    }
}

/** פירוט הסיבות לדילוג, כשיש יותר מאחת. */
function skipReasonBreakdown(audit) {
    if (audit.skippedByCrawler.length === 0) return '';
    const counts = new Map();
    for (const { reason } of audit.skippedByCrawler) {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    return ` (${[...counts].map(([reason, n]) => `${reason}: ${n}`).join(', ')})`;
}
