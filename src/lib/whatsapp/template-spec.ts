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

// {{1}} fallback when the contact has no linked guest name.
export const GUEST_FIRST_NAME_FALLBACK = 'אורחים יקרים';

// All date-derived positions render in Israel local time regardless of server
// TZ — same anchor as the event-lifecycle day math (event-date.ts).
const ISRAEL_TZ = 'Asia/Jerusalem';

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
    date = dateFmt.format(eventMs);
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
