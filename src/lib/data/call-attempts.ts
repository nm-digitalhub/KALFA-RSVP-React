import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';

// Request-FREE service-role DAL for the Voximplant AI-call `call_attempts` table.
// Imported by the ctx/cb route handlers + the call-result processor (and, later,
// the outbound trigger). Never logs the access_token, recording_url, or
// transcript (all sensitive). Identity ALWAYS comes from a server-side lookup —
// the attempt id, or (Branch B) the row's opaque access_token — never from
// client-supplied ids in a callback body.

type CallAttemptRow = Database['public']['Tables']['call_attempts']['Row'];
type CallAttemptInsert = Database['public']['Tables']['call_attempts']['Insert'];

// Terminal call outcomes — an older/out-of-order callback must never downgrade a
// row that already reached one of these (requirement D). Exported so the log
// export job (plan A4) reuses the SAME set instead of redeclaring it.
export const TERMINAL_STATUSES = [
  'completed',
  'failed',
  'no_answer',
  'no_response',
  'cancelled',
] as const;
const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_STATUSES);
const PRE_TERMINAL = ['queued', 'dialing', 'in_progress'] as const;

export type CreateCallAttemptInput = {
  eventId: string;
  campaignId: string;
  contactId: string;
  guestId: string | null; // null when the contact backs != 1 guest (ambiguous)
  touchpointIndex: number;
  accessToken: string; // opaque per-call nonce stored on the row (unique)
  tokenExpiresAt: string; // ISO timestamptz
  // Optional NON-authorizing correlation nonce for ElevenLabs-bridged calls
  // (item-2 link vector). Set at creation so every attempt is link-ready; the
  // partial-unique index enforces one-nonce-one-attempt. Omitted ⇒ column stays
  // NULL (harmless for the Groq/DTMF Branch B path, which never reads it).
  elCorrelationNonce?: string;
};

// Insert a fresh attempt row (used by the future outbound trigger). Returns
// { id } on success, or null if a row already exists for this (campaign, contact,
// touchpoint) — the unique constraint is the idempotency guard.
export async function createCallAttempt(
  input: CreateCallAttemptInput,
): Promise<{ id: string } | null> {
  const admin = createAdminClient();
  const row: CallAttemptInsert = {
    event_id: input.eventId,
    campaign_id: input.campaignId,
    contact_id: input.contactId,
    guest_id: input.guestId,
    touchpoint_index: input.touchpointIndex,
    access_token: input.accessToken,
    token_expires_at: input.tokenExpiresAt,
    status: 'dialing',
    ...(input.elCorrelationNonce ? { el_correlation_nonce: input.elCorrelationNonce } : {}),
  };
  const { data, error } = await admin
    .from('call_attempts')
    .upsert(row, {
      onConflict: 'campaign_id,contact_id,touchpoint_index',
      ignoreDuplicates: true,
    })
    .select('id')
    .maybeSingle();
  if (error) throw new Error('יצירת ניסיון השיחה נכשלה');
  if (!data) return null;
  return { id: data.id };
}

export type CallContext = {
  attempt: Pick<
    CallAttemptRow,
    | 'id'
    | 'status'
    | 'token_expires_at'
    | 'guest_id'
    | 'event_id'
    | 'contact_id'
    // Non-authorizing correlation nonce (nullable) — surfaced by the ctx route as
    // `kalfa_attempt_token` for ElevenLabs-bridged calls so the post-call webhook
    // can link the conversation back to this attempt. Additive; Branch B ignores it.
    | 'el_correlation_nonce'
  >;
  event: {
    status: string;
    name: string;
    event_date: string | null;
    venue_name: string | null;
  };
  guestFullName: string | null;
};

type CallAttemptContextRow = Pick<
  CallAttemptRow,
  | 'id'
  | 'status'
  | 'token_expires_at'
  | 'guest_id'
  | 'event_id'
  | 'contact_id'
  | 'el_correlation_nonce'
>;
const CTX_SELECT =
  'id, status, token_expires_at, guest_id, event_id, contact_id, el_correlation_nonce';

