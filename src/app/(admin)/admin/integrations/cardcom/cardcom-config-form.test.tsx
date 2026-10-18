// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ updateCardcomConfigAction: vi.fn(async () => null) }));

import { CardcomConfigForm, GOOGLE_PAY_OPTIONS, type CardcomConfigFormValues } from './cardcom-config-form';

// The Google Pay position of the CardCom connection: three radios in one group, the stored one checked, submitted as a
// plain form field so the server action validates it like every other field.

afterEach(cleanup);

const values = (over: Partial<CardcomConfigFormValues> = {}): CardcomConfigFormValues => ({
  terminal_number: '1001',
  api_name: 'kalfa-api',
  enabled: true,
  save_card_on_purchase: false,
  google_pay_mode: 'off',
  has_password: true,
  has_document_report_secret: true,
  document_report_url: 'https://example.test/api/cardcom/document-webhook',
  ...over,
});

describe('CardcomConfigForm — the Google Pay position', () => {
  it('offers the three positions in one labelled group', () => {
    render(<CardcomConfigForm values={values()} />);
    expect(screen.getByRole('group', { name: 'Google Pay בטופס התשלום' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(GOOGLE_PAY_OPTIONS.map((o) => o.value)).toEqual(['off', 'admins', 'all']);
  });

  it.each([
    ['off', 'כבוי'],
    ['admins', 'מנהלים בלבד'],
    ['all', 'כולם'],
  ] as const)('checks only the stored position, %s, and submits it as the form field', (mode, label) => {
    const { container } = render(<CardcomConfigForm values={values({ google_pay_mode: mode })} />);
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(screen.getByRole('radio', { name: new RegExp(label) })).toBe(checked[0]);
    // What the server action receives: one field, named as its schema expects.
    expect(new FormData(container.querySelector('form')!).getAll('google_pay_mode')).toEqual([mode]);
  });

  it('says what each position means, linked to its radio, and that it is withheld while the card is saved', () => {
    const { container } = render(<CardcomConfigForm values={values()} />);
    const text = container.textContent ?? '';
    expect(text).toContain('אף לקוח לא רואה Google Pay');
    expect(text).toContain('בלי לחשוף לקוחות');
    expect(text).toContain('שמירת כרטיס ברכישה');
    for (const radio of screen.getAllByRole('radio')) {
      const hint = document.getElementById(radio.getAttribute('aria-describedby') ?? '');
      expect(hint?.textContent?.length).toBeGreaterThan(10);
    }
  });
});
