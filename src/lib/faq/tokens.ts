// Pure token substitution for admin-editable FAQ copy. No DB, no I/O — takes
// the SAME BusinessFacts the price card renders (buildBusinessFacts(), see
// src/lib/fleet/business-facts.ts) so a live-data token inside an admin-typed
// answer (e.g. "שולחים הזמנות ב־{{channels_list}}") is always resolved from
// the canonical package row, never a value an admin typed and could later
// strand.
//
// `{{double_brace}}` syntax and the replace mechanics are the SAME mechanism
// the agreement template uses (src/lib/agreements/template.ts), via the
// shared core in src/lib/text/substitute-tokens.ts — there is exactly one
// `{{token}}` engine in the app, not two that could drift in escaping or
// regex behavior. Token names are snake_case matching the `packages` columns
// they read from (base_price, included_reached, price_per_reached), not the
// agreement template's camelCase — chosen so whoever is typing FAQ content
// can read the token name straight off the source column.

import { CHANNEL_LABELS } from '@/lib/agreements/template';
import { substituteTokens } from '@/lib/text/substitute-tokens';
import type { BusinessFacts } from '@/lib/fleet/business-facts';

export const FAQ_TOKEN_NAMES = [
  'base_price',
  'included_reached',
  'price_per_reached',
  'channels_list',
  'outreach_schedule',
] as const;
export type FaqTokenName = (typeof FAQ_TOKEN_NAMES)[number];

// Hebrew has a DUAL form: one day is "יום", two is "יומיים" (not "2 ימים"),
// three and up take the plural. A naive `${n} ימים` reads as broken Hebrew at
// n=1 and n=2 — and the live schedule contains both.
function daysBeforeHe(days: number): string {
  if (days <= 0) return 'ביום האירוע';
  if (days === 1) return 'יום לפני';
  if (days === 2) return 'יומיים לפני';
  return `${days.toLocaleString('he-IL')} ימים לפני`;
}

// Renders the cadence from the live package, using ONLY the channel label and
// the day count. It deliberately does NOT name the touchpoints ("הזמנה",
// "תזכורת"): that mapping would be a new hardcoded content table keyed on
// message_key — reintroducing exactly the staleness this token exists to
// remove. Channel + timing is what a customer is actually being promised.
export function formatOutreachScheduleHe(
  schedule: { days_before: number; channel: string }[],
): string {
  return schedule
    .map((tp) => `${CHANNEL_LABELS[tp.channel] ?? tp.channel} ${daysBeforeHe(tp.days_before)}`)
    .join(', ');
}

// Every known token always resolves to SOME string (never left as a bare
// "{{token}}", never renders a misleading "₪0"). `base_price`/`included_reached`
// only mean something under the base+overage model — buildBusinessFacts()
// itself zeroes them out while the gate is off, and quoting "₪0 activation
// fee" there would be false, not merely stale — so under the per-reached
// model (or when facts are unavailable) they resolve to '' and quietly drop
// out of the sentence instead. `price_per_reached` and `channels_list` are
// meaningful under either model (or '', only when facts are unavailable).
export function buildFaqTokenValues(facts: BusinessFacts): Record<FaqTokenName, string> {
  const baseOverageActive = facts.available && facts.model === 'base_overage';
  return {
    base_price: baseOverageActive ? `₪${facts.base_price ?? 0}` : '',
    included_reached: baseOverageActive ? String(facts.included_reached ?? 0) : '',
    price_per_reached: facts.available ? `₪${facts.per_reached_price ?? 0}` : '',
    channels_list:
      facts.available && facts.channels && facts.channels.length > 0
        ? facts.channels.map((ch) => CHANNEL_LABELS[ch] ?? ch).join(', ')
        : '',
    // Same rule as the rest: resolve to '' rather than assert a cadence we
    // cannot read. An empty schedule drops out of the sentence instead of
    // promising a timetable the engine would not run.
    outreach_schedule:
      facts.available && facts.outreach_schedule && facts.outreach_schedule.length > 0
        ? formatOutreachScheduleHe(facts.outreach_schedule)
        : '',
  };
}

// Thin re-export of the shared `{{token}}` engine (src/lib/text/substitute-tokens.ts)
// under the FAQ-specific name existing call sites already use. A token NOT
// present as a key in `values` (i.e. not one of the four known names above —
// a typo) is left as-is: visible in an admin preview/review instead of
// silently vanishing, which would hide the authoring mistake.
export const substituteFaqTokens = substituteTokens;
