import { z } from 'zod';

import { RSVP_STATUSES, type RsvpStatus } from '@/lib/constants';

// Re-exported so server modules can keep importing the RSVP status type from
// the validation boundary; the source of truth (zod-free) lives in constants.
export type { RsvpStatus };

// Absolute sanity caps so absurd input is rejected at the boundary. The real
// per-guest ceiling is `expected_count`, enforced inside submit_rsvp — the only
// place that knows it — so it is deliberately NOT duplicated here.
const COUNT_MAX = 50;
const MEAL_MAX = 120;
const RSVP_TEXT_MAX = 500;

const countField = z
  .number({ error: 'מספר לא תקין' })
  .int({ error: 'מספר לא תקין' })
  .min(0, { error: 'מספר לא תקין' })
  .max(COUNT_MAX, { error: 'מספר גדול מדי' });

export const rsvpSubmitSchema = z
  .object({
    status: z.enum(RSVP_STATUSES, { error: 'נא לבחור תשובה' }),
    adults: countField,
    kids: countField,
    meal_pref: z
      .string()
      .trim()
      .max(MEAL_MAX, { error: 'הטקסט ארוך מדי' })
      .optional(),
    note: z
      .string()
      .trim()
      .max(RSVP_TEXT_MAX, { error: 'ההערה ארוכה מדי' })
      .optional(),
    // Custom event-question answers, keyed q_key -> value. submit_rsvp checks
    // the keys, required-ness, option membership, and length against
    // event_questions; this only guards the wire shape + a per-answer ceiling.
    answers: z
      .record(
        z.string(),
        z.string().trim().max(RSVP_TEXT_MAX, { error: 'התשובה ארוכה מדי' }),
      )
      .optional(),
    // "Who's coming" opt-in checkbox. submit_rsvp forces this false whenever
    // status <> attending (defense in depth) — this boundary only carries the
    // guest's checkbox state through.
    show_in_guest_list: z.boolean().optional(),
    // B1: guest opt-in to receive an automated (AI) reminder phone call. Written
    // to contacts.call_consent_at (monotonic) by submit_rsvp; only meaningful in
    // the attending block (the form renders the checkbox there).
    call_consent: z.boolean().optional(),
  })
  // When attending, at least one guest must be counted. declined/maybe force
  // the counts to 0 server-side, so this rule only binds on attending.
  .refine((v) => v.status !== 'attending' || v.adults + v.kids >= 1, {
    error: 'נא לציין לפחות אורח אחד',
    path: ['adults'],
  });

export type RsvpSubmitInput = z.infer<typeof rsvpSubmitSchema>;
