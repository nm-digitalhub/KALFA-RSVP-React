import { describe, expect, it } from 'vitest';
import { buildCancellationSmsText } from './cancellation-sms';

describe('buildCancellationSmsText', () => {
  it('full_cancellation text mentions the request number and full cancellation', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestNumber: 42, resolution: 'full_cancellation' });
    expect(t).toContain('42');
    expect(t).toContain('בוטלה במלואה');
  });
  it('partial_charge text includes the amount', () => {
    const t = buildCancellationSmsText({
      fullName: 'דנה', requestNumber: 42, resolution: 'partial_charge', resolutionAmount: 50,
    });
    expect(t).toContain('50');
  });
  it('declined text does not claim cancellation', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestNumber: 42, resolution: 'declined' });
    expect(t).not.toContain('בוטלה');
  });
});
