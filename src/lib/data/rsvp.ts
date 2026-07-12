import 'server-only';

import { randomBytes } from 'node:crypto';

import { requireEventAccess } from '@/lib/data/events';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/types';
import type { RsvpStatus, RsvpSubmitInput } from '@/lib/validation/rsvp';

// ---------------------------------------------------------------------------
// Public view shapes — mirror the jsonb returned by public.get_rsvp_by_token.
// That SECURITY DEFINER function is the ONLY path allowed to read guest data by
// token; EXECUTE is granted to service_role only, so it is reachable solely
// through the service-role client below, never from the browser or anon role.
// ---------------------------------------------------------------------------

export interface RsvpQuestion {
  q_key: string;
  label: string;
  q_type: string;
  required: boolean;
  /** When a non-empty array, the answer must be one of these values. */
  options: string[] | null;
}

export interface RsvpEventInfo {
  id: string;
  name: string;
  event_type: string | null;
  event_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  /** Schemaless celebrants jsonb — rendered per type by celebrant-display.ts. */
  celebrants: Json | null;
  /** Storage path of the uploaded invitation image; the page signs a URL. */
  invite_image_path: string | null;
  /** Gift CTA token — the RPC returns it ONLY when a payment link is set. */
  gift_link_token: string | null;
  /** 'bit' | 'paybox' | 'other' — icon selection only; never the URL itself. */
  gift_provider: string | null;
  /** Owner toggle (events.show_meal_pref): when false the form hides the
      meal-preference field and submit_rsvp ignores any submitted value. */
  show_meal_pref: boolean;
}

export interface RsvpGuestInfo {
  id: string;
  full_name: string;
  expected_count: number | null;
  status: string;
  event_id: string;
  confirmed_adults: number | null;
  confirmed_kids: number | null;
  meal_pref: string | null;
  /**
   * Guest-supplied RSVP note (guests.rsvp_note), written by submit_rsvp. The
   * owner-internal guests.note is never present in this payload.
   */
  rsvp_note: string | null;
  /**
   * Guest opt-in to appear (by first name only) in get_event_attendees_public
   * for other guests of the same event. Own-row read only — never another
   * guest's value; that visibility is served exclusively by the separate
   * get_event_attendees_public RPC.
   */
  show_in_guest_list: boolean;
  /** Prior answers, already filtered to the currently-enabled questions. */
  answers: Record<string, string>;
}

export interface RsvpView {
  guest: RsvpGuestInfo;
  event: RsvpEventInfo;
  questions: RsvpQuestion[];
  can_respond: boolean;
}

export type RsvpFailureReason =
  | 'invalid_status'
  | 'not_found'
  | 'closed'
  | 'deadline_passed'
  | 'invalid_count'
  | 'invalid_answers'
  | 'missing_required';

export type RsvpSubmitOutcome =
  | { ok: true; status: RsvpStatus; unchanged: boolean }
  | { ok: false; reason: RsvpFailureReason };

/**
 * Resolve the public RSVP view for a token, or `null` for any token that is
 * unknown, revoked, expired, or whose event is not active. The data layer
 * never distinguishes those cases to the caller — the RPC collapses them all to
 * a NULL result, so the route can return one generic, privacy-safe message.
 *
 * The token is validated server-side here (the RPC keys strictly on the exact
 * value; no listing or enumeration is possible).
 */
export async function getRsvpByToken(token: string): Promise<RsvpView | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_rsvp_by_token', {
    _token: token,
  });
  if (error) {
    throw new Error('טעינת אישור ההגעה נכשלה');
  }
  if (data == null) return null;
  // Documented boundary cast: the RPC returns `Json`; its concrete shape is
  // fixed by the function definition and modelled by RsvpView above.
  return data as unknown as RsvpView;
}

export interface RsvpAttendee {
  first_name: string;
}

/**
 * "Who's coming" opt-in list: first names of OTHER guests of the same event
 * who are `status='attending'` AND opted in via `show_in_guest_list`. Mirrors
 * getRsvpByToken's token-scoping exactly (same rsvp_token/revocation/event
 * 'active' gate) — get_event_attendees_public is, like get_rsvp_by_token, the
 * ONLY path allowed to read this, reachable solely through this service-role
 * client. Never returns phone/note/rsvp_note/meal_pref/contact_id, or any
 * non-attending guest, by construction of the RPC.
 */
export async function getEventAttendeesPublic(
  token: string,
): Promise<RsvpAttendee[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_event_attendees_public', {
    _token: token,
  });
  if (error) {
    throw new Error('טעינת רשימת המגיעים נכשלה');
  }
  return (data ?? []) as unknown as RsvpAttendee[];
}

/**
 * Submit (or idempotently re-submit) an RSVP for a token. All authorization,
 * status gating, count/answer validation, and atomicity live inside
 * submit_rsvp; this maps its jsonb result to a typed outcome and records a
 * best-effort, PII-free audit row on success.
 */
export async function submitRsvp(
  token: string,
  input: RsvpSubmitInput,
): Promise<RsvpSubmitOutcome> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('submit_rsvp', {
    _token: token,
    _status: input.status,
    _adults: input.adults,
    _kids: input.kids,
    _meal: input.meal_pref ?? '',
    _note: input.note ?? '',
    _answers: (input.answers ?? {}) as Json,
    _show_in_list: input.show_in_guest_list ?? false,
  });
  if (error) {
    throw new Error('שליחת אישור ההגעה נכשלה');
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    status?: string;
    unchanged?: boolean;
  };

  if (result.ok) {
    const unchanged = result.unchanged === true;
    // Fire-and-forget audit; a failure here must never fail a successful RSVP.
    void recordRsvpAudit(supabase, token, input.status, unchanged);
    return { ok: true, status: input.status, unchanged };
  }
  return { ok: false, reason: (result.reason ?? 'not_found') as RsvpFailureReason };
}

/**
 * Best-effort, event-scoped, PII-free audit of a successful anonymous RSVP.
 *
 * `logActivity` is intentionally NOT reused here: it calls requireUser() and
 * writes through the request-scoped RLS client — neither exists on the
 * anonymous public RSVP path. Different context, not duplication. The
 * authoritative per-guest record is `rsvp_responses`, written atomically inside
 * submit_rsvp; this row only feeds the ops activity feed. submit_rsvp does not
 * return the ids, so we resolve them with a single indexed lookup by token.
 */
async function recordRsvpAudit(
  supabase: ReturnType<typeof createAdminClient>,
  token: string,
  status: RsvpStatus,
  unchanged: boolean,
): Promise<void> {
  type ActivityLogInsert =
    Database['public']['Tables']['activity_log']['Insert'];
  try {
    const { data: guest } = await supabase
      .from('guests')
      .select('id, event_id')
      .eq('rsvp_token', token)
      .maybeSingle();
    if (!guest) return;

    const meta = { guest_id: guest.id, status, unchanged };
    const row: ActivityLogInsert = {
      event_id: guest.event_id,
      user_id: null,
      action: 'rsvp.submitted',
      // Identifiers + a status string only — never names, notes, or the token.
      meta: meta as unknown as ActivityLogInsert['meta'],
    };
    await supabase.from('activity_log').insert(row);
  } catch {
    // Deliberately swallowed: auditing is non-fatal and never logs PII.
  }
}

// ---------------------------------------------------------------------------
// Guest-detail RSVP link helpers. The RSVP token is a bearer secret, so
// reading, revoking, and regenerating it all require guests.edit. Each
// helper re-verifies access server-side before touching the token via the
// service-role client.
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
