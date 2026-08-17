import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-engine', () => ({ isDncListed: vi.fn() }));
vi.mock('@/lib/data/push-delivery', () => ({ sendPushToUser: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { isDncListed } from '@/lib/data/outreach-engine';
import { sendPushToUser } from '@/lib/data/push-delivery';
import {
  computeQueueRingOrder,
  computeRingOrder,
  CONSOLE_SHIFT_FRESHNESS_MS,
  countAnsweredLastHourForPhone,
  deprioritizeCalendarBusyAgents,
  evaluateCallMeNowCaps,
  evaluateCallMeNowConsent,
  evaluateInboundCaps,
  findConsoleCallForEvent,
  findRoutableAgentVoxUsernames,
  getConsoleCallById,
  getConsoleCallSessionUrls,
  identifyInboundCaller,
  isShabbatOrYomTovBlocked,
  isShiftActiveAndFresh,
  isWithinHumanCallWindow,
  isWithinCallerStatedWindow,
  linkConsoleCallSession,
  mapEndedReasonToStatus,
  mintDialToken,
  notifyOffDutyShiftAgentsOfInboundCall,
  findRoutableAgents,
  notifyAgentsInboundCallResolved,
  notifyRoutableAgentsOfInboundCall,
  offerCallbackForCallMeNow,
  recordConsoleCallSessionAccess,
  resolveDialTarget,
  resolveTransferTarget,
  verifyDialToken,
  type DialTargetInput,
} from '@/lib/data/console-calls';
import { dialIntentBodySchema, routeInboundRetryBodySchema } from '@/lib/validation/console-calls';
import { sha256Hex } from '@/lib/security/token-compare';

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────
// A minimal, PER-TABLE, ordered-queue Supabase admin-client double.
//
// createMockSupabase (src/test/supabase-mock.ts) returns ONE static result
// for every `.from()` call regardless of table — insufficient here because
// resolveDialTarget's guest_service path queries `contacts` TWICE (once for
// the linked-contact row, once for the cross-event opt-out check) with
// different expected results. Each table gets its own FIFO queue of
// results, consumed in the exact order the DAL code issues its queries.
// ─────────────────────────────────────────────────────────────────────────

type QueryResult = { data: unknown; error: unknown };

function makeAdminMock(queues: Record<string, QueryResult[]>) {
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'gt', 'gte',
    'lt', 'lte', 'or', 'not', 'is', 'ilike', 'in', 'order', 'range', 'limit',
    'single', 'maybeSingle',
  ] as const;

  const from = vi.fn((table: string) => {
    const queue = queues[table];
    const result: QueryResult = queue && queue.length > 0
      ? (queue.shift() as QueryResult)
      : { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of chainMethods) builder[m] = vi.fn(() => builder);
    (builder as { then: unknown }).then = (onFulfilled: (v: QueryResult) => unknown) =>
      onFulfilled(result);
    return builder;
  });

  return { from, rpc: vi.fn() };
}

function wireAdmin(queues: Record<string, QueryResult[]>) {
  const client = makeAdminMock(queues);
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return client;
}

// A Thursday well inside the 08:00–19:00 window, not a Jewish holiday.
const OPEN_HOURS_MS = Date.parse('2026-06-04T10:00:00+03:00');

describe('isWithinHumanCallWindow (pure)', () => {
  it('allows Sun–Thu inside 08:00–19:00', () => {
    expect(isWithinHumanCallWindow(OPEN_HOURS_MS)).toBe(true);
  });

  it('blocks before 08:00 and at/after 19:00 on a weekday', () => {
    expect(isWithinHumanCallWindow(Date.parse('2026-06-04T07:59:00+03:00'))).toBe(false);
    expect(isWithinHumanCallWindow(Date.parse('2026-06-04T19:00:00+03:00'))).toBe(false);
  });

  it('narrows Friday to 08:00–13:00', () => {
    expect(isWithinHumanCallWindow(Date.parse('2026-06-05T12:59:00+03:00'))).toBe(true);
    expect(isWithinHumanCallWindow(Date.parse('2026-06-05T13:00:00+03:00'))).toBe(false);
  });

  it('hard-blocks Saturday regardless of time-of-day', () => {
    expect(isWithinHumanCallWindow(Date.parse('2026-06-06T10:00:00+03:00'))).toBe(false);
  });
});

// Split out from isWithinHumanCallWindow (compliance ruling, 12.8) so
// call-me-now can skip the daily window while keeping this gate
// unconditional — see console-calls.ts's HoursGate type comment for why this
// is structural (no caller, present or future, can bypass it via an option)
// rather than convention. This suite pins that the split preserved the exact
// Shabbat semantics the combined function already had.
describe('isShabbatOrYomTovBlocked (pure)', () => {
  it('blocks Saturday at any hour', () => {
    expect(isShabbatOrYomTovBlocked(Date.parse('2026-06-06T10:00:00+03:00'))).toBe(true);
  });

  it('does not block an ordinary weekday, any hour', () => {
    expect(isShabbatOrYomTovBlocked(Date.parse('2026-06-04T22:00:00+03:00'))).toBe(false);
    expect(isShabbatOrYomTovBlocked(OPEN_HOURS_MS)).toBe(false);
  });
});

// Shared clean-input fixture for the inbound admission caps. Declared once so
// the hour-agnostic pins below and the caps-math suite cannot drift apart.
const inboundCapsBase = {
  flagEnabled: true,
  liveCallsEnabled: true,
  balanceOk: true,
  globalConcurrentAnswered: 0,
  perCliAnsweredLastHour: 0,
  answeredToday: 0,
  isIdentifiedCaller: true,
  answeredUnidentifiedToday: 0,
};

// The inbound hours gate was REMOVED (compliance ruling 2026-08-12): no
// Israeli regime restricts ANSWERING a call the consumer placed — every one
// of them is written around who initiates. These tests pin the removal, so a
// future "let's mirror the outbound window" instinct fails loudly here first.
describe('inbound admission is hour-agnostic (the quiet-hours gate was removed)', () => {
  it('admits at hours the OUTBOUND human window forbids', () => {
    const at2200 = Date.parse('2026-06-04T22:00:00+03:00'); // long past human-dial's 19:00 cutoff
    expect(isWithinHumanCallWindow(at2200)).toBe(false);
    expect(evaluateInboundCaps(inboundCapsBase)).toEqual({ ok: true });
  });

  it('exposes no hours input on the caps evaluator at all', () => {
    // A structural pin: if anyone re-adds an hours condition, it must show up
    // as a new key here, and this assertion is where that gets noticed.
    expect(Object.keys(inboundCapsBase).sort()).toEqual(
      [
        'answeredToday',
        'answeredUnidentifiedToday',
        'balanceOk',
        'flagEnabled',
        'globalConcurrentAnswered',
        'isIdentifiedCaller',
        'liveCallsEnabled',
        'perCliAnsweredLastHour',
      ].sort(),
    );
  });
});

describe('isWithinCallerStatedWindow (pure) — the caller\'s own stated limits', () => {
  const noon = Date.parse('2026-06-04T12:00:00+03:00');

  it('imposes nothing when the caller stated no preference', () => {
    expect(isWithinCallerStatedWindow({}, noon)).toBe(true);
  });

  it('respects not_before_min / not_after_min', () => {
    expect(isWithinCallerStatedWindow({ not_before_min: 13 * 60 }, noon)).toBe(false);
    expect(isWithinCallerStatedWindow({ not_before_min: 11 * 60 }, noon)).toBe(true);
    expect(isWithinCallerStatedWindow({ not_after_min: 12 * 60 }, noon)).toBe(false);
    expect(isWithinCallerStatedWindow({ not_after_min: 13 * 60 }, noon)).toBe(true);
  });

  it('respects an excluded date (Israel-local)', () => {
    expect(isWithinCallerStatedWindow({ excluded_dates: ['2026-06-04'] }, noon)).toBe(false);
    expect(isWithinCallerStatedWindow({ excluded_dates: ['2026-06-05'] }, noon)).toBe(true);
  });
});

describe('mapEndedReasonToStatus (pure)', () => {
  it('maps no_agent to the no_agent status', () => {
    expect(mapEndedReasonToStatus('no_agent')).toBe('no_agent');
  });
  it('maps the three failure reasons to failed', () => {
    expect(mapEndedReasonToStatus('operator_failed')).toBe('failed');
    expect(mapEndedReasonToStatus('callee_failed')).toBe('failed');
    expect(mapEndedReasonToStatus('guest_failed')).toBe('failed');
  });
  it('maps every ordinary hangup reason to ended', () => {
    for (const r of ['operator_hangup', 'remote_hangup', 'caller_hangup', 'call_end', 'session_terminating', 'safety_net_timeout']) {
      expect(mapEndedReasonToStatus(r)).toBe('ended');
    }
  });
});

describe('computeRingOrder (pure)', () => {
  it('returns [] for zero routable agents', () => {
    expect(computeRingOrder([], 5)).toEqual([]);
  });
  it('sorts deterministically and rotates by rotateBy % n', () => {
    const agents = ['agent_c', 'agent_a', 'agent_b']; // sorted: a, b, c
    expect(computeRingOrder(agents, 0)).toEqual(['agent_a', 'agent_b', 'agent_c']);
    expect(computeRingOrder(agents, 1)).toEqual(['agent_b', 'agent_c', 'agent_a']);
    expect(computeRingOrder(agents, 3)).toEqual(['agent_a', 'agent_b', 'agent_c']); // wraps
  });
  it('handles a negative rotateBy safely (modulo never negative)', () => {
    expect(computeRingOrder(['agent_a', 'agent_b'], -1)).toEqual(['agent_b', 'agent_a']);
  });
});

describe('computeQueueRingOrder (pure — plan §10 department-queue extension point)', () => {
  it('rings queue members first, then every other routable agent as fallback', () => {
    const queueMembers = ['agent_b', 'agent_a']; // sorted: a, b
    const allRoutable = ['agent_a', 'agent_b', 'agent_c', 'agent_d']; // sorted: a, b, c, d
    expect(computeQueueRingOrder(queueMembers, allRoutable, 0)).toEqual([
      'agent_a',
      'agent_b', // queue tier (sorted+rotated)
      'agent_c',
      'agent_d', // fallback tier — queue members excluded, no duplicate ring
    ]);
  });

  it('rotates each tier independently with the same rotateBy', () => {
    const queueMembers = ['agent_a', 'agent_b'];
    const allRoutable = ['agent_a', 'agent_b', 'agent_c', 'agent_d'];
    // rotateBy=1: queue tier (n=2) rotates by 1%2=1 -> [b, a]; fallback tier
    // (n=2, c/d) rotates by 1%2=1 -> [d, c].
    expect(computeQueueRingOrder(queueMembers, allRoutable, 1)).toEqual([
      'agent_b',
      'agent_a',
      'agent_d',
      'agent_c',
    ]);
  });

  it('degenerates to plain computeRingOrder when the queue has zero members (inactive/unresolvable queue)', () => {
    const allRoutable = ['agent_c', 'agent_a', 'agent_b'];
    expect(computeQueueRingOrder([], allRoutable, 2)).toEqual(computeRingOrder(allRoutable, 2));
  });

  it('never double-rings an agent present in both tiers (queue tier wins, fallback tier excludes them)', () => {
    const queueMembers = ['agent_a'];
    const allRoutable = ['agent_a', 'agent_b'];
    const result = computeQueueRingOrder(queueMembers, allRoutable, 0);
    expect(result).toEqual(['agent_a', 'agent_b']);
    expect(result.filter((u) => u === 'agent_a')).toHaveLength(1);
  });

  // NOTE: this pure function assumes `queueMembers` is ALREADY the
  // ready+fresh+provisioned subset — the intersection with routability
  // happens one layer up, in findRoutableAgentVoxUsernamesForQueue
  // (console-queues.ts), covered in console-queues.test.ts. A stale/not-ready
  // queue member is filtered out THERE, before this function ever sees it.
});

describe('deprioritizeCalendarBusyAgents (pure — Outlook/Exchange presence-sync research, 12.8)', () => {
  it('moves calendar-busy agents to the end, preserving relative order within each group', () => {
    const ring = ['agent_a', 'agent_b', 'agent_c', 'agent_d'];
    expect(deprioritizeCalendarBusyAgents(ring, new Set(['agent_b']))).toEqual([
      'agent_a',
      'agent_c',
      'agent_d',
      'agent_b',
    ]);
  });

  it('returns the SAME order (new array) when nobody is calendar-busy', () => {
    const ring = ['agent_a', 'agent_b'];
    const result = deprioritizeCalendarBusyAgents(ring, new Set());
    expect(result).toEqual(ring);
  });

  it('never removes an agent — the two-axis rule: reorder, never exclude', () => {
    const ring = ['agent_a', 'agent_b', 'agent_c'];
    const result = deprioritizeCalendarBusyAgents(ring, new Set(['agent_a', 'agent_b', 'agent_c']));
    expect(result).toHaveLength(3);
    expect(new Set(result)).toEqual(new Set(ring));
  });

  it('is a no-op at N=1 (today\'s live state: exactly one console agent) — rotation of a singleton ring is provably inert', () => {
    expect(deprioritizeCalendarBusyAgents(['agent_a'], new Set(['agent_a']))).toEqual(['agent_a']);
  });
});

// ADDED (fraud incident, 17.8). The caps-math suite below is PURE — it takes
// perCliAnsweredLastHour as an input and would have passed unchanged all five
// days the flood ran. The defect was never in the math; it was in the plumbing
// that produces that number, so the regression pin has to live HERE, at the
// query builder, or it pins nothing.
//
// The bug: the route passed the string literal 'unknown-cli' whenever
// normalizePhone returned null, but console_call_pii stores an unparseable CLI
// as SQL NULL. `.eq('phone_e164','unknown-cli')` can never match a stored row,
// so the per-CLI hourly cap silently returned 0 forever and never bound for
// any caller who withheld a number. Measured on the live table: 0 rows holding
// the literal 'unknown-cli', 396 rows holding NULL; every IDENTIFIED number
// peaked at exactly 3 calls in an hour (the cap working), while the withheld
// bucket reached 14 in an hour (the cap absent).
describe('countAnsweredLastHourForPhone (17.8 — the withheld-CLI hole)', () => {
  it('matches the stored NULLs with IS NULL when the CLI could not be normalized', async () => {
    const client = wireAdmin({ console_call_pii: [{ data: null, error: null }] });
    await countAnsweredLastHourForPhone(null);

    const builder = client.from.mock.results[0]?.value as Record<string, ReturnType<typeof vi.fn>>;
    expect(builder.is).toHaveBeenCalledWith('phone_e164', null);
    // The heart of the regression: a withheld CLI must never be looked up as
    // an equality match against some sentinel value no row can ever hold.
    expect(builder.eq).not.toHaveBeenCalled();
  });

  it('still filters on the exact number when the CLI did normalize', async () => {
    const client = wireAdmin({ console_call_pii: [{ data: null, error: null }] });
    await countAnsweredLastHourForPhone('+972501234567');

    const builder = client.from.mock.results[0]?.value as Record<string, ReturnType<typeof vi.fn>>;
    expect(builder.eq).toHaveBeenCalledWith('phone_e164', '+972501234567');
    expect(builder.is).not.toHaveBeenCalled();
  });
});

// The ringing agent's phone used to show OUR OWN DID on every incoming call and
// nothing about the caller (owner report, 17.8). The scenario now puts the
// caller's number in callUser's `callerid` and this name in its `displayName` —
// which makes `guestName` the load-bearing half of "who is calling", not a
// nice-to-have. These pin the two ways it can be absent, because both of them
// silently degrade to showing a bare number rather than failing loudly.
describe('identifyInboundCaller — the agent-facing name (17.8)', () => {
  it('returns the guest name alongside the ids', async () => {
    wireAdmin({
      contacts: [{ data: [{ id: 'c-1', event_id: 'e-1' }], error: null }],
      guests: [{ data: { id: 'g-1', full_name: '  דנה כהן  ' }, error: null }],
    });

    // Trimmed, not echoed raw: an import-whitespaced name would otherwise ride
    // into a SIP displayName, where "whitespace is not allowed" is a documented
    // constraint on the sibling callerid field.
    await expect(identifyInboundCaller('+972501234567')).resolves.toEqual({
      eventId: 'e-1',
      guestId: 'g-1',
      contactId: 'c-1',
      guestName: 'דנה כהן',
    });
  });

  it('identifies the caller but reports no name when full_name is blank', async () => {
    wireAdmin({
      contacts: [{ data: [{ id: 'c-1', event_id: 'e-1' }], error: null }],
      guests: [{ data: { id: 'g-1', full_name: '   ' }, error: null }],
    });

    // null, NOT '' and NOT a placeholder: the route falls back to the caller's
    // E.164, so the agent sees a real number instead of something that looks
    // like a successful identification.
    const identified = await identifyInboundCaller('+972501234567');
    expect(identified?.guestId).toBe('g-1');
    expect(identified?.guestName).toBeNull();
  });

  it('stays null for a number no guest is attached to', async () => {
    wireAdmin({
      contacts: [{ data: [{ id: 'c-1', event_id: 'e-1' }], error: null }],
      guests: [{ data: null, error: null }],
    });

    await expect(identifyInboundCaller('+972501234567')).resolves.toBeNull();
  });
});

describe('evaluateInboundCaps (pure — Gate E.2 caps math)', () => {
  const base = inboundCapsBase;

  it('accepts when every input is clean', () => {
    expect(evaluateInboundCaps(base)).toEqual({ ok: true });
  });

  it('rejects flag_disabled first', () => {
    expect(evaluateInboundCaps({ ...base, flagEnabled: false })).toEqual({ ok: false, reason: 'flag_disabled' });
  });

  it('rejects at the concurrency cap (>=2)', () => {
    expect(evaluateInboundCaps({ ...base, globalConcurrentAnswered: 2 })).toEqual({ ok: false, reason: 'concurrency' });
    expect(evaluateInboundCaps({ ...base, globalConcurrentAnswered: 1 })).toEqual({ ok: true });
  });

  // Pins the boundary on BOTH sides, not just the rejection. Raised 3 → 7 on
  // 17.8 (see the constant's own header): a test that only asserted the reject
  // side would have kept passing if the cap were raised to something absurd,
  // which is exactly the drift this suite exists to catch.
  it('rejects at the per-CLI hourly cap (>=7) and admits below it', () => {
    expect(evaluateInboundCaps({ ...base, perCliAnsweredLastHour: 7 })).toEqual({ ok: false, reason: 'per_cli_rate' });
    expect(evaluateInboundCaps({ ...base, perCliAnsweredLastHour: 6 })).toEqual({ ok: true });
  });

  it('rejects at the daily call-count breaker (>=300)', () => {
    expect(evaluateInboundCaps({ ...base, answeredToday: 300 })).toEqual({ ok: false, reason: 'daily_breaker' });
  });

  // ADDED (fraud incident, 17.8): a caller not resolved to a known
  // contact/guest is admitted only against a much tighter shared daily budget
  // — a KNOWN caller is NEVER subject to it, no matter how many unidentified
  // calls already landed today.
  describe('unidentified-caller daily budget (17.8 fraud incident)', () => {
    it('rejects an unidentified caller once the unidentified budget is spent (>=20)', () => {
      expect(
        evaluateInboundCaps({ ...base, isIdentifiedCaller: false, answeredUnidentifiedToday: 20 }),
      ).toEqual({ ok: false, reason: 'unidentified_flood' });
      expect(
        evaluateInboundCaps({ ...base, isIdentifiedCaller: false, answeredUnidentifiedToday: 19 }),
      ).toEqual({ ok: true });
    });

    it('never caps a known contact/guest, regardless of the unidentified count', () => {
      expect(
        evaluateInboundCaps({ ...base, isIdentifiedCaller: true, answeredUnidentifiedToday: 10_000 }),
      ).toEqual({ ok: true });
    });

    it('does not trip on the 17.8 incident volume once every call is treated as unidentified (431/day)', () => {
      // Regression pin mirroring the 13.8 dialer-flood pin below: this incident's
      // OWN observed volume must land on 'unidentified_flood', not sail through
      // under the 300-call daily_breaker the way it did for five days.
      expect(
        evaluateInboundCaps({ ...base, isIdentifiedCaller: false, answeredUnidentifiedToday: 431 }),
      ).toEqual({ ok: false, reason: 'unidentified_flood' });
    });
  });

  it('lets the COUNT cap bind before the spend estimate (deliberate, 15.8)', () => {
    // Inverted from what this test asserted until 15.8, and the inversion is the
    // point rather than a relaxation. The spend breaker used to fire first: 250
    // answered x $0.02 = $5.00, under the 300-call cap. It did fire — on the
    // owner's own test calls, refusing every one of them while the app fixes
    // shipped that night went untested because no call ever reached the ring
    // stage.
    //
    // It fired on an ESTIMATE, not on spend. The measured aggregate is
    // ~$0.0075/call, so real spend at the trip was ~$1.87 against a $5 cap. With
    // the cap at $15 the 300-call ceiling binds first, which is a counted fact
    // rather than a guess multiplied by a count, and bounds a bad day at
    // 300 x ~$0.0075 = ~$2.25.
    //
    // What this test now protects is that the spend breaker is still REACHABLE
    // rather than dead code: at a genuinely higher per-call cost it must still
    // fire ahead of the count cap. If someone later restores the $5 cap, the
    // first assertion is what will tell them the ordering flipped back.
    expect(evaluateInboundCaps({ ...base, answeredToday: 250 })).toEqual({ ok: true });
    expect(evaluateInboundCaps({ ...base, answeredToday: 299 })).toEqual({ ok: true });
    expect(evaluateInboundCaps({ ...base, answeredToday: 300 })).toEqual({ ok: false, reason: 'daily_breaker' });
  });

  // Regression pin for the incident itself: the observed overnight
  // dialer flood was 84 answered calls, and must no longer trip anything.
  it('does NOT trip on the 13.8 dialer-flood volume (84 answered)', () => {
    expect(evaluateInboundCaps({ ...base, answeredToday: 84 })).toEqual({ ok: true });
  });

  it('rejects on balance/live-calls independently of the others', () => {
    expect(evaluateInboundCaps({ ...base, balanceOk: false })).toEqual({ ok: false, reason: 'balance' });
    expect(evaluateInboundCaps({ ...base, liveCallsEnabled: false })).toEqual({ ok: false, reason: 'live_calls_disabled' });
  });
});

// Capability A, THIRD design ("call me now" — OTP-verified, PSTN-out, 12.8).
// Same shape as evaluateInboundCaps's own suite above on purpose — the caps
// math is deliberately the SAME pattern, just with call-me-now's own
// constants (tighter per-phone hourly cap: 1, not 3 — see
// evaluateCallMeNowCaps's header for why a real verified phone gets a
// tighter limit than the widget's IP-based one ever did).
describe('evaluateCallMeNowCaps (pure — capability A, third design)', () => {
  const base = {
    flagEnabled: true,
    liveCallsEnabled: true,
    balanceOk: true,
    globalConcurrentCallMeNow: 0,
    perPhoneCallsLastHour: 0,
    answeredToday: 0,
  };

  it('accepts when every input is clean', () => {
    expect(evaluateCallMeNowCaps(base)).toEqual({ ok: true });
  });

  it('rejects flag_disabled first', () => {
    expect(evaluateCallMeNowCaps({ ...base, flagEnabled: false })).toEqual({ ok: false, reason: 'flag_disabled' });
  });

  it('rejects at the concurrency cap (>=2)', () => {
    expect(evaluateCallMeNowCaps({ ...base, globalConcurrentCallMeNow: 2 })).toEqual({ ok: false, reason: 'concurrency' });
    expect(evaluateCallMeNowCaps({ ...base, globalConcurrentCallMeNow: 1 })).toEqual({ ok: true });
  });

  it('rejects at the per-phone hourly cap (>=1) — tighter than the widget\'s per-IP 3, on purpose', () => {
    expect(evaluateCallMeNowCaps({ ...base, perPhoneCallsLastHour: 1 })).toEqual({ ok: false, reason: 'per_phone_rate' });
  });

  it('rejects at the daily call-count breaker (>=100)', () => {
    expect(evaluateCallMeNowCaps({ ...base, answeredToday: 100 })).toEqual({ ok: false, reason: 'daily_breaker' });
  });

  it('rejects at the daily estimated-spend breaker BEFORE the 100-call count cap (whichever first)', () => {
    // Its OWN $0.09/call figure, NOT inbound's — this flow places an OUTBOUND
    // PSTN leg, measured at ~10x an inbound answer in this account's billing.
    // The two constants were split on 13.8: while they were shared, whichever
    // flow the number was tuned for made it wrong for the other, and after the
    // inbound recalibration to $0.02 this cap would silently have allowed ~4x
    // the spend it promises. 56 * 0.09 = $5.04, crossing the spend estimate
    // well under the 100-call count cap.
    expect(evaluateCallMeNowCaps({ ...base, answeredToday: 56 })).toEqual({ ok: false, reason: 'daily_breaker' });
    expect(evaluateCallMeNowCaps({ ...base, answeredToday: 55 })).toEqual({ ok: true });
  });

  it('rejects on balance/live-calls independently of the others', () => {
    expect(evaluateCallMeNowCaps({ ...base, balanceOk: false })).toEqual({ ok: false, reason: 'balance' });
    expect(evaluateCallMeNowCaps({ ...base, liveCallsEnabled: false })).toEqual({ ok: false, reason: 'live_calls_disabled' });
  });
});

describe('dialIntentBodySchema — scenario ג (cold call) has NO admitted shape', () => {
  it('accepts the two decided shapes', () => {
    // Real v4-shaped UUIDs (version nibble '4', variant nibble in {8,9,a,b}) —
    // Zod 4's z.string().uuid() strictly validates the version marker, not
    // just the hex-with-dashes shape (memory: "Zod 4 z.uuid() strictness").
    expect(dialIntentBodySchema.safeParse({ kind: 'callback', id: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
    expect(
      dialIntentBodySchema.safeParse({
        kind: 'guest_service',
        eventId: '11111111-1111-4111-8111-111111111111',
        contactId: '22222222-2222-4222-8222-222222222222',
      }).success,
    ).toBe(true);
  });

  it('rejects a freeform/cold-call phone payload — no such variant exists', () => {
    expect(dialIntentBodySchema.safeParse({ kind: 'cold', phone: '+972501234567' }).success).toBe(false);
    expect(dialIntentBodySchema.safeParse({ phone: '+972501234567' }).success).toBe(false);
  });

  it('is a compile-time guarantee too: a cold-call input does not type-check', () => {
    // @ts-expect-error — 'cold' is not a member of the DialTargetInput union;
    // the TYPE itself has no representation for scenario ג, matching
    // decide-consent's "no code path exists" requirement.
    const _cold: DialTargetInput = { kind: 'cold', phone: '+972501234567' };
    void _cold;
  });
});

describe('resolveDialTarget — kind: callback', () => {
  const NOW = Date.parse('2026-06-04T10:00:00+03:00'); // Thursday, open hours

  it('GO: an open, fresh callback request under the attempt cap resolves', async () => {
    wireAdmin({
      callback_requests: [{
        data: {
          id: 'cb-1', phone: '0501234567', status: 'new',
          requested_at: null, created_at: new Date(NOW - 60_000).toISOString(),
        },
        error: null,
      }],
      activity_log: [{ data: null, error: null, count: 0 } as unknown as QueryResult],
      contacts: [{ data: null, error: null }], // opt-out check: no matching row
    });
    vi.mocked(isDncListed).mockResolvedValue(false);

    const result = await resolveDialTarget({ kind: 'callback', id: 'cb-1' }, NOW);
    expect(result).toMatchObject({ ok: true, callbackRequestId: 'cb-1' });
    if (result.ok) expect(result.phone).toMatch(/^\+972/);
  });

  it('NO-GO: a closed callback (status not in new/in_progress) is refused', async () => {
    wireAdmin({
      callback_requests: [{
        data: { id: 'cb-2', phone: '0501234567', status: 'done', requested_at: null, created_at: new Date(NOW).toISOString() },
        error: null,
      }],
    });
    const result = await resolveDialTarget({ kind: 'callback', id: 'cb-2' }, NOW);
    expect(result).toEqual({ ok: false, reason: 'not_open' });
  });

  it('NO-GO: a callback older than the 30-day freshness window is refused', async () => {
    wireAdmin({
      callback_requests: [{
        data: {
          id: 'cb-3', phone: '0501234567', status: 'new',
          requested_at: new Date(NOW - 31 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date(NOW - 31 * 24 * 60 * 60 * 1000).toISOString(),
        },
        error: null,
      }],
    });
    const result = await resolveDialTarget({ kind: 'callback', id: 'cb-3' }, NOW);
    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('NO-GO: DNC blocks fail-closed even for an otherwise-valid callback', async () => {
    wireAdmin({
      callback_requests: [{
        data: { id: 'cb-4', phone: '0501234567', status: 'new', requested_at: null, created_at: new Date(NOW).toISOString() },
        error: null,
      }],
      activity_log: [{ data: null, error: null, count: 0 } as unknown as QueryResult],
    });
    vi.mocked(isDncListed).mockResolvedValue(true);
    const result = await resolveDialTarget({ kind: 'callback', id: 'cb-4' }, NOW);
    expect(result).toEqual({ ok: false, reason: 'dnc' });
  });

  it('NO-GO: quiet hours block even a fully consented callback', async () => {
    wireAdmin({
      callback_requests: [{
        data: { id: 'cb-5', phone: '0501234567', status: 'new', requested_at: null, created_at: new Date(NOW).toISOString() },
        error: null,
      }],
      activity_log: [{ data: null, error: null, count: 0 } as unknown as QueryResult],
      contacts: [{ data: null, error: null }],
    });
    vi.mocked(isDncListed).mockResolvedValue(false);
    const shabbatMs = Date.parse('2026-06-06T10:00:00+03:00'); // Saturday
    const result = await resolveDialTarget({ kind: 'callback', id: 'cb-5' }, shabbatMs);
    expect(result).toEqual({ ok: false, reason: 'quiet_hours' });
  });
});

describe('resolveDialTarget — kind: guest_service', () => {
  const NOW = Date.parse('2026-06-04T10:00:00+03:00');

  it('GO: an active event, linked guest, non-opted-out contact resolves', async () => {
    wireAdmin({
      contacts: [
        { data: { id: 'contact-1', event_id: 'event-1', normalized_phone: '+972501234567', removal_requested: false }, error: null },
        { data: null, error: null }, // opt-out sweep: no matching row anywhere
      ],
      guests: [{ data: { id: 'guest-1' }, error: null }],
      events: [{ data: { id: 'event-1', status: 'active', event_date: new Date(NOW).toISOString() }, error: null }],
    });
    vi.mocked(isDncListed).mockResolvedValue(false);

    const result = await resolveDialTarget({ kind: 'guest_service', eventId: 'event-1', contactId: 'contact-1' }, NOW);
    expect(result).toEqual({
      ok: true, phone: '+972501234567', eventId: 'event-1', contactId: 'contact-1', guestId: 'guest-1', callbackRequestId: null,
    });
  });

  it('NO-GO: contact not linked to any guest of the event', async () => {
    wireAdmin({
      contacts: [{ data: { id: 'contact-1', event_id: 'event-1', normalized_phone: '+972501234567', removal_requested: false }, error: null }],
      guests: [{ data: null, error: null }],
    });
    const result = await resolveDialTarget({ kind: 'guest_service', eventId: 'event-1', contactId: 'contact-1' }, NOW);
    expect(result).toEqual({ ok: false, reason: 'not_linked' });
  });

  it('NO-GO: event not active', async () => {
    wireAdmin({
      contacts: [{ data: { id: 'contact-1', event_id: 'event-1', normalized_phone: '+972501234567', removal_requested: false }, error: null }],
      guests: [{ data: { id: 'guest-1' }, error: null }],
      events: [{ data: { id: 'event-1', status: 'draft', event_date: new Date(NOW).toISOString() }, error: null }],
    });
    const result = await resolveDialTarget({ kind: 'guest_service', eventId: 'event-1', contactId: 'contact-1' }, NOW);
    expect(result).toEqual({ ok: false, reason: 'event_not_active' });
  });

  it('NO-GO: event day already past (Israel calendar day)', async () => {
    wireAdmin({
      contacts: [{ data: { id: 'contact-1', event_id: 'event-1', normalized_phone: '+972501234567', removal_requested: false }, error: null }],
      guests: [{ data: { id: 'guest-1' }, error: null }],
      events: [{ data: { id: 'event-1', status: 'active', event_date: '2026-01-01T00:00:00Z' }, error: null }],
    });
    const result = await resolveDialTarget({ kind: 'guest_service', eventId: 'event-1', contactId: 'contact-1' }, NOW);
    expect(result).toEqual({ ok: false, reason: 'past_event_day' });
  });

  it('NO-GO: the contact row itself is opted out', async () => {
    wireAdmin({
      contacts: [{ data: { id: 'contact-1', event_id: 'event-1', normalized_phone: '+972501234567', removal_requested: true }, error: null }],
    });
    const result = await resolveDialTarget({ kind: 'guest_service', eventId: 'event-1', contactId: 'contact-1' }, NOW);
    expect(result).toEqual({ ok: false, reason: 'opted_out' });
  });
});

// evaluateCallMeNowConsent — capability A, third design (12.8). Proves it
// routes through the SAME evaluateSharedConsentGates resolveDialTarget's two
// kinds already use (DNC -> contacts opt-out -> Shabbat/Yom-Tov -> daily
// window), not a reimplementation — same fixtures/mocks as resolveDialTarget's
// own suites above, on a bare phone with no event/contact lookup at all.
// RULING (12.8): the daily window is skipped for this function; Shabbat/
// Yom-Tov is NOT — see evaluateCallMeNowConsent's own header in
// console-calls.ts for the full basis (two separate conclusions, two
// separate bases, never collapsed into one).
describe('evaluateCallMeNowConsent — reuses the shared DNC/opt-out/Shabbat gate; daily window RULED OFF', () => {
  const NOW = Date.parse('2026-06-04T10:00:00+03:00'); // Thursday, open hours

  it('GO: a clean, non-DNC, non-opted-out phone in open hours resolves', async () => {
    wireAdmin({ contacts: [{ data: null, error: null }] }); // opt-out sweep: no matching row
    vi.mocked(isDncListed).mockResolvedValue(false);
    const result = await evaluateCallMeNowConsent('+972501234567', NOW);
    expect(result).toEqual({ ok: true });
  });

  it('NO-GO: DNC blocks fail-closed, exactly like the callback/guest_service kinds', async () => {
    vi.mocked(isDncListed).mockResolvedValue(true);
    const result = await evaluateCallMeNowConsent('+972501234567', NOW);
    expect(result).toEqual({ ok: false, reason: 'dnc' });
  });

  it('NO-GO: a phone with an opted-out contacts row anywhere is blocked', async () => {
    wireAdmin({ contacts: [{ data: { id: 'contact-9' }, error: null }] });
    vi.mocked(isDncListed).mockResolvedValue(false);
    const result = await evaluateCallMeNowConsent('+972501234567', NOW);
    expect(result).toEqual({ ok: false, reason: 'opted_out' });
  });

  it('NO-GO: Shabbat still blocks — the ONE hours gate that survives the ruling (was ALREADY correct before the ruling too; this pins it deliberately rather than leaving it looking coincidental)', async () => {
    wireAdmin({ contacts: [{ data: null, error: null }] });
    vi.mocked(isDncListed).mockResolvedValue(false);
    const saturday = Date.parse('2026-06-06T10:00:00+03:00');
    const result = await evaluateCallMeNowConsent('+972501234567', saturday);
    expect(result).toEqual({ ok: false, reason: 'quiet_hours' });
  });

  it('GO: the daily window (late Thursday evening, well past 19:00) does NOT block call-me-now — the ruling\'s actual effect, not just its absence of a Shabbat regression', async () => {
    wireAdmin({ contacts: [{ data: null, error: null }] });
    vi.mocked(isDncListed).mockResolvedValue(false);
    const lateThursday = Date.parse('2026-06-04T22:00:00+03:00');
    const result = await evaluateCallMeNowConsent('+972501234567', lateThursday);
    expect(result).toEqual({ ok: true });
  });
});

// The paired test the ruling specifically asked for: the SAME off-daily-window
// timestamp behaves DIFFERENTLY for resolveDialTarget's two existing kinds
// (still refuse — the ruling never touched them) vs. call-me-now's own gate
// (no longer refuses) — so a future edit that collapses the two paths back
// into one hours rule fails here first, loudly, rather than silently.
describe('daily-window ruling, paired: callback/guest_service keep it, call-me-now does not', () => {
  const lateThursday = Date.parse('2026-06-04T22:00:00+03:00'); // Thursday, well past 19:00

  it('resolveDialTarget(callback) still refuses at this hour', async () => {
    wireAdmin({
      callback_requests: [{
        data: {
          id: 'cb-paired', phone: '0501234567', status: 'new',
          requested_at: null, created_at: new Date(lateThursday - 60_000).toISOString(),
        },
        error: null,
      }],
      activity_log: [{ data: null, error: null, count: 0 } as unknown as QueryResult],
    });
    vi.mocked(isDncListed).mockResolvedValue(false);
    const result = await resolveDialTarget({ kind: 'callback', id: 'cb-paired' }, lateThursday);
    expect(result).toEqual({ ok: false, reason: 'quiet_hours' });
  });

  it('resolveDialTarget(guest_service) still refuses at this hour', async () => {
    wireAdmin({
      contacts: [{ data: { id: 'contact-paired', event_id: 'event-paired', normalized_phone: '+972501234567', removal_requested: false }, error: null }],
      guests: [{ data: { id: 'guest-paired' }, error: null }],
      events: [{ data: { id: 'event-paired', status: 'active', event_date: new Date(lateThursday).toISOString() }, error: null }],
    });
    vi.mocked(isDncListed).mockResolvedValue(false);
    const result = await resolveDialTarget({ kind: 'guest_service', eventId: 'event-paired', contactId: 'contact-paired' }, lateThursday);
    expect(result).toEqual({ ok: false, reason: 'quiet_hours' });
  });

  it('evaluateCallMeNowConsent does NOT refuse at the identical hour', async () => {
    wireAdmin({ contacts: [{ data: null, error: null }] });
    vi.mocked(isDncListed).mockResolvedValue(false);
    const result = await evaluateCallMeNowConsent('+972501234567', lateThursday);
    expect(result).toEqual({ ok: true });
  });
});

// offerCallbackForCallMeNow — the intent-time no-agent fallback (owner
// availability-first design, 12.8). Same idempotency shape as
// recordNoAgentCallback: an existing open request for the phone blocks a
// duplicate write. Asserted via from.mock.calls rather than a return value,
// since the function itself returns void — the observable behavior IS
// whether a second admin.from('callback_requests') call (the insert) ever
// happens.
describe('offerCallbackForCallMeNow — intent-time no-agent fallback', () => {
  it('writes a new callback_requests row when no open request exists for this phone', async () => {
    const client = wireAdmin({
      callback_requests: [
        { data: null, error: null }, // existence check: none found
        { data: null, error: null }, // insert
      ],
    });
    await offerCallbackForCallMeNow('+972501234567');
    const callbackCalls = client.from.mock.calls.filter((c) => c[0] === 'callback_requests');
    expect(callbackCalls.length).toBe(2); // existence check + insert
  });

  it('is idempotent — skips the insert when an open request for this phone already exists', async () => {
    const client = wireAdmin({
      callback_requests: [
        { data: { id: 'existing-cb' }, error: null }, // existence check: found one
      ],
    });
    await offerCallbackForCallMeNow('+972501234567');
    const callbackCalls = client.from.mock.calls.filter((c) => c[0] === 'callback_requests');
    expect(callbackCalls.length).toBe(1); // existence check only — no insert attempted
  });
});

// ─────────────────────────────────────────────────────────────────────────
// mintDialToken / verifyDialToken
// ─────────────────────────────────────────────────────────────────────────

describe('mintDialToken / verifyDialToken', () => {
  it('mints a ct<64-hex> token and stores only its SHA-256 hash', async () => {
    const update = vi.fn((_patch: { dial_token_hash: string; dial_token_expires_at: string }) => builder);
    const builder: Record<string, unknown> = { update, eq: vi.fn(() => builder) };
    (builder as { then: unknown }).then = (onFulfilled: (v: QueryResult) => unknown) =>
      onFulfilled({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      { from: vi.fn(() => builder), rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>,
    );

    const token = await mintDialToken('call-1');
    expect(token).toMatch(/^ct[0-9a-f]{64}$/);
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0][0] as { dial_token_hash: string };
    expect(patch.dial_token_hash).toBe(sha256Hex(token));
    expect(patch.dial_token_hash).not.toBe(token); // never the raw token
  });

  it('verifyDialToken rejects a malformed token without touching the DB', async () => {
    const from = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>);
    const result = await verifyDialToken('not-a-token', 'ct');
    expect(result).toEqual({ ok: false, reason: 'malformed' });
    expect(from).not.toHaveBeenCalled();
  });

  it('verifyDialToken: not_found when no live row matches (constant-time path still runs)', async () => {
    wireAdmin({ console_call_pii: [{ data: [], error: null }] });
    const token = `ct${'a'.repeat(64)}`;
    const result = await verifyDialToken(token, 'ct');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('verifyDialToken: single-use — succeeds once, then not_found on replay', async () => {
    const token = `ct${'b'.repeat(64)}`;
    const hash = sha256Hex(token);
    const row = { call_id: 'call-2', dial_token_hash: hash, dial_token_expires_at: new Date(Date.now() + 60_000).toISOString(), phone_e164: '+972501234567' };

    // First verify: select finds the row, then the consuming update succeeds.
    wireAdmin({
      console_call_pii: [
        { data: [row], error: null },
        { data: { call_id: 'call-2' }, error: null }, // consuming update .select().maybeSingle()
      ],
    });
    const first = await verifyDialToken(token, 'ct');
    expect(first).toEqual({ ok: true, callId: 'call-2', phone: '+972501234567' });

    // Replay: the row is gone (hash already nulled server-side) — select
    // returns nothing live for this hash.
    wireAdmin({ console_call_pii: [{ data: [], error: null }] });
    const second = await verifyDialToken(token, 'ct');
    expect(second).toEqual({ ok: false, reason: 'not_found' });
  });

  it('verifyDialToken: a wrong-but-well-formed token never matches a stored hash (constant-time compare)', async () => {
    const real = `ct${'c'.repeat(64)}`;
    const guess = `ct${'d'.repeat(64)}`;
    const row = { call_id: 'call-3', dial_token_hash: sha256Hex(real), dial_token_expires_at: new Date(Date.now() + 60_000).toISOString(), phone_e164: null };
    wireAdmin({ console_call_pii: [{ data: [row], error: null }] });
    const result = await verifyDialToken(guess, 'ct');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  // Cross-flow token collision — the bug an advisor review caught (12.8)
  // before either authorize route went live: ct and wt tokens share the
  // same dial_token_hash column, single-use. Without an expectedPrefix
  // check, a well-formed 'wt' (widget) token handed to ConsoleDial's
  // authorize route (or a 'ct' token handed to widget-authorize) would
  // still hash-match and get CONSUMED by the wrong flow, leaving the
  // rightful caller with a dead token and no recovery. This must be
  // rejected as 'malformed' before any DB read — a wrong-flow token is not
  // a "not_found", it should never even look.
  it('verifyDialToken rejects a well-formed token whose prefix does not match expectedPrefix, without touching the DB', async () => {
    const from = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>);
    const widgetToken = `wt${'e'.repeat(64)}`;
    const result = await verifyDialToken(widgetToken, 'ct');
    expect(result).toEqual({ ok: false, reason: 'malformed' });
    expect(from).not.toHaveBeenCalled();
  });

  it('verifyDialToken rejects a ct token when the caller expects wt, without touching the DB', async () => {
    const from = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>);
    const consoleToken = `ct${'f'.repeat(64)}`;
    const result = await verifyDialToken(consoleToken, 'wt');
    expect(result).toEqual({ ok: false, reason: 'malformed' });
    expect(from).not.toHaveBeenCalled();
  });

  // 'cn' (call-me-now, capability A third design, 12.8) — the third prefix
  // added to DIAL_TOKEN_PREFIXES. Proves mintDialToken/verifyDialToken are
  // genuinely generic over the prefix (not secretly ct/wt-only) and that the
  // same cross-flow rejection applies to the new prefix too.
  it('mints a cn<64-hex> token and verifies it only against expectedPrefix "cn"', async () => {
    const update = vi.fn((_patch: { dial_token_hash: string; dial_token_expires_at: string }) => builder);
    const builder: Record<string, unknown> = { update, eq: vi.fn(() => builder) };
    (builder as { then: unknown }).then = (onFulfilled: (v: QueryResult) => unknown) =>
      onFulfilled({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      { from: vi.fn(() => builder), rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>,
    );
    const token = await mintDialToken('call-9', 'cn');
    expect(token).toMatch(/^cn[0-9a-f]{64}$/);

    const from = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>);
    const wrongPrefix = await verifyDialToken(token, 'ct');
    expect(wrongPrefix).toEqual({ ok: false, reason: 'malformed' });
    expect(from).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveTransferTarget / getConsoleCallById / session-access (stage 7)
// ─────────────────────────────────────────────────────────────────────────

describe('resolveTransferTarget', () => {
  const SELF = 'agent-self';
  const TARGET = 'agent-target';

  it('refuses transferring to yourself before touching the DB', async () => {
    const from = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>);
    const result = await resolveTransferTarget(SELF, SELF);
    expect(result).toEqual({ ok: false, reason: 'self' });
    expect(from).not.toHaveBeenCalled();
  });

  it('not_found when the target has no vox_username', async () => {
    wireAdmin({ console_agents: [{ data: { vox_username: null }, error: null }] });
    const result = await resolveTransferTarget(TARGET, SELF);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('not_provisioned when a vox_username exists but the secret row does not', async () => {
    wireAdmin({
      console_agents: [{ data: { vox_username: 'agent_target' }, error: null }],
      console_agent_secrets: [{ data: null, error: null }],
    });
    const result = await resolveTransferTarget(TARGET, SELF);
    expect(result).toEqual({ ok: false, reason: 'not_provisioned' });
  });

  it('not_ready when provisioned but not status=ready', async () => {
    wireAdmin({
      console_agents: [{ data: { vox_username: 'agent_target' }, error: null }],
      console_agent_secrets: [{ data: { user_id: TARGET }, error: null }],
      agent_status: [{ data: { status: 'dnd', updated_at: new Date().toISOString() }, error: null }],
    });
    const result = await resolveTransferTarget(TARGET, SELF);
    expect(result).toEqual({ ok: false, reason: 'not_ready' });
  });

  // Freshness gate (full telephony audit, 13.8) — resolveTransferTarget used
  // to accept a bare status='ready' row with no staleness check, unlike
  // findRoutableAgents' identical <90s AGENT_STATUS_FRESHNESS_MS heartbeat
  // gate for inbound ring routing. These three cases pin the fix.
  it('not_ready when status=ready but updated_at is older than the freshness window', async () => {
    wireAdmin({
      console_agents: [{ data: { vox_username: 'agent_target' }, error: null }],
      console_agent_secrets: [{ data: { user_id: TARGET }, error: null }],
      agent_status: [
        { data: { status: 'ready', updated_at: new Date(Date.now() - 91_000).toISOString() }, error: null },
      ],
    });
    const result = await resolveTransferTarget(TARGET, SELF);
    expect(result).toEqual({ ok: false, reason: 'not_ready' });
  });

  it('not_ready — fails CLOSED when updated_at is missing/unparseable (never silently admits)', async () => {
    wireAdmin({
      console_agents: [{ data: { vox_username: 'agent_target' }, error: null }],
      console_agent_secrets: [{ data: { user_id: TARGET }, error: null }],
      agent_status: [{ data: { status: 'ready', updated_at: null }, error: null }],
    });
    const result = await resolveTransferTarget(TARGET, SELF);
    expect(result).toEqual({ ok: false, reason: 'not_ready' });
  });

  it('ok: provisioned + ready + fresh + not the caller resolves the vox_username', async () => {
    wireAdmin({
      console_agents: [{ data: { vox_username: 'agent_target' }, error: null }],
      console_agent_secrets: [{ data: { user_id: TARGET }, error: null }],
      agent_status: [{ data: { status: 'ready', updated_at: new Date().toISOString() }, error: null }],
    });
    const result = await resolveTransferTarget(TARGET, SELF);
    expect(result).toEqual({ ok: true, voxUsername: 'agent_target' });
  });
});

describe('findConsoleCallForEvent — Tier 0 exact call_id (inbound cross-call-misrouting fix)', () => {
  it('resolves directly from an exact, direction-matched call_id, never touching the FIFO tiers', async () => {
    wireAdmin({
      console_calls: [{ data: { id: 'call-exact' }, error: null }], // Tier 0 lookup
      console_call_pii: [{ data: { call_id: 'call-exact' }, error: null }], // linkSession's update
    });
    const result = await findConsoleCallForEvent({
      sessionId: 42,
      direction: 'inbound',
      callId: 'call-exact',
    });
    expect(result).toBe('call-exact');
  });

  it('falls through to Tier 1+ when no call_id is provided (existing outbound behaviour unaffected)', async () => {
    wireAdmin({
      console_call_pii: [{ data: { call_id: 'linked-call' }, error: null }], // Tier 1: already linked
    });
    const result = await findConsoleCallForEvent({ sessionId: 7, direction: 'outbound' });
    expect(result).toBe('linked-call');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// linkConsoleCallSession — authorize/route.ts + call-me-now-authorize/route.ts's
// direct session link (full telephony audit, 13.8). Closes the gap where a
// lost 'started' /event report leaves a row unlinkable via any later tier —
// see the function's own header in console-calls.ts.
// ─────────────────────────────────────────────────────────────────────────

describe('linkConsoleCallSession', () => {
  it('writes vox_session_id directly against the known call_id, guarded on it still being unset', async () => {
    const eq = vi.fn((_col: string, _val: unknown) => builder);
    const is = vi.fn((_col: string, _val: unknown) => builder);
    const update = vi.fn((_patch: { vox_session_id: number }) => builder);
    const builder: Record<string, unknown> = {
      update,
      eq,
      is,
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { call_id: 'call-1' }, error: null })),
    };
    vi.mocked(createAdminClient).mockReturnValue(
      { from: vi.fn(() => builder), rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>,
    );

    await linkConsoleCallSession('call-1', 12345);

    expect(update).toHaveBeenCalledWith({ vox_session_id: 12345 });
    expect(eq).toHaveBeenCalledWith('call_id', 'call-1');
    expect(is).toHaveBeenCalledWith('vox_session_id', null); // never overwrites an existing link
  });

  it('never throws — a DB failure is swallowed (best-effort, called from a gating route)', async () => {
    const builder: Record<string, unknown> = {
      update: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    };
    vi.mocked(createAdminClient).mockReturnValue(
      { from: vi.fn(() => builder), rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>,
    );
    await expect(linkConsoleCallSession('call-1', 1)).resolves.toBeUndefined();
  });
});

describe('findRoutableAgentVoxUsernames — <90s heartbeat freshness gate', () => {
  const NOW = Date.parse('2026-06-04T10:00:00Z');

  it('includes a ready agent whose heartbeat is fresh', async () => {
    wireAdmin({
      console_agents: [{ data: [{ user_id: 'a1', vox_username: 'agent_a1' }], error: null }],
      agent_status: [{
        data: [{ agent_id: 'a1', status: 'ready', updated_at: new Date(NOW - 30_000).toISOString() }],
        error: null,
      }],
    });
    expect(await findRoutableAgentVoxUsernames(NOW)).toEqual(['agent_a1']);
  });

  it('excludes a ready agent whose heartbeat is stale (>=90s)', async () => {
    wireAdmin({
      console_agents: [{ data: [{ user_id: 'a1', vox_username: 'agent_a1' }], error: null }],
      agent_status: [{
        data: [{ agent_id: 'a1', status: 'ready', updated_at: new Date(NOW - 90_000).toISOString() }],
        error: null,
      }],
    });
    expect(await findRoutableAgentVoxUsernames(NOW)).toEqual([]);
  });
});

describe('getConsoleCallById / session-access helpers', () => {
  it('getConsoleCallById returns null on a missing row instead of throwing', async () => {
    wireAdmin({ console_calls: [{ data: null, error: null }] });
    expect(await getConsoleCallById('nope')).toBeNull();
  });

  it('getConsoleCallById maps the row through the documented CHECK-constraint types', async () => {
    wireAdmin({
      console_calls: [{
        data: { id: 'call-1', status: 'connected', direction: 'outbound', kind: 'manual', event_id: 'event-1' },
        error: null,
      }],
    });
    expect(await getConsoleCallById('call-1')).toEqual({
      id: 'call-1', status: 'connected', direction: 'outbound', kind: 'manual', eventId: 'event-1',
    });
  });

  it('getConsoleCallSessionUrls reads both columns', async () => {
    wireAdmin({
      console_call_pii: [{
        data: { session_url: 'http://a.example', secure_session_url: 'https://a.example' },
        error: null,
      }],
    });
    expect(await getConsoleCallSessionUrls('call-1')).toEqual({
      sessionUrl: 'http://a.example',
      secureSessionUrl: 'https://a.example',
    });
  });

  it('getConsoleCallSessionUrls returns null when the row is missing', async () => {
    wireAdmin({ console_call_pii: [{ data: null, error: null }] });
    expect(await getConsoleCallSessionUrls('call-1')).toBeNull();
  });

  it('recordConsoleCallSessionAccess writes only the columns actually provided', async () => {
    const update = vi.fn(() => builder);
    const builder: Record<string, unknown> = { update, eq: vi.fn(() => builder) };
    (builder as { then: unknown }).then = (onFulfilled: (v: QueryResult) => unknown) =>
      onFulfilled({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      { from: vi.fn(() => builder), rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>,
    );

    await recordConsoleCallSessionAccess({
      callId: 'call-1',
      accessUrl: 'http://a.example',
      accessSecureUrl: null,
    });
    expect(update).toHaveBeenCalledWith({ session_url: 'http://a.example' });
  });

  it('recordConsoleCallSessionAccess no-ops (no DB write) when both urls are null', async () => {
    const from = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>);
    await recordConsoleCallSessionAccess({ callId: 'call-1', accessUrl: null, accessSecureUrl: null });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('notifyRoutableAgentsOfInboundCall (call-center research, 12.8 — capability B)', () => {
  it('no-ops (no DB query, no push) when the ring order is empty', async () => {
    const from = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>);
    await notifyRoutableAgentsOfInboundCall({ voxUsernames: [], consoleCallId: 'call-1' });
    expect(from).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('resolves vox_username -> user_id and pushes every routable agent with a PII-free, tagged payload', async () => {
    wireAdmin({
      console_agents: [{
        data: [
          { user_id: 'agent-1' },
          { user_id: 'agent-2' },
        ],
        error: null,
      }],
    });
    vi.mocked(sendPushToUser).mockResolvedValue({ attempted: 1, sent: 1, failed: 0, revoked: 0 });

    await notifyRoutableAgentsOfInboundCall({
      voxUsernames: ['agent_agent-1', 'agent_agent-2'],
      consoleCallId: 'call-42',
    });

    expect(sendPushToUser).toHaveBeenCalledTimes(2);
    expect(sendPushToUser).toHaveBeenCalledWith('agent-1', {
      title: 'KALFA — מוקד שירות',
      body: 'שיחה נכנסת ממתינה במוקד',
      // Deep-links to the specific call (teammate enhancement, 12.8 —
      // wake-and-answer research) — softphone-panel.tsx reads `call` to
      // auto-open. Still not PII, see the function's own comment.
      url: '/admin?call=call-42',
      tag: 'console-call-call-42',
    });
    expect(sendPushToUser).toHaveBeenCalledWith('agent-2', expect.objectContaining({ tag: 'console-call-call-42' }));
    // No caller name/number/event id anywhere in the payload.
    for (const call of vi.mocked(sendPushToUser).mock.calls) {
      expect(JSON.stringify(call[1])).not.toMatch(/\+?\d{7,}/);
    }
  });

  it('one rejected push never throws or blocks the others (best-effort, matches the audit-log precedent)', async () => {
    wireAdmin({
      console_agents: [{ data: [{ user_id: 'agent-1' }, { user_id: 'agent-2' }], error: null }],
    });
    vi.mocked(sendPushToUser)
      .mockRejectedValueOnce(new Error('expired subscription'))
      .mockResolvedValueOnce({ attempted: 1, sent: 1, failed: 0, revoked: 0 });

    await expect(
      notifyRoutableAgentsOfInboundCall({ voxUsernames: ['agent_a', 'agent_b'], consoleCallId: 'call-1' }),
    ).resolves.toBeUndefined();
    expect(sendPushToUser).toHaveBeenCalledTimes(2);
  });

  it('a DB lookup error resolves silently instead of throwing (fail-open on the alert, not on the call)', async () => {
    wireAdmin({ console_agents: [{ data: null, error: { message: 'boom' } }] });
    await expect(
      notifyRoutableAgentsOfInboundCall({ voxUsernames: ['agent_a'], consoleCallId: 'call-1' }),
    ).resolves.toBeUndefined();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});

describe('isShiftActiveAndFresh (pure — wake-and-answer research, 12.8)', () => {
  it('false when there is no row at all', () => {
    expect(isShiftActiveAndFresh(null)).toBe(false);
  });

  it('false when the row exists but active is false', () => {
    expect(
      isShiftActiveAndFresh({ active: false, updated_at: new Date().toISOString() }),
    ).toBe(false);
  });

  it('true when active and updated recently', () => {
    const now = Date.now();
    expect(
      isShiftActiveAndFresh({ active: true, updated_at: new Date(now - 1000).toISOString() }, now),
    ).toBe(true);
  });

  it('false when active but stale beyond CONSOLE_SHIFT_FRESHNESS_MS — the forgotten-toggle case (a 09:00 "ready" must not silently reactivate a 16:00 page view)', () => {
    const now = Date.now();
    const staleIso = new Date(now - CONSOLE_SHIFT_FRESHNESS_MS - 1000).toISOString();
    expect(isShiftActiveAndFresh({ active: true, updated_at: staleIso }, now)).toBe(false);
  });

  it('false when updated_at is unparseable', () => {
    expect(isShiftActiveAndFresh({ active: true, updated_at: 'not-a-date' })).toBe(false);
  });
});

describe('notifyOffDutyShiftAgentsOfInboundCall (wake-and-answer research, 12.8)', () => {
  it('no-ops (no push) when console_wake_enabled is off — the fail-closed default', async () => {
    wireAdmin({ app_settings: [{ data: { console_wake_enabled: false }, error: null }] });
    await notifyOffDutyShiftAgentsOfInboundCall({ consoleCallId: 'call-1', excludeVoxUsernames: [] });
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('pushes only agents with a fresh, active shift row AND a non-revoked push subscription, excluding already-notified vox_usernames', async () => {
    wireAdmin({
      app_settings: [{ data: { console_wake_enabled: true }, error: null }],
      console_agents: [
        {
          data: [
            { user_id: 'agent-1', vox_username: 'agent_agent-1' }, // on-shift + subscribed -> pushed
            { user_id: 'agent-2', vox_username: 'agent_agent-2' }, // shift row exists but inactive -> not pushed
            { user_id: 'agent-3', vox_username: 'agent_agent-3' }, // already covered by the routable-agent push -> excluded
          ],
          error: null,
        },
      ],
      console_agent_shift: [
        {
          data: [
            { agent_id: 'agent-1', active: true, updated_at: new Date().toISOString() },
            { agent_id: 'agent-2', active: false, updated_at: new Date().toISOString() },
          ],
          error: null,
        },
      ],
      push_subscriptions: [{ data: [{ user_id: 'agent-1' }], error: null }],
    });
    vi.mocked(sendPushToUser).mockResolvedValue({ attempted: 1, sent: 1, failed: 0, revoked: 0 });

    await notifyOffDutyShiftAgentsOfInboundCall({
      consoleCallId: 'call-42',
      excludeVoxUsernames: ['agent_agent-3'],
    });

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith('agent-1', {
      title: 'KALFA — מוקד שירות',
      body: 'שיחה נכנסת ממתינה במוקד',
      url: '/admin?call=call-42',
      tag: 'console-call-call-42',
    });
  });

  it('never throws on a DB error at any stage (best-effort, matches notifyRoutableAgentsOfInboundCall)', async () => {
    wireAdmin({
      app_settings: [{ data: { console_wake_enabled: true }, error: null }],
      console_agents: [{ data: null, error: { message: 'boom' } }],
    });
    await expect(
      notifyOffDutyShiftAgentsOfInboundCall({ consoleCallId: 'call-1', excludeVoxUsernames: [] }),
    ).resolves.toBeUndefined();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});

describe('routeInboundRetryBodySchema (wake-and-answer research, 12.8)', () => {
  // Real v4-shaped UUID (zod 4 validates the version/variant nibbles
  // strictly — an all-'1's placeholder fails) — same fixture convention as
  // dialIntentBodySchema's own tests above.
  const validCallId = '11111111-1111-4111-8111-111111111111';

  it('accepts a well-formed retry body', () => {
    const result = routeInboundRetryBodySchema.safeParse({
      secret: 's'.repeat(10),
      call_id: validCallId,
      already_tried: ['agent_a', 'agent_b'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty already_tried array', () => {
    const result = routeInboundRetryBodySchema.safeParse({
      secret: 's'.repeat(10),
      call_id: validCallId,
      already_tried: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 20 already_tried entries', () => {
    const result = routeInboundRetryBodySchema.safeParse({
      secret: 's'.repeat(10),
      call_id: validCallId,
      already_tried: Array.from({ length: 21 }, (_, i) => `agent_${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid call_id', () => {
    const result = routeInboundRetryBodySchema.safeParse({
      secret: 's'.repeat(10),
      call_id: 'not-a-uuid',
      already_tried: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unexpected extra field (strictObject)', () => {
    const result = routeInboundRetryBodySchema.safeParse({
      secret: 's'.repeat(10),
      call_id: validCallId,
      already_tried: [],
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

// Reported live 14.8: "שיחה נכנסת ממתינה במוקד" notifications piled up on the
// agent's device, each still claiming a call was waiting long after it hung up.
// Nothing ever closed them — sw.js only closes on notificationclick.
describe('notifyAgentsInboundCallResolved (stale inbound-call notification, 14.8)', () => {
  beforeEach(() => {
    vi.mocked(sendPushToUser).mockResolvedValue({ attempted: 1, sent: 1, failed: 0, revoked: 0 });
  });

  it('reuses the ORIGINAL tag so the stale notification is replaced, not stacked beside it', async () => {
    wireAdmin({ push_delivery_log: [{ data: [{ user_id: 'agent-1' }], error: null }] });

    await notifyAgentsInboundCallResolved({ consoleCallId: 'call-9', reason: 'completed' });

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith('agent-1', {
      title: 'KALFA — מוקד שירות',
      body: 'השיחה הנכנסת הסתיימה.',
      url: '/admin?call=call-9',
      // Identical to notifyRoutableAgentsOfInboundCall's tag for the same call.
      // If these ever drift, the replacement becomes a SECOND notification and
      // this function makes the reported problem worse instead of fixing it.
      tag: 'console-call-call-9',
      // Corrects an alert already delivered — must not buzz again.
      silent: true,
    });
  });

  it('tells the agent a callback was recorded when the ring found nobody', async () => {
    // recordNoAgentCallback runs on the same 'ended' event, so the follow-up
    // genuinely exists — this is the actionable half, not just "you missed one".
    wireAdmin({ push_delivery_log: [{ data: [{ user_id: 'agent-1' }], error: null }] });

    await notifyAgentsInboundCallResolved({ consoleCallId: 'call-9', reason: 'no_agent' });

    expect(sendPushToUser).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      body: 'שיחה נכנסת לא נענתה. נרשמה בקשה לחזור אל המתקשר.',
    }));
  });

  it('never invents a recipient: pushes ONLY agents the log says received the original', async () => {
    // The whole reason the audience comes from push_delivery_log rather than
    // re-deriving the routable set. An agent who never saw "call waiting" must
    // not be handed "call ended" out of nowhere.
    wireAdmin({ push_delivery_log: [{ data: [], error: null }] });

    await notifyAgentsInboundCallResolved({ consoleCallId: 'call-9', reason: 'no_agent' });

    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('deduplicates an agent who has several subscriptions logged for the same call', async () => {
    // One row per subscription, not per user — a phone plus a laptop would
    // otherwise get the same replacement pushed twice.
    wireAdmin({
      push_delivery_log: [{
        data: [{ user_id: 'agent-1' }, { user_id: 'agent-1' }, { user_id: 'agent-2' }],
        error: null,
      }],
    });

    await notifyAgentsInboundCallResolved({ consoleCallId: 'call-9' });

    expect(sendPushToUser).toHaveBeenCalledTimes(2);
  });

  it('stays silent when the log read fails rather than failing the end-of-call report', async () => {
    // Best-effort: this shares the 'ended' event with closing the call row and
    // creating the callback, and a stale notification must never cost those.
    wireAdmin({ push_delivery_log: [{ data: null, error: { message: 'boom' } }] });

    await expect(
      notifyAgentsInboundCallResolved({ consoleCallId: 'call-9', reason: 'no_agent' }),
    ).resolves.toBeUndefined();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});

// agent_status has an 'in_call' value nothing ever writes, so "busy" is derived
// from the calls table instead. The TIME BOUND is the part that matters: there
// is no sweep closing stuck console_calls rows, so an unbounded exclusion would
// drop an agent from routing permanently over one leaked row.
describe('findRoutableAgents — busy exclusion (14.8)', () => {
  const AGENT = { user_id: 'agent-1', vox_username: 'agent_agent-1' };
  const freshStatus = [{ agent_id: 'agent-1', status: 'ready', updated_at: new Date().toISOString() }];

  it('excludes an agent who is on a live connected call', async () => {
    wireAdmin({
      console_agents: [{ data: [AGENT], error: null }],
      agent_status: [{ data: freshStatus, error: null }],
      console_calls: [{ data: [{ agent_id: 'agent-1' }], error: null }],
    });

    expect(await findRoutableAgents()).toEqual([]);
  });

  it('routes normally when the agent has no live call', async () => {
    wireAdmin({
      console_agents: [{ data: [AGENT], error: null }],
      agent_status: [{ data: freshStatus, error: null }],
      console_calls: [{ data: [], error: null }],
    });

    expect(await findRoutableAgents()).toEqual([
      { agentId: 'agent-1', voxUsername: 'agent_agent-1' },
    ]);
  });

  it('fails OPEN when the live-call lookup errors', async () => {
    // Not knowing who is busy must never empty the ring order. A ring to a busy
    // agent costs one window and their SDK rejects it; an empty ring order tells
    // a real caller nobody is available at all.
    wireAdmin({
      console_agents: [{ data: [AGENT], error: null }],
      agent_status: [{ data: freshStatus, error: null }],
      console_calls: [{ data: null, error: { message: 'boom' } }],
    });

    expect(await findRoutableAgents()).toEqual([
      { agentId: 'agent-1', voxUsername: 'agent_agent-1' },
    ]);
  });

  it('still gates on the heartbeat, so a stale ready agent is out regardless of calls', async () => {
    wireAdmin({
      console_agents: [{ data: [AGENT], error: null }],
      agent_status: [{
        data: [{ agent_id: 'agent-1', status: 'ready', updated_at: new Date(Date.now() - 10 * 60_000).toISOString() }],
        error: null,
      }],
      console_calls: [{ data: [], error: null }],
    });

    expect(await findRoutableAgents()).toEqual([]);
  });

  it('does not query live calls at all when nobody passed the heartbeat gate', async () => {
    // Guards the candidateIds.length check: an empty `.in()` list is both a
    // wasted round trip and, in PostgREST, a filter that matches nothing in a
    // way that is easy to misread later.
    const client = wireAdmin({
      console_agents: [{ data: [AGENT], error: null }],
      agent_status: [{ data: [], error: null }],
    });

    expect(await findRoutableAgents()).toEqual([]);
    expect(client.from).not.toHaveBeenCalledWith('console_calls');
  });
});
