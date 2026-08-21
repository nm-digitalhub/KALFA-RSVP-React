import { describe, expect, it } from 'vitest';

import { agreementEmail, inquiryReplyEmail, cancellationRequestResponseEmail } from '@/lib/email/templates';

const URL = 'https://beta.kalfa.me/app/events/E1/campaign/C1/agreement';
const ORIGIN = 'https://beta.kalfa.me';

const reply = (replyText: string) =>
  inquiryReplyEmail({ recipientName: 'דנה', replyText, origin: ORIGIN });

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

describe('inquiryReplyEmail', () => {
  it('renders a markdown link as an anchor on our own origin, in both arms', () => {
    const { html, text } = reply('אפשר [להירשם כאן](/auth/signup) בחינם.');
    expect(html).toContain(
      `<a href="${ORIGIN}/auth/signup" style="color:#4338ca;text-decoration:underline;font-weight:600">להירשם כאן</a>`,
    );
    // The plain-text arm must resolve it too — markdown source in an inbox is a bug.
    expect(text).toContain(`להירשם כאן (${ORIGIN}/auth/signup)`);
    expect(text).not.toContain('](');
  });

  it('closes the parenthesis before sentence punctuation, so autolinkers do not swallow it', () => {
    const { text } = reply('פרטים ב[שאלות נפוצות](/faq).');
    expect(text).toContain(`(${ORIGIN}/faq).`);
    // `…/faq.` would be captured INTO the link by most clients and 404.
    expect(text).not.toContain(`${ORIGIN}/faq.`);
  });

  it('keeps bold working, and bold INSIDE a link (links convert first)', () => {
    const { html } = reply('**חשוב:** [**הרשמה**](/auth/signup)');
    expect(html).toContain('<strong>חשוב:</strong>');
    expect(html).toContain(
      `<a href="${ORIGIN}/auth/signup" style="color:#4338ca;text-decoration:underline;font-weight:600"><strong>הרשמה</strong></a>`,
    );
  });

  it('preserves an escaped query separator in the path', () => {
    const { html } = reply('[הדף](/faq?a=1&b=2)');
    expect(html).toContain(`href="${ORIGIN}/faq?a=1&amp;b=2"`);
  });

  // Every target that is not a same-origin path must stay LITERAL TEXT — no
  // anchor at all. A scheme is never accepted, so javascript:/data: are
  // unreachable by construction rather than by blocklist.
  it.each([
    ['protocol-relative external host', '[קליק](//evil.com)'],
    ['absolute external url', '[קליק](https://evil.com)'],
    ['javascript scheme', '[קליק](javascript:alert(1))'],
    ['data scheme', '[קליק](data:text/html,<script>alert(1)</script>)'],
    ['backslash authority override', '[קליק](/\\evil.com)'],
    ['attribute break-out attempt', '[קליק](/a" onmouseover="alert(1))'],
  ])('refuses to linkify %s', (_label, source) => {
    const { html } = reply(source);
    expect(html).not.toContain('<a href');
    // The payload may survive as inert DISPLAY TEXT (quotes already `&quot;`);
    // what must never appear is an unescaped handler ATTRIBUTE.
    expect(html).not.toMatch(/on\w+="/);
    expect(html).toContain('[קליק]');
  });

  // Degenerate forms must degrade to VISIBLE TEXT, never disappear: a link the
  // drafter malformed should be obvious to the human reviewing the draft.
  it.each([
    ['empty link text', '[](/faq)'],
    ['empty target', '[טקסט]()'],
    ['target with no leading slash', '[טקסט](faq)'],
  ])('leaves %s as literal text rather than dropping it', (_label, source) => {
    const { html, text } = reply(source);
    expect(html).not.toContain('<a href');
    expect(html).toContain(source.replace(/</g, '&lt;'));
    expect(text).toContain(source);
  });

  it('accepts the site root as a target', () => {
    const { html } = reply('[לעמוד הבית](/)');
    expect(html).toContain(`href="${ORIGIN}/"`);
  });

  it('drops a drafter greeting and sign-off so the shell does not duplicate them', () => {
    const { html, text } = reply(
      'שלום דנה,\n\nתודה על פנייתך.\n\nבברכה,\nצוות KALFA',
    );
    // The shell renders exactly one greeting and one sign-off.
    expect(html.match(/שלום דנה,/g)).toHaveLength(1);
    expect(text.match(/בברכה,/g)).toHaveLength(1);
    expect(html).toContain('תודה על פנייתך.');
  });

  it('leaves a sentence that merely STARTS with a greeting word intact', () => {
    const { html } = reply('שלום, אשמח לעזור לך בנושא הזה.\n\nפרטים בהמשך.');
    expect(html).toContain('שלום, אשמח לעזור לך בנושא הזה.');
  });

  it('sets Hebrew RTL on both html and body (clients strip one or the other)', () => {
    const { html } = reply('טקסט');
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('<body lang="he" dir="rtl"');
  });

  it('escapes HTML in the drafter body', () => {
    const { html } = reply('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('cancellationRequestResponseEmail', () => {
  it('full_cancellation subject and body confirm no charge', () => {
    const { subject, text } = cancellationRequestResponseEmail({
      recipientName: 'דנה', requestNumber: 42, resolution: 'full_cancellation',
      resolutionNote: 'מבטלים כי לא נשלחו הודעות', origin: ORIGIN,
    });
    expect(subject).toContain('42');
    expect(text).toContain('בוצע במלואו');
  });
  it('partial_charge body includes the amount', () => {
    const { text } = cancellationRequestResponseEmail({
      recipientName: 'דנה', requestNumber: 42, resolution: 'partial_charge', resolutionAmount: 50,
      resolutionNote: 'עבור 12 הודעות שכבר נשלחו', origin: ORIGIN,
    });
    expect(text).toContain('50');
  });
  it('declined body includes the staff note', () => {
    const { text } = cancellationRequestResponseEmail({
      recipientName: 'דנה', requestNumber: 42, resolution: 'declined',
      resolutionNote: 'האירוע כבר בעיצומו', origin: ORIGIN,
    });
    expect(text).toContain('האירוע כבר בעיצומו');
  });
});
