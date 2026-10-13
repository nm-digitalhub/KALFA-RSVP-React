import { describe, expect, it } from 'vitest';

import { AGREEMENT_LINK_URL_ERROR, agreementLinkUrlSchema, isValidAgreementLinkUrl } from './link-url';

describe('isValidAgreementLinkUrl', () => {
  it.each([
    '',
    '   ',
    '/privacy',
    '/terms?lang=he#top',
    'https://beta.kalfa.me/privacy',
    'http://kalfa.me/terms',
    '  https://kalfa.me/privacy  ',
  ])('accepts %j', (value) => {
    expect(isValidAgreementLinkUrl(value)).toBe(true);
  });

  it.each([
    ['a script URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<b>x</b>'],
    ['mailto', 'mailto:support@kalfa.me'],
    ['ftp', 'ftp://kalfa.me/terms'],
    ['a protocol-relative address (another host)', '//evil.example/privacy'],
    ['a backslash that browsers read as //', '/\\evil.example'],
    ['a space that splits the path', '/ /evil.example'],
    ['a path without the leading slash', 'privacy'],
    ['an http address with no host', 'https://'],
    ['credentials in the address', 'https://user:secret@kalfa.me/privacy'],
    ['a tab inside the address', 'https://kalfa.me/pri\tvacy'],
    ['a newline inside the address', '/privacy\n/terms'],
  ])('refuses %s', (_label, value) => {
    expect(isValidAgreementLinkUrl(value)).toBe(false);
  });
});

describe('agreementLinkUrlSchema', () => {
  it('trims a valid value and names the rule for an invalid one', () => {
    expect(agreementLinkUrlSchema.parse('  /privacy ')).toBe('/privacy');
    const bad = agreementLinkUrlSchema.safeParse('javascript:alert(1)');
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].message).toBe(AGREEMENT_LINK_URL_ERROR);
  });
});
