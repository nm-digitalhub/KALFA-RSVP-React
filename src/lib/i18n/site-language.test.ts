import { describe, expect, it } from 'vitest';

import { hrefInLanguage, parseLanguagePath } from './site-language';

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

describe('hrefInLanguage', () => {
  it.each([
    ['/about', 'en', '/en/about'],
    ['/', 'fr', '/fr'],
    ['/#how', 'en', '/en#how'],
    ['/contact?t=support', 'fr', '/fr/contact?t=support'],
  ])('puts %s under the %s prefix', (href, language, expected) => {
    expect(hrefInLanguage(href, language)).toBe(expected);
  });

  it('gives a URL the proxy maps back to the same route', () => {
    expect(parseLanguagePath(hrefInLanguage('/wedding', 'fr'))).toEqual({ language: 'fr', pathname: '/wedding' });
    expect(parseLanguagePath(hrefInLanguage('/', 'en'))).toEqual({ language: 'en', pathname: '/' });
  });

  it('adds nothing in the default language', () => {
    expect(hrefInLanguage('/about', 'he')).toBe('/about');
  });

  it.each([
    ['a page with no translated URL', '/auth/login'],
    ['the customer app', '/app/events/new'],
    ['a static file', '/guest-list-template.csv'],
    ['an in-page anchor', '#how'],
    ['an external URL', 'https://waze.com/ul'],
    ['a mail link', 'mailto:hello@example.com'],
  ])('leaves %s alone', (_name, href) => {
    expect(hrefInLanguage(href, 'en')).toBe(href);
  });
});
