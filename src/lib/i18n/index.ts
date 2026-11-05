import { createInstance, type TFunction } from 'i18next';

// The one way application code reaches a translation. Hebrew is the source language and it stays in the code, as the
// default value (second argument) of each call. `i18next-cli extract` copies those defaults into
// src/locales/he/<namespace>.json, which is what Locize translates from. No resource is loaded here, so a client component
// that calls `t` ships i18next and its own strings, never a whole language file.
//
// Its OWN instance (createInstance), never the shared default: a module-global language is not something a server render
// for one request may change. The language is fixed, so nothing here depends on a request and `t` also works in the worker.
// Call `getT` inside the function that renders the text, not at module scope: when English and French arrive the language
// will come from the request, and only a call made during that render can see it.
//
// One namespace per area of the product, so each can be translated, reviewed and later loaded on its own.
const NAMESPACES = ['common', 'public', 'customer', 'admin'] as const;

export type I18nNamespace = (typeof NAMESPACES)[number];

const i18n = createInstance();
void i18n.init({
  lng: 'he',
  fallbackLng: 'he',
  ns: [...NAMESPACES],
  defaultNS: 'common',
  initAsync: false,
  // Required even when empty: without it i18next looks for a backend to load translations from.
  resources: {},
  // `extract` writes "" for each key a language has not translated yet. Without this, that blank would be shown as the text.
  returnEmptyString: false,
  // React escapes on render; escaping here too would show a name like ג'ון as ג&#39;ון.
  interpolation: { escapeValue: false },
});

export function getT<Namespace extends I18nNamespace>(namespace: Namespace): TFunction<Namespace> {
  return i18n.getFixedT('he', namespace);
}
