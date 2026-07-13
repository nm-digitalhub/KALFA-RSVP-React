'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  assignStaffRole,
  createPlatformRole,
  revokeStaffRole,
  setRolePermission,
} from '@/lib/data/admin/platform-roles';
import type { FormState } from '@/lib/validation/result';

// Server Actions for the platform (Owner/Staff) RBAC screen. Every action:
//   1. re-verifies requirePlatformOwner() as its FIRST line (belt-and-suspenders
//      on top of the page-level gate and the data-layer gate),
//   2. validates input with Zod,
//   3. delegates to the data layer (service-role writes + audit + Slack),
//   4. revalidates the affected paths,
//   5. returns a FormState the client can render / roll back on.

const ROLES_PATH = '/admin/roles';

// Toggle one (role, permission) matrix cell. Called directly by the client
// Switch (optimistic + revert on { error }), so it takes a typed object rather
// than FormData — mirrors setAlertToggleAction in ../alerts/actions.ts.
const setRolePermissionSchema = z.object({
  roleId: z.uuid(),
  permissionId: z.uuid(),
  granted: z.boolean(),
});

export async function setRolePermissionAction(input: {
  roleId: string;
  permissionId: string;
  granted: boolean;
}): Promise<FormState> {
  await requirePlatformOwner();
  const parsed = setRolePermissionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'ערך לא תקין' };
  }
  try {
    await setRolePermission(parsed.data.roleId, parsed.data.permissionId, parsed.data.granted);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'עדכון ההרשאה נכשל. נסו שוב.' };
  }
  revalidatePath(ROLES_PATH);
  return { notice: 'נשמר' };
}

// Create a new platform role (starts with zero permissions).
const createRoleSchema = z.object({
  // Machine name: lowercase letters/digits/underscore, used as a stable key.
  name: z
    .string()
    .trim()
    .min(2, { message: 'שם קצר מדי' })
    .max(50, { message: 'שם ארוך מדי' })
    .regex(/^[a-z][a-z0-9_]*$/, {
      message: 'שם התפקיד באנגלית קטנה, ספרות וקו תחתון בלבד',
    }),
  label: z
    .string()
    .trim()
    .min(2, { message: 'תווית קצרה מדי' })
    .max(80, { message: 'תווית ארוכה מדי' }),
});

export async function createPlatformRoleAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformOwner();
  const parsed = createRoleSchema.safeParse({
    name: formData.get('name') ?? '',
    label: formData.get('label') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await createPlatformRole(parsed.data.name, parsed.data.label);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'יצירת התפקיד נכשלה. נסו שוב.' };
  }
  revalidatePath(ROLES_PATH);
  return { notice: 'התפקיד נוצר' };
}

// Assign a platform role to a user (single role per user). Called from the user
// detail screen's staff selector; revalidates both that page and the roles page.
const assignStaffSchema = z.object({
  userId: z.uuid(),
  roleId: z.uuid(),
});

export async function assignStaffRoleAction(input: {
  userId: string;
  roleId: string;
}): Promise<FormState> {
  await requirePlatformOwner();
  const parsed = assignStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'ערך לא תקין' };
  }
  try {
    await assignStaffRole(parsed.data.userId, parsed.data.roleId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'הקצאת התפקיד נכשלה. נסו שוב.' };
  }
  revalidatePath(ROLES_PATH);
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { notice: 'התפקיד הוקצה' };
}

// Revoke a user's platform staff membership (the DB last-owner guard may reject).
const revokeStaffSchema = z.object({ userId: z.uuid() });

export async function revokeStaffRoleAction(input: { userId: string }): Promise<FormState> {
  await requirePlatformOwner();
  const parsed = revokeStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'ערך לא תקין' };
  }
  try {
    await revokeStaffRole(parsed.data.userId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'שלילת התפקיד נכשלה. נסו שוב.' };
  }
  revalidatePath(ROLES_PATH);
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { notice: 'התפקיד נשלל' };
}
