import { describe, expect, it } from 'vitest';

import { agreementEmail } from '@/lib/email/templates';

const URL = 'https://beta.kalfa.me/app/events/E1/campaign/C1/agreement';

describe('agreementEmail', () => {
  it('builds a Hebrew RTL email with the event name + a secure download LINK (not an attachment)', () => {
    const { subject, html, text } = agreementEmail({
      signerName: 'דנה כהן',
      eventName: 'החתונה של דנה ויוסי',
      companyName: 'קאלפא בע״מ',
      downloadUrl: URL,
    });
    expect(subject).toContain('החתונה של דנה ויוסי');
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('דנה כהן');
    expect(html).toContain('קאלפא בע״מ');
    expect(html).toContain(`href="${URL}"`); // link, not attachment
    expect(text).toContain(URL);
  });

  it('falls back to KALFA when company name is empty', () => {
    const { html } = agreementEmail({
      signerName: 'x',
      eventName: 'y',
      companyName: '',
      downloadUrl: URL,
    });
    expect(html).toContain('KALFA');
  });

  it('escapes HTML in user-controlled fields', () => {
    const { html } = agreementEmail({
      signerName: '<script>alert(1)</script>',
      eventName: 'y',
      companyName: 'z',
      downloadUrl: URL,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
