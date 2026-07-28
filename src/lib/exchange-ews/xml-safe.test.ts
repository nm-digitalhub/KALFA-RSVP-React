import { describe, expect, it } from 'vitest';

import { xmlSafe } from './xml-safe';

// The failure this guards against is silent: Exchange answers NoError and
// stores nothing. These assertions are the only thing standing between an HTML
// body and an appointment that looks scheduled but is empty when opened.
describe('xmlSafe', () => {
  it('escapes markup so the server stores it as text, not as XML elements', () => {
    expect(xmlSafe('<div dir="rtl">שלום</div>')).toBe(
      '&lt;div dir="rtl"&gt;שלום&lt;/div&gt;',
    );
  });

  it('escapes the ampersand FIRST, so an escape is never itself re-escaped', () => {
    // Naive ordering turns "<" into "&lt;" and then that "&" into "&amp;lt;".
    expect(xmlSafe('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('escapes an existing entity once, which the server decodes back to itself', () => {
    // buildCallbackBody already HTML-escapes customer text, so "&amp;" arrives
    // here and must survive one XML decode as "&amp;" — the HTML entity, intact.
    expect(xmlSafe('&amp;')).toBe('&amp;amp;');
  });

  it('leaves a plain Hebrew subject untouched', () => {
    expect(xmlSafe('שיחה חוזרת — ישראל ישראלי')).toBe('שיחה חוזרת — ישראל ישראלי');
  });

  it('escapes the ampersand in a name, which would otherwise malform the request', () => {
    expect(xmlSafe('דנה & יוסי')).toBe('דנה &amp; יוסי');
  });

  it('handles an empty string without inventing content', () => {
    expect(xmlSafe('')).toBe('');
  });
});
