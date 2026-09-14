import 'server-only';

import { randomBytes } from 'node:crypto';

import { preferenceToRequestFields } from '@/lib/callbacks/schedule-policy';
import { createAdminClient } from '@/lib/supabase/admin';
import type { CallbackIntakeInput } from '@/lib/validation/inquiries';

// Self-service intake for a callback_requests row born from a MISSED call.
//
// A missed call gives us a phone number and nothing else, so the row is
// written with a stand-in name and a system label for a topic — and the
// confirmation agent later reads both aloud to a real person. This module is
// how the caller themselves replaces those two values.
//
// Every read and write goes through the two SECURITY DEFINER functions added
// in 20260914114331, called here with the service role. The browser never
// holds a Supabase client, so neither function is reachable by `anon`; and the
// gating lives inside them, in the same statement as the UPDATE, so there is
// no window between "may they?" and the write.

/**
 * How long a link stays usable.
 *
 * Long enough to survive a working day and a night — someone who missed us at
 * 17:00 may only look at their phone the next morning — and short enough that
 * an old SMS in a stranger's hands is inert. Past this the link says the same
 * generic thing an unknown token says.
 */
export const INTAKE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

export type CallbackIntakeView = {
  id: string;
  /** Last two digits of the number we will ring — enough to recognise, useless to guess with. */
  phone_hint: string;
  created_at: string;
  scheduled_at: string | null;
  /** A slot already exists, so the time preference can no longer be changed. */
  locked: boolean;
};

export type CallbackIntakeOutcome =
  | { ok: true; scheduleLocked: boolean }
  | { ok: false; reason: 'invalid' | 'unavailable' };

/**
 * Give a request a one-time intake link, returning the token.
 *
 * Best-effort by design, and never throws: the caller is a missed-call handler
 * whose real job already succeeded when the row was written. A row without a
 * token simply gets no SMS and behaves exactly as it did before this feature —
 * the degraded state is the OLD state, which is why it is safe to swallow.
 *
 * `randomBytes(16).toString('hex')` — the same shape as every other dispatch
 * token in this codebase (meeting-confirm, sales-call, outreach).
 */
export async function mintCallbackIntakeToken(requestId: string): Promise<string | null> {
  try {
    const token = randomBytes(16).toString('hex');
    const { error } = await createAdminClient()
      .from('callback_requests')
      .update({
        intake_token: token,
        intake_token_expires_at: new Date(Date.now() + INTAKE_TOKEN_TTL_MS).toISOString(),
      })
      .eq('id', requestId)
      // Never re-mint: a second token would silently invalidate a link the
      // person may already be looking at.
      .is('intake_token', null);
    if (error) return null;
    return token;
  } catch {
    return null;
  }
}

/**
 * The intake view for a token, or null.
 *
 * null covers unknown, expired, already-filled and terminal alike — the route
 * must not tell them apart, so that a prober learns nothing from the
 * difference between "wrong token" and "right token, wrong moment".
 */
export async function getCallbackIntakeByToken(token: string): Promise<CallbackIntakeView | null> {
  const { data, error } = await createAdminClient().rpc('get_callback_intake_by_token', {
    _token: token,
  });
  if (error) throw new Error('טעינת הטופס נכשלה');
  if (data == null) return null;
  // Documented boundary cast: the function returns `Json`; its concrete shape
  // is fixed by the definition in the migration and modelled above.
  return data as unknown as CallbackIntakeView;
}

/**
 * Write the caller's answers onto their own request.
 *
 * The phone is NOT a parameter, here or in the function — it is the identity
 * the token is bound to, and a surface that accepted it would let whoever
 * holds the SMS redirect someone else's callback to their own number.
 */
export async function submitCallbackIntake(
  token: string,
  input: CallbackIntakeInput,
): Promise<CallbackIntakeOutcome> {
  // The same mapping the public /contact insert uses: a part-of-day choice is
  // stored as an instant AND a direction, never as the raw word.
  const { requestedAtIso, requestedRank } = preferenceToRequestFields(
    input.preference,
    Date.now(),
  );

  const { data, error } = await createAdminClient().rpc('submit_callback_intake', {
    _token: token,
    _full_name: input.full_name,
    _topic: input.topic,
    _note: input.note ?? '',
    _requested_rank: requestedRank,
    // '' is the absence, not a missing key: 'asap' must leave requested_at
    // NULL ("no stated time" — the scheduler resolves it when it runs). The
    // parameter is `text` for exactly this reason; see 20260914115647.
    _requested_at: requestedAtIso ?? '',
  });
  if (error) throw new Error('שליחת הפרטים נכשלה');

  const result = (data ?? {}) as { ok?: boolean; reason?: string; schedule_locked?: boolean };
  if (result.ok === true) {
    return { ok: true, scheduleLocked: result.schedule_locked === true };
  }
  return { ok: false, reason: result.reason === 'invalid' ? 'invalid' : 'unavailable' };
}
