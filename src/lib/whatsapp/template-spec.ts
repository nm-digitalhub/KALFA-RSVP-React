// Send-time parameter binding for the approved WhatsApp templates — the module
// promised by migration 202606300037 (message_templates.components). PURE
// functions only (no I/O, no `server-only`) so the full contract is unit-
// testable; the outreach engine / manual send path supply the event row and
// guest name and pass the result to the client's body components.
//
// The positional contract ({{1}}..{{7}}) is FIXED — it is what was submitted
// to and approved by Meta (docs/whatsapp-templates-meta-submission.md):
//
//   | # | generic family (kalfa_event_*)   | wedding family (kalfa_wedding_*) |
//   |---|----------------------------------|----------------------------------|
//   | 1 | guest first name                 | guest first name                 |
//   | 2 | EVENT_TYPE_LABELS[event_type]    | groom full name                  |
//   | 3 | celebrant names text             | bride full name                  |
//   | 4 | weekday (Hebrew, Asia/Jerusalem) | same                             |
//   | 5 | date (dd.MM.yyyy)                | same                             |
//   | 6 | time (HH:mm)                     | same                             |
//   | 7 | venue_name + ", " + venue_address| same                             |
//
// Fail-closed: a template send with ANY empty parameter is a Meta API error
// (and a broken message even when it isn't), so instead of ever emitting an
// empty string this returns `{ missing }` with stable keys — the caller skips
// the send and records `params_incomplete` in the outreach failure sink.

import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import {
  CELEBRANT_KIND_BY_EVENT_TYPE,
  celebrantsCompleteFor,
  type CelebrantFieldKey,
} from '@/lib/validation/schemas';
import type { Database, Json } from '@/lib/supabase/types';
import { ISRAEL_TIME_ZONE } from '@/lib/date';

type EventRow = Database['public']['Tables']['events']['Row'];
type EventType = Database['public']['Enums']['event_type'];

// Which template family the resolved template name belongs to. The generic
// family works for all nine event types; `wedding` is selected data-driven via
// message_templates.components.variants (resolveTemplateForEvent) — never
// hardcoded here.
export type TemplateFamily = 'generic' | 'wedding';

// Exactly the event columns the builder needs — matches what the engine's
// getCampaignContext select is being widened to. `name` rides along for the
// callers' context type even though no position renders it (the celebrant
// names, not the free-text event name, are the approved {{2}}/{{3}} sources).
export type TemplateParamsContext = {
  event: Pick<
    EventRow,
    'name' | 'event_type' | 'event_date' | 'venue_name' | 'venue_address' | 'celebrants'
  >;
  guestFirstName: string | null;
};

// The seven positional body parameters, index i ↔ {{i+1}}. A tuple so "exactly
// 7, all present" is a compile-time fact for callers building BodyParameters.
export type TemplateParams = [string, string, string, string, string, string, string];

// Stable vocabulary for what blocked the build — recorded (not guest data) in
// the failure sink, so keys must stay machine-readable and PII-free.
// - 'celebrants'          generic {{3}}: stored value incomplete for the kind
// - 'celebrants.groom'    wedding {{2}} absent
// - 'celebrants.bride'    wedding {{3}} absent
// - 'event_date'          {{4}}–{{6}}: date null or unparseable
// - 'venue_name'          {{7}}: required part of the venue line absent
// guestFirstName is never missing — {{1}} falls back (decision in the plan:
// a generic greeting beats losing the touchpoint).
export type MissingParamKey =
  | 'celebrants'
  | 'celebrants.groom'
  | 'celebrants.bride'
  | 'event_date'
  | 'venue_name';

export type TemplateParamsResult = { params: TemplateParams } | { missing: MissingParamKey[] };

// {{1}} fallback when the contact has no linked guest name, or when the guest
// row is a household ("משפחת כהן") whose first token would greet awkwardly.
// Wording is the owner's decision (2026-07-05): a warm generic greeting beats
// a wrong personal one.
export const GUEST_FIRST_NAME_FALLBACK = 'משפחה וחברים יקרים';

// Shared {{1}} derivation for BOTH send paths (manual + worker engine): the
// first whitespace token of the linked guest's full name, except household
// rows ("משפחת כהן") whose bare first token would greet "שלום משפחת," — those
// return null so buildTemplateParams falls back to the generic greeting.
export function deriveGuestFirstName(
  fullName: string | null | undefined,
): string | null {
  const firstToken = fullName?.trim().split(/\s+/)[0] || null;
  return firstToken === 'משפחת' ? null : firstToken;
}

// All date-derived positions render in Israel local time regardless of server
// TZ — same anchor as the event-lifecycle day math (event-date.ts).
const ISRAEL_TZ = ISRAEL_TIME_ZONE;

