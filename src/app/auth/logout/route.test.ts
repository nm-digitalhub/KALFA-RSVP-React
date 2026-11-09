import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut } }),
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
});

describe('POST /auth/logout', () => {
  it('signs out THIS device with the library\'s local scope, then goes home (303)', async () => {
    const res = await POST();

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
  });

  it('a failed server-side revocation still ends at home: the local session was removed first', async () => {
    signOut.mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 0 } });

    const res = await POST();

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
  });
});
