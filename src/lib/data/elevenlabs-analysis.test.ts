import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// storeCallAnalysis begins with `import 'server-only'` (stub it) and writes via
// the service-role client. The admin client is mocked with a table-branching
// stub: 'call_attempts' resolves the correlation-token lookup; 'call_analysis'
// captures the upsert row so we can assert what is (and isn't) persisted.
vi.mock('server-only', () => ({}));
const { attemptMock, guestMock, upsertMock } = vi.hoisted(() => ({
  attemptMock: vi.fn(),
  guestMock: vi.fn(),
  upsertMock: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === 'call_attempts'
        ? { select: () => ({ eq: () => ({ maybeSingle: attemptMock }) }) }
        : table === 'guests'
          ? { select: () => ({ eq: () => ({ maybeSingle: guestMock }) }) }
          : { upsert: upsertMock },
  }),
}));

import { storeCallAnalysis } from './elevenlabs-analysis';
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
  agentTurns: 8,
  userTurns: 5,
};

beforeEach(() => {
  attemptMock.mockReset().mockResolvedValue({ data: null, error: null });
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
