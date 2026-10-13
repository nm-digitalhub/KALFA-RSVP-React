// Pure §10 plan identity for the outreach engine — no I/O, fully unit-testable: the touchpoint shape,
// the deterministic job / defer / audit ids and the planRev fingerprint. WHEN a step is sent is not here:
// send-window.ts (plannedSendTime + resolveSendSlot + evaluateStep) decides that, by Israel calendar day.

import { createHash } from 'node:crypto';

import { israelCalendarDay } from '@/lib/data/event-date';
import type { SendPolicy } from '@/lib/outreach/send-policy';

export type Touchpoint = {
  days_before: number;
  channel: string;
  message_key: string;
};

// Bump this when the send-timing ALGORITHM changes (even with identical
// event-date/schedule/policy). It is folded into planRev, so a version change
// invalidates every queued job's fingerprint → they re-plan under the new logic.
export const SEND_TIMING_ALGORITHM_VERSION = 1;

// Fixed KALFA-outreach UUIDv5 namespace (constant — do not change, it anchors the
// deterministic job ids that give pg-boss exactly-once enqueue per step).
const UUID_NS = '5b1d0e3a-9b7c-4f2a-8e6d-0c1a2b3c4d5e';

// One RFC-4122 UUIDv5 (version/variant nibbles fixed) over a name in the fixed
// namespace. A real uuid — so it satisfies Postgres' uuid column AND the strict
// z.uuid() validator (a string-suffixed id would throw 22P02).
function uuidv5(name: string): string {
  const nsBytes = Buffer.from(UUID_NS.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC-4122 variant
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Deterministic UUIDv5 job id for (campaign, contact, step, PLAN REVISION) —
// same inputs → same id (pg-boss ON CONFLICT DO NOTHING = at-most-once enqueue).
// The planRev fold means a plan-affecting edit yields a NEW id → a fresh job at
// the new slot, while the stale-plan job (if any) is neutralised by the worker's
// pre-flight stale check + the reserve_outreach_step compare-and-set.
export function detId(
  campaignId: string,
  contactId: string,
  stepIndex: number,
  planRev: string,
): string {
  return uuidv5(`${campaignId}:${contactId}:${stepIndex}:${planRev}`);
}

// Deterministic defer-SUCCESSOR id for a pre-flight defer (§3). Keyed on the
// target legal instant so two racing defers to the SAME slot collapse to ONE
// successor (PK conflict → exactly one insert), while a genuinely later slot
// gets its own id. NOT random / NOT now()-based (those would duplicate); NOT a
// string suffix on the parent uuid (that would throw 22P02 on the uuid column).
export function deferId(
  campaignId: string,
  contactId: string,
  stepIndex: number,
  planRev: string,
  targetSlotMs: number,
): string {
  return uuidv5(`${campaignId}:${contactId}:${stepIndex}:${planRev}:pf:${targetSlotMs}`);
}

// Deterministic activity_log id for one step resolution (§F.4): a real UUIDv5
// over (campaign, contact, step, planRev, reason). Folded into resolve_outreach_step
// as the audit PK → a double-invoke (retry / recovery) inserts exactly ONE row.
export function stepAuditId(
  campaignId: string,
  contactId: string,
  stepIndex: number,
  planRev: string,
  reason: string,
): string {
  return uuidv5(`${campaignId}:${contactId}:${stepIndex}:${planRev}:${reason}`);
}

// Recursive-key-sort canonical JSON — stable across key insertion order so two
// policy objects with identical content but different key order hash IDENTICALLY.
// Array order is meaningful (e.g. policy.weekday[0..6]) and is PRESERVED.
// NEVER JSON.stringify raw DB JSON directly for a fingerprint — key order there
// is not guaranteed. Only feed already-parsed/normalized values.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonical(value));
}

function sortForCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonical);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = sortForCanonical(src[key]);
    }
    return out;
  }
  return value;
}

// The FULL correctness identity of one step's plan (§11.1): a full SHA-256 (64
// hex) over the algorithm version + the event's Israel calendar date + the
// touchpoint + the NORMALIZED policy (from parseSendPolicy — never raw DB JSON).
// It changes iff a slot-affecting input changes, so the det id changes with it.
export function planRev(inputs: {
  eventDateIL: string;
  touchpoint: Touchpoint;
  policy: SendPolicy;
}): string {
  const material = canonicalJson({
    v: SEND_TIMING_ALGORITHM_VERSION,
    eventDateIL: inputs.eventDateIL,
    touchpoint: {
      days_before: inputs.touchpoint.days_before,
      channel: inputs.touchpoint.channel,
      message_key: inputs.touchpoint.message_key,
    },
    policy: inputs.policy,
  });
  return createHash('sha256').update(material).digest('hex');
}

// Convenience: planRev for a step from the raw event_date instant + touchpoint +
// policy (computes the Israel calendar day). The single call site for the worker.
export function stepPlanRev(
  eventDateIso: string,
  touchpoint: Touchpoint,
  policy: SendPolicy,
): string {
  return planRev({
    eventDateIL: israelCalendarDay(Date.parse(eventDateIso)),
    touchpoint,
    policy,
  });
}
