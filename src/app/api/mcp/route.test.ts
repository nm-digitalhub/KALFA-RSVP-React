import { NextRequest } from 'next/server';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/events', () => ({ getEventsPipelineSummary: vi.fn() }));

// The production verifier fetches Supabase's JWKS; here it gets a local key set
// holding the test key, so tokens are signed and verified for real.
const jwks = vi.hoisted(() => ({ keys: [] as unknown[] }));
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: () => actual.createLocalJWKSet(jwks as { keys: JWK[] }),
  };
});

import { createAdminClient } from '@/lib/supabase/admin';
import { getEventsPipelineSummary } from '@/lib/owner-agent/cores/events';
import { GET as metadataGET } from '@/app/.well-known/oauth-protected-resource/api/mcp/route';
import { POST } from './route';

const SUPABASE_URL = 'https://proj.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const CLIENT_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = '6f1c2b8e-3d4a-4e5f-9a6b-7c8d9e0f1a2b';
const METADATA_URL = 'https://beta.kalfa.me/.well-known/oauth-protected-resource/api/mcp';

let signingKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  signingKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwks.keys = [{ ...jwk, alg: 'ES256', kid: 'test-key', use: 'sig' }];
  otherKey = (await generateKeyPair('ES256')).privateKey;
  // Sanity: the local set really resolves the key the tokens are signed with.
  createLocalJWKSet(jwks as { keys: JWK[] });
});

