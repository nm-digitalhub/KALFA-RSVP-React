import { beforeEach, describe, expect, it, vi } from 'vitest';

// The token-gated tool and terminal-report routes of the meeting-confirmation (mtg) and sales (sls) calls. Each one is
// guard -> JSON -> schema -> one processor, answered to a voice agent that hears only `ok`. The token guard and the
// processors are mocked: this file pins what every ROUTE does with them — which guard it authorizes against, that a
// refusal is bodiless and reaches no processor, and what it answers.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/voximplant/agent-tool-guard', () => ({
  guardMeetingToolRequest: vi.fn(),
  guardSalesToolRequest: vi.fn(),
}));
vi.mock('@/lib/data/callback-voice-processing', () => ({
  processMeetingConfirm: vi.fn(),
  processMeetingOptOut: vi.fn(),
  processMeetingEscalate: vi.fn(),
  processMeetingReschedule: vi.fn(),
}));
vi.mock('@/lib/data/sales-voice-processing', () => ({
  processSalesOptOut: vi.fn(),
  processSalesEscalate: vi.fn(),
  processSalesNotifyOwner: vi.fn(),
  processSalesScheduleCallback: vi.fn(),
}));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents: vi.fn() }));
vi.mock('@/lib/data/callback-request-attempts', () => ({
  recordCallbackDispatchConcluded: vi.fn(),
  setCallbackAttemptElConversationId: vi.fn(),
}));
vi.mock('@/lib/data/sales-call-attempts', () => ({
  recordSalesDispatchConcluded: vi.fn(),
  setSalesAttemptElConversationId: vi.fn(),
  claimSalesOutcome: vi.fn(),
}));
vi.mock('@/lib/data/callback-scheduling', () => ({ applyCallOutcome: vi.fn() }));

