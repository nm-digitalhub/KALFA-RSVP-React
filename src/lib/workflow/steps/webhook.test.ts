import { describe, expect, it, vi } from 'vitest';

import { ACTION_BRANCH_HANDLES } from '@/lib/workflow/catalogue/types';

import type { OutboundWebhookPort } from '@/lib/workflow/engine/ports';

import { STEP_HANDLERS, type StepContext } from './index';

// `action.webhook` — the one node whose effect leaves KALFA entirely.
//
// The handler is thin by design: every security decision lives behind the port.
// What is asserted here is the contract between the two — what gets sent, what
// the dedup key is, and that a failure BRANCHES rather than throws.

const handler = STEP_HANDLERS['action.webhook'];

// Typed as the PORT's own signature. A bare `vi.fn()` infers a zero-arg tuple
// and tsc then refuses both the assignment and `mock.calls[0][0]`.
type PostMock = ReturnType<typeof vi.fn<OutboundWebhookPort['post']>>;

function ctxWith(post: PostMock, ids = { runId: 'run-1', nodeId: 'node-9' }) {
  return {
    workflowId: 'wf-self',
    ...ids,
    trigger: {
      eventId: 'e1',
      contactId: 'c1',
      message_text: 'שלום',
      button_payload: '',
    },
    deps: {
      guests: {} as StepContext['deps']['guests'],
      alerts: {} as StepContext['deps']['alerts'],
      webhook: { post },
      integrations: {} as StepContext['deps']['integrations'],
      accounting: {} as StepContext['deps']['accounting'],
    },
  } satisfies StepContext;
}

const ok = (): PostMock => vi.fn(async () => ({ ok: true, status: 200 }));

describe('action.webhook — what it sends', () => {
  it('passes the url and the resolved body straight to the port', async () => {
    const post = ok();
    await handler(
      { url: 'https://example.com/hook', body: '{"a":1}' },
      ctxWith(post),
    );
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/hook', body: '{"a":1}' }),
    );
  });

  it('trims the url but NOT the body', async () => {
    // A body is content and may legitimately start or end with whitespace; a URL
    // with surrounding spaces is a paste artefact.
    const post = ok();
    await handler({ url: '  https://example.com/h  ', body: ' x ' }, ctxWith(post));
    expect(post.mock.calls[0][0]).toMatchObject({
      url: 'https://example.com/h',
      body: ' x ',
    });
  });

  it('never reaches a socket itself — the port is the only path out', async () => {
    // If the handler ever called fetch directly, the dry run would post to a
    // third party from a button that promises no outward effect.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await handler({ url: 'https://example.com/h', body: '' }, ctxWith(ok()));
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('action.webhook — the idempotency key', () => {
  it('is <runId>:<nodeId>', async () => {
    const post = ok();
    await handler({ url: 'https://example.com/h', body: '' }, ctxWith(post));
    expect(post.mock.calls[0][0].idempotencyKey).toBe('run-1:node-9');
  });

  it('is IDENTICAL across replays of the same node in the same run', async () => {
    // This is the case the step lease produces: a POST that completed but whose
    // completeStep never landed is sent again. The receiver can only dedupe it if
    // the key is stable.
    const post = ok();
    const ctx = ctxWith(post);
    await handler({ url: 'https://example.com/h', body: '' }, ctx);
    await handler({ url: 'https://example.com/h', body: '' }, ctx);
    expect(post.mock.calls[0][0].idempotencyKey).toBe(
      post.mock.calls[1][0].idempotencyKey,
    );
  });

  it('DIFFERS for the same node in a different run', async () => {
    // Two genuine messages from two guests are two calls, not one deduplicated
    // away by an over-broad key.
    const post = ok();
    await handler({ url: 'https://x/h', body: '' }, ctxWith(post, { runId: 'run-1', nodeId: 'n' }));
    await handler({ url: 'https://x/h', body: '' }, ctxWith(post, { runId: 'run-2', nodeId: 'n' }));
    expect(post.mock.calls[0][0].idempotencyKey).not.toBe(
      post.mock.calls[1][0].idempotencyKey,
    );
  });
});

describe('action.webhook — a failure is an answer, not a throw', () => {
  it('routes to the ERROR branch on a non-2xx', async () => {
    const post: PostMock = vi.fn(async () => ({ ok: false, status: 500, reason: 'HTTP 500' }));
    const r = await handler({ url: 'https://x/h', body: '' }, ctxWith(post));
    expect(r.nextPort).toBe(ACTION_BRANCH_HANDLES.error);
    expect(r.output).toMatchObject({ ok: false, status: 500, reason: 'HTTP 500' });
  });

  it('routes to the error branch on a refused URL, without calling out', async () => {
    const post: PostMock = vi.fn(async () => ({
      ok: false,
      status: null as number | null,
      reason: 'לא ניתן לפנות לכתובת פנימית או לכתובת IP',
    }));
    const r = await handler({ url: 'https://127.0.0.1/h', body: '' }, ctxWith(post));
    expect(r.nextPort).toBe(ACTION_BRANCH_HANDLES.error);
    expect(r.output).toMatchObject({ ok: false, status: null });
  });

  it('a success names NO port, so the ordinary edge fires', async () => {
    const r = await handler({ url: 'https://x/h', body: '' }, ctxWith(ok()));
    expect(r.nextPort).toBeUndefined();
    expect(r.output).toMatchObject({ ok: true, status: 200 });
  });

  it('does not throw when the port reports a failure', async () => {
    const post: PostMock = vi.fn(async () => ({ ok: false, status: null as number | null, reason: 'timeout' }));
    await expect(
      handler({ url: 'https://x/h', body: '' }, ctxWith(post)),
    ).resolves.toBeDefined();
  });
});

describe('action.webhook — what never enters the run log', () => {
  it('the URL is NOT in the output', async () => {
    // It is already on the node in the editor, and a secret path segment — one of
    // the two authentication shapes this node supports — would otherwise be
    // copied into a second store.
    const r = await handler(
      { url: 'https://example.com/t/SECRET-PATH', body: '' },
      ctxWith(ok()),
    );
    expect(JSON.stringify(r.output)).not.toContain('SECRET-PATH');
  });

  it('the BODY is not echoed back either', async () => {
    const r = await handler(
      { url: 'https://x/h', body: '{"phone":"+972500000000"}' },
      ctxWith(ok()),
    );
    expect(JSON.stringify(r.output)).not.toContain('+972500000000');
  });
});
