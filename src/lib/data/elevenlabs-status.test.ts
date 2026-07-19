import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { keyRowMock } = vi.hoisted(() => ({ keyRowMock: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: keyRowMock }) }),
    }),
  }),
}));

import { getElevenLabsFleetStatus, readAgentFleet } from './elevenlabs-status';

afterEach(() => vi.clearAllMocks());

describe('readAgentFleet (IaC registry, no API)', () => {
  it('reads the real agents.json + agent_configs from the repo root', () => {
    const fleet = readAgentFleet();
    expect(fleet.length).toBeGreaterThanOrEqual(1);
    // The shipped agent id from agents.json.
    expect(fleet[0].id).toMatch(/^agent_/);
    expect(typeof fleet[0].name).toBe('string');
  });
  it('fails safe to an empty fleet on a bad cwd', () => {
    expect(readAgentFleet('/nonexistent/path')).toEqual([]);
  });
});

describe('getElevenLabsFleetStatus', () => {
  it('is unconfigured (still lists the IaC fleet) when neither DB nor env has a key', async () => {
    const saved = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    keyRowMock.mockResolvedValue({ data: { elevenlabs_api_key: null }, error: null });
    const status = await getElevenLabsFleetStatus();
    expect(status.configured).toBe(false);
    expect(status.keySource).toBeNull();
    expect(status.quota).toBeNull();
    // Fleet names/ids still surface from IaC.
    expect(status.agents.length).toBeGreaterThanOrEqual(1);
    expect(status.agents.every((a) => a.status === 'error')).toBe(true);
    if (saved !== undefined) process.env.ELEVENLABS_API_KEY = saved;
  });

  it('falls back to the env ELEVENLABS_API_KEY when the DB column is empty (source=env)', async () => {
    const saved = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = 'xi-env-key';
    keyRowMock.mockResolvedValue({ data: { elevenlabs_api_key: null }, error: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>)['xi-api-key']).toBe('xi-env-key');
        if (url.includes('/v1/convai/agents/')) {
          return { ok: true, json: async () => ({ name: 'KALFA RSVP Preview' }) } as unknown as Response;
        }
        return { ok: false, json: async () => ({}) } as unknown as Response; // quota 401
      }),
    );
    const status = await getElevenLabsFleetStatus();
    expect(status.configured).toBe(true);
    expect(status.keySource).toBe('env');
    expect(status.agents[0].status).toBe('ok');
    expect(status.quota).toBeNull(); // scoped key → no quota (graceful)
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved;
  });

  it('marks agents ok / missing from the API and reads quota when a key is present', async () => {
    keyRowMock.mockResolvedValue({ data: { elevenlabs_api_key: 'xi-secret' }, error: null });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // The key must be sent as xi-api-key and NEVER logged/leaked in the URL.
      expect((init?.headers as Record<string, string>)['xi-api-key']).toBe('xi-secret');
      expect(url).not.toContain('xi-secret');
      if (url.includes('/v1/convai/agents/')) {
        return { ok: true, json: async () => ({ name: 'KALFA RSVP' }) } as unknown as Response;
      }
      if (url.includes('/v1/convai/conversations')) {
        return {
          ok: true,
          json: async () => ({
            conversations: [
              { start_time_unix_secs: 1_784_149_488 },
              { start_time_unix_secs: 1_784_000_000 },
            ],
            has_more: true,
          }),
        } as unknown as Response;
      }
      if (url.includes('/v1/user/subscription')) {
        return {
          ok: true,
          json: async () => ({ character_count: 1200, character_limit: 100000, tier: 'creator' }),
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await getElevenLabsFleetStatus();
    expect(status.configured).toBe(true);
    expect(status.agents[0].status).toBe('ok');
    expect(status.agents[0].name).toBe('KALFA RSVP');
    // Recent conversations summarized (count + more flag + latest timestamp).
    expect(status.agents[0].conversations).toEqual({
      count: 2,
      more: true,
      lastAt: new Date(1_784_149_488 * 1000).toISOString(),
    });
    expect(status.quota).toEqual({ characterCount: 1200, characterLimit: 100000, tier: 'creator' });
    vi.unstubAllGlobals();
  });

  it('marks an agent missing on a non-2xx from the API (fail-safe, no throw)', async () => {
    keyRowMock.mockResolvedValue({ data: { elevenlabs_api_key: 'xi-secret' }, error: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response),
    );
    const status = await getElevenLabsFleetStatus();
    expect(status.configured).toBe(true);
    expect(status.agents[0].status).toBe('missing');
    expect(status.quota).toBeNull();
    vi.unstubAllGlobals();
  });
});
