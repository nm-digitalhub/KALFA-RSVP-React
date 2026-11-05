// The languages of the public site and how a URL selects one. Hebrew is the default and has no prefix: /about is Hebrew,
// /en/about and /fr/about are the translations. The pages stay where they are; src/proxy.ts maps the prefixed URL onto the
// plain route and passes the language in LANGUAGE_HEADER, which next-i18next's getT reads (localeInPath: false).
// This file runs in the proxy, so it holds no i18next import.

export const DEFAULT_LANGUAGE = 'he';
export const SITE_LANGUAGES = [DEFAULT_LANGUAGE, 'en', 'fr'] as const;
export type SiteLanguage = (typeof SITE_LANGUAGES)[number];

export const LANGUAGE_HEADER = 'x-i18next-current-language';

// Only the marketing pages have translated URLs. Guest token pages will take the guest's language, not the URL's, and
// the customer app and admin stay Hebrew, so /en/app is a 404 rather than a second way into a protected route.
const TRANSLATED_PATHS = new Set([
  '/',
  '/about',
  '/bar-mitzva',
  '/brit',
  '/contact',
  '/cookies',
  '/event',
  '/faq',
  '/guest-list-template',
  '/privacy',
  '/terms',
  '/wedding',
  '/whatsapp',
]);

export function parseLanguagePath(pathname: string): { language: SiteLanguage; pathname: string } | null {
  const [, prefix, ...rest] = pathname.split('/');
  const language = SITE_LANGUAGES.find((candidate) => candidate === prefix && candidate !== DEFAULT_LANGUAGE);
  if (!language) return null;
  const plainPath = `/${rest.join('/')}`;
  return TRANSLATED_PATHS.has(plainPath) ? { language, pathname: plainPath } : null;
}

export function directionOf(language: string): 'rtl' | 'ltr' {
  return language === DEFAULT_LANGUAGE ? 'rtl' : 'ltr';
}
