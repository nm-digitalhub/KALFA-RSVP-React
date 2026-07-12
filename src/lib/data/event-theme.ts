// Per-event-type visual theme for the public gift landing page. Isomorphic (no
// `server-only`) — a client or server component can read it. The icon, heading
// and celebrant text come from the canonical composers (celebrant-display.ts /
// event-labels.ts); this module ONLY adds the color accent + celebratory copy.
//
// IMPORTANT: every Tailwind class here MUST be a full static literal string.
// Tailwind v4 scans source files for complete class names — a dynamically
// built class (e.g. `text-${color}-500`) would never be generated.

import type { Database } from '@/lib/supabase/types';

type EventType = Database['public']['Enums']['event_type'];

export interface EventTheme {
  /** Accent text color for the heading icon (full static Tailwind class). */
  accent: string;
  /** Gradient classes for the celebratory banner (full static Tailwind classes). */
  banner: string;
  /** Short celebratory line shown under the heading. */
  greeting: string;
}

export const EVENT_THEME: Record<EventType, EventTheme> = {
  wedding: {
    accent: 'text-rose-500',
    banner: 'bg-gradient-to-b from-rose-100 to-amber-50',
    greeting: 'מזל טוב! הוזמנתם לחגוג עמנו',
  },
  engagement: {
    accent: 'text-pink-500',
    banner: 'bg-gradient-to-b from-pink-100 to-rose-50',
    greeting: 'מזל טוב לאירוסין!',
  },
  henna: {
    accent: 'text-orange-500',
    banner: 'bg-gradient-to-b from-orange-100 to-amber-50',
    greeting: 'ליל חינה שמח!',
  },
  brit: {
    accent: 'text-sky-500',
    banner: 'bg-gradient-to-b from-sky-100 to-sky-50',
    greeting: 'שמחים שאתם חלק מהשמחה',
  },
  britah: {
    accent: 'text-sky-500',
    banner: 'bg-gradient-to-b from-sky-100 to-sky-50',
    greeting: 'שמחים שאתם חלק מהשמחה',
  },
  bar_mitzvah: {
    accent: 'text-violet-500',
    banner: 'bg-gradient-to-b from-violet-100 to-fuchsia-50',
    greeting: 'מזל טוב! חוגגים יחד',
  },
  bat_mitzvah: {
    accent: 'text-violet-500',
    banner: 'bg-gradient-to-b from-violet-100 to-fuchsia-50',
    greeting: 'מזל טוב! חוגגים יחד',
  },
  birthday: {
    accent: 'text-amber-500',
    banner: 'bg-gradient-to-b from-amber-100 to-yellow-50',
    greeting: 'יום הולדת שמח!',
  },
  other: {
    accent: 'text-primary',
    banner: 'bg-gradient-to-b from-indigo-100 to-indigo-50',
    greeting: 'הוזמנתם לחגוג עמנו',
  },
};

// Per-event-type copy for the post-event thank-you page (`/ty/[token]`) — a
// SEPARATE map from `greeting` above (which is invite-tense, "future"); this is
// deliberately past-tense ("thank you for coming"), shown alongside the same
// `EVENT_THEME[type].accent`/`.banner` for visual consistency with the gift page.
export const EVENT_THANKYOU_GREETING: Record<EventType, string> = {
  wedding: 'תודה שבאתם לחגוג איתנו את החתונה!',
  engagement: 'תודה שבאתם לחגוג איתנו את האירוסין!',
  henna: 'תודה שבאתם לחגוג איתנו את ליל החינה!',
  brit: 'תודה שבאתם לחגוג איתנו את שמחת הברית!',
  britah: 'תודה שבאתם לחגוג איתנו את שמחת הבריתה!',
  bar_mitzvah: 'תודה שבאתם לחגוג איתנו את הבר מצווה!',
  bat_mitzvah: 'תודה שבאתם לחגוג איתנו את הבת מצווה!',
  birthday: 'תודה שבאתם לחגוג איתנו את יום ההולדת!',
  other: 'תודה שבאתם לחגוג איתנו!',
};
