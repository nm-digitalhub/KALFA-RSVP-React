import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// Module mocks, not table stubs: the preflight helper lives in outreach-engine
// (whose real import graph is the whole outreach engine) and the dispatch-row
// helpers have their own unit suite (call-dispatch-status.test.ts). The route
// test asserts WHEN they are called and how their answers steer the response.
vi.mock('@/lib/data/outreach-engine', () => ({ isContactReached: vi.fn() }));
vi.mock('@/lib/data/call-dispatch-status', () => ({
  recordDispatchAccepted: vi.fn(),
  settleDispatchFailure: vi.fn(),
}));

// vi.mock is hoisted above every declaration, so the capture cell has to be
// hoisted with it — a plain `let` above would still be in TDZ when the factory
// runs. This test failed exactly that way when first written.
const boss = vi.hoisted(() => ({
  send: vi.fn(),
  options: {} as Record<string, unknown>,
}));

vi.mock('pg-boss', () => ({
  PgBoss: class {
    constructor(opts: Record<string, unknown>) {
      boss.options = opts;
    }
    async start() {
      return this;
    }
    send = boss.send;
  },
}));

import { POST } from './route';
import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { recordDispatchAccepted, settleDispatchFailure } from '@/lib/data/call-dispatch-status';
import { isContactReached } from '@/lib/data/outreach-engine';
import { createAdminClient } from '@/lib/supabase/admin';
import { QUEUES } from '@/lib/queue/queues';

const EVENT = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN = '44444444-4444-4444-8444-444444444444';

function call(eventId = EVENT, body: unknown = { guest_id: GUEST }) {
  const req = new Request(`https://beta.kalfa.me/api/events/${eventId}/outreach-call`, {
    method: 'POST',
    headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ eventId }) });
}

/** Supabase stub: campaigns list, then guest, then contact. */
function stubAdmin(opts: {
  campaigns?: { id: string }[];
  guest?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
} = {}) {
  const {
    campaigns = [{ id: CAMPAIGN }],
    guest = { contact_id: CONTACT, event_id: EVENT },
    contact = { normalized_phone: '+972501234567' },
  } = opts;
  return {
    from: (table: string) => {
      if (table === 'campaigns') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: undefined,
        } as unknown as Record<string, unknown>;
        // final .eq() resolves — model it as a thenable chain
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: campaigns, error: null }),
            }),
          }),
        };
      }
      if (table === 'guests') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: guest }) }) }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: contact }) }) }) };
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  boss.send.mockResolvedValue('job');
  // boss.options is deliberately NOT reset: getSender caches a module-level
  // singleton, so PgBoss is constructed exactly once for the whole file.
  // Clearing it here left the assertion below reading {} — which is the
  // singleton working, not the option missing.
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: 'u', supabase: {} },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(true);
  vi.mocked(createAdminClient).mockReturnValue(stubAdmin());
  vi.mocked(isContactReached).mockResolvedValue(false);
  vi.mocked(recordDispatchAccepted).mockResolvedValue(true);
  vi.mocked(settleDispatchFailure).mockResolvedValue(undefined);
});