import {
  recordCallbackDispatchConcluded,
  setCallbackAttemptElConversationId,
} from '@/lib/data/callback-request-attempts';
import { applyCallOutcome } from '@/lib/data/callback-scheduling';
import {
  processMeetingConfirm,
  processMeetingEscalate,
  processMeetingOptOut,
  processMeetingReschedule,
} from '@/lib/data/callback-voice-processing';
import {
  claimSalesOutcome,
  recordSalesDispatchConcluded,
  setSalesAttemptElConversationId,
} from '@/lib/data/sales-call-attempts';
import {
  processSalesEscalate,
  processSalesNotifyOwner,
  processSalesOptOut,
  processSalesScheduleCallback,
} from '@/lib/data/sales-voice-processing';
import { insertWebhookEvents } from '@/lib/data/webhooks';
import { guardMeetingToolRequest, guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';

import { POST as mtgCb } from './mtg/cb/[token]/route';
import { POST as mtgConfirm } from './mtg/tool/confirm/[token]/route';
import { POST as mtgDnc } from './mtg/tool/dnc/[token]/route';
import { POST as mtgEscalate } from './mtg/tool/escalate/[token]/route';
import { POST as mtgReschedule } from './mtg/tool/reschedule/[token]/route';
import { POST as slsCb } from './sls/cb/[token]/route';
import { POST as slsDnc } from './sls/tool/dnc/[token]/route';
import { POST as slsEscalate } from './sls/tool/escalate/[token]/route';
import { POST as slsNote } from './sls/tool/note/[token]/route';
import { POST as slsSchedule } from './sls/tool/schedule/[token]/route';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

type Handler = (req: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;
type Guard = typeof guardMeetingToolRequest;
// Any processor, whatever arguments it takes: each row below names one, and the route decides what it is given.
type Processor = (...args: never[]) => Promise<{ ok: boolean }>;

// The route reads its body from the guard's `raw`, never from the request, so the guard mock carries it.
function call(handler: Handler, guard: Guard, raw: string): Promise<Response> {
  vi.mocked(guard).mockResolvedValue({ ok: true, attemptId: ATTEMPT_ID, raw });
  return handler(new Request(`https://beta.kalfa.me/api/voximplant/x/${TOKEN}`, { method: 'POST' }), {
    params: Promise.resolve({ token: TOKEN }),
  });
}

interface ToolCase {
  name: string;
  handler: Handler;
  guard: Guard;
  otherGuard: Guard;
  scope: string;
  maxBodyBytes: number;
  processor: Processor;
  /** A body the route's schema accepts. */
  valid: Record<string, unknown>;
  /** Whether the processor receives the parsed body (false: it takes the attempt id alone). */
  passesBody: boolean;
  /** Whether a blank body is read as `{}` (tools with no required field). */
  emptyBodyOk: boolean;
  /** The 200 body for a processor that answered `ok`. */
  answer: (ok: boolean) => Record<string, unknown>;
  /** Persist-then-process: the webhook_inbox row written before the processor runs. */
  inbox?: { eventKind: string; dedupeKey: string };
}

const okAnswer = (ok: boolean) => ({ ok });

const TOOLS: ToolCase[] = [
  {
    name: 'mtg confirm',
    handler: mtgConfirm,
    guard: guardMeetingToolRequest,
    otherGuard: guardSalesToolRequest,
    scope: 'vox-mtg-confirm',
    maxBodyBytes: 4 * 1024,
    processor: processMeetingConfirm,
    valid: {},
    passesBody: false,
    emptyBodyOk: true,
    answer: okAnswer,
  },
  {
    name: 'mtg dnc',
    handler: mtgDnc,
    guard: guardMeetingToolRequest,
    otherGuard: guardSalesToolRequest,
    scope: 'vox-mtg-dnc',
    maxBodyBytes: 4 * 1024,
    processor: processMeetingOptOut,
    valid: {},
    passesBody: false,
    emptyBodyOk: true,
    answer: okAnswer,
    inbox: { eventKind: 'mtg_dnc', dedupeKey: `vox-mtg-dnc:${ATTEMPT_ID}` },
  },
  {
    name: 'mtg escalate',
    handler: mtgEscalate,
    guard: guardMeetingToolRequest,
    otherGuard: guardSalesToolRequest,
    scope: 'vox-mtg-escalate',
    maxBodyBytes: 4 * 1024,
    processor: processMeetingEscalate,
    valid: { reason: 'wrong_person' },
    passesBody: true,
    emptyBodyOk: false,
    answer: okAnswer,
  },
  {
    name: 'mtg reschedule',
    handler: mtgReschedule,
    guard: guardMeetingToolRequest,
    otherGuard: guardSalesToolRequest,
    scope: 'vox-mtg-reschedule',
    maxBodyBytes: 4 * 1024,
    processor: processMeetingReschedule,
    valid: { callback_when_text: 'מחר בבוקר' },
    passesBody: true,
    emptyBodyOk: false,
    answer: okAnswer,
  },
  {
    name: 'sls dnc',
    handler: slsDnc,
    guard: guardSalesToolRequest,
    otherGuard: guardMeetingToolRequest,
    scope: 'vox-sls-dnc',
    maxBodyBytes: 4 * 1024,
    processor: processSalesOptOut,
    valid: {},
    passesBody: false,
    emptyBodyOk: true,
    answer: okAnswer,
    inbox: { eventKind: 'sls_dnc', dedupeKey: `vox-sls-dnc:${ATTEMPT_ID}` },
  },
  {
    name: 'sls escalate',
    handler: slsEscalate,
    guard: guardSalesToolRequest,
    otherGuard: guardMeetingToolRequest,
    scope: 'vox-sls-escalate',
    maxBodyBytes: 2 * 1024,
    processor: processSalesEscalate,
    valid: { reason: 'הלקוח מבקש לדבר עם נציג' },
    passesBody: true,
    emptyBodyOk: false,
    // No live transfer in v1: `notified` is the processor's answer, `transferred` is always false.
    answer: (ok) => ({ transferred: false, notified: ok }),
  },
  {
    name: 'sls note',
    handler: slsNote,
    guard: guardSalesToolRequest,
    otherGuard: guardMeetingToolRequest,
    scope: 'vox-sls-note',
    maxBodyBytes: 8 * 1024,
    processor: processSalesNotifyOwner,
    valid: { kind: 'question', text: 'האם יש הנחה לאירוע קטן' },
    passesBody: true,
    emptyBodyOk: false,
    answer: okAnswer,
  },
  {
    name: 'sls schedule',
    handler: slsSchedule,
    guard: guardSalesToolRequest,
    otherGuard: guardMeetingToolRequest,
    scope: 'vox-sls-schedule',
    maxBodyBytes: 8 * 1024,
    processor: processSalesScheduleCallback,
    valid: { callback_when_text: 'ביום ראשון אחר הצהריים' },
    passesBody: true,
    emptyBodyOk: false,
    answer: okAnswer,
  },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe.each(TOOLS)('$name tool route', (tool) => {
  it('authorizes against its own guard, with its own scope and body cap', async () => {
    vi.mocked(tool.processor).mockResolvedValue({ ok: true });
    await call(tool.handler, tool.guard, JSON.stringify(tool.valid));
    expect(tool.guard).toHaveBeenCalledTimes(1);
    const [, token, opts] = vi.mocked(tool.guard).mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(opts).toEqual({ scope: tool.scope, maxBodyBytes: tool.maxBodyBytes });
    expect(tool.otherGuard).not.toHaveBeenCalled();
  });

  it.each([404, 413, 429])('a guard refusal (%i) is bodiless and reaches nothing', async (status) => {
    vi.mocked(tool.guard).mockResolvedValue({ ok: false, status } as never);
    const res = await tool.handler(new Request('https://beta.kalfa.me/x', { method: 'POST' }), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(status);
    expect(await res.text()).toBe('');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(tool.processor).not.toHaveBeenCalled();
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('answers a bodiless 400 for a body that is not JSON, or that carries an unknown field', async () => {
    for (const raw of ['{not json', JSON.stringify({ ...tool.valid, smuggled: 1 })]) {
      const res = await call(tool.handler, tool.guard, raw);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('');
    }
    expect(tool.processor).not.toHaveBeenCalled();
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('reads a blank body as {} only when the tool takes no arguments', async () => {
    vi.mocked(tool.processor).mockResolvedValue({ ok: true });
    const res = await call(tool.handler, tool.guard, '  ');
    expect(res.status).toBe(tool.emptyBodyOk ? 200 : 400);
    expect(vi.mocked(tool.processor).mock.calls.length).toBe(tool.emptyBodyOk ? 1 : 0);
  });

  it('runs its processor on the TOKEN-verified attempt and answers what it said', async () => {
    for (const ok of [true, false]) {
      vi.mocked(tool.processor).mockReset();
      vi.mocked(tool.processor).mockResolvedValue({ ok });
      const res = await call(tool.handler, tool.guard, JSON.stringify(tool.valid));
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toEqual(tool.answer(ok));
      const args = vi.mocked(tool.processor).mock.calls[0];
      expect(args).toEqual(tool.passesBody ? [ATTEMPT_ID, tool.valid] : [ATTEMPT_ID]);
    }
  });

  it('answers ok:false, never a 500, when its processor throws', async () => {
    vi.mocked(tool.processor).mockRejectedValue(new Error('db-host-7 refused'));
    const res = await call(tool.handler, tool.guard, JSON.stringify(tool.valid));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual(tool.answer(false));
    expect(text).not.toContain('db-host-7');
  });
});

describe.each(TOOLS.filter((tool) => tool.inbox))('$name tool route — persist, then process', (tool) => {
  it('stores one webhook_inbox row keyed by the attempt before the processor runs', async () => {
    const order: string[] = [];
    vi.mocked(insertWebhookEvents).mockImplementation(async () => {
      order.push('persist');
      return undefined as never;
    });
    vi.mocked(tool.processor).mockImplementation(async () => {
      order.push('process');
      return { ok: true };
    });
    await call(tool.handler, tool.guard, JSON.stringify({ tool_call_id: 'tc-1' }));
    expect(order).toEqual(['persist', 'process']);
    const [rows] = vi.mocked(insertWebhookEvents).mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'voximplant',
      event_kind: tool.inbox!.eventKind,
      dedupe_key: tool.inbox!.dedupeKey,
      message_id: ATTEMPT_ID,
      payload: { tool_call_id: 'tc-1' },
    });
  });

  it('answers a bodiless 500 and does not process when the row cannot be stored', async () => {
    vi.mocked(insertWebhookEvents).mockRejectedValue(new Error('boom'));
    const res = await call(tool.handler, tool.guard, '{}');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('');
    expect(tool.processor).not.toHaveBeenCalled();
  });
});

// The scenario's own terminal lifecycle report: the attempt moves to 'concluded' whatever the call's result was.
const REPORTS = [
  {
    name: 'mtg cb',
    handler: mtgCb,
    guard: guardMeetingToolRequest,
    scope: 'vox-mtg-cb',
    recordConcluded: recordCallbackDispatchConcluded,
    setElConversationId: setCallbackAttemptElConversationId,
  },
  {
    name: 'sls cb',
    handler: slsCb,
    guard: guardSalesToolRequest,
    scope: 'vox-sls-cb',
    recordConcluded: recordSalesDispatchConcluded,
    setElConversationId: setSalesAttemptElConversationId,
  },
] as const;

describe.each(REPORTS)('$name terminal report route', (report) => {
  it('authorizes against its own guard with an 8KB cap', async () => {
    await call(report.handler, report.guard, JSON.stringify({ call_status: 'completed' }));
    const [, token, opts] = vi.mocked(report.guard).mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(opts).toEqual({ scope: report.scope, maxBodyBytes: 8 * 1024 });
  });

  it('records the conclusion with the error reason when one was sent, else the call status', async () => {
    let res = await call(report.handler, report.guard, JSON.stringify({ call_status: 'completed', call_duration: 42 }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(report.recordConcluded).toHaveBeenLastCalledWith(ATTEMPT_ID, 'completed', 42);

    res = await call(report.handler, report.guard, JSON.stringify({ call_status: 'failed', error_reason: 'busy' }));
    expect(res.status).toBe(200);
    expect(report.recordConcluded).toHaveBeenLastCalledWith(ATTEMPT_ID, 'busy', null);
  });

  it('stores the ElevenLabs conversation id only when one was sent, and never fails the ack over it', async () => {
    await call(report.handler, report.guard, JSON.stringify({ call_status: 'completed' }));
    expect(report.setElConversationId).not.toHaveBeenCalled();

    vi.mocked(report.setElConversationId).mockRejectedValue(new Error('boom'));
    const res = await call(
      report.handler,
      report.guard,
      JSON.stringify({ call_status: 'completed', el_conversation_id: 'conv_1' }),
    );
    expect(report.setElConversationId).toHaveBeenCalledWith(ATTEMPT_ID, 'conv_1');
    expect(res.status).toBe(200);
  });

  it('answers a bodiless 500 when the conclusion cannot be recorded, and 400 for a bad body', async () => {
    vi.mocked(report.recordConcluded).mockRejectedValue(new Error('boom'));
    let res = await call(report.handler, report.guard, JSON.stringify({ call_status: 'completed' }));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('');
    expect(report.setElConversationId).not.toHaveBeenCalled();

    vi.mocked(report.recordConcluded).mockReset();
    res = await call(report.handler, report.guard, JSON.stringify({ call_status: 'ringing' }));
    expect(res.status).toBe(400);
    expect(report.recordConcluded).not.toHaveBeenCalled();
  });
});

describe('sls cb terminal report route — a call with no conversation', () => {
  it.each(['no_answer', 'no_response', 'failed'])('closes the request as no_answer on %s', async (status) => {
    vi.mocked(claimSalesOutcome).mockResolvedValue({ callbackRequestId: REQUEST_ID } as never);
    const res = await call(slsCb, guardSalesToolRequest, JSON.stringify({ call_status: status }));
    expect(res.status).toBe(200);
    expect(claimSalesOutcome).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(applyCallOutcome).toHaveBeenCalledWith(REQUEST_ID, 'no_answer');
  });

  it('leaves the outcome alone for a completed call, or when it was already claimed', async () => {
    await call(slsCb, guardSalesToolRequest, JSON.stringify({ call_status: 'completed' }));
    expect(claimSalesOutcome).not.toHaveBeenCalled();

    vi.mocked(claimSalesOutcome).mockResolvedValue(null as never);
    await call(slsCb, guardSalesToolRequest, JSON.stringify({ call_status: 'no_answer' }));
    expect(applyCallOutcome).not.toHaveBeenCalled();
  });

  it('still acks when the outcome write throws', async () => {
    vi.mocked(claimSalesOutcome).mockRejectedValue(new Error('boom'));
    const res = await call(slsCb, guardSalesToolRequest, JSON.stringify({ call_status: 'no_answer' }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});
