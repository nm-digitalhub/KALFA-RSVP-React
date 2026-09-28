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

function isSafeMarkdownUrl(raw) {
    const value = raw.trim();
    if (!value) return false;
    if (/^(?:#|\/|\.\/|\.\.\/)/.test(value)) return true;
    try {
        const url = new URL(value, 'https://markdown.invalid/');
        return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
    } catch {
        return false;
    }
}

// Turndown הוא ממיר ולא sanitizer. שני הכללים האלה מונעים בכל זאת יצירת
// Markdown פעיל מסכמות כגון javascript: ו-data:text/html.
turndown.addRule('safeLinks', {
    filter: (node) => node.nodeName === 'A' && node.hasAttribute('href'),
    replacement(content, node) {
        const href = node.getAttribute('href') || '';
        if (!isSafeMarkdownUrl(href)) return content;
        const title = node.getAttribute('title');
        return `[${content}](${href.replace(/[()]/g, '\\$&')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    },
});

turndown.addRule('safeImages', {
    filter: 'img',
    replacement(_content, node) {
        const src = node.getAttribute('src') || '';
        if (!isSafeMarkdownUrl(src)) return node.getAttribute('alt') || '';
        const alt = (node.getAttribute('alt') || '').replace(/([\[\]])/g, '\\$1');
        const title = node.getAttribute('title');
        return `![${alt}](${src.replace(/[()]/g, '\\$&')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    },
});

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
        const rawLanguage =
            node.getAttribute('data-language') ||
            node.getAttribute('data-lang') ||
            classNames.split(/\s+/)
                .map((token) => token.match(/^(?:language-|lang-)([\w+#.-]+)$/)?.[1])
                .find(Boolean) ||
            '';
        const language = rawLanguage.trim().match(/^[A-Za-z0-9_+#.-]+$/)?.[0] || '';
        const lineNodes = code
            ? Array.from(code.querySelectorAll('.ec-line,.line,[data-line]')).filter((line) => {
                let parent = line.parentNode;
                while (parent && parent !== code && !parent.matches?.('.ec-line,.line,[data-line]')) {
                    parent = parent.parentNode;
                }
                return parent === code;
            })
            : [];
        const text = (lineNodes.length > 1
            ? lineNodes.map((line) => line.textContent).join('\n')
            : (code ?? node).textContent).replace(/\n$/, '');
        const fence = fenceFor(text);
        return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    },
});

function markdownCell(cell) {
    const breakSentinel = 'KALFATABLECELLBREAK7F4C';
    const html = cell.innerHTML.replace(/<br\s*\/?>/gi, breakSentinel);
    return turndown.turndown(html)
        .replace(/\n+/g, '<br>')
        .replace(/\|/g, '\\|')
        .replaceAll(breakSentinel, '<br>')
        .trim();
}

function safeRawTable(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,iframe,object,embed,form,input,button')
        .forEach((element) => element.remove());
    clone.querySelectorAll('*').forEach((element) => {
        for (const attribute of Array.from(element.attributes ?? [])) {
            if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        }
    });
    clone.querySelectorAll('a[href]').forEach((link) => {
        if (!isSafeMarkdownUrl(link.getAttribute('href') || '')) link.removeAttribute('href');
    });
    clone.querySelectorAll('img[src]').forEach((image) => {
        if (!isSafeMarkdownUrl(image.getAttribute('src') || '')) image.removeAttribute('src');
    });
    return clone.outerHTML;
}

// ה-plugin של GFM מניח grid מלבני פשוט. במקום להשחית spans בשקט, טבלאות
// מורכבות (או כאלה שאין להן header סמנטי) נשמרות כ-HTML תקני. טבלה פשוטה
// מומרת כאן כדי לברוח pipes ולשמר <br> בתוך תא.
turndown.addRule('safeGfmTable', {
    filter: 'table',
    replacement(_content, node) {
        const rows = Array.from(node.querySelectorAll('tr')).filter((row) => {
            let parent = row.parentNode;
            while (parent && parent.nodeName !== 'TABLE') parent = parent.parentNode;
            return parent === node;
        });
        const hasSpan = Boolean(node.querySelector('[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"])'));
        const firstCells = rows[0] ? Array.from(rows[0].childNodes).filter((cell) => /^(TH|TD)$/.test(cell.nodeName)) : [];
        const hasHeader = firstCells.length > 0 && firstCells.every((cell) => cell.nodeName === 'TH');
        const width = firstCells.length;
        const rectangular = width > 0 && rows.every((row) =>
            Array.from(row.childNodes).filter((cell) => /^(TH|TD)$/.test(cell.nodeName)).length === width);

        if (hasSpan || !hasHeader || !rectangular) {
            return `\n\n${safeRawTable(node)}\n\n`;
        }

        const matrix = rows.map((row) =>
            Array.from(row.childNodes)
                .filter((cell) => /^(TH|TD)$/.test(cell.nodeName))
                .map(markdownCell));
        const lines = [
            `| ${matrix[0].join(' | ')} |`,
            `| ${matrix[0].map(() => '---').join(' | ')} |`,
            ...matrix.slice(1).map((row) => `| ${row.join(' | ')} |`),
        ];
        return `\n\n${lines.join('\n')}\n\n`;
    },
});

export function htmlToMarkdown(html) {
    if (html == null || html === '') return '';
    if (typeof html !== 'string') {
        throw new TypeError('htmlToMarkdown expects an HTML string');
    }
    return turndown.turndown(html).trim();
}