async function token(
  overrides: JWTPayload = {},
  opts: { key?: CryptoKey; exp?: string | number } = {},
): Promise<string> {
  return new SignJWT({
    sub: USER_ID,
    role: 'authenticated',
    client_id: CLIENT_ID,
    scope: 'email',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(opts.key ?? signingKey);
}

function request(body: unknown, options: { token?: string; origin?: string } = {}): NextRequest {
  const headers = new Headers({
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-06-18',
  });
  if (options.token !== undefined) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.origin !== undefined) headers.set('Origin', options.origin);
  return new NextRequest('https://beta.kalfa.me/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function rpcResult(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const data = text
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  if (!data) throw new Error(`missing_mcp_result:${text}`);
  return JSON.parse(data) as Record<string, unknown>;
}

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

// has_platform_permission_for_user, answered per key from `granted`.
function grant(granted: string[], opts: { fail?: boolean } = {}) {
  const rpc = vi.fn(async (_fn: string, args: { _user_id: string; _key: string }) =>
    opts.fail
      ? { data: null, error: { message: 'boom' } }
      : { data: args._user_id === USER_ID && granted.includes(args._key), error: null },
  );
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
  vi.stubEnv('KALFA_MCP_OAUTH_CLIENT_IDS', CLIENT_ID);
  vi.stubEnv('KALFA_MCP_ALLOWED_ORIGINS', '');
  grant(['view_events']);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/mcp — OAuth (Supabase Auth as Authorization Server)', () => {
  it('no token → 401 with WWW-Authenticate pointing at the protected resource metadata', async () => {
    const response = await POST(request(LIST));
    expect(response.status).toBe(401);
    const challenge = response.headers.get('WWW-Authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${METADATA_URL}"`);
  });

  it.each([
    ['a token signed by another key', () => token({}, { key: otherKey })],
    ['an expired token', () => token({}, { exp: Math.floor(Date.now() / 1000) - 60 })],
    ['a wrong issuer', async () => {
      return new SignJWT({ sub: USER_ID, role: 'authenticated', client_id: CLIENT_ID })
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setIssuer('https://other.supabase.co/auth/v1')
        .setAudience('authenticated')
        .setExpirationTime('1h')
        .sign(signingKey);
    }],
    ['a wrong audience', async () => {
      return new SignJWT({ sub: USER_ID, role: 'authenticated', client_id: CLIENT_ID })
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setIssuer(ISSUER)
        .setAudience('https://someone-else')
        .setExpirationTime('1h')
        .sign(signingKey);
    }],
    ['a plain session token (no client_id)', () => token({ client_id: undefined })],
    ['an OAuth client that was never registered', () => token({ client_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })],
    ['a non-uuid subject', () => token({ sub: 'not-a-user' })],
    ['garbage', async () => 'not.a.jwt'],
  ])('rejects %s with 401 and never resolves permissions', async (_label, make) => {
    const rpc = grant(['view_events']);
    const response = await POST(request(LIST, { token: await make() }));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('an empty client allowlist rejects every token (fail closed)', async () => {
    vi.stubEnv('KALFA_MCP_OAUTH_CLIENT_IDS', '');
    expect((await POST(request(LIST, { token: await token() }))).status).toBe(401);
  });

  it('a valid token for a user with no owner-agent permission (not staff) → 403', async () => {
    grant([]);
    const response = await POST(request(LIST, { token: await token() }));
    expect(response.status).toBe(403);
  });

  it('a permission lookup failure → 500, never a grant', async () => {
    grant(['view_events'], { fail: true });
    expect((await POST(request(LIST, { token: await token() }))).status).toBe(500);
  });

  it("lists only the tools the token's user is permitted, resolved from `sub`", async () => {
    const rpc = grant(['view_events']);
    const rpcBody = await rpcResult(await POST(request(LIST, { token: await token() })));
    const result = rpcBody.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((tool) => tool.name).sort()).toEqual(['events_pipeline', 'rsvp_totals']);
    expect(rpc).toHaveBeenCalledWith('has_platform_permission_for_user', { _user_id: USER_ID, _key: 'view_events' });
  });

  it("advertises the site's logo as serverInfo.icons on initialize", async () => {
    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
    };
    const rpcBody = await rpcResult(await POST(request(initialize, { token: await token() })));
    const { serverInfo } = rpcBody.result as { serverInfo: { title?: string; icons?: unknown } };
    expect(serverInfo.title).toBe('KALFA');
    expect(serverInfo.icons).toEqual([
      { src: 'https://beta.kalfa.me/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
      { src: 'https://beta.kalfa.me/apple-icon.png', mimeType: 'image/png', sizes: ['180x180'] },
    ]);
  });

  it('allows originless MCP clients and rejects browser origins unless allowlisted', async () => {
    const valid = await token();
    expect((await POST(request(LIST, { token: valid }))).status).toBe(200);
    expect((await POST(request(LIST, { token: valid, origin: 'https://evil.test' }))).status).toBe(403);

    vi.stubEnv('KALFA_MCP_ALLOWED_ORIGINS', 'https://claude.example');
    expect((await POST(request(LIST, { token: valid, origin: 'https://claude.example' }))).status).toBe(200);
  });

  it('runs a permitted tool and rejects invalid input before its core', async () => {
    vi.mocked(getEventsPipelineSummary).mockResolvedValue({
      byStatus: { draft: 1, active: 2, closed: 3 },
      activeByType: {
        wedding: 1,
        bar_mitzvah: 0,
        bat_mitzvah: 0,
        brit: 0,
        britah: 0,
        henna: 0,
        engagement: 0,
        birthday: 1,
        other: 0,
      },
      activePastDay: 1,
      activeWithoutDate: 0,
      activeUpcomingInWindow: 1,
      createdInRange: 2,
    });
    const valid = await token();

    const ok = await rpcResult(
      await POST(
        request(
          { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'events_pipeline', arguments: { range: '7d' } } },
          { token: valid },
        ),
      ),
    );
    expect(ok.error).toBeUndefined();
    expect(vi.mocked(getEventsPipelineSummary)).toHaveBeenCalledOnce();

    vi.mocked(getEventsPipelineSummary).mockClear();
    const invalid = await rpcResult(
      await POST(
        request(
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'events_pipeline', arguments: { range: '7d', eventId: 'private' } },
          },
          { token: valid },
        ),
      ),
    );
    const result = invalid.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('{"error":"invalid_input"}');
    expect(vi.mocked(getEventsPipelineSummary)).not.toHaveBeenCalled();
  });

  it('a tool outside the user’s permissions is not callable', async () => {
    const rpcBody = await rpcResult(
      await POST(
        request(
          { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'billing_summary', arguments: { range: '7d' } } },
          { token: await token() },
        ),
      ),
    );
    const result = rpcBody.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('{"error":"unknown_tool"}');
  });
});

describe('/.well-known/oauth-protected-resource/api/mcp', () => {
  it('names this MCP server as the resource and Supabase Auth as its authorization server', async () => {
    const response = await metadataGET(new Request(METADATA_URL));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe('https://beta.kalfa.me/api/mcp');
    expect(body.authorization_servers).toEqual([ISSUER]);
  });
});
