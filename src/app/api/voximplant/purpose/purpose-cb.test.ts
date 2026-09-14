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
    // No error, so no reason — the house shape. `null`, not a second copy of the
    // verdict: repeating it would make `finish_reason like …` answer a question
    // about status.
    expect(recordVoicePurposeConcluded).toHaveBeenCalledWith(AID, null, 42, 'completed');
  });

  it('⚠️ the reason column carries the ERROR ALONE, and the verdict its own column', async () => {
    // The first half is unchanged and still right: `finish_reason` should carry
    // the specific string, because 'sip_486_busy' tells a debugger something
    // 'failed' does not.
    //
    // ⚠️ THE SECOND HALF IS THE FIX, AND THIS TEST DID NOT COVER IT. Passing
    // only the collapsed `error_reason ?? call_status` meant the normalized
    // verdict was DISCARDED whenever both arrived — which is every failure path
    // the scenarios have. `toBusinessOutcome` then read a concluded attempt with
    // an unmapped reason and fell to its `default: 'completed'`, so a call that
    // failed before reaching anyone was reported to the diagram as a success.
    //
    // Nothing about the old assertion was wrong; it was incomplete, and what it
    // did not assert was the part that was broken.
    liveAttempt();
    await call(JSON.stringify({ call_status: 'failed', error_reason: 'sip_486_busy' }));
    expect(recordVoicePurposeConcluded).toHaveBeenCalledWith(AID, 'sip_486_busy', null, 'failed');
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

  // A wake that THROWS is now a 500 — see the P0 block at the end of this file.
  // This case used to assert the opposite, on the reasoning that the outcome was
  // already recorded so the ceiling would cover it. The 0ב review showed why
  // that is wrong: swallowing the throw retires the callback retry, which is the
  // only thing that would have woken the run at all.

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

// The two P0s the 0ב review found.
describe('POST cb — the review\'s P0 fixes', () => {
  beforeEach(() => {
    vi.mocked(recordVoicePurposeConcluded).mockResolvedValue({ applied: true });
    vi.mocked(wakeParkedRun).mockResolvedValue({ woke: true, delivered: true });
  });

  it('⚠️ a wake that THROWS is a 500, so the scenario retries', async () => {
    // It used to be swallowed into a 200. `woke: false` is an ANSWER — the run
    // is not waiting on this event — and stays 200. A throw is a failure to find
    // out, and answering 200 to that leaves the run asleep with no second
    // delivery coming, which is precisely the case the callback retry exists for.
    liveAttempt(RUN, 'node-1');
    vi.mocked(wakeParkedRun).mockRejectedValue(new Error('pooler timeout'));
    expect((await call(OK_BODY)).status).toBe(500);
  });

  it('a wake that answers "nothing to wake" is still a 200', async () => {
    liveAttempt(RUN, 'node-1');
    vi.mocked(wakeParkedRun).mockResolvedValue({ woke: false, delivered: false });
    expect((await call(OK_BODY)).status).toBe(200);
  });
});
