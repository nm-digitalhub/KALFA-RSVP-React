import {
  Baby,
  Cake,
  Gem,
  Heart,
  PartyPopper,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { CELEBRANT_KIND_BY_EVENT_TYPE } from '@/lib/validation/schemas';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import type { Enums, Json } from '@/lib/supabase/types';
type EventType = Enums<'event_type'>;

// The single per-event-type DISPLAY composer for celebrant names — used by the
// owner's event page AND the public RSVP page. Pure + isomorphic (client and
// server). Kind rules come from CELEBRANT_KIND_BY_EVENT_TYPE (never duplicated
// here); the WhatsApp wording in template-spec.ts stays separate on purpose —
// that text is frozen by Meta template approval.
//
// celebrants is schemaless jsonb, so every read is defensive: partial data
// renders partially, wrong shapes render nothing — display never throws.

function field(celebrants: Json | null, key: string): string | null {
  if (
    !celebrants ||
    typeof celebrants !== 'object' ||
    Array.isArray(celebrants)
  ) {
    return null;
  }
  const v = (celebrants as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * The names text per the type's celebrant kind, or null when nothing usable
 * is stored: couple "X וY" (either alone renders alone), single "X",
 * parents "X — לכבוד Y" (child optional), free "X".
 */
export function celebrantsTextFor(
  eventType: EventType,
  celebrants: Json | null,
): string | null {
  switch (CELEBRANT_KIND_BY_EVENT_TYPE[eventType]) {
    case 'couple': {
      const groom = field(celebrants, 'groom');
      const bride = field(celebrants, 'bride');
      return groom && bride ? `${groom} ו${bride}` : (groom ?? bride);
    }
    case 'single':
      return field(celebrants, 'name');
    case 'parents': {
      const parents = field(celebrants, 'parents');
      const child = field(celebrants, 'child');
      return parents && child ? `${parents} — לכבוד ${child}` : parents;
    }
    case 'free':
      return field(celebrants, 'names');
  }
}

/**
 * The individual name tokens of celebrantsTextFor, in display order and
 * spelled exactly as they appear in that text (the couple's second name keeps
 * its "ו" prefix, so a token is a substring of the composed text). Used by the
 * heading renderers to keep each person's full name on one line. Never
 * changes the text itself — calendar titles, ICS files and Exchange items keep
 * receiving the plain string from eventHeadingFor.
 */
export function celebrantNamesFor(
  eventType: EventType,
  celebrants: Json | null,
): string[] {
  switch (CELEBRANT_KIND_BY_EVENT_TYPE[eventType]) {
    case 'couple': {
      const groom = field(celebrants, 'groom');
      const bride = field(celebrants, 'bride');
      if (groom && bride) return [groom, `ו${bride}`];
      return [groom ?? bride].filter((n): n is string => n !== null);
    }
    case 'single':
      return [field(celebrants, 'name')].filter((n): n is string => n !== null);
    case 'parents': {
      const parents = field(celebrants, 'parents');
      const child = field(celebrants, 'child');
      return [parents, child].filter((n): n is string => n !== null);
    }
    case 'free':
      return [field(celebrants, 'names')].filter((n): n is string => n !== null);
  }
}

// Per-type heading: "possessive event label" + names, e.g. "החתונה של דנה
// ויוסי", "בר המצווה של אורי", "יום ההולדת של נועה". Types whose heading
// works better as label-only (brit/britah — the parents go on the secondary
// line, 'other' — free text) map to null here.
const HEADING_OF: Partial<Record<EventType, string>> = {
  wedding: 'החתונה של',
  henna: 'החינה של',
  engagement: 'האירוסין של',
  bar_mitzvah: 'בר המצווה של',
  bat_mitzvah: 'בת המצווה של',
  birthday: 'יום ההולדת של',
};

// Celebratory accent icon per type (lucide — the project's icon set), shown
// next to the heading on the public RSVP page. Presentation only.
export const EVENT_TYPE_ICON: Record<EventType, LucideIcon> = {
  wedding: Heart,
  henna: Sparkles,
  engagement: Gem,
  bar_mitzvah: PartyPopper,
  bat_mitzvah: PartyPopper,
  brit: Baby,
  britah: Baby,
  birthday: Cake,
  other: PartyPopper,
};

export interface EventDisplayHeading {
  /** Main title, e.g. "החתונה של דנה ויוסי" / "ברית" / the raw event name. */
  title: string;
  /** Secondary line, e.g. "ההורים: נטלי קלפה — לכבוד בני" — null when covered by the title. */
  subtitle: string | null;
}

/**
 * Compose the public heading for an event by its type:
 * - possessive types with names → "בר המצווה של אורי" (event name dropped —
 *   it usually repeats the same words);
 * - brit/britah → title "ברית"/"בריתה", parents on the subtitle;
 * - anything without usable names → the owner's event name, unchanged.
 */
export function eventHeadingFor(
  eventType: EventType,
  celebrants: Json | null,
  eventName: string,
): EventDisplayHeading {
  const names = celebrantsTextFor(eventType, celebrants);
  const kind = CELEBRANT_KIND_BY_EVENT_TYPE[eventType];

  if (kind === 'parents') {
    return {
      title: EVENT_TYPE_LABELS[eventType],
      subtitle: names ? `ההורים: ${names}` : null,
    };
  }

  const possessive = HEADING_OF[eventType];
  if (possessive && names) {
    return { title: `${possessive} ${names}`, subtitle: null };
  }

  return {
    title: eventName,
    subtitle: names ? `בעלי השמחה: ${names}` : null,
  };
}

export interface HeadingSegment {
  text: string;
  /** Render with `whitespace-nowrap`: this is one person's full name. */
  noWrap: boolean;
}

// A name longer than this is left breakable: `white-space: nowrap` also
// disables `overflow-wrap`, and a 25+ character name at text-2xl would run
// past a 320px card. Measured 2026-09-08: 24 Hebrew chars at 24px bold ≈ 290px.
const NO_WRAP_MAX_CHARS = 24;

/**
 * eventHeadingFor(...).title split into render segments so that a line break
 * falls BETWEEN people, never inside a name ("החתונה של אייל / מלכה ושלומית
 * קאקון" → "החתונה של / אייל מלכה ושלומית קאקון"). The segments' texts join
 * back to exactly the title (tested) — the sr-only <h1> keeps the plain string.
 */
export function eventHeadingSegmentsFor(
  eventType: EventType,
  celebrants: Json | null,
  eventName: string,
): HeadingSegment[] {
  const { title } = eventHeadingFor(eventType, celebrants, eventName);
  const segments: HeadingSegment[] = [];
  let rest = title;
  for (const name of celebrantNamesFor(eventType, celebrants)) {
    if (name.length > NO_WRAP_MAX_CHARS || !name.includes(' ')) continue;
    const at = rest.indexOf(name);
    if (at < 0) continue;
    if (at > 0) segments.push({ text: rest.slice(0, at), noWrap: false });
    segments.push({ text: name, noWrap: true });
    rest = rest.slice(at + name.length);
  }
  if (rest) segments.push({ text: rest, noWrap: false });
  return segments;
}
