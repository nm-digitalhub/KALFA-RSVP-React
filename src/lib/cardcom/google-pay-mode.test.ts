import { describe, expect, it } from 'vitest';

import { GOOGLE_PAY_MODES, isGooglePayOffered, parseGooglePayMode, type GooglePayMode } from './google-pay-mode';

// Who is offered Google Pay. The rule decides whether money-moving UI appears, so every combination is pinned.

describe('parseGooglePayMode', () => {
  it.each(GOOGLE_PAY_MODES)('keeps the valid position %s', (mode) => {
    expect(parseGooglePayMode(mode)).toBe(mode);
  });

  it.each([
    ['an unknown word', 'everyone'],
    ['a different case', 'ALL'],
    ['an empty string', ''],
    ['a boolean', true],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
    ['an object', { mode: 'all' }],
  ])('treats %s as off, so the feature fails closed', (_label, value) => {
    expect(parseGooglePayMode(value)).toBe('off');
  });
});

describe('isGooglePayOffered', () => {
  const offered = (over: Partial<Parameters<typeof isGooglePayOffered>[0]> = {}) =>
    isGooglePayOffered({ mode: 'all', usesCardcom: true, mayConfigureIntegration: false, saveCardOnPurchase: false, ...over });

  it('is never offered while the setting is off, whoever the buyer is', () => {
    expect(offered({ mode: 'off' })).toBe(false);
    expect(offered({ mode: 'off', mayConfigureIntegration: true })).toBe(false);
  });

  it('is offered to every buyer through CardCom when the setting is all', () => {
    expect(offered({ mode: 'all' })).toBe(true);
    expect(offered({ mode: 'all', mayConfigureIntegration: true })).toBe(true);
  });

  it('is offered only to someone who may configure the integration when the setting is admins', () => {
    expect(offered({ mode: 'admins', mayConfigureIntegration: true })).toBe(true);
    expect(offered({ mode: 'admins', mayConfigureIntegration: false })).toBe(false);
  });

  it.each<GooglePayMode>(['off', 'admins', 'all'])('is never offered off CardCom (the SUMIT form), whatever the setting is: %s', (mode) => {
    expect(offered({ mode, usesCardcom: false, mayConfigureIntegration: true })).toBe(false);
  });

  it.each<GooglePayMode>(['off', 'admins', 'all'])('is withheld while the card must be saved, whatever the setting is: %s', (mode) => {
    expect(offered({ mode, mayConfigureIntegration: true, saveCardOnPurchase: true })).toBe(false);
  });
});
