'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireActiveOrg, requireOrgOwner } from '@/lib/auth/dal';
import { resetOrgRolePermissionsToDefault, setOrgRolePermission } from '@/lib/data/orgs';
import { actionClient } from '@/lib/safe-action';

// Server Actions for the ORG (customer) role-permission matrix screen. Sibling
// to ../actions.ts (member/invitation management), scoped to editing what each
// org role may do. Every action:
//   1. resolves the active org from the cookie (requireActiveOrg — never a
//      browser-supplied org id) then re-verifies requireOrgOwner(orgId) as its
//      FIRST check (belt-and-suspenders on top of the page-level gate and the
//      data-layer gate), mirroring admin/roles/actions.ts's
//      requirePlatformOwner() re-check pattern one layer down. It runs in a
//      pre-validation middleware (`use()` runs ahead of the input schema), which
//      hands the org id to the body,
//   2. validates input with Zod (the input schema; a malformed input is
//      answered with 'ערך לא תקין' and nothing else happens),
//   3. delegates to the data layer (service-role writes + audit + Slack),
//   4. revalidates the roles screen,
//   5. returns { notice } on success, or a serverError the client can render /
//      roll back on: a data-layer failure throws its own Hebrew message, which
//      the client's error policy (src/lib/safe-action.ts) passes through.

const ROLES_PATH = '/app/team/roles';

// Toggle one (role, permission) matrix cell. Called directly by the client
// Switch (optimistic + revert on an error), so it takes a typed object rather
// than FormData — mirrors setRolePermissionAction in admin/roles/actions.ts.
const setOrgRolePermissionSchema = z.object({
  roleId: z.uuid({ error: 'ערך לא תקין' }),
  permissionId: z.uuid({ error: 'ערך לא תקין' }),
  granted: z.boolean({ error: 'ערך לא תקין' }),
}, { error: 'ערך לא תקין' });

export const setOrgRolePermissionAction = actionClient
  .use(async ({ next }) => {
    const { orgId } = await requireActiveOrg();
    await requireOrgOwner(orgId);
    return next({ ctx: { orgId } });
  })
  .inputSchema(setOrgRolePermissionSchema)
  .action(async ({ parsedInput, ctx: { orgId } }) => {
    await setOrgRolePermission(orgId, parsedInput.roleId, parsedInput.permissionId, parsedInput.granted);
    revalidatePath(ROLES_PATH);
    return { notice: 'נשמר' };
  });

// Reset one non-owner role's grants back to the factory default. orgId is
// resolved server-side (requireActiveOrg), never client-supplied.
const resetOrgRoleSchema = z.object({ roleId: z.uuid({ error: 'ערך לא תקין' }) }, { error: 'ערך לא תקין' });

export const resetOrgRolePermissionsAction = actionClient
  .use(async ({ next }) => {
    const { orgId } = await requireActiveOrg();
    await requireOrgOwner(orgId);
    return next({ ctx: { orgId } });
  })
  .inputSchema(resetOrgRoleSchema)
  .action(async ({ parsedInput, ctx: { orgId } }) => {
    await resetOrgRolePermissionsToDefault(orgId, parsedInput.roleId);
    revalidatePath(ROLES_PATH);
    return { notice: 'התפקיד אופס לברירת המחדל' };
  });
