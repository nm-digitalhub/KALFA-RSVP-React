// workflowbuilder_docs.json  ->  one Markdown file per page, mirroring the URL path.
//
// The crawl produces a single JSON array; this turns it into a readable tree.
// It exists because the first export was written out by hand, which means the
// files could not be regenerated and nobody could tell a stale page from a
// fresh one.
//
//   node scripts/docs-json-to-md.mjs [input.json] [outDir]
//
// Defaults: workflowbuilder_docs.json -> docs/workflowbuilder/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const INPUT = process.argv[2] || 'workflowbuilder_docs.json';
const OUT_DIR = process.argv[3] || 'docs/workflowbuilder';

const pages = JSON.parse(readFileSync(INPUT, 'utf-8'));

// /docs/nodes/decision/  ->  nodes/decision.md
// /docs/nodes/           ->  nodes/index.md   (because deeper pages exist)
// /docs/guides/…         ->  guides/….md
//
// Every Starlight URL ends in a slash, so the path alone cannot say whether a
// page is a leaf or the index of a section. What settles it is the rest of the
// export: a page is an index exactly when another scraped page lives beneath
// it. Without this, /docs/nodes/ lands as `nodes.md` sitting BESIDE a `nodes/`
// directory — legal on disk, and misleading to anyone reading the tree.
function makePathFor(allUrls) {
  const prefixes = new Set(
    allUrls.map((u) => new URL(u).pathname.replace(/^\/docs\/?/, '')),
  );

  return function pathFor(url) {
    const { pathname } = new URL(url);
    const rest = pathname.replace(/^\/docs\/?/, '');
    const segments = rest.split('/').filter(Boolean);
    if (segments.length === 0) return 'index.md';

    const isParent = [...prefixes].some(
      (other) => other !== rest && other.startsWith(`${segments.join('/')}/`),
    );
    return isParent
      ? `${segments.join('/')}/index.md`
      : `${segments.join('/')}.md`;
  };
}

// The crawler stores each code block with real newlines already restored from
// Expressive Code's DEL encoding. Fencing is plain ``` — the language is not
// recoverable from `data-code`, and guessing it would be worse than omitting.
function render(page) {
  const lines = [
    `> מקור: ${page.url}`,
    `> נשמר: ${page.scrapedAt.slice(0, 10)}`,
    '',
    `# ${page.category || page.title}`,
    '',
    page.content,
  ];

  if (page.codeBlocks.length > 0) {
    lines.push('', '## בלוקי קוד', '');
    for (const block of page.codeBlocks) lines.push('```', block, '```', '');
  }

  // Only links that leave the page's own subtree are worth keeping: the rest
  // are the Starlight sidebar, repeated identically on all ~180 pages.
  const external = page.hyperlinks
    .filter((l) => !l.url.startsWith('https://www.workflowbuilder.io/docs/'))
    .filter((l) => l.url.startsWith('http'));
  if (external.length > 0) {
    lines.push('', '## קישורים חיצוניים', '');
    const seen = new Set();
    for (const link of external) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      lines.push(`- [${link.text}](${link.url})`);
    }
  }

  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n')}\n`;
}

const pathFor = makePathFor(pages.map((p) => p.url));

let written = 0;
let skipped = 0;

for (const page of pages) {
  // A page with no body is a redirect stub the crawler followed through; it
  // carries no documentation and writing it would create a file that looks
  // like a missing page rather than an absent one.
  if (!page.content || page.content.trim() === '') {
    skipped += 1;
    continue;
  }
  const target = join(OUT_DIR, pathFor(page.url));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, render(page), 'utf-8');
  written += 1;
}

console.log(`✨ נכתבו ${written} קבצי Markdown אל ${OUT_DIR}/`);
if (skipped > 0) console.log(`   דולגו ${skipped} עמודים ללא תוכן (עמודי הפניה).`);
