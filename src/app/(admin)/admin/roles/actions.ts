'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  assignStaffRole,
  blockConsoleAgent,
  createPlatformRole,
  enrollConsoleAgent,
  removeConsoleAgent,
  revokeStaffRole,
  setRolePermission,
  unblockConsoleAgent,
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

// Enrol / remove a HUMAN call-console representative — the person who monitors
// the AI agent's calls and can take one over (human_agent_call_legs.mode is
// 'monitor' | 'takeover'). Not to be confused with the ElevenLabs voice agent.
// Sibling of the staff pair above: the DB requires them to be platform staff, so
// this only ever narrows an existing staff membership — it can never grant
// platform access on its own.
const enrollConsoleAgentSchema = z.object({
  userId: z.uuid(),
  displayName: z
    .string()
    .trim()
    .min(2, { message: 'שם התצוגה קצר מדי' })
    .max(80, { message: 'שם התצוגה ארוך מדי' }),
});

export async function enrollConsoleAgentAction(input: {
  userId: string;
  displayName: string;
}): Promise<FormState> {
  await requirePlatformOwner();
  const parsed = enrollConsoleAgentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'ערך לא תקין' };
  }
  let provisioning;
  try {
    provisioning = await enrollConsoleAgent(parsed.data.userId, parsed.data.displayName);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'הוספת נציג המוקד נכשלה. נסו שוב.' };
  }
  // Voximplant must succeed BEFORE any local access is granted (owner
  // directive) — so a failed provisioning means the enrolment did not happen
  // AT ALL, not "added but incomplete". Code 157 ("The 'user_display_name'
  // parameter is invalid" — verified live against voximplant.com/api/v2/
  // getDoc?fqdn=references.httpapi.errors, 2026-08-21) is the one case
  // attributable to a specific field.
  if (!provisioning.ok) {
    if (provisioning.reason === 'api_failed' && provisioning.voxErrorCode === 157) {
      return {
        error: 'הוספת הנציג נכשלה — שם התצוגה נדחה על ידי מערכת השיחות.',
        fieldErrors: {
          displayName: ['שם התצוגה נדחה על ידי מערכת השיחות — נסו שם אחר.'],
        },
      };
    }
    return {
      error: `הוספת הנציג נכשלה — לא ניתן היה ליצור עבורו זהות במערכת השיחות (${provisioning.reason}). נסו שוב.`,
    };
  }
  revalidatePath(ROLES_PATH);
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { notice: 'הנציג נוסף למוקד' };
}

const removeConsoleAgentSchema = z.object({ userId: z.uuid() });

export async function removeConsoleAgentAction(input: { userId: string }): Promise<FormState> {
  await requirePlatformOwner();
  const parsed = removeConsoleAgentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'ערך לא תקין' };
  }
  let outcome;
  try {
    outcome = await removeConsoleAgent(parsed.data.userId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'הסרת נציג המוקד נכשלה. נסו שוב.' };
  }
  // Removal now depends on Voximplant (owner directive): a failed deletion
  // there means the removal did NOT happen — the agent is still enrolled,
  // locally too. This must read as a real failure, not a completed removal
  // with a side note.
  if (!outcome.ok) {
    return {
      error: `הסרת הנציג נכשלה — מחיקת הזהות שלו ב-Voximplant (${outcome.voxUsername}) לא הצליחה (${outcome.reason}). הנציג עדיין רשום במוקד. נסו שוב.`,
    };
  }
  revalidatePath(ROLES_PATH);
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { notice: 'הנציג הוסר מהמוקד' };
}

const setConsoleAgentActiveSchema = z.object({ userId: z.uuid() });

function voxActiveFailureText(reason: 'not_provisioned' | 'not_configured' | 'api_failed'): string {
  if (reason === 'not_provisioned') return 'לנציג זה אין זהות במערכת השיחות — אין מה לחסום.';
  return `הפעולה נכשלה במערכת השיחות (${reason}). נסו שוב.`;
}

// Block a console agent — deactivates the Voximplant identity FIRST; the
// local vox_active flag (what is_console_agent() actually checks) is written
// only once that succeeds. See setConsoleAgentVoxActive for the full
// rationale.
export async function blockConsoleAgentAction(input: { userId: string }): Promise<FormState> {
  await requirePlatformOwner();
  const parsed = setConsoleAgentActiveSchema.safeParse(input);
  if (!parsed.success) return { error: 'ערך לא תקין' };
  let outcome;
  try {
    outcome = await blockConsoleAgent(parsed.data.userId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'חסימת הנציג נכשלה. נסו שוב.' };
  }
  if (!outcome.ok) return { error: voxActiveFailureText(outcome.reason) };
  revalidatePath(ROLES_PATH);
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { notice: 'הנציג נחסם' };
}

export async function unblockConsoleAgentAction(input: { userId: string }): Promise<FormState> {
  await requirePlatformOwner();
  const parsed = setConsoleAgentActiveSchema.safeParse(input);
  if (!parsed.success) return { error: 'ערך לא תקין' };
  let outcome;
  try {
    outcome = await unblockConsoleAgent(parsed.data.userId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'ביטול החסימה נכשל. נסו שוב.' };
  }
  if (!outcome.ok) return { error: voxActiveFailureText(outcome.reason) };
  revalidatePath(ROLES_PATH);
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { notice: 'החסימה בוטלה' };
}
