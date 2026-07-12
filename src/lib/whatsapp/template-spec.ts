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
  type HostComposition,
} from '@/lib/validation/schemas';
import type { Database, Json } from '@/lib/supabase/types';
import {
  ISRAEL_TIME_ZONE,
  formatIsraelHebrewDate,
  formatIsraelWeekday,
} from '@/lib/date';

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
// per recipient). 2-digit day/month gives dd.MM.yyyy with plain ASCII
// digits/dots, and hourCycle h23 renders midnight as "00:30". Weekday and the
// Hebrew-calendar date come from src/lib/date.ts (formatIsraelWeekday /
// formatIsraelHebrewDate).
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

// Event-day reminder to CONFIRMED guests + Bit payment (message_key
// 'event_day_pay'). Deliberately NO name and NO celebrants: the greeting is the
// fixed literal "חברים ומשפחה יקרים" baked into every approved body, and "היום"
// is literal too — so only two positional values vary: {{1}} time, {{2}} venue.
// The Bit link is NOT a body param; it rides the URL button (event.gift_link_token,
// resolved at /g/[token]) exactly like the gift template. Fail-closed: never emit
// an empty positional.
// Post-event message keys — the ONLY message_keys the outreach send-gate
// (outreach.ts) lets through AFTER the event day has passed (L1 otherwise
// blocks every send fail-closed). Single source of truth so a future
// post-event key is one Set entry, not a second `isPastEventDay` carve-out.
export const POST_EVENT_MESSAGE_KEYS = new Set(['thankyou']);

// message_keys whose approved template body was classified MARKETING by Meta
// (verified live via Graph API `previous_category` — thank-you copy is
// non-transactional, so Meta always classifies it MARKETING; there is no
// UTILITY path for it). Routed through the MM Lite `/marketing_messages`
// endpoint (sendWhatsAppMarketingTemplate) instead of `/messages` — same
// mild-optimization stance as the plan (docs/plans not duplicated here):
// MM Lite optimizes delivery WITHIN the 131049 marketing-frequency cap, it
// does not lift the cap. No `category` column exists on message_templates, so
// (like POST_EVENT_MESSAGE_KEYS) routing is by message_key, not DB data.
export const MARKETING_MESSAGE_KEYS = new Set(['thankyou']);

// Post-event thank-you (message_key 'thankyou'). Deliberately NO venue/date —
// the event already happened, so those positions would only ever be stale.
// Same max-deliverability stance as buildEventDayReminderParams: the greeting
// is a fixed literal in every approved body ("חברים ומשפחה יקרים"), only the
// event-type label + celebrant names vary. {{1}} label, {{2}} celebrant names.
export function buildThankyouParams(
  ctx: TemplateParamsContext,
): { params: [string, string] } | { missing: MissingParamKey[] } {
  const { event } = ctx;
  const label = EVENT_TYPE_LABELS[event.event_type];
  const celebrantsText = genericCelebrantsText(event.event_type, event.celebrants);
  if (!celebrantsText) return { missing: ['celebrants'] };
  return { params: [label, celebrantsText] };
}

