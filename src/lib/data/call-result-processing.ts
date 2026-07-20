import 'server-only';

import type { Database } from '@/lib/supabase/types';
import {
  getCallAttemptById,
  recordRsvpCallRejected,
  getContactNormalizedPhone,
  getGuestRsvpToken,
  recordCallOutcome,
  recordRsvpFromCall,
} from '@/lib/data/call-attempts';
import { createAdminClient } from '@/lib/supabase/admin';
import { insertInteraction, setContactOpStatus } from '@/lib/data/interactions';
import { writeReach } from '@/lib/data/outreach-engine';
import { submitRsvp, type RsvpFailureReason } from '@/lib/data/rsvp';
import { validateRecordingUrl } from '@/lib/voximplant/recording-url';
import {
  voxCallbackSchema,
  voxMarkDncSchema,
  voxNotifyOwnerSchema,
  voxSaveRsvpSchema,
  voxSaveRsvpStatus,
  type VoxNotifyOwner,
  type VoxSaveRsvp,
} from '@/lib/validation/voximplant';

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
    // automatic decline (the schema guarantees 1|2 on completed UNLESS
    // rsvp_method==='agent' — the ElevenLabs bridge path, whose RSVP was already
    // written in-call by save_rsvp with real counts; skipping here is what keeps
    // those counts from being overwritten with the 1/0 digit defaults).
    if (
      attempt.guest_id &&
      body.rsvp_method !== 'agent' &&
      (body.rsvp_digit === '1' || body.rsvp_digit === '2')
    ) {
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
  // Persist the disposition too. The scenario reports the SIP code as
  // error_reason ('sip_408' / 'sip_486' / 'sip_603' …) — that is what separates
  // "no one picked up, try again" from "the number does not exist, fix the
  // list". The schema has always accepted the field; it was simply dropped here.
  const { applied } = await recordCallOutcome(attemptId, {
    status: body.call_status,
    call_duration_sec: duration,
    recording_url: recording.url,
    finish_reason: body.error_reason ?? null,
  });
  const op = opFor[body.call_status];
  if (applied && op) await setContactOpStatus(attempt.contact_id, op);
}

// Tier 2: apply ONE `save_rsvp` client-tool call. Called synchronously by the
// agent-tool route (so the agent gets a truthful ok/fail for its confirmation
// wording) AND idempotently by the webhook drain (event_kind==='call_rsvp') as the
// durable retry path. Writes ONLY the RSVP answer + real adult/child counts through
// the same atomic submit_rsvp RPC the public form uses — it does NOT bill (billing
// stays on the call-completed path, per-reached, once). Identity is the resolved
// attempt (token-verified upstream), never the payload. submit_rsvp is
// idempotent-by-value (last write wins), so a corrected count simply overwrites.
/**
 * What actually happened to one `save_rsvp` call. Two orthogonal facts are kept
 * separate on purpose, because collapsing them into a boolean is what let a
 * permanently-refused RSVP be reported to a guest as registered (session
 * 6866346068, 2026-07-19):
 *
 *   - `saved`    — terminal. The RSVP is applied. ONLY this may be voiced as
 *                  "נרשם"/"נשמר".
 *   - `rejected` — terminal. `submit_rsvp` refused on business grounds (past
 *                  event, passed deadline, unknown guest, impossible count).
 *                  Retrying can never change the answer, so the drain must close
 *                  the row — but it MUST record the reason, or the refusal
 *                  becomes invisible.
 *
 * A transient failure is NOT represented here: it is thrown, so the drain's
 * existing retry path handles it. That keeps "retryable" expressible exactly
 * once, in one mechanism.
 */
export type RsvpApplyOutcome =
  | { status: 'saved' }
  | { status: 'rejected'; reason: RsvpFailureReason };

