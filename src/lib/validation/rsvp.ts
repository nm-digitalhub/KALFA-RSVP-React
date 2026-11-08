import type { TFunction } from 'i18next';
import { z } from 'zod';

import { HEADCOUNT_MAX, RSVP_STATUSES, type RsvpStatus } from '@/lib/constants';

// Re-exported so server modules can keep importing the RSVP status type from
// the validation boundary; the source of truth (zod-free) lives in constants.
export type { RsvpStatus };

// Absolute sanity caps so absurd input is rejected at the boundary. The real
// per-guest ceiling is `expected_count`, enforced inside submit_rsvp — the only
// place that knows it — so it is deliberately NOT duplicated here. The count's
// cap is HEADCOUNT_MAX (constants), shared with the page.
const MEAL_MAX = 120;
const RSVP_TEXT_MAX = 500;

// How many are coming, one number (no adults/kids split). The schema-level error also covers .int() and .min(),
// which define none of their own (zod.dev/error-customization).
function headcountField(t: TFunction<'public'>) {
  return z
    .number({ error: () => t('validation.rsvp.count.invalid', 'מספר לא תקין') })
    .int()
    .min(0)
    .max(HEADCOUNT_MAX, { error: () => t('validation.rsvp.count.tooLarge', 'מספר גדול מדי') });
}

// Built with the caller's `t`, so the messages follow the language of the request (see inquiries.ts).
export function rsvpSubmitSchema(t: TFunction<'public'>) {
  return z
    .object({
      status: z.enum(RSVP_STATUSES, { error: () => t('validation.rsvp.status.required', 'נא לבחור תשובה') }),
      headcount: headcountField(t),
      meal_pref: z
        .string()
        .trim()
        .max(MEAL_MAX, { error: () => t('validation.rsvp.mealPref.tooLong', 'הטקסט ארוך מדי') })
        .optional(),
      note: z
        .string()
        .trim()
        .max(RSVP_TEXT_MAX, { error: () => t('validation.note.tooLong', 'ההערה ארוכה מדי') })
        .optional(),
      // Custom event-question answers, keyed q_key -> value. submit_rsvp checks
      // the keys, required-ness, option membership, and length against
      // event_questions; this only guards the wire shape + a per-answer ceiling.
      answers: z
        .record(
          z.string(),
          z
            .string()
            .trim()
            .max(RSVP_TEXT_MAX, { error: () => t('validation.rsvp.answer.tooLong', 'התשובה ארוכה מדי') }),
        )
        .optional(),
      // "Who's coming" opt-in checkbox. submit_rsvp forces this false whenever
      // status <> attending (defense in depth) — this boundary only carries the
      // guest's checkbox state through.
      show_in_guest_list: z.boolean().optional(),
    })
    // When attending, at least one guest must be counted. declined/maybe force
    // the count to 0 server-side, so this rule only binds on attending.
    .refine((v) => v.status !== 'attending' || v.headcount >= 1, {
      error: () => t('validation.rsvp.guests.required', 'נא לציין לפחות אורח אחד'),
      path: ['headcount'],
    });
}

export type RsvpSubmitInput = z.infer<ReturnType<typeof rsvpSubmitSchema>>;
