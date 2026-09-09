import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import metadata from 'libphonenumber-js/min/metadata';
import { describe, expect, it } from 'vitest';

import { isAcceptablePhoneInput } from '@/lib/phone';

// PhoneInput renders <CircleFlag countryCode={…} cdnUrl="/country-flags/" />,
// which becomes a plain <img src="/country-flags/<cc>.svg">. That path is built
// from strings at RUNTIME — nothing imports the file — so a missing flag is
// invisible to tsc, to webpack, and to `next build`, and a 404 on an <img>
// throws no error at all. Without this test the failure mode is: every gate
// green, and a guest abroad sees an empty square in production.
//
// The flags come from `npm run flags:sync` (the circle-flags package) and are
// committed, because `npm run deploy` does not run that script.
const FLAG_DIR = join(process.cwd(), 'public', 'country-flags');

describe('country flag assets (public/country-flags)', () => {
  it('has a flag for every country libphonenumber-js can return', () => {
    // getCountries() is the exact set `parsed.country` is drawn from, so this
    // is the complete list of codes PhoneInput can ever ask for.
    const missing = getCountries().filter(
      (code) => !existsSync(join(FLAG_DIR, `${code.toLowerCase()}.svg`)),
    );
    expect(missing).toEqual([]);
  });

  it('has the "xx" fallback react-circle-flags falls back to', () => {
    // The library silently substitutes `xx` for an unknown code; without the
    // file that substitution is itself a 404.
    expect(existsSync(join(FLAG_DIR, 'xx.svg'))).toBe(true);
  });

  it('holds nothing but two-letter ISO flags', () => {
    // Keeps the folder to what is reachable: circle-flags also ships ~370
    // subdivision, language and historical flags (au-nsw, gb-eng, language/…)
    // that no code path can request. Re-running `npm run flags:sync` after a
    // package bump must not quietly reintroduce them.
    const strays = readdirSync(FLAG_DIR).filter(
      (name) => !/^[a-z]{2}\.svg$/.test(name),
    );
    expect(strays).toEqual([]);
  });
});

