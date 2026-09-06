// Shared Open Graph fields for the public pages.
//
// WHY THIS FILE EXISTS — it is the pattern Next's own docs prescribe, and
// skipping it silently breaks things. Metadata merges per FIELD, but nested
// objects do NOT merge: "All `openGraph` fields from `app/layout.js` are
// replaced in `app/blog/page.js` because `app/blog/page.js` sets `openGraph`
// metadata" (node_modules/next/dist/docs, generate-metadata.md). So a page
// that sets only `openGraph: { description }` to fix its share preview would
// ALSO drop `type`, `locale` and `siteName` inherited from the root layout —
// a regression dressed up as a fix. The docs' own answer is to pull the shared
// fields into a variable and spread them, which is what this is.
//
// og:image is deliberately absent: the file convention
// (src/app/opengraph-image.png + .alt.txt) emits it and takes priority, so
// naming it here would only create a second place to keep in sync.

export const OPEN_GRAPH_BASE = {
  type: 'website',
  locale: 'he_IL',
  siteName: 'KALFA',
} as const;

/**
 * Open Graph block for one public page.
 *
 * `title` is the page's OWN title, unbranded: unlike `<title>`, og:title does
 * NOT get the root layout's `%s | KALFA` template applied, and the brand is
 * already carried by `siteName` in every share preview — appending it by hand
 * would render "KALFA · Page | KALFA".
 */
export function pageOpenGraph(title: string, description: string) {
  return { ...OPEN_GRAPH_BASE, title, description };
}
