import { createInstance } from 'i18next';

import { lookupWhatsAppErrors } from '@/lib/whatsapp/generated/error-codes';
import labels from '@/locales/he/whatsappErrors.json';

// Meta's error codes in plain Hebrew. The generated catalog says what each code means; src/locales/he/whatsappErrors.json
// only words it, with one label that is true for every Meta API using the code.
//
// Its OWN instance (createInstance), never the shared default: a module-global language is not something a server render
// for one request may change. `initAsync: false` makes `t` usable the moment this module loads, and nothing here depends on
// a request, so the worker can use it too. The labels and the catalog are whole files: call this on the server.

const NAMESPACE = 'whatsappErrors';

const i18n = createInstance();
void i18n.init({
  lng: 'he',
  fallbackLng: 'he',
  ns: [NAMESPACE],
  defaultNS: NAMESPACE,
  initAsync: false,
  // A code is never a namespace.
  nsSeparator: false,
  // A label left blank falls through to the next key instead of showing nothing.
  returnEmptyString: false,
  // React escapes on render; escaping here too would show a quote as &#39;.
  interpolation: { escapeValue: false },
  resources: { he: { [NAMESPACE]: labels } },
});

// A code as Meta sends it and the database stores it. Anything else must not reach the lookup: `Number('')` is 0, and
// `range` and `unknown` are keys of the labels file, not codes.
const CODE_PATTERN = /^(?:0|[1-9]\d*)$/;

// The exact key comes first, so a code with its own label wins over a range holding it. The catalog is asked about ranges
// only: its default API filter leaves out the codes that exist on the marketing and Direct Send APIs alone.
function keysForCode(code: string): string[] {
  if (!CODE_PATTERN.test(code)) return [];
  const ranges = lookupWhatsAppErrors(Number(code)).filter((error) => error.kind === 'range');
  return [code, ...ranges.map((range) => `range.${range.min}-${range.max}`)];
}

/** The Hebrew label of a Meta error code, or the `unknown` label when the code has none. */
export function whatsappErrorLabel(code: string): string {
  return i18n.t([...keysForCode(code), 'unknown'], { ns: NAMESPACE });
}