// Hydrate the event + guest-name half of a CallContext from an already-loaded
// attempt row. Shared by the by-id and by-access-token loaders. Never selects PII
// beyond the guest's display name (no phone, no rsvp_token, no org id).
async function hydrateCallContext(
  attempt: CallAttemptContextRow,
): Promise<CallContext | null> {
  const admin = createAdminClient();
  const { data: event, error: evErr } = await admin
    .from('events')
    .select('status, name, event_date, venue_name')
    .eq('id', attempt.event_id)
    .maybeSingle();
  if (evErr) throw new Error('טעינת האירוע נכשלה');
  if (!event) return null;

  let guestFullName: string | null = null;
  if (attempt.guest_id) {
    const { data: guest } = await admin
      .from('guests')
      .select('full_name')
      .eq('id', attempt.guest_id)
      .maybeSingle();
    guestFullName = guest?.full_name ?? null;
  }

  return {
    attempt,
    event: {
      status: event.status,
      name: event.name,
      event_date: event.event_date,
      venue_name: event.venue_name,
    },
    guestFullName,
  };
}

// Load the minimal ctx context for a verified call_attempt_id. READ-ONLY (the ctx
// endpoint never mutates). Returns null when the id matches no row.
export async function getCallContextById(id: string): Promise<CallContext | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from('call_attempts')
    .select(CTX_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  if (!attempt) return null;
  return hydrateCallContext(attempt);
}

// Branch B: the ctx endpoint is authenticated by the row's opaque per-call
// access_token (128-bit, UNIQUE, unguessable — the same bearer model as
// guests.rsvp_token), NOT a signed token, so the scenario payload can stay tiny
// (< 200-byte VoxEngine.customData() cap). Look the attempt up by that token; the
// route still re-checks expiry, event status, and terminal state on the row.
export async function getCallContextByAccessToken(
  accessToken: string,
): Promise<CallContext | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from('call_attempts')
    .select(CTX_SELECT)
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  if (!attempt) return null;
  return hydrateCallContext(attempt);
}

// Branch B (cb endpoint): resolve the attempt id + expiry from the opaque
// access_token. Identity for the callback ALWAYS comes from this server-side
// lookup — never from the POSTed body.
export async function getCallAttemptByAccessToken(
  accessToken: string,
): Promise<{ id: string; token_expires_at: string | null } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('call_attempts')
    .select('id, token_expires_at')
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  return data ?? null;
}

// Normalized phone of a contact (for the guest-initiated DNC tool: the stored
// call_dnc_list key MUST be the same canonical form isDncListed matches on).
export async function getContactNormalizedPhone(contactId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contacts')
    .select('normalized_phone')
    .eq('id', contactId)
    .maybeSingle();
  if (error) throw new Error('טעינת איש הקשר נכשלה');
  return data?.normalized_phone ?? null;
}

// Full row by id (for the cb processor — identity from the token, never the body).
export async function getCallAttemptById(id: string): Promise<CallAttemptRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('call_attempts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  return data;
}

// The RSVP token for a bound guest (only ever the guest_id stored on the attempt).
export async function getGuestRsvpToken(guestId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('guests')
    .select('rsvp_token')
    .eq('id', guestId)
    .maybeSingle();
  if (error) throw new Error('טעינת האורח נכשלה');
  return data?.rsvp_token ?? null;
}

export type CallOutcomePatch = {
  status: CallAttemptRow['status'];
  recording_url?: string | null;
  transcript?: Database['public']['Tables']['call_attempts']['Update']['transcript'];
  rsvp_digit?: string | null;
  rsvp_method?: string | null;
  call_duration_sec?: number | null;
  finish_reason?: string | null;
  recording_started_at?: string | null;
};

// Atomically record a callback outcome with a compare-and-set guard so a stale or
// out-of-order callback cannot downgrade a row that already reached a terminal
// state. Returns { applied } — false means the write was a safe no-op (already
// terminal / not in a valid prior state). No read-then-write.
export async function recordCallOutcome(
  id: string,
  patch: CallOutcomePatch,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const base = admin
    .from('call_attempts')
    .update({ ...patch, last_callback_at: now, updated_at: now })
    .eq('id', id);
  const guarded = TERMINAL_SET.has(patch.status)
    ? // moving to a terminal state: only if not already terminal
      base.not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
    : // non-terminal (e.g. recording_started): only advance from a pre-terminal state
      base.in('status', PRE_TERMINAL as unknown as string[]);
  const { data, error } = await guarded.select('id').maybeSingle();
  if (error) throw new Error('רישום תוצאת השיחה נכשל');
  return { applied: data !== null };
}