export async function processCallRsvp(
  attemptId: string,
  body: VoxSaveRsvp,
): Promise<RsvpApplyOutcome> {
  const attempt = await getCallAttemptById(attemptId);
  // Written ONLY when the contact was bound to exactly one guest at dial time.
  // An attempt with no bound guest can never gain one, so this is terminal, not
  // a transient miss the drain could recover from.
  if (!attempt?.guest_id) return { status: 'rejected', reason: 'not_found' };
  const rsvpToken = await getGuestRsvpToken(attempt.guest_id);
  if (!rsvpToken) return { status: 'rejected', reason: 'not_found' };

  // Canonical status (attending/declined/maybe — conversation-design §4.2).
  // Counts are meaningful only for attending; declined/maybe carry none (same
  // convention as the WhatsApp quick-reply path).
  const status = voxSaveRsvpStatus(body);
  const attending = status === 'attending';
  // submitRsvp throws only on an RPC transport error — that propagates and is
  // classified by the caller as retryable. A returned `ok:false` is the RPC's
  // considered business refusal, which no amount of retrying will change.
  const outcome = await submitRsvp(rsvpToken, {
    status,
    adults: attending ? body.adults : 0,
    kids: attending ? body.children : 0, // submit_rsvp param is `kids`
  });
  if (!outcome.ok) {
    // Record the refusal through the SAME event-scoped activity channel the
    // success path uses, so it surfaces to the owner instead of dying inside a
    // queue row. Both callers (route + drain) get this for free.
    await recordRsvpCallRejected(
      attempt.event_id,
      attempt.guest_id,
      status,
      outcome.reason,
      attemptId,
    );
    return { status: 'rejected', reason: outcome.reason };
  }
  // Best-effort source marker only when the RSVP actually CHANGED (a re-confirm of
  // the same answer is unchanged:true → no duplicate activity_log row).
  if (!outcome.unchanged) {
    await recordRsvpFromCall(attempt.event_id, attempt.guest_id, status, attemptId);
  }
  return { status: 'saved' };
}

// `mark_dnc` (conversation-design §4.2, legally critical): the guest asked mid-call
// not to be called again. Resolves attempt → contact → normalized phone and upserts
// it into call_dnc_list — the SAME canonical key the dispatcher's isDncListed gate
// matches on, so the very next dial attempt to this number is skipped. Guest-
// initiated (no admin session): written via the service-role client; added_by stays
// null (the reason string marks provenance). Idempotent: re-adding is an upsert.
export async function processCallDnc(attemptId: string): Promise<{ ok: boolean }> {
  const attempt = await getCallAttemptById(attemptId);
  if (!attempt) return { ok: false };
  const normalized = await getContactNormalizedPhone(attempt.contact_id);
  if (!normalized) return { ok: false };

  const admin = createAdminClient();
  const { error } = await admin.from('call_dnc_list').upsert(
    { normalized_phone: normalized, reason: 'בקשת אורח בשיחה קולית' },
    { onConflict: 'normalized_phone' },
  );
  if (error) return { ok: false };
  return { ok: true };
}

export async function processCallDncRow(row: WebhookInboxRow): Promise<void> {
  const parsed = voxMarkDncSchema.safeParse(row.payload);
  if (!parsed.success) return;
  if (!row.message_id) return;
  await processCallDnc(row.message_id);
}

// `notify_owner` (conversation-design §4.2): relay a guest question/message/flag to
// the event owner via the event's activity log (the same PII-discipline as
// recordRsvpFromCall: guest-authored text only, never phone/transcript/recording).
export async function processOwnerNote(
  attemptId: string,
  body: VoxNotifyOwner,
): Promise<{ ok: boolean }> {
  const attempt = await getCallAttemptById(attemptId);
  if (!attempt) return { ok: false };

  type ActivityLogInsert = Database['public']['Tables']['activity_log']['Insert'];
  const admin = createAdminClient();
  const meta = {
    kind: body.kind,
    text: body.text,
    guest_id: attempt.guest_id,
    call_attempt_id: attemptId,
  };
  const row: ActivityLogInsert = {
    event_id: attempt.event_id,
    user_id: null,
    action: 'call.owner_note',
    meta: meta as unknown as ActivityLogInsert['meta'],
  };
  const { error } = await admin.from('activity_log').insert(row);
  if (error) return { ok: false };
  return { ok: true };
}

export async function processOwnerNoteRow(row: WebhookInboxRow): Promise<void> {
  const parsed = voxNotifyOwnerSchema.safeParse(row.payload);
  if (!parsed.success) return;
  if (!row.message_id) return;
  await processOwnerNote(row.message_id, parsed.data);
}

// Drain entry for a persisted `call_rsvp` row (identity from row.message_id = the
// token-verified attempt id). Parses the stored body and delegates; a bad stored
// payload is a no-op (the route already validated it).
export async function processCallRsvpRow(row: WebhookInboxRow): Promise<void> {
  const parsed = voxSaveRsvpSchema.safeParse(row.payload);
  // A stored payload that no longer validates can never start validating; close
  // the row with the reason rather than looping or silently dropping it.
  if (!parsed.success) return;
  const attemptId = row.message_id;
  if (!attemptId) return;
  // The outcome is no longer discarded: processCallRsvp records a refusal to the
  // event-scoped activity_log before returning, so a rejected RSVP is visible to
  // the owner instead of vanishing behind a row marked processed.
  await processCallRsvp(attemptId, parsed.data);
}
