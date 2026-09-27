import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

import { createOwnerAgentWhatsApp, type OwnerAgentWhatsApp } from './adapter';
import { downloadOwnerAgentMedia, normalizeMime, type DownloadOwnerAgentMediaInput } from './media';

const PHONE_ID = '111122223333';
const OTHER_PHONE_ID = '444455556666';
const TOKEN = 'real-token-abc';
const MEDIA_ID = '1234567890123456';
const CDN_URL = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1';

const SENTINELS = {
  WHATSAPP_ACCESS_TOKEN: 'SENTINEL_ENV_TOKEN',
  WHATSAPP_PHONE_NUMBER_ID: '999999999999',
  WHATSAPP_APP_SECRET: 'SENTINEL_ENV_SECRET',
  WHATSAPP_API_URL: 'https://sentinel.invalid',
} as const;

interface Captured {
  url: string;
  headers: Record<string, string>;
}

let fetchCalls: Captured[];
let transportCalls: Captured[];
let metaBody: { status: number; value: unknown };
let payload: Buffer;
let wa: OwnerAgentWhatsApp;
const savedEnv: Record<string, string | undefined> = {};

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function okMeta(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    value: {
      messaging_product: 'whatsapp',
      id: MEDIA_ID,
      url: CDN_URL,
      mime_type: 'image/jpeg',
      sha256: 'abc',
      file_size: '4',
      ...overrides,
    },
  };
}

// The adapter's binary fetch goes through node https, so the test injects the
// transport seam and answers with a real IncomingMessage.
const transport: NonNullable<DownloadOwnerAgentMediaInput['transport']> = async (url, _signal, headers) => {
  transportCalls.push({ url: url.href, headers: { ...headers } });
  const res = new IncomingMessage(new Socket());
  res.statusCode = 200;
  res.headers = { 'content-length': String(payload.byteLength) };
  res.push(payload);
  res.push(null);
  return res;
};

function input(overrides: Partial<DownloadOwnerAgentMediaInput> = {}): DownloadOwnerAgentMediaInput {
  return {
    mediaId: MEDIA_ID,
    phoneNumberId: PHONE_ID,
    maxBytes: 5 * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'application/pdf', 'audio/ogg'],
    transport,
    ...overrides,
  };
}

