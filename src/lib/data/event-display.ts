// Isomorphic (client + server) display helpers shared by the public RSVP page
// and the public gift landing page. Kept dependency-light — no `server-only` —
// so both a client component (rsvp-form) and a server component (gift-landing)
// can import the SAME implementation instead of duplicating it.

import {
  formatIsraelDate,
  formatIsraelHebrewDate,
  formatIsraelTime,
  ISRAEL_LOCALE,
  ISRAEL_TIME_ZONE,
} from '@/lib/date';
import { ilTimeInputValue } from '@/lib/data/event-date';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import type { Database } from '@/lib/supabase/types';

type EventType = Database['public']['Enums']['event_type'];

// Official payment-brand marks for the gift CTA (public/brands — bit's is the
// favicon from bitpay.co.il, PayBox's is its official App Store icon). An
// unrecognized provider falls back to a neutral gift icon at the call site.
export const GIFT_BRAND: Record<string, { icon: string; label: string }> = {
  bit: { icon: '/brands/bit.png', label: 'שליחת מתנה ב־bit' },
  paybox: { icon: '/brands/paybox.png', label: 'שליחת מתנה ב־PayBox' },
};

// The RPC/DB may type event_type as string|null; narrow to the enum (defensive —
// the DB column IS the enum, so this only guards impossible data).
export function asEventType(value: string | null): EventType {
  return (EVENT_TYPES as readonly string[]).includes(value ?? '')
    ? (value as EventType)
    : 'other';
}

// All parts pinned to Israel time: these are PUBLIC pages — a guest opening the
// link abroad (or a server/browser TZ mismatch during hydration) must still see
// the event's Israel date, never their device's local calendar day.
const weekdayFmt = new Intl.DateTimeFormat(ISRAEL_LOCALE, {
  timeZone: ISRAEL_TIME_ZONE,
  weekday: 'long',
});

// "יום ראשון, כ״ז בתמוז תשפ״ו · 12.07.2026 · 17:30" — the same language the
// guest already saw in the WhatsApp invitation (Hebrew date included for every
// event type, exactly like template slot {{5}}). Time appears only when one was
// actually set. Hebrew-calendar ICU is wrapped defensively — an exotic browser
// without it still gets the Gregorian line.
export function formatEventDateLine(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const parts: string[] = [];
  let hebrew = '';
  try {
    hebrew = formatIsraelHebrewDate(ms);
  } catch {
    hebrew = '';
  }
  parts.push(hebrew ? `${weekdayFmt.format(ms)}, ${hebrew}` : weekdayFmt.format(ms));
  parts.push(formatIsraelDate(ms));
  if (ilTimeInputValue(value) !== '') parts.push(formatIsraelTime(ms));
  return parts.join(' · ');
}
