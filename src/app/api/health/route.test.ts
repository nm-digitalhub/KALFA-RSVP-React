import { describe, expect, it, vi } from 'vitest';

// connection() needs a request; a unit test has none, so it resolves at once. Everything else of next/server is real.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  connection: vi.fn(async () => undefined),
}));

import { GET } from './route';

describe('GET /api/health', () => {
  it('returns 200 with exactly { ok: true } and no-store caching', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // EXACTLY this body — anything more would leak data from an
    // unauthenticated liveness endpoint.
    expect(await res.json()).toEqual({ ok: true });
  });
});
