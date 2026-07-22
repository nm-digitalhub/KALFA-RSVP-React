import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import {
  DISPATCH_REASON_VALUES,
  DISPATCH_STATUS_VALUES,
  mapDispatchResult,
  recordDispatchAccepted,
  runDispatchRetention,
  settleDispatch,
  settleDispatchFailure,
  settleManualDispatch,
} from './call-dispatch-status';
import { createAdminClient } from '@/lib/supabase/admin';
import type { CallDispatchResult } from '@/lib/data/outreach-calls';
import type { OutreachCallRequest } from '@/lib/queue/queues';

const DISPATCH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const ATTEMPT = '55555555-5555-4555-8555-555555555555';

function job(overrides: Partial<OutreachCallRequest> = {}): OutreachCallRequest {
  return {
    campaignId: 'c',
    eventId: EVENT,
    contactId: CONTACT,
    normalizedPhone: '+972501234567',
    scriptKey: 'rsvp_v1',
    touchpointIndex: 0,
    isManual: true,
    dispatchId: DISPATCH,
    ...overrides,
  };
}

/** Admin stub capturing insert/upsert/delete calls on call_dispatch_status. */
function stubAdmin(opts: { insertError?: boolean; upsertError?: boolean } = {}) {
  const calls = {
    insert: [] as unknown[],
    upsert: [] as { row: unknown; opts: unknown }[],
    deleteLt: [] as { column: string; value: string }[],
  };
  const client = {
    from: (table: string) => {
      expect(table).toBe('call_dispatch_status');
      return {
        insert: async (row: unknown) => {
          calls.insert.push(row);
          return { error: opts.insertError ? { code: 'boom' } : null };
        },
        upsert: async (row: unknown, uOpts: unknown) => {
          calls.upsert.push({ row, opts: uOpts });
          return { error: opts.upsertError ? { code: 'boom' } : null };
        },
        delete: () => ({
          lt: async (column: string, value: string) => {
            calls.deleteLt.push({ column, value });
            return { error: null };
          },
        }),
      };
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(client as never);
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── The closed worker→public mapping ────────────────────────────────────────

// Every FINAL CallDispatchResult variant, enumerated literally. If a new kind
// or reason is added to the union, the totality test below still passes only
// because mapDispatchResult's `never` default makes an unmapped kind a COMPILE
// error first — this list is the runtime witness for the reasons.
const FINAL_RESULTS: Exclude<CallDispatchResult, { kind: 'transient_error' }>[] = [
  { kind: 'skipped', reason: 'outreach_disabled' },
  { kind: 'skipped', reason: 'no_call_consent' },
  { kind: 'skipped', reason: 'dnc_listed' },
  { kind: 'skipped', reason: 'already_reached' },
  { kind: 'skipped', reason: 'campaign_not_active' },
  { kind: 'skipped', reason: 'event_closed' },
  { kind: 'skipped', reason: 'concurrent_owner' },
  { kind: 'skipped', reason: 'max_concurrency' },
  { kind: 'skipped', reason: 'campaign_hour_cap' },
  { kind: 'blocked', reason: 'config_missing' },
  { kind: 'blocked', reason: 'live_calls_disabled' },
  { kind: 'blocked', reason: 'balance_below_reserve' },
  { kind: 'already_dispatched', attemptId: ATTEMPT },
  { kind: 'already_concluded', attemptId: ATTEMPT, status: 'completed' },
  { kind: 'dialed', attemptId: ATTEMPT, callSessionHistoryId: 1 },
  { kind: 'failed_to_start', attemptId: ATTEMPT, code: null },
  { kind: 'start_unknown', attemptId: ATTEMPT },
];

describe('mapDispatchResult — closed public mapping', () => {
  it('maps EVERY final dispatcher outcome to a valid public settlement (totality)', () => {
    for (const result of FINAL_RESULTS) {
      const s = mapDispatchResult(result);
      expect(DISPATCH_STATUS_VALUES).toContain(s.status);
      expect(s.status).not.toBe('accepted'); // a settle is never 'accepted'
      if (s.reason !== null) expect(DISPATCH_REASON_VALUES).toContain(s.reason);
    }
  });

  it("publishes skipped/already_reached as a domain refusal, verbatim", () => {
    expect(mapDispatchResult({ kind: 'skipped', reason: 'already_reached' })).toEqual({
      status: 'skipped',
      reason: 'already_reached',
      attemptId: null,
    });
  });

  it("crosswalks outreach_disabled to public 'blocked' despite internal kind 'skipped'", () => {
    expect(mapDispatchResult({ kind: 'skipped', reason: 'outreach_disabled' })).toEqual({
      status: 'blocked',
      reason: 'outreach_disabled',
      attemptId: null,
    });
  });

  it("publishes a lost race as 'dispatched' linked to the WINNER's attempt — never a failure", () => {
    expect(mapDispatchResult({ kind: 'already_dispatched', attemptId: ATTEMPT })).toEqual({
      status: 'dispatched',
      reason: 'already_dispatched',
      attemptId: ATTEMPT,
    });
    expect(
      mapDispatchResult({ kind: 'already_concluded', attemptId: ATTEMPT, status: 'completed' }),
    ).toEqual({ status: 'dispatched', reason: 'already_concluded', attemptId: ATTEMPT });
  });

  it("publishes start_unknown as 'unknown' — never failed, never redial bait", () => {
    expect(mapDispatchResult({ kind: 'start_unknown', attemptId: ATTEMPT })).toEqual({
      status: 'unknown',
      reason: 'start_unknown',
      attemptId: ATTEMPT,
    });
  });
});

// ─── Row lifecycle helpers ───────────────────────────────────────────────────

describe('recordDispatchAccepted', () => {
  it("inserts the 'accepted' row and reports success", async () => {
    const calls = stubAdmin();
    const ok = await recordDispatchAccepted({ dispatchId: DISPATCH, eventId: EVENT, contactId: CONTACT });
    expect(ok).toBe(true);
    expect(calls.insert[0]).toMatchObject({
      dispatch_id: DISPATCH,
      event_id: EVENT,
      contact_id: CONTACT,
      status: 'accepted',
    });
  });

  it('reports failure so the route can refuse instead of dialling blind', async () => {
    stubAdmin({ insertError: true });
    const ok = await recordDispatchAccepted({ dispatchId: DISPATCH, eventId: EVENT, contactId: CONTACT });
    expect(ok).toBe(false);
  });
});

describe('settleDispatch / settleManualDispatch', () => {
  it('UPSERTs by dispatch_id (version-skew tolerance: pre-deploy jobs have no accepted row)', async () => {
    const calls = stubAdmin();
    await settleDispatch({
      dispatchId: DISPATCH,
      eventId: EVENT,
      contactId: CONTACT,
      settlement: { status: 'skipped', reason: 'already_reached', attemptId: null },
    });
    expect(calls.upsert[0].opts).toMatchObject({ onConflict: 'dispatch_id' });
    expect(calls.upsert[0].row).toMatchObject({
      dispatch_id: DISPATCH,
      status: 'skipped',
      reason: 'already_reached',
      call_attempt_id: null,
    });
  });

  it('THROWS on a failed settle — the worker must never complete a job with the row stuck accepted', async () => {
    // The contract violation this pins: Supabase returns an error → log-and-
    // continue → job completes → the app stares at 'accepted' forever. A throw
    // fails the job instead, pg-boss redelivers (dial-safe: the attempt row
    // reconciles, never a second StartScenarios), and the settle is retried;
    // final failure = pg-boss `failed` + Slack alert, never a silent success.
    stubAdmin({ upsertError: true });
    await expect(
      settleDispatch({
        dispatchId: DISPATCH,
        eventId: EVENT,
        contactId: CONTACT,
        settlement: { status: 'failed', reason: 'temporary_dispatch_failure', attemptId: null },
      }),
    ).rejects.toThrow(/settle failed/);
  });

  it('settleManualDispatch propagates the throw — no swallow layer above the strict settle', async () => {
    stubAdmin({ upsertError: true });
    await expect(
      settleManualDispatch(job(), { kind: 'dialed', attemptId: ATTEMPT, callSessionHistoryId: 7 }),
    ).rejects.toThrow(/settle failed/);
  });

  it('settles a manual job with the mapped outcome, carrying the attempt id', async () => {
    const calls = stubAdmin();
    await settleManualDispatch(job(), {
      kind: 'dialed',
      attemptId: ATTEMPT,
      callSessionHistoryId: 7,
    });
    expect(calls.upsert[0].row).toMatchObject({
      status: 'dispatched',
      reason: null,
      call_attempt_id: ATTEMPT,
    });
  });

  it('no-ops for campaign/callback jobs (not isManual) and for jobs without a dispatchId', async () => {
    const calls = stubAdmin();
    await settleManualDispatch(job({ isManual: false }), { kind: 'dialed', attemptId: ATTEMPT, callSessionHistoryId: 7 });
    await settleManualDispatch(job({ dispatchId: undefined }), { kind: 'dialed', attemptId: ATTEMPT, callSessionHistoryId: 7 });
    expect(calls.upsert).toHaveLength(0);
  });
});

describe('settleDispatchFailure', () => {
  it('publishes the classified public reason — never exception text', async () => {
    const calls = stubAdmin();
    await settleDispatchFailure({ dispatchId: DISPATCH, eventId: EVENT, contactId: CONTACT });
    expect(calls.upsert[0].row).toMatchObject({
      status: 'failed',
      reason: 'temporary_dispatch_failure',
    });
  });
});

describe('runDispatchRetention', () => {
  it('deletes rows older than the 30-day cutoff and never throws', async () => {
    const calls = stubAdmin();
    await runDispatchRetention();
    expect(calls.deleteLt).toHaveLength(1);
    expect(calls.deleteLt[0].column).toBe('created_at');
    const cutoffMs = Date.parse(calls.deleteLt[0].value);
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expected)).toBeLessThan(60_000);
  });
});

// ─── Contract: the TS unions and the SQL CHECK lists never drift ─────────────

describe('vocabulary contract with migration 20260722170740', () => {
  const sql = readFileSync(
    join(__dirname, '../../../supabase/migrations/20260722170740_call_dispatch_status.sql'),
    'utf8',
  );

  function checkListFor(column: 'status' | 'reason'): string[] {
    // Grab the CHECK (...) that governs the column and pull its quoted values.
    // reason's check is `reason is null or reason in (...)`; status's is
    // `status in (...)`.
    const re =
      column === 'status'
        ? /status in\s*\(([^)]+)\)/
        : /reason in\s*\(([\s\S]+?)\)\)/;
    const m = sql.match(re);
    expect(m, `CHECK for ${column} not found in migration`).toBeTruthy();
    return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }

  it('status CHECK ≡ DISPATCH_STATUS_VALUES', () => {
    expect(new Set(checkListFor('status'))).toEqual(new Set(DISPATCH_STATUS_VALUES));
  });

  it('reason CHECK ≡ DISPATCH_REASON_VALUES — extending either alone fails here', () => {
    expect(new Set(checkListFor('reason'))).toEqual(new Set(DISPATCH_REASON_VALUES));
  });

  // Staff-model privilege boundary, textually pinned (same class of guard as
  // console-view-grants.test.ts — invisible to tsc and behavioral tests):
  // RLS on, exactly the console-agent SELECT policy, revoke-first grants, and
  // Realtime membership. `npm run verify:db` / pg_catalog readbacks check the
  // live side; this pins what the corpus SAYS.
  it('table privileges: RLS + is_console_agent SELECT + revoke-first + Realtime', () => {
    expect(sql).toMatch(/alter table public\.call_dispatch_status enable row level security/);
    expect(sql).toMatch(/for select to authenticated using \(public\.is_console_agent\(\)\)/);
    // No write policies of any kind — writers are service-role only.
    expect(sql).not.toMatch(/for (insert|update|delete)/);
    expect(sql).toMatch(/revoke all on public\.call_dispatch_status from authenticated/);
    expect(sql).toMatch(/revoke all on public\.call_dispatch_status from anon/);
    expect(sql).toMatch(/grant select on public\.call_dispatch_status to authenticated/);
    expect(sql).toMatch(
      /alter publication supabase_realtime add table public\.call_dispatch_status/,
    );
    // The table never carries billing/PII payloads. Checked against the SQL
    // with comment lines stripped — the header COMMENT deliberately documents
    // that these are excluded, which is exactly the word the code must not use.
    const code = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(code).not.toContain('locked_price');
    expect(code).not.toMatch(/phone/i);
  });
});
