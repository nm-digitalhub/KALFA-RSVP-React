import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Source-level guards for /about (same approach as event-types.test.ts: the
// vitest environment is Node, so structure is pinned through the file).
const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const repoRoot = join(__dirname, '..', '..', '..', '..', '..');

describe('/about page', () => {
  // Same truthfulness gate as the marketing catalogue: KALFA has no seating,
  // table planning or ticketing, and the about page must not say otherwise.
  it('claims no capability the product does not have', () => {
    for (const forbidden of ['הושבה', 'שולחנות', 'סידורי הושבה', 'מכירת כרטיסים', 'כרטיסים']) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it('reads the operator identity from company settings, never a typed value', () => {
    expect(src).toContain('getCompanyLegal()');
    // No hardcoded price either — pricing lives on /faq, from the package row.
    expect(src).not.toMatch(/₪\s*\d/);
  });

  it('describes the Organization the home page publishes, not a second entity', () => {
    expect(src).toContain("'@type': 'AboutPage'");
    expect(src).toContain('/#organization');
  });

  it('is registered in all four public-page lists', () => {
    const read = (...p: string[]) => readFileSync(join(repoRoot, ...p), 'utf8');
    expect(read('src', 'app', 'sitemap.ts')).toContain('/about');
    expect(read('src', 'lib', 'http', 'markdown-negotiation.ts')).toContain("'/about'");
    expect(read('src', 'app', '[...catchAll]', 'route.ts')).toContain('/about');
    expect(read('src', 'app', 'llms.txt', 'route.ts')).toContain('/about');
  });
});
