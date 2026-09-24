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
// PENDING MIGRATION — the PEOPLE sums. Rows are counted below; people are a
// SUM (a row may stand for a family), with the guest_totals definitions:
//   invited people   = greatest(coalesce(expected_count, 1), 1)
//   attending people = guest_effective_attending(g)
// PostgREST aggregates are disabled on this project (measured 2026-09-24), so
// they live in public.owner_agent_rsvp_people_totals(), in
// supabase/migrations/20260924061630_owner_agent_read_aggregates.sql, NOT
// applied. After it is applied and types.generated.ts regenerated, this core
// adds one `.rpc('owner_agent_rsvp_people_totals')` call and two number fields.
//
// Errors THROW: a failed count must not reach the owner as a confident 0.

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
}

export async function getRsvpTotals(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<RsvpTotals> {
  const sinceIso = rangeStartIso(range, nowMs);
  const [activeEvents, guestRows, attending, declined, maybe, pending, responses] =
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
    ]);
  return {
    activeEvents: countOf(activeEvents, 'count_active_events_failed'),
    guestRows: countOf(guestRows, 'count_guests_failed'),
    attending: countOf(attending, 'count_guests_attending_failed'),
    declined: countOf(declined, 'count_guests_declined_failed'),
    maybe: countOf(maybe, 'count_guests_maybe_failed'),
    pending: countOf(pending, 'count_guests_pending_failed'),
    responsesInRange: countOf(responses, 'count_rsvp_responses_failed'),
  };
}
