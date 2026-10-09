import { describe, expect, it } from 'vitest';

import {
  agreementEmail,
  inquiryReplyEmail,
  cancellationRequestResponseEmail,
  inquiryReminderEmail,
  inquiryClosingWarningEmail,
  inquiryRatingRequestEmail,
} from '@/lib/email/templates';

const URL = 'https://beta.kalfa.me/app/events/E1/campaign/C1/agreement';
const ORIGIN = 'https://beta.kalfa.me';
// 8 uppercase hex chars, matching contact_messages.ref_code's real shape
// (docs/inquiry-email-threading-fix-plan-2026-08-25.md §2.1).
const REF_CODE = 'A1B2C3D4';
const THREAD_SUBJECT_TEXT = 'תגובה לפנייתך — KALFA';

const reply = async (replyText: string, isFirst = true) =>
  (await inquiryReplyEmail({
    recipientName: 'דנה',
    replyText,
    origin: ORIGIN,
    refCode: REF_CODE,
    isFirst,
  }));

describe('agreementEmail', () => {
  it('builds a Hebrew RTL email with the event name + a secure download LINK (not an attachment)', async () => {
    const { subject, html, text } = (await agreementEmail({
      signerName: 'דנה כהן',
      eventName: 'החתונה של דנה ויוסי',
      companyName: 'קאלפא בע״מ',
      downloadUrl: URL,
    }));
    expect(subject).toContain('החתונה של דנה ויוסי');
    expect(html).toMatch(/<html\b(?=[^>]*\blang="he")(?=[^>]*\bdir="rtl")[^>]*>/);
    expect(html).toContain('דנה כהן');
    expect(html).toContain('קאלפא בע״מ');
    expect(html).toContain(`href="${URL}"`); // link, not attachment
    expect(text).toContain(URL);
  });

  it('falls back to KALFA when company name is empty', async () => {
    const { html } = (await agreementEmail({
      signerName: 'x',
      eventName: 'y',
      companyName: '',
      downloadUrl: URL,
    }));
    expect(html).toContain('KALFA');
  });

  it('escapes HTML in user-controlled fields', async () => {
    const { html } = (await agreementEmail({
      signerName: '<script>alert(1)</script>',
      eventName: 'y',
      companyName: 'z',
      downloadUrl: URL,
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('agreementEmail — package terms approved (no signature)', () => {
  const base = { signerName: 'דנה כהן', eventName: 'החתונה', companyName: 'קאלפא', downloadUrl: URL };

  it('says the terms were APPROVED, never that anything was signed', async () => {
    const { subject, html, text } = (await agreementEmail({ ...base, kind: 'approved' }));
    for (const out of [subject, html, text]) {
      expect(out).toContain('אושר');
      expect(out).not.toContain('חתום');
      expect(out).not.toContain('נחתם');
    }
    expect(html).toContain(`href="${URL}"`);
    expect(text).toContain(URL);
  });

  it('the signed wording is the default and is unchanged', async () => {
    for (const input of [base, { ...base, kind: 'signed' as const }]) {
      const { subject, html } = (await agreementEmail(input));
      expect(subject).toBe('ההסכם החתום שלך — החתונה');
      expect(html).toContain('ההסכם נחתם בהצלחה');
      expect(html).toContain('ההסכם החתום עבור האירוע <strong>החתונה</strong> מוכן.');
    }
  });
});

describe('inquiryReplyEmail', () => {
  it('renders a markdown link as an anchor on our own origin, in both arms', async () => {
    const { html, text } = (await reply('אפשר [להירשם כאן](/auth/signup) בחינם.'));
    expect(html).toContain(
      `<a href="${ORIGIN}/auth/signup" style="color:#4338ca;text-decoration:underline;font-weight:600">להירשם כאן</a>`,
    );
    // The plain-text arm must resolve it too — markdown source in an inbox is a bug.
    expect(text).toContain(`להירשם כאן (${ORIGIN}/auth/signup)`);
    expect(text).not.toContain('](');
  });

  it('closes the parenthesis before sentence punctuation, so autolinkers do not swallow it', async () => {
    const { text } = (await reply('פרטים ב[שאלות נפוצות](/faq).'));
    expect(text).toContain(`(${ORIGIN}/faq).`);
    // `…/faq.` would be captured INTO the link by most clients and 404.
    expect(text).not.toContain(`${ORIGIN}/faq.`);
  });

  it('keeps bold working, and bold INSIDE a link (links convert first)', async () => {
    const { html } = (await reply('**חשוב:** [**הרשמה**](/auth/signup)'));
    expect(html).toContain('<strong>חשוב:</strong>');
    expect(html).toContain(
      `<a href="${ORIGIN}/auth/signup" style="color:#4338ca;text-decoration:underline;font-weight:600"><strong>הרשמה</strong></a>`,
    );
  });

  it('preserves an escaped query separator in the path', async () => {
    const { html } = (await reply('[הדף](/faq?a=1&b=2)'));
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
  ])('refuses to linkify %s', async (_label, source) => {
    const { html } = (await reply(source));
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
  ])('leaves %s as literal text rather than dropping it', async (_label, source) => {
    const { html, text } = (await reply(source));
    expect(html).not.toContain('<a href');
    expect(html).toContain(source.replace(/</g, '&lt;'));
    expect(text).toContain(source);
  });

  it('accepts the site root as a target', async () => {
    const { html } = (await reply('[לעמוד הבית](/)'));
    expect(html).toContain(`href="${ORIGIN}/"`);
  });

  it('drops a drafter greeting and sign-off so the shell does not duplicate them', async () => {
    const { html, text } = (await reply(
      'שלום דנה,\n\nתודה על פנייתך.\n\nבברכה,\nצוות KALFA',
    ));
    // The shell renders exactly one greeting and one sign-off.
    expect(html.match(/שלום דנה,/g)).toHaveLength(1);
    expect(text.match(/בברכה,/g)).toHaveLength(1);
    expect(html).toContain('תודה על פנייתך.');
  });

  it('leaves a sentence that merely STARTS with a greeting word intact', async () => {
    const { html } = (await reply('שלום, אשמח לעזור לך בנושא הזה.\n\nפרטים בהמשך.'));
    expect(html).toContain('שלום, אשמח לעזור לך בנושא הזה.');
  });

  it('sets Hebrew RTL on both html and body (clients strip one or the other)', async () => {
    const { html } = (await reply('טקסט'));
    expect(html).toMatch(/<html\b(?=[^>]*\blang="he")(?=[^>]*\bdir="rtl")[^>]*>/);
    expect(html).toContain('<body lang="he" dir="rtl"');
  });

  it('escapes HTML in the drafter body', async () => {
    const { html } = (await reply('<script>alert(1)</script>'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('builds a first-reply subject WITHOUT a leading Re:, tagged with the bracketed ref code', async () => {
    const { subject } = (await reply('טקסט', true));
    expect(subject).toBe(`[KLF-${REF_CODE}] ${THREAD_SUBJECT_TEXT}`);
    expect(subject.startsWith('Re:')).toBe(false);
    expect(subject).toContain(`[KLF-${REF_CODE}]`);
  });

  it('builds a non-first reply subject WITH a leading Re:, before the bracket tag', async () => {
    const { subject } = (await reply('טקסט', false));
    expect(subject).toBe(`Re: [KLF-${REF_CODE}] ${THREAD_SUBJECT_TEXT}`);
    expect(subject.startsWith('Re:')).toBe(true);
    expect(subject).toContain(`[KLF-${REF_CODE}]`);
  });

  // Shape check, not a copy of the REF_CODE fixture: exactly 8 uppercase hex
  // chars in the tag, tag at the very front for isFirst, `Re:` ahead of the
  // tag otherwise — matching contact_messages.ref_code's real shape (§2.1) and
  // the Re:-before-tag convention (§2.2), independent of which fixture value
  // the other cases above happen to use.
  it('emits the bracket tag as [KLF-<8 uppercase hex chars>], in both arms', async () => {
    expect((await reply('טקסט', true)).subject).toMatch(/^\[KLF-[0-9A-F]{8}\] /);
    expect((await reply('טקסט', false)).subject).toMatch(/^Re: \[KLF-[0-9A-F]{8}\] /);
  });
});

describe('cancellationRequestResponseEmail', () => {
  it('full_cancellation subject and body confirm no charge', async () => {
    const { subject, text } = (await cancellationRequestResponseEmail({
      recipientName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'full_cancellation',
      resolutionNote: 'מבטלים כי לא נשלחו הודעות', origin: ORIGIN,
    }));
    expect(subject).toContain('בקשת ביטול CX-7K4Q-92XM');
    expect(text).toContain('בוצע במלואו');
  });
  it('partial_charge body includes the amount', async () => {
    const { text } = (await cancellationRequestResponseEmail({
      recipientName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'partial_charge', resolutionAmount: 50,
      resolutionNote: 'עבור 12 הודעות שכבר נשלחו', origin: ORIGIN,
    }));
    expect(text).toContain('50');
  });
  // A package refund is confirmed before the e-mail is built, so the e-mail can say what went back — never "ללא חיוב"
  // to a customer who paid.
  it('full_cancellation with a refund says the amount went back to the card, not "no charge"', async () => {
    const { text } = (await cancellationRequestResponseEmail({
      recipientName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'full_cancellation', refundedAmount: 120,
      resolutionNote: 'בוטל', origin: ORIGIN,
    }));
    expect(text).toContain('₪120) הוחזר לכרטיס');
    expect(text).not.toContain('ללא חיוב');
  });
  it('partial_charge with a refund names the fee kept and the amount that went back', async () => {
    const { text } = (await cancellationRequestResponseEmail({
      recipientName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'partial_charge', resolutionAmount: 15, refundedAmount: 105,
      resolutionNote: 'דמי ביטול', origin: ORIGIN,
    }));
    expect(text).toContain('דמי ביטול של ₪15');
    expect(text).toContain('₪105 הוחזרו לכרטיס');
    expect(text).not.toContain('שירות שכבר סופק');
  });
  it('the subject of a partial with a refund says the fee was deducted, not "חיוב חלקי"', async () => {
    const { subject } = (await cancellationRequestResponseEmail({
      recipientName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'partial_charge', resolutionAmount: 15, refundedAmount: 105,
      resolutionNote: 'דמי ביטול', origin: ORIGIN,
    }));
    expect(subject).toContain('בניכוי דמי ביטול');
    expect(subject).not.toContain('חיוב חלקי');
  });
  it('declined body includes the staff note', async () => {
    const { text } = (await cancellationRequestResponseEmail({
      recipientName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'declined',
      resolutionNote: 'האירוע כבר בעיצומו', origin: ORIGIN,
    }));
    expect(text).toContain('האירוע כבר בעיצומו');
  });
});

describe('inquiryReminderEmail', () => {
  it('renders a Hebrew RTL nudge with no self-service close link, subject tagged as a reply (never first)', async () => {
    const { subject, html, text } = (await inquiryReminderEmail({
      recipientName: 'דנה',
      origin: ORIGIN,
      refCode: REF_CODE,
    }));
    // A reminder is by definition never the first message on a thread (§2.2).
    expect(subject).toBe(`Re: [KLF-${REF_CODE}] ${THREAD_SUBJECT_TEXT}`);
    expect(html).toMatch(/<html\b(?=[^>]*\blang="he")(?=[^>]*\bdir="rtl")[^>]*>/);
    expect(html).toContain('דנה');
    expect(html).toContain('עדיין צריך עזרה');
    expect(text).not.toContain('http');
  });

  it('falls back to a generic greeting when the name is empty', async () => {
    const { html } = (await inquiryReminderEmail({ recipientName: '', origin: ORIGIN, refCode: REF_CODE }));
    expect(html).toContain('לקוח יקר');
  });

  it('escapes HTML in the recipient name', async () => {
    const { html } = (await inquiryReminderEmail({
      recipientName: '<script>alert(1)</script>',
      origin: ORIGIN,
      refCode: REF_CODE,
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('inquiryClosingWarningEmail', () => {
  it('renders a Hebrew RTL final-warning with no self-service close link, subject tagged as a reply (never first)', async () => {
    const { subject, html, text } = (await inquiryClosingWarningEmail({
      recipientName: 'דנה',
      origin: ORIGIN,
      refCode: REF_CODE,
    }));
    expect(subject).toBe(`Re: [KLF-${REF_CODE}] ${THREAD_SUBJECT_TEXT}`);
    expect(html).toMatch(/<html\b(?=[^>]*\blang="he")(?=[^>]*\bdir="rtl")[^>]*>/);
    expect(html).toContain('דנה');
    expect(html).toContain('תיסגר בקרוב');
    expect(text).not.toContain('http');
  });

  it('escapes HTML in the recipient name', async () => {
    const { html } = (await inquiryClosingWarningEmail({
      recipientName: '<script>alert(1)</script>',
      origin: ORIGIN,
      refCode: REF_CODE,
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('inquiryRatingRequestEmail', () => {
  const build = async (overrides: Partial<Parameters<typeof inquiryRatingRequestEmail>[0]> = {}) =>
    (await inquiryRatingRequestEmail({
      recipientName: 'דנה',
      ratingToken: 'abc123def456',
      origin: ORIGIN,
      refCode: REF_CODE,
      ...overrides,
    }));

  it('renders a Hebrew RTL email with three score links, one per emoji, subject tagged as a reply (never first)', async () => {
    const { subject, html, text } = (await build());
    expect(subject).toBe(`Re: [KLF-${REF_CODE}] ${THREAD_SUBJECT_TEXT}`);
    expect(html).toMatch(/<html\b(?=[^>]*\blang="he")(?=[^>]*\bdir="rtl")[^>]*>/);
    expect(html).toContain('דנה');
    for (const score of [1, 2, 3]) {
      const url = `${ORIGIN}/rate/abc123def456?score=${score}`;
      expect(html).toContain(`href="${url}"`);
      expect(text).toContain(url);
    }
  });

  it('URL-encodes the token into the link', async () => {
    const { html } = (await build({ ratingToken: 'a b/c' }));
    expect(html).toContain(`${ORIGIN}/rate/a%20b%2Fc?score=1`);
  });

  it('falls back to a generic greeting when the name is empty', async () => {
    const { html } = (await build({ recipientName: '' }));
    expect(html).toContain('לקוח יקר');
  });

  it('escapes HTML in the recipient name', async () => {
    const { html } = (await build({ recipientName: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never renders raw SVG/img tags for the emoji — unicode only', async () => {
    const { html } = (await build());
    expect(html).not.toMatch(/<svg|<img[^>]*emoji/i);
  });
});
