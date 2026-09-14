import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// storeCallAnalysis begins with `import 'server-only'` (stub it) and writes via
// the service-role client. The admin client is mocked with a table-branching
// stub: 'call_attempts' resolves the correlation-token lookup; 'call_analysis'
// captures the upsert row so we can assert what is (and isn't) persisted.
vi.mock('server-only', () => ({}));
// `otherAttemptMock` covers the four NON-call_attempts tables the resolver also
// walks. Before 2026-09-15 only `call_attempts` was ever reached from here, so
// one mock was enough; now the sales/meeting/purpose path resolves too, and a
// table with no stub would throw inside the resolver and be swallowed as an
// orphan — hiding the very behaviour these tests check.
const { attemptMock, otherAttemptMock, guestMock, upsertMock } = vi.hoisted(() => ({
  attemptMock: vi.fn(),
  otherAttemptMock: vi.fn(),
  guestMock: vi.fn(),
  upsertMock: vi.fn(),
}));
const ATTEMPT_TABLES_UNDER_TEST = [
  'callback_request_attempts',
  'sales_call_attempts',
  'inbound_agent_attempts',
  'voice_purpose_attempts',
];
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === 'call_attempts'
        ? { select: () => ({ eq: () => ({ maybeSingle: attemptMock }) }) }
        : ATTEMPT_TABLES_UNDER_TEST.includes(table)
          ? { select: () => ({ eq: () => ({ maybeSingle: otherAttemptMock }) }) }
          : table === 'guests'
            ? { select: () => ({ eq: () => ({ maybeSingle: guestMock }) }) }
            : { upsert: upsertMock },
  }),
}));

import {
  buildCallAnalysisInsert,
  storeCallAnalysis,
  storeSalesCallAnalysis,
} from './elevenlabs-analysis';
import type { NormalizedCallAnalysis } from '@/lib/validation/elevenlabs-payloads';

const base: NormalizedCallAnalysis = {
  conversationId: 'c1',
  agentId: 'a',
  callSuccessful: 'success',
  status: 'done',
  overallScore: 0.9,
  callDurationSecs: 10,
  costCredits: 5,
  terminationReason: 'x',
  analysisAt: '2026-07-19T00:00:00.000Z',
  correlationToken: null,
  callSuccessScore: 0.8,
  evaluation: { rsvp_captured: 'success' },
  dataCollection: { status: 'attending', adults: 2, children: 0 },
  transcriptSummary: null,
  summaryTitle: null,
  voicemailDetected: null,
  sentimentLabel: null,
  frustrationScore: null,
  costFiat: null,
  agentTurns: 8,
  userTurns: 5,
};

beforeEach(() => {
  attemptMock.mockReset().mockResolvedValue({ data: null, error: null });
  otherAttemptMock.mockReset().mockResolvedValue({ data: null, error: null });
  guestMock.mockReset().mockResolvedValue({ data: null, error: null });
  upsertMock.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.clearAllMocks());

describe('storeCallAnalysis (dual-link + QA persist)', () => {
  it('links via the correlation token and persists the QA columns', async () => {
    attemptMock.mockResolvedValue({ data: { id: 'att-1', event_id: 'evt-1' }, error: null });
    const res = await storeCallAnalysis({ ...base, correlationToken: 'nonce-1' });
    expect(res).toBe('stored');
    const row = upsertMock.mock.calls[0][0];
    expect(row).toMatchObject({ call_attempt_id: 'att-1', event_id: 'evt-1', el_call_score: 0.8 });
    expect(row.el_eval).toEqual({ rsvp_captured: 'success' });
    expect(row.el_data).toEqual({ status: 'attending', adults: 2, children: 0 });
    expect(row.linked_at).toBeTruthy();
    // The engagement counters must reach the row — they are the only stored
    // evidence separating a real conversation from a missed voicemail.
    expect(row).toMatchObject({ agent_turns: 8, user_turns: 5 });
  });

  it('persists a zero user_turns count rather than dropping it (voicemail signature)', async () => {
    // 0 must be written, not treated as falsy-and-skipped: `user_turns = 0` with
    // agent_turns > 0 is exactly the signal the no-engagement index looks for,
    // and NULL would mean "not measured" instead of "nobody spoke".
    attemptMock.mockResolvedValue({ data: { id: 'att-3', event_id: 'evt-3' }, error: null });
    await storeCallAnalysis({ ...base, agentTurns: 4, userTurns: 0 });
    const row = upsertMock.mock.calls[0][0];
    expect(row.user_turns).toBe(0);
    expect(row.agent_turns).toBe(4);
  });

  it('links via the conversation_id when no token is present (second vector)', async () => {
    attemptMock.mockResolvedValue({ data: { id: 'att-2', event_id: 'evt-2' }, error: null });
    const res = await storeCallAnalysis(base); // token null → falls through to conversation_id
    expect(res).toBe('stored');
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ call_attempt_id: 'att-2', event_id: 'evt-2' });
  });

  it('stores an orphan when neither vector matches', async () => {
    const res = await storeCallAnalysis({ ...base, correlationToken: 'unknown' });
    expect(res).toBe('stored');
    const row = upsertMock.mock.calls[0][0];
    expect(row.call_attempt_id).toBeNull();
    expect(row.event_id).toBeNull();
    expect(row.linked_at).toBeNull();
  });

  it('still stores (orphan) when the link lookup throws — never fails on linking', async () => {
    attemptMock.mockRejectedValue(new Error('db blip'));
    const res = await storeCallAnalysis({ ...base, correlationToken: 'nonce-1' });
    expect(res).toBe('stored');
    expect(upsertMock.mock.calls[0][0].call_attempt_id).toBeNull();
  });

  it('returns error when the upsert fails', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'boom' } });
    expect(await storeCallAnalysis(base)).toBe('error');
  });
});

