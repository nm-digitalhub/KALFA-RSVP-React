// @vitest-environment node
import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WhatsAppAPI } from 'whatsapp-api-js';
import { Text } from 'whatsapp-api-js/messages';

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

import { activeNetworkGuard, installNetworkGuard, type NetworkGuard } from './local-integration';

// Regression tests for the integration suite's egress guard, run against the real
// clients the code under test uses: global fetch (supabase-js, whatsapp-api-js),
// node:http/https, net, tls, pg, and Node's built-in WebSocket (undici).
//
// Proof of "blocked" is not only the rejection: a local TCP server on a DISALLOWED
// port counts accepted connections and must stay at 0. External provider hosts are
// rejected by the guard itself (guard error, not DNS/connect error).

function countingServer() {
  const server = http.createServer((_req, res) => res.end('ok'));
  let connections = 0;
  server.on('connection', () => {
    connections++;
  });
  return { server, count: () => connections };
}

const allowedSrv = countingServer();
const deniedSrv = countingServer();
let allowedPort = 0;
let deniedPort = 0;
let guard: NetworkGuard;
let previous: NetworkGuard | null = null;

const settle = <T>(p: Promise<T>) => p.then(() => 'resolved', (e: Error) => e.message);
const viaSocketError = (s: net.Socket) =>
  new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('error', reject);
  });

beforeAll(async () => {
  allowedSrv.server.listen(0, '127.0.0.1');
  deniedSrv.server.listen(0, '127.0.0.1');
  await Promise.all([once(allowedSrv.server, 'listening'), once(deniedSrv.server, 'listening')]);
  allowedPort = (allowedSrv.server.address() as net.AddressInfo).port;
  deniedPort = (deniedSrv.server.address() as net.AddressInfo).port;
  // Under the integration config the setup file already installed the suite guard;
  // swap it for one scoped to this file's ports, and put it back afterwards.
  previous = activeNetworkGuard();
  previous?.restore();
  guard = installNetworkGuard([allowedPort]);
});

afterEach(() => {
  guard.drain();
});

afterAll(async () => {
  if (activeNetworkGuard() === guard) guard.restore();
  if (previous) installNetworkGuard(previous.allowedPorts);
  allowedSrv.server.closeAllConnections();
  deniedSrv.server.closeAllConnections();
  await Promise.all([new Promise((r) => allowedSrv.server.close(r)), new Promise((r) => deniedSrv.server.close(r))]);
});

describe('network guard — allowed path still works', () => {
  it('lets fetch and node:http reach loopback on an allowed port', async () => {
    expect(await (await fetch(`http://127.0.0.1:${allowedPort}/`)).text()).toBe('ok');
    const body = await new Promise<string>((resolve, reject) =>
      http.get(`http://localhost:${allowedPort}/`, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      }).on('error', reject),
    );
    expect(body).toBe('ok');
    expect(guard.blocked).toEqual([]);
  });
});

describe('network guard — every client is stopped before reaching a disallowed port', () => {
  const d = () => `127.0.0.1:${deniedPort}`;
  it.each<[string, () => Promise<unknown>]>([
    ['global fetch', () => fetch(`http://${d()}/`)],
    ['node:http', () => new Promise((res, rej) => http.get(`http://${d()}/`, res).on('error', rej))],
    ['node:https', () => new Promise((res, rej) => https.get(`https://${d()}/`, res).on('error', rej))],
    ['net.connect', () => viaSocketError(net.connect(deniedPort, '127.0.0.1'))],
    ['net.createConnection (options)', () => viaSocketError(net.createConnection({ port: deniedPort, host: 'localhost' }))],
    ['tls.connect', () => viaSocketError(tls.connect({ port: deniedPort, host: '127.0.0.1', rejectUnauthorized: false }))],
    ['pg.Client', () => new pg.Client({ host: '127.0.0.1', port: deniedPort, user: 'x', database: 'x' }).connect()],
    [
      'WebSocket (Node built-in, undici)',
      () =>
        new Promise((res, rej) => {
          const ws = new WebSocket(`ws://${d()}/`);
          ws.onopen = res;
          ws.onerror = () => rej(new Error('ws error'));
        }),
    ],
  ])('%s', async (_name, attempt) => {
    const before = deniedSrv.count();
    expect(await settle(attempt())).not.toBe('resolved');
    await new Promise((r) => setTimeout(r, 50));
    expect(deniedSrv.count()).toBe(before);
    expect(guard.blocked.length).toBeGreaterThan(0);
  });

  it('refuses a non-loopback host even on an allowed port, and unix sockets', async () => {
    expect(await settle(viaSocketError(net.connect(allowedPort, '10.255.255.1')))).toMatch(/network guard/);
    expect(await settle(viaSocketError(net.connect('/var/run/docker.sock')))).toMatch(/network guard/);
    expect(guard.blocked).toEqual([`socket 10.255.255.1:${allowedPort}`, 'socket unix:/var/run/docker.sock']);
  });
});

describe('network guard — the provider clients the code under test uses', () => {
  it('whatsapp-api-js sendMessage never reaches graph.facebook.com', async () => {
    const api = new WhatsAppAPI({ token: 'not-a-token', secure: false, v: GRAPH_API_VERSION });
    expect(await settle(api.sendMessage('100000000000000', '972500000000', new Text('probe')))).toMatch(/network guard/);
    expect(guard.blocked).toContain('fetch https://graph.facebook.com');
  });

  it('supabase-js against a hosted project never leaves the machine', async () => {
    // retry:false — postgrest-js otherwise retries a GET after a network error with
    // backoff (each retry is blocked too; it only makes the test slow).
    const sb = createClient('https://abcdefghijklmnopqrst.supabase.co', 'not-a-key', {
      auth: { persistSession: false },
      db: { retry: false },
    });
    const { error } = await sb.from('events').select('id').limit(1);
    expect(error?.message).toMatch(/network guard/);
    expect(guard.blocked).toContain('fetch https://abcdefghijklmnopqrst.supabase.co');
  });

  it('a Slack webhook over node:https is refused by the socket layer', async () => {
    const r = await settle(
      new Promise((res, rej) => https.get('https://hooks.slack.com/services/T000/B000/XXX', res).on('error', rej)),
    );
    expect(r).toMatch(/network guard/);
    expect(guard.blocked).toContain('socket hooks.slack.com:443');
  });
});

describe('network guard — lifecycle', () => {
  it('refuses a second install while one is active', () => {
    expect(() => installNetworkGuard([1])).toThrow(/already installed/);
  });

  it('restore() really removes the block (so the tests above prove the guard, not the environment)', async () => {
    guard.restore();
    try {
      const before = deniedSrv.count();
      expect(await (await fetch(`http://127.0.0.1:${deniedPort}/`)).text()).toBe('ok');
      expect(deniedSrv.count()).toBe(before + 1);
    } finally {
      guard = installNetworkGuard([allowedPort]);
    }
  });
});
