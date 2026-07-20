import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { recordStaffAccess } from './access-log';
import { getUserDetail, setPlatformAdmin, setUserSuspended } from './users';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('./access-log', () => ({ recordStaffAccess: vi.fn() }));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

// Wire createAdminClient() to a double whose awaited chains resolve to `result`
// (including the `count` used by the last-admin guard). Also attaches an
// `auth.admin.updateUserById` stub (ok by default) so setUserSuspended's ban
// call resolves.
function wireAdminClient(result: { data: unknown; error: unknown; count?: number }) {
  const { client } = createMockSupabase(result as never);
  const withAuth = {
    ...client,
    auth: { admin: { updateUserById: vi.fn(async () => ({ data: {}, error: null })) } },
  };
  vi.mocked(createAdminClient).mockReturnValue(
    withAuth as unknown as ReturnType<typeof createAdminClient>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
});

describe('setPlatformAdmin', () => {
  it('blocks revoking the last platform admin', async () => {
    wireAdminClient({ data: null, error: null, count: 1 });
    await expect(setPlatformAdmin('u-2', false)).rejects.toThrow('חייב להישאר');
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('allows revoking when more than one admin exists', async () => {
    wireAdminClient({ data: null, error: null, count: 3 });
    await expect(setPlatformAdmin('u-2', false)).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalled();
    // Additive security alert with the REVOKE title.
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'security',
        title: 'נשללה הרשאת מנהל מערכת',
        fields: { actorUserId: 'admin-1', targetUserId: 'u-2' },
      }),
    );
  });

  it('grants admin to a user that does not have it', async () => {
    wireAdminClient({ data: null, error: null });
    await expect(setPlatformAdmin('u-2', true)).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalled();
    // Additive security alert with the GRANT title (constant, branch-selected).
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'security',
        title: 'הוענקה הרשאת מנהל מערכת',
        fields: { actorUserId: 'admin-1', targetUserId: 'u-2' },
      }),
    );
  });

  it('does not alert when the last admin revoke is blocked', async () => {
    wireAdminClient({ data: null, error: null, count: 1 });
    await expect(setPlatformAdmin('u-2', false)).rejects.toThrow('חייב להישאר');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

describe('getUserDetail — break-glass audit', () => {
  const REASON = 'בירור פנייה בנושא חיוב עבור החשבון של המשתמש';

  // The audit runs BEFORE getUserById, so returning an error there short-circuits
  // the read — enough to assert whether the audit row was (not) recorded without
  // mocking every downstream table chain.
  function wireGetUserByIdError() {
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: null,
            error: { message: 'not found' },
          })),
        },
      },
      from: vi.fn(),
    } as unknown as ReturnType<typeof createAdminClient>);
  }

  it('records a break-glass audit (subject_type user + reason) when viewing ANOTHER user', async () => {
    wireGetUserByIdError();
    await getUserDetail('u-2', REASON);
    expect(recordStaffAccess).toHaveBeenCalledTimes(1);
    expect(recordStaffAccess).toHaveBeenCalledWith({
      staffId: 'admin-1',
      permission: 'manage_staff',
      subjectType: 'user',
      subjectId: 'u-2',
      ownerId: 'u-2',
      reason: REASON,
    });
  });

  it('does NOT record an audit for a self-view (subjectId === staffId)', async () => {
    wireGetUserByIdError();
    await getUserDetail('admin-1');
    expect(recordStaffAccess).not.toHaveBeenCalled();
  });
});

describe('setUserSuspended', () => {
  it('blocks suspending yourself', async () => {
    wireAdminClient({ data: null, error: null });
    await expect(setUserSuspended('admin-1', true)).rejects.toThrow('עצמך');
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('emits a security warn with the SUSPEND title on a suspend', async () => {
    // data:null → the target is not an admin, so the last-admin guard passes.
    wireAdminClient({ data: null, error: null });
    await expect(setUserSuspended('u-2', true)).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'security',
        title: 'משתמש הושהה',
        fields: { actorUserId: 'admin-1', targetUserId: 'u-2' },
      }),
    );
  });

  it('emits a security warn with the RESTORE title on a reactivate', async () => {
    wireAdminClient({ data: null, error: null });
    await expect(setUserSuspended('u-2', false)).resolves.toBeUndefined();
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'security',
        title: 'משתמש שוחזר',
        fields: { actorUserId: 'admin-1', targetUserId: 'u-2' },
      }),
    );
  });
});
