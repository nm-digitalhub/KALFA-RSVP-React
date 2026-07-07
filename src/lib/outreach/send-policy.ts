// The WhatsApp SEND-TIMING policy for Israel — ONE validated value (persisted
// in app_settings as `whatsapp_send_policy`). No 09:00/20:30/12:00/span literals
// scattered across worker/actions/helpers: every send-timing decision reads
// from here. Pure + dependency-light (Zod only) so the pg-boss worker can bundle
// it. See docs/whatsapp-send-timing-implementation-plan-2026-07-07.md §7–§8.

import { z } from 'zod';

// 'HH:MM' 24h.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'שעה לא תקינה (HH:MM)');

// A local daily send window, or null = no send that weekday (Shabbat is also
// blocked by the Jewish-calendar layer independently).
const windowSchema = z
  .object({ start: hhmm, end: hhmm })
  .strict()
  .nullable();

export const sendPolicySchema = z
  .object({
    // index 0 = Sunday … 6 = Saturday (matches Date/Intl weekday numbering).
    weekday: z.array(windowSchema).length(7),
    // Absolute latest send, applied ON TOP of the weekday end (and the
    // post-Shabbat resume window). An admin may not push a window past this.
    hardCap: hhmm,
    // Motzaei-Shabbat/chag resume opens this many minutes after havdalah.
    motzashPlusMin: z.number().int().min(0).max(180),
    // Preferred send time-of-day per reminder, keyed by days_before.
    preferredTimeByDaysBefore: z.record(z.string(), hhmm),
    defaultPreferred: hhmm,
    // Deterministic fan-out span (ms) applied within the send window.
    spreadSpanMs: z
      .number()
      .int()
      .min(0)
      .max(6 * 60 * 60 * 1000),
    // v1: a single fixed location for candle-lighting/havdalah zmanim. Future:
    // per-event venue city/coords.
    location: z.literal('jerusalem'),
  })
  .strict();

export type SendPolicy = z.infer<typeof sendPolicySchema>;

export function hhmmToMin(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

// Owner-specified v1 defaults (§8): Sun–Thu 09:00–20:30 (hard cap 21:00),
// Fri 09:00–12:00, Sat none; 7-day reminder 11:00, 3-day 17:30; 90-min spread.
export const DEFAULT_SEND_POLICY: SendPolicy = {
  weekday: [
    { start: '09:00', end: '20:30' }, // Sun
    { start: '09:00', end: '20:30' }, // Mon
    { start: '09:00', end: '20:30' }, // Tue
    { start: '09:00', end: '20:30' }, // Wed
    { start: '09:00', end: '20:30' }, // Thu
    { start: '09:00', end: '12:00' }, // Fri (morning only)
    null, // Sat
  ],
  hardCap: '21:00',
  motzashPlusMin: 60,
  preferredTimeByDaysBefore: { '7': '11:00', '3': '17:30', '1': '11:00' },
  defaultPreferred: '11:00',
  spreadSpanMs: 90 * 60 * 1000,
  location: 'jerusalem',
};

// Hard ceilings — an admin may NARROW within these, never widen past them.
// Opening night/Shabbat sends requires a conscious code change, not a setting.
const DAY_MIN = hhmmToMin('09:00');
const WEEKDAY_MAX = hhmmToMin('20:30');
const FRIDAY_MAX = hhmmToMin('12:00');
const HARDCAP_MAX = hhmmToMin('21:00');
const MOTZASH_MIN = 60;

// Validate shape THEN enforce the safety guardrails.
export function parseSendPolicy(raw: unknown): SendPolicy {
  const p = sendPolicySchema.parse(raw);
  const cap = hhmmToMin(p.hardCap);
  if (cap > HARDCAP_MAX) throw new Error('hardCap לא יכול לעבור 21:00');
  if (p.motzashPlusMin < MOTZASH_MIN)
    throw new Error('motzashPlusMin לא יכול לרדת מתחת ל-60');
  // Saturday (index 6) MUST be null; a null on any other day is a policy error.
  if (p.weekday[6] !== null) throw new Error('שבת (יום 6) חייבת להיות null');
  for (let d = 0; d <= 5; d++) {
    const w = p.weekday[d];
    if (!w) throw new Error(`יום ${d} חייב חלון שליחה (רק שבת יכולה להיות null)`);
    const s = hhmmToMin(w.start);
    const e = hhmmToMin(w.end);
    if (s >= e) throw new Error('חלון שליחה לא תקין: start חייב להיות לפני end');
    if (s < DAY_MIN) throw new Error('חלון שליחה לא יכול להתחיל לפני 09:00');
    const maxEnd = d === 5 ? FRIDAY_MAX : WEEKDAY_MAX;
    if (e > maxEnd)
      throw new Error(
        d === 5 ? 'יום ו לא יכול לעבור 12:00' : 'ימים א-ה לא יכולים לעבור 20:30',
      );
    if (e > cap) throw new Error('חלון שליחה חורג מהגבול הקשיח (hardCap)');
  }
  return p;
}

// The preferred send time-of-day (minutes-from-midnight) for a touchpoint.
export function preferredMinutes(policy: SendPolicy, daysBefore: number): number {
  const hh =
    policy.preferredTimeByDaysBefore[String(daysBefore)] ?? policy.defaultPreferred;
  return hhmmToMin(hh);
}
