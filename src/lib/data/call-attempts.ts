import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';

// Request-FREE service-role DAL for the Voximplant AI-call `call_attempts` table.
// Imported by the ctx/cb route handlers + the call-result processor (and, later,
// the outbound trigger). Never logs the access_token, recording_url, or
// transcript (all sensitive). Identity ALWAYS comes from the server-verified
// call_attempt_id (from the signed token) — never from client-supplied ids.

type CallAttemptRow = Database['public']['Tables']['call_attempts']['Row'];
type CallAttemptInsert = Database['public']['Tables']['call_attempts']['Insert'];

// Terminal call outcomes — an older/out-of-order callback must never downgrade a
// row that already reached one of these (requirement D).
const TERMINAL_STATUSES = [
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
    'id' | 'status' | 'token_expires_at' | 'guest_id' | 'event_id' | 'contact_id'
  >;
  event: {
    status: string;
    name: string;
    event_date: string | null;
    venue_name: string | null;
  };
  guestFullName: string | null;
};

// Load the minimal ctx context for a verified call_attempt_id. READ-ONLY (the ctx
// endpoint never mutates). Returns null when the id matches no row. Never selects
// PII beyond the guest's display name (no phone, no rsvp_token, no org id).
export async function getCallContextById(id: string): Promise<CallContext | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from('call_attempts')
    .select('id, status, token_expires_at, guest_id, event_id, contact_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  if (!attempt) return null;

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
