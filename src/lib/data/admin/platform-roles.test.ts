import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPlatformPermission, requirePlatformOwner } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  assignStaffRole,
  createPlatformRole,
  getRolePermissionMatrix,
  getUserStaffRoleId,
  listPlatformPermissions,
  listPlatformRoles,
  revokeStaffRole,
  setRolePermission,
} from './platform-roles';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requirePlatformOwner: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

// The acting PLATFORM owner (KALFA staff on the owner role), returned by the
// mocked requirePlatformOwner(). Owners hold every permission.
function ownerUser(): User {
  return { id: 'owner-1' } as unknown as User;
}

type Result = { data: unknown; error: unknown; count?: number };
type Builder = ReturnType<typeof createMockSupabase>['builder'];

// A table double that yields `results` in order across successive awaits (the
// last entry repeats). Needed when one function awaits the SAME table more than
// once with different expected rows — e.g. assignStaffRole reads platform_roles
// for the new role, then again for the current role, then again for the owner-id
// list. A plain single-result double can't distinguish those.
function sequencedBuilder(results: Result[]): Builder {
  const builder = createMockSupabase(results[0] as never).builder;
  let i = 0;
  builder.then = ((onFulfilled: (v: Result) => unknown) => {
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return onFulfilled(r);
  }) as typeof builder.then;
  return builder;
}

// Wire createAdminClient() to a service-role double whose `from(table)` resolves
// per-table. The real data layer issues several `from()` calls against DIFFERENT
// tables within one function (e.g. setRolePermission reads platform_roles AND
// platform_permission_definitions before writing platform_role_permissions), so
// a single shared result is not enough — each table gets its own awaitable
// builder. A table may map to a single Result or to a sequence (Result[]).
// Tables not listed fall back to `default`.
function wireAdminClient(
  opts: { tables?: Record<string, Result | Result[]>; default?: Result } = {},
) {
  const builders: Record<string, Builder> = {};
  for (const [table, result] of Object.entries(opts.tables ?? {})) {
    builders[table] = Array.isArray(result)
      ? sequencedBuilder(result)
      : createMockSupabase(result as never).builder;
  }
  const defaultBuilder = createMockSupabase(
    (opts.default ?? { data: null, error: null }) as never,
  ).builder;

  const from = vi.fn((table: string) => builders[table] ?? defaultBuilder);
  const client = { from, rpc: vi.fn(async () => ({ data: null, error: null })) };
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { from, builders, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformOwner).mockResolvedValue(ownerUser());
  // Owner holds every permission — the self-escalation guard passes by default.
  vi.mocked(hasPlatformPermission).mockResolvedValue(true);
});

