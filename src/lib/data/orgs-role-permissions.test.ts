import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgOwner } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  getOrgRolePermissionMatrix,
  resetOrgRolePermissionsToDefault,
  setOrgRolePermission,
} from './orgs';

// Org-scoped RBAC matrix (owner-only, UI-editable) — mirrors
// src/lib/data/admin/platform-roles.test.ts one layer down. The owner-only
// gate and the two write guards (owner-role-immutable, system_protected
// grant rejection) are the security-critical surface; every case below pins
// the exact contract, not just "it works".

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requireOrgOwner: vi.fn(),
  // getOrgContext/getUser are unused by these two functions but orgs.ts
  // imports them too — provide harmless stubs so the module loads.
  getOrgContext: vi.fn(),
  getUser: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock('@/lib/permissions', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

const ORG_ID = 'org-1';

function ownerUser(): User {
  return { id: 'owner-1' } as unknown as User;
}

type Result = { data: unknown; error: unknown; count?: number };
type Builder = ReturnType<typeof createMockSupabase>['builder'];

// Mirrors platform-roles.test.ts's sequencedBuilder: yields `results` in order
// across successive awaits of the SAME table (the last entry repeats).
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

// Wires createClient() (RLS/cookie client — used by listRoles/getPermissionCatalog)
// to per-table results.
function wireRlsClient(tables: Record<string, Result | Result[]> = {}) {
  const builders: Record<string, Builder> = {};
  for (const [table, result] of Object.entries(tables)) {
    builders[table] = Array.isArray(result)
      ? sequencedBuilder(result)
      : createMockSupabase(result as never).builder;
  }
  const defaultBuilder = createMockSupabase({ data: [], error: null } as never).builder;
  const from = vi.fn((table: string) => builders[table] ?? defaultBuilder);
  const client = { from };
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { from, builders };
}

// Wires createAdminClient() (service-role — used for the matrix table + writes)
// to per-table results, same shape as platform-roles.test.ts's wireAdminClient.
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
  vi.mocked(requireOrgOwner).mockResolvedValue(ownerUser());
});

// GUARDRAIL 1: every function is owner-gated.
describe('requireOrgOwner gate', () => {
  it('getOrgRolePermissionMatrix awaits requireOrgOwner(orgId) first', async () => {
    wireRlsClient({ org_roles: { data: [], error: null }, permission_definitions: { data: [], error: null } });
    wireAdminClient({ default: { data: [], error: null } });
    await getOrgRolePermissionMatrix(ORG_ID);
    expect(requireOrgOwner).toHaveBeenCalledWith(ORG_ID);
  });

  it('setOrgRolePermission awaits requireOrgOwner(orgId) first', async () => {
    wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-1', is_owner_role: false }, error: null },
        permission_definitions: { data: { id: 'p-1', system_protected: false }, error: null },
        organization_role_permissions: { data: null, error: null },
      },
    });
    await setOrgRolePermission(ORG_ID, 'r-1', 'p-1', true);
    expect(requireOrgOwner).toHaveBeenCalledWith(ORG_ID);
  });

  it('a non-owner redirect from requireOrgOwner propagates (no write attempted)', async () => {
    const boom = new Error('NEXT_REDIRECT');
    vi.mocked(requireOrgOwner).mockRejectedValueOnce(boom);
    const { from } = wireAdminClient({ default: { data: [], error: null } });
    await expect(setOrgRolePermission(ORG_ID, 'r-1', 'p-1', true)).rejects.toThrow('NEXT_REDIRECT');
    expect(from).not.toHaveBeenCalledWith('organization_role_permissions');
  });
});

// GUARDRAIL 2: the owner role's grants are immutable.
describe('setOrgRolePermission — owner-role immutability', () => {
  it('blocks GRANTing a permission on the owner role', async () => {
    const { from } = wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-owner', is_owner_role: true }, error: null },
        permission_definitions: { data: { id: 'p-1', system_protected: false }, error: null },
      },
    });
    await expect(setOrgRolePermission(ORG_ID, 'r-owner', 'p-1', true)).rejects.toThrow('קבועות');
    expect(from).not.toHaveBeenCalledWith('organization_role_permissions');
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('blocks REVOKing a permission on the owner role', async () => {
    wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-owner', is_owner_role: true }, error: null },
        permission_definitions: { data: { id: 'p-1', system_protected: false }, error: null },
      },
    });
    await expect(setOrgRolePermission(ORG_ID, 'r-owner', 'p-1', false)).rejects.toThrow('קבועות');
    expect(logActivity).not.toHaveBeenCalled();
  });
});

