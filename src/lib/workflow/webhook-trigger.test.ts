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
/** The PUBLIC half. Not a credential — it identifies which webhook. */
const ENDPOINT = 'ep-public-id';
const OTHER_ENDPOINT = 'ep-someone-else';

const workflow = (tokenHash: string, type = 'trigger.webhook', endpointId = ENDPOINT) => ({
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
          type,
          icon: 'Plugs',
          properties: { label: 't', description: 'd', endpointId, tokenHash },
        },
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

describe('the secret is the whole credential, and only its hash is stored', () => {
  it('a matching token starts a run', async () => {
    const r = await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{"a":1}' });
    expect(r).toEqual({ ok: true, runId: 'run-1', acceptedStatus: 202 });
  });

  it('a wrong token starts nothing', async () => {
    const r = await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: OTHER, rawBody: '{}' });
    expect(r).toEqual({ ok: false, reason: 'not_found' });
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it('an EMPTY configured token never matches — not even an empty request', async () => {
    // A node whose token was never generated must not be reachable by omitting
    // the token from the URL.
    armedMock.mockResolvedValue([workflow('')]);
    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: '', rawBody: '{}' })).toMatchObject({ ok: false });
  });

  it('⚠️ the stored hash is NOT itself a token — presenting it opens nothing', async () => {
    // The property a hash buys: a diagram that leaks (an export, a screenshot, a
    // database read) hands over a value that does not authenticate. If the route
    // ever compared the presented value directly against the stored one, this is
    // the test that would fail.
    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN_HASH, rawBody: '{}' })).toEqual({
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
                properties: { label: 't', description: 'd', endpointId: ENDPOINT, secret: TOKEN },
              },
            },
          ],
          edges: [],
        },
      },
    ]);

    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('only ARMED workflows are searched — disarming closes the URL', async () => {
    // listArmedWorkflows filters on is_active, so a disarmed workflow is simply
    // not in the list. Pinned because "disarm" must be a real off switch.
    armedMock.mockResolvedValue([]);
    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('⚠️ the right SECRET on the wrong ENDPOINT opens nothing', async () => {
    // The two halves are AND-ed. Without this, the public id would be decorative
    // and any armed webhook's secret would open every webhook.
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: OTHER_ENDPOINT, secret: TOKEN, rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('⚠️ the right ENDPOINT with NO secret opens nothing — the path alone proves nothing', async () => {
    // THE PROPERTY THE WHOLE REDESIGN RESTS ON. The endpoint id is public: it is
    // shown in the panel, copied into other systems, and written to every access
    // log. If it were sufficient on its own, moving the secret out of the path
    // would have removed the credential instead of protecting it.
    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: '', rawBody: '{}' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('an EMPTY configured endpointId never matches — not even an empty request', async () => {
    // Mirrors the empty-hash case: a node whose address was never generated must
    // not be reachable by omitting the path segment.
    armedMock.mockResolvedValue([workflow(TOKEN_HASH, 'trigger.webhook', '')]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: '', secret: TOKEN, rawBody: '{}' }),
    ).toMatchObject({ ok: false });
  });

  it('a token on a NON-webhook trigger does not open the endpoint', async () => {
    // A WhatsApp trigger with a stray `token` property in its config must not
    // become a public entry point.
    armedMock.mockResolvedValue([workflow(TOKEN_HASH, 'trigger.whatsapp_inbound')]);
    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' })).toMatchObject({
      ok: false,
    });
  });
});

