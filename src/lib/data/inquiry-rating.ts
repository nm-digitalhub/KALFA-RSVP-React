import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Server-only resolver + writer for the public CSAT page (`/rate/[token]`).
// The opaque `rating_token` IS the capability — no session, same posture as
// `getGiftByToken` (gift.ts): fail-closed, one generic outcome for every
// failure mode. Deliberately minimal — the page renders nothing identifying
// about the inquiry, so the resolver returns only an id, never name/email/
// phone/message/topic/source/notes.

/**
 * Does this token resolve to an inquiry that was actually sent a rating
 * request? Returns only `id` — enough to drive the form, nothing else.
 * Fails closed to null on any error or miss; the caller renders ONE generic
 * message, never distinguishing "unknown token" from "DB error".
 */
export async function getRatingByToken(token: string): Promise<{ id: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contact_messages')
    .select('id')
    .eq('rating_token', token)
    .not('rating_requested_at', 'is', null)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id };
}

export type SubmitRatingResult = { ok: true } | { ok: false };

/**
 * Records (or re-records) a rating. Re-submittable by design — a later call
 * simply overwrites the previous score/comment/timestamp; there is no
 * "already rated" lock (docs/admin-contacts-redesign-plan-2026-08-25.md §4.3).
 * `.select('id')` after the update is what lets an unknown/revoked token be
 * told apart from a real failure: PostgREST returns an empty array (not an
 * error) when the WHERE matches nothing, so without selecting back the
 * affected row, a bad token would look identical to success.
 */
export async function submitInquiryRating(
  token: string,
  score: 1 | 2 | 3,
  comment: string | null,
): Promise<SubmitRatingResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contact_messages')
    .update({
      rating_score: score,
      rating_comment: comment,
      rating_at: new Date().toISOString(),
    })
    .eq('rating_token', token)
    .not('rating_requested_at', 'is', null)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false };
  return { ok: true };
}
