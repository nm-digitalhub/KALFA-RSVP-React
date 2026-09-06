import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EVENT_TYPES } from '@/lib/marketing/event-types';

import { FOOTER_LINKS, FOOTER_PAGE_LINKS } from './site-footer';

// Source-level guards for the shared marketing footer (footer review
// 2026-08-24). Component tests run in a Node environment (vitest.config), so
// these pin the structure through the files rather than a DOM render.

const repoRoot = join(__dirname, '..', '..', '..');
const footerSrc = readFileSync(join(__dirname, 'site-footer.tsx'), 'utf8');
const siteDir = join(repoRoot, 'src', 'app', '(public)', '(site)');
const layoutSrc = readFileSync(join(siteDir, 'layout.tsx'), 'utf8');
const homeSrc = readFileSync(join(siteDir, 'page.tsx'), 'utf8');

describe('SiteFooter', () => {
  it('every footer link — legal tier and page tier alike — points at a real (site) route', () => {
    const hrefs = [
      ...FOOTER_LINKS.map((l) => l.href),
      ...FOOTER_PAGE_LINKS.map((l) => l.href),
    ];
    expect(FOOTER_LINKS.map((l) => l.href)).toEqual([
      '/faq',
      '/contact',
      '/privacy',
      '/terms',
      '/cookies',
    ]);
    for (const href of hrefs) {
      expect(existsSync(join(siteDir, href.slice(1), 'page.tsx')), href).toBe(true);
    }
  });

  it('the page tier covers every event type in the catalogue, so a new type cannot go unlinked', () => {
    const pageHrefs = FOOTER_PAGE_LINKS.map((l) => l.href);
    for (const e of EVENT_TYPES) {
      expect(pageHrefs, e.slug).toContain(e.path);
    }
    expect(pageHrefs).toContain('/whatsapp');
    expect(pageHrefs).toContain('/guest-list-template');
    // Labels are real text, never blank — a nav of empty links is worse than none.
    for (const l of FOOTER_PAGE_LINKS) expect(l.label.trim()).not.toBe('');
  });

  it('is two tiers of LINKS: brand, page nav, legal nav with the cookie control, copyright — no placeholder columns', () => {
    expect(footerSrc).toContain('<footer');
    expect(footerSrc).toContain('aria-label="אישורי הגעה לפי סוג אירוע"');
    expect(footerSrc).toContain('aria-label="משפטי ותמיכה"');
    expect(footerSrc).toContain('<ManageCookiesButton');
    expect(footerSrc).toContain('כל הזכויות שמורות');
    expect(footerSrc).not.toContain('FOOTER_COLS');
    // The 2026-08-24 rule that brought the old columns down still holds: a
    // marketing tier may exist only as real links, never as inert labels.
    expect(footerSrc).not.toMatch(/<span[^>]*>[^<]*(חתונות|אודות|תמיכה)/);
    // no physical-direction utilities — RTL stays logical
    expect(footerSrc).not.toMatch(/\b(ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });

  it('keyboard focus is a v4 outline (forced-colors safe), touch targets ≥44px, no outline-none / ring-offset', () => {
    // Tailwind 4.3.3: `outline-none` is a true outline-style:none with no
    // forced-colors fallback; `ring-offset-*` paints a fake background.
    // Assert on CODE lines only — the header comment names the rejected
    // utilities to explain why they are absent.
    const code = footerSrc
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    expect(code).toContain('focus-visible:outline-2');
    expect(code).toContain('focus-visible:outline-offset-2');
    expect(code).toContain('min-h-11');
    expect(code).not.toContain('outline-none');
    expect(code).not.toContain('ring-offset');
  });

  it('is mounted ONCE by the (site) layout (after children) and no longer inline in the homepage', () => {
    expect(layoutSrc).toContain("import { SiteFooter } from '@/components/site/site-footer'");
    expect(layoutSrc.indexOf('{children}')).toBeLessThan(layoutSrc.indexOf('<SiteFooter'));
    expect(homeSrc).not.toContain('<footer');
    expect(homeSrc).not.toContain('FOOTER_COLS');
    expect(homeSrc).not.toContain('ManageCookiesButton');
  });
});