describe('storeSalesCallAnalysis', () => {
  // THE INVARIANT THAT PROTECTS THE STORE. `call_analysis.call_attempt_id` is a
  // FOREIGN KEY to `call_attempts`. Four of the five attempt tables can never
  // fill it, so writing a meeting-confirm or purpose attempt id there would
  // raise a constraint violation and fail the store on exactly the calls the
  // linker was widened to capture. The polymorphic attempt_table/attempt_id
  // pair is what carries them.
  it('links a non-call_attempts match WITHOUT touching the foreign key', async () => {
    attemptMock.mockResolvedValue({ data: null, error: null });
    otherAttemptMock.mockResolvedValue({
      data: { id: 'cra-1', created_at: '2026-09-14T00:00:00.000Z' },
      error: null,
    });
    const res = await storeSalesCallAnalysis({
      ...base,
      conversationId: 'conv_mtg_1',
      correlationToken: null,
    });
    expect(res).toBe('stored');
    const row = upsertMock.mock.calls[0][0];
    expect(row.attempt_id).toBe('cra-1');
    expect(row.attempt_table).toBe('callback_request_attempts');
    expect(row.call_attempt_id).toBeNull();
    expect(row.linked_at).not.toBeNull();
  });

  // A link lookup must never cost us the analysis itself.
  it('still stores as an orphan when the linker throws', async () => {
    attemptMock.mockRejectedValue(new Error('db blip'));
    const res = await storeSalesCallAnalysis({ ...base, conversationId: 'conv_mtg_2' });
    expect(res).toBe('stored');
    const row = upsertMock.mock.calls[0][0];
    expect(row.attempt_id).toBeNull();
    expect(row.call_attempt_id).toBeNull();
  });

  it('stores sales analysis without the RSVP call_attempts linker', async () => {
    const res = await storeSalesCallAnalysis({
      ...base,
      conversationId: 'conv_sales_1',
      evaluation: { pricing_grounded: 'success', no_false_close: 'failure' },
      dataCollection: {
        call_outcome: 'needs_followup',
        event_type: 'חתונה',
        estimated_guest_count: 180,
        whatsapp_consent: true,
        objection_reason: 'יקר לי',
      },
    });
    expect(res).toBe('stored');
    // The linker now RUNS on this path. It used to be skipped, on the reasoning
    // that "sales rows are not call_attempts rows" — true, and beside the point
    // once the resolver learned all five attempt tables. MEASURED 2026-09-15:
    // 22 of 42 call_analysis rows were orphans, six of them after that widening
    // shipped, because every ElevenLabs webhook lands on this path and it
    // passed an empty link.
    expect(attemptMock).toHaveBeenCalled();
    // rsvp_persisted stays out: it compares a guest row against a reported RSVP
    // status, which means nothing for a non-RSVP persona.
    expect(guestMock).not.toHaveBeenCalled();
    const row = upsertMock.mock.calls[0][0];
    expect(row).toMatchObject({
      provider: 'elevenlabs',
      conversation_id: 'conv_sales_1',
      call_attempt_id: null,
      event_id: null,
      linked_at: null,
      rsvp_persisted: null,
      el_eval: { pricing_grounded: 'success', no_false_close: 'failure' },
      el_data: {
        call_outcome: 'needs_followup',
        event_type: 'חתונה',
        estimated_guest_count: 180,
        whatsapp_consent: true,
        objection_reason: 'יקר לי',
      },
    });
    expect(upsertMock).toHaveBeenCalledWith(row, {
      onConflict: 'provider,conversation_id',
      ignoreDuplicates: true,
    });
  });

  it('returns error when the sales analysis upsert fails', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'boom' } });
    expect(await storeSalesCallAnalysis(base)).toBe('error');
  });
});

