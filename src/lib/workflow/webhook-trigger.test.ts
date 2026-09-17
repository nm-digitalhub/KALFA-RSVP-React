import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { armedMock, createRunMock } = vi.hoisted(() => ({
  armedMock: vi.fn(),
  createRunMock: vi.fn(),
}));

vi.mock('./store', () => ({
  listArmedWorkflows: armedMock,
  createRunIfNew: createRunMock,
}));

import { MAX_WEBHOOK_BODY_BYTES, startRunFromWebhook } from './webhook-trigger';
import { hashWebhookToken } from './webhook-token';

// The first public, session-less entry point into workflows.
//
// Every test here is about the boundary: which tokens open it, what a caller can
// put inside a run, and what the answer tells an attacker.
//
// ⚠️ THE FIXTURES STORE A HASH, NOT A TOKEN, because the diagram does. What a
// caller sends is still the token — that is the whole point of the indirection,
// and the tests would not prove anything if they compared a stored value to
// itself. `hashWebhookToken` is the SAME function the route runs, so a change to
// the digest breaks here rather than in production.

const TOKEN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const TOKEN_HASH = await hashWebhookToken(TOKEN);

const workflow = (tokenHash: string, type = 'trigger.webhook') => ({
  id: 'wf-1',
  eventId: null,
  definition: {
    name: 'w',
    layoutDirection: 'RIGHT',
    nodes: [
      {
        id: 't',
        type: 'node',
        position: { x: 0, y: 0 },
        data: { type, icon: 'Plugs', properties: { label: 't', description: 'd', tokenHash } },
      },
    ],
    edges: [],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  armedMock.mockResolvedValue([workflow(TOKEN_HASH)]);
  createRunMock.mockResolvedValue('run-1');
});

describe('the token is the whole credential, and only its hash is stored', () => {
  it('a matching token starts a run', async () => {
    const r = await startRunFromWebhook({ token: TOKEN, rawBody: '{"a":1}' });
    expect(r).toEqual({ ok: true, runId: 'run-1' });
  });

  it('a wrong token starts nothing', async () => {
    const r = await startRunFromWebhook({ token: OTHER, rawBody: '{}' });
    expect(r).toEqual({ ok: false, reason: 'not_found' });
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it('an EMPTY configured token never matches — not even an empty request', async () => {
    // A node whose token was never generated must not be reachable by omitting
    // the token from the URL.
    armedMock.mockResolvedValue([workflow('')]);
    expect(await startRunFromWebhook({ token: '', rawBody: '{}' })).toMatchObject({ ok: false });
  });

  it('⚠️ the stored hash is NOT itself a token — presenting it opens nothing', async () => {
    // The property a hash buys: a diagram that leaks (an export, a screenshot, a
    // database read) hands over a value that does not authenticate. If the route
    // ever compared the presented value directly against the stored one, this is
    // the test that would fail.
    expect(await startRunFromWebhook({ token: TOKEN_HASH, rawBody: '{}' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('⚠️ a diagram carrying the OLD raw `token` property opens nothing', async () => {
    // The rename is a security boundary, not a refactor: a workflow saved before
    // it stores `token`, and if the route still read that property the value in
    // the diagram would be a live credential again. Measured before the rename:
    // no stored workflow carried one, so this closes the door rather than a gap.
    armedMock.mockResolvedValue([
      {
        id: 'wf-1',
        eventId: null,
        definition: {
          name: 'w',
          layoutDirection: 'RIGHT',
          nodes: [
            {
              id: 't',
              type: 'node',
              position: { x: 0, y: 0 },
              data: {
                type: 'trigger.webhook',
                icon: 'Plugs',
                properties: { label: 't', description: 'd', token: TOKEN },
              },
            },
          ],
          edges: [],
        },
      },
    ]);

    expect(await startRunFromWebhook({ token: TOKEN, rawBody: '{}' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('only ARMED workflows are searched — disarming closes the URL', async () => {
    // listArmedWorkflows filters on is_active, so a disarmed workflow is simply
    // not in the list. Pinned because "disarm" must be a real off switch.
    armedMock.mockResolvedValue([]);
    expect(await startRunFromWebhook({ token: TOKEN, rawBody: '{}' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('a token on a NON-webhook trigger does not open the endpoint', async () => {
    // A WhatsApp trigger with a stray `token` property in its config must not
    // become a public entry point.
    armedMock.mockResolvedValue([workflow(TOKEN_HASH, 'trigger.whatsapp_inbound')]);
    expect(await startRunFromWebhook({ token: TOKEN, rawBody: '{}' })).toMatchObject({
      ok: false,
    });
  });
});

describe('what the caller can put in a run', () => {
  it('the whole JSON body lands on trigger.body, untouched', async () => {
    // The dynamic part: no field list, so a caller's own shape survives intact
    // and `{{trigger.body.<path>}}` can name any of it.
    await startRunFromWebhook({
      token: TOKEN,
      rawBody: '{"order":{"id":7,"items":["a"]},"source":"shopify"}',
    });
    const planned = createRunMock.mock.calls[0][0];
    expect(planned.triggerPayload.body).toEqual({
      order: { id: 7, items: ['a'] },
      source: 'shopify',
    });
  });

  it('carries NO event and NO contact', async () => {
    // The property the whole security argument rests on: guest-touching nodes
    // refuse inside a run that has neither.
    await startRunFromWebhook({ token: TOKEN, rawBody: '{}' });
    const planned = createRunMock.mock.calls[0][0];
    expect(planned.eventId).toBeNull();
    expect(planned.triggerPayload.eventId).toBeUndefined();
    expect(planned.triggerPayload.contactId).toBeUndefined();
  });

  it('records the trigger source so a run says where it came from', async () => {
    await startRunFromWebhook({ token: TOKEN, rawBody: '{}' });
    expect(createRunMock.mock.calls[0][0].triggerSource).toBe('webhook');
  });

  it('an empty body is an empty object, not a failure', async () => {
    const r = await startRunFromWebhook({ token: TOKEN, rawBody: '' });
    expect(r.ok).toBe(true);
    expect(createRunMock.mock.calls[0][0].triggerPayload.body).toEqual({});
  });

  it('refuses an array or a scalar — `{{trigger.body.x}}` could name nothing', async () => {
    for (const raw of ['[1,2]', '"text"', '42', 'null']) {
      expect(await startRunFromWebhook({ token: TOKEN, rawBody: raw })).toEqual({
        ok: false,
        reason: 'bad_json',
      });
    }
  });

  it('refuses malformed JSON', async () => {
    expect(await startRunFromWebhook({ token: TOKEN, rawBody: '{not json' })).toEqual({
      ok: false,
      reason: 'bad_json',
    });
  });

  it('refuses a body over the cap BEFORE parsing it', async () => {
    const huge = `{"x":"${'a'.repeat(MAX_WEBHOOK_BODY_BYTES)}"}`;
    expect(await startRunFromWebhook({ token: TOKEN, rawBody: huge })).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(createRunMock).not.toHaveBeenCalled();
  });
});

describe('deduplication is opt-in', () => {
  it('no key means every call is its own run', async () => {
    await startRunFromWebhook({ token: TOKEN, rawBody: '{}' });
    expect(createRunMock.mock.calls[0][0].dedupeKey).toBeNull();
  });

  it('a caller key is scoped to the workflow', async () => {
    // Unscoped, two different workflows sharing a caller's key would collide and
    // one of them would silently never run.
    await startRunFromWebhook({ token: TOKEN, rawBody: '{}', idempotencyKey: 'evt-9' });
    expect(createRunMock.mock.calls[0][0].dedupeKey).toBe('webhook:wf-1:evt-9');
  });

  it('a redelivery reports success with no run id', async () => {
    // createRunIfNew returns undefined on the unique violation. The caller did
    // nothing wrong, so a 4xx would make a retrying client escalate.
    createRunMock.mockResolvedValue(undefined);
    expect(await startRunFromWebhook({ token: TOKEN, rawBody: '{}', idempotencyKey: 'x' })).toEqual(
      { ok: true, runId: undefined },
    );
  });
});