describe('POST /api/events/{eventId}/outreach-call', () => {
  it('enqueues a manual dial and answers accepted with a pollable dispatch_id', async () => {
    const res = await call();
    expect(res.status).toBe(202);
    const body = await res.json();

    // 'accepted', never 'queued': eleven gates still run in the worker, so
    // claiming the call is queued to dial would promise more than is known.
    expect(body.status).toBe('accepted');
    expect(body.dispatch_id).toMatch(/^[0-9a-f-]{36}$/);

    const [queue, job, opts] = boss.send.mock.calls[0];
    expect(queue).toBe(QUEUES.callRequest);
    // The pg-boss job id IS the handle handed to the caller — one id, not two.
    expect(opts.id).toBe(body.dispatch_id);
    expect(job.dispatchId).toBe(body.dispatch_id);
    expect(job.isManual).toBe(true);
  });

  it('never carries a client-supplied phone — the target comes from our data', async () => {
    await call(EVENT, { guest_id: GUEST, phone: '+972500000000' });
    // strictObject rejects the smuggled field outright.
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('does not compute a touchpoint index in the route', async () => {
    await call();
    const [, job] = boss.send.mock.calls[0];
    // Allocation happens in the database under an advisory lock; anything
    // derived here would race two operators onto the same index and lose one
    // call to ON CONFLICT DO NOTHING.
    expect(job.touchpointIndex).toBe(0);
    expect(job.isManual).toBe(true);
  });

  it('uses the inert scriptKey consistently rather than inventing one', async () => {
    await call();
    expect(boss.send.mock.calls[0][1].scriptKey).toBe('rsvp_v1');
  });

  it('refuses when the event has no ACTIVE campaign', async () => {
    vi.mocked(createAdminClient).mockReturnValue(stubAdmin({ campaigns: [] }));
    const res = await call();
    expect(res.status).toBe(409);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('refuses ambiguity rather than picking one of several active campaigns', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      stubAdmin({ campaigns: [{ id: CAMPAIGN }, { id: 'other' }] }),
    );
    const res = await call();
    expect(res.status).toBe(409);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('404s a guest belonging to a different event', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      stubAdmin({ guest: { contact_id: CONTACT, event_id: 'someone-else' } }),
    );
    expect((await call()).status).toBe(404);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('422s a guest with no dialable number', async () => {
    vi.mocked(createAdminClient).mockReturnValue(stubAdmin({ contact: null }));
    expect((await call()).status).toBe(422);
  });

  it('rejects an unauthenticated caller before reading anything', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await call()).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('requires manage_voice', async () => {
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(boss.send).not.toHaveBeenCalled();
  });

  // ── already_reached preflight ([D3] CLOSED) + the dispatch-status contract ──

  it('answers 202 only after the preflight passed AND an accepted row exists (spec test 1)', async () => {
    const order: string[] = [];
    vi.mocked(recordDispatchAccepted).mockImplementation(async () => {
      order.push('accepted-row');
      return true;
    });
    boss.send.mockImplementation(async () => {
      order.push('send');
      return 'job';
    });

    const res = await call();
    expect(res.status).toBe(202);
    const body = await res.json();

    // Preflight is computed by (event_id, contact_id) ONLY — the exact pair,
    // which is also what makes the SAME contact dialable in a DIFFERENT event
    // (spec test 3: billed_results is UNIQUE(event_id, contact_id)).
    expect(isContactReached).toHaveBeenCalledWith(EVENT, CONTACT);

    // The row precedes the enqueue: every 202 has an 'accepted' row the app
    // can watch — the worker only ever SETTLES it.
    expect(order).toEqual(['accepted-row', 'send']);
    expect(recordDispatchAccepted).toHaveBeenCalledWith({
      dispatchId: body.dispatch_id,
      eventId: EVENT,
      contactId: CONTACT,
    });
  });

  it('allows the SAME contact in a DIFFERENT event — 202 and a job (spec test 3, behavioral)', async () => {
    const EVENT2 = '99999999-9999-4999-8999-999999999999';
    // Reach state is per (event_id, contact_id): this contact IS reached in
    // EVENT, and is NOT in EVENT2 — the mock answers per the pair, so the test
    // exercises the actual scoping, not just the argument list.
    vi.mocked(isContactReached).mockImplementation(
      async (eventId: string, contactId: string) => eventId === EVENT && contactId === CONTACT,
    );
    vi.mocked(createAdminClient).mockReturnValue(
      stubAdmin({ guest: { contact_id: CONTACT, event_id: EVENT2 } }),
    );

    const res = await call(EVENT2);
    expect(res.status).toBe(202);
    expect(isContactReached).toHaveBeenCalledWith(EVENT2, CONTACT);
    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send.mock.calls[0][1]).toMatchObject({ eventId: EVENT2, contactId: CONTACT });
  });

  it('409s an already-reached contact with a typed domain code — no job, no row (spec test 2)', async () => {
    vi.mocked(isContactReached).mockResolvedValue(true);
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    // The app branches on `code`, never on the Hebrew string.
    expect(body.code).toBe('already_reached');
    expect(boss.send).not.toHaveBeenCalled();
    expect(recordDispatchAccepted).not.toHaveBeenCalled();
  });

  it('500s (and does NOT enqueue) when the accepted row cannot be recorded', async () => {
    vi.mocked(recordDispatchAccepted).mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(500);
    // A dial whose status cannot be published would resolve into silence —
    // refuse it rather than dial blind.
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('settles failed/temporary_dispatch_failure on the 502 enqueue-failure path', async () => {
    boss.send.mockRejectedValue(new Error('pg down'));
    const res = await call();
    expect(res.status).toBe(502);
    // No job exists, so no worker will ever settle the row — the route must,
    // or it stays 'accepted' forever.
    expect(settleDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT, contactId: CONTACT }),
    );
  });

  it('still answers 502 when the failure-settle itself throws (strict helper, caught here)', async () => {
    boss.send.mockRejectedValue(new Error('pg down'));
    vi.mocked(settleDispatchFailure).mockRejectedValue(new Error('db down too'));
    const res = await call();
    // The app already knows the request failed (no 202 was given) — the stale
    // 'accepted' row is logged inside the helper and cleared by retention.
    expect(res.status).toBe(502);
  });

  it('opens pg-boss send-only, with migrate off', async () => {
    await call();
    // migrate is the load-bearing one: pg-boss defaults it to TRUE, and start()
    // branches on it into contractor.start() — which CREATES or MIGRATES the
    // schema the worker owns, on every cold start of the web tier.
    expect(boss.options.migrate).toBe(false);
    expect(boss.options.supervise).toBe(false);
    expect(boss.options.schedule).toBe(false);
  });
});

// The route is the wrong place for dial logic; these pin that it stays that way.
describe('outreach-call route stays enqueue-only (source guard)', () => {
  const src = readFileSync(
    join(__dirname, 'route.ts'),
    'utf8',
  );

  it('never imports the mutations module or names StartScenarios', () => {
    expect(src).not.toMatch(/from ['"].*voximplant\/mutations['"]/);
    expect(src).not.toContain('startScenarios');
  });

  it('runs no dial gate EXCEPT the already-reached preflight', () => {
    // Deliberately revised (2026-07-22, [D3] CLOSED): the route runs exactly
    // ONE gate — the synchronous already-reached preflight, so the app gets a
    // typed 409 instead of a 202 for a dial the worker is certain to refuse.
    // Every OTHER gate stays in the worker, where job-time state is fresh; the
    // worker also re-checks already-reached as race protection.
    for (const gate of ['hasCallConsent', 'isDncListed', 'rsvpClosedReason']) {
      expect(src).not.toContain(gate);
    }
    expect(src).toContain('isContactReached');
    expect(src).toMatch(/code:\s*'already_reached'/);
  });

  it('does not reintroduce a locally computed touchpoint index', () => {
    expect(src).not.toContain('Date.now() %');
    expect(src).not.toContain('MANUAL_TOUCHPOINT_BASE');
  });

  it('does not SET createSchema, which would document the wrong gate', () => {
    // createSchema defaults true but is only read inside contractor.create(),
    // which check() never reaches. Setting it would tell a future reader it is
    // what prevents schema creation, when the actual gate is migrate: false.
    //
    // Matches an ASSIGNMENT, not the word: the comment above the option
    // deliberately explains why it is absent, and that explanation is worth
    // more than a grep-clean file. This test failed on the word when written.
    expect(src).not.toMatch(/createSchema\s*:/);
    expect(src).toMatch(/migrate:\s*false/);
  });
});
