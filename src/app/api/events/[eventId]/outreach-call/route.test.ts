import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

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

  it('runs no dial gate itself — every one belongs to the worker', () => {
    for (const gate of ['hasCallConsent', 'isDncListed', 'isContactReached', 'rsvpClosedReason']) {
      expect(src).not.toContain(gate);
    }
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
