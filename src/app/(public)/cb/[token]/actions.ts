'use server';

import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { headers } from 'next/headers';
import { returnValidationErrors } from 'next-safe-action';

import { submitCallbackIntake } from '@/lib/data/callback-intake';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { callbackIntakeSchema } from '@/lib/validation/inquiries';

const RATE = { limit: 10, windowMs: 10 * 60_000 };

// One generic refusal for every "no". Which token exists, which has expired and
// which was already used are all the same sentence here — the difference is
// exactly what a prober would be probing for.
const UNAVAILABLE = 'הקישור הזה כבר לא פעיל. אפשר להשאיר פרטים מחדש בעמוד יצירת הקשר.';
const GENERIC = 'שליחת הפרטים נכשלה. אפשר לנסות שוב.';

// The fields as posted, untouched (z.unknown): callbackIntakeSchema runs in the
// body, after the honeypot, and the rate limit runs before anything is parsed.
// Declared so they survive zfd's object (undeclared keys are dropped) and the
// field errors are typed.
const intakeForm = zfd.formData({
  company: z.unknown().optional(),
  full_name: z.unknown().optional(),
  topic: z.unknown().optional(),
  note: z.unknown().optional(),
  preference: z.unknown().optional(),
});

/**
 * The token arrives BOUND, not as a form field.
 *
 * Next's forms guide is explicit that a hidden input "will be part of the
 * rendered HTML and will not be encoded", while a bound argument is encrypted
 * with NEXT_SERVER_ACTIONS_ENCRYPTION_KEY and fixed server-side at render time.
 * With a hidden input, anyone could edit the value in devtools and aim the
 * write at a different row; bound, there is nothing to edit.
 *
 * Every gate that matters — expiry, single use, terminal status, and whether
 * the slot is already fixed — lives inside submit_callback_intake, in the same
 * statement as the UPDATE. Nothing here is a security boundary: the framework's
 * own guidance is that render-time gating is not one, because the POST can be
 * sent without the UI.
 */
export const submitIntakeAction = actionClient
  // The rate limit runs first, before the form or the bound token is parsed
  // (use() runs before validation), on the bound value exactly as it arrived.
  .use(async ({ next, bindArgsClientInputs: [token] }) => {
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
    // Keyed on a FINGERPRINT, never the raw bearer token — raw tokens in
    // in-memory keys can surface in diagnostics (same pattern as /r and /ty).
    if (!(await rateLimit(`cb-intake:${tokenFingerprint(String(token))}:${ip}`, RATE)).allowed) {
      returnUserError('נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.');
    }
    return next();
  })
  .inputSchema(intakeForm)
  .bindArgsSchemas([z.string().min(1)])
  .stateAction(async ({ parsedInput: input, bindArgsParsedInputs: [token] }) => {
    // Honeypot: a bot that fills the hidden field gets the same success it would
    // have got anyway, and nothing is written.
    if (String(input.company ?? '').trim()) {
      return { notice: 'הפרטים נשמרו. נחזור אליך בהקדם.' };
    }

    const parsed = callbackIntakeSchema.safeParse({
      full_name: input.full_name,
      topic: input.topic,
      note: String(input.note ?? '').trim() || undefined,
      // An unchecked radio group posts nothing; the schema's default makes that
      // 'asap', which is what this form means when nobody chooses.
      preference: String(input.preference ?? '').trim() || undefined,
    });
    if (!parsed.success) {
      returnValidationErrors(callbackIntakeSchema, {
        ...z.formatError(parsed.error),
        _errors: ['נא לבדוק את הפרטים שמולאו.'],
      });
    }

    // A failure here keeps its own fixed line: whatever the data layer threw never reaches the visitor.
    let outcome;
    try {
      outcome = await submitCallbackIntake(token, parsed.data);
    } catch {
      returnUserError(GENERIC);
    }

    if (!outcome.ok) {
      returnUserError(outcome.reason === 'unavailable' ? UNAVAILABLE : GENERIC);
    }

    return {
      notice: outcome.scheduleLocked
        ? 'הפרטים נשמרו, תודה. המועד שכבר נקבע לא השתנה — נחזור אליך אז.'
        : 'הפרטים נשמרו, תודה. נחזור אליך בהקדם.',
    };
  });
