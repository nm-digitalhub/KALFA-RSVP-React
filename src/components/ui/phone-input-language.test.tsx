import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '@/components/ui/direction';

import { PhoneInput, countryOptionsIn } from './phone-input';

// The list exactly as it was built before the field took a language: admin and the customer app pass none, so for them
// nothing may move.
function hebrewOptionsBeforeTheLanguageProp() {
  const regionNames = new Intl.DisplayNames(['he'], { type: 'region' });
  const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });
  return getCountries()
    .map((code) => ({
      code,
      name: regionNames.of(code) ?? code,
      englishName: englishNames.of(code) ?? code,
      callingCode: getCountryCallingCode(code),
    }))
    .sort((a, b) => {
      if (a.code === 'IL') return -1;
      if (b.code === 'IL') return 1;
      return a.name.localeCompare(b.name, 'he');
    });
}

// jsdom has neither; the country list (cmdk) calls both once it opens.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const countryButton = () => screen.getByRole('button');

describe('PhoneInput without language or labels', () => {
  it('keeps the Hebrew list and its order', () => {
    expect(countryOptionsIn('he')).toStrictEqual(hebrewOptionsBeforeTheLanguageProp());
  });

  it('keeps the Hebrew wording of the country button', () => {
    render(<PhoneInput />);
    expect(countryButton().getAttribute('aria-label')).toBe('בחירת מדינה — כעת מדינה לא מזוהה');
  });

  it('names a foreign number in Hebrew', () => {
    render(<PhoneInput defaultValue="+33 7 56 98 23 70" />);
    expect(countryButton().getAttribute('aria-label')).toBe('בחירת מדינה — כעת צרפת');
    expect(screen.getByText('צרפת')).toBeTruthy();
  });

  it('opens a right-to-left Hebrew list under the right-to-left provider', async () => {
    render(
      <DirectionProvider direction="rtl">
        <PhoneInput />
      </DirectionProvider>,
    );
    await userEvent.click(countryButton());
    const search = await screen.findByPlaceholderText('חיפוש מדינה…');
    expect(search.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
    expect(screen.getAllByRole('option')[0]?.textContent).toContain('ישראל');
  });
});

describe('PhoneInput with a language', () => {
  it('names and orders the countries in that language, with Israel still first', () => {
    const french = countryOptionsIn('fr');
    expect(french[0]?.code).toBe('IL');
    expect(french.find((option) => option.code === 'DE')?.name).toBe('Allemagne');
    const rest = french.slice(1).map((option) => option.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'fr')));
  });

  it('builds a language once and leaves the Hebrew list alone', () => {
    expect(countryOptionsIn('fr')).toBe(countryOptionsIn('fr'));
    expect(countryOptionsIn('he')).toStrictEqual(hebrewOptionsBeforeTheLanguageProp());
  });

  it('shows the labels it is given and follows a left-to-right provider', async () => {
    render(
      <DirectionProvider direction="ltr">
        <PhoneInput
          language="en"
          labels={{
            search: 'Search country…',
            empty: 'No country found',
            unknownCountry: 'Unknown country',
            selectCountry: (country) => `Choose country, now ${country}`,
          }}
        />
      </DirectionProvider>,
    );
    expect(countryButton().getAttribute('aria-label')).toBe('Choose country, now Unknown country');
    await userEvent.click(countryButton());
    const search = await screen.findByPlaceholderText('Search country…');
    expect(search.closest('[dir]')?.getAttribute('dir')).toBe('ltr');
  });

  it('never passes the new props down to the input', () => {
    render(<PhoneInput language="fr" />);
    const input = document.querySelector('input');
    expect(input?.hasAttribute('language')).toBe(false);
    expect(input?.hasAttribute('labels')).toBe(false);
  });
});
