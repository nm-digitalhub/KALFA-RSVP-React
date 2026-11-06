// The languages of the public site and how a URL selects one. Hebrew is the default and has no prefix: /about is Hebrew,
// /en/about and /fr/about are the translations. The pages stay where they are: next.config.ts maps the prefixed URL onto
// the plain route, and src/proxy.ts passes the language in LANGUAGE_HEADER, which next-i18next's getT reads
// (localeInPath: false). This file runs in the proxy and in next.config.ts, so it holds no i18next import.

// A relative path: next.config.ts loads this file outside the bundler, where the @/ alias does not resolve.
import { MARKDOWN_NEGOTIABLE_PATHS } from '../http/markdown-negotiation';

export const DEFAULT_LANGUAGE = 'he';
export const SITE_LANGUAGES = [DEFAULT_LANGUAGE, 'en', 'fr'] as const;
export type SiteLanguage = (typeof SITE_LANGUAGES)[number];

export const LANGUAGE_HEADER = 'x-i18next-current-language';

// Only the marketing pages have translated URLs, the same list the Markdown negotiation serves. Guest token pages will
// take the guest's language, not the URL's, and the customer app and admin stay Hebrew, so /en/app is a 404 rather than
// a second way into a protected route.

export function parseLanguagePath(pathname: string): { language: SiteLanguage; pathname: string } | null {
  const [, prefix, ...rest] = pathname.split('/');
  const language = SITE_LANGUAGES.find((candidate) => candidate === prefix && candidate !== DEFAULT_LANGUAGE);
  if (!language) return null;
  const plainPath = `/${rest.join('/')}`;
  return MARKDOWN_NEGOTIABLE_PATHS.has(plainPath) ? { language, pathname: plainPath } : null;
}

// The URL of a link in a language. Anything without a translated URL (/auth, /app, a file, an in-page #anchor) stays as it
// is, and so does every link in the default language.
export function hrefInLanguage(href: string, language: string): string {
  const pathEnd = href.search(/[?#]/);
  const path = pathEnd === -1 ? href : href.slice(0, pathEnd);
  if (language === DEFAULT_LANGUAGE || !MARKDOWN_NEGOTIABLE_PATHS.has(path)) return href;
  return `/${language}${path === '/' ? '' : path}${href.slice(path.length)}`;
}

// One rewrite per translated URL, from the list parseLanguagePath reads, so a URL the proxy gives a language always reaches
// its page. They belong in next.config.ts and not in the proxy: Next treats a rewrite returned by the proxy as external when
// the server binds to 127.0.0.1 (vercel/next.js#94745), and it answers 500.
export function languageRewrites(): { source: string; destination: string }[] {
  return SITE_LANGUAGES.filter((language) => language !== DEFAULT_LANGUAGE).flatMap((language) =>
    [...MARKDOWN_NEGOTIABLE_PATHS].map((path) => ({ source: hrefInLanguage(path, language), destination: path })),
  );
}
