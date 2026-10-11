// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({ signup: { bind: () => vi.fn() } }));

import { SignupForm } from './signup-form';

afterEach(cleanup);

const WORDING = 'אני מאשר/ת לקבל מ-נתנאל מבורך קלפה - KALFA RSVP עדכונים, טיפים והצעות בדוא״ל.';

describe('SignupForm — marketing consent', () => {
  it('offers the marketing box unticked, optional, after the terms box, with the server wording', () => {
    const { container } = render(<SignupForm marketingConsentText={WORDING} />);
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes.map((b) => b.name)).toEqual(['terms_accepted', 'marketing_opt_in']);
    const marketing = boxes[1];
    expect(marketing.checked).toBe(false);
    expect(marketing.required).toBe(false);
    expect(container.textContent).toContain(WORDING);
  });

  it('has no marketing box while marketing consent is switched off', () => {
    const { container } = render(<SignupForm marketingConsentText={null} />);
    expect(container.querySelector('[name="marketing_opt_in"]')).toBeNull();
  });

  it('never sends a wording or version field from the browser', () => {
    const { container } = render(<SignupForm marketingConsentText={WORDING} />);
    expect(container.querySelector('[name="wording"], [name="wording_version"], [name*="consent_version"]')).toBeNull();
  });
});