// GUARDRAIL 1: the owner role's permissions are immutable.
describe('setRolePermission — owner-role immutability', () => {
  it('blocks GRANTing a permission on an owner role', async () => {
    const { from } = wireAdminClient({
      tables: {
        platform_roles: { data: { id: 'r-owner', is_owner_role: true }, error: null },
        platform_permission_definitions: {
          data: { id: 'p1', key: 'manage_billing' },
          error: null,
        },
      },
    });
    await expect(setRolePermission('r-owner', 'p1', true)).rejects.toThrow('קבועות');
    // No write to the matrix table, and no audit side effects.
    expect(from).not.toHaveBeenCalledWith('platform_role_permissions');
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('blocks REVOKing a permission on an owner role', async () => {
    wireAdminClient({
      tables: {
        platform_roles: { data: { id: 'r-owner', is_owner_role: true }, error: null },
        platform_permission_definitions: {
          data: { id: 'p1', key: 'manage_billing' },
          error: null,
        },
      },
    });
    await expect(setRolePermission('r-owner', 'p1', false)).rejects.toThrow('קבועות');
    expect(logActivity).not.toHaveBeenCalled();
  });
});

// GUARDRAIL 2: a caller cannot grant a permission they do not personally hold.
describe('setRolePermission — self-escalation guard', () => {
  it('rejects granting a permission the caller lacks', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(false);
    const { from } = wireAdminClient({
      tables: {
        platform_roles: { data: { id: 'r-staff', is_owner_role: false }, error: null },
        platform_permission_definitions: {
          data: { id: 'p1', key: 'manage_billing' },
          error: null,
        },
      },
    });
    await expect(setRolePermission('r-staff', 'p1', true)).rejects.toThrow('בעצמך');
    expect(hasPlatformPermission).toHaveBeenCalledWith('manage_billing');
    // Guard fires BEFORE the write / audit.
    expect(from).not.toHaveBeenCalledWith('platform_role_permissions');
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('allows granting when the caller holds the permission (upsert + audit)', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    const { builders } = wireAdminClient({
      tables: {
        platform_roles: { data: { id: 'r-staff', is_owner_role: false }, error: null },
        platform_permission_definitions: {
          data: { id: 'p1', key: 'manage_billing' },
          error: null,
        },
        platform_role_permissions: { data: null, error: null },
      },
    });
    await expect(setRolePermission('r-staff', 'p1', true)).resolves.toBeUndefined();
    expect(builders.platform_role_permissions.upsert).toHaveBeenCalledWith(
      { role_id: 'r-staff', permission_id: 'p1' },
      { onConflict: 'role_id,permission_id' },
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.platform_role.permission_granted' }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'security',
        fields: { actorUserId: 'owner-1', roleId: 'r-staff', permissionId: 'p1' },
      }),
    );
  });

  it('REVOKE on a non-owner role does not consult the self-escalation guard', async () => {
    const { builders } = wireAdminClient({
      tables: {
        platform_roles: { data: { id: 'r-staff', is_owner_role: false }, error: null },
        platform_permission_definitions: {
          data: { id: 'p1', key: 'manage_billing' },
          error: null,
        },
        platform_role_permissions: { data: null, error: null },
      },
    });
    await expect(setRolePermission('r-staff', 'p1', false)).resolves.toBeUndefined();
    expect(hasPlatformPermission).not.toHaveBeenCalled();
    expect(builders.platform_role_permissions.delete).toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.platform_role.permission_revoked' }),
    );
  });
});

// GUARDRAIL 3: the last owner cannot be removed.
describe('revokeStaffRole — last-owner protection', () => {
  it('surfaces the DB last-owner guard (P0001) message as-is', async () => {
    wireAdminClient({
      tables: {
        platform_staff: {
          data: null,
          error: { code: 'P0001', message: 'חייב להישאר לפחות בעל מערכת אחד' },
        },
      },
    });
    await expect(revokeStaffRole('u-2')).rejects.toThrow('חייב להישאר לפחות בעל מערכת אחד');
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('maps a non-P0001 DB error to a generic safe message', async () => {
    wireAdminClient({
      tables: {
        platform_staff: { data: null, error: { code: '23503', message: 'fk detail leak' } },
      },
    });
    await expect(revokeStaffRole('u-2')).rejects.toThrow('שלילת התפקיד נכשלה');
  });

  it('revokes and audits on success', async () => {
    wireAdminClient({ tables: { platform_staff: { data: null, error: null } } });
    await expect(revokeStaffRole('u-2')).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.platform_staff.role_revoked' }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'security',
        fields: { actorUserId: 'owner-1', targetUserId: 'u-2' },
      }),
    );
  });
});

// GUARDRAIL 4: revoking staff CASCADES the user out of console_agents (FK added
// in 20260721005100). That is a second privilege removal, so the audit trail has
// to name it — otherwise a console agent loses their access with nothing on
// record saying so.
describe('revokeStaffRole — console cascade is audited', () => {
  it('records the console un-enrolment when the user WAS an agent', async () => {
    wireAdminClient({
      tables: {
        console_agents: { data: { user_id: 'u-2' }, error: null },
        platform_staff: { data: null, error: null },
      },
    });
    await expect(revokeStaffRole('u-2')).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.platform_staff.role_revoked',
        meta: { targetUserId: 'u-2', wasConsoleAgent: true },
      }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: {
          actorUserId: 'owner-1',
          targetUserId: 'u-2',
          consoleAgent: 'הוסר גם ממוקד השיחות',
        },
      }),
    );
  });

  it('stays silent in Slack when there was no console membership to remove', async () => {
    // `false` still reaches the machine-readable audit record; only the human
    // notification omits it, because "nothing else happened" is not news.
    wireAdminClient({
      tables: {
        console_agents: { data: null, error: null },
        platform_staff: { data: null, error: null },
      },
    });
    await expect(revokeStaffRole('u-2')).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { targetUserId: 'u-2', wasConsoleAgent: false } }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ fields: { actorUserId: 'owner-1', targetUserId: 'u-2' } }),
    );
  });

  it('records UNKNOWN rather than a false "no" when the probe fails', async () => {
    // The probe is bookkeeping; it must never assert something it did not learn,
    // and must never block the revocation itself.
    wireAdminClient({
      tables: {
        console_agents: { data: null, error: { code: '42501', message: 'denied' } },
        platform_staff: { data: null, error: null },
      },
    });
    await expect(revokeStaffRole('u-2')).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { targetUserId: 'u-2', wasConsoleAgent: null } }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({ consoleAgent: 'לא ידוע — בדיקת המוקד נכשלה' }),
      }),
    );
  });
});

