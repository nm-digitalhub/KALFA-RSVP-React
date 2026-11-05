import { describe, expect, it } from 'vitest';

import i18nConfig from './i18n.config';

describe('i18n resources', () => {
  it('loads no Hebrew file, so the Hebrew written in the code is what the site shows', async () => {
    await expect(i18nConfig.resourceLoader?.('he', 'public')).resolves.toEqual({});
  });

  it('loads the translated languages from their files', async () => {
    const english = (await i18nConfig.resourceLoader?.('en', 'public')) as { default: { site: { contact: { title: string } } } };

    expect(english.default.site.contact.title).toBe('Contact and support');
  });
});
