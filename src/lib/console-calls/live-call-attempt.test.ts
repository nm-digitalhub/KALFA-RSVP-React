import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/call-attempts', () => ({
  getCallAttemptById: vi.fn(),
  TERMINAL_STATUSES: ['completed', 'failed', 'no_answer', 'no_response', 'cancelled'],
}));

import { loadLiveCallAttempt } from './live-call-attempt';
import { getCallAttemptById } from '@/lib/data/call-attempts';

const ID = '6f1c2f0e-8a34-4a1d-9c56-0d2f6f6f3a11';
const SECURE = 'https://media.example.com/session/secure-token';
const PLAIN = 'http://203.0.113.7/session/plain-token';

function attempt(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: 'in_progress',
    media_session_access_secure_url: SECURE,
    media_session_access_url: PLAIN,
    ...over,
  };
}

async function failure(over: Record<string, unknown>) {
  vi.mocked(getCallAttemptById).mockResolvedValue(attempt(over) as never);
  const live = await loadLiveCallAttempt(ID);
  if (live.ok) throw new Error('expected a refusal');
  return { status: live.response.status, body: await live.response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadLiveCallAttempt', () => {
  it('returns the attempt with the HTTPS handle when it is live', async () => {
    vi.mocked(getCallAttemptById).mockResolvedValue(attempt() as never);
    const live = await loadLiveCallAttempt(ID);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(live.attempt.id).toBe(ID);
    expect(live.sessionUrl.href).toBe(SECURE);
  });

  it('falls back to the plain handle when the secure one is absent', async () => {
    vi.mocked(getCallAttemptById).mockResolvedValue(
      attempt({ media_session_access_secure_url: null }) as never,
    );
    const live = await loadLiveCallAttempt(ID);
    expect(live.ok && live.sessionUrl.href).toBe(PLAIN);
  });

  it('answers 500 when the read throws', async () => {
    vi.mocked(getCallAttemptById).mockRejectedValue(new Error('db down'));
    const live = await loadLiveCallAttempt(ID);
    expect(live.ok).toBe(false);
    if (live.ok) return;
    expect(live.response.status).toBe(500);
    expect(await live.response.json()).toEqual({ error: 'טעינת השיחה נכשלה' });
  });

  it('answers 404 when there is no such attempt', async () => {
    vi.mocked(getCallAttemptById).mockResolvedValue(null as never);
    const live = await loadLiveCallAttempt(ID);
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.response.status).toBe(404);
  });

  it('answers 409 for a terminal attempt and for one with no usable handle', async () => {
    expect(await failure({ status: 'completed' })).toEqual({
      status: 409,
      body: { error: 'השיחה אינה פעילה' },
    });
    expect(
      await failure({ media_session_access_secure_url: null, media_session_access_url: null }),
    ).toEqual({ status: 409, body: { error: 'השיחה אינה פעילה' } });
  });
});
