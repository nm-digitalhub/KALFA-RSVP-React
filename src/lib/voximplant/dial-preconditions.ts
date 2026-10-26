import { rsvpClosedReason, todayIL } from '@/lib/data/event-date';

// Dial preconditions and the scenario payload for the ops launchers
// (scripts/voximplant/bridge-call.ts, scripts/voximplant/test-call-attempt.ts).
//
// This lives in its own module for one reason: the launcher calls main() at
// module scope, so nothing inside it can be imported by a test without dialling
// a phone. A gate that can only be verified by placing a real call is a gate
// nobody verifies — which is exactly how the launcher came to bypass every
// dispatcher check in the first place.
//
// The closed-event decision itself is rsvpClosedReason (shared with
// dispatchOutreachCall, so the two dial paths cannot disagree). All this adds is
// the operator-facing wording, kept here rather than inline so both the message
// and the refusal are covered by tests.

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

/**
 * The operator message for a closed-event refusal. There is no override: a closed event makes ctx refuse the call
 * (src/app/api/voximplant/ctx/[token]/route.ts), so the agent would run without the guest's or the event's details —
 * the 2026-10-25 call, where it invented both. Test calls go to the permanent test event instead
 * (openspec/changes/voice-test-environment, D5/D6).
 */
export function closedEventDialMessage(reason: string): string {
  return (
    `refusing to dial — ${reason}, so ctx will refuse the call and submit_rsvp would reject any answer. ` +
    'Test calls go to the test event: create an attempt with `npm run test-call:attempt` ' +
    '(docs/voice-agent/elevenlabs-json-reference.md §6).'
  );
}

// --- The test branch (voice-test-environment, D2) ---------------------------
//
// An ElevenLabs agent branch id as the API returns it: `agtbrch_` and lowercase alphanumerics (36 characters on
// 2026-10-25). RSVPAgent.voxengine.js applies the same pattern to customData.br before it passes `branchId` to the
// agent client, so the two must stay identical. Only this launcher sets the key; the worker's
// buildScriptCustomData never does, so a guest's call always runs on Main.
export const BRANCH_ID_PATTERN = /^agtbrch_[0-9a-z]+$/;

export type TestBranch = { ok: true; branchId: string | null } | { ok: false; refusal: string };

/** The `--branch` value: absent → Main (null), a branch id → that id, anything else → refused before any write. */
export function parseTestBranch(raw: string | undefined): TestBranch {
  if (raw === undefined) return { ok: true, branchId: null };
  if (BRANCH_ID_PATTERN.test(raw)) return { ok: true, branchId: raw };
  return { ok: false, refusal: '--branch must be an ElevenLabs branch id (agtbrch_…)' };
}

// VoxEngine.customData()'s hard cap (see buildScriptCustomData in src/lib/data/outreach-calls.ts).
export const CUSTOM_DATA_CAP_BYTES = 200;

/**
 * The launcher's scenario payload: the Branch B fields the scenario parses ({to, from, tok, u}) plus `br` when a
 * branch was chosen. Returns the byte count so the caller logs it and never the payload (it carries the token).
 */
export function bridgeLaunchPayload(args: {
  to: string;
  from: string;
  tok: string;
  u: string;
  branchId: string | null;
}): { payload: string; bytes: number } {
  const body: Record<string, string> = { to: args.to, from: args.from, tok: args.tok, u: args.u };
  if (args.branchId) body.br = args.branchId;
  const payload = JSON.stringify(body);
  return { payload, bytes: Buffer.byteLength(payload, 'utf8') };
}

// --- The test-call attempt (voice-test-environment, D5) ---------------------

/** What scripts/voximplant/test-call-attempt.ts reads before it creates an attempt. */
export type TestAttemptFacts = {
  /** A live (not purged) public.test_events row for the event. */
  markedAsTest: boolean;
  event: DialEventContext | null;
  /** Guests the contact backs on this event — the dispatcher binds a guest only when there is exactly one. */
  guestCount: number;
  /** The contact's number is on VOX_TEST_NUMBERS. */
  phoneAllowed: boolean;
};

/**
 * Why a test-call attempt must not be created, or null when it may. Only a staff-marked test event qualifies, and only
 * while it can record an answer — otherwise the call tests nothing ctx and save_rsvp would really do.
 */
export function testAttemptRefusal(facts: TestAttemptFacts, nowMs: number = Date.now()): string | null {
  if (!facts.markedAsTest) return 'the event is not marked as a test event';
  const closed = closedEventRefusal(facts.event, nowMs);
  if (closed) return closed;
  if (facts.guestCount !== 1) {
    return `the contact backs ${facts.guestCount} guests on this event; a test call needs exactly one`;
  }
  if (!facts.phoneAllowed) return "the guest's number is not on the VOX_TEST_NUMBERS allowlist";
  return null;
}
