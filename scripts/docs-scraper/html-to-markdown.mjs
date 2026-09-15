// המקום היחיד בפרויקט שמכיר את Turndown.
//
// התפקיד שלו הוא שלב אחד: HTML של אזור התוכן -> Markdown. הוא לא crawler, לא
// analyzer ולא extractor, והוא לא קובע אם עמוד תקין - זה נעשה קודם, על ה-DOM
// (ראו validate-page.mjs). ההפרדה הזו היא מה שמאפשר להחליף את Turndown בלי
// לגעת במנוע הסריקה.

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
});

// תיעוד טכני מלא בטבלאות, ולפעמים ב-task lists וב-strikethrough. בלי התוסף
// טבלה שלמה נמחצת לרצף שורות טקסט.
turndown.use(gfm);

// הגנה כפולה: extract-page כבר מנקה את ה-clone, אבל המודול הזה מקבל HTML גם
// ממקומות אחרים, וטקסט של <script> שנשפך ל-Markdown נראה כמו תוכן.
turndown.remove(['script', 'style', 'noscript']);

// גדר באורך שמובטח שלא יתנגש בתוכן. בלוק שמכיל בעצמו ``` היה סוגר את הגדר
// באמצע, וכל מה שאחריו היה מפסיק להיות קוד.
function fenceFor(code) {
    const longestRun = (code.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
    return '`'.repeat(Math.max(3, longestRun + 1));
}

// נמדד מול turndown 7.2.4: הכלל המובנה מזהה `language-x` על ה-<code> ותו לא.
// ארבעה דפוסים נפוצים בתיעוד נופלים אצלו, וכולם מאבדים את שם השפה או את הגדר
// כולה:
//
//   <code class="lang-ts">                 -> ``` בלי שפה
//   <pre class="astro-code language-bash"> -> ``` בלי שפה   (Astro/Shiki)
//   <pre data-language="bash">             -> ``` בלי שפה   (Expressive Code)
//   <pre> בלי <code> בכלל                  -> לא נוצרת גדר, רק טקסט מוזח
//
// ה-data-language אינו השערה: הוא נקרא מה-HTML של workflowbuilder.io, שם כל
// בלוק קוד הוא <pre data-language="bash"> בלי שום class של שפה.
//
// בתיעוד טכני שם השפה הוא חלק מהמידע, ובלוק שאיבד את הגדר מפסיק להיות קוד.
turndown.addRule('fencedCodeBlockWithLanguage', {
    filter: (node) => node.nodeName === 'PRE',
    replacement(_content, node) {
        const code = node.querySelector('code');
        const classNames = `${code?.getAttribute('class') ?? ''} ${node.getAttribute('class') ?? ''}`;
        const language =
            node.getAttribute('data-language') ||
            node.getAttribute('data-lang') ||
            classNames.match(/(?:language-|lang-)([\w+#-]+)/)?.[1] ||
            '';
        const text = (code ?? node).textContent.replace(/\n$/, '');
        const fence = fenceFor(text);
        return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    },
});

export function htmlToMarkdown(html) {
    if (!html) return '';
    return turndown.turndown(html).trim();
}
