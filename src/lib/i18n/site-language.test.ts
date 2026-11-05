import { describe, expect, it } from 'vitest';

import { directionOf, parseLanguagePath } from './site-language';

describe('parseLanguagePath', () => {
  it('maps a translated marketing URL to its plain route', () => {
    expect(parseLanguagePath('/en')).toEqual({ language: 'en', pathname: '/' });
    expect(parseLanguagePath('/fr/about')).toEqual({ language: 'fr', pathname: '/about' });
  });

  it.each([
    ['a plain Hebrew URL', '/about'],
    ['the default language, which has no prefix', '/he/about'],
    ['the customer app', '/en/app'],
    ['the staff area', '/fr/admin'],
    ['a guest token page', '/en/r/abc'],
    ['an API route', '/en/api/health'],
    ['a route that only starts with a language code', '/english'],
  ])('leaves %s alone', (_name, pathname) => {
    expect(parseLanguagePath(pathname)).toBeNull();
  });
});

describe('directionOf', () => {
  it('is right-to-left for Hebrew only', () => {
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('fr')).toBe('ltr');
  });
});
