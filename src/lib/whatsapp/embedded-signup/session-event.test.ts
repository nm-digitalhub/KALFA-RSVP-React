import { describe, expect, it } from 'vitest';

import { isMetaOrigin, parseSessionEvent } from './session-event';

describe('isMetaOrigin', () => {
  it.each([
    ['https://www.facebook.com', true],
    ['https://web.facebook.com', true],
    ['https://facebook.com', true],
    ['https://evilfacebook.com', false],
    ['https://www.facebook.com.evil.io', false],
    ['http://www.facebook.com', false],
    ['not a url', false],
  ])('%s → %s', (origin, ok) => expect(isMetaOrigin(origin)).toBe(ok));
});

describe('parseSessionEvent', () => {
  it('parses a Coexistence finish (waba only, per Meta example)', () => {
    const raw = JSON.stringify({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      version: 3,
      data: { waba_id: '524126980791429' },
    });
    expect(parseSessionEvent(raw)).toEqual({
      kind: 'finish',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      wabaId: '524126980791429',
      phoneNumberId: null,
    });
  });

  it('parses an abandoned flow', () => {
    const raw = JSON.stringify({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'CANCEL',
      data: { current_step: 'PHONE_NUMBER_SETUP' },
    });
    expect(parseSessionEvent(raw)).toEqual({ kind: 'cancel', currentStep: 'PHONE_NUMBER_SETUP' });
  });

  it('parses a user-reported error (also event CANCEL, has error_code)', () => {
    const raw = JSON.stringify({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'CANCEL',
      data: {
        error_message: 'x',
        error_code: '524126',
        session_id: 'f34b51dab5e0498',
        timestamp: '1746041036',
      },
    });
    expect(parseSessionEvent(raw)).toEqual({
      kind: 'error',
      errorCode: '524126',
      sessionId: 'f34b51dab5e0498',
      message: 'x',
    });
  });

  it('ignores non-JSON, other types, and unknown events', () => {
    expect(parseSessionEvent('not json')).toBeNull();
    expect(parseSessionEvent(JSON.stringify({ type: 'OTHER' }))).toBeNull();
    expect(
      parseSessionEvent(
        JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_OBO_MIGRATION', data: {} }),
      ),
    ).toBeNull();
  });

  it('rejects ids that are not numeric strings', () => {
    const raw = JSON.stringify({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: '1; drop', phone_number_id: '9' },
    });
    expect(parseSessionEvent(raw)).toEqual({
      kind: 'finish',
      event: 'FINISH',
      wabaId: null,
      phoneNumberId: '9',
    });
  });
});