// Module-level formatters (construction is expensive; the engine calls this
// per recipient). Verified against the installed ICU: weekday long is
// "יום שני" (prefix stripped below), 2-digit day/month gives dd.MM.yyyy with
// plain ASCII digits/dots, and hourCycle h23 renders midnight as "00:30".
const weekdayFmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: ISRAEL_TZ,
  weekday: 'long',
});
const dateFmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: ISRAEL_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: ISRAEL_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// he-IL long weekdays all arrive as "יום <שם>" — the approved template bodies
// already say "ביום {{4}}", so the prefix must go or the message reads
// "ביום יום שני".
const WEEKDAY_PREFIX_RE = /^יום /;

// --- Hebrew (Jewish) calendar date -------------------------------------------
// ICU does ALL the calendar math (Intl with calendar:'hebrew' — no hand-rolled
// algorithm); this layer only renders the numbers in traditional Hebrew
// letters (a numeral PRESENTATION, not a computation: 27→כ״ז, 5786→תשפ״ו,
// with the טו/טז exceptions). Fixtures pinned against hebcal.com (2026-07-12 =
// כ״ז בתמוז תשפ״ו; 2026-09-12 = א׳ בתשרי תשפ״ז). Day boundary follows the
// Israel CIVIL day — no sunset adjustment (an evening event after שקיעה is
// still labeled with the civil day's Hebrew date; computing sunset would need
// a location fix and is out of scope).
const hebrewPartsFmt = new Intl.DateTimeFormat('he', {
  timeZone: ISRAEL_TZ,
  calendar: 'hebrew',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const GEMATRIA_UNITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const GEMATRIA_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const GEMATRIA_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

function gematria(n: number): string {
  let s = GEMATRIA_HUNDREDS[Math.floor(n / 100)] ?? '';
  const rem = n % 100;
  // 15/16 are always written טו/טז — never spelled with י״ה/י״ו.
  if (rem === 15) s += 'טו';
  else if (rem === 16) s += 'טז';
  else s += GEMATRIA_TENS[Math.floor(rem / 10)] + GEMATRIA_UNITS[rem % 10];
  return s.length === 1 ? `${s}׳` : `${s.slice(0, -1)}״${s.slice(-1)}`;
}

// "כ״ז בתמוז תשפ״ו" for an instant, in Israel local time.
export function formatHebrewDateIL(ms: number): string {
  const parts = hebrewPartsFmt.formatToParts(ms);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '';
  const day = Number(get('day'));
  const month = get('month');
  const year = Number(get('year')) % 1000;
  return `${gematria(day)} ב${month} ${gematria(year)}`;
}

// Defensive read of one celebrant field from the RAW jsonb column (Json|null —
// could be null, a string, an array, or a stale other-kind object after an
// event_type change). Whitespace-only never counts as filled.
function readCelebrantField(celebrants: Json | null, key: CelebrantFieldKey): string | null {
  if (typeof celebrants !== 'object' || celebrants === null || Array.isArray(celebrants)) {
    return null;
  }
  const raw = celebrants[key];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value || null;
}

// Generic {{3}}: the celebrant-names text per the approved shapes. Kind and
// completeness come from schemas.ts (CELEBRANT_KIND_BY_EVENT_TYPE /
// celebrantsCompleteFor) — the shape rules are NOT duplicated here; this only
// renders text once the stored value passes the kind's completeness schema.
function genericCelebrantsText(eventType: EventType, celebrants: Json | null): string | null {
  if (!celebrantsCompleteFor(eventType, celebrants)) return null;
  const kind = CELEBRANT_KIND_BY_EVENT_TYPE[eventType];
  switch (kind) {
    case 'couple': {
      const groom = readCelebrantField(celebrants, 'groom');
      const bride = readCelebrantField(celebrants, 'bride');
      return groom && bride ? `${groom} ו־${bride}` : null;
    }
    case 'single':
      return readCelebrantField(celebrants, 'name');
    case 'parents': {
      const parents = readCelebrantField(celebrants, 'parents');
      if (!parents) return null;
      // child stays optional at the gate (celebrantsCompleteFor) — rendered
      // only when actually filled.
      const child = readCelebrantField(celebrants, 'child');
      return child ? `${parents} — לכבוד ${child}` : parents;
    }
    case 'free':
      return readCelebrantField(celebrants, 'names');
  }
}

// --- Gift-reminder template (kalfa_event_gift_v1, submitted 2026-07-05) -----
// Positional contract {{1}}..{{4}}:
//   {{1}} guest first name (falls back like the invite families)
//   {{2}} EVENT_TYPE_LABELS[event_type]
//   {{3}} celebrant names text (same per-kind rules as the generic family)
//   {{4}} the owner's gift link (PayBox/Bit URL — per-event data)
// The template also carries a URL button whose variable is the event's
// gift_link_token (appended to https://beta.kalfa.me/g/…) — passed to the
// client separately as urlButtonParam, NOT part of the body tuple.
// Structural event type on purpose: the gift columns land with a pending
// migration, so this stays decoupled from the generated Row type (same
// forward-compat stance as getCampaignHoldsEnabled).
export type GiftParamsContext = {
  event: {
    event_type: EventType;
    celebrants: Json | null;
    gift_payment_url: string | null;
  };
  guestFirstName: string | null;
};

export type GiftMissingParamKey = 'celebrants' | 'gift_payment_url';

export type GiftParamsResult =
  | { params: [string, string, string, string] }
  | { missing: GiftMissingParamKey[] };

export function buildGiftParams(ctx: GiftParamsContext): GiftParamsResult {
  const { event, guestFirstName } = ctx;
  const missing: GiftMissingParamKey[] = [];

  const guest = guestFirstName?.trim() || GUEST_FIRST_NAME_FALLBACK;
  const label = EVENT_TYPE_LABELS[event.event_type];
  const celebrantsText = genericCelebrantsText(event.event_type, event.celebrants);
  if (!celebrantsText) missing.push('celebrants');

  // https-only guard mirrors the DB CHECK — never emit a non-https link into
  // an outbound message even if a raw value slipped past the boundary.
  const giftUrl = event.gift_payment_url?.trim() || null;
  if (!giftUrl || !/^https:\/\//i.test(giftUrl)) missing.push('gift_payment_url');

  if (missing.length > 0 || !celebrantsText || !giftUrl) return { missing };
  return { params: [guest, label, celebrantsText, giftUrl] };
}

// Build the seven positional parameters for one recipient, or report exactly
// which ingredients are absent (in position order, each key at most once).
export function buildTemplateParams(
  family: TemplateFamily,
  ctx: TemplateParamsContext,
): TemplateParamsResult {
  const { event, guestFirstName } = ctx;
  const missing: MissingParamKey[] = [];

  // {{1}} — never blocks: fall back to the generic greeting.
  const guest = guestFirstName?.trim() || GUEST_FIRST_NAME_FALLBACK;

  // {{2}}/{{3}} — per family. The generic {{2}} label map is exhaustive over
  // the event_type enum (compile-time), so only celebrants can be missing.
  let honoree: string | null;
  let celebrantsText: string | null;
  if (family === 'wedding') {
    honoree = readCelebrantField(event.celebrants, 'groom');
    celebrantsText = readCelebrantField(event.celebrants, 'bride');
    if (!honoree) missing.push('celebrants.groom');
    if (!celebrantsText) missing.push('celebrants.bride');
  } else {
    honoree = EVENT_TYPE_LABELS[event.event_type];
    celebrantsText = genericCelebrantsText(event.event_type, event.celebrants);
    if (!celebrantsText) missing.push('celebrants');
  }

  // {{4}}–{{6}} — all three derive from event_date (timestamptz), rendered in
  // Israel local time; one missing key covers the trio.
  const eventMs = event.event_date ? Date.parse(event.event_date) : Number.NaN;
  let weekday: string | null = null;
  let date: string | null = null;
  let time: string | null = null;
  if (Number.isNaN(eventMs)) {
    missing.push('event_date');
  } else {
    weekday = weekdayFmt.format(eventMs).replace(WEEKDAY_PREFIX_RE, '');
    // {{5}} carries BOTH calendars in one approved slot — "כ״ז בתמוז תשפ״ו
    // (12.07.2026)" — so every existing template (invite/reminders/final,
    // both families) gains the Hebrew date with NO Meta resubmission: the
    // positional contract is unchanged, only the value we bind is richer.
    date = `${formatHebrewDateIL(eventMs)} (${dateFmt.format(eventMs)})`;
    time = timeFmt.format(eventMs);
  }

  // {{7}} — venue_name required, venue_address appended when present.
  const venueName = event.venue_name?.trim() || null;
  const venueAddress = event.venue_address?.trim() || null;
  let venue: string | null = null;
  if (!venueName) {
    missing.push('venue_name');
  } else {
    venue = venueAddress ? `${venueName}, ${venueAddress}` : venueName;
  }

  // Every null above pushed its key, so the null re-checks only narrow types —
  // and double as the "never emit an empty param" guarantee.
  if (missing.length > 0 || !honoree || !celebrantsText || !weekday || !date || !time || !venue) {
    return { missing };
  }
  return { params: [guest, honoree, celebrantsText, weekday, date, time, venue] };
}
