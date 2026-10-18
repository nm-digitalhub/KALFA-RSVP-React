import { describe, expect, it } from 'vitest';
import { buildCancellationSmsText } from './cancellation-sms';

describe('buildCancellationSmsText', () => {
  it('full_cancellation text mentions the request number and full cancellation', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'full_cancellation' });
    expect(t).toContain('בקשת ביטול CX-7K4Q-92XM');
    expect(t).toContain('בוטלה במלואה');
  });
  it('partial_charge text includes the amount', () => {
    const t = buildCancellationSmsText({
      fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'partial_charge', resolutionAmount: 50,
    });
    expect(t).toContain('50');
  });
  // A package refund is confirmed before the SMS: it says what went back, never "no charge" to a customer who paid and
  // never the refund as if it were a charge.
  it('full_cancellation with a refund says the amount went back to the card, not "ללא חיוב"', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'full_cancellation', refundedAmount: 120 });
    expect(t).toContain('₪120 ששילמת הוחזרו לכרטיס');
    expect(t).not.toContain('ללא חיוב');
  });
  it('partial_charge with a refund names the fee that stayed and what went back', () => {
    const t = buildCancellationSmsText({
      fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'partial_charge', resolutionAmount: 15, refundedAmount: 105,
    });
    expect(t).toContain('דמי ביטול של ₪15');
    expect(t).toContain('₪105 הוחזרו לכרטיס');
    expect(t).not.toContain('חיוב חלקי');
  });
  // Owner 18.10.2026: the SMS links to the receipt for the refund. The link stands on its own line, after its label, so it is
  // neither reordered inside the Hebrew sentence nor read together with the punctuation after it.
  const URL = 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=x';
  it('a refund with its credit document links to it on its own line, between the refund and the closing line', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'full_cancellation', refundedAmount: 120, documentUrl: URL });
    expect(t).toBe(`שלום דנה, בקשת ביטול CX-7K4Q-92XM בוטלה במלואה, ו-₪120 ששילמת הוחזרו לכרטיס.\nהקבלה על הזיכוי:\n${URL}\nפרטים נשלחו במייל. צוות KALFA`);
    const p = buildCancellationSmsText({
      fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'partial_charge', resolutionAmount: 15, refundedAmount: 105, documentUrl: URL,
    });
    expect(p.split('\n')).toEqual([
      'שלום דנה, בקשת ביטול CX-7K4Q-92XM אושרה בניכוי דמי ביטול של ₪15, ו-₪105 הוחזרו לכרטיס.', 'הקבלה על הזיכוי:', URL, 'פרטים נשלחו במייל. צוות KALFA',
    ]);
  });
  it.each([null, undefined, '', '  ', 'http://secure.cardcom.solutions/doc', 'javascript:alert(1)', 'https://x.test/a b'])(
    'with no usable link (%s) the refund text is exactly the one without a link',
    (documentUrl) => {
      expect(buildCancellationSmsText({ fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'full_cancellation', refundedAmount: 120, documentUrl }))
        .toBe(buildCancellationSmsText({ fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'full_cancellation', refundedAmount: 120 }));
    },
  );
  it('a link is never added where nothing went back', () => {
    for (const resolution of ['full_cancellation', 'partial_charge', 'declined'] as const) {
      expect(buildCancellationSmsText({ fullName: 'דנה', requestCode: '7K4Q-92XM', resolution, resolutionAmount: 50, documentUrl: URL })).not.toContain('https://');
    }
  });
  it('declined text does not claim cancellation', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'declined' });
    expect(t).not.toContain('בוטלה');
  });
});
