'use server';

import { headers } from 'next/headers';

import { RATING_SUBMIT_RATE } from '@/lib/constants';
import { submitInquiryRating } from '@/lib/data/inquiry-rating';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { submitRatingSchema } from '@/lib/validation/rating';
import type { FormState } from '@/lib/validation/result';

// Public rating submit. Bound to the route token, so the browser never
// supplies an inquiry identifier of its own. Order: SUBMIT rate-limit (token
// fingerprint+IP) → Zod → submitInquiryRating (re-checks the token itself,
// independent of whatever the page already rendered).
export async function submitRatingAction(
  token: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  // Bucket key uses a token FINGERPRINT, never the raw bearer token — same
  // reasoning as every other public token surface (r/[token]/actions.ts).
  const fp = tokenFingerprint(token);
  const gate = rateLimit(`rating:submit:${fp}:${ip}`, RATING_SUBMIT_RATE);
  if (!gate.allowed) {
    return { error: 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.' };
  }

  const parsed = submitRatingSchema.safeParse({
    score: formData.get('score'),
    comment: formData.get('comment') ?? '',
  });
  if (!parsed.success) {
    return {
      error: 'נא לבחור דירוג תקין.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await submitInquiryRating(
    token,
    parsed.data.score,
    parsed.data.comment || null,
  );
  if (!result.ok) {
    // One generic message — never reveal whether the token was unknown,
    // never requested a rating, or a DB error occurred.
    return { error: 'הקישור אינו תקף או שאינו זמין עוד.' };
  }

  return { notice: 'תודה על הדירוג!' };
}
