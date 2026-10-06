import { describe, expect, it } from 'vitest';

import { buildBreadcrumbJsonLd, jsonLdScript } from './breadcrumb-json-ld';

describe('buildBreadcrumbJsonLd', () => {
  it('is home > page, with the home URL and no URL on the current page', () => {
    const ld = buildBreadcrumbJsonLd('https://example.test', 'אודות');
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: 'https://example.test/' },
      { '@type': 'ListItem', position: 2, name: 'אודות' },
    ]);
  });
});

describe('jsonLdScript', () => {
  it('escapes < so a value can never close the <script> tag', () => {
    const out = jsonLdScript({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('<');
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>');
  });
});
