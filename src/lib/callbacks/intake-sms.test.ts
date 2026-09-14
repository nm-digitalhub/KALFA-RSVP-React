import { describe, expect, it } from 'vitest';

import { buildIntakeSmsText, intakeSmsSegments } from './intake-sms';

const URL = 'https://beta.kalfa.me/cb/0123456789abcdef0123456789abcdef';

describe('buildIntakeSmsText', () => {
  it('names no one — a stand-in is not a name', () => {
    // The entire point of this message is that we do NOT know who called.
    // Greeting them by the stored stand-in would reintroduce the bug it exists
    // to fix.
    const text = buildIntakeSmsText({ formUrl: URL });
    for (const placeholder of ['מתקשר לא מזוהה', 'מתקשר', 'אורח', 'לקוח']) {
      expect(text, placeholder).not.toContain(placeholder);
    }
  });

  it('states the fact that prompted it, and carries the link', () => {
    const text = buildIntakeSmsText({ formUrl: URL });
    expect(text).toContain('לא הצלחנו לענות');
    expect(text).toContain(URL);
  });

  it('⚠️ stays within two SMS segments', () => {
    // Hebrew bills as UCS-2: 70 chars for one segment, 67 per part beyond it.
    // Every missed call sends one of these, so a third segment is a 50% cost
    // rise on a line item that scales with inbound volume — including a flood.
    const text = buildIntakeSmsText({ formUrl: URL });
    expect(intakeSmsSegments(text), `${text.length} chars`).toBeLessThanOrEqual(2);
  });

  it('⚠️ is not a marketing message', () => {
    // Owner ruling carried over from no-contact-sms.ts: a service reply to
    // contact the person themselves initiated. Anything that sells turns it
    // into a דבר פרסומת and drags in the consent regime.
    const text = buildIntakeSmsText({ formUrl: URL });
    for (const sales of ['הנחה', 'מבצע', 'הצעה', 'חינם', 'הזדמנות']) {
      expect(text, sales).not.toContain(sales);
    }
  });
});

describe('intakeSmsSegments', () => {
  it.each([
    ['', 1],
    ['א'.repeat(70), 1],
    ['א'.repeat(71), 2],
    ['א'.repeat(134), 2],
    ['א'.repeat(135), 3],
  ])('%s chars → %s segment(s)', (text, expected) => {
    expect(intakeSmsSegments(text as string)).toBe(expected);
  });
});
