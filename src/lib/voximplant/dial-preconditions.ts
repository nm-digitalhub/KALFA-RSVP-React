import { rsvpClosedReason, todayIL } from '@/lib/data/event-date';

// Dial preconditions for the ops launcher (scripts/voximplant/bridge-call.ts).
//
// This lives in its own module for one reason: the launcher calls main() at
// module scope, so nothing inside it can be imported by a test without dialling
// a phone. A gate that can only be verified by placing a real call is a gate
// nobody verifies — which is exactly how the launcher came to bypass every
// dispatcher check in the first place.
//
// The decision itself is rsvpClosedReason (shared with dispatchOutreachCall, so
// the two dial paths cannot disagree). All this adds is the operator-facing
// wording, kept here rather than inline so both the message and the refusal are
// covered by tests.

/** The event facts the refusal needs — the slice of CampaignContext it reads. */
export type DialEventContext = {
  eventStatus: string;
  eventDate: string | null;
  rsvpDeadline: string | null;
};

/**
 * Why this dial must be refused, phrased for an operator, or null when the call
 * is worth placing.
 *
 * A NULL context is itself a refusal: if the campaign/event cannot be loaded we
 * cannot know whether an answer is recordable, and the failure mode this whole
 * gate exists to prevent is dialling on an unverified assumption.
 */
export function closedEventRefusal(
  cctx: DialEventContext | null,
  nowMs: number = Date.now(),
): string | null {
  if (!cctx) return 'no campaign/event context could be loaded';
  switch (rsvpClosedReason(cctx, nowMs)) {
    case 'event_not_active':
      return `the event status is '${cctx.eventStatus}', not 'active'`;
    case 'past_event_day':
      return `the event day has passed (today in Israel is ${todayIL(nowMs)})`;
    case 'deadline_passed':
      return `the RSVP deadline (${cctx.rsvpDeadline}) has passed`;
    default:
      return null;
  }
}
