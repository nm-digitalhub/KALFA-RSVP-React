import { describe, expect, it } from 'vitest';

import { templatePreview } from './template-preview';

describe('templatePreview', () => {
  it('fills the body with the examples submitted to Meta', () => {
    const p = templatePreview([
      { type: 'HEADER', format: 'IMAGE' },
      {
        type: 'BODY',
        text: 'היום בשעה {{1}}, בכתובת {{2}}.',
        example: { body_text: [['17:30', 'גן האירועים']] },
      },
      { type: 'FOOTER', text: 'KALFA' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'לפרטי האירוע' }] },
    ]);
    expect(p).toEqual({
      header: { kind: 'IMAGE' },
      body: 'היום בשעה 17:30, בכתובת גן האירועים.',
      footer: 'KALFA',
      buttons: [{ type: 'URL', text: 'לפרטי האירוע' }],
    });
  });

  it('keeps a variable with no example visible instead of guessing', () => {
    expect(templatePreview([{ type: 'BODY', text: 'שלום {{1}} ו-{{2}}', example: { body_text: [['דנה']] } }]).body).toBe(
      'שלום דנה ו-{{2}}',
    );
  });

  it('survives an empty or malformed template', () => {
    expect(templatePreview(null)).toEqual({ header: null, body: '', footer: null, buttons: [] });
  });
});

describe('header kinds', () => {
  it('shows a media or location header by its kind, a text header filled', () => {
    expect(templatePreview([{ type: 'HEADER', format: 'LOCATION' }]).header).toEqual({ kind: 'LOCATION' });
    expect(
      templatePreview([{ type: 'HEADER', format: 'TEXT', text: 'שלום {{1}}', example: { header_text: ['דנה'] } }]).header,
    ).toEqual({ kind: 'text', text: 'שלום דנה' });
  });
});