// GUARDRAIL 3: a system_protected permission can never be granted to a
// non-owner role (app-layer defense-in-depth over the DB trigger + the
// has_org_permission() read-time guard).
describe('setOrgRolePermission — system_protected grant rejection', () => {
  it('blocks granting a system_protected permission to a non-owner role', async () => {
    const { from } = wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-admin', is_owner_role: false }, error: null },
        permission_definitions: { data: { id: 'p-campaigns-create', system_protected: true }, error: null },
      },
    });
    await expect(
      setOrgRolePermission(ORG_ID, 'r-admin', 'p-campaigns-create', true),
    ).rejects.toThrow('שמורה לבעלים');
    expect(from).not.toHaveBeenCalledWith('organization_role_permissions');
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('allows REVOKING a system_protected permission from a non-owner role (no-op cleanup path)', async () => {
    const { builders } = wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-admin', is_owner_role: false }, error: null },
        permission_definitions: { data: { id: 'p-campaigns-create', system_protected: true }, error: null },
        organization_role_permissions: { data: null, error: null },
      },
    });
    await expect(
      setOrgRolePermission(ORG_ID, 'r-admin', 'p-campaigns-create', false),
    ).resolves.toBeUndefined();
    expect(builders.organization_role_permissions.delete).toHaveBeenCalled();
  });
});

// GUARDRAIL 4: grant/revoke writes the org-scoped row + fires the audit/alert
// side effects (organization_role_audit_log itself is written by the DB
// trigger, atomic with this same insert/delete — not asserted here).
describe('setOrgRolePermission — grant/revoke writes', () => {
  it('GRANT upserts the (org, role, permission) row and logs the actor', async () => {
    const { builders } = wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-member', is_owner_role: false }, error: null },
        permission_definitions: { data: { id: 'p-guests-delete', system_protected: false }, error: null },
        organization_role_permissions: { data: null, error: null },
      },
    });
    await setOrgRolePermission(ORG_ID, 'r-member', 'p-guests-delete', true);
    expect(builders.organization_role_permissions.upsert).toHaveBeenCalledWith(
      { organization_id: ORG_ID, role_id: 'r-member', permission_id: 'p-guests-delete', granted_by: 'owner-1' },
      { onConflict: 'organization_id,role_id,permission_id' },
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org_role.permission_granted' }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'security',
        fields: {
          actorUserId: 'owner-1',
          organizationId: ORG_ID,
          roleId: 'r-member',
          permissionId: 'p-guests-delete',
        },
      }),
    );
  });

  it('REVOKE deletes the row and logs the actor', async () => {
    const { builders } = wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-member', is_owner_role: false }, error: null },
        permission_definitions: { data: { id: 'p-guests-delete', system_protected: false }, error: null },
        organization_role_permissions: { data: null, error: null },
      },
    });
    await setOrgRolePermission(ORG_ID, 'r-member', 'p-guests-delete', false);
    expect(builders.organization_role_permissions.delete).toHaveBeenCalled();
    expect(builders.organization_role_permissions.eq).toHaveBeenCalledWith('organization_id', ORG_ID);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org_role.permission_revoked' }),
    );
  });

  it('surfaces a safe error when the role is not found', async () => {
    wireAdminClient({
      tables: {
        org_roles: { data: null, error: null },
        permission_definitions: { data: { id: 'p-1', system_protected: false }, error: null },
      },
    });
    await expect(setOrgRolePermission(ORG_ID, 'r-missing', 'p-1', true)).rejects.toThrow('התפקיד לא נמצא');
  });

  it('surfaces a safe error when the permission is not found', async () => {
    wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-member', is_owner_role: false }, error: null },
        permission_definitions: { data: null, error: null },
      },
    });
    await expect(setOrgRolePermission(ORG_ID, 'r-member', 'p-missing', true)).rejects.toThrow('ההרשאה לא נמצאה');
  });
});

