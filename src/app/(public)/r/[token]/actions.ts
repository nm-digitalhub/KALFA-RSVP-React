'use server';

import { headers } from 'next/headers';

import { RSVP_SUBMIT_RATE } from '@/lib/constants';
import { submitRsvp, type RsvpFailureReason } from '@/lib/data/rsvp';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { rsvpSubmitSchema } from '@/lib/validation/rsvp';
import type { FormState } from '@/lib/validation/result';

const ANSWER_PREFIX = 'answer_';

// Reason codes from submit_rsvp mapped to safe, user-facing Hebrew. These are
// actionable (deadline/closed/count) without revealing token validity beyond
// what the page already showed; unknown/revoked collapse to one generic line.
const REASON_MESSAGES: Record<RsvpFailureReason, string> = {
  not_found: 'קישור אישור ההגעה אינו תקף או בוטל.',
  closed: 'האירוע אינו פתוח כעת לאישורי הגעה.',
  deadline_passed: 'המועד האחרון לאישור הגעה חלף.',
  invalid_count: 'מספר האורחים אינו תקין.',
  invalid_answers: 'אחת התשובות אינה תקינה. נא לבדוק ולנסות שוב.',
  missing_required: 'נא למלא את כל השדות הנדרשים.',
  invalid_status: 'הבחירה אינה תקינה.',
};

function trimmedOrUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Public RSVP submit. Bound to the route token, so the browser never supplies
 * a guest identifier. Order: SUBMIT rate-limit (token+IP) → reassemble custom
 * answers from flat FormData → Zod → submit_rsvp (which performs all
 * authorization, gating, atomicity) → safe FormState.
 */
export async function submitRsvpAction(
  token: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  const gate = rateLimit(`rsvp:submit:${token}:${ip}`, RSVP_SUBMIT_RATE);
  if (!gate.allowed) {
    return { error: 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.' };
  }

  // Custom answers arrive as flat fields named `answer_<q_key>`; rebuild the
  // object the schema + RPC expect. submit_rsvp re-validates keys/options/length.
  const answers: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(ANSWER_PREFIX) && typeof value === 'string') {
      const qKey = key.slice(ANSWER_PREFIX.length);
      const trimmed = value.trim();
      if (qKey && trimmed.length > 0) answers[qKey] = trimmed;
    }
  }

  const parsed = rsvpSubmitSchema.safeParse({
    status: formData.get('status'),
    adults: Number(formData.get('adults') ?? 0),
    kids: Number(formData.get('kids') ?? 0),
    meal_pref: trimmedOrUndefined(formData.get('meal_pref')),
    note: trimmedOrUndefined(formData.get('note')),
    answers: Object.keys(answers).length > 0 ? answers : undefined,
  });
  if (!parsed.success) {
    return {
      error: 'נא לבדוק את הפרטים שמולאו.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const outcome = await submitRsvp(token, parsed.data);
  if (!outcome.ok) {
    return { error: REASON_MESSAGES[outcome.reason] };
  }
  return {
    notice: outcome.unchanged
      ? 'התשובה שלך כבר נשמרה אצלנו. תודה!'
      : 'אישור ההגעה נשמר בהצלחה. תודה!',
  };
}
