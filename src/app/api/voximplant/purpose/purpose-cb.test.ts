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

import { POST } from './[purpose]/cb/[token]/route';
import {
  getVoicePurposeAttemptByAccessToken,
  recordVoicePurposeConcluded,
  setVoicePurposeElConversationId,
} from '@/lib/data/voice-purpose-attempts';
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

const liveAttempt = () =>
  vi.mocked(getVoicePurposeAttemptByAccessToken).mockResolvedValue({
    id: AID,
    token_expires_at: FUTURE(),
    run_id: null,
    node_id: null,
  });

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
