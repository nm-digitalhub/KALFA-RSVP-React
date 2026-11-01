'use server';

import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { headers } from 'next/headers';
import { returnValidationErrors } from 'next-safe-action';

import { RATING_SUBMIT_RATE } from '@/lib/constants';
import { submitInquiryRating } from '@/lib/data/inquiry-rating';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { submitRatingSchema } from '@/lib/validation/rating';

// Public rating submit. Bound to the route token, so the browser never
// supplies an inquiry identifier of its own. Order: SUBMIT rate-limit (token
// fingerprint+IP) → Zod → submitInquiryRating (re-checks the token itself,
// independent of whatever the page already rendered). The rate limit is a
// pre-validation middleware (use() runs before the form or the bound token is
// parsed); the fields arrive untouched (z.unknown) and the schema runs in the
// body.
const ratingForm = zfd.formData({ score: z.unknown().optional(), comment: z.unknown().optional() });

export const submitRatingAction = actionClient
  .use(async ({ next, bindArgsClientInputs: [token] }) => {
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
    // Bucket key uses a token FINGERPRINT, never the raw bearer token — same
    // reasoning as every other public token surface (r/[token]/actions.ts).
    // The bound value is fingerprinted as it arrived; its schema checks it next.
    const fp = tokenFingerprint(String(token));
    const gate = await rateLimit(`rating:submit:${fp}:${ip}`, RATING_SUBMIT_RATE);
    if (!gate.allowed) {
      returnUserError('נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.');
    }
    return next();
  })
  .inputSchema(ratingForm)
  .bindArgsSchemas([z.string().min(1)])
  .stateAction(async ({ parsedInput: { score, comment }, bindArgsParsedInputs: [token] }) => {
    const parsed = submitRatingSchema.safeParse({ score, comment: comment ?? '' });
    if (!parsed.success) {
      returnValidationErrors(submitRatingSchema, {
        ...z.formatError(parsed.error),
        _errors: ['נא לבחור דירוג תקין.'],
      });
    }

    const result = await submitInquiryRating(
      token,
      parsed.data.score,
      parsed.data.comment || null,
    );
    if (!result.ok) {
      // One generic message — never reveal whether the token was unknown,
      // never requested a rating, or a DB error occurred.
      returnUserError('הקישור אינו תקף או שאינו זמין עוד.');
    }

    return { notice: 'תודה על הדירוג!' };
  });
