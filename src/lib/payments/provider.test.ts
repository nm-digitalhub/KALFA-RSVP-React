import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolvePurchaseProvider } from './provider';

// Which clearing company takes a package purchase. SUMIT unless the CardCom pilot is explicitly on — and on CardCom's
// published test terminal (1000), where nothing is charged, only for someone who may configure the integration:
// everyone else keeps paying through SUMIT, never through a "payment" that moves no money and still activates a campaign.

const cfg = (over = {}) => ({ terminalNumber: 1001, apiName: 'x', enabled: true, ...over });

describe('resolvePurchaseProvider', () => {
  it('is SUMIT when CardCom is not configured', () => {
    expect(resolvePurchaseProvider(null, false)).toBe('sumit');
  });

  it('is SUMIT while the pilot switch is off', () => {
    expect(resolvePurchaseProvider(cfg({ enabled: false }), true)).toBe('sumit');
  });

  it('is CardCom on a real terminal, for everyone', () => {
    expect(resolvePurchaseProvider(cfg(), false)).toBe('cardcom');
    expect(resolvePurchaseProvider(cfg(), true)).toBe('cardcom');
  });

  it('on the test terminal is CardCom only for a platform admin; a customer stays on SUMIT', () => {
    expect(resolvePurchaseProvider(cfg({ terminalNumber: 1000 }), true)).toBe('cardcom');
    expect(resolvePurchaseProvider(cfg({ terminalNumber: 1000 }), false)).toBe('sumit');
  });
});
