import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

// The server gate for admin actions (openspec/changes/pilot-casl-package-permissions, design D2/D3).
// It must decide exactly as requirePlatformPermission does — same RPC, same redirects — with the key
// taken from the action map instead of typed at the call site.

vi.mock('server-only', () => ({}));

// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it with the same digest
// shape so the target path can be asserted (see dal.test.ts).
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    redirect: vi.fn((url: string) => {
      throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url};307;` });
    }),
  };
});

vi.mock('@/lib/auth/dal', () => ({
  hasPlatformPermission: vi.fn(),
  requirePlatformPermission: vi.fn(),
  requireUser: vi.fn(),
}));

import { hasPlatformPermission, requirePlatformPermission, requireUser } from '@/lib/auth/dal';
import { getPlatformAbility, requireAnyPlatformAction, requirePlatformAction } from './platform-ability';

const USER = { id: 'staff-1' } as unknown as User;

function redirectSignal(url: string) {
  return Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url};307;` });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(USER);
  vi.mocked(requirePlatformPermission).mockResolvedValue(USER);
});

describe('requirePlatformAction', () => {
  it('enforces the mapped key through requirePlatformPermission and returns its user', async () => {
    await expect(requirePlatformAction('update', 'Package')).resolves.toBe(USER);
    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
  });

  it('lets the refusal of requirePlatformPermission propagate unchanged', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValue(redirectSignal('/access-denied'));
    await expect(requirePlatformAction('delete', 'Package')).rejects.toMatchObject({
      digest: expect.stringContaining('/access-denied'),
    });
  });
});

describe('requireAnyPlatformAction', () => {
  it('makes a single requirePlatformPermission call when its pairs share a key', async () => {
    await expect(
      requireAnyPlatformAction([
        { action: 'create', subject: 'Package' },
        { action: 'update', subject: 'Package' },
      ]),
    ).resolves.toBe(USER);
    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
    expect(hasPlatformPermission).not.toHaveBeenCalled();
  });

  it('sends a signed-out caller to the login redirect, as requirePlatformPermission does', async () => {
    vi.mocked(requireUser).mockRejectedValue(redirectSignal('/auth/login'));
    await expect(requireAnyPlatformAction([{ action: 'update', subject: 'Package' }])).rejects.toMatchObject({
      digest: expect.stringContaining('/auth/login'),
    });
    expect(requirePlatformPermission).not.toHaveBeenCalled();
  });

  // The real map binds these two pairs to different keys (manage_billing, campaigns.runstate).
  describe('with pairs bound to different keys', () => {
    const PAIRS = [
      { action: 'update', subject: 'Package' },
      { action: 'runstate', subject: 'Campaign' },
    ] as const;

    it('passes when any one of the keys is held, and returns the user', async () => {
      vi.mocked(hasPlatformPermission).mockImplementation(async (key) => key === 'campaigns.runstate');
      await expect(requireAnyPlatformAction([...PAIRS])).resolves.toBe(USER);
      expect(hasPlatformPermission).toHaveBeenCalledTimes(2);
    });

    it('redirects to /access-denied when none is held', async () => {
      vi.mocked(hasPlatformPermission).mockResolvedValue(false);
      await expect(requireAnyPlatformAction([...PAIRS])).rejects.toMatchObject({
        digest: expect.stringContaining('/access-denied'),
      });
    });
  });

  it('redirects to /access-denied when given no pair at all', async () => {
    await expect(requireAnyPlatformAction([])).rejects.toMatchObject({
      digest: expect.stringContaining('/access-denied'),
    });
  });
});

describe('getPlatformAbility', () => {
  it('asks the database once per distinct key of the map', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    await getPlatformAbility();
    // manage_billing (every Package action) and campaigns.runstate (Campaign.runstate): one call each, never per action.
    expect(hasPlatformPermission).toHaveBeenCalledTimes(2);
    expect(hasPlatformPermission).toHaveBeenCalledWith('manage_billing');
    expect(hasPlatformPermission).toHaveBeenCalledWith('campaigns.runstate');
  });

  it('builds an ability that allows what the database grants', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    const ability = await getPlatformAbility();
    expect(ability.can('read', 'Package')).toBe(true);
    expect(ability.can('delete', 'Package')).toBe(true);
  });

  it('builds an ability that refuses what the database does not grant', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(false);
    const ability = await getPlatformAbility();
    expect(ability.can('read', 'Package')).toBe(false);
    expect(ability.rules).toEqual([]);
  });
});
