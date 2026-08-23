import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/health', () => {
  it('returns 200 with exactly { ok: true } and no-store caching', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // EXACTLY this body — anything more would leak data from an
    // unauthenticated liveness endpoint.
    expect(await res.json()).toEqual({ ok: true });
  });
});
