// Pure §10 schedule math for the outreach engine — no I/O, fully unit-testable.
// Times are derived from the live event_date so a date edit re-targets all
// touchpoints. `nowMs`/`eventDateIso` are passed in (the worker supplies them).

import { createHash } from 'node:crypto';

export type Touchpoint = {
  days_before: number;
  channel: string;
  message_key: string;
};

const DAY_MS = 86_400_000;

// When a touchpoint fires: event_date − days_before days.
export function touchpointTime(eventDateIso: string, daysBefore: number): Date {
  return new Date(new Date(eventDateIso).getTime() - daysBefore * DAY_MS);
}

// The smallest index AFTER `afterIndex` whose touchpoint is still in the future
// (> now). null when none remain. Order is NOT assumed — all indices are scanned.
export function nextTouchpointIndex(
  schedule: Touchpoint[],
  eventDateIso: string,
  afterIndex: number,
  nowMs: number,
): number | null {
  let best: number | null = null;
  let bestTime = Infinity;
  for (let i = 0; i < schedule.length; i++) {
    if (i <= afterIndex) continue;
    const t = touchpointTime(eventDateIso, schedule[i].days_before).getTime();
    if (t > nowMs && t < bestTime) {
      best = i;
      bestTime = t;
    }
  }
  return best;
}

// The index to SEED at activation: the earliest touchpoint due now or in the
// future. If ALL are past, return the latest past index (fire it now —
// 'fire_first_now'). null for an empty schedule.
export function firstDueIndex(
  schedule: Touchpoint[],
  eventDateIso: string,
  nowMs: number,
): number | null {
  if (schedule.length === 0) return null;
  let earliestFuture: number | null = null;
  let earliestTime = Infinity;
  let latestPast: number | null = null;
  let latestPastTime = -Infinity;
  for (let i = 0; i < schedule.length; i++) {
    const t = touchpointTime(eventDateIso, schedule[i].days_before).getTime();
    if (t >= nowMs) {
      if (t < earliestTime) {
        earliestFuture = i;
        earliestTime = t;
      }
    } else if (t > latestPastTime) {
      latestPast = i;
      latestPastTime = t;
    }
  }
  return earliestFuture ?? latestPast;
}

// Fixed KALFA-outreach UUIDv5 namespace (constant — do not change, it anchors the
// deterministic job ids that give pg-boss exactly-once enqueue per step).
const UUID_NS = '5b1d0e3a-9b7c-4f2a-8e6d-0c1a2b3c4d5e';

// Deterministic UUIDv5 job id for (campaign, contact, step) — same inputs → same
// id, so re-enqueuing a step is a no-op (pg-boss ON CONFLICT DO NOTHING).
export function detId(
  campaignId: string,
  contactId: string,
  stepIndex: number,
): string {
  const nsBytes = Buffer.from(UUID_NS.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(nsBytes)
    .update(`${campaignId}:${contactId}:${stepIndex}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC-4122 variant
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
