import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

// requireAdmin() is the deprecated has_role('admin') gate (no non-test call
// sites remain; isAdmin(), which it delegates to, still gates the close-charge
// route). A wrong boolean or missing await here is a silent privilege
// escalation — every case below exists to pin the exact contract, not just
// "it redirects".

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
import {
  isAdmin, requireAdmin, isOrgOwner, requireOrgOwner,
  requireUser, requirePlatformStaff, requirePlatformOwner, requirePlatformPermission,
} from './dal';

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

describe.each([
  { name: 'requirePlatformStaff', guard: requirePlatformStaff, rpcArgs: ['is_platform_staff'] },
  { name: 'requirePlatformOwner', guard: requirePlatformOwner, rpcArgs: ['is_platform_owner'] },
  {
    name: 'requirePlatformPermission',
    guard: () => requirePlatformPermission('manage_staff'),
    rpcArgs: ['has_platform_permission', { _key: 'manage_staff' }],
  },
])('$name', ({ guard, rpcArgs }) => {
  it('returns the authenticated user when access is allowed', async () => {
    const user = fakeUser();
    const { rpc } = mockClient(user, async () => ({ data: true, error: null }));
    await expect(guard()).resolves.toEqual(user);
    expect(rpc).toHaveBeenCalledWith(...rpcArgs);
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    { data: false, error: null },
    { data: null, error: null },
    { data: true, error: { message: 'RPC failed' } },
  ])('redirects denied or failed checks to /access-denied: %j', async (result) => {
    mockClient(fakeUser(), async () => result);
    await expect(guard()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/access-denied;307;',
    });
  });

  it('sends anonymous users to login without checking permissions', async () => {
    const { rpc } = mockClient(null, async () => ({ data: true, error: null }));
    await expect(guard()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates unexpected RPC exceptions', async () => {
    const error = new Error('network unavailable');
    mockClient(fakeUser(), async () => { throw error; });
    await expect(guard()).rejects.toBe(error);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('requireUser for the access-denied page', () => {
  it('accepts an authenticated user without platform permissions', async () => {
    const user = fakeUser();
    const { rpc } = mockClient(user, async () => ({ data: false, error: null }));
    await expect(requireUser()).resolves.toEqual(user);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('redirects anonymous visitors to login', async () => {
    mockClient(null, async () => ({ data: false, error: null }));
    await expect(requireUser()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
    });
  });
});

it('evaluates each named permission independently for the same staff user', async () => {
  const user = fakeUser();
  mockClient(user, async (_name, args) => ({
    data: (args as { _key: string })._key === 'manage_billing',
    error: null,
  }));
  await expect(requirePlatformPermission('manage_staff')).rejects.toMatchObject({
    digest: 'NEXT_REDIRECT;replace;/access-denied;307;',
  });
  await expect(requirePlatformPermission('manage_billing')).resolves.toEqual(user);
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

// requireOrgOwner() gates the org-scoped RBAC matrix screen — mirrors
// requirePlatformOwner()'s contract (dal.ts) one layer down: the org
// OWNER, not a KALFA platform admin. Redirects to /app/team (not /app) on
// failure, since that is the org-scoped surface a non-owner should land on.
describe('requireOrgOwner', () => {
  const orgId = 'org-1';

  it('returns the User when is_org_owner resolves true', async () => {
    const user = fakeUser();
    const { rpc } = mockClient(user, async () => ({ data: true, error: null }));

    await expect(requireOrgOwner(orgId)).resolves.toEqual(user);
    expect(rpc).toHaveBeenCalledWith('is_org_owner', { _org_id: orgId });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /app/team when is_org_owner resolves false', async () => {
    const user = fakeUser();
    mockClient(user, async () => ({ data: false, error: null }));

    await expect(requireOrgOwner(orgId)).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/app/team;307;',
    });
    expect(redirect).toHaveBeenCalledWith('/app/team');
  });

  it('redirects to /auth/login (not /app/team) for an anonymous user, and never calls the RPC', async () => {
    const { rpc } = mockClient(null, async () => ({ data: true, error: null }));

    await expect(requireOrgOwner(orgId)).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
    });
    expect(redirect).toHaveBeenCalledWith('/auth/login');
    expect(redirect).not.toHaveBeenCalledWith('/app/team');
    expect(rpc).not.toHaveBeenCalled();
  });

  // REGRESSION GUARD: mirrors the requireAdmin inverted-condition guard above.
  // A non-owner member must never receive a User back — it must redirect.
  it('never resolves with a User when is_org_owner resolves false (inverted-condition guard)', async () => {
    const user = fakeUser('non-owner-member');
    mockClient(user, async () => ({ data: false, error: null }));

    let sawFulfillment = false;
    await requireOrgOwner(orgId).then(
      () => {
        sawFulfillment = true;
      },
      () => {
        // expected path: rejection via redirect()
      },
    );

    expect(sawFulfillment).toBe(false);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/app/team');
  });
});

describe('isOrgOwner', () => {
  const orgId = 'org-1';

  it('returns false for anonymous users without calling the RPC', async () => {
    const { rpc } = mockClient(null, async () => ({ data: true, error: null }));

    await expect(isOrgOwner(orgId)).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('returns false (not throw) when the RPC errors', async () => {
    const user = fakeUser();
    mockClient(user, async () => ({ data: null, error: { message: 'db down' } }));

    await expect(isOrgOwner(orgId)).resolves.toBe(false);
  });
});
