import { describe, expect, it } from 'vitest';

import { buildNoContactSmsText } from './no-contact-sms';

describe('buildNoContactSmsText', () => {
  it('greets by name and includes the form link', () => {
    const text = buildNoContactSmsText({
      fullName: 'ישראל ישראלי',
      formUrl: 'https://beta.kalfa.me/contact',
    });

    expect(text).toContain('שלום ישראל ישראלי');
    expect(text).toContain('שלוש פעמים');
    expect(text).toContain('https://beta.kalfa.me/contact');
    expect(text).toContain('KALFA');
  });
});
