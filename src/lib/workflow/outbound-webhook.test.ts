import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOutboundWebhook } from './outbound-webhook';

// The ONE place a workflow reaches a system that is not ours, and the one place
// a secret exists as a value.
//
// Every test here is about what actually leaves the process: the method, the
// headers, and — above all — that a credential goes ON THE WIRE and NOWHERE
// ELSE. The port's return value reaches the step ledger and the editor's log
// panel, so a secret in it would be a secret in the database.

const URL_OK = 'https://example.com/hooks/kalfa';

type Captured = { url: string; init: RequestInit };

let calls: Captured[] = [];

// NOT `Partial<Response>`: its own `body` is a ReadableStream, and intersecting
// it with `{ body?: string }` produces a type nothing can satisfy.
function stubFetch(response: { status?: number; body?: string } = {}) {
  const status = response.status ?? 200;
  const bodyText = response.body ?? '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        status,
        body: {
          getReader: () => {
            let sent = false;
            return {
              async read() {
                if (sent || bodyText === '') return { done: true, value: undefined };
                sent = true;
                return { done: false, value: new TextEncoder().encode(bodyText) };
              },
              async cancel() {},
            };
          },
        },
      } as unknown as Response;
    }),
  );
}

/** The headers actually sent, lower-cased for comparison. */
function sentHeaders(): Record<string, string> {
  const raw = (calls[0]?.init.headers ?? {}) as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
}

