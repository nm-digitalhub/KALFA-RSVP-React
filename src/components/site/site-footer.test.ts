import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Source-level guards for the shared marketing footer (footer review
// 2026-08-24). Component tests run in a Node environment (vitest.config), so
// these pin the structure through the files rather than a DOM render.

const repoRoot = join(__dirname, '..', '..', '..');
const footerSrc = readFileSync(join(__dirname, 'site-footer.tsx'), 'utf8');
const siteDir = join(repoRoot, 'src', 'app', '(public)', '(site)');
const layoutSrc = readFileSync(join(siteDir, 'layout.tsx'), 'utf8');
const homeSrc = readFileSync(join(siteDir, 'page.tsx'), 'utf8');

describe('SiteFooter', () => {
  it('every footer link points at a real (site) route', () => {
    const hrefs = [...footerSrc.matchAll(/href: '(\/[a-z-]+)'/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/faq', '/contact', '/privacy', '/terms', '/cookies']);
    for (const href of hrefs) {
      expect(existsSync(join(siteDir, href.slice(1), 'page.tsx')), href).toBe(true);
    }
  });

  it('is a single tier: brand link, one nav landmark with the cookie control, copyright — no placeholder columns', () => {
    expect(footerSrc).toContain('<footer');
    expect(footerSrc).toContain('aria-label="משפטי ותמיכה"');
    expect(footerSrc).toContain('<ManageCookiesButton');
    expect(footerSrc).toContain('כל הזכויות שמורות');
    expect(footerSrc).not.toContain('FOOTER_COLS');
    expect(footerSrc).not.toMatch(/<span[^>]*>[^<]*(חתונות|אודות|תמיכה)/);
    // no physical-direction utilities — RTL stays logical
    expect(footerSrc).not.toMatch(/\b(ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });

  it('is mounted ONCE by the (site) layout (after children) and no longer inline in the homepage', () => {
    expect(layoutSrc).toContain("import { SiteFooter } from '@/components/site/site-footer'");
    expect(layoutSrc.indexOf('{children}')).toBeLessThan(layoutSrc.indexOf('<SiteFooter'));
    expect(homeSrc).not.toContain('<footer');
    expect(homeSrc).not.toContain('FOOTER_COLS');
    expect(homeSrc).not.toContain('ManageCookiesButton');
  });
});
