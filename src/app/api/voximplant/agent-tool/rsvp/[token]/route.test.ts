import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { guard, insertWebhookEvents, processCallRsvp } = vi.hoisted(() => ({
  guard: vi.fn(),
  insertWebhookEvents: vi.fn(),
  processCallRsvp: vi.fn(),
}));
vi.mock('@/lib/voximplant/agent-tool-guard', () => ({ guardAgentToolRequest: guard }));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents }));
vi.mock('@/lib/data/call-result-processing', () => ({ processCallRsvp }));

import { POST } from './route';

// The save_rsvp tool's two stages each log their failure — with the cause, the
// stage and the attempt id, never the token or the answer — while the agent's
// answer stays what it was: 500 when nothing was stored, 'queued' when only the
// synchronous apply failed (the durable row is retried by the drain).
const TOKEN = 'vox-call-token-secret-123';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const BODY = { status: 'attending', adults: 2, children: 1, tool_call_id: 'tc-1' };

function call() {
  return POST(new Request(`https://beta.kalfa.me/api/voximplant/agent-tool/rsvp/${TOKEN}`, { method: 'POST' }), {
    params: Promise.resolve({ token: TOKEN }),
  });
}

const dbError = (message: string) =>
  new Error(message, { cause: { code: '57014', message: 'canceling statement due to statement timeout' } });

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ ok: true, attemptId: ATTEMPT, raw: JSON.stringify(BODY) });
  insertWebhookEvents.mockResolvedValue(undefined);
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});

function expectLoggedWithoutGuestData(stage: string, detail: string) {
  expect(log).toHaveBeenCalledWith('[vox-rsvp] save_rsvp stage failed', { stage, attemptId: ATTEMPT, detail });
  const logged = JSON.stringify(log.mock.calls);
  expect(logged).not.toContain(TOKEN);
  expect(logged).not.toContain('tc-1');
}

describe('POST agent-tool/rsvp — a failed stage is logged', () => {
  it('the synchronous apply failed: logged as sync_apply, and the agent still hears queued', async () => {
    processCallRsvp.mockRejectedValueOnce(dbError('שליחת אישור ההגעה נכשלה'));

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, status: 'queued' });
    expectLoggedWithoutGuestData(
      'sync_apply',
      'שליחת אישור ההגעה נכשלה — [57014] canceling statement due to statement timeout',
    );
  });

  it('the row could not be stored: logged as persist (nothing retries it), and the agent gets 500', async () => {
    insertWebhookEvents.mockRejectedValueOnce(dbError('שמירת אירועי הוובהוק נכשלה'));

    const res = await call();

    expect(res.status).toBe(500);
    expect(processCallRsvp).not.toHaveBeenCalled();
    expectLoggedWithoutGuestData(
      'persist',
      'שמירת אירועי הוובהוק נכשלה — [57014] canceling statement due to statement timeout',
    );
  });

  it('a saved answer logs nothing', async () => {
    processCallRsvp.mockResolvedValueOnce({ status: 'saved' });

    const res = await call();

    expect(await res.json()).toEqual({ ok: true, status: 'saved' });
    expect(log).not.toHaveBeenCalled();
  });
});