// Read-shape contract for the matrix screen.
describe('getOrgRolePermissionMatrix', () => {
  it('returns roles, permissions and an org-scoped granted map', async () => {
    wireRlsClient({
      org_roles: {
        data: [
          { id: 'r-owner', name: 'owner', label: 'בעלים', description: null, rank: 40, is_owner_role: true, sort_order: 0 },
          { id: 'r-admin', name: 'admin', label: 'מנהל', description: null, rank: 30, is_owner_role: false, sort_order: 1 },
        ],
        error: null,
      },
      permission_definitions: {
        data: [
          { id: 'p1', resource: 'guests', action: 'view', label: 'צפייה', sort_order: 0 },
          { id: 'p2', resource: 'guests', action: 'delete', label: 'מחיקה', sort_order: 1 },
        ],
        error: null,
      },
    });
    wireAdminClient({
      tables: {
        organization_role_permissions: {
          data: [
            { role_id: 'r-owner', permission_id: 'p1' },
            { role_id: 'r-owner', permission_id: 'p2' },
            { role_id: 'r-admin', permission_id: 'p1' },
          ],
          error: null,
        },
      },
    });
    const matrix = await getOrgRolePermissionMatrix(ORG_ID);
    expect(matrix.roles).toHaveLength(2);
    expect(matrix.permissions).toHaveLength(2);
    expect(matrix.granted['r-owner']).toEqual(['p1', 'p2']);
    // ADMIN DOES NOT hold guests.delete (Fix-1 backfill exclusion) — only p1.
    expect(matrix.granted['r-admin']).toEqual(['p1']);
  });

  it('scopes the matrix query to the given organization_id', async () => {
    wireRlsClient({ org_roles: { data: [], error: null }, permission_definitions: { data: [], error: null } });
    const { builders } = wireAdminClient({
      tables: { organization_role_permissions: { data: [], error: null } },
    });
    await getOrgRolePermissionMatrix(ORG_ID);
    expect(builders.organization_role_permissions.eq).toHaveBeenCalledWith('organization_id', ORG_ID);
  });
});

// Reset a non-owner role back to the frozen template default (diff-based).
describe('resetOrgRolePermissionsToDefault', () => {
  it('awaits requireOrgOwner(orgId) first', async () => {
    wireAdminClient({
      tables: { org_roles: { data: { id: 'r-owner', is_owner_role: true }, error: null } },
    });
    await resetOrgRolePermissionsToDefault(ORG_ID, 'r-owner');
    expect(requireOrgOwner).toHaveBeenCalledWith(ORG_ID);
  });

  it('is a no-op for the owner role (no writes, no audit)', async () => {
    const { from } = wireAdminClient({
      tables: { org_roles: { data: { id: 'r-owner', is_owner_role: true }, error: null } },
    });
    await resetOrgRolePermissionsToDefault(ORG_ID, 'r-owner');
    expect(from).not.toHaveBeenCalledWith('organization_role_permissions');
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('restores the missing template perms and removes extras — excluding system_protected + guests.delete', async () => {
    const { builders } = wireAdminClient({
      tables: {
        org_roles: { data: { id: 'r-member', is_owner_role: false }, error: null },
        permission_definitions: {
          data: [
            { id: 'p1', resource: 'guests', action: 'view', system_protected: false },
            { id: 'pc', resource: 'campaigns', action: 'create', system_protected: true },
            { id: 'pd', resource: 'guests', action: 'delete', system_protected: false },
          ],
          error: null,
        },
        // member's frozen template holds p1 + pc + pd
        role_permissions: {
          data: [{ permission_id: 'p1' }, { permission_id: 'pc' }, { permission_id: 'pd' }],
          error: null,
        },
        // current org state: member wrongly holds pd (an extra) and is missing p1
        organization_role_permissions: [
          { data: [{ permission_id: 'pd' }], error: null }, // read current
          { data: null, error: null }, // delete extras
          { data: null, error: null }, // insert missing
        ],
      },
    });

    await resetOrgRolePermissionsToDefault(ORG_ID, 'r-member');

    // pd (guests.delete) is excluded from the target -> removed as an extra
    expect(builders.organization_role_permissions.delete).toHaveBeenCalled();
    expect(builders.organization_role_permissions.in).toHaveBeenCalledWith('permission_id', ['pd']);
    // p1 is the only target perm (pc excluded system_protected, pd excluded guests.delete) -> inserted
    expect(builders.organization_role_permissions.insert).toHaveBeenCalledWith([
      { organization_id: ORG_ID, role_id: 'r-member', permission_id: 'p1', granted_by: 'owner-1' },
    ]);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org_role.permissions_reset' }),
    );
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'security' }),
    );
  });
});
