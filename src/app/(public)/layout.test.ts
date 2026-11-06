import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import i18nConfig from '@/i18n.config';

// The client i18next instance does not read the server config, so a Client Component only gets these options from the
// provider. Without them a key `extract` left as "" renders blank there, while a Server Component shows the Hebrew.
describe('public layout', () => {
  it('passes the server i18next options to the client provider', () => {
    const layout = readFileSync(join(__dirname, 'layout.tsx'), 'utf8');
    expect(layout).toContain('i18nextOptions={i18nConfig.i18nextOptions}');
    expect(layout).toContain('defaultNS={i18nConfig.defaultNS}');
    expect(layout).toContain('fallbackLng={DEFAULT_LANGUAGE}');
  });

  it('those options show the code default for an untranslated key', async () => {
    const i18n = createInstance();
    await i18n.init({
      ...i18nConfig.i18nextOptions,
      lng: 'en',
      ns: ['public'],
      defaultNS: 'public',
      resources: { en: { public: { untranslated: '' } } },
    });
    expect(i18n.t('untranslated', 'ברירת מחדל')).toBe('ברירת מחדל');
  });
});