// PII-free source marker, mirroring recordRsvpFromWhatsapp: record that an RSVP
// was captured from an AI call. Never stores the transcript/recording/phone.
export async function recordRsvpFromCall(
  eventId: string,
  guestId: string,
  status: string,
  callAttemptId: string,
): Promise<void> {
  type ActivityLogInsert = Database['public']['Tables']['activity_log']['Insert'];
  try {
    const admin = createAdminClient();
    const meta = { guest_id: guestId, status, call_attempt_id: callAttemptId };
    const row: ActivityLogInsert = {
      event_id: eventId,
      user_id: null,
      action: 'rsvp.from_call',
      meta: meta as unknown as ActivityLogInsert['meta'],
    };
    await admin.from('activity_log').insert(row);
  } catch {
    // Deliberately swallowed: the marker is non-fatal and never logs PII.
  }
}

// --- Rate-limit counters (H1) ------------------------------------------------

// Durable (DB) counters backing the concurrency + hourly-per-campaign caps.
// A per-process rate limiter is not sufficient (multiple workers / restarts),
// so these count real rows. The active set is the exact non-terminal set of
// call_attempts_stale_idx. head:true + count:'exact' → COUNT(*), no row payload.
export async function countActiveCalls(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('call_attempts')
    .select('id', { count: 'exact', head: true })
    .in('status', PRE_TERMINAL as unknown as string[]);
  if (error) throw new Error('count_active_failed');
  return count ?? 0;
}

// Count attempts created for one campaign since an ISO cutoff (the rolling
// 1-hour window for the per-campaign hourly cap).
export async function countCampaignCallsSince(
  campaignId: string,
  sinceIso: string,
): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('call_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .gte('created_at', sinceIso);
  if (error) throw new Error('count_campaign_failed');
  return count ?? 0;
}

// --- Outbound-trigger (Stage 3) helpers --------------------------------------

// The full row for a (campaign, contact, touchpoint) — used by the dispatcher to
// reconcile a lost createCallAttempt race (never a redial). Keyed on the same
// UNIQUE constraint createCallAttempt upserts against.
export async function getCallAttemptByTouchpoint(
  campaignId: string,
  contactId: string,
  touchpointIndex: number,
): Promise<CallAttemptRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('call_attempts')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .eq('touchpoint_index', touchpointIndex)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  return data;
}

