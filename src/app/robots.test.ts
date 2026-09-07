import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.example.test') }));

import robots from './robots';

describe('robots.txt', () => {
  it('keeps the token surfaces and the authenticated app off crawlers', async () => {
    const r = await robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules?.disallow).toEqual(
      expect.arrayContaining(['/r/', '/g/', '/ty/', '/join/', '/app/', '/admin/', '/api/']),
    );
  });

  it('does NOT block /auth/ — those pages are crawlable + noindex per Google guidance', async () => {
    // A robots.txt block hides the noindex Google would otherwise honour; the
    // sign-in pages are linked from the homepage, so a block would leave them
    // indexable as bare URLs. See src/app/auth/layout.tsx.
    const r = await robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules?.disallow).not.toContain('/auth/');
  });

  it('points at the sitemap on the configured origin', async () => {
    expect((await robots()).sitemap).toBe('https://beta.example.test/sitemap.xml');
  });
});
