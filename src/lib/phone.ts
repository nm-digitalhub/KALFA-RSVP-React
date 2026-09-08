import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { ISRAELI_PHONE_RE } from '@/lib/constants';

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

// Input gate for the user-entered phone fields (guest form, CSV import,
// WhatsApp import). Guests are not always Israeli — a wedding invites family
// abroad — so an international number written in +CC or 00CC form must be
// accepted and validated against ITS OWN country's numbering plan, which is
// exactly what libphonenumber-js does once the value carries a country code.
//
// Deliberately ADDITIVE over ISRAELI_PHONE_RE rather than a replacement: every
// value that passed before still passes, so no existing guest list, import
// file, or saved form can start failing because the parser is stricter than
// the hand-written regex on some Israeli edge case. The regex is checked
// first; only a value it rejects is handed to the parser.
//
// Returns false for an empty value — callers treat "" as "no phone" BEFORE
// reaching this function, because phone is optional throughout the product.
export function isAcceptablePhoneInput(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed === '') return false;
  if (ISRAELI_PHONE_RE.test(trimmed)) return true;
  return normalizePhone(trimmed) !== null;
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

// Display-only mask for a phone the signer must RECOGNISE but that should not
// sit in full on a screen others may glance at (audit §5): the local Israeli
// form with the middle hidden — "+972501234567" → "050***4567". A non-Israeli
// number keeps its country code + last 4. Unparseable → a dash. Never used for
// anything but rendering; OTP delivery still uses the stored E.164.
export function maskPhoneForDisplay(raw: string | null | undefined): string {
  const e164 = normalizePhone(raw);
  if (!e164) return '—';
  const local = e164.startsWith('+972') ? `0${e164.slice(4)}` : e164;
  return `${local.slice(0, 3)}***${local.slice(-4)}`;
}