// Record a CONFIRMED StartScenarios start (result===1 && call_session_history_id).
// Writes the provider identity columns; does NOT change `status` (the row stays
// 'dialing' — the real state transition arrives later from the cb callback).
// Guarded WHERE status IN PRE_TERMINAL so a callback that already advanced the row
// to a terminal state is never clobbered (no read-then-write).
export async function recordDialConfirmed(
  id: string,
  ids: { callSessionHistoryId: number; mediaSessionAccessUrl?: string | null },
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('call_attempts')
    .update({
      vox_call_session_history_id: String(ids.callSessionHistoryId),
      media_session_access_url: ids.mediaSessionAccessUrl ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', PRE_TERMINAL as unknown as string[])
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום אימות החיוג נכשל');
  return { applied: data !== null };
}

// Definite provider rejection (VoximplantApiError). Non-retryable. Both this and
// markStartUnknown reuse recordCallOutcome's CAS: 'failed_to_start'/'start_unknown'
// are NOT in TERMINAL_SET, so a late legitimate cb callback can still resolve the
// row to a real terminal status afterward.
export async function markFailedToStart(
  id: string,
  reason: string,
): Promise<{ applied: boolean }> {
  return recordCallOutcome(id, { status: 'failed_to_start', finish_reason: reason });
}

// Ambiguous StartScenarios outcome (network/timeout/5xx-after-send/result!==1/
// result===1 without a history id). NEVER triggers a redial.
export async function markStartUnknown(
  id: string,
  reason: string,
): Promise<{ applied: boolean }> {
  return recordCallOutcome(id, { status: 'start_unknown', finish_reason: reason });
}

// --- ElevenLabs bridge correlation (item-2 link vector) ----------------------

// Stamp a NON-authorizing correlation nonce onto an attempt so an ElevenLabs-
// bridged call can be linked back from the post-call webhook (which echoes it as
// conversation_initiation_client_data.dynamic_variables.kalfa_attempt_token). The
// nonce grants no capability — leaking it exposes nothing (see the migration
// comment) — but it is still a correlation id, so it is never logged.
//
// FIRST-WRITER-WINS + idempotent: only sets it WHERE el_correlation_nonce IS NULL,
// so a re-run reuses the existing nonce and never fights the partial-unique index
// (call_attempts_el_correlation_nonce_key). Returns the EFFECTIVE nonce on the row
// after the call (the one we set, or a pre-existing one), or null if the row is
// gone. Service-role; request-free (safe for the bundled launcher + worker).
export async function stampElCorrelationNonce(
  id: string,
  nonce: string,
): Promise<{ nonce: string } | null> {
  const admin = createAdminClient();
  // Claim the nonce only if unset — race-safe under the partial-unique index.
  const { error: upErr } = await admin
    .from('call_attempts')
    .update({ el_correlation_nonce: nonce, updated_at: new Date().toISOString() })
    .eq('id', id)
    .is('el_correlation_nonce', null);
  if (upErr) throw new Error('רישום מזהה הקורלציה נכשל');
  // Read back the effective value (ours, or a pre-existing one from a prior run).
  const { data, error } = await admin
    .from('call_attempts')
    .select('el_correlation_nonce')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('רישום מזהה הקורלציה נכשל');
  if (!data?.el_correlation_nonce) return null;
  return { nonce: data.el_correlation_nonce };
}

// Store the ElevenLabs conversation_id on the attempt (item-2 SECOND link vector,
// belt-and-suspenders with the correlation nonce). Called best-effort from the cb
// route when the bridge scenario reports it. Identity is the token-resolved
// attempt id, never the body. Idempotent by nature (a re-report writes the same id).
export async function setElConversationId(
  id: string,
  elConversationId: string,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('call_attempts')
    .update({
      el_conversation_id: elConversationId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום מזהה השיחה נכשל');
  return { applied: data !== null };
}

// schedule_callback (combination feature): persist a guest's request to be called
// back later. Identity is the token-resolved attempt id (never the body). Works
// TODAY via a durable, event-scoped activity_log row; ADDITIONALLY writes the
// requested time onto the attempt for the future re-dispatch — those columns land
// via a SEPARATE migration (handed to schema/RLS), so the write is
// forward-compatible (`as never`, like setElConversationId) and its failure is a
// caught no-op. Re-enqueuing the actual call is a KALFA dispatcher follow-up.
export async function recordCallbackRequest(
  id: string,
  whenText: string,
  callbackIso: string | null,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const attempt = await getCallAttemptById(id);
  if (!attempt) return { applied: false };

  // Durable record that works before the migration lands (activity_log exists).
  type ActivityLogInsert = Database['public']['Tables']['activity_log']['Insert'];
  const meta = { call_attempt_id: id, when_text: whenText, callback_iso: callbackIso };
  const logRow: ActivityLogInsert = {
    event_id: attempt.event_id,
    user_id: null,
    action: 'call.callback_requested',
    meta: meta as unknown as ActivityLogInsert['meta'],
  };
  await admin.from('activity_log').insert(logRow);

  // Stamp the requested time on the attempt for the future re-dispatch.
  // callback_iso is timestamptz, so only write a PARSEABLE value (else null) — a
  // malformed ISO from the agent must never fail the whole update. Best-effort;
  // the activity_log row above is the authoritative record.
  const iso = callbackIso && !Number.isNaN(Date.parse(callbackIso)) ? callbackIso : null;
  await admin
    .from('call_attempts')
    .update({
      callback_requested_at: new Date().toISOString(),
      callback_when_text: whenText,
      callback_iso: iso,
    })
    .eq('id', id);

  return { applied: true };
}