describe('what the caller can put in a run', () => {
  it('the whole JSON body lands on trigger.body, untouched', async () => {
    // The dynamic part: no field list, so a caller's own shape survives intact
    // and `{{trigger.body.<path>}}` can name any of it.
    await startRunFromWebhook({
      method: 'POST',
      endpointId: ENDPOINT, secret: TOKEN,
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
    await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' });
    const planned = createRunMock.mock.calls[0][0];
    expect(planned.eventId).toBeNull();
    expect(planned.triggerPayload.eventId).toBeUndefined();
    expect(planned.triggerPayload.contactId).toBeUndefined();
  });

  it('records the trigger source so a run says where it came from', async () => {
    await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' });
    expect(createRunMock.mock.calls[0][0].triggerSource).toBe('webhook');
  });

  it('an empty body is an empty object, not a failure', async () => {
    const r = await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '' });
    expect(r.ok).toBe(true);
    expect(createRunMock.mock.calls[0][0].triggerPayload.body).toEqual({});
  });

  it('refuses an array or a scalar — `{{trigger.body.x}}` could name nothing', async () => {
    for (const raw of ['[1,2]', '"text"', '42', 'null']) {
      expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: raw })).toEqual({
        ok: false,
        reason: 'bad_json',
      });
    }
  });

  it('refuses malformed JSON', async () => {
    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{not json' })).toEqual({
      ok: false,
      reason: 'bad_json',
    });
  });

  it('refuses a body over the cap BEFORE parsing it', async () => {
    const huge = `{"x":"${'a'.repeat(MAX_WEBHOOK_BODY_BYTES)}"}`;
    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: huge })).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(createRunMock).not.toHaveBeenCalled();
  });
});

describe('deduplication is opt-in', () => {
  it('no key means every call is its own run', async () => {
    await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' });
    expect(createRunMock.mock.calls[0][0].dedupeKey).toBeNull();
  });

  it('a caller key is scoped to the workflow', async () => {
    // Unscoped, two different workflows sharing a caller's key would collide and
    // one of them would silently never run.
    await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}', idempotencyKey: 'evt-9' });
    expect(createRunMock.mock.calls[0][0].dedupeKey).toBe('webhook:wf-1:evt-9');
  });

  it('a redelivery reports success with no run id', async () => {
    // createRunIfNew returns undefined on the unique violation. The caller did
    // nothing wrong, so a 4xx would make a retrying client escalate.
    createRunMock.mockResolvedValue(undefined);
    expect(await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}', idempotencyKey: 'x' })).toEqual(
      { ok: true, runId: undefined, acceptedStatus: 202 },
    );
  });
});

