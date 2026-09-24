import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

// Request-free CORE for RSVP totals across ACTIVE events (owner-agent tool 6,
// rsvp_totals; plan §5). Takes a service-role client and returns numbers only.
// Authorization is the caller's: view_events, resolved server-side for the
// staff member (plan §3.2). The per-event reader (event-stats.ts getEventStats)
// sits behind requireEventAccess and is per event, so it is not looped here.
//
// No imports of the DAL or of request-scoped Next APIs (enforced by the
// `owner-agent-request-free` rule in .dependency-cruiser.cjs).
//
// Privacy: head-only counts. The embed `events!inner(status)` is there only to
// filter on the event's status; with `head: true` no row, and so no guest name,
// phone, note, meal preference or rsvp_token, leaves the database. No event
// name either (decision 9.7, assumed default: counts only).
//
// "Active" = events.status = 'active', the state in which RSVP is open (see
// rsvpClosedReason in event-date.ts). An active event whose day has passed but
// that was not closed yet still counts here; events_pipeline reports how many
// of those exist (activePastDay).
//
// The PEOPLE sums come from ONE rpc. Rows are counted below; people are a SUM
// (a row may stand for a family), with the guest_totals definitions:
//   invited people   = greatest(coalesce(expected_count, 1), 1)
//   attending people = guest_effective_attending(g)
// PostgREST aggregates are disabled on this project (measured 2026-09-24), so
// they come from public.owner_agent_rsvp_people_totals(), in
// supabase/migrations/20260924061630_owner_agent_read_aggregates.sql — applied,
// with its types in types.generated.ts.
//
// Errors THROW: a failed count or sum must not reach the owner as a confident 0.

type AdminClient = ReturnType<typeof createAdminClient>;

// Guests of active events, head-only. `status` below is the GUEST status; the
// embedded `events.status` is the event's.
function activeGuests(client: AdminClient) {
  return client
    .from('guests')
    .select('id, events!inner(status)', { count: 'exact', head: true })
    .eq('events.status', 'active');
}

function countOf(result: { count: number | null; error: unknown }, code: string): number {
  if (result.error) throw new Error(code);
  return result.count ?? 0;
}

// Exactly one row of two non-negative integers, or a bare code — never a
// guessed number.
function people(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('rsvp_people_totals_unexpected');
  }
  return value;
}

async function peopleTotals(client: AdminClient) {
  const { data, error } = await client.rpc('owner_agent_rsvp_people_totals');
  if (error) throw new Error('rsvp_people_totals_failed');
  if (!Array.isArray(data) || data.length !== 1) throw new Error('rsvp_people_totals_unexpected');
  const [row] = data;
  return { invitedPeople: people(row.invited_people), attendingPeople: people(row.attending_people) };
}

export interface RsvpTotals {
  // Current state across active events (not range-bound).
  activeEvents: number;
  guestRows: number;
  attending: number;
  declined: number;
  maybe: number;
  pending: number;
  // RSVP submissions recorded (rsvp_responses, written by submit_rsvp) for
  // active events within the range.
  responsesInRange: number;
  // PEOPLE, not rows, across active events (current state), with the
  // guest_totals definitions (owner_agent_rsvp_people_totals).
  invitedPeople: number;
  attendingPeople: number;
}

export async function getRsvpTotals(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<RsvpTotals> {
  const sinceIso = rangeStartIso(range, nowMs);
  const [activeEvents, guestRows, attending, declined, maybe, pending, responses, totals] =
    await Promise.all([
      client
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      activeGuests(client),
      activeGuests(client).eq('status', 'attending'),
      activeGuests(client).eq('status', 'declined'),
      activeGuests(client).eq('status', 'maybe'),
      activeGuests(client).eq('status', 'pending'),
      client
        .from('rsvp_responses')
        .select('id, events!inner(status)', { count: 'exact', head: true })
        .eq('events.status', 'active')
        .gte('created_at', sinceIso),
      peopleTotals(client),
    ]);
  return {
    activeEvents: countOf(activeEvents, 'count_active_events_failed'),
    guestRows: countOf(guestRows, 'count_guests_failed'),
    attending: countOf(attending, 'count_guests_attending_failed'),
    declined: countOf(declined, 'count_guests_declined_failed'),
    maybe: countOf(maybe, 'count_guests_maybe_failed'),
    pending: countOf(pending, 'count_guests_pending_failed'),
    responsesInRange: countOf(responses, 'count_rsvp_responses_failed'),
    invitedPeople: totals.invitedPeople,
    attendingPeople: totals.attendingPeople,
  };
}
