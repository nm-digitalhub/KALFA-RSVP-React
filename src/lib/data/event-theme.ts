// Per-event-type visual theme for the public gift landing page. Isomorphic (no
// `server-only`) — a client or server component can read it. The icon, heading
// and celebrant text come from the canonical composers (celebrant-display.ts /
// event-labels.ts); this module ONLY adds the color accent + celebratory copy.
//
// IMPORTANT: every Tailwind class here MUST be a full static literal string.
// Tailwind v4 scans source files for complete class names — a dynamically
// built class (e.g. `text-${color}-500`) would never be generated.

import type { TFunction } from 'i18next';

import type { Enums } from '@/lib/supabase/types';
type EventType = Enums<'event_type'>;

export interface EventTheme {
  /** Accent text color for the heading icon (full static Tailwind class). */
  accent: string;
  /** Gradient classes for the celebratory banner (full static Tailwind classes;
   *  v4 `bg-linear-to-*` — `bg-gradient-to-*` is the v3 compatibility alias). */
  banner: string;
}

export const EVENT_THEME: Record<EventType, EventTheme> = {
  wedding: {
    accent: 'text-rose-500',
    banner: 'bg-linear-to-b from-rose-100 to-amber-50',
  },
  engagement: {
    accent: 'text-pink-500',
    banner: 'bg-linear-to-b from-pink-100 to-rose-50',
  },
  henna: {
    accent: 'text-orange-500',
    banner: 'bg-linear-to-b from-orange-100 to-amber-50',
  },
  brit: {
    accent: 'text-sky-500',
    banner: 'bg-linear-to-b from-sky-100 to-sky-50',
  },
  britah: {
    accent: 'text-sky-500',
    banner: 'bg-linear-to-b from-sky-100 to-sky-50',
  },
  bar_mitzvah: {
    accent: 'text-violet-500',
    banner: 'bg-linear-to-b from-violet-100 to-fuchsia-50',
  },
  bat_mitzvah: {
    accent: 'text-violet-500',
    banner: 'bg-linear-to-b from-violet-100 to-fuchsia-50',
  },
  birthday: {
    accent: 'text-amber-500',
    banner: 'bg-linear-to-b from-amber-100 to-yellow-50',
  },
  other: {
    accent: 'text-primary',
    banner: 'bg-linear-to-b from-indigo-100 to-indigo-50',
  },
};

// Short celebratory line shown under the heading of the gift landing page.
export const eventGreetings = (t: TFunction<'public'>): Record<EventType, string> => ({
  wedding: t('g.landing.greeting.wedding', 'מזל טוב! הוזמנתם לחגוג עמנו'),
  engagement: t('g.landing.greeting.engagement', 'מזל טוב לאירוסין!'),
  henna: t('g.landing.greeting.henna', 'ליל חינה שמח!'),
  brit: t('g.landing.greeting.brit', 'שמחים שאתם חלק מהשמחה'),
  britah: t('g.landing.greeting.britah', 'שמחים שאתם חלק מהשמחה'),
  bar_mitzvah: t('g.landing.greeting.barMitzvah', 'מזל טוב! חוגגים יחד'),
  bat_mitzvah: t('g.landing.greeting.batMitzvah', 'מזל טוב! חוגגים יחד'),
  birthday: t('g.landing.greeting.birthday', 'יום הולדת שמח!'),
  other: t('g.landing.greeting.other', 'הוזמנתם לחגוג עמנו'),
});

// Per-event-type copy for the post-event thank-you page (`/ty/[token]`) — a
// SEPARATE map from eventGreetings above (which is invite-tense, "future"); this is
// deliberately past-tense ("thank you for coming"), shown alongside the same
// `EVENT_THEME[type].accent`/`.banner` for visual consistency with the gift page.
export const eventThankyouGreetings = (t: TFunction<'public'>): Record<EventType, string> => ({
  wedding: t('ty.landing.greeting.wedding', 'תודה שבאתם לחגוג איתנו את החתונה!'),
  engagement: t('ty.landing.greeting.engagement', 'תודה שבאתם לחגוג איתנו את האירוסין!'),
  henna: t('ty.landing.greeting.henna', 'תודה שבאתם לחגוג איתנו את ליל החינה!'),
  brit: t('ty.landing.greeting.brit', 'תודה שבאתם לחגוג איתנו את שמחת הברית!'),
  britah: t('ty.landing.greeting.britah', 'תודה שבאתם לחגוג איתנו את שמחת הבריתה!'),
  bar_mitzvah: t('ty.landing.greeting.barMitzvah', 'תודה שבאתם לחגוג איתנו את הבר מצווה!'),
  bat_mitzvah: t('ty.landing.greeting.batMitzvah', 'תודה שבאתם לחגוג איתנו את הבת מצווה!'),
  birthday: t('ty.landing.greeting.birthday', 'תודה שבאתם לחגוג איתנו את יום ההולדת!'),
  other: t('ty.landing.greeting.other', 'תודה שבאתם לחגוג איתנו!'),
});
