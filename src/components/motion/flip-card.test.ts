import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { FlipCard } from './flip-card';

// Security review 2026-09-08 (MEDIUM): the server HTML of the gift page must
// never contain an inert / aria-hidden subtree, and the payment CTA must live
// OUTSIDE the flipping card, so a guest whose JavaScript never runs (WhatsApp
// in-app browser on a slow network, blocked JS, failed hydration) can still
// reach every essential control.

function ssr() {
  return renderToStaticMarkup(
    createElement(FlipCard, {
      front: createElement('p', null, 'front-face'),
      back: createElement('a', { href: '/back-link' }, 'back-face-link'),
      frontToggleLabel: 'קדימה',
      backToggleLabel: 'חזרה',
    }),
  );
}

describe('FlipCard (SSR contract)', () => {
  it('renders both faces with NO inert and NO aria-hidden in the server HTML', () => {
    const html = ssr();
    expect(html).toContain('front-face');
    expect(html).toContain('href="/back-link"');
    expect(html).not.toMatch(/\binert\b/);
    // The two FACE wrappers (the only elements the island ever hides) must
    // carry no aria-hidden in SSR. Decorative lucide icons legitimately do.
    const faces = html.match(/<div class="[^"]*backface-hidden[^"]*"[^>]*>/g) ?? [];
    expect(faces).toHaveLength(2);
    for (const tag of faces) expect(tag).not.toContain('aria-hidden');
  });

  it('server HTML opens on the FRONT face (rotateY 0) — no hydration flash for the JS path', () => {
    const html = ssr();
    // The rotating element carries motion's initial inline style; a 180°
    // server state would flash back→front on hydration.
    expect(html).not.toMatch(/rotateY\(180deg\)/);
  });
});

describe('gift landing keeps the payment CTA outside the card', () => {
  const src = readFileSync(
    join(__dirname, '..', '..', 'app', '(public)', 'g', '[token]', 'gift-landing.tsx'),
    'utf8',
  );
  it('the /go CTA is rendered after the <FlipCard …/> element, not inside a face', () => {
    const flipStart = src.indexOf('<FlipCard');
    const flipEnd = src.indexOf('/>', flipStart);
    const cta = src.indexOf('/go`}');
    expect(flipStart).toBeGreaterThan(-1);
    expect(flipEnd).toBeGreaterThan(flipStart);
    expect(cta).toBeGreaterThan(flipEnd);
  });
  it('has exactly one <h1>, outside the faces and visible to assistive tech from the start', () => {
    expect(src.match(/<h1\b/g)?.length).toBe(1);
    expect(src.indexOf('<h1')).toBeLessThan(src.indexOf('<FlipCard'));
  });
});
