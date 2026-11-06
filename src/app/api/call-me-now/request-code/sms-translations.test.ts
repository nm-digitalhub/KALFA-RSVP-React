import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// A translation that drops {{code}} would send an SMS with no code, and the visitor could never verify. i18next.config.ts
// makes `i18next-cli lint` fail on this (lint.checkTranslationPlaceholders), but that command is not part of `npm test`.
describe('the translations of the OTP SMS', () => {
  it.each(['en', 'fr'])('%s keeps the {{code}} placeholder', (language) => {
    const file = readFileSync(join(process.cwd(), 'src', 'locales', language, 'public.json'), 'utf8');
    const locale = JSON.parse(file) as { site?: { callMe?: { smsCode?: string } } };

    // A missing or blank key is fine: it falls back to the Hebrew default in the route.
    expect(locale.site?.callMe?.smsCode || '{{code}}').toContain('{{code}}');
  });
});
