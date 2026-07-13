'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requireActiveOrg, requireOrgOwner } from '@/lib/auth/dal';
import { setOrgRolePermission } from '@/lib/data/orgs';
import type { FormState } from '@/lib/validation/result';

// Server Actions for the ORG (customer) role-permission matrix screen. Sibling
// to ../actions.ts (member/invitation management), scoped to editing what each
// org role may do. Every action:
//   1. resolves the active org from the cookie (requireActiveOrg — never a
//      browser-supplied org id) then re-verifies requireOrgOwner(orgId) as its
//      FIRST check (belt-and-suspenders on top of the page-level gate and the
//      data-layer gate), mirroring admin/roles/actions.ts's
//      requirePlatformOwner() re-check pattern one layer down,
//   2. validates input with Zod,
//   3. delegates to the data layer (service-role writes + audit + Slack),
//   4. revalidates the roles screen,
//   5. returns a FormState the client can render / roll back on.

const ROLES_PATH = '/app/team/roles';

// Toggle one (role, permission) matrix cell. Called directly by the client
// Switch (optimistic + revert on { error }), so it takes a typed object rather
// than FormData — mirrors setRolePermissionAction in admin/roles/actions.ts.
const setOrgRolePermissionSchema = z.object({
  roleId: z.uuid(),
  permissionId: z.uuid(),
  granted: z.boolean(),
});

export async function setOrgRolePermissionAction(input: {
  roleId: string;
  permissionId: string;
  granted: boolean;
}): Promise<FormState> {
  const { orgId } = await requireActiveOrg();
  await requireOrgOwner(orgId);
  const parsed = setOrgRolePermissionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'ערך לא תקין' };
  }
  try {
    await setOrgRolePermission(orgId, parsed.data.roleId, parsed.data.permissionId, parsed.data.granted);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'עדכון ההרשאה נכשל. נסו שוב.' };
  }
  revalidatePath(ROLES_PATH);
  return { notice: 'נשמר' };
}