// App-level cover for the gap the DB trigger doesn't reach: the last-owner
// trigger fires on DELETE only, not on this role-CHANGING upsert.
describe('assignStaffRole — last-owner reassignment guard', () => {
  it('blocks demoting the LAST owner to a non-owner role', async () => {
    const { builders } = wireAdminClient({
      tables: {
        // Awaited three times: (1) new role → non-owner, (2) current role →
        // owner, (3) owner-role-id list for ownerCount().
        platform_roles: [
          { data: { id: 'r-staff', is_owner_role: false }, error: null },
          { data: { is_owner_role: true }, error: null },
          { data: [{ id: 'r-owner' }], error: null },
        ],
        // Awaited twice: (1) current staff row (owner), (2) owner head-count = 1.
        platform_staff: [
          { data: { role_id: 'r-owner' }, error: null },
          { data: null, error: null, count: 1 },
        ],
      },
    });
    await expect(assignStaffRole('u-owner', 'r-staff')).rejects.toThrow(
      'חייב להישאר לפחות בעל מערכת אחד',
    );
    // Guard fires BEFORE the write and audit.
    expect(builders.platform_staff.upsert).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('allows demoting an owner while OTHER owners remain', async () => {
    const { builders } = wireAdminClient({
      tables: {
        platform_roles: [
          { data: { id: 'r-staff', is_owner_role: false }, error: null },
          { data: { is_owner_role: true }, error: null },
          { data: [{ id: 'r-owner' }], error: null },
        ],
        platform_staff: [
          { data: { role_id: 'r-owner' }, error: null },
          { data: null, error: null, count: 2 }, // two owners → safe to demote one
          { data: null, error: null }, // the upsert
        ],
      },
    });
    await expect(assignStaffRole('u-owner', 'r-staff')).resolves.toBeUndefined();
    expect(builders.platform_staff.upsert).toHaveBeenCalledWith(
      { user_id: 'u-owner', role_id: 'r-staff', granted_by: 'owner-1' },
      { onConflict: 'user_id' },
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.platform_staff.role_assigned' }),
    );
  });

  it('assigns a role to a brand-new staff member', async () => {
    const { builders } = wireAdminClient({
      tables: {
        // new role lookup → non-owner; current-role lookup not reached (no row).
        platform_roles: { data: { id: 'r-staff', is_owner_role: false }, error: null },
        platform_staff: [
          { data: null, error: null }, // no current staff row
          { data: null, error: null }, // the upsert
        ],
      },
    });
    await expect(assignStaffRole('u-new', 'r-staff')).resolves.toBeUndefined();
    expect(builders.platform_staff.upsert).toHaveBeenCalledWith(
      { user_id: 'u-new', role_id: 'r-staff', granted_by: 'owner-1' },
      { onConflict: 'user_id' },
    );
  });
});

// GUARDRAIL 4: a newly created role starts with ZERO permissions.
describe('createPlatformRole — starts with zero permissions', () => {
  it('inserts a non-owner role and never touches the permissions table', async () => {
    const { from, builders } = wireAdminClient({
      tables: {
        platform_roles: {
          data: {
            id: 'r-new',
            name: 'support',
            label: 'תמיכה',
            description: null,
            is_owner_role: false,
            rank: 0,
            sort_order: 0,
          },
          error: null,
        },
      },
    });
    const role = await createPlatformRole('support', 'תמיכה');
    expect(role).toEqual(
      expect.objectContaining({ id: 'r-new', name: 'support', isOwnerRole: false }),
    );
    // Never an owner role.
    expect(builders.platform_roles.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'support', label: 'תמיכה', is_owner_role: false }),
    );
    // ZERO permissions — no grant into the matrix table.
    expect(from).not.toHaveBeenCalledWith('platform_role_permissions');
  });

  it('maps a unique-name violation (23505) to a friendly Hebrew message', async () => {
    wireAdminClient({
      tables: {
        platform_roles: {
          data: null,
          error: { code: '23505', message: 'duplicate key value' },
        },
      },
    });
    await expect(createPlatformRole('owner', 'שכפול')).rejects.toThrow('כבר קיים');
    expect(logActivity).not.toHaveBeenCalled();
  });
});

