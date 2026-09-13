import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

// THE GUARD FOR RETIRING A PAGE.
//
// Task 0.6 deleted /admin/channels and /admin/alerts and left a redirect behind.
// Two ways that goes wrong, and neither shows up in a build:
//
//   1. The redirect is removed (or never added) while the page is gone — every
//      bookmark, every link in a runbook, and every "לא מוגדר ב-…" message in
//      the product lands on a 404.
//   2. The redirect survives but its DESTINATION is later renamed or retired in
//      turn — the redirect still "works" and still ends in a 404, one hop later.
//
// Both are structural, so they are checked structurally: a redirect source must
// have no page in the tree (it really is retired), and its destination must have
// one (it really exists). Next resolves the routes from the same files.

const ROOT = join(import.meta.dirname, '../..');

// '/admin/integrations/slack' -> 'src/app/(admin)/admin/integrations/slack'.
// Route groups are directories wrapped in parentheses and contribute nothing to
// the URL, so a literal path lookup misses them; the admin tree lives under
// (admin), which is the only group these redirects touch.
function pageFileExists(route: string): boolean {
  const rel = route.replace(/^\//, '');
  const candidates = [
    join(ROOT, 'src/app', rel, 'page.tsx'),
    join(ROOT, 'src/app/(admin)', rel, 'page.tsx'),
    join(ROOT, 'src/app/(customer)', rel, 'page.tsx'),
    join(ROOT, 'src/app/(public)', rel, 'page.tsx'),
  ];
  return candidates.some((p) => existsSync(p));
}

describe('retired routes keep a redirect, and it points somewhere real', () => {
  it('the config actually declares redirects (a silent empty list is the bug this replaces)', async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects.length).toBeGreaterThan(0);
  });

  it('every redirect SOURCE is a page that no longer exists', async () => {
    for (const r of await nextConfig.redirects!()) {
      // A source that still has a page would never be reached — Next matches the
      // page first — so the redirect would be dead config pretending to work.
      expect(
        pageFileExists(r.source),
        `${r.source} still has a page.tsx. A redirect for a live route never fires; ` +
          `either delete the page or drop the redirect.`,
      ).toBe(false);
    }
  });

  it('every redirect DESTINATION is a page that does exist', async () => {
    for (const r of await nextConfig.redirects!()) {
      expect(
        pageFileExists(r.destination),
        `${r.source} redirects to ${r.destination}, which has no page.tsx — the ` +
          `redirect turns a bookmark into a 404 one hop later.`,
      ).toBe(true);
    }
  });

  it('the two Task 0.6 pages are retired, and land on the surfaces that replaced them', async () => {
    const bySource = Object.fromEntries(
      (await nextConfig.redirects!()).map((r) => [r.source, r]),
    );
    // /admin/channels goes to the INDEX, not to one provider: Step 4b moved the
    // channel catalog there, so the index is the only page that carries
    // everything the old one did.
    expect(bySource['/admin/channels']?.destination).toBe('/admin/integrations');
    expect(bySource['/admin/alerts']?.destination).toBe('/admin/integrations/slack');
    // 307, not 308: a permanent redirect is cached by the browser and would
    // survive a rollback.
    expect(bySource['/admin/channels']?.permanent).toBe(false);
    expect(bySource['/admin/alerts']?.permanent).toBe(false);
  });
});
