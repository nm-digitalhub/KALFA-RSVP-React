import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EVENT_TYPES, getEventType, type EventTypeSlug } from './event-types';

// Source-level guards for the public marketing pages added 2026-09-06. Vitest
// runs in a Node environment (vitest.config), so these pin structure through
// the files rather than a DOM render — same approach as site-footer.test.ts.

const repoRoot = join(__dirname, '..', '..', '..');
const siteDir = join(repoRoot, 'src', 'app', '(public)', '(site)');
const MARKETING_PAGES = [
  ...EVENT_TYPES.map((e) => e.path),
  '/whatsapp',
  '/guest-list-template',
];

function pageSrc(path: string): string {
  return readFileSync(join(siteDir, path.slice(1), 'page.tsx'), 'utf8');
}

describe('event-type catalogue', () => {
  it('every entry has a real page file at its own path', () => {
    for (const e of EVENT_TYPES) {
      expect(existsSync(join(siteDir, e.path.slice(1), 'page.tsx')), e.slug).toBe(true);
      expect(e.path).toBe(`/${e.slug}`);
    }
  });

  it('slugs and paths are unique', () => {
    expect(new Set(EVENT_TYPES.map((e) => e.slug)).size).toBe(EVENT_TYPES.length);
    expect(new Set(EVENT_TYPES.map((e) => e.path)).size).toBe(EVENT_TYPES.length);
  });

  it('getEventType returns the matching entry and throws on an unknown slug', () => {
    expect(getEventType('wedding').slug).toBe('wedding');
    expect(() => getEventType('nope' as EventTypeSlug)).toThrow(/unknown event type/);
  });

  // The whole reason four pages exist instead of one: if their copy converges,
  // they become duplicates and rank worse than the single page they replaced.
  it('the four pages are genuinely different, not one template with a word swapped', () => {
    const titles = EVENT_TYPES.map((e) => e.title);
    expect(new Set(titles).size).toBe(EVENT_TYPES.length);
    expect(new Set(EVENT_TYPES.map((e) => e.description)).size).toBe(EVENT_TYPES.length);
    expect(new Set(EVENT_TYPES.map((e) => e.lede)).size).toBe(EVENT_TYPES.length);

    // No challenge or FAQ text is reused across two event types.
    const challenges = EVENT_TYPES.flatMap((e) => e.challenges.map((c) => c.d));
    expect(new Set(challenges).size).toBe(challenges.length);
    const answers = EVENT_TYPES.flatMap((e) => e.faq.map((f) => f.a));
    expect(new Set(answers).size).toBe(answers.length);
  });

  it('every entry carries the content the page renders', () => {
    for (const e of EVENT_TYPES) {
      expect(e.challenges.length, e.slug).toBeGreaterThanOrEqual(3);
      expect(e.timing.length, e.slug).toBeGreaterThanOrEqual(2);
      expect(e.faq.length, e.slug).toBeGreaterThanOrEqual(2);
      for (const f of e.faq) {
        expect(f.q.trim(), e.slug).not.toBe('');
        expect(f.a.trim(), e.slug).not.toBe('');
      }
      // Description length matters for the search snippet, not for rendering.
      expect(e.description.length, e.slug).toBeGreaterThan(70);
      expect(e.description.length, e.slug).toBeLessThan(200);
    }
  });

  // KALFA has no seating/table planning. A seating claim was published on the
  // home page once and had to be removed; this stops it coming back through
  // the marketing catalogue.
  it('claims no capability the product does not have', () => {
    const everything = JSON.stringify(EVENT_TYPES);
    for (const forbidden of ['הושבה', 'שולחנות', 'סידורי הושבה', 'מכירת כרטיסים']) {
      expect(everything, forbidden).not.toContain(forbidden);
    }
  });

  // The home page owns the generic head term. A page that also targets it
  // competes with the home page instead of adding reach.
  it('no event-type page targets the generic head term in its own title', () => {
    for (const e of EVENT_TYPES) {
      expect(e.title.startsWith('אישורי הגעה |'), e.slug).toBe(false);
      expect(e.title.trim(), e.slug).not.toBe('אישורי הגעה');
    }
  });
});

describe('marketing page files', () => {
  it('each declares its own canonical, title and description', () => {
    for (const path of MARKETING_PAGES) {
      const src = pageSrc(path);
      expect(src, path).toContain('alternates:');
      expect(src, path).toMatch(/canonical/);
      expect(src, path).toMatch(/title:/);
      expect(src, path).toMatch(/description:/);
    }
  });

  it('is registered in the sitemap', () => {
    const sitemap = readFileSync(join(repoRoot, 'src', 'app', 'sitemap.ts'), 'utf8');
    // Event types are mapped from the catalogue; the two standalone pages are
    // listed literally.
    expect(sitemap).toContain('EVENT_TYPES.map');
    expect(sitemap).toContain('/whatsapp');
    expect(sitemap).toContain('/guest-list-template');
  });

  it('the public template download reuses the import module, never its own copy', () => {
    const route = readFileSync(
      join(repoRoot, 'src', 'app', 'guest-list-template.csv', 'route.ts'),
      'utf8',
    );
    expect(route).toContain("from '@/lib/guests/import-template'");
    expect(route).toContain('buildTemplateCsv');
    // A second hand-written header row here is exactly the drift this avoids.
    expect(route).not.toContain('שם מלא');
  });

  it('keeps RTL logical: no physical-direction utilities in the shared component', () => {
    const component = readFileSync(
      join(repoRoot, 'src', 'components', 'site', 'event-type-page.tsx'),
      'utf8',
    );
    expect(component).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
  });
});