describe('⚠️ which HTTP methods open the address', () => {
  // THE GAP THIS CLOSES, raised by the owner from n8n's own Webhook node: a
  // caller that can only send GET or PUT could not be integrated at all, because
  // every non-POST call was refused before it reached resolution.
  const withMethods = (methods: unknown) => {
    const w = workflow(TOKEN_HASH);
    (w.definition.nodes[0]!.data.properties as Record<string, unknown>).methods = methods;
    return [w];
  };

  it('⚠️ an ABSENT list means POST ONLY — it must not widen a live endpoint', async () => {
    // Every webhook saved before this field existed was POST-only by
    // construction. Reading "absent" as "any method" would silently open GET,
    // PUT, PATCH and DELETE on every one of them at deploy time.
    armedMock.mockResolvedValue(withMethods(undefined));

    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' }),
    ).toMatchObject({ ok: true });

    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        await startRunFromWebhook({ method, endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' }),
      ).toEqual({ ok: false, reason: 'not_found' });
    }
  });

  it('an EMPTY list means POST only, the same as absent', async () => {
    armedMock.mockResolvedValue(withMethods([]));
    expect(
      await startRunFromWebhook({ method: 'GET', endpointId: ENDPOINT, secret: TOKEN, rawBody: '' }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a configured method opens, and the others stay shut', async () => {
    armedMock.mockResolvedValue(withMethods([{ value: 'GET' }]));
    expect(
      await startRunFromWebhook({ method: 'GET', endpointId: ENDPOINT, secret: TOKEN, rawBody: '' }),
    ).toMatchObject({ ok: true });
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('⚠️ tolerates the BARE-STRING shape a hand-written diagram may hold', async () => {
    // The control stores `[{value}]` because the SDK's ArrayFieldSchema cannot
    // describe an array of strings — the same trap `messageKinds` fell into,
    // where the first version wrote plain strings and every saved trigger
    // carried a validation error. Both shapes must open the same door.
    armedMock.mockResolvedValue(withMethods(['PUT']));
    expect(
      await startRunFromWebhook({ method: 'PUT', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' }),
    ).toMatchObject({ ok: true });
  });

  it('⚠️ the method is checked AFTER the secret — a wrong secret learns nothing', async () => {
    // Order matters for what an attacker can infer. If the verb were rejected
    // first, "405 here, 404 there" would confirm that an endpoint exists without
    // ever authenticating. Both answers are the same 404.
    armedMock.mockResolvedValue(withMethods([{ value: 'POST' }]));
    const wrongSecretAllowedVerb = await startRunFromWebhook({
      method: 'POST', endpointId: ENDPOINT, secret: OTHER, rawBody: '{}',
    });
    const wrongSecretWrongVerb = await startRunFromWebhook({
      method: 'DELETE', endpointId: ENDPOINT, secret: OTHER, rawBody: '{}',
    });
    expect(wrongSecretAllowedVerb).toEqual(wrongSecretWrongVerb);
  });
});

describe('the query string is published separately from the body', () => {
  it('lands on trigger.query, and body stays its own thing', async () => {
    await startRunFromWebhook({
      method: 'POST',
      endpointId: ENDPOINT,
      secret: TOKEN,
      rawBody: '{"fromBody":1}',
      query: { fromQuery: 'yes' },
    });
    const planned = createRunMock.mock.calls[0][0];
    expect(planned.triggerPayload.query).toEqual({ fromQuery: 'yes' });
    expect(planned.triggerPayload.body).toEqual({ fromBody: 1 });
  });

  it('⚠️ is always present, even when empty — a template naming it must not throw', async () => {
    await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' });
    expect(createRunMock.mock.calls[0][0].triggerPayload.query).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// auth: 'address' — the path IS the credential
// ---------------------------------------------------------------------------

/**
 * A node in `address` mode.
 *
 * ⚠️ `endpointId` IS ABSENT, not blank-by-accident. That is the contract: the
 * path segment is a credential, so storing it would put it into the diagram and
 * from there into every run's `definitionSnapshot`. Only its hash is kept.
 */
const addressWorkflow = (tokenHash: string, extra: Record<string, unknown> = {}) => ({
  id: 'wf-addr',
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
          properties: { label: 't', description: 'd', auth: 'address', tokenHash, ...extra },
        },
      },
    ],
    edges: [],
  },
});

/** The 32-byte value that lives in the path. Hashed exactly like a header secret. */
const PATH_SECRET = 'c'.repeat(43);
const PATH_HASH = await hashWebhookToken(PATH_SECRET);

describe("auth: 'address' — for a caller that cannot send a header", () => {
  it('the path alone starts a run, with no header at all', async () => {
    armedMock.mockResolvedValue([addressWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: '{"a":1}' }),
    ).toEqual({ ok: true, runId: 'run-1', acceptedStatus: 202 });
  });

  it('a wrong path starts nothing', async () => {
    armedMock.mockResolvedValue([addressWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: OTHER, secret: '', rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it('⚠️ the stored hash is not itself a path — presenting it opens nothing', async () => {
    // The same property the header mode has, and for the same reason: a leaked
    // diagram hands over a value that does not authenticate.
    armedMock.mockResolvedValue([addressWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_HASH, secret: '', rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a header is neither required nor consulted', async () => {
    // Not a nicety: SUMIT sends whatever it sends, and a node in this mode must
    // not start depending on a value its caller cannot control.
    armedMock.mockResolvedValue([addressWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: 'anything', rawBody: '{}' }),
    ).toMatchObject({ ok: true });
  });

  it('⚠️ an EMPTY stored hash is never reachable, not even by an empty path', async () => {
    armedMock.mockResolvedValue([addressWorkflow('')]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: '', secret: '', rawBody: '{}' }),
    ).toMatchObject({ ok: false });
  });

  it('the method allow-list still applies, and is still checked last', async () => {
    armedMock.mockResolvedValue([addressWorkflow(PATH_HASH, { methods: [{ value: 'PUT' }] })]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await startRunFromWebhook({ method: 'PUT', endpointId: PATH_SECRET, secret: '', rawBody: '{}' }),
    ).toMatchObject({ ok: true });
  });
});

describe('⚠️ the modes do not leak into each other', () => {
  it('a HEADER-mode node with the right path and NO header is still refused', async () => {
    // THE REGRESSION THIS WHOLE FILE EXISTS FOR. `findWorkflowForEndpoint` used
    // to refuse an empty secret before looking at any node; that early bail had
    // to go so `address` mode could work at all. If the per-node header check
    // were ever dropped with it, every public endpoint id in every saved diagram
    // — values that have been displayed and copied since 2026-09-22 — would
    // become a working credential.
    armedMock.mockResolvedValue([workflow(TOKEN_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: '', rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it('a HEADER-mode node is not reachable by putting the secret in the path', async () => {
    armedMock.mockResolvedValue([workflow(TOKEN_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: TOKEN, secret: '', rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('an ADDRESS-mode node is not reachable by the header that once opened it', async () => {
    // The mode-switch case: the stored hash is of the old header secret, so
    // nothing reaches this node until it is regenerated. arm-check refuses to
    // arm it for exactly this reason; here we prove the runtime agrees.
    armedMock.mockResolvedValue([addressWorkflow(TOKEN_HASH, { endpointId: ENDPOINT })]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('an absent auth field reads as header mode — every saved diagram is unchanged', async () => {
    // `readWebhookAuthMode` decides this, and getting it wrong would turn a
    // published endpoint id into a credential overnight.
    armedMock.mockResolvedValue([workflow(TOKEN_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' }),
    ).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// trigger.sumit_card — the same route, a known caller, the mode fixed by TYPE
// ---------------------------------------------------------------------------

const sumitWorkflow = (tokenHash: string, extra: Record<string, unknown> = {}) => ({
  id: 'wf-sumit',
  eventId: null,
  definition: {
    name: 'w',
    layoutDirection: 'RIGHT',
    nodes: [
      {
        id: 't',
        type: 'start-node',
        position: { x: 0, y: 0 },
        data: {
          type: 'trigger.sumit_card',
          icon: 'IdentificationCard',
          properties: { label: 't', description: 'd', tokenHash, ...extra },
        },
      },
    ],
    edges: [],
  },
});

describe('trigger.sumit_card — reached through the same public route', () => {
  it('the path alone starts a run — SUMIT sends no header', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: '{"EntityID":1}' }),
    ).toEqual({ ok: true, runId: 'run-1', acceptedStatus: 200 });
  });

  it('a wrong path starts nothing', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: OTHER, secret: '', rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('⚠️ the node TYPE decides the mode — a hand-edited row cannot', () => {
  it('a stored `auth: header` does not make SUMIT wait for a header', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH, { auth: 'header' })]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: '{}' }),
    ).toMatchObject({ ok: true });
  });

  it('a stored public `endpointId` plus a header never opens a SUMIT node', async () => {
    // If the row could flip it to header mode, a stored id — something that may
    // have been displayed and copied — would become half of a credential.
    armedMock.mockResolvedValue([
      sumitWorkflow(TOKEN_HASH, { auth: 'header', endpointId: ENDPOINT }),
    ]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a stored `methods` list is ignored — POST only, by type', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH, { methods: [{ value: 'PUT' }] })]);
    expect(
      await startRunFromWebhook({ method: 'PUT', endpointId: PATH_SECRET, secret: '', rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: '{}' }),
    ).toMatchObject({ ok: true });
  });

  it('⚠️ widening the route to a second type did not reopen header mode', async () => {
    // The regression this file guards, re-asked AFTER the type list grew: a
    // header-mode `trigger.webhook` with the right public id and no header
    // still gets nothing.
    armedMock.mockResolvedValue([workflow(TOKEN_HASH), sumitWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: '', rawBody: '{}' }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(createRunMock).not.toHaveBeenCalled();
  });
});

describe('⚠️ SUMIT: save first, judge later — its own retry contract', () => {
  // SUMIT's help article: store the call, answer 200, process afterwards; five
  // answers it does not accept suspend the trigger. Its first live calls on
  // 2026-09-23 were refused 400 by the object-only shape check, so a SUMIT node
  // now KEEPS what arrived. `trigger.webhook` keeps refusing — below.
  const payloadOf = () => createRunMock.mock.calls[0][0].triggerPayload.body;

  it('an object is stored as-is and answered 200', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: '{"EntityID":7}' }),
    ).toEqual({ ok: true, runId: 'run-1', acceptedStatus: 200 });
    expect(payloadOf()).toEqual({ EntityID: 7 });
  });

  it('an ARRAY is stored under `value`, not refused', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: '[{"EntityID":7}]' }),
    ).toMatchObject({ ok: true, acceptedStatus: 200 });
    expect(payloadOf()).toEqual({ value: [{ EntityID: 7 }] });
  });

  it('a scalar or null is stored under `value`', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: 'null' });
    expect(payloadOf()).toEqual({ value: null });
  });

  it('text that is not JSON is stored under `text`', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: 'EntityID=7&Folder=1' }),
    ).toMatchObject({ ok: true, acceptedStatus: 200 });
    expect(payloadOf()).toEqual({ text: 'EntityID=7&Folder=1' });
  });

  it('the size cap still applies to SUMIT — 413, nothing stored', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    const huge = 'a'.repeat(MAX_WEBHOOK_BODY_BYTES + 1);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: huge }),
    ).toEqual({ ok: false, reason: 'too_large' });
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it('a WRONG path with a bad body is still 400, as before — not a hint about the address', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: OTHER, secret: '', rawBody: '[1]' }),
    ).toEqual({ ok: false, reason: 'bad_json' });
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it('⚠️ `trigger.webhook` is untouched: valid credentials + an array is still 400, nothing stored', async () => {
    armedMock.mockResolvedValue([workflow(TOKEN_HASH), sumitWorkflow(PATH_HASH)]);
    for (const raw of ['[1]', 'not json', 'null']) {
      expect(
        await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: raw }),
      ).toEqual({ ok: false, reason: 'bad_json' });
    }
    expect(createRunMock).not.toHaveBeenCalled();
  });
});

