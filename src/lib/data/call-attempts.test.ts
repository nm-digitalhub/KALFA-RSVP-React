import { beforeEach, describe, expect, it, vi } from 'vitest';

// call-attempts.ts begins with `import 'server-only'` — stub it (convention:
// call-result-processing.test.ts).
vi.mock('server-only', () => ({}));

// A minimal admin client for recordCallbackRequest: the attempt lookup
// (from('call_attempts').select().eq().maybeSingle()), the stamp
// (from('call_attempts').update().eq() — awaited) and the log insert
// (from('activity_log').insert()). `writes` records the order of the two writes.
type DbError = { message: string; code?: string } | null;
const db = {
  attempt: { id: 'att1', event_id: 'ev1' } as { id: string; event_id: string } | null,
  stampError: null as DbError,
  logError: null as DbError,
  writes: [] as string[],
  stamped: null as Record<string, unknown> | null,
  logged: null as Record<string, unknown> | null,
  eqs: [] as unknown[][],
  existingLog: [] as { id: string }[] | null,
  lookupError: null as DbError,
};
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        // attempt lookup: select().eq().maybeSingle(); audit-row lookup:
        // select().eq().eq().eq().limit() — one chainable object serves both.
        eq: (...a: unknown[]) => {
          db.eqs.push(a);
          const chain = {
            maybeSingle: async () => ({ data: db.attempt, error: null }),
            eq: (...b: unknown[]) => {
              db.eqs.push(b);
              return chain;
            },
            limit: async () => ({ data: db.existingLog, error: db.lookupError }),
          };
          return chain;
        },
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          db.writes.push(`update:${table}`);
          db.stamped = patch;
          return { error: db.stampError };
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        db.writes.push(`insert:${table}`);
        db.logged = row;
        return { error: db.logError };
      },
    }),
  }),
}));

import { TERMINAL_STATUSES, recordCallbackRequest } from './call-attempts';
import { callbackRequestHash } from '@/lib/voximplant/agent-tool-hash';

beforeEach(() => {
  db.attempt = { id: 'att1', event_id: 'ev1' };
  db.stampError = null;
  db.logError = null;
  db.writes = [];
  db.stamped = null;
  db.logged = null;
  db.eqs = [];
  db.existingLog = [];
  db.lookupError = null;
});

// 'handed_off' (a KALFA console agent took over the call) must be
// terminal — otherwise recordCallOutcome's compare-and-set guard (the CAS
// that stops a stale/out-of-order callback from downgrading a row that
// already reached a terminal state) would NOT protect a handed-off row, and
// a late legitimate-looking callback could downgrade it. Every consumer of
// this set (the /api/calls/{id}/{end,monitor,agent-command} 409 guards,
// vox-log-export.ts's eligibility filter) is documented at the declaration
// site in call-attempts.ts.
describe('TERMINAL_STATUSES', () => {
  it('includes handed_off (Stage 6 AI→human handoff billing)', () => {
    expect(TERMINAL_STATUSES).toContain('handed_off');
  });

  it('still includes every pre-existing terminal status (no accidental removal)', () => {
    expect(TERMINAL_STATUSES).toEqual(
      expect.arrayContaining(['completed', 'failed', 'no_answer', 'no_response', 'cancelled']),
    );
  });
});

// schedule_callback's write. The scenario tells the guest "נחזור אליך" on a 200, so
// this function must never report success for a write that did not land — it used
// to ignore Supabase's `{error}` result and say applied:true regardless.
describe('recordCallbackRequest', () => {
  it('stamps the attempt, then logs the request; applied:true', async () => {
    const r = await recordCallbackRequest('att1', 'מחר בערב', '2026-10-17T17:00:00Z');
    expect(r).toEqual({ applied: true });
    expect(db.writes).toEqual(['update:call_attempts', 'insert:activity_log']);
    expect(db.stamped).toMatchObject({
      callback_when_text: 'מחר בערב',
      callback_iso: '2026-10-17T17:00:00Z',
    });
    expect(db.logged).toMatchObject({
      event_id: 'ev1',
      action: 'call.callback_requested',
      meta: { call_attempt_id: 'att1', when_text: 'מחר בערב' },
    });
  });

  it('an unparseable ISO is stored as null (the guest\'s words are still recorded)', async () => {
    await recordCallbackRequest('att1', 'אחרי החג', 'not-a-date');
    expect(db.stamped).toMatchObject({ callback_when_text: 'אחרי החג', callback_iso: null });
  });

  it('no such attempt → applied:false and NOTHING is written', async () => {
    db.attempt = null;
    expect(await recordCallbackRequest('att1', 'x', null)).toEqual({ applied: false });
    expect(db.writes).toEqual([]);
  });

  it('the stamp FAILS → throws (never applied:true) and no log row is written', async () => {
    db.stampError = { message: 'guest said מחר', code: '57014' };
    const err = await recordCallbackRequest('att1', 'מחר', null).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    // The provider message can echo the guest's words — only the code surfaces.
    expect((err as Error).message).toBe('callback request stamp failed (57014)');
    expect(db.writes).toEqual(['update:call_attempts']);
  });

  it('the log insert FAILS → throws (never applied:true)', async () => {
    db.logError = { message: 'x', code: '23503' };
    await expect(recordCallbackRequest('att1', 'x', null)).rejects.toThrow(
      'callback request log failed (23503)',
    );
  });

  it('stamps the request hash and looks the audit row up by attempt + hash before writing', async () => {
    await recordCallbackRequest('att1', 'מחר בערב', '2026-10-17T17:00:00Z');
    const hash = callbackRequestHash({ whenText: 'מחר בערב', iso: '2026-10-17T17:00:00Z' });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(db.eqs).toEqual(
      expect.arrayContaining([
        ['action', 'call.callback_requested'],
        ['meta->>call_attempt_id', 'att1'],
        ['meta->>request_hash', hash],
      ]),
    );
    expect(db.logged).toMatchObject({ meta: { request_hash: hash } });
  });

  it('the same request twice → the stamp is repeated (idempotent) but ONE audit row', async () => {
    await recordCallbackRequest('att1', 'מחר בערב', '2026-10-17T17:00:00Z');
    expect(db.writes.filter((w) => w === 'insert:activity_log')).toHaveLength(1);
    db.existingLog = [{ id: 'row1' }]; // the first audit row is now visible to the lookup
    expect(await recordCallbackRequest('att1', 'מחר בערב', '2026-10-17T17:00:00Z')).toEqual({
      applied: true,
    });
    expect(db.writes.filter((w) => w === 'insert:activity_log')).toHaveLength(1);
    expect(db.writes.filter((w) => w === 'update:call_attempts')).toHaveLength(2);
  });

  it('different words in the same call → a second audit row (the hash is per request)', () => {
    expect(callbackRequestHash({ whenText: 'מחר', iso: null })).not.toBe(
      callbackRequestHash({ whenText: 'מחרתיים', iso: null }),
    );
  });

  it('the lookup FAILS → throws and writes no audit row (never guesses the request is new)', async () => {
    db.lookupError = { message: 'x', code: '57P01' };
    db.existingLog = null;
    await expect(recordCallbackRequest('att1', 'x', null)).rejects.toThrow(
      'callback request lookup failed (57P01)',
    );
    expect(db.writes).not.toContain('insert:activity_log');
  });
});
