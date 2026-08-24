import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LANDING_NAV_ITEMS } from '@/components/landing-header-nav';

// Source-level guards for the shared marketing header (owner report
// 2026-08-24: the menu existed only on the homepage). Node test environment,
// so the structure is pinned through the files rather than a DOM render.

const repoRoot = join(__dirname, '..', '..', '..');
const siteDir = join(repoRoot, 'src', 'app', '(public)', '(site)');
const layoutSrc = readFileSync(join(siteDir, 'layout.tsx'), 'utf8');

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pageFiles(p));
    else if (name === 'page.tsx') out.push(p);
  }
  return out;
}

describe('SiteHeader', () => {
  it('is mounted ONCE by the (site) layout, before children', () => {
    expect(layoutSrc).toContain("import { SiteHeader } from '@/components/site/site-header'");
    expect(layoutSrc.indexOf('<SiteHeader')).toBeLessThan(layoutSrc.indexOf('{children}'));
  });

  it('no (site) page renders its own <header> any more', () => {
    for (const file of pageFiles(siteDir)) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('<header');
    }
  });

  it('nav items are absolute so they work from every page; the section anchors point at the homepage ids', () => {
    for (const item of LANDING_NAV_ITEMS) expect(item.href.startsWith('/'), item.href).toBe(true);
    const home = readFileSync(join(siteDir, 'page.tsx'), 'utf8');
    for (const item of LANDING_NAV_ITEMS.filter((i) => i.href.includes('#'))) {
      const id = item.href.split('#')[1];
      expect(home, item.href).toContain(`id="${id}"`);
    }
    const drawer = readFileSync(join(repoRoot, 'src', 'components', 'landing-mobile-nav.tsx'), 'utf8');
    expect(drawer).not.toMatch(/href="#/);
  });
});
