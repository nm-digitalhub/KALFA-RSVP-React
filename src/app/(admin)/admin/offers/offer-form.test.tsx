// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OfferPackageChoice } from '@/lib/data/admin/offers';
import { OfferForm, type OfferFormInitial } from './offer-form';

// The package rows are client state, built once from the catalogue the page loaded. Saving an edit
// (updateOfferAction) revalidates the page and returns a notice without redirecting, so the form stays mounted:
// the page passes a fresh `packageChoices` while the rows keep their state. A package created meanwhile then
// arrives with no row of its own, and ticking it must give it a complete row, not a partial one.

afterEach(cleanup);

const GOLD: OfferPackageChoice = { id: 'pkg-gold', name: 'זהב', price_with_vat: 1000, active: true };
const SILVER: OfferPackageChoice = { id: 'pkg-silver', name: 'כסף', price_with_vat: 800, active: true };

const INITIAL: OfferFormInitial = {
  title: 'הצעה',
  kind: 'percent',
  value: 10,
  validity_days: 30,
  allow_agent: false,
  allow_staff: true,
  agent_objections: [],
  may_replace: false,
  is_active: true,
  packages: [{ package_id: GOLD.id, value_override: null }],
};

const action = vi.fn(async () => null);

function renderForm(packageChoices: OfferPackageChoice[]) {
  return render(
    <OfferForm action={action} initial={INITIAL} submitLabel="שמירת שינויים" packageChoices={packageChoices} />,
  );
}

function checkbox(label: RegExp): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error(`no checkbox labelled ${label}`);
  return element;
}

function packagesJson(container: HTMLElement): unknown {
  const field = container.querySelector<HTMLInputElement>('input[name="packages_json"]');
  return JSON.parse(field?.value ?? 'null');
}

describe('OfferForm — a package that arrives after the rows were built', () => {
  it('shows it unticked and leaves it out of the submitted packages', () => {
    const { container, rerender } = renderForm([GOLD]);
    rerender(<OfferForm action={action} initial={INITIAL} submitLabel="שמירת שינויים" packageChoices={[GOLD, SILVER]} />);

    expect(checkbox(/כסף/).checked).toBe(false);
    expect(packagesJson(container)).toEqual([{ package_id: GOLD.id, value_override: null }]);
  });

  it('can be ticked: it gets a complete row with an empty override', () => {
    const { container, rerender } = renderForm([GOLD]);
    rerender(<OfferForm action={action} initial={INITIAL} submitLabel="שמירת שינויים" packageChoices={[GOLD, SILVER]} />);

    fireEvent.click(checkbox(/כסף/));

    expect(checkbox(/כסף/).checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>(`input[id$="-ovr-${SILVER.id}"]`)?.value).toBe('');
    expect(packagesJson(container)).toEqual([
      { package_id: GOLD.id, value_override: null },
      { package_id: SILVER.id, value_override: null },
    ]);
  });

  it('keeps an override typed for it', () => {
    const { container, rerender } = renderForm([GOLD]);
    rerender(<OfferForm action={action} initial={INITIAL} submitLabel="שמירת שינויים" packageChoices={[GOLD, SILVER]} />);

    fireEvent.click(checkbox(/כסף/));
    const override = container.querySelector<HTMLInputElement>(`input[id$="-ovr-${SILVER.id}"]`);
    if (!override) throw new Error('the override field of the ticked package is missing');
    fireEvent.change(override, { target: { value: '15' } });

    expect(packagesJson(container)).toEqual([
      { package_id: GOLD.id, value_override: null },
      { package_id: SILVER.id, value_override: 15 },
    ]);
  });
});