export function buildEventDayReminderParams(
  ctx: TemplateParamsContext,
): { params: [string, string] } | { missing: MissingParamKey[] } {
  const { event } = ctx;
  const missing: MissingParamKey[] = [];

  const eventMs = event.event_date ? Date.parse(event.event_date) : Number.NaN;
  let time: string | null = null;
  if (Number.isNaN(eventMs)) missing.push('event_date');
  else time = timeFmt.format(eventMs);

  const venueName = event.venue_name?.trim() || null;
  const venueAddress = event.venue_address?.trim() || null;
  let venue: string | null = null;
  if (!venueName) missing.push('venue_name');
  else venue = venueAddress ? `${venueName}, ${venueAddress}` : venueName;

  if (missing.length > 0 || !time || !venue) return { missing };
  return { params: [time, venue] };
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
    weekday = formatIsraelWeekday(eventMs);
    // {{5}} carries BOTH calendars in one approved slot — "כ״ז בתמוז תשפ״ו
    // (12.07.2026)" — so every existing template (invite/reminders/final,
    // both families) gains the Hebrew date with NO Meta resubmission: the
    // positional contract is unchanged, only the value we bind is richer.
    date = `${formatIsraelHebrewDate(eventMs)} (${dateFmt.format(eventMs)})`;
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

// --- Personal brit templates (kalfa_brit_invite_trad_v4 / reminder / thankyou)
// A DIFFERENT positional contract from the generic 7-tuple: {{1}} is a whole
// FIRST-PERSON sentence composed from host_composition (NOT the guest name),
// the Hebrew and Gregorian dates are SEPARATE slots (the generic {{5}} combines
// them), and the invite adds a first-person closing {{7}}. One template serves
// every family structure because the system composes the conjugated sentence.
// The wording MIRRORS the Meta-approved bodies — changing it here without
// resubmitting the template would desync the rendered message from the layout.
type BritPhrasing = {
  // First-person opening (NO name — the host signs at the end); conjugation per
  // composition. The closing carries the host SIGNATURE (בעלת/בעל השמחה) on its
  // own line, owner-approved: "<opening> … <closing>\n<host name>".
  invite: string;
  reminder: string;
  closing: (host: string) => string;
  thanks: string;
};

const BRIT_PHRASING: Record<HostComposition, BritPhrasing> = {
  single_mother: {
    invite: 'מתכבדת להזמינכם לשמחת בריתו של בני.',
    reminder: 'רציתי להזכיר לכם בשמחה — שמחת ברית בני מתקרבת.',
    closing: (host) => `אשמח לראותכם בשמחתי. ${host}`,
    thanks: 'מעומק הלב — תודה שבאתם לחגוג עמי את שמחת ברית בני.',
  },
  single_father: {
    invite: 'מתכבד להזמינכם לשמחת בריתו של בני.',
    reminder: 'רציתי להזכיר לכם בשמחה — שמחת ברית בני מתקרבת.',
    closing: (host) => `אשמח לראותכם בשמחתי. ${host}`,
    thanks: 'מעומק הלב — תודה שבאתם לחגוג עמי את שמחת ברית בני.',
  },
  couple: {
    invite: 'מתכבדים להזמינכם לשמחת בריתו של בננו.',
    reminder: 'רצינו להזכיר לכם בשמחה — שמחת ברית בננו מתקרבת.',
    closing: (host) => `נשמח לראותכם בשמחתנו. ${host}`,
    thanks: 'מעומק הלב — תודה שבאתם לחגוג עמנו את שמחת ברית בננו.',
  },
};

// A brit builder's output — a readonly positional array (arity varies per
// template) or the missing-ingredient keys: same fail-closed contract as the
// generic builder (never emit an empty positional).
export type BritParamsResult =
  | { params: readonly string[] }
  | { missing: MissingParamKey[] };

// host_composition drives the phrasing; it is REQUIRED at the campaign gate
// (celebrantsCompleteFor for the 'parents' kind), re-read defensively here from
// the raw jsonb so a stale/invalid value fails closed instead of mis-conjugating.
function britPhrasingFor(celebrants: Json | null): BritPhrasing | null {
  const hc = readCelebrantField(celebrants, 'host_composition');
  return hc && hc in BRIT_PHRASING ? BRIT_PHRASING[hc as HostComposition] : null;
}

// Shared date + venue slots for the invite/reminder layouts: [weekday,
// Hebrew date, Gregorian date, time, venue] — the Hebrew and Gregorian dates
// are SEPARATE positions here (unlike the combined generic {{5}}).
function britDateVenueParts(
  event: TemplateParamsContext['event'],
): { parts: [string, string, string, string, string] } | { missing: MissingParamKey[] } {
  const missing: MissingParamKey[] = [];
  const eventMs = event.event_date ? Date.parse(event.event_date) : Number.NaN;
  let weekday = '';
  let hebrew = '';
  let gregorian = '';
  let time = '';
  if (Number.isNaN(eventMs)) {
    missing.push('event_date');
  } else {
    weekday = formatIsraelWeekday(eventMs);
    hebrew = formatIsraelHebrewDate(eventMs);
    gregorian = dateFmt.format(eventMs);
    time = timeFmt.format(eventMs);
  }
  const venueName = event.venue_name?.trim() || null;
  const venueAddress = event.venue_address?.trim() || null;
  let venue = '';
  if (!venueName) missing.push('venue_name');
  else venue = venueAddress ? `${venueName}, ${venueAddress}` : venueName;

  if (missing.length > 0 || !weekday || !hebrew || !gregorian || !time || !venue) {
    return { missing };
  }
  return { parts: [weekday, hebrew, gregorian, time, venue] };
}

// kalfa_brit_invite_trad_v4 / _media_v4 — 7 slots: {{1}} first-person opening,
// {{2}} weekday, {{3}} Hebrew date, {{4}} Gregorian date, {{5}} time,
// {{6}} venue, {{7}} first-person closing.
export function buildBritTradInviteParams(ctx: TemplateParamsContext): BritParamsResult {
  const phrasing = britPhrasingFor(ctx.event.celebrants);
  // The closing SIGNS with the host name (בעלת/בעל השמחה) — REQUIRED, per the owner.
  const host = readCelebrantField(ctx.event.celebrants, 'parents');
  const dv = britDateVenueParts(ctx.event);
  if (!phrasing || !host || 'missing' in dv) {
    const missing: MissingParamKey[] = [];
    if (!phrasing || !host) missing.push('celebrants');
    if ('missing' in dv) missing.push(...dv.missing);
    return { missing };
  }
  const [weekday, hebrew, gregorian, time, venue] = dv.parts;
  return {
    params: [phrasing.invite, weekday, hebrew, gregorian, time, venue, phrasing.closing(host)],
  };
}

// kalfa_brit_reminder_trad_v1 / _media_v1 — 6 slots: {{1}} first-person reminder
// line, {{2}}–{{6}} weekday / Hebrew date / Gregorian date / time / venue.
export function buildBritTradReminderParams(ctx: TemplateParamsContext): BritParamsResult {
  const phrasing = britPhrasingFor(ctx.event.celebrants);
  const dv = britDateVenueParts(ctx.event);
  if (!phrasing || 'missing' in dv) {
    const missing: MissingParamKey[] = [];
    if (!phrasing) missing.push('celebrants');
    if ('missing' in dv) missing.push(...dv.missing);
    return { missing };
  }
  return { params: [phrasing.reminder, ...dv.parts] };
}

// kalfa_brit_thankyou_trad_v1 — 2 slots: {{1}} first-person thanks line, {{2}}
// family signature ("משפחת <surname>", surname = last token of the parents
// field). POST-EVENT: the SEND path is deferred (the drip engine rejects
// post-event touchpoints); this builder is ready for a future post-event trigger.
export function buildBritTradThankyouParams(ctx: TemplateParamsContext): BritParamsResult {
  const phrasing = britPhrasingFor(ctx.event.celebrants);
  const parents = readCelebrantField(ctx.event.celebrants, 'parents');
  if (!phrasing || !parents) return { missing: ['celebrants'] };
  const surname = parents.trim().split(/\s+/).pop() ?? parents;
  return { params: [phrasing.thanks, `משפחת ${surname}`] };
}

// The SINGLE body-parameter dispatch point for all three send sites (manual
// batch + the two worker paths). Routing is DATA-DRIVEN by the resolved
// template's paramContract (message_templates.components.param_contract): a
// recognized contract binds the matching personal builder, everything else
// falls back to the frozen generic/wedding 7-tuple. Collapses what used to be a
// `name.startsWith('kalfa_wedding_')` branch duplicated across the three sites,
// so a new contract is taught here once.
export function buildBodyParams(args: {
  paramContract: string | null | undefined;
  family: TemplateFamily;
  ctx: TemplateParamsContext;
}): { params: readonly string[] } | { missing: MissingParamKey[] } {
  switch (args.paramContract) {
    case 'brit_trad_invite':
      return buildBritTradInviteParams(args.ctx);
    case 'brit_trad_reminder':
      return buildBritTradReminderParams(args.ctx);
    case 'event_day_pay':
      return buildEventDayReminderParams(args.ctx);
    case 'thankyou':
      return buildThankyouParams(args.ctx);
    default:
      return buildTemplateParams(args.family, args.ctx);
  }
}
