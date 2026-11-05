import type { I18nConfig } from 'next-i18next/proxy';

import { DEFAULT_LANGUAGE, LANGUAGE_HEADER, SITE_LANGUAGES } from '@/lib/i18n/site-language';

// next-i18next serves the public site only. The customer app, admin and the worker keep the fixed-Hebrew getT in
// src/lib/i18n. No `createProxy`: src/proxy.ts already owns the request, so it sets LANGUAGE_HEADER itself.
const i18nConfig: I18nConfig = {
  supportedLngs: [...SITE_LANGUAGES],
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'public',
  ns: ['public'],
  localeInPath: false,
  headerName: LANGUAGE_HEADER,
  resourceLoader: (language, namespace) => import(`./locales/${language}/${namespace}.json`),
  i18nextOptions: {
    // `extract` writes "" for a key a language has not translated yet; show the fallback, never the blank.
    returnEmptyString: false,
    // React escapes on render; escaping here too would show a name like ג'ון as ג&#39;ון.
    interpolation: { escapeValue: false },
  },
};

export default i18nConfig;
