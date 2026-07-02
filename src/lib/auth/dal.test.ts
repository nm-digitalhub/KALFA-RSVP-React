import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

// requireAdmin() is the single gate in front of ~35 admin call sites. A wrong
// boolean or missing await here is a silent privilege escalation — every
// case below exists to pin the exact contract, not just "it redirects".

vi.mock('server-only', () => ({}));

// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it
// with the same digest shape Next itself produces so assertions on the target
// path are meaningful (see node_modules/next/dist/client/components/redirect.js).
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    redirect: vi.fn((url: string) => {
      throw Object.assign(new Error('NEXT_REDIRECT'), {
        digest: `NEXT_REDIRECT;replace;${url};307;`,
      });
    }),
  };
});

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdmin, requireAdmin } from './dal';

function fakeUser(id = 'user-1'): User {
  return { id } as unknown as User;
}

type HasRoleResult = { data: boolean | null; error: unknown };

// Wires createClient() to a double whose auth.getUser() resolves `user` and
// whose rpc() resolves/rejects per `rpcImpl`.
function mockClient(
  user: User | null,
  rpcImpl: (...args: unknown[]) => Promise<HasRoleResult>,
) {
  const rpc = vi.fn(rpcImpl);
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    rpc,
  };
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { client, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAdmin', () => {
  it('returns the User when has_role resolves true', async () => {
    const user = fakeUser();
    const { rpc } = mockClient(user, async () => ({ data: true, error: null }));

    await expect(requireAdmin()).resolves.toEqual(user);
    expect(rpc).toHaveBeenCalledWith('has_role', {
      _role: 'admin',
      _user_id: user.id,
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /app when has_role resolves false', async () => {
    const user = fakeUser();
    mockClient(user, async () => ({ data: false, error: null }));

    await expect(requireAdmin()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    expect(redirect).toHaveBeenCalledWith('/app');
  });

  it('redirects to /auth/login (not /app) for an anonymous user, and never calls has_role', async () => {
    const { rpc } = mockClient(null, async () => ({ data: true, error: null }));

    await expect(requireAdmin()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
    });
    expect(redirect).toHaveBeenCalledWith('/auth/login');
    expect(redirect).not.toHaveBeenCalledWith('/app');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates non-redirect errors as-is when the RPC call rejects', async () => {
    const user = fakeUser();
    const boom = new Error('network down');
    mockClient(user, async () => {
      throw boom;
    });

    await expect(requireAdmin()).rejects.toBe(boom);
    expect(redirect).not.toHaveBeenCalled();
  });

  // REGRESSION GUARD: this is the test that must fail if requireAdmin()'s
  // condition is ever inverted (e.g. `if (await isAdmin())` instead of
  // `if (!(await isAdmin()))`). A non-admin user must never receive a User
  // back from requireAdmin() — it must redirect, full stop.
  it('never resolves with a User when has_role resolves false (inverted-condition guard)', async () => {
    const user = fakeUser('non-admin-user');
    mockClient(user, async () => ({ data: false, error: null }));

    let sawFulfillment = false;
    await requireAdmin().then(
      () => {
        sawFulfillment = true;
      },
      () => {
        // expected path: rejection via redirect()
      },
    );

    expect(sawFulfillment).toBe(false);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/app');
  });
});

describe('isAdmin', () => {
  it('returns false for anonymous users without calling the RPC', async () => {
    const { rpc } = mockClient(null, async () => ({ data: true, error: null }));

    await expect(isAdmin()).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
