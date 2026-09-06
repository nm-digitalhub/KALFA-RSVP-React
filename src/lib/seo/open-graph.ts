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
// og:image MUST be listed here, and that is the non-obvious half.
//
// The file convention (src/app/opengraph-image.png + .alt.txt) injects the
// image into the openGraph object a page INHERITS. The moment a page declares
// its own openGraph, the whole inherited object is replaced — the file
// convention's image included. Shipping page-specific descriptions without
// this line silently stripped og:image from all 11 child pages while the home
// page (which declares no openGraph of its own) kept it; caught by an external
// auditor, not by us, on 2026-09-06. Its own og-check wants title +
// description + image.
//
// Dimensions and alt are restated because they travel with the image entry,
// and the alt text is the same string as opengraph-image.alt.txt — that file
// still serves the home page, so the two must say the same thing.
const OG_IMAGE = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: 'KALFA — אישורי הגעה, במקום אחד',
} as const;

// Used by the ROOT LAYOUT, which deliberately omits `images`: nothing replaces
// its openGraph object, so the file convention still injects the image there.
// Declaring it in both places risks emitting og:image twice on the home page.
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
  // `images` is restated here and NOT in OPEN_GRAPH_BASE — see OG_IMAGE above.
  // A page replaces the inherited openGraph wholesale, so it must carry the
  // image itself; the root layout must not, or the home page emits it twice.
  return { ...OPEN_GRAPH_BASE, images: [OG_IMAGE], title, description };
}
