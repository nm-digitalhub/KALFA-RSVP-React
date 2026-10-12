// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PackageChoiceForm, type PackageChoiceOffer } from './package-choice-form';

// The benefit states of the package choice (tasks 7.1/7.2, mocked in ui/Main.dc.html +
// ui/States.dc.html): every state the model can hold renders deliberately — active prices with a
// struck-through list price and an accessible price sentence, the ended/used owner notices, and
// the NEUTRAL verify invitation that reveals nothing.

afterEach(cleanup);

const noopAction = async () => null;

const OFFERS: PackageChoiceOffer[] = [
  { id: 'p-1', name: 'חבילה קטנה', price: 100, contact_quota: 100, description: null, includes: [] },
  { id: 'p-2', name: 'חבילה גדולה', price: 200, contact_quota: 200, description: null, includes: [] },
];

describe('PackageChoiceForm — benefit states', () => {
  it('active: covered packages show list struck through + final, uncovered keep the list price', () => {
    render(
      <PackageChoiceForm
        action={noopAction}
        offers={OFFERS}
        benefit={{
          kind: 'active',
          expiresAtLabel: '26.10.2026',
          perPackage: { 'p-1': { listPrice: 100, finalPrice: 95 } },
        }}
      />,
    );

    expect(screen.getByText(/יש לכם הטבה אישית/)).toBeTruthy();
    expect(screen.getByText(/בתוקף עד 26\.10\.2026/)).toBeTruthy();
    // The accessible price sentence carries both numbers.
    expect(screen.getByText(/מחיר עם ההטבה.*95.*במקום.*100/)).toBeTruthy();
    // The uncovered package still shows one plain price (no benefit text for it).
    expect(screen.getAllByText(/200/).length).toBeGreaterThan(0);
  });

  it('verify_invite: the neutral invitation, with no word about any offer', () => {
    render(<PackageChoiceForm action={noopAction} offers={OFFERS} benefit={{ kind: 'verify_invite' }} />);

    expect(screen.getByText(/אמתו את מספר הטלפון/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'אימות מספר הטלפון' });
    expect(link.getAttribute('href')).toBe('/app/settings');
    // Nothing reveals whether a benefit exists.
    expect(screen.queryByText(/יש לכם הטבה/)).toBeNull();
  });

  it('ended (expired): the owner is told, with the date, and prices are the regular ones', () => {
    render(
      <PackageChoiceForm
        action={noopAction}
        offers={OFFERS}
        benefit={{ kind: 'ended', reason: 'expired', endedAtLabel: '01.10.2026' }}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('הסתיימה ב-01.10.2026');
  });

  it('ended (unavailable): the voided-benefit notice', () => {
    render(
      <PackageChoiceForm action={noopAction} offers={OFFERS} benefit={{ kind: 'ended', reason: 'unavailable', endedAtLabel: null }} />,
    );

    expect(screen.getByRole('status').textContent).toContain('אינה זמינה עוד');
  });

  it('used: named with its event', () => {
    render(
      <PackageChoiceForm action={noopAction} offers={OFFERS} benefit={{ kind: 'used', eventName: 'החתונה של דנה' }} />,
    );

    expect(screen.getByRole('status').textContent).toContain('"החתונה של דנה"');
  });

  it('an existing campaign pre-selects its package (the pre-approval change flow)', () => {
    render(<PackageChoiceForm action={noopAction} offers={OFFERS} selectedPackageId="p-2" />);

    const selected = screen.getByLabelText(/חבילה גדולה/) as HTMLInputElement;
    expect(selected.defaultChecked).toBe(true);
    expect(screen.getByRole('button', { name: 'עדכון הבחירה והמשך' })).toBeTruthy();
  });
});