beforeEach(() => {
  for (const [k, v] of Object.entries(SENTINELS)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  fetchCalls = [];
  transportCalls = [];
  payload = Buffer.from([1, 2, 3, 4]);
  metaBody = okMeta();
  vi.stubGlobal('fetch', async (req: string | URL | Request, init?: RequestInit) => {
    const url = typeof req === 'string' ? req : req instanceof URL ? req.href : req.url;
    fetchCalls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return json(metaBody.status, metaBody.value);
  });
  wa = createOwnerAgentWhatsApp({ accessToken: TOKEN, appSecret: 'real-secret', phoneNumberId: PHONE_ID }, { logSink: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('downloadOwnerAgentMedia', () => {
  it('scoped lookup first, then the adapter download; returns the bytes', async () => {
    const out = await downloadOwnerAgentMedia(wa, input({ filename: 'a.jpg' }));
    expect(out).toEqual({ kind: 'ok', bytes: payload, mime: 'image/jpeg', filename: 'a.jpg' });
    expect(fetchCalls[0]?.url).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/${MEDIA_ID}?phone_number_id=${PHONE_ID}`);
    expect(transportCalls).toHaveLength(1);
    expect(transportCalls[0]?.url).toBe(CDN_URL);
  });

  it('WHATSAPP_* sentinels never reach a URL or header', async () => {
    await downloadOwnerAgentMedia(wa, input());
    const all = [...fetchCalls, ...transportCalls];
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const c of fetchCalls) expect(c.url.startsWith(`https://graph.facebook.com/${GRAPH_API_VERSION}/`)).toBe(true);
    for (const c of all) {
      expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
      const blob = JSON.stringify(c);
      for (const s of Object.values(SENTINELS)) expect(blob).not.toContain(s);
    }
  });

  it('media of another number (Meta refuses the scoped lookup) → failed before any download', async () => {
    metaBody = { status: 400, value: { error: { code: 100, message: 'Unsupported get request' } } };
    expect(await downloadOwnerAgentMedia(wa, input())).toEqual({ kind: 'failed', code: 'media_unavailable' });
    expect(fetchCalls).toHaveLength(1);
    expect(transportCalls).toHaveLength(0);
  });

  it('a phone_number_id other than the adapter number → failed with zero requests', async () => {
    expect(await downloadOwnerAgentMedia(wa, input({ phoneNumberId: OTHER_PHONE_ID }))).toEqual({
      kind: 'failed',
      code: 'media_wrong_number',
    });
    expect(fetchCalls).toHaveLength(0);
  });

  it('reported file_size above maxBytes → media_too_large before any download', async () => {
    metaBody = okMeta({ file_size: String(5 * 1024 * 1024 + 1) });
    expect(await downloadOwnerAgentMedia(wa, input())).toEqual({ kind: 'failed', code: 'media_too_large' });
    expect(fetchCalls).toHaveLength(1);
    expect(transportCalls).toHaveLength(0);
  });

  it('a lying file_size is caught on the received bytes', async () => {
    metaBody = okMeta({ file_size: '1' });
    payload = Buffer.alloc(64);
    expect(await downloadOwnerAgentMedia(wa, input({ maxBytes: 16 }))).toEqual({
      kind: 'failed',
      code: 'media_too_large',
    });
  });

  it('mime outside the allowlist → media_unsupported before any download', async () => {
    metaBody = okMeta({ mime_type: 'video/mp4' });
    expect(await downloadOwnerAgentMedia(wa, input())).toEqual({ kind: 'failed', code: 'media_unsupported' });
    expect(transportCalls).toHaveLength(0);
  });

  it('voice notes carry codec parameters and still match their base type', async () => {
    metaBody = okMeta({ mime_type: 'audio/ogg; codecs=opus' });
    const out = await downloadOwnerAgentMedia(wa, input());
    expect(out).toMatchObject({ kind: 'ok', mime: 'audio/ogg' });
    expect(normalizeMime(' Audio/OGG ; codecs=opus')).toBe('audio/ogg');
  });

  it('a malformed media id never reaches the network', async () => {
    for (const mediaId of ['', '12a', '../me', '1'.repeat(33), '123?x=1']) {
      expect(await downloadOwnerAgentMedia(wa, input({ mediaId }))).toEqual({ kind: 'failed', code: 'media_invalid_id' });
    }
    expect(fetchCalls).toHaveLength(0);
  });

  it('a failing lookup → media_lookup_failed; a failing download → media_download_failed', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    expect(await downloadOwnerAgentMedia(wa, input())).toEqual({ kind: 'failed', code: 'media_lookup_failed' });

    vi.stubGlobal('fetch', async () => json(200, okMeta().value));
    const broken: NonNullable<DownloadOwnerAgentMediaInput['transport']> = async () => {
      throw new Error('socket hang up');
    };
    const logged: string[] = [];
    const loud = createOwnerAgentWhatsApp(
      { accessToken: TOKEN, appSecret: 'real-secret', phoneNumberId: PHONE_ID },
      { logSink: (code) => logged.push(code) },
    );
    expect(await downloadOwnerAgentMedia(loud, input({ transport: broken }))).toEqual({
      kind: 'failed',
      code: 'media_download_failed',
    });
    // The adapter logs `{ mediaId }` here (dist:1328); only the code gets out.
    expect(logged).toEqual(['wa_media_download_failed']);
  });

  it('a download that never answers is cut by the deadline', async () => {
    const hung: NonNullable<DownloadOwnerAgentMediaInput['transport']> = () => new Promise<IncomingMessage>(() => {});
    expect(await downloadOwnerAgentMedia(wa, input({ transport: hung, downloadTimeoutMs: 20 }))).toEqual({
      kind: 'failed',
      code: 'media_download_failed',
    });
  });
});
