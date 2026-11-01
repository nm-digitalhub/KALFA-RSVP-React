'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { returnValidationErrors } from 'next-safe-action';

import { RSVP_SUBMIT_RATE } from '@/lib/constants';
import { submitRsvp, type RsvpFailureReason } from '@/lib/data/rsvp';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { rsvpSubmitSchema } from '@/lib/validation/rsvp';

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
 * a guest identifier. Order: SUBMIT rate-limit (token fingerprint+IP, a
 * pre-validation middleware: use() runs before anything is parsed) →
 * reassemble custom answers from flat FormData → Zod → submit_rsvp (which
 * performs all authorization, gating, atomicity) → safe result.
 *
 * The input stays the FormData itself: the custom answers arrive under
 * dynamic `answer_<q_key>` names, which zfd's object would nest wherever a
 * q_key holds '.' or '['. So the parse stays in the body, as before.
 */
export const submitRsvpAction = actionClient
  .use(async ({ next, bindArgsClientInputs: [token] }) => {
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
    // Bucket key uses a token FINGERPRINT, never the raw bearer token (raw
    // tokens in in-memory keys can surface in diagnostics; same pattern as the
    // read site, r/[token]/page.tsx). The bound value is fingerprinted as it
    // arrived; its schema checks it right after.
    const fp = tokenFingerprint(String(token));
    const gate = await rateLimit(`rsvp:submit:${fp}:${ip}`, RSVP_SUBMIT_RATE);
    if (!gate.allowed) {
      returnUserError('נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.');
    }
    return next();
  })
  .inputSchema(z.instanceof(FormData))
  .bindArgsSchemas([z.string().min(1)])
  .stateAction(async ({ parsedInput: formData, bindArgsParsedInputs: [token] }) => {
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
      show_in_guest_list: formData.get('show_in_guest_list') === 'on',
    });
    if (!parsed.success) {
      // Grouped by top-level field exactly as before (z.flattenError), so a
      // nested answers.<q_key> message still lands under `answers`.
      const { fieldErrors } = z.flattenError(parsed.error);
      returnValidationErrors(rsvpSubmitSchema, {
        _errors: ['נא לבדוק את הפרטים שמולאו.'],
        ...Object.fromEntries(Object.entries(fieldErrors).map(([field, errors]) => [field, { _errors: errors }])),
      });
    }

    const outcome = await submitRsvp(token, parsed.data);

    // Keep the WhatsApp headcount flow coherent with the web page: a submitted
    // attending count IS the answer — mirror it so reports agree and the bot
    // never asks someone who already told us on the page. Best-effort (the RSVP
    // itself is already atomically recorded by the RPC).
    if (outcome.ok && parsed.data.status === 'attending') {
      try {
        const { createAdminClient } = await import('@/lib/supabase/admin');
        await createAdminClient()
          .from('guests')
          .update({
            confirmed_headcount: Math.min(
              10,
              parsed.data.adults + parsed.data.kids,
            ),
            headcount_answered_at: new Date().toISOString(),
          })
          .eq('rsvp_token', token);
      } catch {
        /* sync only — never fail a recorded RSVP */
      }
    }
    if (!outcome.ok) {
      returnUserError(REASON_MESSAGES[outcome.reason]);
    }
    return {
      notice: outcome.unchanged
        ? 'התשובה שלך כבר נשמרה אצלנו. תודה!'
        : 'אישור ההגעה נשמר בהצלחה. תודה!',
    };
  });
