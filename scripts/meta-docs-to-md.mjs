// Meta developer-documentation search results  ->  one Markdown file per page.
//
// WHY THIS EXISTS RATHER THAN A CRAWLER. `scripts/scraper-v1.mjs` cannot reach
// these pages: developers.facebook.com answers a plain HTTP fetch from this
// server with HTTP 400 on every documentation path (measured 2026-09-14, three
// URL shapes, real browser User-Agent and Accept-Language). The sanctioned route
// is the Meta Social Technologies MCP's `devtools_discovery` / `search_docs`,
// which returns the page text itself. This turns those results into a readable,
// regenerable tree — the same job `docs-json-to-md.mjs` does for the
// WorkflowBuilder crawl.
//
//   node scripts/meta-docs-to-md.mjs <results-dir> [outDir] [urlFilter]
//
// Defaults: outDir = docs/whatsapp-calling, urlFilter = '/calling'
//
// ⚠️ THE SEARCH RETURNS EXTRACTS, NOT WHOLE PAGES. Each result carries
// `extractive_segments` — the passages that matched. A file written here is
// therefore the documentation as the search engine surfaced it, which is enough
// to work from and NOT a substitute for the live page when a byte-exact contract
// is at stake. Every file says so in its own header, with its source URL.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RESULTS_DIR = process.argv[2];
const OUT_DIR = process.argv[3] || 'docs/whatsapp-calling';
const FILTER = process.argv[4] || '/calling';

if (!RESULTS_DIR) {
  console.error('usage: node scripts/meta-docs-to-md.mjs <results-dir> [outDir] [urlFilter]');
  process.exit(1);
}

/**
 * Is this segment the site's navigation rather than the page?
 *
 * ⚠️ MEASURED, NOT GUESSED. The search returns the rendered page, and Meta's
 * left nav is ~4,000 characters of link text that repeats IDENTICALLY in every
 * result — on the first pass it was roughly a third of the 283k written. It is
 * recognisable by its own opening, and by the density of section headings that
 * never appear in prose.
 *
 * Deliberately conservative: a segment is dropped only when it opens with the
 * chrome or is overwhelmingly made of it, so a paragraph that happens to
 * mention "Webhooks" survives.
 */
const NAV_MARKERS = [
  'Nav Logo Build with us',
  'Developer centers AI Meta Horizon Wearables Login',
  'Docs Blog Resources Developer support Developer tools Videos Success stories',
];

function isNavigation(segment) {
  if (NAV_MARKERS.some((m) => segment.includes(m))) return true;
  // A short segment that is only breadcrumbs.
  return segment.length < 200 && /^(WhatsApp Business Platform|Nav|Overview)\b/.test(segment);
}

/** …/whatsapp/calling/call-settings  ->  call-settings.md ; …/calling -> index.md */
function pathFor(url) {
  const u = new URL(url);
  // Trailing slashes are the same page — Meta serves both, and the search
  // returns them as separate results with different extract lengths.
  const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const i = parts.lastIndexOf('calling');
  const rest = i >= 0 ? parts.slice(i + 1) : parts.slice(-1);
  return rest.length === 0 ? 'index.md' : `${rest.join('/')}.md`;
}

const pages = new Map();

for (const file of readdirSync(RESULTS_DIR).filter((f) => f.includes('devtools_discovery'))) {
  let results;
  try {
    results = JSON.parse(JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf-8')).result).data
      .results;
  } catch {
    continue; // a truncated or non-search result file is skipped, not fatal
  }

  for (const r of results) {
    if (!r.url?.includes(FILTER)) continue;
    const key = pathFor(r.url);
    const prev = pages.get(key);
    const fresh = (r.extractive_segments ?? []).filter((seg) => !isNavigation(seg));
    const body = fresh.join('\n\n').trim();
    // ⚠️ MERGE, NEVER OVERWRITE. The same page comes back from several queries
    // with DIFFERENT matched passages — keeping only the last would silently
    // throw away most of what was fetched. Segments are de-duplicated because
    // the overlap between queries is large.
    const merged = new Set([...(prev?.segments ?? []), ...fresh]);
    if (body.length === 0 && prev) continue;
    pages.set(key, {
      title: (r.title ?? key).replace(/\s*\|\s*Developer Documentation\s*$/, ''),
      url: r.url.replace(/\/+$/, ''),
      segments: merged,
    });
  }
}

let written = 0;
let chars = 0;
for (const [rel, page] of [...pages].sort()) {
  const out = join(OUT_DIR, rel);
  mkdirSync(dirname(out), { recursive: true });
  const body = [...page.segments].join('\n\n').trim();
  chars += body.length;
  writeFileSync(
    out,
    `# ${page.title}\n\n` +
      `> Source: ${page.url}\n` +
      `> Fetched via the Meta Social Technologies MCP (\`devtools_discovery\`) on ` +
      `${new Date().toISOString().slice(0, 10)}.\n` +
      `> These are the passages the documentation search returned — extracts, not the\n` +
      `> whole page. Check the source URL before relying on an exact contract.\n\n` +
      `${body}\n`,
    'utf-8',
  );
  written += 1;
}

console.log(`${written} pages -> ${OUT_DIR}  (${chars.toLocaleString()} chars)`);
