import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/events', () => ({ getEventsPipelineSummary: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { getEventsPipelineSummary } from '@/lib/owner-agent/cores/events';
import { POST } from './route';

const SECRET = 'a'.repeat(64);
const originalEnv = {
  secret: process.env.KALFA_MCP_SECRET_TOKEN,
  permissions: process.env.KALFA_MCP_PERMISSIONS,
  origins: process.env.KALFA_MCP_ALLOWED_ORIGINS,
};

function request(
  body: unknown,
  options: { token?: string; origin?: string } = {},
): NextRequest {
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KALFA_MCP_SECRET_TOKEN = SECRET;
  process.env.KALFA_MCP_PERMISSIONS = 'view_events';
  process.env.KALFA_MCP_ALLOWED_ORIGINS = '';
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    const envName =
      key === 'secret'
        ? 'KALFA_MCP_SECRET_TOKEN'
        : key === 'permissions'
          ? 'KALFA_MCP_PERMISSIONS'
          : 'KALFA_MCP_ALLOWED_ORIGINS';
    if (value === undefined) delete process.env[envName];
    else process.env[envName] = value;
  }
});

describe('/api/mcp', () => {
  it('rejects a missing or incorrect bearer token', async () => {
    expect((await POST(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))).status).toBe(401);
    expect(
      (await POST(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { token: 'wrong' }))).status,
    ).toBe(401);
  });

  it('allows originless MCP clients and rejects browser origins unless allowlisted', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    expect((await POST(request(body, { token: SECRET }))).status).toBe(200);
    expect((await POST(request(body, { token: SECRET, origin: 'https://evil.test' }))).status).toBe(403);

    process.env.KALFA_MCP_ALLOWED_ORIGINS = 'https://claude.example';
    expect(
      (await POST(request(body, { token: SECRET, origin: 'https://claude.example' }))).status,
    ).toBe(200);
  });

  it('lists only tools unlocked by server-side permissions', async () => {
    const response = await POST(
      request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { token: SECRET }),
    );
    const rpc = await rpcResult(response);
    const result = rpc.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((tool) => tool.name).sort()).toEqual(['events_pipeline', 'rsvp_totals']);
  });

  it('runs a real permitted tool and rejects invalid input before its core', async () => {
    vi.mocked(createAdminClient).mockReturnValue({ marker: 'admin' } as never);
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

    const valid = await rpcResult(
      await POST(
        request(
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'events_pipeline', arguments: { range: '7d' } },
          },
          { token: SECRET },
        ),
      ),
    );
    expect(valid.error).toBeUndefined();
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
          { token: SECRET },
        ),
      ),
    );
    const result = invalid.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('{"error":"invalid_input"}');
    expect(vi.mocked(getEventsPipelineSummary)).not.toHaveBeenCalled();
  });
});
