import 'server-only';

import { randomBytes } from 'node:crypto';

import { requireEventAccess } from '@/lib/data/events';
import { createAdminClient } from '@/lib/supabase/admin';

// ---------------------------------------------------------------------------
// Guest-detail RSVP link helpers. The RSVP token is a bearer secret, so
// reading, revoking, and regenerating it all require guests.edit. Each helper
// re-verifies access server-side before touching the token via the service-role
// client.
//
// These are the ONLY request-scoped (requireEventAccess) functions of the RSVP
// data layer; they live in their OWN module (split out of rsvp.ts) so the
// request-FREE public/webhook RSVP functions in rsvp.ts (getRsvpByToken,
// getEventAttendeesPublic, submitRsvp — reached by the pg-boss worker via
// webhook-processing) never drag events.ts → auth/dal → next/headers|navigation
// into the worker bundle (enforced by .dependency-cruiser.cjs). Behavior is
// byte-identical to before the split; only the file location changed.
// ---------------------------------------------------------------------------

export interface RsvpLinkInfo {
  token: string;
  revokedAt: string | null;
}

/** The current RSVP token + revocation state for one guest the member may edit. */
export async function getRsvpLinkInfo(
  eventId: string,
  guestId: string,
): Promise<RsvpLinkInfo | null> {
  await requireEventAccess(eventId, 'guests', 'edit');
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('guests')
    .select('rsvp_token, rsvp_token_revoked_at')
    .eq('event_id', eventId)
    .eq('id', guestId)
    .maybeSingle();
  if (error) {
    throw new Error('טעינת קישור ההזמנה נכשלה');
  }
  if (!data) return null;
  return { token: data.rsvp_token, revokedAt: data.rsvp_token_revoked_at };
}

/** Revoke the guest's RSVP link (existing link stops resolving immediately). */
export async function revokeRsvpToken(
  eventId: string,
  guestId: string,
): Promise<void> {
  await requireEventAccess(eventId, 'guests', 'edit');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('guests')
    .update({ rsvp_token_revoked_at: new Date().toISOString() })
    .eq('event_id', eventId)
    .eq('id', guestId);
  if (error) {
    throw new Error('ביטול קישור ההזמנה נכשל');
  }
}

/**
 * Issue a fresh 128-bit RSVP token and clear any revocation. Mirrors the DB
 * DEFAULT (`encode(gen_random_bytes(16),'hex')`) — 16 bytes => 32 lowercase
 * hex chars — so regenerated tokens match the canonical strength standard.
 */
export async function regenerateRsvpToken(
  eventId: string,
  guestId: string,
): Promise<void> {
  await requireEventAccess(eventId, 'guests', 'edit');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('guests')
    .update({
      rsvp_token: randomBytes(16).toString('hex'),
      rsvp_token_revoked_at: null,
    })
    .eq('event_id', eventId)
    .eq('id', guestId);
  if (error) {
    throw new Error('יצירת קישור הזמנה חדש נכשלה');
  }
}
