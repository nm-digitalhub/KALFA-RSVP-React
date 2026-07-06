import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Phone normalization for the outcome-billing model. A "contact" (§2–3 of the
// billing spec) is a UNIQUE reachable phone per event; the canonical dedup key
// is the E.164 form. Israeli numbers default to the 'IL' region so users may
// enter local `05x-xxxxxxx` and still normalize to +972…. Use the non-throwing
// parser at every boundary.

// Returns the E.164 phone (e.g. "+972501234567") or null when the input is
// missing or not a valid dialable number. null = "not billable / excluded".
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), 'IL');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164
}

export function isValidPhone(raw: string | null | undefined): boolean {
  return normalizePhone(raw) !== null;
}

// Spreadsheet repair: Excel silently strips the leading 0 from a numeric
// Israeli phone cell (0501234567 → 501234567), and exports sometimes carry
// the 972 prefix instead of the local 0. When the raw value still parses as a
// valid Israeli number, return the canonical local 0-form the product stores
// and displays; null when it is not an Israeli number at all.
export function repairIsraeliLocalPhone(raw: string): string | null {
  const e164 = normalizePhone(raw);
  if (!e164 || !e164.startsWith('+972')) return null;
  return `0${e164.slice(4)}`;
}
