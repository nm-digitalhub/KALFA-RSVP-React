import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/console-calls', () => ({
  findConsoleCallForEvent: vi.fn(),
  mapEndedReasonToStatus: vi.fn(() => 'ended'),
  recordConsoleCallSessionAccess: vi.fn(),
  resolveAgentIdByVoxUsername: vi.fn(),
  updateConsoleCallStatus: vi.fn(),
}));

import { POST } from './route';
import {
  findConsoleCallForEvent,
  recordConsoleCallSessionAccess,
  resolveAgentIdByVoxUsername,
  updateConsoleCallStatus,
} from '@/lib/data/console-calls';

const SECRET = 'test-console-secret';
const CALL_ID = 'call-1';
const CONSOLE_CALL_UUID = '44444444-4444-4444-8444-444444444444'; // request-body call_id must be a real UUID (Zod)

function req(body: unknown): Request {
  return new Request('https://beta.kalfa.me/api/voximplant/console/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/voximplant/console/event', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.KALFA_CONSOLE_SECRET = SECRET;
    vi.mocked(findConsoleCallForEvent).mockResolvedValue(CALL_ID);
  });

  it('started: persists the session access URLs when the scenario sends them (stage 7)', async () => {
    const res = await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'outbound',
        token: 'ct' + 'a'.repeat(64),
        event: 'started',
        access_url: 'http://media.example/request/1',
        access_secure_url: 'https://media.example/request/1',
      }),
    );
    expect(res.status).toBe(202);
    expect(recordConsoleCallSessionAccess).toHaveBeenCalledWith({
      callId: CALL_ID,
      accessUrl: 'http://media.example/request/1',
      accessSecureUrl: 'https://media.example/request/1',
    });
  });

  it('started: does not write session access when the scenario sends neither URL', async () => {
    await POST(
      req({ secret: SECRET, session_id: 1, call_kind: 'outbound', event: 'started' }),
    );
    expect(recordConsoleCallSessionAccess).not.toHaveBeenCalled();
  });

  it('connected (inbound): resolves the winning agent and writes agent_id', async () => {
    vi.mocked(resolveAgentIdByVoxUsername).mockResolvedValue('agent-uuid-1');
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'inbound',
        called: '97237219347',
        event: 'connected',
        agent: 'agent_target',
      }),
    );
    expect(resolveAgentIdByVoxUsername).toHaveBeenCalledWith('agent_target');
    expect(updateConsoleCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({ callId: CALL_ID, status: 'connected', agentId: 'agent-uuid-1' }),
    );
  });

  it('connected (inbound): an unresolvable vox_username never writes a null agent_id', async () => {
    vi.mocked(resolveAgentIdByVoxUsername).mockResolvedValue(null);
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'inbound',
        called: '97237219347',
        event: 'connected',
        agent: 'agent_missing',
      }),
    );
    const patch = vi.mocked(updateConsoleCallStatus).mock.calls[0][0];
    expect('agentId' in patch).toBe(false);
  });

  it('connected (outbound): never touches agent_id (already set at creation)', async () => {
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'outbound',
        token: 'ct' + 'a'.repeat(64),
        event: 'connected',
      }),
    );
    expect(resolveAgentIdByVoxUsername).not.toHaveBeenCalled();
    const patch = vi.mocked(updateConsoleCallStatus).mock.calls[0][0];
    expect('agentId' in patch).toBe(false);
  });

  it('401 on a bad secret, without touching the DAL', async () => {
    const res = await POST(
      req({ secret: 'wrong', session_id: 1, call_kind: 'outbound', event: 'started' }),
    );
    expect(res.status).toBe(401);
    expect(findConsoleCallForEvent).not.toHaveBeenCalled();
  });

  it('inbound: forwards the scenario-echoed call_id to findConsoleCallForEvent (Tier 0)', async () => {
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'inbound',
        called: '97237219347',
        call_id: CONSOLE_CALL_UUID,
        event: 'ringing',
      }),
    );
    expect(findConsoleCallForEvent).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'inbound', callId: CONSOLE_CALL_UUID }),
    );
  });

  it('outbound: never forwards call_id even if present on the body (inbound-only signal)', async () => {
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'outbound',
        token: 'ct' + 'a'.repeat(64),
        call_id: CONSOLE_CALL_UUID,
        event: 'ringing',
      }),
    );
    expect(findConsoleCallForEvent).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'outbound', callId: undefined }),
    );
  });

  // ── Stage 2 (consult-before-transfer) ──────────────────────────────────

  it('consult_started: resolves the target and writes consult_agent_id', async () => {
    vi.mocked(resolveAgentIdByVoxUsername).mockResolvedValue('consult-agent-uuid');
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'outbound',
        token: 'ct' + 'a'.repeat(64),
        event: 'consult_started',
        request_id: 'r1',
        target: 'agent_target',
      }),
    );
    expect(resolveAgentIdByVoxUsername).toHaveBeenCalledWith('agent_target');
    expect(updateConsoleCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({ callId: CALL_ID, consultAgentId: 'consult-agent-uuid' }),
    );
  });

  it('consult_started: an unresolvable target never writes a null consult_agent_id', async () => {
    vi.mocked(resolveAgentIdByVoxUsername).mockResolvedValue(null);
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'outbound',
        token: 'ct' + 'a'.repeat(64),
        event: 'consult_started',
        request_id: 'r1',
        target: 'agent_missing',
      }),
    );
    expect(updateConsoleCallStatus).not.toHaveBeenCalled();
  });

  // Full telephony audit (13.8): both scenarios have sent consult_connected
  // since consult shipped, but it was missing from consoleEventBodySchema's
  // discriminatedUnion — every report was rejected 400 before the secret
  // check ever ran. Now accepted AND load-bearing: it stamps
  // consult_connected_at, which is the ONLY thing the UI may gate "השלמת
  // העברה" on. consult_agent_id is written earlier and optimistically (at
  // consult_started, while the target is still ringing), so gating the
  // button on it offered a no-op click for up to 20s — the save_rsvp
  // 'queued' false-promise pattern. See migration 20260813064814.
  it('consult_connected: stamps consult_connected_at (the honest "ready to complete" signal)', async () => {
    const res = await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'outbound',
        token: 'ct' + 'a'.repeat(64),
        event: 'consult_connected',
        request_id: 'r1',
      }),
    );
    expect(res.status).toBe(202);
    expect(updateConsoleCallStatus).toHaveBeenCalledWith({
      callId: 'call-1',
      consultConnected: true,
    });
  });

  it.each(['consult_cancelled', 'consult_failed'])(
    '%s: clears consult_agent_id',
    async (event) => {
      await POST(
        req({
          secret: SECRET,
          session_id: 1,
          call_kind: 'outbound',
          token: 'ct' + 'a'.repeat(64),
          event,
          request_id: 'r1',
          ...(event === 'consult_failed' ? { reason: 'timeout' } : {}),
        }),
      );
      expect(updateConsoleCallStatus).toHaveBeenCalledWith(
        expect.objectContaining({ callId: CALL_ID, consultAgentId: null }),
      );
    },
  );

  it('consult_completed: clears consult_agent_id and sets transferred_to_agent_id from its own target', async () => {
    vi.mocked(resolveAgentIdByVoxUsername).mockResolvedValue('consult-agent-uuid');
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'outbound',
        token: 'ct' + 'a'.repeat(64),
        event: 'consult_completed',
        request_id: 'r1',
        target: 'agent_target',
      }),
    );
    expect(resolveAgentIdByVoxUsername).toHaveBeenCalledWith('agent_target');
    expect(updateConsoleCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: CALL_ID,
        consultAgentId: null,
        transferredToAgentId: 'consult-agent-uuid',
      }),
    );
  });

  it('consult_completed: an unresolvable target still clears consult_agent_id but never writes a null transfer', async () => {
    vi.mocked(resolveAgentIdByVoxUsername).mockResolvedValue(null);
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'outbound',
        token: 'ct' + 'a'.repeat(64),
        event: 'consult_completed',
        request_id: 'r1',
        target: 'agent_missing',
      }),
    );
    const patch = vi.mocked(updateConsoleCallStatus).mock.calls[0][0];
    expect(patch).toMatchObject({ callId: CALL_ID, consultAgentId: null });
    expect('transferredToAgentId' in patch).toBe(false);
  });

  // ── Stage 2 (3-way conference) ───────────────────────────────────────────

  // Same schema gap and same fix as consult_connected above.
  it('conference_started: accepted (was a schema-rejected 400) and never touches the DAL', async () => {
    const res = await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'inbound',
        called: '97237219347',
        event: 'conference_started',
        request_id: 'r1',
        target: 'agent_target',
      }),
    );
    expect(res.status).toBe(202);
    expect(updateConsoleCallStatus).not.toHaveBeenCalled();
  });

  it('conference_joined: resolves the target and writes conference_agent_ids', async () => {
    vi.mocked(resolveAgentIdByVoxUsername).mockResolvedValue('conf-agent-uuid');
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'inbound',
        called: '97237219347',
        event: 'conference_joined',
        request_id: 'r1',
        target: 'agent_target',
      }),
    );
    expect(updateConsoleCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({ callId: CALL_ID, conferenceAgentIds: ['conf-agent-uuid'] }),
    );
  });

  it('conference_joined: an unresolvable target never writes conference_agent_ids', async () => {
    vi.mocked(resolveAgentIdByVoxUsername).mockResolvedValue(null);
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'inbound',
        called: '97237219347',
        event: 'conference_joined',
        request_id: 'r1',
        target: 'agent_missing',
      }),
    );
    expect(updateConsoleCallStatus).not.toHaveBeenCalled();
  });

  it('conference_failed: never touches the DAL (nothing was ever written)', async () => {
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'inbound',
        called: '97237219347',
        event: 'conference_failed',
        request_id: 'r1',
        reason: 'timeout',
        target: 'agent_target',
      }),
    );
    expect(updateConsoleCallStatus).not.toHaveBeenCalled();
  });

  it('conference_ended: clears conference_agent_ids', async () => {
    await POST(
      req({
        secret: SECRET,
        session_id: 1,
        call_kind: 'inbound',
        called: '97237219347',
        event: 'conference_ended',
        reason: 'leg_down_operator',
      }),
    );
    expect(updateConsoleCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({ callId: CALL_ID, conferenceAgentIds: [] }),
    );
  });
});
