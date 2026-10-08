// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PackageChoiceForm, type PackageChoiceOffer } from './package-choice-form';

// The "בחירת חבילה" step of the setup flow. The owner picks ONE fixed-price package; the form submits only which one
// (`package_id`) — the price and the quota shown here are for reading, and the server reads its own when it creates the
// campaign. What is shown must be enough to decide (name, price, quota, what is included) and must never name the
// payment provider or speak of a card hold.

afterEach(cleanup);

const OFFERS: PackageChoiceOffer[] = [
  { id: 'p-gold', name: 'זהב', price: 150, contact_quota: 100, description: 'לאירועים בינוניים', includes: ['וואטסאפ', 'שיחות AI'] },
  { id: 'p-silver', name: 'כסף', price: 99.9, contact_quota: 50, description: null, includes: [] },
];

function form(offers: PackageChoiceOffer[] = OFFERS) {
  return render(<PackageChoiceForm action={vi.fn()} offers={offers} />);
}
const radios = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLInputElement>('input[type="radio"][name="package_id"]'));

describe('PackageChoiceForm', () => {
  it('shows each package with its name, price, quota and what it includes, and submits only the package id', () => {
    const { container } = form();
    expect(container.textContent).toContain('זהב');
    expect(container.textContent).toContain('150');
    expect(container.textContent).toContain('עד 100 אנשי קשר');
    expect(container.textContent).toContain('לאירועים בינוניים');
    expect(container.textContent).toContain('שיחות AI');
    expect(radios(container).map((r) => r.value)).toEqual(['p-gold', 'p-silver']);
    // nothing but the choice is a form field: no price, no quota, no package name is submitted
    const names = Array.from(container.querySelectorAll('input, select, textarea')).map((e) => e.getAttribute('name'));
    expect(new Set(names)).toEqual(new Set(['package_id']));
  });

  it('a multi-paragraph description keeps its line breaks on screen', () => {
    const description = 'פסקה ראשונה.\n\nפסקה שנייה.';
    const { container } = form([{ ...OFFERS[0], description }]);
    const paragraph = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === description);
    expect(paragraph).toBeDefined();
    expect(paragraph?.className).toContain('whitespace-pre-line');
  });

  it('a fractional price keeps both agorot digits', () => {
    const { container } = form();
    expect(container.textContent).toContain('99.90');
  });

  it('with several packages nothing is pre-selected: the owner must choose, and the choice is required', () => {
    const { container } = form();
    expect(radios(container).every((r) => !r.checked)).toBe(true);
    expect(radios(container).every((r) => r.required)).toBe(true);
  });

  it('with a single package it is pre-selected', () => {
    const { container } = form([OFFERS[0]]);
    expect(radios(container)).toHaveLength(1);
    expect(radios(container)[0].checked).toBe(true);
  });

  it('choosing a package selects exactly that one', () => {
    const { container } = form();
    fireEvent.click(screen.getByLabelText(/כסף/));
    expect(radios(container).map((r) => r.checked)).toEqual([false, true]);
  });

  it('says what happens next, without naming the provider or a hold', () => {
    const { container } = form();
    expect(screen.getByRole('button', { name: 'בחירה והמשך להסכם' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/sumit/i);
    expect(container.textContent).not.toMatch(/תפיסה|hold/i);
  });

  it('no packages on offer → a message and no way to submit', () => {
    const { container } = form([]);
    expect(radios(container)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'בחירה והמשך להסכם' })).toBeNull();
    expect(container.textContent).toContain('אין כרגע חבילות זמינות');
  });
});
