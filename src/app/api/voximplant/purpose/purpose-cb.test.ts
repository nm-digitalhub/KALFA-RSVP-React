import { beforeEach, describe, expect, it, vi } from 'vitest';

// The registry-driven voice surface's terminal report.
//
// ⚠️ WHY THIS ROUTE IS WORTH ITS OWN TEST. It is the FIRST way a voice-purpose
// call can report an outcome at all — `purpose/<key>/` shipped with `ctx` and no
// `cb`, so `finish_reason` was only ever written by the dispatcher's own error
// paths and a row stayed at 'confirmed' forever. Everything downstream (a
// workflow step waiting on a call, any report of what purpose calls achieved)
// reads what this route writes.
//
// Same mocking convention as voximplant-routes.test.ts: agent-tool-guard begins
// with `import 'server-only'`, and the token→row lookup is mocked directly.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/data/voice-purpose-attempts', () => ({
  getVoicePurposeAttemptByAccessToken: vi.fn(),
  recordVoicePurposeConcluded: vi.fn(async () => ({ applied: true })),
  setVoicePurposeElConversationId: vi.fn(async () => {}),
}));

vi.mock('@/lib/workflow/wake', () => ({
  wakeParkedRun: vi.fn(async () => ({ woke: true, delivered: true })),
}));

import { POST } from './[purpose]/cb/[token]/route';
import {
  getVoicePurposeAttemptByAccessToken,
  recordVoicePurposeConcluded,
  setVoicePurposeElConversationId,
} from '@/lib/data/voice-purpose-attempts';
import { wakeParkedRun } from '@/lib/workflow/wake';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

const AID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOK = '0123456789abcdef0123456789abcdef';
const FUTURE = () => new Date(Date.now() + 3600_000).toISOString();
const PAST = () => new Date(Date.now() - 1000).toISOString();

const OK_BODY = JSON.stringify({ call_status: 'completed', call_duration: 42 });

function call(body: string, token = TOK, ip = '7.7.7.7') {
  const req = new Request(
    `https://beta.kalfa.me/api/voximplant/purpose/feedback/cb/${token}`,
    { method: 'POST', headers: { 'x-real-ip': ip, 'content-type': 'application/json' }, body },
  );
  return POST(req, { params: Promise.resolve({ purpose: 'feedback', token }) });
}

const liveAttempt = (run: string | null = null, node: string | null = null) =>
  vi.mocked(getVoicePurposeAttemptByAccessToken).mockResolvedValue({
    id: AID,
    token_expires_at: FUTURE(),
    run_id: run,
    node_id: node,
  });

const RUN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitStateForTests();
});

describe('POST /api/voximplant/purpose/{purpose}/cb/{token}', () => {
  it('records the terminal outcome and answers 200', async () => {
    liveAttempt();
    const res = await call(OK_BODY);
    expect(res.status).toBe(200);
    expect(recordVoicePurposeConcluded).toHaveBeenCalledWith(AID, 'completed', 42);
  });

  it('prefers error_reason over call_status — the specific reason is the useful one', async () => {
    liveAttempt();
    await call(JSON.stringify({ call_status: 'failed', error_reason: 'sip_486_busy' }));
    expect(recordVoicePurposeConcluded).toHaveBeenCalledWith(AID, 'sip_486_busy', null);
  });

  it('⚠️ an unknown token is 404 — never a hint that it does not exist', async () => {
    vi.mocked(getVoicePurposeAttemptByAccessToken).mockResolvedValue(null);
    expect((await call(OK_BODY)).status).toBe(404);
    expect(recordVoicePurposeConcluded).not.toHaveBeenCalled();
  });

  it('⚠️ an expired token is refused — the row is past its call', async () => {
    vi.mocked(getVoicePurposeAttemptByAccessToken).mockResolvedValue({
      id: AID,
      token_expires_at: PAST(),
      run_id: null,
      node_id: null,
    });
    expect((await call(OK_BODY)).status).toBe(404);
    expect(recordVoicePurposeConcluded).not.toHaveBeenCalled();
  });

  it('rejects a body outside the contract rather than storing a guess', async () => {
    liveAttempt();
    // strictObject: an unexpected field is contract drift worth a 400.
    expect((await call(JSON.stringify({ call_status: 'completed', surprise: 1 }))).status).toBe(400);
    expect((await call(JSON.stringify({ call_status: 'invented' }))).status).toBe(400);
    expect((await call('not json')).status).toBe(400);
    expect(recordVoicePurposeConcluded).not.toHaveBeenCalled();
  });

  it('⚠️ still answers 200 when the row had already concluded — a retry must stop retrying', async () => {
    liveAttempt();
    vi.mocked(recordVoicePurposeConcluded).mockResolvedValue({ applied: false });
    expect((await call(OK_BODY)).status).toBe(200);
  });

  it('records the conversation id when present, and survives its failure', async () => {
    liveAttempt();
    await call(JSON.stringify({ call_status: 'completed', el_conversation_id: 'conv_1' }));
    expect(setVoicePurposeElConversationId).toHaveBeenCalledWith(AID, 'conv_1');

    // Best-effort: the terminal status is already written, so a diagnostic
    // write failing must not turn a recorded outcome into a 500.
    vi.mocked(setVoicePurposeElConversationId).mockRejectedValue(new Error('db down'));
    const res = await call(JSON.stringify({ call_status: 'completed', el_conversation_id: 'conv_2' }));
    expect(res.status).toBe(200);
  });

  it('a failure to record the outcome IS a 500 — the scenario should retry', async () => {
    liveAttempt();
    vi.mocked(recordVoicePurposeConcluded).mockRejectedValue(new Error('db down'));
    expect((await call(OK_BODY)).status).toBe(500);
  });
});