// ElevenLabs criteria are evaluated against the TRANSCRIPT only (docs:
// agent-analysis/success-evaluation), so rsvp_captured:'success' means the agent
// SOUNDED like it saved. On 2026-07-21 three calls scored 100 with
// el_data {status:'attending'} while guests.updated_at stayed weeks old — the
// recording has the agent saying "לא הצלחתי לעדכן את זה במערכת". rsvp_persisted is
// the measured counterpart.
describe('rsvp_persisted — measured, not inferred', () => {
  const linked = { id: 'att-1', event_id: 'evt-1', guest_id: 'g-1', created_at: '2026-07-21T01:00:00Z' };

  it('false when the agent reported an outcome the guest row never received', async () => {
    attemptMock.mockResolvedValue({ data: linked, error: null });
    // Guest untouched since long before the call — exactly the live case.
    guestMock.mockResolvedValue({ data: { updated_at: '2026-07-07T09:41:48Z' }, error: null });
    await storeCallAnalysis({ ...base, dataCollection: { status: 'attending', adults: 1, children: 0 } });
    expect(upsertMock.mock.calls[0][0].rsvp_persisted).toBe(false);
  });

  it('true when the guest row moved during the call', async () => {
    attemptMock.mockResolvedValue({ data: linked, error: null });
    guestMock.mockResolvedValue({ data: { updated_at: '2026-07-21T01:00:30Z' }, error: null });
    await storeCallAnalysis({ ...base, dataCollection: { status: 'attending', adults: 1, children: 0 } });
    expect(upsertMock.mock.calls[0][0].rsvp_persisted).toBe(true);
  });

  it('null when the conversation reported no outcome — nothing to verify', async () => {
    attemptMock.mockResolvedValue({ data: linked, error: null });
    await storeCallAnalysis({ ...base, dataCollection: null });
    expect(upsertMock.mock.calls[0][0].rsvp_persisted).toBeNull();
  });

  it('null — never false — when the guest read fails, so a working call is not accused', async () => {
    attemptMock.mockResolvedValue({ data: linked, error: null });
    guestMock.mockRejectedValue(new Error('db blip'));
    await storeCallAnalysis({ ...base, dataCollection: { status: 'attending', adults: 1, children: 0 } });
    expect(upsertMock.mock.calls[0][0].rsvp_persisted).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Five attempt tables, one analysis row
// ---------------------------------------------------------------------------
//
// ⚠️ THE STATE THIS ENDED, measured on 2026-09-14. `call_analysis` held 39 rows
// and 20 links, split cleanly by agent:
//
//   KALFA-RSVP              24 rows, 20 linked
//   Meeting-Confirm          7 rows,  0 linked
//   Sales-Close              6 rows,  0 linked
//   RSVP customer service    2 rows,  0 linked
//
// Three agents had never linked a single call, because the lookup read
// `call_attempts` and nothing else while they write to three other tables — all
// of which carry the same `el_conversation_id`.

describe('buildCallAnalysisInsert — the polymorphic link', () => {
  const analysis = {
    conversationId: 'conv-1',
    agentId: 'agent_x',
    callSuccessful: 'success',
    status: 'done',
    overallScore: null,
    callDurationSecs: 30,
    costCredits: null,
    terminationReason: null,
    analysisAt: '2026-09-14T10:00:00.000Z',
  } as unknown as Parameters<typeof buildCallAnalysisInsert>[0];

  it('⚠️ fills call_attempt_id ONLY for call_attempts — it is a foreign key', () => {
    // `call_analysis_call_attempt_id_fkey` REFERENCES call_attempts(id). Writing
    // another table's id there is a constraint violation, so the store would
    // start failing on exactly the calls the wider lookup was added to capture.
    const rsvp = buildCallAnalysisInsert(analysis, {
      callAttemptId: 'att-1',
      attemptTable: 'call_attempts',
      attemptId: 'att-1',
    });
    expect(rsvp.call_attempt_id).toBe('att-1');
    expect(rsvp.attempt_table).toBe('call_attempts');

    const sales = buildCallAnalysisInsert(analysis, {
      attemptTable: 'sales_call_attempts',
      attemptId: 'sales-9',
    });
    expect(sales.call_attempt_id).toBeNull();
    expect(sales.attempt_table).toBe('sales_call_attempts');
    expect(sales.attempt_id).toBe('sales-9');
  });

  it('⚠️ counts a non-RSVP link as LINKED', () => {
    // `linked_at` used to follow `call_attempt_id`, which four of the five
    // tables can never fill — so every Meeting-Confirm and Sales-Close call
    // would have read as an orphan for ever.
    for (const table of [
      'callback_request_attempts',
      'sales_call_attempts',
      'inbound_agent_attempts',
      'voice_purpose_attempts',
    ] as const) {
      const row = buildCallAnalysisInsert(analysis, { attemptTable: table, attemptId: 'x-1' });
      expect(row.linked_at, table).toBeTruthy();
    }
  });

  it('a genuine orphan stays unlinked', () => {
    const row = buildCallAnalysisInsert(analysis, {});
    expect(row.attempt_id).toBeNull();
    expect(row.attempt_table).toBeNull();
    expect(row.linked_at).toBeNull();
  });

  it('an older caller passing only callAttemptId still names its table', () => {
    // The pair must be complete or absent — the DB enforces it with
    // `call_analysis_attempt_pair_complete`, and a half-filled row would be
    // rejected at insert.
    const row = buildCallAnalysisInsert(analysis, { callAttemptId: 'att-7' });
    expect(row.attempt_table).toBe('call_attempts');
    expect(row.attempt_id).toBe('att-7');
    expect(row.linked_at).toBeTruthy();
  });
});

describe('the attempt-table list', () => {
  it('⚠️ still names all FIVE — one agent per table, and one that was forgotten', () => {
    // Each entry is an agent that would otherwise never link a call. The list
    // read `call_attempts` alone until 2026-09-14, and three of four agents had
    // 0 links between them for two months.
    //
    // Asserted as source text because the list is a module-scope const the
    // exported surface does not expose — and the failure it prevents is
    // invisible: dropping a line here does not break a test, it just stops
    // linking one agent's calls, silently, for ever.
    const src = readFileSync(
      join(process.cwd(), 'src/lib/data/elevenlabs-analysis.ts'),
      'utf8',
    );
    for (const table of [
      'call_attempts', // KALFA-RSVP
      'callback_request_attempts', // Meeting-Confirm
      'sales_call_attempts', // Sales-Close
      'inbound_agent_attempts', // RSVP customer service
      'voice_purpose_attempts', // any purpose added from the admin panel
    ]) {
      expect(src, table).toContain(`table: '${table}'`);
    }
  });

  it('⚠️ tries the correlation nonce only where the column exists', () => {
    // `el_correlation_nonce` lives on `call_attempts` alone. Querying it on the
    // others is a 42703 that would throw inside the lookup — caught, yes, but it
    // would abandon the search and orphan the row.
    const src = readFileSync(
      join(process.cwd(), 'src/lib/data/elevenlabs-analysis.ts'),
      'utf8',
    );
    expect(src).toMatch(/table: 'call_attempts', hasNonce: true/);
    for (const table of [
      'callback_request_attempts',
      'sales_call_attempts',
      'inbound_agent_attempts',
      'voice_purpose_attempts',
    ]) {
      expect(src, table).toMatch(new RegExp(`table: '${table}', hasNonce: false`));
    }
  });
});
