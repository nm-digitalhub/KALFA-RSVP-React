import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { connectRdpFile, disconnectRdpTunnels, listRdpTunnels } from './gateway-client';
import { RDP_FILE_MAX_BYTES } from './policy';

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

describe('listRdpTunnels', () => {
  const TUNNEL = { tunnelId: 't-1', user: 'desktopuser', clientIp: '203.0.113.7', target: 'desktop.example.test:3389', connectedOn: '2026-10-07T00:00:09Z' };

  it('reads the live tunnels from the loopback admin listener with the Bearer secret', async () => {
    const fetchMock = stubFetch(async () => Response.json({ tunnels: [TUNNEL] }));
    expect(await listRdpTunnels(CONFIG)).toEqual({ ok: true, value: { tunnels: [TUNNEL] } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3014/admin/v1/tunnels');
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CONFIG.adminSecret}`);
  });

  it('treats the null the gateway sends for "nobody connected" as an empty list', async () => {
    stubFetch(async () => Response.json({ tunnels: null }));
    expect(await listRdpTunnels(CONFIG)).toEqual({ ok: true, value: { tunnels: [] } });
  });

  it('reports a fixed failure kind for every way it can go wrong, never a body', async () => {
    stubFetch(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3014 token=leak');
    });
    expect(await listRdpTunnels(CONFIG)).toEqual({ ok: false, kind: 'unreachable' });

    stubFetch(async () => new Response('forbidden', { status: 403 }));
    expect(await listRdpTunnels(CONFIG)).toEqual({ ok: false, kind: 'rejected' });

    stubFetch(async () => new Response('not json'));
    expect(await listRdpTunnels(CONFIG)).toEqual({ ok: false, kind: 'bad_response' });

    stubFetch(async () => Response.json({ tunnels: [{ tunnelId: 't-1' }] }));
    expect(await listRdpTunnels(CONFIG)).toEqual({ ok: false, kind: 'bad_response' });

    stubFetch(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    expect(await listRdpTunnels(CONFIG)).toEqual({ ok: false, kind: 'timeout' });
  });
});

describe('connectRdpFile', () => {
  const CONNECT = {
    gatewayOrigin: 'http://127.0.0.1:3013',
    connectSecret: 'c'.repeat(40),
    gatewayUser: 'desktopuser',
    target: 'desktop.example.test:3389',
  };
  const FILE = 'gatewayhostname:s:gw.example.test\r\nfull address:s:desktop.example.test:3389\r\n';
  const rdp = (body = FILE, type = 'application/x-rdp') =>
    new Response(body, { status: 200, headers: { 'content-type': type } });

  it('asks the loopback gateway for the pinned target, signed in as the gateway account', async () => {
    const fetchMock = stubFetch(async () => rdp());
    const result = await connectRdpFile(CONNECT, '203.0.113.7');
    expect(result).toEqual({ ok: true, value: { text: FILE } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3013/connect?host=desktop.example.test%3A3389');
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toEqual({
      'X-Kalfa-Staff-Id': 'desktopuser',
      'X-Kalfa-Internal': CONNECT.connectSecret,
      'X-Forwarded-For': '203.0.113.7',
    });
  });

  it('accepts an IPv6 address and text/plain', async () => {
    stubFetch(async () => rdp(FILE, 'text/plain; charset=utf-8'));
    expect((await connectRdpFile(CONNECT, '2001:db8::7')).ok).toBe(true);
  });

  it.each(['', 'not-an-ip', '203.0.113.7, 10.0.0.1', '203.0.113.7\r\nX-Evil: 1', '203.0.113.7:3389'])(
    'refuses the client address %j before any request is made',
    async (ip) => {
      const fetchMock = stubFetch(async () => rdp());
      expect(await connectRdpFile(CONNECT, ip)).toEqual({ ok: false, kind: 'rejected' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('reports an unreachable gateway and a timeout', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await connectRdpFile(CONNECT, '203.0.113.7')).toEqual({ ok: false, kind: 'unreachable' });
    stubFetch(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(await connectRdpFile(CONNECT, '203.0.113.7')).toEqual({ ok: false, kind: 'timeout' });
  });

  it.each([401, 403, 404, 500, 302])('treats HTTP %i as rejected', async (status) => {
    stubFetch(async () => new Response('nope', { status }));
    expect(await connectRdpFile(CONNECT, '203.0.113.7')).toEqual({ ok: false, kind: 'rejected' });
  });

  it.each([
    ['a JSON content type', () => rdp(FILE, 'application/json')],
    ['an HTML content type', () => rdp(FILE, 'text/html')],
    ['an empty content type', () => rdp(FILE, '')],
    ['an empty body', () => rdp('')],
    ['a body over the cap', () => rdp('x'.repeat(RDP_FILE_MAX_BYTES + 1))],
  ])('treats %s as a bad response', async (_label, make) => {
    stubFetch(async () => make());
    expect(await connectRdpFile(CONNECT, '203.0.113.7')).toEqual({ ok: false, kind: 'bad_response' });
  });

  it('never leaks the secret, the user or the body in a failure', async () => {
    stubFetch(async () => new Response(`${CONNECT.connectSecret} ${FILE}`, { status: 500 }));
    const result = await connectRdpFile(CONNECT, '203.0.113.7');
    const text = JSON.stringify(result);
    expect(text).not.toContain(CONNECT.connectSecret);
    expect(text).not.toContain('gatewayhostname');
  });
});
