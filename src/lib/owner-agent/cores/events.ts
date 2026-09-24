import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import type { Enums } from '@/lib/supabase/types';
import {
  RANGE_DAYS,
  israelMidnightIso,
  rangeStartIso,
  type OwnerAgentRange,
} from '@/lib/owner-agent/range';

// Request-free CORE for the events pipeline (owner-agent tool 5,
// events_pipeline; plan §5). Takes a service-role client and returns numbers
// only. Authorization is the caller's: view_events, resolved server-side for
// the staff member (plan §3.2). No platform-level /admin reader aggregates
// events today, so there is no wrapper to share it with.
//
// No imports of the DAL or of request-scoped Next APIs (enforced by the
// `owner-agent-request-free` rule in .dependency-cruiser.cjs).
//
// Privacy: head-only counts. Decision 9.7 (recommended default, assumed): the
// answers contain NO event names — event names often carry the couple's names
// — so name, celebrants, venue, notes and every token column are never
// selected. Counts only.
//
// Dates: events.event_date is timestamptz. Every boundary below is an Israel
// midnight built by range.ts from the event-date helpers (todayIL /
// israelCalendarDay / ilWallTimeToIso) — never a UTC midnight and never a
// slice(0, 10) of a timestamptz.
//
// Two range meanings, named so a caller cannot mix them up:
//   createdInRange          — BACKWARD: events created since rangeStartIso
//                             (today = Israel midnight, 7d/30d rolling).
//   activeUpcomingInWindow  — FORWARD: active events whose Israel calendar day
//                             is within the next RANGE_DAYS days, today
//                             included (today = today only; 7d = today + 6;
//                             30d = today + 29).
//
// Errors THROW: a failed count must not reach the owner as a confident 0.

type AdminClient = ReturnType<typeof createAdminClient>;
type EventStatus = Enums<'event_status'>;
type EventType = Enums<'event_type'>;

function head(client: AdminClient) {
  return client.from('events').select('id', { count: 'exact', head: true });
}

function countOf(result: { count: number | null; error: unknown }, code: string): number {
  if (result.error) throw new Error(code);
  return result.count ?? 0;
}

export interface EventsPipelineSummary {
  // Current state (not range-bound).
  byStatus: Record<EventStatus, number>;
  activeByType: Record<EventType, number>;
  // Active events whose Israel day has already passed — they still need
  // closing. Same rule as isPastEventDay(): the event instant is before
  // today's Israel midnight; a null date is never past.
  activePastDay: number;
  activeWithoutDate: number;
  // FORWARD window (see header).
  activeUpcomingInWindow: number;
  // BACKWARD window (see header).
  createdInRange: number;
}

export async function getEventsPipelineSummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<EventsPipelineSummary> {
  const sinceIso = rangeStartIso(range, nowMs);
  const todayStartIso = israelMidnightIso(nowMs, 0);
  const windowEndIso = israelMidnightIso(nowMs, RANGE_DAYS[range]);

  const active = () => head(client).eq('status', 'active');
  const ofType = (t: EventType) => active().eq('event_type', t);

  const [
    draft,
    activeCount,
    closed,
    wedding,
    barMitzvah,
    batMitzvah,
    brit,
    britah,
    henna,
    engagement,
    birthday,
    other,
    pastDay,
    withoutDate,
    upcoming,
    created,
  ] = await Promise.all([
    head(client).eq('status', 'draft'),
    active(),
    head(client).eq('status', 'closed'),
    ofType('wedding'),
    ofType('bar_mitzvah'),
    ofType('bat_mitzvah'),
    ofType('brit'),
    ofType('britah'),
    ofType('henna'),
    ofType('engagement'),
    ofType('birthday'),
    ofType('other'),
    active().lt('event_date', todayStartIso),
    active().is('event_date', null),
    active().gte('event_date', todayStartIso).lt('event_date', windowEndIso),
    head(client).gte('created_at', sinceIso),
  ]);

  // Typed as the full enum Records: a status or type added to the database is
  // a tsc error here (missing key), not a silently uncounted bucket.
  const byStatus: Record<EventStatus, number> = {
    draft: countOf(draft, 'count_events_status_failed'),
    active: countOf(activeCount, 'count_events_status_failed'),
    closed: countOf(closed, 'count_events_status_failed'),
  };
  const activeByType: Record<EventType, number> = {
    wedding: countOf(wedding, 'count_events_type_failed'),
    bar_mitzvah: countOf(barMitzvah, 'count_events_type_failed'),
    bat_mitzvah: countOf(batMitzvah, 'count_events_type_failed'),
    brit: countOf(brit, 'count_events_type_failed'),
    britah: countOf(britah, 'count_events_type_failed'),
    henna: countOf(henna, 'count_events_type_failed'),
    engagement: countOf(engagement, 'count_events_type_failed'),
    birthday: countOf(birthday, 'count_events_type_failed'),
    other: countOf(other, 'count_events_type_failed'),
  };

  return {
    byStatus,
    activeByType,
    activePastDay: countOf(pastDay, 'count_events_past_failed'),
    activeWithoutDate: countOf(withoutDate, 'count_events_undated_failed'),
    activeUpcomingInWindow: countOf(upcoming, 'count_events_upcoming_failed'),
    createdInRange: countOf(created, 'count_events_created_failed'),
  };
}