// Waking the workflow run this call belongs to (0ב-6).
//
// ⚠️ THIS IS THE ONLY THING THAT ENDS THE WAIT EARLY. A run parked on a voice
// step holds `resume_at` as a TIMEOUT CEILING — the token's own expiry — and
// nothing else brings it back before then. Without this block a graph that waits
// for a call gets the answer when the token dies, not when the guest hangs up.
describe('POST cb — waking the parked run', () => {
  beforeEach(() => {
    // `vi.clearAllMocks()` in the outer hook resets CALLS, not implementations,
    // and the describe above leaves `recordVoicePurposeConcluded` rejecting. Both
    // are restored here so each case below starts from a callback that succeeds.
    vi.mocked(recordVoicePurposeConcluded).mockResolvedValue({ applied: true });
    vi.mocked(wakeParkedRun).mockResolvedValue({ woke: true, delivered: true });
  });

  it('wakes the run named on the attempt, keyed on the attempt itself', async () => {
    liveAttempt(RUN, 'node-1');
    await call(OK_BODY);
    // The correlation is the attempt id — the same value the step parked on and
    // the same one `workflow_runs.resume_correlation_id` holds. Anything else
    // and the wake's gate matches nothing.
    expect(wakeParkedRun).toHaveBeenCalledWith({
      runId: RUN,
      nodeId: 'node-1',
      correlationId: AID,
    });
  });

  it('does not wake anything for a call no workflow started', async () => {
    liveAttempt();
    await call(OK_BODY);
    expect(wakeParkedRun).not.toHaveBeenCalled();
  });

  it('⚠️ still wakes when the status write did NOT apply', async () => {
    // The case this exists for: a retried callback whose FIRST delivery recorded
    // the outcome and then died before waking. The row is already terminal, so
    // `applied` is false — and the run is still parked on a call that finished.
    // Skipping the wake here would leave it asleep until its ceiling.
    liveAttempt(RUN, 'node-1');
    vi.mocked(recordVoicePurposeConcluded).mockResolvedValue({ applied: false });
    expect((await call(OK_BODY)).status).toBe(200);
    expect(wakeParkedRun).toHaveBeenCalled();
  });

  it('⚠️ a failed wake never turns a recorded outcome into a 500', async () => {
    // The outcome is already written. A wake that fails costs the run its early
    // delivery, not its result — the ceiling and the recovery sweep still bring
    // it back — so the scenario must be told 200 and stop retrying.
    liveAttempt(RUN, 'node-1');
    vi.mocked(wakeParkedRun).mockRejectedValue(new Error('db down'));
    expect((await call(OK_BODY)).status).toBe(200);
  });

  it('⚠️ never wakes before the outcome is recorded', async () => {
    // Order is the whole contract: the wake makes the step readable, and a run
    // delivered before the row says 'concluded' would read the call as still
    // running and park again — this time with nothing left to wake it.
    liveAttempt(RUN, 'node-1');
    vi.mocked(recordVoicePurposeConcluded).mockRejectedValue(new Error('db down'));
    expect((await call(OK_BODY)).status).toBe(500);
    expect(wakeParkedRun).not.toHaveBeenCalled();
  });
});
