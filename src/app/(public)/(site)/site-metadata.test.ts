import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Site-wide SEO metadata guards for the public marketing pages, added after an
// audit against Google's SEO starter guide (2026-09-06) found five pages
// silently sharing the home page's description.
//
// WHY THIS CAN HAPPEN SILENTLY: Next.js metadata is inherited — a field a page
// does not set is taken from the parent segment (verified against
// node_modules/next/dist/docs generate-metadata.md, "Inheriting fields"). So a
// page with no `description` still RENDERS one; it just renders the wrong one,
// and nothing anywhere fails. Only comparing pages against each other catches
// it, which is what this file does.

const siteDir = __dirname;

function pageFiles(): { route: string; src: string }[] {
  const out: { route: string; src: string }[] = [];
  for (const entry of readdirSync(siteDir)) {
    const full = join(siteDir, entry);
    if (!statSync(full).isDirectory()) continue;
    const page = join(full, 'page.tsx');
    try {
      out.push({ route: `/${entry}`, src: readFileSync(page, 'utf8') });
    } catch {
      // a directory without a page.tsx (e.g. a route handler) is not a page
    }
  }
  out.push({ route: '/', src: readFileSync(join(siteDir, 'page.tsx'), 'utf8') });
  return out;
}

// PRESENCE of a metadata field, however its value is produced. The event-type
// pages set `description: content.description` from the catalogue rather than a
// string literal, and that is a real description — an earlier version of this
// file only matched quoted strings and wrongly flagged all four.
function hasField(src: string, name: 'title' | 'description' | 'openGraph'): boolean {
  return new RegExp(`\\n\\s*${name}:`).test(src.split('export default')[0]);
}

// The literal VALUE, however the page spells it: either inline in the metadata
// object or, on the pages that reuse one string for both the description and
// the Open Graph block, as a `const TITLE` / `const DESCRIPTION`.
//
// Pages that source their copy from src/lib/marketing/event-types.ts return
// null here on purpose: their text is already checked for uniqueness, length
// and truthfulness by event-types.test.ts, and duplicating those assertions
// here would only mean two places to update.
function literal(src: string, name: 'title' | 'description'): string | null {
  const constName = name === 'title' ? 'TITLE' : 'DESCRIPTION';
  const asConst = src.match(new RegExp(`\\nconst ${constName} =\\s*\\n?\\s*'([^']*)'`));
  if (asConst) return asConst[1];
  const meta = src.split('export default')[0];
  const inline = meta.match(new RegExp(`\\n\\s*${name}:\\s*\\n?\\s*'([^']*)'`));
  return inline ? inline[1] : null;
}

describe('public site metadata', () => {
  const pages = pageFiles();

  it('finds every (site) page', () => {
    // Sanity floor: if the walker silently returned nothing, every assertion
    // below would vacuously pass.
    expect(pages.length).toBeGreaterThanOrEqual(12);
    expect(pages.map((p) => p.route)).toContain('/');
    expect(pages.map((p) => p.route)).toContain('/wedding');
  });

  it('every page declares its OWN description — never inheriting the site-wide one', () => {
    const missing = pages
      .filter((p) => p.route !== '/')
      .filter((p) => !hasField(p.src, 'description'))
      .map((p) => p.route);
    // '/' is exempt: the root layout's description IS the home page's.
    expect(missing, `pages inheriting the root description: ${missing.join(', ')}`).toEqual([]);
  });

  it('descriptions are unique across pages', () => {
    const descs = pages
      .map((p) => literal(p.src, 'description'))
      .filter((d): d is string => d !== null);
    expect(new Set(descs).size, 'two pages share a description').toBe(descs.length);
  });

  it('descriptions are a real sentence, not a stub or a keyword list', () => {
    for (const p of pages) {
      const d = literal(p.src, 'description');
      if (d === null) continue;
      expect(d.length, p.route).toBeGreaterThan(60);
      // Google truncates the snippet but does not penalise length; this cap
      // only stops a whole paragraph being pasted in.
      expect(d.length, p.route).toBeLessThan(200);
      expect(d.trim(), p.route).toBe(d);
    }
  });

  it('titles never hand-append the brand — the root layout template does that', () => {
    for (const p of pages) {
      const t = literal(p.src, 'title');
      if (t === null) continue;
      expect(t, p.route).not.toContain('| KALFA');
    }
  });

  it('every page sets its OWN openGraph block, so share previews are not the site-wide blurb', () => {
    // Nested metadata objects are replaced, not merged (Next docs,
    // generate-metadata.md) — a page with no openGraph inherits the root
    // layout's whole block, description included.
    const missing = pages
      .filter((p) => p.route !== '/')
      .filter((p) => !hasField(p.src, 'openGraph'))
      .map((p) => p.route);
    expect(missing, `pages inheriting the site-wide og:description: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('openGraph is built through the shared helper, never a hand-written object', () => {
    // A literal object here would silently drop type/locale/siteName, which is
    // exactly the regression src/lib/seo/open-graph.ts exists to prevent.
    for (const p of pages.filter((x) => x.route !== '/')) {
      expect(p.src, p.route).toContain('pageOpenGraph(');
      expect(p.src, p.route).not.toMatch(/openGraph:\s*\{/);
    }
  });

  it('the shared helper carries og:image — a page openGraph replaces the file convention', () => {
    // The regression this pins: src/app/opengraph-image.png is injected into
    // the openGraph object a page INHERITS, so the moment a page declares its
    // own, the image is gone unless the helper restates it. Shipped broken on
    // 2026-09-06 and found by an external auditor, not by these tests.
    const helper = readFileSync(
      join(siteDir, '..', '..', '..', 'lib', 'seo', 'open-graph.ts'),
      'utf8',
    );
    expect(helper).toContain('opengraph-image.png');
    // ...and only from pageOpenGraph, never from the base the ROOT layout
    // spreads, or the home page emits og:image twice.
    const base = helper.slice(
      helper.indexOf('export const OPEN_GRAPH_BASE'),
      helper.indexOf('export function pageOpenGraph'),
    );
    expect(base).not.toContain('images');
    expect(helper.slice(helper.indexOf('export function pageOpenGraph'))).toContain('images:');
  });

  it('every page pins its own canonical', () => {
    for (const p of pages) {
      expect(p.src, p.route).toContain('canonical');
    }
  });
});
