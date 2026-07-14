import 'server-only';

import type { Database } from '@/lib/supabase/types';
import {
  getCallAttemptById,
  getGuestRsvpToken,
  recordCallOutcome,
  recordRsvpFromCall,
} from '@/lib/data/call-attempts';
import { insertInteraction, setContactOpStatus } from '@/lib/data/interactions';
import { writeReach } from '@/lib/data/outreach-engine';
import { submitRsvp } from '@/lib/data/rsvp';
import { validateRecordingUrl } from '@/lib/voximplant/recording-url';
import { voxCallbackSchema } from '@/lib/validation/voximplant';

type WebhookInboxRow = Database['public']['Tables']['webhook_inbox']['Row'];

// Process ONE persisted Voximplant call-result callback (event_kind==='call_result').
// Called by processWebhookEvent (the existing webhook drain) AND, best-effort,
// synchronously by the cb route right after persist. Fully IDEMPOTENT: the
// contact_interactions UNIQUE(channel,provider_id) gate makes billing+RSVP fire
// at most once, and recordCallOutcome's compare-and-set prevents an out-of-order
// callback from downgrading a terminal outcome. Identity comes ONLY from
// row.message_id (= the token-verified call_attempt_id), NEVER from the payload's
// invitation_id.
export async function processCallResult(row: WebhookInboxRow): Promise<void> {
  const parsed = voxCallbackSchema.safeParse(row.payload);
  if (!parsed.success) return; // route already validated; a bad stored payload is a no-op
  const body = parsed.data;

  const attemptId = row.message_id;
  if (!attemptId) return;
  const attempt = await getCallAttemptById(attemptId);
  if (!attempt) return; // stale/deleted — no-op (caller marks processed, no retry storm)

  // Sanity-only anomaly note: the body's invitation_id should equal the token's
  // attempt id, but it is NEVER used to resolve identity. (No throw — just ignore.)
  const invitationMismatch =
    typeof body.invitation_id === 'string' && body.invitation_id !== attemptId;

  const recording = validateRecordingUrl(body.recording_url ?? null);
  const duration = typeof body.call_duration === 'number' ? body.call_duration : null;

  if (body.call_status === 'recording_started') {
    const { applied } = await recordCallOutcome(attemptId, {
      status: 'in_progress',
      recording_url: recording.url,
      recording_started_at: new Date().toISOString(),
    });
    // Only reflect "a human is on the line" if we actually advanced (not if the
    // row is already terminal from an out-of-order later callback).
    if (applied) await setContactOpStatus(attempt.contact_id, 'human_interaction_call');
    return;
  }

  if (body.call_status === 'completed') {
    // A completed call is a reached human REGARDLESS of the RSVP answer. Record
    // the outcome first (atomic, terminal).
    await recordCallOutcome(attemptId, {
      status: 'completed',
      recording_url: recording.url,
      transcript: (body.transcript ??
        null) as Database['public']['Tables']['call_attempts']['Update']['transcript'],
      rsvp_digit: body.rsvp_digit ?? null,
      rsvp_method: body.rsvp_method ?? null,
      call_duration_sec: duration,
    });

    // Audit row (idempotent: UNIQUE(channel,provider_id)). We deliberately do NOT
    // gate the side effects below on its `fresh` result: gating on `fresh` would
    // LOSE the reach/RSVP if a partial failure struck AFTER this insert but BEFORE
    // them — the webhook retry would see the row already present (fresh=false) and
    // skip billing/RSVP forever. Instead every side effect is itself idempotent, so
    // the retry safely re-runs whatever did not complete, without duplicating what
    // already did. (This is the fix that makes partial-failure recovery lossless.)
    await insertInteraction({
      event_id: attempt.event_id,
      campaign_id: attempt.campaign_id,
      contact_id: attempt.contact_id,
      channel: 'call',
      direction: 'in',
      kind: 'call_completed',
      provider_id: attemptId,
      billable: true,
    });

    // Billing — idempotent via billed_results UNIQUE(event_id,contact_id): a replay
    // returns 'already_billed' (no double charge, no op re-flip). Run unconditionally.
    await writeReach({
      eventId: attempt.event_id,
      campaignId: attempt.campaign_id,
      contactId: attempt.contact_id,
      channel: 'call',
      attemptId,
      evidence: invitationMismatch
        ? 'voximplant_call_completed_iid_mismatch'
        : 'voximplant_call_completed',
      providerRef: attemptId,
    });

    // RSVP — submit_rsvp RPC is idempotent (unchanged:true on replay). Written ONLY
    // when the contact was bound to exactly one guest at dial time (guest_id set)
    // and the digit is a validated 1/2. A missing/unsupported digit is NEVER an
    // automatic decline (the schema already guarantees 1|2 on completed).
    if (attempt.guest_id && (body.rsvp_digit === '1' || body.rsvp_digit === '2')) {
      const rsvpToken = await getGuestRsvpToken(attempt.guest_id);
      if (rsvpToken) {
        const status = body.rsvp_digit === '1' ? 'attending' : 'declined';
        const outcome = await submitRsvp(rsvpToken, {
          status,
          adults: status === 'attending' ? 1 : 0,
          kids: 0,
        });
        // Best-effort marker only when the RSVP actually CHANGED — a retry that
        // re-confirms an already-set answer (unchanged:true) must not append a
        // duplicate activity_log row.
        if (outcome.ok && !outcome.unchanged) {
          await recordRsvpFromCall(attempt.event_id, attempt.guest_id, status, attemptId);
        }
      }
    }
    return;
  }

  // Non-completed terminal outcomes: record status; reflect a reachability signal
  // only when we actually advanced the row (guards out-of-order). No billing/RSVP —
  // call_status is NOT an RSVP answer, and a recording_url is not proof of success.
  const opFor: Partial<
    Record<typeof body.call_status, Database['public']['Enums']['contact_op_status']>
  > = { no_answer: 'no_answer', no_response: 'no_answer' };
  // EVERY side effect is gated on the CAS: a stale / out-of-order callback whose
  // status transition the CAS REJECTS (applied=false) performs a FULL no-op — the
  // status row is untouched (0 rows) AND op_status is NOT written. This is the
  // requirement: a rejected transition must not flip op_status. (op_status is a
  // derived reflection of the authoritative call_attempts.status; in the rare case
  // a partial failure leaves op stale after the CAS already advanced, it is
  // recoverable from call_attempts.status — a cosmetic reconcile, not a lost
  // billing/RSVP action, both of which live only on the completed path and are
  // themselves idempotent + reached only via the webhook_inbox claim.)
  const { applied } = await recordCallOutcome(attemptId, {
    status: body.call_status,
    call_duration_sec: duration,
    recording_url: recording.url,
  });
  const op = opFor[body.call_status];
  if (applied && op) await setContactOpStatus(attempt.contact_id, op);
}
