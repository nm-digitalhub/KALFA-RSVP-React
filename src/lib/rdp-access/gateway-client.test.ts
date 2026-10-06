import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { disconnectRdpTunnels } from './gateway-client';

const CONFIG = { adminOrigin: 'http://127.0.0.1:3014', adminSecret: 's'.repeat(40) };

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('disconnectRdpTunnels', () => {
  it('posts the selector to the loopback admin listener with the Bearer secret', async () => {
    const fetchMock = stubFetch(async () => Response.json({ closed: 2 }));
    const result = await disconnectRdpTunnels(CONFIG, { user: 'desktopuser' });
    expect(result).toEqual({ ok: true, value: { closed: 2 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3014/admin/v1/disconnect');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CONFIG.adminSecret}`);
    expect(JSON.parse(String(init.body))).toEqual({ user: 'desktopuser' });
  });

  it('can target one tunnel by id', async () => {
    const fetchMock = stubFetch(async () => Response.json({ closed: 1 }));
    await disconnectRdpTunnels(CONFIG, { tunnelId: 't-1' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ tunnelId: 't-1' });
  });

  it('reports an unreachable listener', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await disconnectRdpTunnels(CONFIG, { user: 'u' })).toEqual({ ok: false, kind: 'unreachable' });
  });

  it('reports a timeout', async () => {
    stubFetch(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(await disconnectRdpTunnels(CONFIG, { user: 'u' })).toEqual({ ok: false, kind: 'timeout' });
  });

  it.each([401, 403, 500, 302])('treats HTTP %i as rejected', async (status) => {
    stubFetch(async () => new Response('nope', { status }));
    expect(await disconnectRdpTunnels(CONFIG, { user: 'u' })).toEqual({ ok: false, kind: 'rejected' });
  });

  it.each([
    ['not JSON', 'not json'],
    ['the wrong shape', JSON.stringify({ done: true })],
    ['a negative count', JSON.stringify({ closed: -1 })],
    ['a fractional count', JSON.stringify({ closed: 1.5 })],
  ])('treats %s as a bad response', async (_label, body) => {
    stubFetch(async () => new Response(body, { status: 200 }));
    expect(await disconnectRdpTunnels(CONFIG, { user: 'u' })).toEqual({ ok: false, kind: 'bad_response' });
  });

  it('never leaks the secret or the response body in a failure', async () => {
    stubFetch(async () => new Response(`secret ${CONFIG.adminSecret}`, { status: 500 }));
    const result = await disconnectRdpTunnels(CONFIG, { user: 'u' });
    expect(JSON.stringify(result)).not.toContain(CONFIG.adminSecret);
  });
});