beforeEach(() => {
  calls = [];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const post = (input: Parameters<ReturnType<typeof createOutboundWebhook>['post']>[0]) =>
  createOutboundWebhook().post(input);

const base = { url: URL_OK, body: '{"a":1}', idempotencyKey: 'run-1:node-1' };

describe('method', () => {
  it('defaults to POST when the diagram names none', async () => {
    // Every node saved before methods existed meant POST. It must keep meaning
    // POST rather than failing on its next run.
    await post(base);
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('sends the method the owner chose', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
      calls = [];
      await post({ ...base, method });
      expect(calls[0]!.init.method).toBe(method);
    }
  });

  it('falls back to POST on a method the catalogue does not ship', async () => {
    // config arrives from a jsonb column; the schema constrains the form, not
    // the row. An arbitrary string must not reach `fetch` as a verb.
    await post({ ...base, method: 'TRACE' as never });
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('sends NO body on GET or DELETE', async () => {
    // `''` is still a body as far as undici is concerned, and some servers
    // reject a GET that has one.
    for (const method of ['GET', 'DELETE'] as const) {
      calls = [];
      await post({ ...base, method });
      expect(calls[0]!.init.body).toBeUndefined();
    }
  });

  it('sends the body on POST, PUT and PATCH', async () => {
    for (const method of ['POST', 'PUT', 'PATCH'] as const) {
      calls = [];
      await post({ ...base, method });
      expect(calls[0]!.init.body).toBe('{"a":1}');
    }
  });
});

describe('headers', () => {
  it('always carries the idempotency key and a named user agent', async () => {
    await post(base);
    const h = sentHeaders();
    expect(h['x-kalfa-idempotency-key']).toBe('run-1:node-1');
    expect(h['user-agent']).toBe('KALFA-Workflow/1.0');
  });

  it('sends the owner’s rows', async () => {
    await post({ ...base, headers: [{ name: 'X-Trace', value: 'abc' }] });
    expect(sentHeaders()['x-trace']).toBe('abc');
  });

  it('drops blank rows — the control adds one as its affordance', async () => {
    await post({ ...base, headers: [{ name: '  ', value: 'x' }, { name: '', value: '' }] });
    // The three the node sets itself, and nothing from the blank rows.
    expect(Object.keys(sentHeaders()).sort()).toEqual([
      'content-type',
      'user-agent',
      'x-kalfa-idempotency-key',
    ]);
  });

  it('REFUSES a header that would break a guarantee, naming it', async () => {
    // Each of these defeats something promised elsewhere in the file: `host`
    // addresses a vhost the URL check never saw, content-length /
    // transfer-encoding are how request smuggling is spelled, and the
    // idempotency key is the receiver's only defence against a lease replay.
    for (const name of ['Host', 'Content-Length', 'Transfer-Encoding', 'X-Kalfa-Idempotency-Key']) {
      calls = [];
      const r = await post({ ...base, headers: [{ name, value: 'x' }] });
      expect(r.ok).toBe(false);
      expect(r.reason).toContain(name);
      expect(calls).toHaveLength(0);
    }
  });

  it('refuses a newline in a header — that is request splitting', async () => {
    const r = await post({ ...base, headers: [{ name: 'X-A', value: 'a\r\nX-Evil: 1' }] });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('sets Content-Type for a body, and lets an owner row win', async () => {
    await post(base);
    expect(sentHeaders()['content-type']).toBe('application/json');

    calls = [];
    await post({ ...base, headers: [{ name: 'Content-Type', value: 'text/xml' }] });
    expect(sentHeaders()['content-type']).toBe('text/xml');
  });

  it('sets no Content-Type on a bodyless method', async () => {
    await post({ ...base, method: 'GET' });
    expect(sentHeaders()['content-type']).toBeUndefined();
  });
});

describe('secrets — the value goes on the wire and nowhere else', () => {
  const SECRET = 'sk-live-do-not-leak';

  beforeEach(() => {
    vi.stubEnv('KALFA_WORKFLOW_SECRET_ACME', SECRET);
  });

  it('substitutes the reference into the header actually sent', async () => {
    await post({ ...base, headers: [{ name: 'Authorization', value: 'Bearer {{secrets.ACME}}' }] });
    expect(sentHeaders().authorization).toBe(`Bearer ${SECRET}`);
  });

  it('⚠️ the RESULT never contains the secret', async () => {
    // THE TEST THIS SECTION EXISTS FOR. The result is written to
    // workflow_run_steps.output and rendered in the editor's log panel. A secret
    // in it is a secret in the database, readable by anyone with admin access
    // and by anyone who later exports a run.
    const r = await post({
      ...base,
      headers: [{ name: 'Authorization', value: `Bearer {{secrets.ACME}}` }],
      captureResponse: true,
    });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('⚠️ a FAILING call also never reports the secret', async () => {
    // The error path is where a leak usually happens: someone includes the
    // request in the diagnostic. `reason` here is ours, never the caught error.
    stubFetch({ status: 500 });
    const r = await post({
      ...base,
      headers: [{ name: 'Authorization', value: 'Bearer {{secrets.ACME}}' }],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('⚠️ a thrown fetch never reports the secret or the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`connect ECONNREFUSED ${URL_OK} ${SECRET}`); }));
    const r = await post({
      ...base,
      headers: [{ name: 'Authorization', value: 'Bearer {{secrets.ACME}}' }],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain('example.com');
  });

  it('REFUSES TO SEND when a referenced secret is not configured', async () => {
    const r = await post({
      ...base,
      headers: [{ name: 'Authorization', value: 'Bearer {{secrets.NOT_SET}}' }],
    });
    expect(r.ok).toBe(false);
    // The NAME is safe to show — that separation is the whole design.
    expect(r.reason).toContain('NOT_SET');
    // And nothing was sent: a half-authenticated request costs a real 401 at the
    // far end and an afternoon of diagnosis.
    expect(calls).toHaveLength(0);
  });

  it('REFUSES a malformed secret name rather than sending the token', async () => {
    // The pattern never matched it, so substitution reported nothing missing.
    // Sending it would tell the receiver we have a secret store and what someone
    // tried to name in it.
    const r = await post({
      ...base,
      headers: [{ name: 'Authorization', value: 'Bearer {{secrets.lower_case}}' }],
    });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('substitutes into the BODY too — plenty of APIs want the key there', async () => {
    // This refused to substitute until 2026-09-13, on a "headers are where
    // credentials go" rule that simply was not true. An API expecting its key in
    // the JSON payload or a form field is ordinary, and the value still only
    // exists between here and the socket either way.
    await post({ ...base, body: '{"k":"{{secrets.ACME}}"}' });
    expect(String(calls[0]!.init.body)).toBe(`{"k":"${SECRET}"}`);
  });

  it('substitutes into the URL — a Slack hook is a URL that is entirely a secret', async () => {
    vi.stubEnv('KALFA_WORKFLOW_SECRET_SLACK', 'T00/B00/xyz');
    await post({ ...base, url: 'https://hooks.slack.com/services/{{secrets.SLACK}}' });
    expect(calls[0]!.url).toBe('https://hooks.slack.com/services/T00/B00/xyz');
  });

  it('⚠️ the URL is validated AFTER substitution, not before', async () => {
    // The order that makes the private-space refusal meaningful: a secret that
    // resolves to a loopback address must still be refused, and a check on the
    // pre-substitution string would have been judging a different string.
    vi.stubEnv('KALFA_WORKFLOW_SECRET_EVIL', '127.0.0.1');
    const r = await post({ ...base, url: 'https://{{secrets.EVIL}}/x' });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a missing secret in the URL refuses before any connection', async () => {
    const r = await post({ ...base, url: 'https://example.com/{{secrets.NOT_SET}}' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('NOT_SET');
    expect(calls).toHaveLength(0);
  });

  it('a missing secret in the BODY refuses before any connection', async () => {
    const r = await post({ ...base, body: '{"k":"{{secrets.NOT_SET}}"}' });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('the response', () => {
  it('is NOT captured unless asked for', async () => {
    stubFetch({ body: 'hello' });
    const r = await post(base);
    expect(r.body).toBeUndefined();
    expect(r.truncated).toBeUndefined();
  });

  it('is captured when asked for', async () => {
    stubFetch({ body: '{"ok":true}' });
    const r = await post({ ...base, captureResponse: true });
    expect(r.body).toBe('{"ok":true}');
    expect(r.truncated).toBe(false);
  });

  it('is capped, and says so', async () => {
    stubFetch({ body: 'x'.repeat(10 * 1024) });
    const r = await post({ ...base, captureResponse: true });
    expect(r.body!.length).toBe(8 * 1024);
    expect(r.truncated).toBe(true);
  });

  it('survives Hebrew that straddles the buffer', async () => {
    // The naive per-chunk decode produces replacement characters mid-word. This
    // pins the streaming decode.
    stubFetch({ body: 'שלום עולם' });
    const r = await post({ ...base, captureResponse: true });
    expect(r.body).toBe('שלום עולם');
  });

  it('is captured on a FAILING status too — that is where the reason usually is', async () => {
    stubFetch({ status: 422, body: '{"error":"bad field"}' });
    const r = await post({ ...base, captureResponse: true });
    expect(r.ok).toBe(false);
    expect(r.body).toBe('{"error":"bad field"}');
  });
});

describe('the destination is still checked', () => {
  it('refuses a non-https URL before anything is sent', async () => {
    const r = await post({ ...base, url: 'http://example.com/x' });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses private space', async () => {
    const r = await post({ ...base, url: 'https://127.0.0.1/x' });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('never follows a redirect — it would replay the Authorization elsewhere', async () => {
    await post(base);
    expect(calls[0]!.init.redirect).toBe('manual');
  });
});