describe('⚠️ SUMIT sends a FORM — `json=<url-encoded object>` (measured 2026-09-23)', () => {
  // The shape of the first real stored run, with the personal fields replaced.
  const card = {
    Folder: 1,
    EntityID: 2,
    Type: 'CreateOrUpdate',
    Properties: {
      Billing_Status: [3],
      Billing_Customer: [{ ID: 9, Name: 'לקוח לדוגמה', Version: 6, Status: 0, SchemaID: 5 }],
    },
  };
  const form = (value: string) => `json=${encodeURIComponent(value).replace(/%20/g, '+')}`;
  const payloadOf = () => createRunMock.mock.calls[0][0].triggerPayload.body;

  it('the `json` field is unwrapped into the object the handler reads', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: form(JSON.stringify(card)) }),
    ).toMatchObject({ ok: true, acceptedStatus: 200 });
    expect(payloadOf()).toEqual(card);
  });

  it('a `json` field that is not one object is kept as text, not dropped', async () => {
    armedMock.mockResolvedValue([sumitWorkflow(PATH_HASH)]);
    const raw = form('[1,2]');
    await startRunFromWebhook({ method: 'POST', endpointId: PATH_SECRET, secret: '', rawBody: raw });
    expect(payloadOf()).toEqual({ text: raw });
  });

  it('⚠️ `trigger.webhook` does NOT unwrap a form — still 400', async () => {
    expect(
      await startRunFromWebhook({ method: 'POST', endpointId: ENDPOINT, secret: TOKEN, rawBody: form(JSON.stringify(card)) }),
    ).toEqual({ ok: false, reason: 'bad_json' });
    expect(createRunMock).not.toHaveBeenCalled();
  });
});