describe('PhoneInput country derivation', () => {
  // The component derives its flag with exactly this call — the same one
  // src/lib/phone.ts makes — so the flag can never contradict the server-side
  // validation that runs on submit.
  const countryOf = (raw: string, region: CountryCode = 'IL') => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    if (/^(\+|00)/.test(trimmed)) {
      const international = trimmed.replace(/^00/, '+');
      const formatter = new AsYouType();
      formatter.input(international);
      if (formatter.country) return formatter.country;
      const digits = international.replace(/^\+/, '').replace(/\D/g, '');
      for (let length = Math.min(3, digits.length); length >= 1; length--) {
        const sharing = metadata.country_calling_codes[digits.slice(0, length)];
        if (sharing?.length) return sharing[0] as CountryCode;
      }
      return null;
    }
    const parsed = parsePhoneNumberFromString(trimmed, region);
    return parsed?.isValid() ? (parsed.country ?? null) : null;
  };

  it('names the country as soon as the calling code is typed', () => {
    // The complaint this fixes: typing "+33" showed nothing until all ten
    // digits were in. A "+" is the owner stating the country, so the field
    // acknowledges it immediately.
    expect(countryOf('+33')).toBe('FR');
    expect(countryOf('+972')).toBe('IL');
    expect(countryOf('+49')).toBe('DE');
    // …and resolves a shared calling code to its main country, which is what
    // "+1 is the US" and "+44 is the UK" mean everywhere.
    expect(countryOf('+1')).toBe('US');
    expect(countryOf('+44')).toBe('GB');
    expect(countryOf('+7')).toBe('RU');
    // Longest match wins, so a partial "+97" is not mistaken for anything.
    expect(countryOf('+9')).toBeNull();
    expect(countryOf('+97')).toBeNull();
    expect(countryOf('+972')).toBe('IL');
  });

  it('reads a bare Israeli number as Israeli, with no "+" required', () => {
    // The upstream recipe forced a leading "+", turning this into
    // "+0501234567" — a number that exists in no country. This is the case
    // that must never regress: it is how most guests are entered.
    for (const v of ['0501234567', '050-123-4567', '050 123 4567']) {
      expect(countryOf(v)).toBe('IL');
    }
  });

  it('reads an international number as its own country', () => {
    expect(countryOf('+33 7 56 98 23 70')).toBe('FR');
    expect(countryOf('+33756982370')).toBe('FR');
    expect(countryOf('0033756982370')).toBe('FR');
    expect(countryOf('+44 20 7946 0958')).toBe('GB');
  });

  it('shows no country rather than guessing, for input it cannot place', () => {
    // Falls through to the globe icon.
    for (const v of ['', '   ', 'דנה', '12', '+99 756 982 370', '+999']) {
      expect(countryOf(v)).toBeNull();
    }
  });

  it('never claims Israel for input the parser only defaulted there', () => {
    // parsePhoneNumberFromString applies the 'IL' default region eagerly, so
    // `.country` alone is 'IL' for all of these. Gating on isValid() is what
    // stops the flag from contradicting the server: the third case is the
    // French number typed without its "+", which submit rejects with a message
    // telling the owner to add a country code — a 🇮🇱 flag beside it would be
    // the single most misleading thing this field could show.
    for (const v of ['12', '05', '0501234', '33756982370']) {
      expect(parsePhoneNumberFromString(v, 'IL')?.country).toBe('IL');
      expect(countryOf(v)).toBeNull();
    }
  });

  it('agrees with the server gate on every value the guest form accepts', () => {
    // A flag means "this number is valid"; the server decides the same thing
    // with the same parser. Any value that shows a flag must therefore pass
    // isAcceptablePhoneInput, or the field would promise a save that fails.
    for (const v of [
      '0501234567',
      '050-123-4567',
      '+972501234567',
      '+33 7 56 98 23 70',
      '0033756982370',
      '+1 415 555 2671',
      '+44 20 7946 0958',
    ]) {
      expect(countryOf(v)).not.toBeNull();
      expect(isAcceptablePhoneInput(v)).toBe(true);
    }
  });

  it('lets defaultCountry decide how a bare number is read', () => {
    // The prop only ever changes the reading of a number with no country code
    // of its own; libphonenumber ignores it once the value starts with "+".
    expect(countryOf('0501234567', 'IL')).toBe('IL');
    expect(countryOf('07 56 98 23 70', 'FR')).toBe('FR');
    // …and is overridden by an explicit country code, whatever the default:
    expect(countryOf('+33756982370', 'IL')).toBe('FR');
    expect(countryOf('+972501234567', 'FR')).toBe('IL');
  });

  it('offers every country in the picker, Israel first, then Hebrew order', () => {
    // The picker list is built at module load from exactly this shape. Israel
    // is pinned because it is the answer for nearly every guest; making the
    // owner scroll past 240 countries to reach the common case would be the
    // wrong default.
    const he = new Intl.DisplayNames(['he'], { type: 'region' });
    const options = getCountries()
      .map((code) => ({
        code,
        name: he.of(code) ?? code,
        callingCode: getCountryCallingCode(code),
      }))
      .sort((a, b) => {
        if (a.code === 'IL') return -1;
        if (b.code === 'IL') return 1;
        return a.name.localeCompare(b.name, 'he');
      });

    expect(options).toHaveLength(getCountries().length);
    expect(options[0]).toMatchObject({ code: 'IL', callingCode: '972' });

    // Every option must carry a dialling code — an entry without one would
    // render "+undefined" and write a broken value into the field.
    expect(options.filter((o) => !o.callingCode)).toEqual([]);

    // The rest is sorted by the Hebrew name the owner actually reads.
    const rest = options.slice(1).map((o) => o.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'he')));
  });

  it('keeps the digits already typed when a country is picked', () => {
    // applyCountry() replaces the country code and preserves the national
    // number, so correcting a wrong country does not force a retype.
    const nationalOf = (raw: string) =>
      parsePhoneNumberFromString(raw.trim(), 'IL')?.nationalNumber ??
      raw
        .trim()
        .replace(/^(\+|00)\d{1,4}/, '')
        .replace(/\D/g, '');

    expect(nationalOf('0501234567')).toBe('501234567');
    expect(nationalOf('+33 7 56 98 23 70')).toBe('756982370');
    // Half-typed input has no parse, so the fallback strips a country code and
    // any separators rather than losing what was entered.
    expect(nationalOf('+33 7 56 98')).toBe('75698');
    expect(nationalOf('')).toBe('');
  });

  it('resolves every country it reports to a Hebrew name', () => {
    // The component labels the flag with Intl.DisplayNames(['he']); a code it
    // cannot name would render an alt of bare "FR" to a screen reader.
    const he = new Intl.DisplayNames(['he'], { type: 'region' });
    const unnamed = getCountries().filter((code) => {
      const name = he.of(code);
      return !name || name === code;
    });
    expect(unnamed).toEqual([]);
  });
});
