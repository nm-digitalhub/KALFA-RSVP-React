import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));

import type { AgentToolGuardResult } from './agent-tool-guard';
import { emptyNoStore, jsonNoStore, okNoStore } from './no-store-response';
import { okOrFalse, readToolRequest, recordTerminalReport } from './tool-route';

const schema = z.strictObject({ note: z.string().optional() });
const req = () => new Request('https://beta.kalfa.me/api/voximplant/x/tok', { method: 'POST' });
const guardWith = (result: AgentToolGuardResult) => vi.fn(async () => result);
const passing = (raw: string) => guardWith({ ok: true, attemptId: 'attempt-1', raw });

async function refusal(res: Awaited<ReturnType<typeof readToolRequest>>) {
  if (res.ok) throw new Error('expected a refusal');
  return {
    status: res.response.status,
    body: await res.response.text(),
    cache: res.response.headers.get('cache-control'),
  };
}

describe('no-store response builders', () => {
  it('always set Cache-Control: no-store', async () => {
    const empty = emptyNoStore(404);
    expect([empty.status, await empty.text(), empty.headers.get('cache-control')]).toEqual([404, '', 'no-store']);
    const ok = okNoStore();
    expect([ok.status, await ok.text(), ok.headers.get('cache-control')]).toEqual([200, 'ok', 'no-store']);
    const json = jsonNoStore({ a: 1 });
    expect([json.status, await json.json(), json.headers.get('cache-control')]).toEqual([200, { a: 1 }, 'no-store']);
    expect(jsonNoStore({ a: 1 }, 429).status).toBe(429);
  });
});

describe('readToolRequest', () => {
  it('passes scope and size cap to the named guard and returns the parsed body', async () => {
    const guard = passing('{"note":"hi"}');
    const request = req();
    const res = await readToolRequest(request, 'tok', { guard, scope: 'vox-x', maxBodyBytes: 512, schema });
    expect(guard).toHaveBeenCalledWith(request, 'tok', { scope: 'vox-x', maxBodyBytes: 512 });
    expect(res).toEqual({ ok: true, attemptId: 'attempt-1', data: { note: 'hi' } });
  });

  it("answers a guard refusal with the guard's own status, bodiless and no-store", async () => {
    for (const status of [429, 413, 404]) {
      const res = await readToolRequest(req(), 'tok', {
        guard: guardWith({ ok: false, status }),
        scope: 'vox-x',
        maxBodyBytes: 512,
        schema,
      });
      expect(await refusal(res)).toEqual({ status, body: '', cache: 'no-store' });
    }
  });

  it('answers 400 for non-JSON and for a body outside the schema', async () => {
    for (const raw of ['{nope', '{"other":1}', '[]']) {
      const res = await readToolRequest(req(), 'tok', { guard: passing(raw), scope: 'vox-x', maxBodyBytes: 512, schema });
      expect(await refusal(res)).toEqual({ status: 400, body: '', cache: 'no-store' });
    }
  });

  it('rejects an empty body by default and reads it as {} only when asked', async () => {
    const strict = await readToolRequest(req(), 'tok', { guard: passing('  '), scope: 'vox-x', maxBodyBytes: 512, schema });
    expect((await refusal(strict)).status).toBe(400);

    const lenient = await readToolRequest(req(), 'tok', {
      guard: passing('  '),
      scope: 'vox-x',
      maxBodyBytes: 512,
      schema,
      emptyBodyAsObject: true,
    });
    expect(lenient).toEqual({ ok: true, attemptId: 'attempt-1', data: {} });
  });
});

describe('okOrFalse', () => {
  it("returns the processor's ok, and false when it throws", async () => {
    expect(await okOrFalse(async () => ({ ok: true }))).toBe(true);
    expect(await okOrFalse(async () => ({ ok: false }))).toBe(false);
    expect(
      await okOrFalse(async () => {
        throw new Error('db down');
      }),
    ).toBe(false);
  });
});

describe('recordTerminalReport', () => {
  const writers = () => ({
    recordConcluded: vi.fn(async () => ({ applied: true })),
    setElConversationId: vi.fn(async () => ({ applied: true })),
  });

  it('records the error reason when present, otherwise the call status, with a null duration default', async () => {
    const w = writers();
    expect(await recordTerminalReport('a1', { call_status: 'failed', error_reason: 'sip_480' }, w)).toBe(true);
    expect(w.recordConcluded).toHaveBeenLastCalledWith('a1', 'sip_480', null);
    expect(await recordTerminalReport('a1', { call_status: 'completed', call_duration: 42 }, w)).toBe(true);
    expect(w.recordConcluded).toHaveBeenLastCalledWith('a1', 'completed', 42);
    expect(w.setElConversationId).not.toHaveBeenCalled();
  });

  it('stores a non-empty conversation id only', async () => {
    const w = writers();
    await recordTerminalReport('a1', { call_status: 'completed', el_conversation_id: '' }, w);
    await recordTerminalReport('a1', { call_status: 'completed', el_conversation_id: null }, w);
    expect(w.setElConversationId).not.toHaveBeenCalled();
    await recordTerminalReport('a1', { call_status: 'completed', el_conversation_id: 'conv_1' }, w);
    expect(w.setElConversationId).toHaveBeenCalledWith('a1', 'conv_1');
  });

  it('returns false and skips the conversation id when the concluded write throws', async () => {
    const w = writers();
    w.recordConcluded.mockRejectedValue(new Error('db down'));
    expect(await recordTerminalReport('a1', { call_status: 'completed', el_conversation_id: 'conv_1' }, w)).toBe(false);
    expect(w.setElConversationId).not.toHaveBeenCalled();
  });

  it('still returns true when only the conversation-id write throws', async () => {
    const w = writers();
    w.setElConversationId.mockRejectedValue(new Error('db down'));
    expect(await recordTerminalReport('a1', { call_status: 'completed', el_conversation_id: 'conv_1' }, w)).toBe(true);
  });
});
