import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { startMock, enqueueMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock('@/lib/workflow/webhook-trigger', () => ({
  MAX_WEBHOOK_BODY_BYTES: 64 * 1024,
  startRunFromWebhook: startMock,
}));
vi.mock('@/lib/workflow/enqueue', () => ({ enqueueWorkflowRun: enqueueMock }));
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: async () => ({}) }));

import { POST } from './route';

// The STATUS a new run is answered with — transported, not decided, here.
//
// ⚠️ SUMIT counts anything but 200 as a failure and suspends the trigger after
// five (its help article). Its first live calls on 2026-09-23 got 400; a 202
// would have been the next trap. `startRunFromWebhook` decides the status by
// node type; this file pins that the route actually SENDS it — on success and
// on the enqueue-failed path alike, since both mean "we stored it".

let ipSeq = 0;
const call = () =>
  POST(
    {
      // A fresh IP per call, so the per-IP rate limit never decides a test.
      headers: new Headers({ 'x-forwarded-for': `10.0.0.${++ipSeq}` }),
      url: 'https://x.test/api/workflows/hook/anything',
      text: async () => '{}',
    } as never,
    { params: Promise.resolve({ endpoint: 'anything' }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  enqueueMock.mockResolvedValue(undefined);
});

describe('the success status comes from the trigger, not the route', () => {
  it('SUMIT: 200', async () => {
    startMock.mockResolvedValue({ ok: true, runId: 'r', acceptedStatus: 200 });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: 'r' });
  });

  it('trigger.webhook: still 202', async () => {
    startMock.mockResolvedValue({ ok: true, runId: 'r', acceptedStatus: 202 });
    expect((await call()).status).toBe(202);
  });

  it('SUMIT: 200 even when enqueueing failed — the run row exists', async () => {
    startMock.mockResolvedValue({ ok: true, runId: 'r', acceptedStatus: 200 });
    enqueueMock.mockRejectedValue(new Error('queue down'));
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: 'r', queued: false });
  });

  it('bad_json is still 400 — the route maps it unchanged', async () => {
    startMock.mockResolvedValue({ ok: false, reason: 'bad_json' });
    expect((await call()).status).toBe(400);
  });
});
