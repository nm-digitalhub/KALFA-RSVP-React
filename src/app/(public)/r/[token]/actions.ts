'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { returnValidationErrors } from 'next-safe-action';

import { getT } from '@/i18n.server';
import { RSVP_SUBMIT_RATE } from '@/lib/constants';
import { submitRsvp, type RsvpFailureReason } from '@/lib/data/rsvp';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { rsvpSubmitSchema } from '@/lib/validation/rsvp';

const ANSWER_PREFIX = 'answer_';

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
      const { t } = await getT('public');
      returnUserError(t('r.rateLimited', 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.'));
    }
    return next();
  })
  .inputSchema(z.instanceof(FormData))
  .bindArgsSchemas([z.string().min(1)])
  .stateAction(async ({ parsedInput: formData, bindArgsParsedInputs: [token] }) => {
    const { t } = await getT('public');

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

    const schema = rsvpSubmitSchema(t);
    const parsed = schema.safeParse({
      status: formData.get('status'),
      headcount: Number(formData.get('headcount') ?? 0),
      meal_pref: trimmedOrUndefined(formData.get('meal_pref')),
      note: trimmedOrUndefined(formData.get('note')),
      answers: Object.keys(answers).length > 0 ? answers : undefined,
      show_in_guest_list: formData.get('show_in_guest_list') === 'on',
    });
    if (!parsed.success) {
      // Grouped by top-level field exactly as before (z.flattenError), so a
      // nested answers.<q_key> message still lands under `answers`.
      const { fieldErrors } = z.flattenError(parsed.error);
      returnValidationErrors(schema, {
        _errors: [t('r.errors.checkFields', 'נא לבדוק את הפרטים שמולאו.')],
        ...Object.fromEntries(Object.entries(fieldErrors).map(([field, errors]) => [field, { _errors: errors }])),
      });
    }

    // The count is the guest's answer: submit_rsvp stores it, with the answered
    // stamp that stops the WhatsApp "how many" question, in the same statement.
    const outcome = await submitRsvp(token, parsed.data);
    if (!outcome.ok) {
      // Reason codes from submit_rsvp mapped to safe, user-facing Hebrew. These are
      // actionable (deadline/closed/count) without revealing token validity beyond
      // what the page already showed; unknown/revoked collapse to one generic line.
      const reasonMessages: Record<RsvpFailureReason, string> = {
        not_found: t('r.errors.notFound', 'קישור אישור ההגעה אינו תקף או בוטל.'),
        closed: t('r.errors.closed', 'האירוע אינו פתוח כעת לאישורי הגעה.'),
        deadline_passed: t('r.errors.deadlinePassed', 'המועד האחרון לאישור הגעה חלף.'),
        invalid_count: t('r.errors.invalidCount', 'מספר האורחים אינו תקין.'),
        invalid_answers: t('r.errors.invalidAnswers', 'אחת התשובות אינה תקינה. נא לבדוק ולנסות שוב.'),
        missing_required: t('r.errors.missingRequired', 'נא למלא את כל השדות הנדרשים.'),
        invalid_status: t('r.errors.invalidStatus', 'הבחירה אינה תקינה.'),
      };
      returnUserError(reasonMessages[outcome.reason]);
    }
    return {
      notice: outcome.unchanged
        ? t('r.success.unchanged', 'התשובה שלך כבר נשמרה אצלנו. תודה!')
        : t('r.success.saved', 'אישור ההגעה נשמר בהצלחה. תודה!'),
    };
  });
