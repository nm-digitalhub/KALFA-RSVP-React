// Single source of truth for the RSVP quick-reply button protocol. The OUTBOUND
// payloads (injected per-send as template quick-reply button parameters, in the
// Meta-approved button order) and the INBOUND map (webhook resolves button.payload
// -> RsvpStatus) BOTH derive from this one list, so send and receive can never
// drift. Meta stores NO payload on a template QUICK_REPLY button, so it must be
// supplied per-send and returns as button.payload on the tap (empirically verified
// 2026-07-07: without it a tap echoes the Hebrew LABEL and the inbound map misses).
//
// Type-only import (erased at build) so the pg-boss worker can bundle client.ts.
// RsvpStatus's canonical home is the pure constants module (RSVP_STATUSES).
import type { RsvpStatus } from '@/lib/constants';

// Order MUST match the approved template button order (button index 0..2):
//   מגיע/ה -> attending · לא מגיע/ה -> declined · אולי -> maybe.
export const RSVP_QUICK_REPLY: ReadonlyArray<{ payload: string; status: RsvpStatus }> = [
  { payload: 'rsvp_attending', status: 'attending' },
  { payload: 'rsvp_declined', status: 'declined' },
  { payload: 'rsvp_maybe', status: 'maybe' },
];

// Outbound: the payloads in button order (one PayloadComponent per index).
export const RSVP_QUICK_REPLY_PAYLOADS: readonly string[] = RSVP_QUICK_REPLY.map(
  (b) => b.payload,
);

// Inbound: button.payload -> RsvpStatus (used by webhook-processing).
export const RSVP_BUTTON_MAP: Record<string, RsvpStatus> = Object.fromEntries(
  RSVP_QUICK_REPLY.map((b) => [b.payload, b.status]),
);
