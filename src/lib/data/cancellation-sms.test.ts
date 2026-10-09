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
  it('declined text does not claim cancellation', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestCode: '7K4Q-92XM', resolution: 'declined' });
    expect(t).not.toContain('בוטלה');
  });
});
