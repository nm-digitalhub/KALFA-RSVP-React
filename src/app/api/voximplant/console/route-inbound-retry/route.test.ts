import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/console-calls', () => ({
  consoleWakeEnabled: vi.fn(),
  findRoutableAgentVoxUsernames: vi.fn(),
  findOnShiftAgentVoxUsernames: vi.fn(),
  recordConsoleWakeRetryAudit: vi.fn(),
}));

import { POST } from './route';
import {
  consoleWakeEnabled,
  findOnShiftAgentVoxUsernames,
  findRoutableAgentVoxUsernames,
} from '@/lib/data/console-calls';

const SECRET = 'test-console-secret';
const CALL_ID = '11111111-1111-4111-8111-111111111111';

function req(body: unknown): Request {
  return new Request('https://beta.kalfa.me/api/voximplant/console/route-inbound-retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function retryBody(alreadyTried: string[] = []) {
  return { secret: SECRET, call_id: CALL_ID, already_tried: alreadyTried };
}

async function ringOrderOf(res: Response): Promise<string[]> {
  return ((await res.json()) as { ring_order: string[] }).ring_order;
}

// The retry wave is the ONLY place a sleeping agent can be rung, and ringing
// them is what makes Voximplant push their device (the platform pushes on
// callUser; callUser only happens for names in a ring order). Before 14.8 this
// route re-checked heartbeat freshness only, which meant a sleeper could never
// be woken by the platform — no heartbeat ⇒ not in any ring ⇒ no callUser ⇒ no
// push. These tests pin the loop-breaking behaviour and its ordering.
describe('POST /api/voximplant/console/route-inbound-retry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.KALFA_CONSOLE_SECRET = SECRET;
    vi.mocked(consoleWakeEnabled).mockResolvedValue(true);
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue([]);
    vi.mocked(findOnShiftAgentVoxUsernames).mockResolvedValue([]);
  });

  it('includes on-shift agents who are NOT heartbeat-fresh (the wake path)', async () => {
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue([]);
    vi.mocked(findOnShiftAgentVoxUsernames).mockResolvedValue(['agent_sleeper']);

    expect(await ringOrderOf(await POST(req(retryBody())))).toEqual(['agent_sleeper']);
  });

  it('rings freshly-connected agents BEFORE sleepers', async () => {
    // Ordering is the design, not an accident: an awake agent answers
    // immediately, a sleeper costs a cold start. A caller must never wait on a
    // wake-up while someone already connected could have taken the call.
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue(['agent_awake']);
    vi.mocked(findOnShiftAgentVoxUsernames).mockResolvedValue(['agent_sleeper']);

    expect(await ringOrderOf(await POST(req(retryBody())))).toEqual(['agent_awake', 'agent_sleeper']);
  });

  it('never rings the same agent twice when they are in both audiences', async () => {
    // An agent can legitimately be on shift AND freshly connected. Ringing
    // them twice in one wave burns a second ring window on someone who just
    // declined or timed out.
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue(['agent_both']);
    vi.mocked(findOnShiftAgentVoxUsernames).mockResolvedValue(['agent_both']);

    expect(await ringOrderOf(await POST(req(retryBody())))).toEqual(['agent_both']);
  });

  it('excludes everyone the primary ring already tried, from BOTH audiences', async () => {
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue(['agent_tried', 'agent_new']);
    vi.mocked(findOnShiftAgentVoxUsernames).mockResolvedValue(['agent_tried', 'agent_sleeper']);

    expect(await ringOrderOf(await POST(req(retryBody(['agent_tried']))))).toEqual([
      'agent_new',
      'agent_sleeper',
    ]);
  });

  it('returns empty when the wake capability is off — sleepers included', async () => {
    // consoleWakeEnabled is the kill switch for this whole path; adding a
    // second audience must not create a way around it.
    vi.mocked(consoleWakeEnabled).mockResolvedValue(false);
    vi.mocked(findOnShiftAgentVoxUsernames).mockResolvedValue(['agent_sleeper']);

    expect(await ringOrderOf(await POST(req(retryBody())))).toEqual([]);
    expect(findOnShiftAgentVoxUsernames).not.toHaveBeenCalled();
  });

  it('fails toward "nobody new" if either lookup throws', async () => {
    // The scenario has no reply channel to branch on — an error must degrade
    // to an empty ring (falling through to the honest no-agent line), never a
    // non-200 it would have to special-case.
    vi.mocked(findOnShiftAgentVoxUsernames).mockRejectedValue(new Error('db down'));

    const res = await POST(req(retryBody()));
    expect(res.status).toBe(200);
    expect(await ringOrderOf(res)).toEqual([]);
  });

  it('rejects a bad secret without consulting either audience', async () => {
    const res = await POST(req({ ...retryBody(), secret: 'wrong' }));
    expect(res.status).toBe(401);
    expect(findRoutableAgentVoxUsernames).not.toHaveBeenCalled();
    expect(findOnShiftAgentVoxUsernames).not.toHaveBeenCalled();
  });
});