// GUARDRAIL 5: every exported data function is gated by requirePlatformOwner().
describe('requirePlatformOwner gate on every data function', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['listPlatformRoles', () => listPlatformRoles()],
    ['listPlatformPermissions', () => listPlatformPermissions()],
    ['getRolePermissionMatrix', () => getRolePermissionMatrix()],
    ['getUserStaffRoleId', () => getUserStaffRoleId('u-1')],
    ['setRolePermission', () => setRolePermission('r-1', 'p-1', false)],
    ['createPlatformRole', () => createPlatformRole('n', 'l')],
    ['assignStaffRole', () => assignStaffRole('u-1', 'r-1')],
    ['revokeStaffRole', () => revokeStaffRole('u-1')],
  ];

  for (const [name, fn] of cases) {
    it(`${name} awaits requirePlatformOwner`, async () => {
      // Permissive default so the body runs without throwing; we only assert the
      // authorization gate ran (it is the first await in every function).
      wireAdminClient({ default: { data: [], error: null } });
      await fn().catch(() => {});
      // Gate runs first in every function. getRolePermissionMatrix composes two
      // other gated reads (deduped by cache() in production, not in this mock), so
      // assert the gate ran rather than an exact call count.
      expect(requirePlatformOwner).toHaveBeenCalled();
    });
  }

  it('a function throws if the gate rejects (non-owner redirect)', async () => {
    const boom = new Error('NEXT_REDIRECT');
    vi.mocked(requirePlatformOwner).mockRejectedValueOnce(boom);
    wireAdminClient({ default: { data: [], error: null } });
    await expect(listPlatformRoles()).rejects.toThrow('NEXT_REDIRECT');
  });
});

// Read helpers shape correctly (matrix serialization contract).
describe('read helpers', () => {
  it('getRolePermissionMatrix returns roles, permissions and a granted map', async () => {
    wireAdminClient({
      tables: {
        platform_roles: {
          data: [
            {
              id: 'r-owner',
              name: 'owner',
              label: 'בעל מערכת',
              description: null,
              is_owner_role: true,
              rank: 100,
              sort_order: 0,
            },
            {
              id: 'r-staff',
              name: 'support',
              label: 'תמיכה',
              description: null,
              is_owner_role: false,
              rank: 0,
              sort_order: 1,
            },
          ],
          error: null,
        },
        platform_permission_definitions: {
          data: [
            { id: 'p1', key: 'manage_billing', label: 'חיוב', category: 'billing', sort_order: 0 },
            { id: 'p2', key: 'manage_staff', label: 'צוות', category: 'platform', sort_order: 1 },
          ],
          error: null,
        },
        platform_role_permissions: {
          data: [
            { role_id: 'r-owner', permission_id: 'p1' },
            { role_id: 'r-owner', permission_id: 'p2' },
            { role_id: 'r-staff', permission_id: 'p1' },
          ],
          error: null,
        },
      },
    });
    const matrix = await getRolePermissionMatrix();
    expect(matrix.roles).toHaveLength(2);
    expect(matrix.permissions).toHaveLength(2);
    expect(matrix.granted['r-owner']).toEqual(['p1', 'p2']);
    expect(matrix.granted['r-staff']).toEqual(['p1']);
  });

  it('getUserStaffRoleId returns null when the user is not staff', async () => {
    wireAdminClient({ tables: { platform_staff: { data: null, error: null } } });
    await expect(getUserStaffRoleId('u-nobody')).resolves.toBeNull();
  });

  it('listPlatformPermissions surfaces a safe error on failure', async () => {
    wireAdminClient({
      tables: {
        platform_permission_definitions: {
          data: null,
          error: { message: 'db down' },
        },
      },
    });
    await expect(listPlatformPermissions()).rejects.toThrow('טעינת ההרשאות נכשלה');
  });
});
